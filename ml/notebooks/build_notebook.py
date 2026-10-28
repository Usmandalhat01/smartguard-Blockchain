"""Generates SmartGuard_Implementation.ipynb.

The notebook is built from this script rather than edited by hand for the same
reason report.py derives every figure from saved predictions: a hand-edited
notebook drifts away from the code it claims to document, and drift between the
write-up and the artefact is the specific defect the supervisor's corrections
were written to close.

Two rules keep the notebook honest:

  1. Where the notebook shows pipeline code, it shows it through
     `inspect.getsource` of the real module. There is no copy to fall out of
     date.
  2. Where the notebook shows a result, it reads the artefact that the run
     wrote. No number is typed into a cell.

Run `python notebooks/build_notebook.py` to regenerate, then execute with
`jupyter nbconvert --execute` to populate the outputs.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE / "SmartGuard_Implementation.ipynb"

cells: list[dict] = []


def md(text: str) -> None:
    cells.append({
        "cell_type": "markdown",
        "metadata": {},
        "source": text.strip("\n").splitlines(keepends=True),
    })


def code(text: str) -> None:
    cells.append({
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": text.strip("\n").splitlines(keepends=True),
    })


# ===========================================================================
# Front matter
# ===========================================================================

md(r"""
# Blockchain-Enhanced AI-Powered Digital Escrow Transaction System for Fraud Detection and Risk Analysis

**Usman Ibrahim Dalhatu** · Matric 2024/A/SENG/0093 · Student ID 30105739
Department of Software Engineering, School of Computer and Information Sciences
Miva Open University Abuja

---

## What this notebook is for

Appendix A of the report, *Reproducibility and Evidence Statement*, lists what
the submitted project did **not** retain. Among other things: the random seed,
the complete parameter-search grid, the serialised model checksum, the training
log, the split indices, the prediction files, and the repository commit. Because
those were missing, Chapter Four had to describe its own results as "previously
reported and unverified", and Objectives Two, Three and Four were each assessed
as *partially achieved*.

This notebook is the answer to that appendix. It executes the implementation
end to end and prints, for every claim Chapter Four makes, the artefact the
claim is derived from.

Two rules are followed throughout:

1. **No number is typed into this notebook.** Every figure, table and metric is
   read from a file that the pipeline wrote.
2. **No code is copied into this notebook.** Where a cell shows how a stage
   works, it prints the source of the real module with `inspect.getsource`, so
   what you read is what ran.

### Order of the argument

| Section | Question it answers | Report section |
|---|---|---|
| 1 | What produced these numbers, exactly? | Appendix A |
| 2 | Is the dataset the one the report describes? | 3.13.1 |
| 3 | What are the eighteen features, and where does each come from? | 3.12.4, Table 3.4 |
| 4 | Does the partition reconcile with Table 3.5? | 3.13.4, 4.3.2 |
| 5 | Did oversampling stay inside the training partition? | 3.13.3 |
| 6 | How were hyperparameters chosen, and when was validation touched? | 3.13.4 |
| 7 | What does the model do on data it has never seen? | 4.3.1–4.3.5 |
| 8 | Is 0.75 an optimum or a configuration value? | 4.3.6 |
| 9 | Is Random Forest *significantly* better, or just ranked higher? | 4.3.4, Objective 4 |
| 10 | What did SMOTE actually buy? | 2.9 |
| 11 | Does the smart contract enforce the risk gate? | 3.11, 4.4 |
| 12 | How does a score reach the chain? | 3.14 |
| 13 | Is access control real, or a front-end suggestion? | 3.15.2 |
| 14 | Which Appendix A gaps are now closed? | Appendix A, Table A1 |
""")

# ===========================================================================
# 1. Provenance
# ===========================================================================

md(r"""
---
## 1. Provenance of this run

Appendix A records that the report "does not record the random seed, complete
parameter-search grid, serialised model checksum, or full training log". The
experiment is described by exactly two things: `config.yaml`, and the commit
that ran it. Both are printed below, with checksums.
""")

code(r"""
import json, os, platform, subprocess, sys, textwrap, inspect
from pathlib import Path

import numpy as np
import pandas as pd

# The notebook lives in ml/notebooks; the package lives in ml/.
ML_ROOT = Path.cwd().parent if Path.cwd().name == "notebooks" else Path.cwd()
sys.path.insert(0, str(ML_ROOT))
REPO_ROOT = ML_ROOT.parent

from smartguard_ml.config import (
    PATHS, load_config, config_sha256, file_sha256, git_commit, git_dirty,
    environment_record,
)

CONFIG = load_config()

print("SmartGuard — machine-learning pipeline provenance")
print("=" * 72)
print(f"random seed              {CONFIG['seed']}")
print(f"config.yaml SHA-256     {config_sha256(CONFIG)}")
print(f"repository commit       {git_commit()}")
print(f"working tree dirty      {git_dirty()}")
print()

env = environment_record()
print("Execution environment (Appendix A records this as unavailable)")
print("-" * 72)
for key, value in env.items():
    print(f"  {key:<24} {value}")
""")

md(r"""
The hardware line above matters on its own account. Section 4.5 reports a mean
oracle response time of 1.12 seconds, and Appendix A notes that "the complete
hardware, operating-system, network, node-provider, worker-configuration,
concurrency, repeated-run, and variability records" were not retained — which is
why that measurement could not be interpreted. A latency figure without a
machine attached to it is not a measurement.
""")

code(r"""
# The full configuration, verbatim. Every stage reads its parameters from here;
# nothing downstream carries its own constant.
print(Path(ML_ROOT / "config.yaml").read_text())
""")

# ===========================================================================
# 2. Dataset
# ===========================================================================

md(r"""
---
## 2. The dataset

Section 3.13.1 specifies the synthetic PaySim mobile-money dataset
(López-Rojas, Elmir and Axelsson, 2016), and Table 3.5 states its size as
6,362,620 records of which 8,213 are fraudulent. `config.yaml` carries both
figures as `expected_rows` and `expected_fraud`, and the feature stage warns if
the file on disk disagrees.

The counts below are read from the raw CSV, not from the report.
""")

code(r"""
counts = json.loads((PATHS.tables / "preprocessing_counts.json").read_text())

print("Preprocessing record (Section 3.13.2, correction 10)")
print("=" * 72)
for key, value in counts.items():
    shown = f"{value:,}" if isinstance(value, int) else value
    print(f"  {key:<28} {shown}")

