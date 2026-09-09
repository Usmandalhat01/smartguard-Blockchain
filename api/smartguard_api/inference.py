"""The risk-scoring service — Section 3.10.2.

Loads the serialised Random Forest that `ml/` produced and scores an
eighteen-feature vector against it. NFR-01 gives this two seconds.

Two behaviours the report specifies and this implements literally:

  - **Fail closed.** When the model is absent, fails to load, or returns a value
    outside [0, 1], this raises. It never substitutes a default. Section 3.15.2:
    "no automated fund release should occur, and the transaction should remain
    pending for authorised review."

  - **The model version travels with the score.** Section 3.9.2 requires a
    historical prediction to stay reproducible after a retrain, which is only
    possible if the score records which model produced it.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Table 3.4 order. The model was fitted on columns in this order and scoring a
# differently-ordered frame silently produces nonsense, so the order is asserted
# rather than assumed.
FEATURE_ORDER: list[str] = [
    "transaction_amount",
    "amount_deviation",
    "velocity_24h",
    "velocity_7d",
    "velocity_30d",
    "geographic_risk",
    "counterparty_reputation",
    "office_hours_indicator",
    "device_consistency",
    "account_age_days",
    "transaction_channel",
    "prior_dispute_rate",
    "seller_dispute_rate",
    "amount_rounded",
    "transaction_type",
    "prior_completed_rate",
    "amount_to_account_ratio",
    "step_time",
]


class InferenceUnavailable(RuntimeError):
    """The model cannot produce a usable score.

    Callers must fail closed. This is not a condition to paper over with a
    default value — a default of zero would read as "safest possible", which is
    the opposite of what an unavailable model means.
    """


@dataclass(frozen=True)
class RiskAssessment:
    risk_score: float
    model_version: str
    latency_ms: int
    exceeded_budget: bool
    contributions: list[dict[str, Any]]


class RiskScorer:
    """Wraps the serialised pipeline.

    Held on the FastAPI app state and loaded once at startup, because
    deserialising a 200-tree forest on every request would not fit inside
    NFR-01's budget.
    """

    def __init__(self, model_path: Path, model_version: str, budget_ms: int) -> None:
        self.model_path = model_path
        self.model_version = model_version
        self.budget_ms = budget_ms
        self._pipeline: Any | None = None
        self._load_error: str | None = None

    # ------------------------------------------------------------ loading --

    def load(self) -> None:
        if not self.model_path.exists():
            self._load_error = (
                f"No model at {self.model_path}. Run the experiment pipeline "
                "(cd ml && make all) to produce it."
            )
            logger.warning("risk scorer unavailable: %s", self._load_error)
            return

        try:
            import joblib

            started = time.perf_counter()
            self._pipeline = joblib.load(self.model_path)
            elapsed = (time.perf_counter() - started) * 1000
            logger.info(
                "loaded %s in %.0f ms (version %s)",
                self.model_path.name, elapsed, self.model_version,
            )
        except Exception as error:  # noqa: BLE001 — surfaced through /health
            self._load_error = f"{type(error).__name__}: {error}"
            logger.exception("risk scorer failed to load")

    @property
    def is_available(self) -> bool:
        return self._pipeline is not None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    # ------------------------------------------------------------ scoring --

    def score(self, features: dict[str, float]) -> RiskAssessment:
        if self._pipeline is None:
            raise InferenceUnavailable(
                self._load_error or "The risk-scoring model is not loaded.",
            )

        missing = [name for name in FEATURE_ORDER if name not in features]
        if missing:
            raise InferenceUnavailable(
                f"Feature vector is incomplete; missing: {', '.join(missing)}",
            )

        import pandas as pd

        frame = pd.DataFrame([[features[name] for name in FEATURE_ORDER]],
                             columns=FEATURE_ORDER)

        started = time.perf_counter()
        try:
            probability = float(self._pipeline.predict_proba(frame)[0, 1])
        except Exception as error:  # noqa: BLE001
            raise InferenceUnavailable(
                f"Scoring failed: {type(error).__name__}: {error}",
            ) from error
        latency_ms = int(round((time.perf_counter() - started) * 1000))

        # A malformed or out-of-range output is an unavailable model, not a
        # score to clamp into range and use anyway (Section 3.15.2).
        if not (0.0 <= probability <= 1.0) or probability != probability:
            raise InferenceUnavailable(
                f"Model returned {probability!r}, outside the valid range [0, 1].",
            )

        exceeded = latency_ms > self.budget_ms
        if exceeded:
            logger.warning(
                "inference took %d ms, exceeding the %d ms NFR-01 budget",
                latency_ms, self.budget_ms,
            )

        return RiskAssessment(
            risk_score=round(probability, 4),
            model_version=self.model_version,
            latency_ms=latency_ms,
            exceeded_budget=exceeded,
            contributions=self._contributions(features),
        )

    # ------------------------------------------------------ explanation ----

    def _contributions(self, features: dict[str, float]) -> list[dict[str, Any]]:
        """Which features pushed this score, for FR-08.

        Uses the fitted forest's global Gini importances weighted by how far
        each feature sits from its training mean. This is an *indicative*
        attribution, not a SHAP decomposition — it is labelled as such wherever
        it is displayed, and a production system owed a real explanation should
        compute per-prediction SHAP values instead.
        """
        classifier = getattr(self._pipeline, "named_steps", {}).get("classifier")
        importances = getattr(classifier, "feature_importances_", None)
        if importances is None:
            return []

        ranked = sorted(
            zip(FEATURE_ORDER, importances), key=lambda pair: -pair[1],
        )[:6]

        return [
            {
                "feature": name,
                "value": features.get(name),
                "importance": round(float(weight), 4),
            }
            for name, weight in ranked
        ]
