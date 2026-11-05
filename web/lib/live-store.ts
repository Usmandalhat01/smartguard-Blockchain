'use client';

/**
 * The live data layer: escrows, disputes and audit read from the FastAPI
 * service, which in turn mirrors the contracts' events.
 *
 * Same shape as the demonstration store so components do not branch on mode.
 * State changes that only a party's wallet may make are sent as contract calls;
 * the service learns of them from the logs (chain_sync), so after sending one
 * this store polls until the record reflects it instead of assuming success.
 */

import {
  call, fetchAdminAudit, fetchChainInfo, fetchCounterparties, fetchEscrowAudit, fetchEscrows,
  fetchSettings, mapAudit, mapEscrow, LiveError, type ChainInfo, type WireEscrow,
} from './live';
import { connect, sendEscrowCall, type OnChainParams } from './wallet';
import { DEFAULT_SETTINGS, type AuditEntry, type Dispute, type SystemSettings, type Transaction, type User } from './types';

export interface LiveState {
  transactions: Transaction[];
  disputes: Dispute[];
  audit: AuditEntry[];
  settings: SystemSettings;
  users: User[];
  chain: ChainInfo;
  hydrated: boolean;
  error: string | null;
  /** UUID by reference, for joining audit rows (keyed by UUID) to escrows. */
  uuids: Record<string, string>;
}

const EMPTY: LiveState = {
  transactions: [], disputes: [], audit: [], settings: DEFAULT_SETTINGS, users: [],
  chain: { enabled: false }, hydrated: false, error: null, uuids: {},
};

let state: LiveState = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let refreshing = false;
let isAdmin = false;

const set = (patch: Partial<LiveState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export const getSnapshot = () => state;
export const getServerSnapshot = () => EMPTY;

export function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    void refresh();
    timer = setInterval(() => void refresh(), 8000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

export function setRole(role: string) { isAdmin = role === 'admin'; }

export async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [escrows, settings, chain] = await Promise.all([
      fetchEscrows(), fetchSettings(), state.chain.enabled || !state.hydrated ? fetchChainInfo() : Promise.resolve(state.chain),
    ]);
    const mapped = escrows.map(mapEscrow);
    const uuids: Record<string, string> = {};
    const refByUuid = new Map<string, string>();
    mapped.forEach((m) => { uuids[m.tx.id] = m.uuid; refByUuid.set(m.uuid, m.tx.id); });

    const trails = await Promise.all(escrows.map((e) => fetchEscrowAudit(e.reference).catch(() => [])));
    const admin = isAdmin ? await fetchAdminAudit().catch(() => []) : [];
    const seen = new Set<string>();
    const audit = [...admin, ...trails.flat()]
      .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
      .map((a) => mapAudit(a, refByUuid))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const users = new Map<string, User>();
    mapped.forEach((m) => m.users.forEach((u) => users.set(u.id, u)));

    set({
      transactions: mapped.map((m) => m.tx), disputes: mapped.flatMap((m) => (m.dispute ? [m.dispute] : [])),
      audit, users: [...users.values()], chain, uuids,
      // On chain, the contract's timings are the ones that bind.
      settings: chain.enabled && chain.timeLockSeconds !== undefined
        ? { ...settings, timeLockHours: chain.timeLockSeconds / 3600, holdingPeriodHours: (chain.holdingPeriodSeconds ?? 0) / 3600 }
        : settings, hydrated: true, error: null,
    });
  } catch (error) {
    set({ hydrated: true, error: error instanceof Error ? error.message : 'The application service did not answer.' });
  } finally {
    refreshing = false;
  }
}

/** Polls until `done` is true of the refreshed state, or gives up. */
async function until(done: (s: LiveState) => boolean, seconds = 120) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await refresh();
    if (done(state)) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

const find = (id: string) => state.transactions.find((t) => t.id === id);

export const counterparties = () => fetchCounterparties();

export async function createEscrow(body: unknown): Promise<{ transaction: Transaction; params?: OnChainParams }> {
  const created = await call<WireEscrow>('POST', '/escrows', body);
  await refresh();
  const tx = find(created.reference) ?? mapEscrow(created).tx;
  const params = state.chain.enabled ? await call<OnChainParams>('GET', `/escrows/${tx.id}/onchain`) : undefined;
  return { transaction: tx, params };
}

async function onchain(txId: string) {
  return call<OnChainParams>('GET', `/escrows/${txId}/onchain`);
}

/** Sends the buyer's deposit and waits until the service has recorded it. */
export async function deposit(txId: string, params: OnChainParams) {
  const account = await connect(params.chainId);
  await sendEscrowCall(account, { kind: 'deposit', params });
  await until((s) => s.audit.some((a) => a.transactionId === txId && a.eventType === 'chain.FundsDeposited'));
}

type Kind = 'confirm' | 'release' | 'dispute' | 'refund';

async function wallet(txId: string, kind: Kind, offChainPath: string, offChainBody: unknown, done: (t: Transaction) => boolean) {
  if (!state.chain.enabled) {
    await call('POST', `/escrows/${txId}/${offChainPath}`, offChainBody);
    await refresh();
    return;
  }
  const params = await onchain(txId);
  const account = await connect(params.chainId);
  await sendEscrowCall(account, { kind, params });
  await until((s) => { const t = s.transactions.find((x) => x.id === txId); return !!t && done(t); });
}

export const confirmDelivery = (id: string) =>
  wallet(id, 'confirm', 'confirm-delivery', undefined, (t) => t.state !== 'INITIATED');
export const releaseAfterTimeLock = (id: string) =>
  wallet(id, 'release', 'withdraw', undefined, (t) => t.state === 'COMPLETED');
export const claimRefund = (id: string) =>
  wallet(id, 'refund', 'refund', undefined, (t) => t.state === 'COMPLETED');
export const initiateDispute = (id: string, _role: 'buyer' | 'seller', reason: string) =>
  wallet(id, 'dispute', 'dispute', { reason }, (t) => t.state === 'DISPUTED');

export async function resolveDispute(id: string, forSeller: boolean, note: string) {
  if (!state.chain.enabled) {
    await call('POST', `/escrows/${id}/resolve`, { releaseToSeller: forSeller, note });
    await refresh();
    return;
  }
  const params = await onchain(id);
  const account = await connect(params.chainId);
  await sendEscrowCall(account, { kind: 'resolve', params, releaseToSeller: forSeller });
  await until((s) => s.transactions.find((x) => x.id === id)?.state === 'COMPLETED');
}

export async function updateSettings(patch: Partial<SystemSettings>) {
  await call('PUT', '/admin/settings', patch);
  await refresh();
}

export async function linkWallet(address: string, signature: string) {
  return call<{ walletAddress: string }>('PUT', '/auth/wallet', { address, signature });
}

export { LiveError };