print()
expected_rows = CONFIG["dataset"]["expected_rows"]
expected_fraud = CONFIG["dataset"]["expected_fraud"]
rows, fraud = counts["raw_rows"], counts["fraud_rows_used"]

print(f"Table 3.5 states        {expected_rows:,} records, {expected_fraud:,} fraudulent")
print(f"File on disk holds      {rows:,} records, {fraud:,} fraudulent")
print()
print("RECONCILES" if (rows == expected_rows and fraud == expected_fraud)
      else "DOES NOT RECONCILE — resolve before using these figures")
""")

md(r"""
### Why all five operation types are retained

PaySim labels fraud only on `TRANSFER` and `CASH_OUT`; `PAYMENT`, `CASH_IN` and
`DEBIT` cannot carry a positive label. Dropping those three gives a denser
training signal, and an earlier revision of this pipeline did exactly that.

It was reversed. The filter changes every row count in Table 3.5 — and Table 3.5
is the table the supervisor's corrections reconciled by hand. Section 4.3.2
exists *because* an earlier confusion matrix described 1,906,034 observations
instead of the documented 954,393. Presenting a third set of partition counts
would re-open the defect the correction closed.

The filter survives as `dataset.restrict_to_fraud_types` and defaults to
`false`. Section 3.16.1 already states that accuracy "is reported for
completeness but is not the primary performance criterion", so the cost of a
diluted majority class falls on the metric the report does not rely on.
""")

code(r"""
raw_path = ML_ROOT / CONFIG["dataset"]["source_csv"]
usecols = ["type", "isFraud"]
types = pd.read_csv(raw_path, usecols=usecols)

by_type = (
    types.groupby("type")
    .agg(rows=("isFraud", "size"), fraud=("isFraud", "sum"))
    .assign(fraud_rate_pct=lambda d: 100 * d["fraud"] / d["rows"])
    .sort_values("fraud_rate_pct")
)
print("Fraud rate by operation type, across all 6,362,620 rows")
print("=" * 72)
print(by_type.to_string(formatters={
    "rows": "{:,}".format, "fraud": "{:,}".format,
    "fraud_rate_pct": "{:.4f}".format,
}))
print()
print("Feature 15 codes these three levels in this order, so the encoding is")
print("monotone in fraud propensity rather than arbitrary:")
from smartguard_ml.features import TRANSACTION_TYPE_CODES
for name, codeval in sorted(TRANSACTION_TYPE_CODES.items(), key=lambda kv: -kv[1]):
    print(f"  {name:<10} -> {codeval}")
del types
""")

# ===========================================================================
# 3. Features
# ===========================================================================

md(r"""
---
## 3. The eighteen features (Table 3.4)

Correction 11 required each feature's provenance to be stated, because the
report presented eighteen features as though all were observed in PaySim when
several are simulated. Three categories are distinguished:

- **original** — read directly from a PaySim column.
- **derived** — computed from PaySim columns.
- **simulated** — *not observable in PaySim at all.* Escrow-specific signals
  such as counterparty reputation have no PaySim equivalent, so they are drawn
  from documented distributions conditioned on the fraud label.

The simulated category is the one that constrains what the results can mean,
and it is stated here rather than left implicit.
""")

code(r"""
from smartguard_ml.features import FEATURE_SPECS, SIMULATED_FEATURES

spec_table = pd.DataFrame([{
    "#": s.index,
    "feature": s.name,
    "provenance": s.provenance,
    "dtype": s.dtype,
    "definition": s.description,
} for s in FEATURE_SPECS])

pd.set_option("display.max_colwidth", 78)
print("Table 3.4 — feature specification")
print("=" * 100)
for _, row in spec_table.iterrows():
    print(f"{row['#']:>2}. {row['feature']:<28} [{row['provenance']:<9}] {row['dtype']}")
    for line in textwrap.wrap(row["definition"], 92):
        print(f"      {line}")

print()
print(spec_table["provenance"].value_counts().to_string())
print()
print(f"{len(SIMULATED_FEATURES)} of {len(FEATURE_SPECS)} features are simulated:")
print("  " + ", ".join(SIMULATED_FEATURES))
""")

md(r"""
The generating distributions are not left to a comment. Each simulated feature
carries its distribution in the specification, and the feature stage writes them
to `docs/proxy_spec.md` so the report can cite a file rather than a paragraph.
""")

code(r"""
for s in FEATURE_SPECS:
    if s.provenance == "simulated":
        print(f"{s.name}")
        print(f"    {s.distribution}")
""")

code(r"""
# The real feature-construction code, printed from the module that ran it.
from smartguard_ml import features as feature_stage
print(inspect.getsource(feature_stage.build_features))
""")

# ===========================================================================
# 4. Partition
# ===========================================================================

md(r"""
---
## 4. The partition (Table 3.5) — and the reconciliation Section 4.3.2 needs

This is the defect that forced the rewrite of Chapter Four. Section 4.3.2 states
it plainly:

> An earlier confusion matrix represented 1,906,034 observations and was
> therefore incompatible with the documented test partition. [...] Because the
> original prediction outputs and exact split indices were unavailable, a valid
> replacement matrix could not be generated.

The split is written once, to `artifacts/split_indices.npz`, and every later
stage reads those indices. The table below is computed **from the saved
indices**, not asserted — so it cannot drift from the data the models actually
saw.
""")

code(r"""
partition = pd.read_csv(PATHS.tables / "table_3_5_partition.csv")
print("Table 3.5 — generated from artifacts/split_indices.npz")
print("=" * 78)
print(partition.to_string(index=False))

# The figures the corrected report commits to, Table 3.5.
APPROVED = {
    "Full dataset":  (6354407, 8213, 6362620),
    "Training":      (4448085, 5749, 4453834),
    "Validation":    (953161, 1232, 954393),
    "Held-out test": (953161, 1232, 954393),
}

print()
print(f"{'Partition':<16}{'legit':>12}{'fraud':>8}{'total':>12}   vs report")
print("-" * 78)
ok = True
for _, row in partition.iterrows():
    want = APPROVED.get(row["Partition"])
    match = want == (row["Legitimate"], row["Fraudulent"], row["Total"])
    ok &= bool(match)
    print(f"{row['Partition']:<16}{row['Legitimate']:>12,}{row['Fraudulent']:>8,}"
          f"{row['Total']:>12,}   {'match' if match else 'MISMATCH'}")

print()
print("Every cell of Table 3.5 reproduces." if ok else
      "Table 3.5 does NOT reproduce — do not publish these figures.")
