"""Risk scoring — `POST /api/v1/risk/score`. FR-02, NFR-01.

Scoring is a separate endpoint from escrow creation so the buyer can see the
assessment, and the features behind it, before committing funds. That ordering
is what FR-08 describes: the score is shown "to the buyer at initiation", not
reported after the fact.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..features import build_vector
from ..inference import InferenceUnavailable
from ..models import AuditLayer
from ..schemas import Contribution, RiskScoreResponse, ScoringInput
from ..security import CurrentUser, require
from ..settings_store import current as current_settings
from .. import audit

router = APIRouter(prefix="/risk", tags=["risk"])


@router.post(
    "/score",
    response_model=RiskScoreResponse,
    dependencies=[Depends(require("escrow:create"))],
)
def score(
    payload: ScoringInput,
    request: Request,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> RiskScoreResponse:
    scorer = request.app.state.scorer
    config = current_settings(db, settings)
    threshold = float(config["riskThreshold"])

    try:
        assessment = scorer.score(build_vector(payload))
    except InferenceUnavailable as error:
        # Section 3.15.2 and 3.7.1. Failing closed refuses the escrow outright;
        # failing open routes it to manual review. Neither releases funds, and
        # neither invents a score.
        audit.record(
            db,
            layer=AuditLayer.APPLICATION,
            event_type="ai.inference.failed",
            summary=f"Risk scoring failed: {error}",
            actor=user,
        )
        db.commit()

        if config["failClosedOnInferenceError"]:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "The risk-scoring service is unavailable. The system is "
                    "configured to fail closed, so this escrow cannot be "
                    "initiated until scoring succeeds."
                ),
            ) from error

        raise HTTPException(
            status_code=status.HTTP_202_ACCEPTED,
            detail=(
                "The risk-scoring service is unavailable. This request has been "
                "routed to manual review; no funds have been committed."
            ),
        ) from error

    audit.record(
        db,
        layer=AuditLayer.APPLICATION,
        event_type="ai.inference",
        summary=(
            f"Risk score {assessment.risk_score:.4f} returned in "
            f"{assessment.latency_ms} ms (model {assessment.model_version})."
        ),
        actor=user,
        detail={
            "riskScore": assessment.risk_score,
            "latencyMs": assessment.latency_ms,
            "exceededBudget": assessment.exceeded_budget,
            "threshold": threshold,
        },
    )
    db.commit()

    return RiskScoreResponse(
        riskScore=assessment.risk_score,
        modelVersion=assessment.model_version,
        latencyMs=assessment.latency_ms,
        exceededBudget=assessment.exceeded_budget,
        threshold=threshold,
        withinGate=assessment.risk_score <= threshold,
        contributions=[Contribution(**c) for c in assessment.contributions],
    )
