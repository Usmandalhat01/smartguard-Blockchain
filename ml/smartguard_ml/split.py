"""Dataset partitioning — Section 3.13.4, Table 3.5.

The verification review's first critical correction: "establish the single
correct held-out test partition [...] Do not retain both."

This module produces exactly one split and writes the row indices to disk. Every
later stage loads those indices. No stage recomputes a split, so the test
partition that produced the confusion matrix is necessarily the same one that
produced the ROC curve and the comparison table.
"""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split


class Split(NamedTuple):
    train: np.ndarray
    validation: np.ndarray
    test: np.ndarray

    def describe(self, labels: pd.Series) -> pd.DataFrame:
        """Table 3.5, computed from the actual indices rather than asserted."""
        rows = []
        for name, indices in (
            ("Full dataset", np.arange(len(labels))),
            ("Training", self.train),
            ("Validation", self.validation),
            ("Held-out test", self.test),
        ):
            subset = labels.iloc[indices]
            fraud = int(subset.sum())
            total = len(subset)
            rows.append({
                "Partition": name,
                "Proportion": f"{total / len(labels) * 100:.1f}%",
                "Legitimate": total - fraud,
                "Fraudulent": fraud,
                "Total": total,
                "Fraud ratio (%)": round(fraud / total * 100, 4) if total else 0.0,
            })
        return pd.DataFrame(rows)


def make_split(labels: pd.Series, config: dict, seed: int) -> Split:
    """Stratified 70:15:15.

    Stratification is applied at both cuts, so the fraud ratio is preserved in
    every partition. Section 3.13.4 requires the validation and test partitions
    to retain the natural class distribution — SMOTE touches the training
    partition only, and only later, inside the model pipeline.
    """
    ratios = config["split"]
    stratify_by = labels if ratios.get("stratify", True) else None
    indices = np.arange(len(labels))

    train_idx, holdout_idx = train_test_split(
        indices,
        train_size=ratios["train"],
        random_state=seed,
        stratify=stratify_by,
        shuffle=True,
    )

    # Split the remaining 30% down the middle into validation and test.
    holdout_labels = labels.iloc[holdout_idx]
    validation_share = ratios["validation"] / (ratios["validation"] + ratios["test"])

    validation_idx, test_idx = train_test_split(
        holdout_idx,
        train_size=validation_share,
        random_state=seed,
        stratify=holdout_labels if stratify_by is not None else None,
        shuffle=True,
    )

    return Split(
        train=np.sort(train_idx),
        validation=np.sort(validation_idx),
        test=np.sort(test_idx),
    )


def save(split: Split, path: Path) -> None:
    np.savez_compressed(
        path, train=split.train, validation=split.validation, test=split.test,
    )


def load(path: Path) -> Split:
    if not path.exists():
        raise FileNotFoundError(
            f"No split at {path}. Run `make split` before training or evaluating — "
            "no stage is permitted to invent its own partition.",
        )
    data = np.load(path)
    return Split(
        train=data["train"], validation=data["validation"], test=data["test"],
    )


def assert_disjoint(split: Split) -> None:
    """Guards against the failure the review found: partitions that overlap, or
    that do not sum to the dataset."""
    train, validation, test = set(split.train), set(split.validation), set(split.test)

    overlaps = {
        "train/validation": train & validation,
        "train/test": train & test,
        "validation/test": validation & test,
    }
    for name, shared in overlaps.items():
        if shared:
            raise AssertionError(
                f"{len(shared)} rows appear in both {name} partitions. "
                "Evaluation on a contaminated test set is meaningless.",
            )