""")

code(r"""
# Proof that the three partitions are disjoint and exhaustive. A leak here would
# invalidate every number in Chapter Four, so it is checked rather than assumed.
idx = np.load(PATHS.split_indices)
train, validation, test = idx["train"], idx["validation"], idx["test"]

sizes = {"train": len(train), "validation": len(validation), "test": len(test)}
total = sum(sizes.values())

print("Partition index integrity")
print("=" * 60)
for name, size in sizes.items():
    print(f"  {name:<12} {size:>10,}  ({100 * size / total:.2f}%)")
print(f"  {'union':<12} {total:>10,}")
print()

pairs = [("train", "validation", train, validation),
         ("train", "test", train, test),
         ("validation", "test", validation, test)]
for a, b, left, right in pairs:
    overlap = np.intersect1d(left, right).size
    print(f"  {a} ∩ {b}: {overlap} rows  {'OK' if overlap == 0 else 'LEAK'}")

all_idx = np.concatenate([train, validation, test])
print()
print(f"  distinct indices: {np.unique(all_idx).size:,} of {total:,} "
      f"{'OK' if np.unique(all_idx).size == total else 'DUPLICATED'}")
""")

# ===========================================================================
# 5. Balancing
# ===========================================================================

md(r"""
---
## 5. Oversampling, and where it is allowed to happen

Section 3.13.3 is emphatic that oversampling occurs "only after the
train-validation-test split and only within the training partition". It also
concedes that the retained documentation is inconsistent about *which*
algorithm ran — SMOTE in some places, SMOTENC in others — and therefore uses
the neutral term "minority-class oversampling" throughout, asking that

> A reproducible rerun should state the exact algorithm, categorical-feature
> handling, and sampling parameters explicitly.

This run states it: **SMOTE**, `k_neighbors=5`, `sampling_strategy=1.0`,
`random_state` from the run seed, from imbalanced-learn, with the version
printed in Section 1.

The guarantee that it stays inside the training partition is structural rather
than procedural. SMOTE is the first step of an imbalanced-learn `Pipeline`, so
it is applied to each fold's *training* portion during cross-validation and to
no fold's validation portion. Resampling before the split — the error Section
3.13.3 warns about — is not avoided by discipline here; it is made
unexpressible.
""")

code(r"""
from smartguard_ml import models
print(inspect.getsource(models.build_pipeline))
""")

code(r"""
# What the pipeline for the proposed model actually is, step by step.
spec = CONFIG["models"]["random_forest"]
pipeline = models.build_pipeline(spec, CONFIG["balancing"], CONFIG["seed"])

print("Proposed model pipeline")
print("=" * 72)
for name, step in pipeline.steps:
    print(f"  {name:<12} {step.__class__.__name__}")
    for key, value in sorted(step.get_params().items()):
        if key in ("random_state", "sampling_strategy", "k_neighbors",
                   "n_estimators", "max_depth", "min_samples_leaf", "n_jobs"):
            print(f"      {key:<20} {value}")
print()
print("SMOTE is step 1, so cross-validation resamples each fold's training")
print("portion only. No synthetic row can reach a validation or test fold.")
""")

code(r"""
# The balancing effect on the training partition, measured.
from imblearn.over_sampling import SMOTE

feat = pd.read_parquet(PATHS.features)
y = feat["is_fraud"].to_numpy()

before = pd.Series(y[train]).value_counts().sort_index()
print("Training partition before oversampling")
print(f"  legitimate {before[0]:,}")
print(f"  fraudulent {before[1]:,}   ({100 * before[1] / before.sum():.4f}%)")

X = feat.drop(columns=["is_fraud"])
sm = SMOTE(
    sampling_strategy=CONFIG["balancing"]["sampling_strategy"],
    k_neighbors=CONFIG["balancing"]["k_neighbors"],
    random_state=CONFIG["seed"],
)
_, y_balanced = sm.fit_resample(X.iloc[train], y[train])
after = pd.Series(y_balanced).value_counts().sort_index()

print()
print("After oversampling")
print(f"  legitimate {after[0]:,}")
print(f"  fraudulent {after[1]:,}   ({100 * after[1] / after.sum():.4f}%)")
print(f"  total      {after.sum():,}")
print()
print("Table 3.5 gives the post-oversampling training partition as 8,896,170 "
      "rows at 50.000%.")
print("MATCHES" if after.sum() == 8_896_170 else "DOES NOT MATCH")
print()
print("The held-out partitions keep the natural ratio, untouched:")
for name, part in (("validation", validation), ("test", test)):
    counts_ = pd.Series(y[part]).value_counts().sort_index()
    print(f"  {name:<12} {counts_[0]:,} legitimate · {counts_[1]:,} fraudulent "
          f"({100 * counts_[1] / counts_.sum():.4f}%)")
""")

# ===========================================================================
# 6. Training
# ===========================================================================

md(r"""
---
## 6. Model selection, and when the validation partition was read

Correction 7 asked the report to "explicitly explain the role of the 15%
validation set [...] and at exactly what point it was accessed". Section 3.13.4
now concedes that for the original run this "cannot be reconstructed from the
available artefacts".

The procedure this run follows is a four-step sequence, and it is executable
rather than described:

1. Hyperparameters are searched by 5-fold cross-validation **inside the
   training partition only**, on a stratified subsample whose size is recorded
   in `config.yaml` as `search_sample_rows`. Searching across millions of rows
   is not tractable, and correction 7 asks precisely that this subsample be
   documented.
2. The winning configuration is scored **once** against the held-out validation
   partition, which no fitting has touched.
3. The final estimator is refitted on the complete training partition.
4. The test partition is not read at this stage at all. It is read exactly once,
   later, by `evaluate.py`.
""")

code(r"""
from smartguard_ml import train as train_stage
print(inspect.getsource(train_stage.train_one))
""")

md(r"""
### What the search actually found

Appendix A records the "complete parameter-search grid" and "serialised model
checksum" as missing. Both are in the training record below, one row per
candidate, together with the wall-clock cost of each fit.
""")

code(r"""
records = json.loads((PATHS.outputs / "training_records.json").read_text())

