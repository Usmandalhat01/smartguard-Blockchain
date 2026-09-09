"""Liveness and readiness.

Reports `degraded` rather than `ok` when the model is unavailable, because the
service still answers requests in that state but cannot admit an escrow — and a
health check that says `ok` while the gate is inoperable is worse than none.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> HealthResponse:
    try:
        db.execute(text("SELECT 1"))
        database_ok = True
    except Exception:  # noqa: BLE001
        database_ok = False

    scorer = request.app.state.scorer

    return HealthResponse(
        status="ok" if (database_ok and scorer.is_available) else "degraded",
        database=database_ok,
        model=scorer.is_available,
        modelError=scorer.load_error,
        modelVersion=settings.model_version,
        version=request.app.version,
    )
