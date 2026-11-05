'use client';

/**
 * Live data: the FastAPI service as the source, through /api/backend.
 *
 * Maps the service's camelCase responses onto the domain types the interface
 * already renders, so components do not know which mode they are in.
 */

import type {
  AuditEntry, Dispute, EscrowState, FraudPrediction, Outcome, Role, SystemSettings,
  Transaction, User,
} from './types';

export class LiveError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const detail = (json as { detail?: unknown; error?: string } | null);
    const message = typeof detail?.detail === 'string' ? detail.detail : detail?.error ?? `Request failed (${res.status})`;
    throw new LiveError(message, res.status);
  }
  return json as T;
}

/* ---------------------------------------------------------- wire types -- */

interface Party { id: string; displayName: string; walletAddress: string }
interface WirePrediction {
  riskScore: number; modelVersion: string; thresholdAtScoring: number; latencyMs: number;
  predictedAt: string; contributions: { feature: string; value: number | null; importance: number }[];
}
interface WireDispute {
  id: string; reference: string; transactionId: string; raisedByRole: Role; reason: string;
  raisedAt: string; resolutionForSeller: boolean | null; resolutionNote: string | null; resolvedAt: string | null;
}
export interface WireEscrow {
  id: string; reference: string; escrowId: string; amountEth: number; itemDescription: string;
  state: EscrowState; outcome: string | null; createdAt: string;
  deliveryConfirmedAt: string | null; completedAt: string | null; holdingPeriodEndsAt: string;
  buyer: Party; seller: Party; arbitrator: Party; prediction: WirePrediction | null;
  permittedActions: string[]; dispute: WireDispute | null;
}
interface WireAudit {
  id: string; transactionId: string | null; layer: AuditEntry['layer']; eventType: string; summary: string;
  actorAddress: string | null; txHash: string | null; gasUsed: number | null; blockNumber: number | null; createdAt: string;
}

const OUTCOME: Record<string, Outcome> = {
  released_to_seller: 'released_to_seller', resolved_for_seller: 'resolved_for_seller',
  resolved_for_buyer: 'resolved_for_buyer', timeout_refund: 'timeout_refund',
};

export interface Mapped { tx: Transaction; dispute?: Dispute; users: User[]; uuid: string }

export function mapEscrow(e: WireEscrow): Mapped {
  const id = e.reference;
  const p = e.prediction;
  const prediction: FraudPrediction = {
    id: `pred-${id}`, transactionId: id,
    riskScore: p?.riskScore ?? 0, modelVersion: p?.modelVersion ?? 'unknown',
    thresholdAtScoring: p?.thresholdAtScoring ?? 0, latencyMs: p?.latencyMs ?? 0,
    predictedAt: p?.predictedAt ?? e.createdAt,
    topContributions: (p?.contributions ?? []).map((c) => ({
      feature: c.feature, value: c.value === null ? 'n/a' : String(c.value), contribution: c.importance,
    })),
  };
  const tx: Transaction = {
    id, onChainId: Number.parseInt(e.reference.replace(/\D/g, ''), 10) || 0,
    buyerId: e.buyer.id, sellerId: e.seller.id, arbitratorId: e.arbitrator.id,
    amountEth: e.amountEth, itemDescription: e.itemDescription, state: e.state,
    outcome: e.outcome ? OUTCOME[e.outcome] : undefined,
    createdAt: e.createdAt, deliveryConfirmedAt: e.deliveryConfirmedAt ?? undefined,
    completedAt: e.completedAt ?? undefined, holdingPeriodEndsAt: e.holdingPeriodEndsAt, prediction,
  };
  const d = e.dispute;
  const dispute: Dispute | undefined = d ? {
    id: d.reference, transactionId: id, raisedByRole: d.raisedByRole as 'buyer' | 'seller',
    reason: d.reason, raisedAt: d.raisedAt, arbitratorId: e.arbitrator.id,
    resolutionForSeller: d.resolutionForSeller ?? undefined,
    resolutionNote: d.resolutionNote ?? undefined, resolvedAt: d.resolvedAt ?? undefined,
  } : undefined;
  const user = (p: Party, role: Role): User => ({ id: p.id, walletAddress: p.walletAddress, role, displayName: p.displayName, createdAt: e.createdAt });
  return { tx, dispute, uuid: e.id, users: [user(e.buyer, 'buyer'), user(e.seller, 'seller'), user(e.arbitrator, 'arbitrator')] };
}

export function mapAudit(a: WireAudit, referenceByUuid: Map<string, string>): AuditEntry {
  return {
    id: a.id, transactionId: a.transactionId ? referenceByUuid.get(a.transactionId) : undefined,
    layer: a.layer, eventType: a.eventType, summary: a.summary,
    actorAddress: a.actorAddress ?? undefined, txHash: a.txHash ?? undefined,
    gasUsed: a.gasUsed ?? undefined, blockNumber: a.blockNumber ?? undefined, createdAt: a.createdAt,
  };
}

export const fetchEscrows = () => call<WireEscrow[]>('GET', '/escrows');
export const fetchEscrowAudit = (ref: string) => call<WireAudit[]>('GET', `/escrows/${ref}/audit`);
export const fetchAdminAudit = () => call<WireAudit[]>('GET', '/admin/audit?limit=300');
export const fetchSettings = () => call<SystemSettings>('GET', '/admin/public-settings');
export const fetchCounterparties = () => call<Party[]>('GET', '/escrows/counterparties');

export interface ChainInfo {
  enabled: boolean; chainId?: number; network?: string;
  escrowContract?: string; riskOracleContract?: string; oracleOperator?: string;
  timeLockSeconds?: number; holdingPeriodSeconds?: number;
}
export const fetchChainInfo = () => call<ChainInfo>('GET', '/chain/info');