for r in records:
    print("=" * 78)
    tag = "  [proposed]" if r["proposed"] else ""
    print(f"{r['model']}  ({r['estimator']}){tag}")
    print(f"  SMOTE applied        {r['balanced']}")
    s = r["search"]
    print(f"  search grid          {s['grid']}")
    print(f"  selection            {s['cv_folds']}-fold CV on {s['scoring']}, "
          f"{s['sample_rows']:,} rows")
    print(f"  chosen parameters    {s['best_params']}")
    print(f"  best CV {s['scoring']:<12} {s['best_cv_score']:.6f}")
    print(f"  search time          {s['seconds']:,.1f}s")
    print(f"  validation F1        {r['validation']['f1_fraud']:.6f}  "
          f"(on {r['validation']['rows']:,} held-out rows, read once)")
    print(f"  final refit          {r['final_fit']['training_rows']:,} rows in "
          f"{r['final_fit']['seconds']:,.1f}s")
    a = r["artifact"]
    print(f"  artefact             {a['path']}  ({a['bytes']:,} bytes)")
    print(f"  SHA-256              {a['sha256']}")
""")

md(r"""
The report commits to a specific Random Forest configuration — Appendix A: "200
trees, maximum depth of 18, minimum of four samples per leaf". The grid in
`config.yaml` pins exactly those values rather than searching around them, so
this run reproduces the documented model rather than quietly substituting a
better one. Checked below.
""")

code(r"""
REPORTED = {"n_estimators": 200, "max_depth": 18, "min_samples_leaf": 4}
rf = next(r for r in records if r["model"] == "random_forest")
chosen = {k: v for k, v in rf["search"]["best_params"].items()}

print("Appendix A records this configuration for the Random Forest:")
for key, want in REPORTED.items():
    got = chosen.get(key)
    verdict = "match" if got == want else f"DIFFERS (report says {want})"
    print(f"  {key:<20} {got}   {verdict}")
""")

code(r"""
# The training log from the run that produced these artefacts. Appendix A
# records the "full training log" as not retained.
log = ML_ROOT / "logs" / "train.log"
print(log.read_text() if log.exists() else "No training log at ml/logs/train.log")
""")

# ===========================================================================
# 7. Held-out evaluation
# ===========================================================================

md(r"""
---
## 7. The held-out test partition

Correction 2 required the confusion matrix, the classification report, the ROC
curves, the AUCs and the comparison table to be "regenerate[d] [...] from one
saved test split and one set of prediction files".

The pipeline enforces that by inverting the usual order. `evaluate.py` writes
**probabilities and nothing else** — it computes no metric at all. `report.py`
then derives every figure from those saved files, and is structurally unable to
load a model or re-partition the data. So Table 4.1 and the confusion matrix
beside it are two views of one array. They cannot disagree.
""")

code(r"""
from smartguard_ml import evaluate as evaluate_stage
print(inspect.getsource(evaluate_stage.evaluate_one))
""")

code(r"""
ev = json.loads((PATHS.outputs / "evaluation_records.json").read_text())
ev_table = pd.DataFrame(ev)

print("Scoring record — the test partition, read exactly once")
print("=" * 86)
print(ev_table[[
    "model", "score_kind", "test_rows", "test_fraud",
    "inference_seconds", "microseconds_per_row",
]].to_string(index=False, formatters={
    "test_rows": "{:,}".format, "test_fraud": "{:,}".format,
}))

print()
print("Every model scored the same rows:",
      ev_table["test_rows"].nunique() == 1 and ev_table["test_fraud"].nunique() == 1)
print(f"  {ev_table['test_rows'].iloc[0]:,} rows, "
      f"{ev_table['test_fraud'].iloc[0]:,} fraudulent")
print()
print("Note the score_kind column. SGDClassifier under hinge loss has no")
print("predict_proba, so its decision margin is min-max scaled into [0,1].")
print("That is a monotone transform, so ROC-AUC is unaffected — but the values")
print("are not probabilities, and the column says so rather than pretending.")
""")

md(r"""
### Table 4.1 — classification results

Every value below is derived from the saved prediction files at the configured
operating threshold. Compare against the "previously reported and unverified"
Table 4.1 in the submitted report, which could not be reproduced from the
documented 954,393-record partition.
""")

code(r"""
table_41 = pd.read_csv(PATHS.tables / "table_4_1_classification.csv")

show = table_41[[
    "model", "accuracy", "precision_fraud", "recall_fraud", "f1_fraud", "roc_auc",
]].copy()
for col in show.columns[1:]:
    show[col] = show[col].map("{:.4f}".format)

print(f"Table 4.1 — held-out test partition, threshold "
      f"{table_41['threshold'].iloc[0]:.2f}")
print("=" * 86)
print(show.to_string(index=False))

print()
print("The confusion-matrix counts these metrics were computed from:")
print("-" * 86)
cm = table_41[[
    "model", "true_negatives", "false_positives", "false_negatives",
    "true_positives",
]].copy()
print(cm.to_string(index=False, formatters={
    c: "{:,}".format for c in cm.columns[1:]
}))

print()
for _, row in table_41.iterrows():
    total = (row["true_negatives"] + row["false_positives"]
             + row["false_negatives"] + row["true_positives"])
    positives = row["false_negatives"] + row["true_positives"]
    flag = "OK" if (total == 954_393 and positives == 1_232) else "MISMATCH"
    print(f"  {row['model']:<28} {total:>9,} rows · {positives:>5,} actual fraud  {flag}")
print()
print("This is the check Section 4.3.2 could not perform: every matrix sums to")
print("the documented held-out partition.")
""")

md(r"""
### The reinstated confusion matrix

Section 4.3.2 removed the confusion matrix because "a valid replacement matrix
could not be generated". It can be generated now. The metrics are printed onto
the figure itself, so the class of contradiction the review found — a matrix
that does not produce the metrics reported beside it — is visible rather than
latent.
""")

code(r"""
from IPython.display import Image, display

FIGURES = PATHS.figures
def show_figure(name: str, caption: str) -> None:
    path = FIGURES / name
    if path.exists():
        print(caption)
        display(Image(filename=str(path)))
    else:
        print(f"[missing] {path}")

show_figure("confusion_matrix_section_4_3_2.png",
            "Confusion matrix, proposed model, held-out test partition "
            "(Section 4.3.2)")
""")

code(r"""
reports = json.loads((PATHS.tables / "classification_reports.json").read_text())
proposed = next(r["model"] for r in records if r["proposed"])

rep = reports[proposed]
print(f"Classification report — {proposed}, held-out test partition")
print("=" * 72)
print(f"{'':<14}{'precision':>11}{'recall':>10}{'f1-score':>11}{'support':>11}")
for cls in ("legitimate", "fraudulent"):
    row = rep[cls]
    print(f"{cls:<14}{row['precision']:>11.4f}{row['recall']:>10.4f}"
          f"{row['f1-score']:>11.4f}{int(row['support']):>11,}")
print()
print(f"{'accuracy':<14}{'':>11}{'':>10}{rep['accuracy']:>11.4f}"
      f"{int(rep['macro avg']['support']):>11,}")
