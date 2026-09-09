/**
 * Local stand-in for the FastAPI risk-scoring service (Section 3.10.2).
 *
 * IMPORTANT — this is not the Random Forest model. It is a deterministic
 * heuristic that consumes the same eighteen-feature vector and returns the same
 * response shape, so that the presentation layer can be built and tested before
 * the application/intelligence layer exists. Every score it produces is tagged
 * `source: 'simulated'`, and the interface renders that tag wherever a score
 * appears. When `NEXT_PUBLIC_API_URL` is set the real service answers instead
 * and the tag becomes `'model'`.
 *
 * It is deterministic by construction (seeded PRNG, no Date.now in the scoring
 * path) so that the same input always yields the same score — the reproducibility
 * discipline the evaluation chapter requires.
 */

import type { FeatureContribution } from './types';

/* ------------------------------------------------------------------ prng -- */

/** mulberry32 — small, fast, and fully reproducible from a 32-bit seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, so ids seed the PRNG reproducibly. */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* -------------------------------------------------------------- features -- */

/** The subset of the vector the initiation form collects or infers. */
export interface ScoringInput {
  amountEth: number;
  sellerAddress: string;
  buyerAddress: string;
  /** Days since the buyer wallet was first seen. */
  accountAgeDays: number;
  /** Initiation attempts by this buyer in the last 24h. */
  velocity24h: number;
  /** 0–1, seller's completed-without-dispute ratio. */
  counterpartyReputation: number;
  /** 0–1, disputes previously raised against this seller. */
  sellerDisputeRate: number;
  /** 0–1, disputes previously raised by this buyer. */
  buyerDisputeRate: number;
  /** True when the client fingerprint matches the historical session profile. */
  deviceConsistent: boolean;
  /** True when IP geolocation resolves to a high-risk jurisdiction. */
  highRiskGeo: boolean;
  /** True when initiated between 23:00 and 05:00 local time. */
  offHours: boolean;
  /** Buyer's mean amount over the preceding 30 days, for amount_deviation. */
  meanAmount30d: number;
  channel: 'web' | 'mobile';
}

export interface ScoringResult {
  riskScore: number;
  latencyMs: number;
  contributions: FeatureContribution[];
  source: 'model' | 'simulated';
}

/**
 * Weights approximate the reported Gini ranking in Figure 4.4 so the
 * explanation panel is ordered the way the report's feature-importance analysis
 * is. They are presentation weights, not model coefficients.
 */
const W = {
  counterparty_reputation: 0.30,
  seller_dispute_rate:     0.20,
  amount_deviation:        0.16,
  velocity_24h:            0.13,
  account_age_days:        0.11,
  prior_dispute_rate:      0.10,
  geographic_risk:         0.09,
  device_consistency:      0.08,
  transaction_amount:      0.06,
  office_hours_indicator:  0.03,
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Squash an unbounded risk sum into (0,1) the way a probability output reads. */
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

export function scoreTransaction(input: ScoringInput): ScoringResult {
  const parts: FeatureContribution[] = [];
  const push = (feature: string, value: string, contribution: number) =>
    parts.push({ feature, value, contribution: Number(contribution.toFixed(4)) });

  // Reputation: a clean counterparty pulls the score down, a poor one drives it up.
  const rep = clamp01(input.counterpartyReputation);
  push(
    'counterparty_reputation',
    `${(rep * 100).toFixed(1)}% clean`,
    W.counterparty_reputation * (0.62 - rep) * 2.2,
  );

  const sdr = clamp01(input.sellerDisputeRate);
  push('seller_dispute_rate', `${(sdr * 100).toFixed(1)}%`, W.seller_dispute_rate * (sdr - 0.05) * 3.4);

  const bdr = clamp01(input.buyerDisputeRate);
  push('prior_dispute_rate', `${(bdr * 100).toFixed(1)}%`, W.prior_dispute_rate * (bdr - 0.05) * 3.0);

  // Amount deviation, expressed in multiples of the 30-day mean.
  const base = Math.max(input.meanAmount30d, 0.05);
  const dev = (input.amountEth - base) / base;
  push(
    'amount_deviation',
    `${dev >= 0 ? '+' : ''}${(dev * 100).toFixed(0)}% vs 30d mean`,
    W.amount_deviation * Math.tanh(dev / 2.5) * 2.0,
  );

  // Raw size still carries a little weight, matching its ninth-place ranking.
  push(
    'transaction_amount',
    `${input.amountEth.toFixed(4)} ETH`,
    W.transaction_amount * Math.tanh(input.amountEth / 8) * 1.6,
  );

  // Velocity: bursts of initiation attempts are the classic escrow abuse signal.
  const v = Math.max(0, input.velocity24h);
  push('velocity_24h', `${v} in 24h`, W.velocity_24h * Math.tanh((v - 2) / 3) * 2.2);

  // A young wallet is weak evidence on its own but compounds with the rest.
  const age = Math.max(0, input.accountAgeDays);
  push(
    'account_age_days',
    `${age} day${age === 1 ? '' : 's'}`,
    W.account_age_days * (Math.exp(-age / 45) - 0.25) * 2.6,
  );

  push('geographic_risk', input.highRiskGeo ? 'High-risk jurisdiction' : 'Standard jurisdiction',
    input.highRiskGeo ? W.geographic_risk * 1.9 : -W.geographic_risk * 0.5);

  push('device_consistency', input.deviceConsistent ? 'Matches profile' : 'Fingerprint mismatch',
    input.deviceConsistent ? -W.device_consistency * 0.6 : W.device_consistency * 2.1);

  push('office_hours_indicator', input.offHours ? '23:00–05:00' : 'Standard hours',
    input.offHours ? W.office_hours_indicator * 1.7 : -W.office_hours_indicator * 0.3);

  const sum = parts.reduce((acc, p) => acc + p.contribution, 0);

  // A small deterministic jitter stands in for ensemble variance across the
  // 200 trees. Seeded from the addresses so it never changes for a given pair.
  const rng = makeRng(hashSeed(`${input.buyerAddress}:${input.sellerAddress}:${input.amountEth}`));
  const jitter = (rng() - 0.5) * 0.05;

  const riskScore = Number(clamp01(logistic(sum * 2.6 - 0.55) + jitter).toFixed(4));

  // Inference latency, well inside the 2s NFR-01 budget. Seeded, not random,
  // so a screenshot taken twice shows the same number.
  const latencyMs = Math.round(240 + rng() * 520);

  const contributions = parts
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 6);

  return { riskScore, latencyMs, contributions, source: 'simulated' };
}

/* ---------------------------------------------------------- chain shapes -- */

/** A plausible 32-byte transaction hash, derived from a seed for stability. */
export function fakeTxHash(seed: string): string {
  const rng = makeRng(hashSeed(seed));
  let out = '0x';
  for (let i = 0; i < 64; i++) out += '0123456789abcdef'[Math.floor(rng() * 16)];
  return out;
}

/** A checksummed-looking 20-byte address, derived from a seed. */
export function fakeAddress(seed: string): string {
  const rng = makeRng(hashSeed(seed));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += '0123456789abcDEF'[Math.floor(rng() * 16)];
  return out;
}

/** Gas actually "used" by a call: the reported mean plus seeded variance. */
export function gasFor(fn: string, base: number, seed: string): number {
  const rng = makeRng(hashSeed(`${fn}:${seed}`));
  return Math.round(base * (0.97 + rng() * 0.06));
}
