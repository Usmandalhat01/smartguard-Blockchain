/**
 * The eighteen-feature vector — Table 3.4 (Section 3.12.4).
 *
 * Provenance categories are reproduced verbatim from the report because the
 * distinction matters to the evaluation: only `original` features come from
 * PaySim itself, `derived` are computed from PaySim fields, and `simulated`
 * are proxies introduced to represent escrow context PaySim does not carry.
 *
 * Section 3.12.5 records that the generation procedure for the simulated
 * proxies was not retained, which is why every simulated feature carries a
 * `caveat` the interface surfaces rather than hides.
 */

export type Provenance = 'original' | 'derived' | 'simulated';

export interface FeatureDef {
  /** Stable key used in FeatureContribution.feature and in the API payload. */
  key: string;
  /** Ordinal in Table 3.4, kept so the UI can present them in report order. */
  index: number;
  label: string;
  dataType: 'continuous' | 'integer' | 'binary' | 'categorical';
  provenance: Provenance;
  /** Construction rule, condensed from Table 3.4. */
  rule: string;
  /** Only set for simulated proxies. */
  caveat?: string;
}

export const PROVENANCE_META: Record<
  Provenance,
  { label: string; tone: 'chain' | 'brand' | 'elevated'; note: string }
> = {
  original: {
    label: 'Original PaySim variable',
    tone: 'chain',
    note: 'Taken directly from the published PaySim dataset.',
  },
  derived: {
    label: 'Derived variable',
    tone: 'brand',
    note: 'Computed from PaySim fields by the preprocessing pipeline.',
  },
  simulated: {
    label: 'Simulated proxy',
    tone: 'elevated',
    note:
      'Introduced to represent escrow context absent from PaySim. Not an observed property of a real escrow user.',
  },
};

const SIM_CAVEAT =
  'Simulated proxy. Section 3.12.5 records that the row-level generation procedure and random seed were not retained for the reported run.';