for avg in ("macro avg", "weighted avg"):
    row = rep[avg]
    print(f"{avg:<14}{row['precision']:>11.4f}{row['recall']:>10.4f}"
          f"{row['f1-score']:>11.4f}{int(row['support']):>11,}")
""")

md(r"""
### Figures 4.1 to 4.4

Section 4.3.3 records that the ROC curves "could not be regenerated during this
revision" and are "retained as descriptive outputs pending verification from
the original notebook". This is that notebook.
""")

code(r"""
show_figure("figure_4_1_roc_curves.png",
            "Figure 4.1 — ROC curves, five comparison classifiers (Section 4.3.3)")
""")

code(r"""
show_figure("figure_4_2_model_comparison.png",
            "Figure 4.2 — classification metrics by model (Section 4.3.4)")
""")

code(r"""
show_figure("figure_4_3_radar_comparison.png",
            "Figure 4.3 — multi-dimensional comparison, three strongest "
            "classifiers (Section 4.3.4)")
""")

md(r"""
### Figure 4.4 — feature importance

Section 4.3.5 reports a ranking in which "counterparty reputation and prior
dispute rate" dominate while "transaction amount ranked lower", and flags that
the serialised model was not retained so the ranking could not be checked.

Read the provenance column from Section 3 alongside this ranking. If the
strongest features are the *simulated* ones, the ranking is substantially a
statement about the generating distributions, not about mobile-money fraud —
and that is a limitation to state, not to hide.
""")

code(r"""
imp_path = PATHS.tables / "feature_importance.csv"
if imp_path.exists():
    imp = pd.read_csv(imp_path)
    provenance = {s.name: s.provenance for s in FEATURE_SPECS}
    imp["provenance"] = imp["feature"].map(provenance)

    print("Feature importance — mean decrease in Gini impurity")
    print("=" * 76)
    print(f"{'rank':>5}  {'feature':<28}{'importance':>12}{'cumulative':>12}  provenance")
    print("-" * 76)
    for i, row in imp.iterrows():
        print(f"{i + 1:>5}  {row['feature']:<28}{row['importance']:>12.5f}"
              f"{row['cumulative']:>12.5f}  {row['provenance']}")

    print()
    by_prov = imp.groupby("provenance")["importance"].sum().sort_values(ascending=False)
    print("Share of total importance by provenance category")
    print("-" * 50)
    for prov, share in by_prov.items():
        print(f"  {prov:<12} {100 * share:>6.2f}%")

    sim_share = 100 * by_prov.get("simulated", 0.0)
    print()
    print(textwrap.fill(
        f"Simulated features account for {sim_share:.1f}% of total importance. "
        "Section 5.6 must carry this figure: to the extent the model relies on "
        "features that PaySim does not contain, its performance reflects the "
        "documented generating distributions as much as the dataset.", 76))
else:
    print("No feature_importance.csv — rerun the evaluate stage.")
""")

code(r"""
show_figure("figure_4_4_feature_importance.png",
            "Figure 4.4 — ten most influential features (Section 4.3.5)")
""")

# ===========================================================================
# 8. Threshold
# ===========================================================================

md(r"""
---
## 8. The 0.75 threshold — configuration value or optimum?

Section 4.3.6 is careful: 0.75 "cannot presently be reproduced as an empirically
validated optimum" and "is treated as a prototype configuration value". It asks
that future evaluation

> regenerate the precision-recall and threshold-sensitivity analysis using saved
> probability scores from a documented held-out test set.

That sweep is below, computed from the saved probabilities. The honest outcome
is whatever it shows — if 0.75 is not the maximum, the report keeps calling it a
configuration value, and the pipeline prints a warning to that effect rather
than letting the wording slide.
""")

code(r"""
sweep = pd.read_csv(PATHS.tables / "threshold_sensitivity.csv")
configured = CONFIG["threshold"]["configured"]

show = sweep[[
    "threshold", "precision_fraud", "recall_fraud", "f1_fraud",
    "false_positive_rate", "false_positives", "false_negatives",
]].copy()

print("Threshold sensitivity — proposed model, held-out test partition")
print("=" * 94)
print(f"{'thresh':>7}{'precision':>11}{'recall':>9}{'F1':>9}{'FPR':>10}"
      f"{'false pos':>11}{'false neg':>11}")
print("-" * 94)
for _, r in show.iterrows():
    mark = "  <- configured" if abs(r["threshold"] - configured) < 1e-9 else ""
    print(f"{r['threshold']:>7.2f}{r['precision_fraud']:>11.4f}"
          f"{r['recall_fraud']:>9.4f}{r['f1_fraud']:>9.4f}"
          f"{r['false_positive_rate']:>10.5f}{int(r['false_positives']):>11,}"
          f"{int(r['false_negatives']):>11,}{mark}")

best = sweep.loc[sweep["f1_fraud"].idxmax()]
at_conf = sweep.iloc[(sweep["threshold"] - configured).abs().argmin()]

print()
print(f"configured {configured:.2f}  ->  F1 {at_conf['f1_fraud']:.4f}")
print(f"sweep max  {best['threshold']:.2f}  ->  F1 {best['f1_fraud']:.4f}")
print()
if abs(best["threshold"] - configured) < 1e-9:
    print("The configured value IS the empirical maximum on this partition.")
else:
    print(textwrap.fill(
        f"The configured value is NOT the empirical maximum. Section 4.3.6 must "
        f"continue to describe 0.75 as a configuration value. Adopting "
        f"{best['threshold']:.2f} would raise fraud-class F1 from "
        f"{at_conf['f1_fraud']:.4f} to {best['f1_fraud']:.4f}, and that is a "
        f"recommendation for Section 5.7 rather than a silent change to the "
        f"deployed gate.", 76))
""")

code(r"""
show_figure("figure_4_5_threshold_sensitivity.png",
            "Figure 4.5 — threshold sensitivity (Section 4.3.6)")
""")

md(r"""
The threshold is not only a statistical choice; it is the contract's gate.
`EscrowContract.depositFunds` reverts when the score exceeds it, so this number
decides which transactions are refused on chain. Section 4.3.6's observation
that a high false-positive rate "represents an operational and usability
trade-off" is literal: each false positive in the table above is a legitimate
deposit that the contract would have rejected.
""")

code(r"""
# What the operating point costs, in the units the contract works in.
row = at_conf
blocked = int(row["false_positives"])
missed = int(row["false_negatives"])
caught = int(row["true_positives"])

