# Decision log

Every deviation from the specification in Chapters One and Three, with the
reason and the report edit it requires.

The verification review's central finding was that the report and the artefact
had drifted apart. This file exists so that cannot happen silently again: a
decision is recorded here at the moment it is made, and the "Report edit"
column is the checklist for the next revision of the document.

---

## D-001 · Solidity 0.8.19 → 0.8.20

**Status** Applied
**Affects** Table 3.3, Section 3.8, Section 3.15.1

Table 3.3 specifies Solidity 0.8.19 *and* OpenZeppelin Contracts 5.0. These are
mutually exclusive: OpenZeppelin 5.0 declares `pragma solidity ^0.8.20` across
`Ownable`, `ReentrancyGuard` and `Address`, and the compiler refuses the import
at 0.8.19.

0.8.20 is the smallest change that satisfies both. Section 3.15.1's security
argument is that the 0.8.x compiler line provides native integer overflow and
underflow protection, replacing SafeMath — that argument is unaffected by the
patch version.

The alternative was to drop to OpenZeppelin 4.9, but Table 3.3 names 5.0, 4.9 is
superseded, and 5.0's `Ownable(initialOwner)` constructor is the pattern used
throughout the contracts.

**Report edit** In Table 3.3 and Section 3.8, change the Solidity version to
0.8.20 and add a footnote: *"0.8.20 is the minimum version compatible with
OpenZeppelin Contracts 5.0."*

---

## D-002 · React 18.2 → React 19 via Next.js 16 App Router

**Status** Applied
**Affects** Table 3.3, Section 3.7, new Section 3.15.3

Table 3.3 specifies React 18.2. The presentation layer is built on React 19
through the Next.js App Router.

The reason is access control. Section 3.5.1 gives four stakeholder categories
with materially different authority, and FR-03 and FR-05 both make exclusivity
claims ("only the designated buyer", "only the designated arbitrator"). Enforcing
those requires session verification and route admission on the server, before a
page renders. A client-only React bundle can hide a control but cannot refuse a
request, and access control that exists only in the browser is not access
control.

**Report edit** In Table 3.3, record "React 19 via Next.js 16 (App Router)" with
the justification "server-side session verification and route admission required
for role-based access control". Add Section 3.15.3 documenting the role and
permission model.

---

## D-003 · Escrow identifiers are deterministic and client-derived

**Status** Applied
**Affects** Section 3.11.3, Figure 3.7

Section 3.14.2 has the oracle write a risk score against a transaction
identifier, and Section 3.11.3 has `depositFunds` read that score back. The
identifier must therefore exist before either call, but neither section says how
it is allocated.

`EscrowContract.computeEscrowId(buyer, seller, amount, nonce)` derives it as a
`keccak256` hash. It is a `pure` function, so the oracle bridge, the interface
and the contract all compute the same value independently with no round trip and
no allocating transaction.

This matches the sequence Figure 3.7 already draws — score written first, then
`depositFunds` — which the two-phase alternative would have required redrawing.

**Report edit** In Section 3.11.3, state how the escrow identifier is derived.
Figure 3.7 needs no change.

---

## D-004 · A missing risk score is a refusal, not a pass

**Status** Applied
**Affects** Section 3.11.3, Section 3.15.2

`depositFunds` reverts with `NoRiskAssessment` when the oracle holds no score for
the escrow, rather than reading a default of zero and treating it as low risk.

Section 3.15.2 requires the system to fail closed when the model is unavailable
or returns a malformed value. Solidity's default-zero semantics would have made
an absent assessment indistinguishable from the safest possible one, which
inverts that requirement precisely.

**Report edit** In Section 3.11.3, add that `depositFunds` reverts when no
assessment exists, and note it as the on-chain half of the fail-closed
requirement in Section 3.15.2.

---

## D-005 · Risk scores are written once and never amended

**Status** Applied
**Affects** Section 3.14.2

`RiskOracleContract.updateRiskScore` reverts on a second write for the same
escrow.

A mutable score would let a compromised or coerced relay lower an assessment
after an escrow had been refused, and re-submit. Immutability closes that path,
and it is also what makes the on-chain record an audit trail rather than a cache:
the value that governed the contract's behaviour is the value that stays in the
ledger.

**Report edit** In Section 3.14.2, record that assessments are single-write.

---

## D-006 · Slither timestamp findings accepted, with justification

**Status** Accepted, not remediated
**Affects** Section 3.15.1, Appendix A

