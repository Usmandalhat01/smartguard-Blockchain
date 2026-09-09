"""Model fitting — Section 3.13.4.

Correction 7 asks the report to "explicitly explain the role of the 15%
validation set [...] and at exactly what point it was accessed". The procedure
below is that explanation, in the only form that cannot be misremembered:

    1. Hyperparameters are searched by k-fold cross-validation *within the
       training partition only*, on a stratified subsample of it. The full
       training partition is millions of rows; searching over it is not
       tractable, and the subsample size is recorded in config.yaml.
    2. The winning configuration is scored once against the held-out validation
       partition, which no fitting has touched.
    3. The final estimator is refitted on the complete training partition.
    4. The test partition is not read here at all. evaluate.py reads it once.

Every fit writes its estimator, its resolved parameters and a SHA-256 of the
serialised model. Appendix A records all three as missing.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.metrics import f1_score

from . import models
from .config import PATHS, file_sha256


def _search_subsample(
    X: pd.DataFrame, y: pd.Series, n_rows: int, seed: int,
) -> tuple[pd.DataFrame, pd.Series]:
    """A stratified subsample of the training partition for the grid search.

    Returns the whole partition when it is already small enough, so a
    development run with sample_frac < 1.0 does not subsample twice.
    """
    if n_rows >= len(X):
        return X, y

    rng = np.random.default_rng(seed)
    fraud_idx = np.flatnonzero(y.to_numpy() == 1)
    legit_idx = np.flatnonzero(y.to_numpy() == 0)

    fraud_share = len(fraud_idx) / len(y)
    take_fraud = max(2, int(round(n_rows * fraud_share)))
    take_legit = n_rows - take_fraud

    chosen = np.concatenate([
        rng.choice(fraud_idx, size=min(take_fraud, len(fraud_idx)), replace=False),
        rng.choice(legit_idx, size=min(take_legit, len(legit_idx)), replace=False),
    ])
    chosen.sort()
    return X.iloc[chosen], y.iloc[chosen]


def train_one(
    name: str,
    spec: dict[str, Any],
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_validation: pd.DataFrame,
    y_validation: pd.Series,
    config: dict[str, Any],
    *,
    balance: bool = True,
    suffix: str = "",
) -> dict[str, Any]:
    """Fits one candidate and returns its record for the run manifest."""
    seed = config["seed"]
    selection = config["model_selection"]
    label = f"{name}{suffix}"

    pipeline = models.build_pipeline(spec, config["balancing"], seed, balance=balance)
    grid = models.grid_for(spec)

    print(f"  [{label}] searching {max(1, len(grid) and np.prod([len(v) for v in grid.values()]))} "
          f"configuration(s) by {selection['cv_folds']}-fold CV")

    started = time.perf_counter()

    # --- step 1: cross-validated search, inside the training partition -----
    X_search, y_search = _search_subsample(
        X_train, y_train, selection["search_sample_rows"], seed,
    )

    if grid:
        search = GridSearchCV(
            pipeline,
            param_grid=grid,
            scoring=selection["scoring"],
            cv=StratifiedKFold(
                n_splits=selection["cv_folds"], shuffle=True, random_state=seed,
            ),
            n_jobs=1,          # the estimators already parallelise internally
            refit=True,
            error_score="raise",
        )
        search.fit(X_search, y_search)
        best_params = search.best_params_
        cv_score = float(search.best_score_)
    else:
        pipeline.fit(X_search, y_search)
        best_params = {}
        cv_score = float("nan")

    search_seconds = time.perf_counter() - started

    # --- step 2: score once against the untouched validation partition -----
    tuned = models.build_pipeline(spec, config["balancing"], seed, balance=balance)
    tuned.set_params(**best_params)
    tuned.fit(X_search, y_search)
    validation_f1 = float(
        f1_score(y_validation, tuned.predict(X_validation), zero_division=0),
    )

    # --- step 3: refit on the complete training partition -------------------
    print(f"  [{label}] refitting on {len(X_train):,} training rows")
    refit_started = time.perf_counter()

    final = models.build_pipeline(spec, config["balancing"], seed, balance=balance)
    final.set_params(**best_params)
    final.fit(X_train, y_train)

    fit_seconds = time.perf_counter() - refit_started

    model_path = PATHS.model(label)
    joblib.dump(final, model_path, compress=3)

    record = {
        "model": label,
        "estimator": spec["estimator"],
        "balanced": balance,
        "proposed": bool(spec.get("proposed", False)),
        "search": {
            "grid": {k.replace("classifier__", ""): v for k, v in grid.items()},
            "cv_folds": selection["cv_folds"],
            "scoring": selection["scoring"],
            "sample_rows": int(len(X_search)),
            "best_params": {
                k.replace("classifier__", ""): v for k, v in best_params.items()
            },
            "best_cv_score": cv_score,
            "seconds": round(search_seconds, 2),
        },
        "validation": {
            "rows": int(len(X_validation)),
            "f1_fraud": validation_f1,
        },
        "final_fit": {
            "training_rows": int(len(X_train)),
            "seconds": round(fit_seconds, 2),
        },
        "artifact": {
            "path": str(model_path.relative_to(PATHS.root)),
            "sha256": file_sha256(model_path),
            "bytes": model_path.stat().st_size,
        },
    }

    print(
        f"  [{label}] CV F1 {cv_score:.4f} · validation F1 {validation_f1:.4f} · "
        f"{fit_seconds:.1f}s",
    )
    return record


def write_records(records: list[dict[str, Any]], path: Path) -> None:
    path.write_text(json.dumps(records, indent=2) + "\n")