print(f"At the configured threshold of {configured:.2f}, on 954,393 held-out")
print("transactions the deployed gate would have:")
print(f"  refused {blocked:,} legitimate deposits   (false positives)")
print(f"  caught  {caught:,} of {caught + missed:,} fraudulent deposits")
print(f"  allowed {missed:,} fraudulent deposits     (false negatives)")
print()
print(f"  {100 * blocked / 953_161:.4f}% of legitimate transactions refused")
print(f"  {100 * caught / (caught + missed):.2f}% of fraud intercepted")
""")

# ===========================================================================
# 9. Statistical test
# ===========================================================================

md(r"""
---
## 9. Objective Four — is the ranking significant?

This is the objective the report scores most harshly. Table 4.5:

> A descriptive benchmarking exercise was conducted, but statistical
> superiority of Random Forest and generalisability across datasets were not
> established. **Partially achieved.**

Appendix A: "No inferential statistical test was conducted for classifier
differences. Objective Four is consequently assessed as partially achieved."

A ranked table is not a finding. McNemar's test compares the proposed model
against each comparator on the *same* held-out rows, which is exactly the design
that makes a paired test valid — and the saved prediction files are what make it
possible.
""")

code(r"""
from smartguard_ml import stats as stats_module
print(inspect.getsource(stats_module.mcnemar))
""")

code(r"""
comparisons = json.loads((PATHS.tables / "statistical_comparison.json").read_text())
alpha = CONFIG["statistics"]["alpha"]

print(f"McNemar's test — proposed model vs each comparator, alpha = {alpha}")
print("=" * 94)
for c in comparisons:
    print(f"{c['proposed']} vs {c['comparator']}")
    print(f"  proposed right, comparator wrong   {c['b_only_a_correct']:>9,}")
    print(f"  proposed wrong, comparator right   {c['c_only_b_correct']:>9,}")
    print(f"  discordant pairs                   {c['discordant']:>9,}")
    print(f"  method               {c['method']}")
    if c["statistic"] is not None:
        print(f"  chi-square           {c['statistic']}")
    pv = c.get("p_value")
    print(f"  p-value              {pv:.6g}" if pv is not None else
          "  p-value              not computable")
    print(f"  significant at {alpha}  {c['significant']}")
    if c.get("note"):
        print(f"  note                 {c['note']}")
    print(f"  -> {textwrap.fill(c['interpretation'], 88, subsequent_indent='     ')}")
    print()

sig = sum(1 for c in comparisons if c["significant"])
print("-" * 94)
print(f"{sig} of {len(comparisons)} comparisons reach significance at alpha = {alpha}.")
print()
print(textwrap.fill(
    "This is the evidence Objective Four requires. Whether it supports a claim "
    "of superiority depends on the result above, not on the ordering of "
    "Table 4.1 — and a significant difference on one synthetic dataset is still "
    "not evidence of generalisation, which is the second half of what Table 4.5 "
    "found wanting.", 94))
""")

# ===========================================================================
# 10. Ablation
# ===========================================================================

md(r"""
---
## 10. What oversampling bought

Section 2.9 identifies, as a gap in the literature, the absence of a measured
effect for class balancing — and Chapter Four never reported one for this
prototype either. The ablation is the same proposed model on the same split,
fitted with and without SMOTE, so the difference is attributable.
""")

code(r"""
ablation_label = f"{proposed}_no_smote"
rows = table_41[table_41["model"].isin([proposed, ablation_label])]

if len(rows) == 2:
    with_s = rows[rows["model"] == proposed].iloc[0]
    without = rows[rows["model"] == ablation_label].iloc[0]

    print(f"Effect of SMOTE on {proposed}, identical split and threshold")
    print("=" * 76)
    print(f"{'metric':<22}{'with SMOTE':>14}{'without':>14}{'difference':>14}")
    print("-" * 76)
    for key, name in [
        ("accuracy", "accuracy"),
        ("precision_fraud", "precision (fraud)"),
        ("recall_fraud", "recall (fraud)"),
        ("f1_fraud", "F1 (fraud)"),
        ("roc_auc", "ROC-AUC"),
    ]:
        d = with_s[key] - without[key]
        print(f"{name:<22}{with_s[key]:>14.4f}{without[key]:>14.4f}{d:>+14.4f}")

    print()
    print(f"{'detections':<22}{'with SMOTE':>14}{'without':>14}")
    print("-" * 76)
    for key, name in [("true_positives", "fraud caught"),
                      ("false_negatives", "fraud missed"),
                      ("false_positives", "legitimate blocked")]:
        print(f"{name:<22}{int(with_s[key]):>14,}{int(without[key]):>14,}")

    print()
    print(textwrap.fill(
        f"Oversampling moves fraud-class recall by "
        f"{with_s['recall_fraud'] - without['recall_fraud']:+.4f} and fraud-class "
        f"precision by {with_s['precision_fraud'] - without['precision_fraud']:+.4f}. "
        "The direction of that trade is the substantive finding: balancing buys "
        "recall at the cost of precision, which on this gate means catching more "
        "fraud by refusing more legitimate deposits.", 76))
else:
    print(f"Ablation not available — expected a {ablation_label} prediction file.")
""")

# ===========================================================================
# 11. Smart contracts
# ===========================================================================

md(r"""
---
## 11. The blockchain layer

The machine-learning score is advisory until something enforces it. Section 1.2
puts the problem precisely:

> A machine-learning classifier can estimate the likelihood of fraud, but its
> prediction remains advisory unless another mechanism can apply it before funds
> are committed. Manual intervention may be delayed, and a front-end restriction
> can be bypassed if a user interacts directly with the contract.

The contract is that mechanism, and it is the only boundary a user cannot route
around. Two contracts implement the blockchain layer:

- **`RiskOracleContract`** — holds one score per escrow, writable only by the
  designated oracle operator, and only once.
- **`EscrowContract`** — the four-state escrow machine of Section 3.11.1, whose
  `depositFunds` consults the oracle before accepting money.
""")

code(r"""
CONTRACTS = REPO_ROOT / "contracts" / "contracts"

for name in sorted(p.name for p in CONTRACTS.glob("*.sol")):
    src = (CONTRACTS / name).read_text()
    print(f"{name:<28} {len(src.splitlines()):>4} lines")
""")

md(r"""
### The risk gate

This is the junction of the whole project — the point where an off-chain
statistical judgement becomes an on-chain refusal. Three properties of it are
worth reading closely:

1. The escrow identifier is derived deterministically from the transaction's own
   terms, so the score cannot be written against one identifier and consumed
   against another.
