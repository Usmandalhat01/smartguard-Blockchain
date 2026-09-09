# Experiment pipeline

The machine-learning half of the prototype, structured so that Chapter Four can
be written from emitted artefacts rather than from memory.

## Why it is shaped like this

The verification review's most serious finding was that Chapter Four contained
"mutually incompatible empirical results": a confusion matrix that did not
produce the reported metrics, a test partition that contradicted Chapter Three,
and a threshold justified by curves whose underlying predictions no longer
existed.

Every one of those is a symptom of the same cause — figures computed at
different times from different data, with nothing tying them together. The
pipeline removes the possibility rather than guarding against it:

| Stage | Reads | Writes |
| ----- | ----- | ------ |
| `features` | PaySim CSV | `features.parquet`, `docs/proxy_spec.md` |
| `split` | `features.parquet` | `split_indices.npz`, Table 3.5 |
| `train` | features + indices | `model_*.joblib`, params, SHA-256 |
| `evaluate` | features + indices + models | `predictions_*.parquet` |
| `report` | **predictions only** | every figure, table and metric |

`report.py` cannot load a model, cannot read the raw data and cannot
re-partition anything. It has access to one array of true labels and one array
of scores per model. If Table 4.1 says the F1 is 0.62, the confusion matrix
beside it produces 0.62, because they are the same three lines of code applied
to the same array.

## Running it

```bash
make setup                                  # virtualenv, pinned dependencies
python scripts/make_sample_paysim.py        # development stand-in
make all
```

For the run that goes in the report, put the real PaySim CSV at
`data/raw/PS_20174392719_1491204439457_log.csv`, set `dataset.source_csv` to
point at it and `dataset.sample_frac` to `1.0`, then `make all`.

Develop with `sample_frac` at 0.02 or so — iterations take seconds instead of
hours, and the pipeline behaves identically because the sample is stratified.

## The dataset

PaySim, López-Rojas, Elmir and Axelsson (2016). Kaggle: `ealaxi/paysim1`.
6,362,620 rows, 8,213 labelled fraud cases, about 470 MB.

```bash
kaggle datasets download -d ealaxi/paysim1 -p data/raw --unzip
```

Only `TRANSFER` and `CASH_OUT` rows are kept. PaySim labels fraud on those two
operation types only, so the other three contribute rows that cannot be positive
by construction — they inflate accuracy and teach the model nothing.

## What each correction this closes

| Correction | How |
| ---------- | --- |
| 1 · single test partition | `split.py` writes indices once; every stage loads them and none may create its own |
| 2 · regenerate from saved predictions | `report.py` reads only `predictions_*.parquet` |
| 3 · remove unverified claims | whatever this pipeline emits replaces them |
| 4 · the "edges out" ranking | McNemar decides whether any ranking claim is admissible |
| 5 · threshold sensitivity | swept from saved probabilities; the report is told when 0.75 is not the optimum |
| 7 · role of the validation partition | the procedure is `train.py`'s docstring and its code |
| 9 · proxy generation | `docs/proxy_spec.md` is generated, with distributions and seed |
| 10 · duplicate and missing counts | counted and written to `preprocessing_counts.json` |
| 12 · SMOTE ablation | `ablation.enabled` fits the proposed model without SMOTE on the same split |

## Reproducibility

A run is fully described by `config.yaml` plus the commit that ran it.
`outputs/run_manifest.json` records the seed, a SHA-256 of the configuration,
the commit, whether the working tree was dirty, the Python and library versions,
the CPU count and the total memory.

Every model artefact carries its own SHA-256. Appendix A lists the seed, the
parameter grid and the model checksum as missing; all three are emitted here.

## A note on the simulated proxies

Seven of the eighteen features do not exist in PaySim and are generated. They
are drawn conditionally on the fraud label, because a proxy independent of the
label would carry no signal and one determined by it would leak the answer. The
distributions overlap heavily, so no single proxy separates the classes.

`docs/proxy_spec.md` states every distribution and its parameters. Results
obtained with these variables demonstrate that the pipeline works; they are not
evidence about real escrow transactions, and the report must not present them as
such.