Slither 0.11.4 reports three findings against the contracts, all from the
`timestamp` detector and all low severity. There are no high or medium severity
findings.

| Location | Comparison |
| -------- | ---------- |
| `EscrowContract.releaseFunds` | `block.timestamp < unlocksAt` |
| `EscrowContract.claimRefund` | `block.timestamp < holdingPeriodEndsAt` |
| `RiskOracleContract.updateRiskScore` | `block.timestamp > expiry` |

The detector flags any dependence on `block.timestamp`, because a validator can
nudge it by a small margin. The relevant question is whether that margin is
material to the comparison, and here it is not: the time lock is 48 hours, the
holding period is seven days, and the oracle expiry window is minutes. A
manipulation of a few seconds cannot change the outcome of any of them.

Rewriting these to block heights would be worse, not better. Block intervals
vary, so a height-based lock would express "roughly 48 hours" less precisely than
a timestamp does, and it would make the interface unable to show a party when
their window actually closes.

**Report edit** Section 3.15.1 currently states that "all high-severity findings
were resolved before deployment". Replace with the specific result: no high or
medium severity findings; three low-severity timestamp-dependence findings
accepted on the grounds above. Attach `docs/evidence/slither-report.txt` to
Appendix A rather than describing it.

---

## D-007 · Python 3.10 → 3.11

**Status** Applied
**Affects** Table 3.3, Section 3.8

Table 3.3 specifies Python 3.10. The pipeline runs on 3.11.16.

The machine available for development carries Python 3.9.6 (Command Line Tools)
and 3.14.7 (Homebrew). Neither is workable: scikit-learn 1.3.2 and numpy 1.26.4
publish no wheels for 3.14, and building numpy from source on a dual-core
machine is not a reasonable step to put in a reproduction guide. 3.9 predates
several typing constructs the pipeline uses.

3.11 is the nearest supported version to the documented 3.10 with complete wheel
coverage for every pinned dependency. The library versions Table 3.3 actually
cites — scikit-learn 1.3, imbalanced-learn 0.11 — are pinned exactly and
unaffected.

**Report edit** In Table 3.3 and Section 3.8, change the Python version to 3.11.

---

## D-008 · Support Vector Machine → linear SVM by stochastic gradient descent

**Status** Applied
**Affects** Section 3.12.3, Section 3.16.3, Section 4.3.4

Section 3.12.3 names Support Vector Machine as one of four comparators. An RBF
`SVC` has training complexity between O(n²) and O(n³) in the number of samples.
On the post-SMOTE training partition of 8,896,170 rows this does not terminate
in any practical time, on any machine available to this project.

The comparator is therefore `SGDClassifier` with hinge loss: the same
margin-based, linear-separator family, fitted by stochastic gradient descent,
which is linear in the number of samples.

Two consequences the report must state rather than hide:

1. The comparison is against a **linear** SVM. It does not establish anything
   about an RBF kernel, which may well perform better.
2. `SGDClassifier` under hinge loss exposes no `predict_proba`. Its decision
   function is min-max scaled into [0, 1] for the ROC curve. That is a monotone
   transform, so ROC-AUC is unaffected, but the values are not probabilities and
   `evaluate.py` records `score_kind: scaled_margin` against them.

**Report edit** In Section 3.12.3, replace "Support Vector Machine represents a
margin-based classifier" with a statement naming the linear SVM and the reason.
In Section 4.3.4, note that the SVM comparator's scores are scaled margins.

---

## D-009 · All five operation types are retained (reversed)

**Status** Reversed on 28 October 2026. No report edit is required.
**Affects** Section 3.13.2, Table 3.5, Table 3.4 (feature 15)

PaySim assigns `isFraud = 1` only to `TRANSFER` and `CASH_OUT` operations, so
the remaining three — `PAYMENT`, `CASH_IN`, `DEBIT` — cannot be positive by
construction. This decision originally filtered them out: roughly 3.5 million
guaranteed-negative rows inflate accuracy toward the majority class.

**Why it was reversed.** The filter changes every row count in Table 3.5, and
the final supervisor corrections reconciled that table by hand. Section 4.3.2
exists *because* an earlier confusion matrix described 1,906,034 observations
instead of the documented 954,393; the correction was to establish one
partition that reconciles. Presenting the department with a third set of
partition counts would re-open the exact defect the correction closed — a worse
outcome than a diluted majority class, particularly since Section 3.16.1
already states that accuracy "is reported for completeness but is not the
primary performance criterion" and that minority-class F1 is the criterion that
counts.