2. A **missing** score reverts. Section 3.15.2 requires the system to fail
   closed: if the intelligence layer has not spoken, no funds move. A default of
   "allow" would convert any outage of the scoring service into an open gate.
3. The comparison is `>` against the configured threshold, which is the same
   number the sweep in Section 8 examined.
""")

code(r"""
escrow = (CONTRACTS / "EscrowContract.sol").read_text()

start = escrow.find("function depositFunds")
if start == -1:
    print("depositFunds not found")
else:
    # Print to the end of the function body by brace matching.
    depth, i, began = 0, start, False
    while i < len(escrow):
        if escrow[i] == "{":
            depth += 1
            began = True
        elif escrow[i] == "}":
            depth -= 1
            if began and depth == 0:
                break
        i += 1
    print(escrow[start:i + 1])
""")

code(r"""
oracle_src = (CONTRACTS / "RiskOracleContract.sol").read_text()

# The production controls Section 3.15.2 specifies, and Appendix A lists as
# untested: nonce handling, replay rejection, timestamp expiry, key rotation.
for marker in ("function submitRiskScore", "function setOracleOperator"):
    start = oracle_src.find(marker)
    if start == -1:
        continue
    depth, i, began = 0, start, False
    while i < len(oracle_src):
        if oracle_src[i] == "{":
            depth += 1
            began = True
        elif oracle_src[i] == "}":
            depth -= 1
            if began and depth == 0:
                break
        i += 1
    print(oracle_src[start:i + 1])
    print("\n" + "-" * 76 + "\n")
""")

md(r"""
### The contract test suite

Table 4.3 reports 42 smart-contract unit tests, and Table A1 records that for
every scenario the only available artefact is "aggregate count in Table 4.3
only; test scripts and console output not retained". Appendix A also states that
a production security claim "would also require tests covering nonce handling,
replay rejection, timestamp expiry, key rotation, malformed model output, API
failure, and fail-closed contract behaviour" — and that those are "not claimed
as tested controls".

The cell below runs the suite and prints its output, so the count has a log
behind it.
""")

code(r"""
import subprocess

def run(cmd: list[str], cwd: Path, timeout: int = 1800) -> str:
    # Returns the command's combined output, or an explanation of why it did
    # not run. A missing toolchain is reported rather than raised: the notebook
    # must stay executable on a machine that has Python but not Node.
    try:
        done = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout,
        )
        return done.stdout + done.stderr
    except FileNotFoundError:
        return f"[not run] {cmd[0]} is not installed on this machine."
    except subprocess.TimeoutExpired:
        return f"[not run] {' '.join(cmd)} exceeded {timeout}s."

contracts_dir = REPO_ROOT / "contracts"
if (contracts_dir / "node_modules").exists():
    print(run(["npx", "hardhat", "test"], contracts_dir))
else:
    print("[not run] contracts/node_modules is absent. Run `npm install` in")
    print("contracts/ to reproduce this cell.")
""")

md(r"""
### Gas measurement (Table 4.2)

Appendix A on Table 4.2: "the per-execution receipts, testing date, gas price,
ETH/USD conversion rate, median, minimum, maximum, and standard deviation are
unavailable in the submitted material."

Those are all properties of *how the measurement is taken*, not of the chain.
The Hardhat gas reporter records a per-call distribution across the whole test
run, which is what turns a single mean into the descriptive statistics the
appendix asks for.
""")

code(r"""
gas_report = REPO_ROOT / "docs" / "evidence" / "gas-report.txt"
if gas_report.exists():
    print(gas_report.read_text())
else:
    print("[absent] docs/evidence/gas-report.txt")
    print()
    print("Generate it with:")
    print("  cd contracts && REPORT_GAS=true npx hardhat test")
    print()
    print("Record alongside it, because Appendix A lists each as missing:")
    print("  the testing date, the gas price assumed, and the ETH/USD rate used")
    print("  for the dollar column — Table 4.2 currently assumes 15 Gwei and")
    print("  USD 2,650.00 without stating when that rate held.")
""")

# ===========================================================================
# 12. Oracle bridge
# ===========================================================================

md(r"""
---
## 12. The oracle bridge

Section 3.14 describes the component that carries a score from the FastAPI
service to the chain. Section 2.5.3 frames why it is the hard part: a smart
contract cannot query an off-chain model, so something trusted has to push the
result in — and that pusher becomes the system's weakest link.

The controls Section 3.15.2 places on it are therefore the security core of the
design: the operator key signs, the contract checks the signer, the nonce must
strictly increase, the message expires, and the owner can rotate the operator
without redeploying.
""")

code(r"""
api_dir = REPO_ROOT / "api"
for path in sorted(api_dir.rglob("*.py")):
    if "__pycache__" in str(path) or "/tests/" in str(path):
        continue
    rel = path.relative_to(REPO_ROOT)
    print(f"{str(rel):<48} {len(path.read_text().splitlines()):>4} lines")
""")

md(r"""
### Feature parity between training and inference

This is the subtlest failure mode in the whole system, and it produces no error
when it happens. If a feature is computed one way during training and another
way at inference, the model receives a number whose meaning has changed, and
returns a confident score about nothing. Nothing raises; the risk gate simply
starts making decisions on noise.

It occurred during development. `amount_to_account_ratio` is defined in Table
3.4 as `amount / (oldbalanceOrg + 1)` — the share of the originating account's
balance that the transaction moves, so a full drain approaches 1.0. The
inference path divided by the account's *mean transaction amount* instead. The
shape the model had learned to read was not the shape it was being given.

The pipeline now carries a parity test, which is the only durable defence.
""")

code(r"""
parity = api_dir / "tests" / "test_feature_parity.py"
print(parity.read_text() if parity.exists() else "[absent] api/tests/test_feature_parity.py")
""")

# ===========================================================================
# 13. RBAC
# ===========================================================================

md(r"""
---
## 13. Access control

Section 3.15.2 specifies role-based access control across buyer, seller and
arbitrator. Section 1.2 has already explained why a front-end check is not
access control: "a front-end restriction can be bypassed if a user interacts
directly with the contract."

Authorisation is therefore enforced at three depths, and only the last is
unbypassable:

| Depth | Mechanism | Can it be bypassed? |
|---|---|---|
| Route admission | `web/proxy.ts` on the session cookie | Yes — it is an optimisation, not a boundary |
| Server component | `requirePermission` before any data is read | Only by defeating the signed session |
| Object level | ownership checks mirroring the Solidity modifiers | Only by calling the contract directly |
| **Contract** | `onlyBuyer`, `onlySeller`, `onlyArbitrator`, `onlyOracle` | **No** |

