/**
 * The client-side data layer, as a plain observable store outside React.
 *
 * This holds what the FastAPI service plus PostgreSQL will hold once the
 * backend exists: escrows, predictions, disputes, the audit log and the
 * administrator-configurable settings. Keeping it outside React means the
 * browser-storage hydration is not a render-time concern, and it gives the
 * mutations one place to become HTTP calls later.
 */

import { fakeTxHash, gasFor, type ScoringInput } from './engine';
import {
  CONTRACTS, MODEL_VERSION, SEED_AUDIT, SEED_DISPUTES, SEED_TRANSACTIONS, USER_BY_ID,
} from './seed';
import {
  DEFAULT_SETTINGS, REPORTED_GAS,
  type AuditEntry, type Dispute, type FraudPrediction, type SystemSettings, type Transaction,
} from './types';

export interface StoreState {
  transactions: Transaction[];
  disputes: Dispute[];
  audit: AuditEntry[];
  settings: SystemSettings;
  /** Monotonic counters so new records keep looking plausibly on-chain. */
  nextOnChainId: number;
  nextBlock: number;
  /** False until browser storage has been consulted. */
  hydrated: boolean;
}

const SEED_STATE: StoreState = {
  transactions: SEED_TRANSACTIONS,
  disputes: SEED_DISPUTES,
  audit: SEED_AUDIT,
  settings: DEFAULT_SETTINGS,
  nextOnChainId: 43,
  nextBlock: 7_414_900,
  hydrated: false,
};

const STORAGE_KEY = 'smartguard.state.v3';

/* ---------------------------------------------------------- observable -- */

let state: StoreState = SEED_STATE;
const listeners = new Set<() => void>();
let hydrationAttempted = false;

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or blocked storage; the session still works in memory */
  }
}

function setState(next: Partial<StoreState>) {
  state = { ...state, ...next };
  persist();
  emit();
}

/** Restores an in-progress session. Runs once, on first subscription. */
function hydrate() {
  if (hydrationAttempted) return;
  hydrationAttempted = true;

  let restored: StoreState | null = null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoreState;
      if (Array.isArray(parsed?.transactions) && parsed.transactions.length > 0) {
        restored = parsed;
      }
    }
  } catch {
    /* nothing stored, or storage unavailable — the seed is a fine start */
  }

  state = { ...(restored ?? SEED_STATE), hydrated: true };
  emit();
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!hydrationAttempted) {
    // Defer past the render that registered this subscriber.
    queueMicrotask(hydrate);
  }
  return () => listeners.delete(onChange);
}

export const getSnapshot = (): StoreState => state;

/** The server renders the seed with `hydrated: false`, matching first paint. */
export const getServerSnapshot = (): StoreState => SEED_STATE;

export function resetStore() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
  state = { ...SEED_STATE, hydrated: true };
  emit();
}

/* ------------------------------------------------------------- helpers -- */

let auditSeq = 10_000;
const auditId = () => `aud-${++auditSeq}`;

function makeAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): AuditEntry {
  return { ...entry, id: auditId(), createdAt: new Date().toISOString() };
}

function chainAudit(
  txId: string,
  fn: keyof typeof REPORTED_GAS,
  summary: string,
  actorAddress: string,
  blockNumber: number,
): AuditEntry {
  const nonce = `${txId}:${fn}:${blockNumber}`;
  return makeAudit({
    transactionId: txId,
    layer: fn === 'updateRiskScore' ? 'oracle' : 'blockchain',
    eventType: `contract.${fn}`,
    actorAddress,
    summary,
    txHash: fakeTxHash(nonce),
    gasUsed: gasFor(fn, REPORTED_GAS[fn], nonce),
    blockNumber,
  });
}

function patchTransaction(id: string, patch: Partial<Transaction>, audit: AuditEntry[] = []) {
  setState({
    transactions: state.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    audit: [...audit, ...state.audit],
    nextBlock: state.nextBlock + 160,
  });
}

/* ------------------------------------------------------------- actions -- */

export interface NewEscrowInput {
  buyerId: string;
  sellerId: string;
  amountEth: number;
  itemDescription: string;
  scoring: ScoringInput;
  prediction: {
    riskScore: number;
    latencyMs: number;
    contributions: FraudPrediction['topContributions'];
  };
}

/**
 * FR-01 + FR-02. The risk gate has already run by the time this is called —
 * a caller must not reach here with a score above the threshold, because on
 * chain `depositFunds` would revert.
 */
export function createEscrow(input: NewEscrowInput): Transaction {
  const onChainId = state.nextOnChainId;
  const id = `ESC-${1042 + (onChainId - 42)}`;
  const block = state.nextBlock;
  const now = new Date();

  const buyer = USER_BY_ID[input.buyerId];
  const seller = USER_BY_ID[input.sellerId];

  const prediction: FraudPrediction = {
    id: `pred-${id}`,
    transactionId: id,
    riskScore: input.prediction.riskScore,
    modelVersion: MODEL_VERSION,
    thresholdAtScoring: state.settings.riskThreshold,
    latencyMs: input.prediction.latencyMs,
    predictedAt: now.toISOString(),
    topContributions: input.prediction.contributions,
  };

  const transaction: Transaction = {
    id,
    onChainId,
    buyerId: buyer.id,
    sellerId: seller.id,
    arbitratorId: 'u-arb',
    amountEth: input.amountEth,
    itemDescription: input.itemDescription,
    state: 'INITIATED',
    createdAt: now.toISOString(),
    holdingPeriodEndsAt: new Date(
      now.getTime() + state.settings.holdingPeriodHours * 3_600_000,
    ).toISOString(),
    prediction,
  };

  const pct = Math.round(prediction.riskScore * 100);
  const gate = Math.round(state.settings.riskThreshold * 100);

  const audit: AuditEntry[] = [
    makeAudit({
      transactionId: id,
      layer: 'presentation',
      eventType: 'ui.escrow.submit',
      actorAddress: buyer.walletAddress,
      summary: `Buyer submitted an escrow request for ${input.amountEth} ETH to ${seller.displayName}.`,
    }),
    makeAudit({
      transactionId: id,
      layer: 'application',
      eventType: 'ai.inference',
      summary: `Risk score ${prediction.riskScore.toFixed(4)} returned in ${prediction.latencyMs} ms (model ${MODEL_VERSION}).`,
    }),
    chainAudit(id, 'updateRiskScore',
      `Oracle wrote risk score ${pct} to RiskOracleContract for escrow #${onChainId}.`,
      CONTRACTS.oracleOperator, block),
    chainAudit(id, 'depositFunds',
      `${input.amountEth} ETH locked. Risk gate passed: ${pct} ≤ ${gate}. State → INITIATED.`,
      buyer.walletAddress, block + 1),
  ].reverse();

  setState({
    transactions: [transaction, ...state.transactions],
    audit: [...audit, ...state.audit],
    nextOnChainId: onChainId + 1,
    nextBlock: block + 220,
  });

  return transaction;
}