export const FEATURE_SET: FeatureDef[] = [
  {
    key: 'transaction_amount',
    index: 1,
    label: 'Transaction amount',
    dataType: 'continuous',
    provenance: 'original',
    rule:
      'The PaySim `amount` column, used as a synthetic transaction-value proxy. Not an observed Ether-denominated value.',
  },
  {
    key: 'amount_deviation',
    index: 2,
    label: 'Amount deviation',
    dataType: 'continuous',
    provenance: 'derived',
    rule: "xᵢ − μ₃₀d — this amount less the buyer's mean amount over the preceding 30 days.",
  },
  {
    key: 'velocity_24h',
    index: 3,
    label: 'Velocity (24h)',
    dataType: 'integer',
    provenance: 'derived',
    rule: 'Initiation attempts from the sender address in the preceding 24-hour window.',
  },
  {
    key: 'velocity_7d',
    index: 4,
    label: 'Velocity (7d)',
    dataType: 'integer',
    provenance: 'derived',
    rule: 'Initiation attempts from the sender address in the preceding 7-day window.',
  },
  {
    key: 'velocity_30d',
    index: 5,
    label: 'Velocity (30d)',
    dataType: 'integer',
    provenance: 'derived',
    rule: 'Initiation attempts from the sender address in the preceding 30-day window.',
  },
  {
    key: 'geographic_risk',
    index: 6,
    label: 'Geographic risk',
    dataType: 'binary',
    provenance: 'simulated',
    rule: '1 when IP geolocation resolves to a jurisdiction classified as high risk, otherwise 0.',
    caveat: SIM_CAVEAT,
  },
  {
    key: 'counterparty_reputation',
    index: 7,
    label: 'Counterparty reputation',
    dataType: 'continuous',
    provenance: 'simulated',
    rule: 'Transactions completed without dispute ÷ total transactions. Range 0–1.',
    caveat: SIM_CAVEAT,
  },
  {
    key: 'office_hours_indicator',
    index: 8,
    label: 'Off-hours indicator',
    dataType: 'binary',
    provenance: 'derived',
    rule: '1 when the transaction timestamp falls between 23:00 and 05:00 local time, otherwise 0.',
  },
  {
    key: 'device_consistency',
    index: 9,
    label: 'Device consistency',
    dataType: 'binary',
    provenance: 'simulated',
    rule: '1 when user-agent and client TLS fingerprint match the historical session profile, 0 on mismatch.',
    caveat: SIM_CAVEAT,
  },
  {
    key: 'account_age_days',
    index: 10,
    label: 'Account age (days)',
    dataType: 'integer',
    provenance: 'simulated',
    rule: 'Days elapsed from wallet registration to this initiation.',
    caveat: SIM_CAVEAT,
  },
  {
    key: 'transaction_channel',
    index: 11,
    label: 'Transaction channel',
    dataType: 'categorical',
    provenance: 'derived',
    rule: 'One-hot indicator for web interface versus mobile application.',
  },
  {
    key: 'prior_dispute_rate',
    index: 12,
    label: 'Buyer dispute rate',
    dataType: 'continuous',
    provenance: 'simulated',
    rule: "Transactions previously disputed by the buyer ÷ the buyer's total historical transactions.",
    caveat: SIM_CAVEAT,
  },
  {
    key: 'seller_dispute_rate',
    index: 13,
    label: 'Seller dispute rate',
    dataType: 'continuous',
    provenance: 'simulated',
    rule: 'Disputes raised against the seller ÷ the seller’s total fulfilled transactions.',
    caveat: SIM_CAVEAT,
  },
  {
    key: 'amount_rounded',
    index: 14,
    label: 'Round amount',
    dataType: 'binary',
    provenance: 'derived',
    rule: '1 when the amount is an integer multiple of 1.0 Ether, otherwise 0.',
  },
  {
    key: 'transaction_type',
    index: 15,
    label: 'Transaction type',
    dataType: 'categorical',
    provenance: 'original',
    rule: 'One-hot indicator of the PaySim operation type (TRANSFER or CASH_OUT).',
  },
  {
    key: 'prior_completed_rate',
    index: 16,
    label: 'Completion rate',
    dataType: 'continuous',
    provenance: 'simulated',
    rule: 'Settled transactions ÷ lifetime transactions for the buyer wallet.',
    caveat: SIM_CAVEAT,
  },
  {
    key: 'amount_to_account_ratio',
    index: 17,
    label: 'Amount / account ratio',
    dataType: 'continuous',
    provenance: 'derived',
    rule: 'This amount ÷ total historical transacted volume on the account.',
  },
  {
    key: 'step_time',
    index: 18,
    label: 'Step (simulation hour)',
    dataType: 'integer',
    provenance: 'original',
    rule: 'The raw PaySim simulation time step, representing elapsed simulation hour (1…744).',
  },
];

export const FEATURE_BY_KEY: Record<string, FeatureDef> = Object.fromEntries(
  FEATURE_SET.map((f) => [f.key, f]),
);

export function featureLabel(key: string): string {
  return FEATURE_BY_KEY[key]?.label ?? key;
}

/**
 * Gini importances as reported in Figure 4.4.  Chapter Four states the
 * serialised model and training log were not retained, so these are shown as
 * *previously reported* values and labelled that way at every call site.
 */
export const REPORTED_IMPORTANCE: { key: string; importance: number }[] = [
  { key: 'counterparty_reputation', importance: 0.187 },
  { key: 'prior_dispute_rate',      importance: 0.146 },
  { key: 'amount_deviation',        importance: 0.112 },
  { key: 'velocity_24h',            importance: 0.094 },
  { key: 'seller_dispute_rate',     importance: 0.081 },
  { key: 'account_age_days',        importance: 0.073 },
  { key: 'prior_completed_rate',    importance: 0.065 },
  { key: 'velocity_7d',             importance: 0.052 },
  { key: 'transaction_amount',      importance: 0.048 },
  { key: 'device_consistency',      importance: 0.041 },
];