The filter therefore survives as `dataset.restrict_to_fraud_types`, which
defaults to `false`. With it off, the split stage reproduces Table 3.5 exactly,
computed from the saved indices rather than asserted:

| Partition | Legitimate | Fraudulent | Total | Fraud ratio |
|---|---|---|---|---|
| Full dataset | 6,354,407 | 8,213 | 6,362,620 | 0.1291% |
| Training | 4,448,085 | 5,749 | 4,453,834 | 0.1291% |
| Validation | 953,161 | 1,232 | 954,393 | 0.1291% |
| Held-out test | 953,161 | 1,232 | 954,393 | 0.1291% |

SMOTE then resamples the training partition to 8,896,170 rows, which is the
post-oversampling row count Table 3.5 lists as the planned configuration.

**Consequence for feature 15.** `transaction_type` was specified as "1 for
TRANSFER, 0 for CASH_OUT", which only has meaning once the other three types
are gone. It is now an ordinal code over all five, ordered by the fraud rate
each type actually carries across the full dataset — `TRANSFER` 0.769%,
`CASH_OUT` 0.184%, and the other three 0.000%. The ordering is therefore
monotone in fraud propensity rather than arbitrary, which keeps the column
usable by the linear comparators as well as the tree ensembles, and one ordinal
column rather than a one-hot expansion holds the feature count at the eighteen
Section 3.12.4 commits to.

**Report edit** Table 3.4, feature 15: replace the description with the
three-level ordinal code and its fraud rates. Table 3.5 needs no change — the
run now reproduces it.

---

## D-010 · passlib → bcrypt directly

**Status** Applied
**Affects** Table 3.6 (application-layer security controls)

The service originally hashed passwords through `passlib`'s `CryptContext`.
passlib has had no release since 2020 and breaks against bcrypt 5.x: it reads a
private `__about__` attribute that bcrypt removed, then falls through to a code
path that raises on any password over 72 bytes.

Passwords are now hashed with the `bcrypt` package directly, at a work factor of
12, with one addition worth stating: the password is SHA-256 hashed and
base64-encoded before it reaches bcrypt.

bcrypt truncates silently at 72 bytes. Without a pre-hash, a user with a longer
passphrase would have the tail ignored without being told, and two passwords
sharing a 72-byte prefix would collide. The base64 step matters too — a raw
SHA-256 digest can contain a null byte, and bcrypt truncates at the first one.

**Report edit** Table 3.6 does not currently name a password-hashing scheme. Add
one: bcrypt at cost factor 12, with SHA-256 pre-hashing to avoid silent
truncation.

---

## D-011 · python-jose → PyJWT

**Status** Applied
**Affects** Table 3.6

`python-jose[cryptography]` pulls in `cryptography`, which requires a Rust
toolchain to build wherever no wheel matches the platform — as happened on the
development machine here.

Sessions are HS256, which is symmetric: `hmac` and `hashlib` are the whole
requirement. PyJWT implements it in pure Python with no compiled dependency.

Nothing about the token format changes. The presentation layer verifies the same
HS256 signature against the same shared secret.

**Report edit** None required unless Table 3.6 is expanded to name libraries; if
it is, record PyJWT.

---

## D-012 · Train/serve skew in `amount_to_account_ratio`

**Status** Fixed
**Affects** Section 3.12.4, Table 3.4

Found while walking a full escrow lifecycle through the live service. Worth
recording in full, because the report will need to describe how the inference
feature set is kept consistent with the training feature set — and because the
failure mode is invisible.

`ml/smartguard_ml/features.py` builds the feature as:

```python
amount / (oldbalanceOrg + 1.0)      # share of the account's balance moved
```

`api/smartguard_api/features.py` was building it as:

```python
amount / (mean_amount_30d + 1.0)    # multiple of the typical transaction size
```

These are different quantities with different distributions. In training, a
fraudulent row drains the account and the ratio approaches 1.0 — that is the
shape the model learns to read. At inference, a perfectly ordinary 1.5 ETH
request against a 1.6 ETH mean produced 0.94, which the model reads as an
account being almost entirely emptied.

Nothing failed. The endpoint returned 200 with a confident number, and the
number was meaningless. That is the characteristic of train/serve skew and the
reason it survives to production: there is no exception to catch.

