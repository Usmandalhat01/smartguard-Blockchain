# Generation of simulated escrow proxy features

Produced by `smartguard_ml/features.py`. This file is generated, not
written by hand, so it cannot drift from the code that draws the values.

**Random seed** `20260909` (from `config.yaml`, key `seed`)

**Generator** `numpy.random.default_rng(seed)` — PCG64. A single
generator draws every proxy in the order listed below, so the sequence is
reproducible only if that order is preserved.

## What these variables are, and are not

PaySim carries no escrow context: it has no notion of a counterparty
reputation, a device fingerprint or a dispute. The variables below are
introduced to represent that context so the escrow-oriented feature set
can be evaluated at prototype level.

They are **not** observations of real escrow users, and results obtained
with them do not transfer to genuine escrow data. They are drawn
conditionally on the PaySim fraud label: a proxy drawn independently of
the label would carry no signal and make the feature set meaningless,
while one drawn deterministically from it would leak the answer. The
distributions below overlap substantially, so no single proxy separates
the classes on its own.

## Distributions

| # | Feature | Type | Distribution |
| - | ------- | ---- | ------------ |
| 6 | `geographic_risk` | int8 | Bernoulli(p=0.34) for fraudulent rows, Bernoulli(p=0.11) otherwise. |
| 7 | `counterparty_reputation` | float32 | Beta(a=2.0, b=5.0) for fraudulent rows, Beta(a=9.0, b=1.6) otherwise, clipped to [0, 1]. |
| 9 | `device_consistency` | int8 | Bernoulli(p=0.55) for fraudulent rows, Bernoulli(p=0.94) otherwise. |
| 10 | `account_age_days` | int16 | Gamma(shape=1.4, scale=40) for fraudulent rows, Gamma(shape=4.0, scale=110) otherwise; rounded, clipped to [0, 1825]. |
| 12 | `prior_dispute_rate` | float32 | Beta(a=2.2, b=8.0) for fraudulent rows, Beta(a=1.0, b=32.0) otherwise. |
| 13 | `seller_dispute_rate` | float32 | Beta(a=2.6, b=7.0) for fraudulent rows, Beta(a=1.0, b=26.0) otherwise. |
| 16 | `prior_completed_rate` | float32 | Beta(a=5.0, b=2.4) for fraudulent rows, Beta(a=14.0, b=1.5) otherwise. |

## Construction rules for every feature

| # | Feature | Provenance | Rule |
| - | ------- | ---------- | ---- |
| 1 | `transaction_amount` | original | PaySim `amount`, used as a synthetic transaction-value proxy. Not an observed Ether-denominated value. |
| 2 | `amount_deviation` | derived | x_i - mu_30d, where mu_30d is the originating account's mean amount over the preceding 720 simulation steps (30 days). |
| 3 | `velocity_24h` | derived | Count of transactions from the same originating account within the preceding 24 simulation steps. |
| 4 | `velocity_7d` | derived | Count of transactions from the same originating account within the preceding 168 simulation steps. |
| 5 | `velocity_30d` | derived | Count of transactions from the same originating account within the preceding 720 simulation steps. |
| 6 | `geographic_risk` | simulated | 1 when the transaction's IP geolocation resolves to a jurisdiction classified as high risk, else 0. |
| 7 | `counterparty_reputation` | simulated | Transactions completed without dispute divided by total transactions for the destination account. Range 0-1. |
| 8 | `office_hours_indicator` | derived | 1 when the simulation step falls in hours 23:00-05:00 of its day, computed as (step mod 24) >= 23 or < 5. |
| 9 | `device_consistency` | simulated | 1 when user-agent and client TLS fingerprint match the account's historical session profile, 0 on mismatch. |
| 10 | `account_age_days` | simulated | Days elapsed from wallet registration to this transaction. |
| 11 | `transaction_channel` | derived | 1 for the mobile application, 0 for the web interface. Assigned by hashing the originating account id, so it is stable per account. |
| 12 | `prior_dispute_rate` | simulated | Transactions previously disputed by the originating account divided by its total historical transactions. |
| 13 | `seller_dispute_rate` | simulated | Disputes raised against the destination account divided by its total fulfilled transactions. |
| 14 | `amount_rounded` | derived | 1 when `amount` is an exact integer multiple of 1000, else 0. |
| 15 | `transaction_type` | original | Operation type, ordered by empirical fraud rate over the full dataset: 2 for TRANSFER (0.769% fraudulent), 1 for CASH_OUT (0.184%), 0 for PAYMENT, CASH_IN and DEBIT (0.000% — PaySim cannot label these positive). The ordering is monotone in fraud propensity, so the single ordinal column is usable by the linear comparators as well as by the tree ensembles. |
| 16 | `prior_completed_rate` | simulated | Settled transactions divided by lifetime transactions for the originating account. |
| 17 | `amount_to_account_ratio` | derived | amount / (oldbalanceOrg + 1), the transaction's size relative to the originating account's balance before it. |
| 18 | `step_time` | original | The raw PaySim simulation step, representing elapsed simulation hour (1-744). |

## Reproducing this dataset

```bash
make features        # or: python -m smartguard_ml.build_features
```

The output is byte-identical for a given seed, PaySim file and code
version. If it is not, one of those three has changed.
