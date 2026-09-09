"""Prediction against the held-out test partition.

This stage writes *probabilities*, not metrics. That inversion is the answer to
correction 2: because nothing here computes a confusion matrix, an F1 or an AUC,
there is no opportunity for those figures to be computed from different data.
report.py derives all of them later from the files written here.

The test partition is read exactly once, at this point, and never during
training or model selection.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
import pandas as pd
import joblib

from . import models
from .config import PATHS


def _scores(pipeline, X: pd.DataFrame) -> tuple[np.ndarray, str]:
    """Continuous score for the fraud class.

    Estimators with `predict_proba` give a calibrated probability. SGDClassifier
    under hinge loss has only a decision function, so its margin is min-max
    scaled into [0, 1]. That is a monotone transform, so ROC-AUC is unaffected,
    but the values are not probabilities and are labelled accordingly wherever
    they appear.
    """
    if models.supports_proba(pipeline):
        return pipeline.predict_proba(X)[:, 1], "probability"

    margins = pipeline.decision_function(X)
    low, high = margins.min(), margins.max()
    if high == low:
        return np.full_like(margins, 0.5, dtype="float64"), "scaled_margin"
    return ((margins - low) / (high - low)), "scaled_margin"


def evaluate_one(
    label: str, X_test: pd.DataFrame, y_test: pd.Series,
) -> dict[str, Any]:
    """Loads a saved model, predicts, writes the prediction file."""
    pipeline = joblib.load(PATHS.model(label))

    started = time.perf_counter()
    scores, score_kind = _scores(pipeline, X_test)
    inference_seconds = time.perf_counter() - started

    frame = pd.DataFrame({
        # The row index within the original feature matrix, so a prediction can
        # always be traced back to the record that produced it.
        "row_index": y_test.index.to_numpy(),
        "y_true": y_test.to_numpy().astype("int8"),
        "score": scores.astype("float32"),
    })
    frame.to_parquet(PATHS.predictions(label), index=False)

    per_row_ms = inference_seconds / max(len(X_test), 1) * 1000

    print(
        f"  [{label}] scored {len(X_test):,} rows in {inference_seconds:.2f}s "
        f"({per_row_ms * 1000:.1f} µs/row)",
    )

    return {
        "model": label,
        "score_kind": score_kind,
        "test_rows": int(len(X_test)),
        "test_fraud": int(y_test.sum()),
        "inference_seconds": round(inference_seconds, 4),
        "microseconds_per_row": round(per_row_ms * 1000, 2),
        "predictions": str(PATHS.predictions(label).relative_to(PATHS.root)),
    }