/** FR-03. Starts the time lock; the seller cannot withdraw until it elapses. */
export function confirmDelivery(txId: string) {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;
  const buyer = USER_BY_ID[tx.buyerId];

  patchTransaction(
    txId,
    { state: 'DELIVERED', deliveryConfirmedAt: new Date().toISOString() },
    [chainAudit(txId, 'confirmDelivery',
      `Buyer confirmed receipt. ${state.settings.timeLockHours}-hour time lock started.`,
      buyer.walletAddress, state.nextBlock)],
  );
}

/** Release once the time lock has elapsed without a dispute. */
export function releaseAfterTimeLock(txId: string) {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;
  const seller = USER_BY_ID[tx.sellerId];

  patchTransaction(
    txId,
    { state: 'COMPLETED', outcome: 'released_to_seller', completedAt: new Date().toISOString() },
    [chainAudit(txId, 'confirmDelivery',
      `Time lock elapsed without dispute. ${tx.amountEth} ETH released to ${seller.displayName}. State → COMPLETED.`,
      seller.walletAddress, state.nextBlock)],
  );
}

/** FR-04. Either party may raise a dispute; authority moves to the arbitrator. */
export function initiateDispute(
  txId: string, raisedByRole: 'buyer' | 'seller', reason: string,
) {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;

  const actor = USER_BY_ID[raisedByRole === 'buyer' ? tx.buyerId : tx.sellerId];
  const dispute: Dispute = {
    id: `DSP-${205 + state.disputes.length}`,
    transactionId: txId,
    raisedByRole,
    reason,
    raisedAt: new Date().toISOString(),
    arbitratorId: tx.arbitratorId,
  };

  setState({
    disputes: [dispute, ...state.disputes],
    transactions: state.transactions.map((t) =>
      t.id === txId ? { ...t, state: 'DISPUTED' as const } : t),
    audit: [
      chainAudit(txId, 'initiateDispute',
        `Dispute raised by ${raisedByRole}. Decision authority transferred to arbitrator.`,
        actor.walletAddress, state.nextBlock),
      ...state.audit,
    ],
    nextBlock: state.nextBlock + 110,
  });
}

/** FR-05. `resolveDispute(bool)` — true releases to the seller, false refunds. */
export function resolveDispute(txId: string, forSeller: boolean, note: string) {
  const tx = state.transactions.find((t) => t.id === txId);
  const dispute = state.disputes.find((d) => d.transactionId === txId);
  if (!tx || !dispute) return;

  const arbitrator = USER_BY_ID[tx.arbitratorId];
  const now = new Date().toISOString();

  setState({
    disputes: state.disputes.map((d) =>
      d.id === dispute.id
        ? { ...d, resolutionForSeller: forSeller, resolutionNote: note, resolvedAt: now }
        : d),
    transactions: state.transactions.map((t) =>
      t.id === txId
        ? {
            ...t,
            state: 'COMPLETED' as const,
            outcome: forSeller ? ('resolved_for_seller' as const) : ('resolved_for_buyer' as const),
            completedAt: now,
          }
        : t),
    audit: [
      chainAudit(txId, 'resolveDispute',
        `Arbitrator resolved in favour of the ${forSeller ? 'seller' : 'buyer'}. ${tx.amountEth} ETH ${forSeller ? 'released' : 'refunded'}. State → COMPLETED.`,
        arbitrator.walletAddress, state.nextBlock),
      ...state.audit,
    ],
    nextBlock: state.nextBlock + 120,
  });
}

/** FR-06. Buyer recovers funds after the holding period with no confirmation. */
export function claimRefund(txId: string) {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return;
  const buyer = USER_BY_ID[tx.buyerId];

  patchTransaction(
    txId,
    { state: 'COMPLETED', outcome: 'timeout_refund', completedAt: new Date().toISOString() },
    [chainAudit(txId, 'claimRefund',
      `Holding period elapsed with no delivery confirmation. ${tx.amountEth} ETH refunded to buyer. State → COMPLETED.`,
      buyer.walletAddress, state.nextBlock)],
  );
}

export function updateSettings(patch: Partial<SystemSettings>, actorAddress: string) {
  const described = Object.entries(patch).map(([k, v]) => `${k} → ${String(v)}`).join(', ');
  setState({
    settings: { ...state.settings, ...patch },
    audit: [
      makeAudit({
        layer: 'application',
        eventType: 'admin.settings.update',
        actorAddress,
        summary: `Administrator updated system configuration: ${described}.`,
      }),
      ...state.audit,
    ],
  });
}
