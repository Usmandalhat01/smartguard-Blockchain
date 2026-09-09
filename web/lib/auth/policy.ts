/**
 * Role-based access control.
 *
 * This module is the single definition of who may do what. It is imported by
 * the proxy (route admission), by the server components (page-level checks),
 * by the API route handlers (request authorisation) and by the interface
 * (which controls to render) — so those four cannot drift apart.
 *
 * Two layers of check are modelled, deliberately:
 *
 *   1. Role permissions — "an arbitrator may resolve disputes".
 *   2. Object-level guards — "…but only on an escrow that names *this*
 *      arbitrator, and only while it is in the DISPUTED state."
 *
 * The object-level guards mirror the modifiers on EscrowContract one for one.
 * That is not redundancy: the contract is the enforcement point and the guards
 * here exist so the interface never offers an action the chain would revert.
 * A check that only lives in the client is not access control.
 */

import type { Dispute, EscrowState, Role, Transaction } from '@/lib/types';

/* --------------------------------------------------------- permissions -- */

export type Permission =
  // escrow lifecycle
  | 'escrow:create'
  | 'escrow:read:own'
  | 'escrow:read:any'
  | 'escrow:confirm-delivery'
  | 'escrow:claim-refund'
  | 'escrow:withdraw'
  // disputes
  | 'dispute:raise'
  | 'dispute:read:own'
  | 'dispute:read:any'
  | 'dispute:resolve'
  // administration
  | 'admin:settings:read'
  | 'admin:settings:write'
  | 'admin:model:read'
  | 'admin:audit:read'
  | 'admin:users:read';

/**
 * Role → permission grants.
 *
 * Grants are additive and no role inherits from another. An administrator
 * governs the system's parameters; it deliberately holds no permission to move
 * anyone's funds, because on chain it has no such capability either — modelling
 * an administrator who could would misrepresent the contract.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  buyer: [
    'escrow:create',
    'escrow:read:own',
    'escrow:confirm-delivery',
    'escrow:claim-refund',
    'dispute:raise',
    'dispute:read:own',
  ],
  seller: [
    'escrow:read:own',
    'escrow:withdraw',
    'dispute:raise',
    'dispute:read:own',
  ],
  arbitrator: [
    'escrow:read:any',
    'dispute:read:any',
    'dispute:resolve',
  ],
  admin: [
    'escrow:read:any',
    'dispute:read:any',
    'admin:settings:read',
    'admin:settings:write',
    'admin:model:read',
    'admin:audit:read',
    'admin:users:read',
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  arbitrator: 'Arbitrator',
  admin: 'Administrator',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  buyer: 'Initiates escrows through the risk gate, confirms delivery, and reclaims funds after the holding period.',
  seller: 'Receives escrowed funds released by the contract. Cannot move an escrow directly.',
  arbitrator: 'Holds exclusive authority over disputed escrows. Rulings are enforced by the contract.',
  admin: 'Governs risk parameters and reads the audit record. Holds no authority over funds.',
};

/* ------------------------------------------------------------- subject -- */

/** The authenticated subject, as carried in the session token. */
export interface Principal {
  userId: string;
  walletAddress: string;
  role: Role;
  displayName: string;
}

export function can(principal: Principal | null, permission: Permission): boolean {
  if (!principal) return false;
  return ROLE_PERMISSIONS[principal.role].includes(permission);
}

export function canAny(principal: Principal | null, permissions: Permission[]): boolean {
  return permissions.some((p) => can(principal, p));
}

/** Throwing form, for route handlers and server components. */
export class ForbiddenError extends Error {
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = 'ForbiddenError';
  }
}

export function require_(principal: Principal | null, permission: Permission): void {
  if (!can(principal, permission)) throw new ForbiddenError(permission);
}

/* ------------------------------------------------- object-level guards -- */

/** Is this principal a named party to the escrow, in any capacity? */
export function isParty(principal: Principal, tx: Transaction): boolean {
  return (
    tx.buyerId === principal.userId ||
    tx.sellerId === principal.userId ||
    tx.arbitratorId === principal.userId
  );
}

/**
 * Read access to one escrow. A party sees its own; an arbitrator and an
 * administrator see any, because both need the complete record to do their job
 * (Section 3.5.1: arbitrators require the full immutable history).
 */
export function canReadEscrow(principal: Principal | null, tx: Transaction): boolean {
  if (!principal) return false;
  if (can(principal, 'escrow:read:any')) return true;
  return can(principal, 'escrow:read:own') && isParty(principal, tx);
}

