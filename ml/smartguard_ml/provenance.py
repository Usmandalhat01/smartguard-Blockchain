"""Feature provenance, and what it does to the headline metrics.

Section 3.12.5 is explicit that eight of the eighteen features in Table 3.4 are
simulated proxies for escrow context PaySim does not carry, and that they are
drawn from distributions *conditioned on the fraud label*. `counterparty_reputation`
is Beta(2.0, 5.0) for a fraudulent row and Beta(9.0, 1.6) otherwise; those two
densities barely overlap.

The consequence is arithmetic, not opinion: a feature generated from the label
carries the label. Any classifier can recover it, which is why Table 4.1 reports
an ROC AUC of 1.0000 for logistic regression — a linear model on a problem that
is not linearly separable in its observed variables.

This module measures the size of the effect rather than arguing about it, in two
ways that answer different objections.

    1. Single-feature separability. Each feature alone, scored against the
       held-out labels. A simulated proxy that reaches 0.99 AUC on its own is
       not a weak prior; it is the answer written down.
    2. A provenance ablation. The proposed estimator, refitted on the features
       that are *observed or derived from observations* only, with the same
       split, the same hyperparameters and the same decision threshold. The
       difference between that and Table 4.1 is the part of the reported
       performance that the simulation supplied.

Neither measurement is a criticism of the design. A proxy that carried no signal
would make the escrow features decorative, which Section 3.12.5 says in as many
words. What cannot stand is reporting the resulting figure as the system's
fraud-detection performance, because the quantity being recovered is the
generator's input. The ablation gives the number that can be defended.
"""

from __future__ import annotations

import json
import time
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from . import models
from .config import PATHS, file_sha256
from .features import FEATURE_SPECS


def provenance_map() -> dict[str, str]:
    return {spec.name: spec.provenance for spec in FEATURE_SPECS}


def single_feature_auc(X: pd.DataFrame, y: pd.Series) -> pd.DataFrame:
    """Each feature's ROC AUC on its own, against the held-out labels.

    Orientation is irrelevant to separability — a feature that is perfectly
    anti-correlated with the label is just as informative as one perfectly
    correlated with it — so the AUC is folded above 0.5. A reader comparing
    features cares how much a feature knows, not which way it points.
    """
    prov = provenance_map()
    index = {spec.name: spec.index for spec in FEATURE_SPECS}
    truth = y.to_numpy()

    rows = []
    for name in X.columns:
        if name not in prov:
            continue
        values = X[name].to_numpy(dtype="float64")
        if np.all(values == values[0]):
            # A constant feature has no ROC curve; record it rather than crash.
            auc = 0.5
        else:
            auc = roc_auc_score(truth, values)
        rows.append({
            "index": index[name],
            "feature": name,
            "provenance": prov[name],
            "auc_alone": max(auc, 1.0 - auc),
        })

    return (
        pd.DataFrame(rows)
        .sort_values("auc_alone", ascending=False)
        .reset_index(drop=True)
    )


def _metrics(y_true: np.ndarray, proba: np.ndarray, threshold: float) -> dict[str, Any]:
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "accuracy": float(accuracy_score(y_true, pred)),
        "precision_fraud": float(precision_score(y_true, pred, zero_division=0)),
        "recall_fraud": float(recall_score(y_true, pred, zero_division=0)),
        "f1_fraud": float(f1_score(y_true, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, proba)),
        "true_negatives": int(tn),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_positives": int(tp),
    }


def _best_params(label: str) -> dict[str, Any]:
    """The hyperparameters the search already chose, so this is an ablation.

    Re-searching would confound two changes — the feature set and the
    configuration — and the comparison would no longer isolate provenance.
    """
    path = PATHS.outputs / "training_records.json"
    if not path.exists():
        return {}
    for record in json.loads(path.read_text()):
        if record["model"] == label:
            return {
                f"classifier__{k}": v
                for k, v in record["search"]["best_params"].items()
            }
    return {}