**The fix.** `ScoringInput` now carries `accountBalanceEth`, and the ratio is
computed from the balance, as training does. Every feature in the inference
builder now carries the training expression it must reproduce as a comment, and
`api/tests/test_feature_parity.py` asserts the feature list and order match the
pipeline's, pins this specific expression, and checks a full drain still reaches
the range the model was trained on.

**Report edit** Section 3.12.4 should state that the inference-time feature
construction is verified against the training-time construction by test, and
that the request carries the originating account's balance for this reason.

---

## D-013 · Inference-time stand-ins for unobservable features

**Status** Applied, needs stating in the report
**Affects** Section 3.12.4, Section 3.19

Three of the eighteen features cannot be observed at request time and are
approximated. They are listed here because an unexplained constant in a feature
vector is precisely what Section 3.12.5 was faulted for.

| Feature | Training | Inference |
| ------- | -------- | --------- |
| `velocity_7d` | Count over 168 simulation steps | 24-hour count × 4 |
| `velocity_30d` | Count over 720 simulation steps | 24-hour count × 12 |
| `step_time` | PaySim step, 1–744 | Hour of the calendar month, kept in the same range |

There is also a scale conversion. PaySim amounts are in the simulator's currency
units, not Ether; the model learned that scale, so `ETH_TO_PAYSIM_UNITS`
converts before scoring. It is a prototype calibration, not an exchange rate,
and Section 3.12.4 already records PaySim's amount as "a synthetic
transaction-value proxy" rather than an observed Ether value.

**Report edit** Add these three rows and the scale factor to Section 3.12.4, and
list them among the methodological limitations in Section 3.19. A production
system would compute the longer velocity windows from its own transaction
history rather than extrapolating them.

---

## D-014 · Sepolia and the local chain do not charge the same gas

**Status** Measured 28 October 2026
**Affects** Table 4.2, Section 4.4, Section 4.5

`measure-gas.js` carried this reasoning in its header: gas is determined by the
EVM cost schedule and the contract bytecode, not by which network executes it,
so the local figures are the figures Sepolia charges. That is wrong, and the
deployment receipts are what exposed it. `EscrowContract` cost **1,530,188** gas
locally and **10,476,800** on Sepolia, for bytecode Etherscan verified as
byte-identical to the local artefact. Both receipts were confirmed against
Etherscan independently of the RPC provider, so neither figure is a reporting
artefact.

Measuring the live lifecycle separated the operations into two populations.

| Operation | Local | Sepolia | Ratio |
| --------- | ----- | ------- | ----- |
| `confirmDelivery` | 36,861 | 38,061 | 1.03x |
| `initiateDispute` | 36,450 | 37,802 | 1.04x |
| `setRiskThreshold` | 30,104 | 31,304 | 1.04x |
| `resolveDispute` | 51,941 | 62,273 | 1.20x |
| `updateRiskScore` | 99,949 | 365,109 | 3.65x |
| `depositFunds` | 154,875 | 595,275 | 3.84x |

The split is not arbitrary. The three operations that agree to within 4 per cent
write only to storage slots that already hold a value. The two that diverge by
nearly four times are the two that allocate slots which were previously zero —
`updateRiskScore` creates an assessment record, `depositFunds` creates an escrow
record. `resolveDispute` sits between them because it clears state and transfers
value.

`setRiskThreshold` is the control, and `scripts/probe-state-cost.js` is the
experiment: it overwrites a single `uint8` that already holds a value, so it
allocates nothing. It came in at 1.04x. The surcharge is therefore confined to
newly allocated state and is not a wholesale difference in the cost schedule.
Decomposed, Sepolia charges a flat ~1,200 gas more per transaction, plus a large
additional cost per previously-zero storage slot. Contract deployment is the
extreme case of the same thing, which is why it diverges furthest: storing code
is state allocation.

One observation supports the reading directly. The first `updateRiskScore` of
the run cost **463,029** gas and every subsequent one **365,109**, a difference
of 97,920 — that first call is the one that moved `lastNonce` off zero.

**What this means for the report.** Table 4.2 must cite
`docs/evidence/sepolia-measurements.json` for the five operations reachable on a
public chain, because those are what the system actually costs to run.
`releaseFunds` and `claimRefund` sit behind a 48-hour and a seven-day time lock
and cannot be exercised on a chain whose clock cannot be advanced; they remain
local measurements and must be labelled as such. The local harness keeps its
purpose — dispersion across 20 repetitions, and the time-locked paths — but it
is no longer the source for what an operation costs.

