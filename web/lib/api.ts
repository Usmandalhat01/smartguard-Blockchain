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
  const res = await fetch(`${API_BASE}${path}`, {
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
  const result = await post<Omit<ScoringResult, 'source'>>('/api/v1/risk/score', input);
  return { ...result, source: 'model' };
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