def ablate(
    label: str,
    spec: dict[str, Any],
    config: dict[str, Any],
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    drop_provenances: list[str],
    log=print,
) -> dict[str, Any]:
    """Refits `label` on the features whose provenance is not dropped."""
    prov = provenance_map()
    dropped = [c for c in X_train.columns if prov.get(c) in drop_provenances]
    retained = [c for c in X_train.columns if c not in dropped]

    log(f"  dropping {len(dropped)} {'/'.join(drop_provenances)} features, "
        f"retaining {len(retained)}")

    pipeline = models.build_pipeline(spec, config["balancing"], config["seed"])
    params = _best_params(label)
    if params:
        pipeline.set_params(**params)

    started = time.perf_counter()
    pipeline.fit(X_train[retained], y_train)
    fit_seconds = time.perf_counter() - started

    proba = pipeline.predict_proba(X_test[retained])[:, 1]
    threshold = config["threshold"]["configured"]
    measured = _metrics(y_test.to_numpy(), proba, threshold)

    model_path = PATHS.model(f"{label}_observed_only")
    joblib.dump(pipeline, model_path, compress=3)

    predictions = pd.DataFrame({
        "row_index": X_test.index.to_numpy(),
        "y_true": y_test.to_numpy(),
        "score": proba,
    })
    predictions.to_parquet(PATHS.predictions(f"{label}_observed_only"), index=False)

    classifier = pipeline.named_steps["classifier"]
    importances = getattr(classifier, "feature_importances_", None)

    return {
        "model": label,
        "variant": "observed_and_derived_only",
        "dropped_provenances": drop_provenances,
        "dropped_features": dropped,
        "retained_features": retained,
        "threshold": threshold,
        "training_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "fit_seconds": round(fit_seconds, 2),
        "metrics": measured,
        "artifact": {
            "model": str(model_path.relative_to(PATHS.root)),
            "sha256": file_sha256(model_path),
        },
        "importances": (
            None if importances is None else
            sorted(
                ({"feature": f, "importance": float(v)}
                 for f, v in zip(retained, importances)),
                key=lambda r: r["importance"], reverse=True,
            )
        ),
    }


def full_feature_metrics(label: str, threshold: float) -> dict[str, Any] | None:
    """The all-eighteen-feature figures, from the predictions already written.

    Taken from the saved probabilities rather than by refitting, so this side of
    the comparison is the same scoring run Table 4.1 is built from, and scored
    through the same `_metrics` as the ablation so the two cannot differ by
    anything except the feature set.
    """
    path = PATHS.predictions(label)
    if not path.exists():
        return None
    frame = pd.read_parquet(path)
    return _metrics(
        frame["y_true"].to_numpy(), frame["score"].to_numpy(), threshold,
    )


# ------------------------------------------------- dataset separability ----

# The columns PaySim ships. Read directly from the source CSV rather than from
# the feature matrix, because the question is about the *dataset*, not about
# what feature engineering made of it.
_RAW_COLUMNS = ["type", "amount", "oldbalanceOrg", "newbalanceOrig", "isFraud"]


def dataset_separability(source_csv: Any) -> dict[str, Any]:
    """How much of the label PaySim's raw columns already determine.

    This exists because the provenance ablation produced a result that needed
    explaining. Dropping every label-conditioned proxy did not reduce
    performance, which rules out the simulated features as the source of the
    near-perfect metrics and leaves the dataset itself.

    PaySim generates fraud as a complete drain of the originating account, so
    `amount` equals `oldbalanceOrg` almost whenever the row is fraudulent and
    almost never otherwise. That is a deterministic signature, and a single
    hand-written rule recovers the label from it without any model. The
    measurement below is what licenses Section 3.19 to say the reported accuracy
    is a property of the simulator rather than evidence about real fraud.
    """
    frame = pd.read_csv(source_csv, usecols=_RAW_COLUMNS)
    fraud = frame["isFraud"].to_numpy() == 1

    drained = np.isclose(frame["amount"].to_numpy(),
                         frame["oldbalanceOrg"].to_numpy())
    emptied = frame["newbalanceOrig"].to_numpy() == 0
    rule = drained & emptied

    def share(mask: np.ndarray, within: np.ndarray) -> float:
        return float(mask[within].mean()) if within.any() else float("nan")

    matched = int(rule.sum())
    return {
        "rows": int(len(frame)),
        "fraud_rows": int(fraud.sum()),
        "signatures": {
            "amount_equals_old_balance": {
                "description": "The transaction drained the originating account exactly.",
                "share_of_fraud": share(drained, fraud),
                "share_of_legitimate": share(drained, ~fraud),
                "count_fraud": int(drained[fraud].sum()),
                "count_legitimate": int(drained[~fraud].sum()),
            },
            "new_balance_zero": {
                "description": "The originating account was left empty.",
                "share_of_fraud": share(emptied, fraud),
                "share_of_legitimate": share(emptied, ~fraud),
            },
            "drained_and_emptied": {
                "description": "Both conditions together, used as the rule below.",
                "share_of_fraud": share(rule, fraud),
                "share_of_legitimate": share(rule, ~fraud),
            },
        },
        # No model, no training, no features: one boolean expression.
        "rule_without_a_model": {
            "rule": "amount == oldbalanceOrg and newbalanceOrig == 0",
            "predicted_positive": matched,
            "precision": float(fraud[rule].mean()) if matched else float("nan"),
            "recall": share(rule, fraud),
        },
        "interpretation": (
            "PaySim's fraud is a near-deterministic account drain, so a single "
            "boolean rule recovers the label at high precision and recall with "
            "no model at all. The classification metrics in Chapter Four are "
            "therefore bounded by the simulator's construction and should not be "
            "read as evidence of performance on real escrow fraud."
        ),
    }
