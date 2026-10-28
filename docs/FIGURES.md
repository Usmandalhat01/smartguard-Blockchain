# Where each generated artefact goes in the report

Every figure and table below is produced by a pipeline stage, not drawn by
hand. Filenames follow the figure numbers in the corrected report
(`newUSMAN_DALHATU_Project_Corrected`), so assembling Chapter Four is a copy
rather than a renumbering exercise.

Regenerate everything with:

```
cd ml && make all                      # figures 4.1–4.5, tables 3.5 and 4.1
cd contracts && npx hardhat run scripts/measure-gas.js   # table 4.2
```

---

## Chapter Three

| Report location | Artefact | Notes |
|---|---|---|
| Table 3.4, feature 15 | — | **Edit required.** Feature 15 was specified as "1 for TRANSFER, 0 for CASH_OUT", which only has meaning once the other three operation types are filtered out. It is now a three-level ordinal code ordered by empirical fraud rate. See `DECISIONS.md` D-009. |
| Table 3.5 | `ml/outputs/tables/table_3_5_partition.csv` | **No edit required.** The run reproduces every cell of the approved table. Computed from `artifacts/split_indices.npz`, not asserted. |
| Section 3.13.3 | `docs/proxy_spec.md` | States the oversampling algorithm, parameters and library version, which Section 3.13.3 asks a reproducible rerun to do. |

---

## Chapter Four

| Report location | Figure | Artefact |
|---|---|---|
| Section 4.3.2 | *(reinstated — see below)* | `ml/outputs/figures/confusion_matrix_section_4_3_2.png` |
| Section 4.3.3 | Figure 4.1 | `ml/outputs/figures/figure_4_1_roc_curves.png` |
| Section 4.3.4 | Figure 4.2 | `ml/outputs/figures/figure_4_2_model_comparison.png` |
| Section 4.3.4 | Figure 4.3 | `ml/outputs/figures/figure_4_3_radar_comparison.png` |
| Section 4.3.5 | Figure 4.4 | `ml/outputs/figures/figure_4_4_feature_importance.png` |
| Section 4.3.6 | Figure 4.5 | `ml/outputs/figures/figure_4_5_threshold_sensitivity.png` |
| Section 4.4 | Figure 4.6 | Plot from `docs/evidence/gas-measurements.json` |
| Section 4.5 | Figure 4.7 | Requires the load test — still open |

| Report location | Table | Artefact |
|---|---|---|
| Section 4.3.4 | Table 4.1 | `ml/outputs/tables/table_4_1_classification.csv` |
| Section 4.4 | Table 4.2 | `docs/evidence/gas-measurements.json` |
| Section 4.6 | Table 4.3 | Hardhat and pytest run output |
| Section 4.3.4 | *(new)* | `ml/outputs/tables/statistical_comparison.json` — the McNemar test Objective Four was marked down for lacking |

### The confusion matrix

Section 4.3.2 removed the matrix because the one in the submitted report
described 1,906,034 observations and "a valid replacement matrix could not be
generated". It can be generated now: every matrix this run produces sums to the
documented 954,393 rows with 1,232 positives.

It has no figure number because inserting it changes the numbering. Two options,
in order of preference:

1. **Label it Figure 4.1a** and leave 4.1–4.7 untouched. Lowest-risk: nothing
   else in the document moves, and sub-lettering is standard practice.
2. **Insert it as Figure 4.1** and renumber 4.1 → 4.2, …, 4.7 → 4.8. Cleaner
   numbering, but every cross-reference in Chapters Four and Five has to be
   checked.

---

## What the figures change in the text

Chapter Four currently describes its own results as "previously reported and
unverified" throughout, because the artefacts behind them were not retained.
They exist now, so the hedging can be withdrawn in these specific places:

- **4.3.1** — the hyperparameters are no longer "previously documented
  implementation parameters"; the search that chose them is in
  `ml/outputs/training_records.json`, with the grid, the CV score and a SHA-256
  of the fitted model.
- **4.3.2** — the reconciliation the section says could not be performed, can.
- **4.3.3** — the ROC curves are regenerated, not "pending verification from
  the original notebook".
- **4.3.4** — an inferential test exists. Whether it supports a claim of
  superiority is whatever `statistical_comparison.json` says; the ranking in
  Table 4.1 is not by itself a finding.
- **4.3.5** — the importance ranking carries each feature's provenance. If the
  simulated features dominate it, Section 5.6 has to say so: the ranking is then
  partly a statement about the generating distributions rather than about
  mobile-money fraud.
- **4.3.6** — 0.75 stays a configuration value, but now on the evidence of a
  regenerated sweep rather than for want of one.
- **4.4** — Table 4.2's figures change. The measured values differ from the
  submitted ones, and `updateRiskScore` differs most, because this oracle
  enforces the Section 3.15.2 controls the original did not: single-write
  immutability, a strictly increasing nonce and an expiry check. A more
  expensive call is the cost of those controls, and that is the explanation the
  text should give.

## What they do not change

- **Generalisation.** One synthetic dataset remains one synthetic dataset.
  Table 4.5's second criticism of Objective Four is untouched.
- **The simulated features.** Eight of the eighteen are drawn from
  distributions conditioned on the fraud label. No rerun changes that, and
  Section 5.6 has to carry it.
- **Usability.** Excluded by Section 1.5 and still excluded.

---

## Table 4.2 — reading the gas distribution

`scripts/measure-gas.js` runs twenty complete lifecycles and retains all 300
receipts, so Table 4.2 can report the minimum, median, mean, maximum and
standard deviation that Appendix A records as unavailable. The pricing
assumptions and the generation timestamp are written into the JSON alongside
them, because a dollar column without a date and a rate is not reproducible.

Every spread in that table has an identified cause. None of it is noise, and the
report should say so rather than presenting an unexplained standard deviation:

| Method | Spread | Cause |
|---|---|---|
| `updateRiskScore` | 99,937 – 117,049 | The first call against a fresh oracle writes `lastNonce` from zero to non-zero, which is a cold `SSTORE` at 20,000 gas. Every later call modifies a warm slot at 2,900. The 17,100-gas step is exactly that difference, and it appears once per deployed oracle — so a production oracle pays it once, not per score. |
| `updateRiskScore` | 99,937 vs 99,949 | 12 gas, from one zero byte in the nonce argument: calldata costs 4 gas per zero byte against 16 per non-zero byte. |
| `setRiskThreshold` | 27,304 vs 30,104 | 27,304 is the case where the value written equals the value already stored, which `SSTORE` charges 100 gas for rather than 2,900. |
| `EscrowContract.deployment` | 12 gas | Constructor calldata, as above. |
| Everything else | 0 | These functions write a fixed set of slots regardless of input. A zero standard deviation is the correct result, not a missing measurement. |

Two caveats the text must keep:

1. **These are gas units, not Sepolia receipts.** Gas is fixed by the EVM cost
   schedule and the compiled bytecode, so the units are what Sepolia would
   charge — but Appendix A also asks for deployment and execution transaction
   hashes, and those only exist once the contracts are deployed. That item
   stays open.
2. **`updateRiskScore` costs more than the submitted Table 4.2 reported**
   (105,648 mean against 47,215). That is the price of the Section 3.15.2
   controls this oracle actually implements: single-write immutability, a
   strictly increasing nonce, and an expiry check. The earlier figure was for a
   contract that enforced none of them. This is a result to explain, not to
   reconcile away.