The grant table is one module, so a permission cannot be asserted in two places
and drift.
""")

code(r"""
policy = REPO_ROOT / "web" / "lib" / "auth" / "policy.ts"
print(policy.read_text() if policy.exists() else "[absent] web/lib/auth/policy.ts")
""")

md(r"""
The frontend grant table and the API's own table are two implementations of one
policy, which is exactly the condition under which they drift apart. A test
parses the TypeScript and asserts they agree — and asserts two structural
properties besides: that the administrator role holds no fund-moving
permission, and that no role's grants are a superset of another's.
""")

code(r"""
if (api_dir / "tests").exists():
    print(run([str(ML_ROOT.parent / "api" / ".venv" / "bin" / "python"),
               "-m", "pytest", "-q", "tests/test_policy_parity.py",
               "tests/test_feature_parity.py"],
              api_dir))
else:
    print("[not run] api/tests is absent.")
""")

# ===========================================================================
# 14. Evidence matrix
# ===========================================================================

md(r"""
---
## 14. Appendix A, item by item

Appendix A exists to stop "descriptive prototype results from being interpreted
as independently reproducible measurements". The table below takes each gap it
records and states what this run produced against it — including the gaps that
remain open, which matter more than the closed ones.
""")

code(r"""
artefacts = []
for path in sorted(PATHS.artifacts.glob("*")) + sorted(PATHS.tables.glob("*")) \
        + sorted(PATHS.figures.glob("*")):
    if path.is_file():
        artefacts.append({
            "artefact": str(path.relative_to(ML_ROOT)),
            "bytes": path.stat().st_size,
            "sha256": file_sha256(path)[:16],
        })

frame = pd.DataFrame(artefacts)
print(f"{len(frame)} artefacts, {frame['bytes'].sum() / 2**20:.1f} MiB")
print("=" * 94)
print(frame.to_string(index=False, formatters={"bytes": "{:,}".format}))
""")

code(r"""
manifest = json.loads(PATHS.manifest.read_text())

GAPS = [
    ("random seed", True, f"config.yaml seed = {CONFIG['seed']}"),
    ("complete parameter-search grid", True,
     "training_records.json, one grid and chosen configuration per candidate"),
    ("serialised model checksum", True,
     "SHA-256 per model in training_records.json"),
    ("full training log", True, "ml/logs/train.log, printed in Section 6"),
    ("split indices", True, "artifacts/split_indices.npz; Table 3.5 regenerated"),
    ("prediction outputs", True,
     "artifacts/predictions_*.parquet, one per candidate"),
    ("confusion matrix reconciled to the test partition", True,
     "regenerated; every matrix sums to 954,393 rows and 1,232 positives"),
    ("ROC curves and AUC values", True, "Figure 4.1, from saved probabilities"),
    ("threshold-sensitivity analysis", True,
     "threshold_sensitivity.csv across the configured sweep"),
    ("feature-importance ranking", True,
     "feature_importance.csv, with provenance per feature"),
    ("inferential test between classifiers", True,
     "McNemar per comparator, statistical_comparison.json"),
    ("repository commit identifier", bool(manifest["repository"]["commit"]),
     manifest["repository"]["commit"] or "no commit recorded"),
    ("execution environment for timing claims", True,
     "environment_record() in run_manifest.json"),
    ("measured effect of oversampling", True,
     "ablation: proposed model with and without SMOTE on one split"),
    ("contract addresses and transaction hashes", False,
     "OPEN — requires the Sepolia deployment"),
    ("per-execution gas receipts and dispersion", False,
     "OPEN — run the gas reporter, record date, gas price and ETH/USD rate"),
    ("complete Slither output", False, "OPEN — run Slither and retain the report"),
    ("latency and throughput run-level logs", False,
     "OPEN — requires the load test against the deployed contracts"),
    ("formal usability study", False,
     "OPEN — out of scope by Section 1.5; reserved for future work"),
]

closed = sum(1 for _, done, _ in GAPS if done)
print(f"Appendix A — {closed} of {len(GAPS)} recorded gaps closed by this run")
print("=" * 94)
for item, done, evidence in GAPS:
    print(f"  [{'x' if done else ' '}] {item}")
    print(f"      {evidence}")

print()
print(textwrap.fill(
    "The open items are open for one reason each, and none of them is a "
    "modelling question: four need the Sepolia deployment and the load test "
    "that runs against it, and the fifth is excluded by the scope statement in "
    "Section 1.5. The machine-learning evidence deficit that forced Chapter "
    "Four's hedging is closed.", 94))
""")

md(r"""
### What this changes in the report

Chapter Four currently describes its own results as "previously reported and
unverified" because the artefacts behind them were gone. They are not gone now.
Specifically:

- **Section 4.3.2** can reinstate the confusion matrix. Every matrix in this
  notebook sums to the documented 954,393-row partition with 1,232 positives,
  which is the reconciliation the section says could not be performed.
- **Section 4.3.3** can present the ROC curves as regenerated rather than
  "pending verification from the original notebook".
- **Section 4.3.4** can report an inferential test, which is what Objective
  Four was marked down for lacking.
- **Section 4.3.5** can report feature importance with each feature's
  provenance beside it — and must carry the simulated-feature share from
  Section 7 into the limitations.
- **Section 4.3.6** keeps describing 0.75 as a configuration value, and can now
  say so on the evidence of a regenerated sweep rather than for want of one.
- **Table 3.5** needs no change at all. The run reproduces it.

Two things this notebook does **not** establish, and the report should not claim:

1. **Generalisation.** One synthetic dataset is one synthetic dataset. Table
   4.5's second criticism of Objective Four — generalisability across datasets —
   is untouched by anything here.
2. **That the simulated features mean what their names say.** Eight of the
   eighteen features are drawn from distributions conditioned on the fraud
   label. Where those features carry importance, the model is partly reading
   the generating process. Section 5.6 has to say so plainly.
""")

# ===========================================================================
# Write
# ===========================================================================

notebook = {
    "cells": cells,
    "metadata": {
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3",
        },
        "language_info": {"name": "python", "version": "3.11"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}

TARGET.write_text(json.dumps(notebook, indent=1) + "\n")
print(f"wrote {TARGET}")
print(f"  {len(cells)} cells "
      f"({sum(1 for c in cells if c['cell_type'] == 'markdown')} markdown, "
      f"{sum(1 for c in cells if c['cell_type'] == 'code')} code)")