/** `confirmDelivery` — buyer only, and only from INITIATED. */
export function canConfirmDelivery(principal: Principal | null, tx: Transaction): boolean {
  if (!principal || !can(principal, 'escrow:confirm-delivery')) return false;
  return tx.buyerId === principal.userId && tx.state === 'INITIATED';
}

/** `claimRefund` — buyer only, from INITIATED, after the holding period. */
export function canClaimRefund(principal: Principal | null, tx: Transaction, now: number): boolean {
  if (!principal || !can(principal, 'escrow:claim-refund')) return false;
  return (
    tx.buyerId === principal.userId &&
    tx.state === 'INITIATED' &&
    Date.parse(tx.holdingPeriodEndsAt) <= now
  );
}

/** Release after the time lock — seller only, from DELIVERED, lock elapsed. */
export function canWithdraw(
  principal: Principal | null, tx: Transaction, timeLockHours: number, now: number,
): boolean {
  if (!principal || !can(principal, 'escrow:withdraw')) return false;
  if (tx.sellerId !== principal.userId || tx.state !== 'DELIVERED') return false;
  if (!tx.deliveryConfirmedAt) return false;
  return Date.parse(tx.deliveryConfirmedAt) + timeLockHours * 3_600_000 <= now;
}

/**
 * `initiateDispute` — either party, from INITIATED or DELIVERED.
 * The arbitrator cannot raise a dispute on a case it would then decide.
 */
export function canRaiseDispute(principal: Principal | null, tx: Transaction): boolean {
  if (!principal || !can(principal, 'dispute:raise')) return false;
  const isBuyerOrSeller = tx.buyerId === principal.userId || tx.sellerId === principal.userId;
  const disputableStates: EscrowState[] = ['INITIATED', 'DELIVERED'];
  return isBuyerOrSeller && disputableStates.includes(tx.state);
}

/** Which side of the dispute this principal would be filing as. */
export function disputeRoleOf(principal: Principal, tx: Transaction): 'buyer' | 'seller' | null {
  if (tx.buyerId === principal.userId) return 'buyer';
  if (tx.sellerId === principal.userId) return 'seller';
  return null;
}

/** `resolveDispute` — the designated arbitrator of that escrow, once only. */
export function canResolveDispute(
  principal: Principal | null, tx: Transaction, dispute: Dispute,
): boolean {
  if (!principal || !can(principal, 'dispute:resolve')) return false;
  return (
    tx.arbitratorId === principal.userId &&
    dispute.arbitratorId === principal.userId &&
    tx.state === 'DISPUTED' &&
    !dispute.resolvedAt
  );
}

/** Escrows this principal is entitled to see in a list view. */
export function visibleEscrows(principal: Principal | null, all: Transaction[]): Transaction[] {
  if (!principal) return [];
  if (can(principal, 'escrow:read:any')) return all;
  return all.filter((tx) => isParty(principal, tx));
}

export function visibleDisputes(
  principal: Principal | null, disputes: Dispute[], all: Transaction[],
): Dispute[] {
  if (!principal) return [];
  if (can(principal, 'dispute:read:any')) return disputes;
  const mine = new Set(visibleEscrows(principal, all).map((t) => t.id));
  return disputes.filter((d) => mine.has(d.transactionId));
}

/* ------------------------------------------------------ route admission -- */

/**
 * Route → permission required to enter it. The proxy reads this to reject
 * unauthorised navigation before the page renders; the page then repeats the
 * check server-side, because an optimistic cookie check is not authorisation.
 */
export const ROUTE_PERMISSIONS: { prefix: string; permission: Permission }[] = [
  { prefix: '/escrows/new', permission: 'escrow:create' },
  { prefix: '/disputes',    permission: 'dispute:read:any' },
  { prefix: '/admin/settings', permission: 'admin:settings:read' },
  { prefix: '/admin/model',    permission: 'admin:model:read' },
  { prefix: '/admin/audit',    permission: 'admin:audit:read' },
  { prefix: '/admin',          permission: 'admin:settings:read' },
];

/** Longest matching prefix wins, so /admin/model is not shadowed by /admin. */
export function permissionForRoute(pathname: string): Permission | null {
  const match = ROUTE_PERMISSIONS
    .filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match?.permission ?? null;
}

/** Where a role should land after signing in. */
export function homeFor(role: Role): string {
  switch (role) {
    case 'arbitrator': return '/disputes';
    case 'admin':      return '/admin';
    default:           return '/escrows';
  }
}