**Report edit** Replace Table 4.2 with the Sepolia medians, add a column
recording which network each figure came from, and state the time-lock reason
for the two that could not be measured live. Section 4.5 should name Alchemy as
the provider and quote the measured 9.7–13.4 s submission-to-inclusion latency
from the same record.

**Caution for the viva.** Do not present the local figures as costs on a public
network, and do not reconcile the two by averaging them. They measure the same
bytecode under different state-growth pricing, and the live figure is the one
that answers "what does this cost to operate".

---

## D-015 · The near-perfect accuracy is PaySim's, not the model's

**Status** Measured 28 October 2026
**Affects** Section 3.12.4, Section 3.12.5, Section 3.19, Sections 4.3.1–4.3.5,
Chapter Five

The run reports accuracy 1.0000 and ROC AUC 1.0000 for four of six classifiers,
**logistic regression among them**. A linear model does not separate a hard
problem perfectly, so the figure needed an explanation before it could be
reported. Three measurements, recorded in
`ml/outputs/provenance_analysis.json`, produced one — by way of a wrong answer
that is worth recording, because it is the answer a reader reaches for first.

**The wrong answer.** Section 3.12.5 draws eight of the eighteen features from
distributions conditioned on the fraud label. Measured alone on the held-out
partition, `counterparty_reputation` reaches **0.9950** AUC and four more
proxies exceed 0.91, against **0.8479** for the best genuinely observed feature.
Those five also carry most of the fitted model's importance. The obvious
inference is that the headline metric is circular.

**What refutes it.** The proposed estimator was refitted on the observed and
derived features only — same split, same hyperparameters from the completed
search, same 0.75 threshold — so only the feature set varied.

| | All 18 features | Observed and derived only (11) |
| --- | --- | --- |
| F1 (fraud) | 0.9951 | **0.9959** |
| ROC AUC | 1.0000 | 0.9994 |
| Precision | 1.0000 | 0.9943 |
| Recall | 0.9903 | 0.9976 |

Removing every label-conditioned feature made the model *marginally better*. The
proxies are **redundant, not load-bearing**: a tree ensemble leans on whatever
separates most cleanly, and without them it finds equivalent signal elsewhere.

**The actual cause.** In the observed-only model `amount_to_account_ratio`
carries 60.5% of the importance. That ratio is large exactly when a transaction
empties the account it came from, which is how PaySim generates fraud.

| Condition | Among fraud | Among legitimate |
| --------- | ----------- | ---------------- |
| `amount == oldbalanceOrg` | 97.82% | 0.0001% (7 of 6,354,407) |
| `newbalanceOrig == 0` | 98.05% | 56.68% |
| both together | 97.70% | 0.00% |

A single boolean expression — the transaction drained the originating account
exactly and left it empty — achieves **99.98% precision and 97.70% recall with
no model, no features and no training**. The 0.995 F1 is a measurement of the
simulator's determinism, not of modelling skill. It is also why five of six
classifiers cluster within a few thousandths and why McNemar cannot separate the
top three: there is almost nothing left to separate.

**Report edits.**

1. Sections 4.3.1–4.3.5 must not present these figures as fraud-detection
   capability. They bound what is achievable *on this dataset*. The defensible
   claim is that the pipeline reproduces PaySim's known separability, which
   validates the implementation — partition, balancing, threshold, serving path
   — without evidencing real-world accuracy.
2. Section 3.19 gains a limitation with a measured basis: PaySim's fraud is a
   near-deterministic account drain, so the metrics transfer to real escrow
   fraud only insofar as real fraud shares that signature, which is unmeasured
   and unlikely.
3. Section 3.12.5 should state both properties of the simulated proxies — they
   are label-conditioned, which is why they dominate the importance ranking
   when present, and redundant, which is why removing them costs nothing.
4. Section 3.12.4 should record that four derived features — `velocity_24h`,
   `velocity_7d`, `velocity_30d`, `amount_deviation` — measure AUC 0.500 alone
   and receive essentially zero importance in both models. They are computed but
   inert, so listing all eighteen as contributing overstates the feature set.

**Caution for the viva.** Do not defend the 1.0000 AUC as a result. Present it as
something found, chased down and bounded. An examiner who spots it unprompted
will doubt the whole chapter; the same examiner, shown the ablation and the
one-line rule, has reason to trust it.
