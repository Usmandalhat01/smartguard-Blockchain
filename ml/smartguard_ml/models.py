"""Model construction — Section 3.12.3.

Each candidate is built as an imbalanced-learn Pipeline with SMOTE as the first
step. That placement is the whole point: a Pipeline applies SMOTE inside each
cross-validation fold, to the training portion only, so no synthetic record
reaches a fold's validation portion. Resampling before the split is the error
Section 3.13.3 warns about, and using a Pipeline makes it structurally
impossible rather than merely avoided.
"""

from __future__ import annotations

from typing import Any

from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline as ImbPipeline
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

ESTIMATORS = {
    "RandomForestClassifier": RandomForestClassifier,
    "LogisticRegression": LogisticRegression,
    "DecisionTreeClassifier": DecisionTreeClassifier,
    "SGDClassifier": SGDClassifier,
    "HistGradientBoostingClassifier": HistGradientBoostingClassifier,
}

# Estimators whose optimisation is scale-sensitive. Trees are not.
NEEDS_SCALING = {"LogisticRegression", "SGDClassifier"}


def build_pipeline(
    spec: dict[str, Any],
    balancing: dict[str, Any],
    seed: int,
    *,
    balance: bool = True,
) -> ImbPipeline:
    """Assembles one candidate.

    Args:
        spec: an entry from config.yaml's `models` block.
        balancing: config.yaml's `balancing` block.
        seed: the run seed, threaded into every stochastic component.
        balance: False builds the same pipeline without SMOTE, for the
            ablation Section 2.9 promised and Chapter Four never reported.
    """
    name = spec["estimator"]
    estimator_class = ESTIMATORS[name]

    kwargs: dict[str, Any] = dict(spec.get("fixed", {}))
    if "random_state" in estimator_class().get_params():
        kwargs["random_state"] = seed

    steps: list[tuple[str, Any]] = []

    if balance and balancing.get("method") == "smote":
        steps.append((
            "smote",
            SMOTE(
                sampling_strategy=balancing.get("sampling_strategy", 1.0),
                k_neighbors=balancing.get("k_neighbors", 5),
                random_state=seed,
            ),
        ))

    if name in NEEDS_SCALING:
        steps.append(("scaler", StandardScaler()))

    steps.append(("classifier", estimator_class(**kwargs)))
    return ImbPipeline(steps)


def grid_for(spec: dict[str, Any]) -> dict[str, list[Any]]:
    """Prefixes the grid keys so they address the pipeline's classifier step."""
    return {f"classifier__{key}": values for key, values in spec.get("grid", {}).items()}


def supports_proba(pipeline: ImbPipeline) -> bool:
    """SGDClassifier with hinge loss has no predict_proba; its decision function
    is used instead and min-max scaled for the ROC curve. Recorded here so the
    evaluation stage does not silently produce a different kind of score for one
    comparator without saying so."""
    return hasattr(pipeline.named_steps["classifier"], "predict_proba")
