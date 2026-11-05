/**
 * The seam between the presentation layer and the application/intelligence
 * layer (Section 3.7).
 *
 * Every function below names the FastAPI endpoint it will call once the backend
 * exists. Until `NEXT_PUBLIC_API_URL` is set, each falls back to the local
 * deterministic engine and reports `source: 'simulated'` so the interface can
 * label unbacked figures instead of presenting them as measurements.
 *
 * Swapping to the real service should not require touching any component.
 */

import { scoreTransaction, type ScoringInput, type ScoringResult } from './engine';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/** True when a real application/intelligence layer is configured. */
export const isBackendConfigured = () => API_BASE.length > 0;

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  // Same-origin proxy: the session cookie carries the credentials, so the browser
  // never holds the service's token and no CORS exception is needed.
  const res = await fetch(`/api/backend${path.replace(/^\/api\/v1/, '')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`${path} failed`, res.status);
  return res.json() as Promise<T>;
}

/**
 * `POST /api/v1/risk/score` — FastAPI inference endpoint (Section 3.10.2).
 *
 * Budget is 2000 ms end to end (NFR-01). On failure the caller decides what to
 * do; Section 3.7.1 requires graceful degradation to manual review rather than
 * a hard block, and Section 3.15.2 requires that no automated fund release
 * follow a failed or malformed inference.
 */
export async function requestRiskScore(input: ScoringInput): Promise<ScoringResult> {
  if (!isBackendConfigured()) {
    // Local stand-in. A short delay keeps the loading state honest in the UI.
    await new Promise((r) => setTimeout(r, 420));
    return scoreTransaction(input);
  }
  const wire = await post<{
    riskScore: number; latencyMs: number;
    contributions: { feature: string; value: number | null; importance: number }[];
  }>('/api/v1/risk/score', {
    amountEth: input.amountEth, sellerId: input.sellerId, accountAgeDays: input.accountAgeDays,
    velocity24h: input.velocity24h, counterpartyReputation: input.counterpartyReputation,
    sellerDisputeRate: input.sellerDisputeRate, buyerDisputeRate: input.buyerDisputeRate,
    deviceConsistent: input.deviceConsistent, highRiskGeo: input.highRiskGeo, offHours: input.offHours,
    meanAmount30d: input.meanAmount30d, accountBalanceEth: input.accountBalanceEth ?? 12, channel: input.channel,
  });
  return {
    riskScore: wire.riskScore, latencyMs: wire.latencyMs, source: 'model',
    contributions: wire.contributions.map((c) => ({
      feature: c.feature, value: c.value === null ? 'n/a' : String(c.value), contribution: c.importance,
    })),
  };
}

/**
 * Endpoints the oracle/integration and blockchain layers will expose.
 * Declared here so the shape of the backend contract is settled before it is
 * written, and so every call site is already routed through one module.
 */
export const ENDPOINTS = {
  scoreRisk:        'POST /api/v1/risk/score',
  createEscrow:     'POST /api/v1/escrows',
  listEscrows:      'GET  /api/v1/escrows',
  getEscrow:        'GET  /api/v1/escrows/{id}',
  confirmDelivery:  'POST /api/v1/escrows/{id}/confirm-delivery',
  initiateDispute:  'POST /api/v1/escrows/{id}/dispute',
  resolveDispute:   'POST /api/v1/escrows/{id}/resolve',
  claimRefund:      'POST /api/v1/escrows/{id}/refund',
  auditLog:         'GET  /api/v1/audit',
  settings:         'GET/PUT /api/v1/admin/settings',
  modelCard:        'GET  /api/v1/model',
  health:           'GET  /api/v1/health',
} as const;
