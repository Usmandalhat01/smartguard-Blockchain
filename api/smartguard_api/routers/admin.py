"""Administration — settings, audit log, model card.

Every route here is guarded by a distinct permission. Reading configuration and
writing it are separate grants, because an auditor who may inspect the gate is
not thereby entitled to move it.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..inference import FEATURE_ORDER
from ..models import AuditLayer, AuditLog
from ..schemas import AuditOut, SettingsOut, SettingsUpdate
from ..security import CurrentUser, require
from ..settings_store import current as current_settings, update as update_settings

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/settings",
    response_model=SettingsOut,
    dependencies=[Depends(require("admin:settings:read"))],
)
def read_settings(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SettingsOut:
    return SettingsOut(**current_settings(db, settings))


@router.put(
    "/settings",
    response_model=SettingsOut,
    dependencies=[Depends(require("admin:settings:write"))],
)
def write_settings(
    payload: SettingsUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SettingsOut:
    update_settings(db, payload.model_dump(exclude_none=True), user)
    db.commit()
    return SettingsOut(**current_settings(db, settings))


@router.get(
    "/audit",
    response_model=list[AuditOut],
    dependencies=[Depends(require("admin:audit:read"))],
)
def read_audit(
    db: Annotated[Session, Depends(get_db)],
    layer: AuditLayer | None = None,
    transaction_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
) -> list[AuditLog]:
    query = db.query(AuditLog)
    if layer is not None:
        query = query.filter(AuditLog.layer == layer)
    if transaction_id is not None:
        query = query.filter(AuditLog.transaction_id == transaction_id)
    return query.order_by(AuditLog.created_at.desc()).limit(limit).all()


@router.get("/model", dependencies=[Depends(require("admin:model:read"))])
def model_card(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """What the deployed model is, and what is not known about it.

    The absent fields are reported explicitly rather than omitted. Appendix A
    lists the seed, parameter grid and checksum as missing; a model card that
    quietly left them out would repeat that.
    """
    scorer = request.app.state.scorer

    return {
        "modelVersion": settings.model_version,
        "available": scorer.is_available,
        "loadError": scorer.load_error,
        "path": str(scorer.model_path),
        "featureOrder": FEATURE_ORDER,
        "featureCount": len(FEATURE_ORDER),
        "inferenceBudgetMs": settings.inference_budget_ms,
        "provenance": {
            "note": (
                "Produced by the experiment pipeline in ml/. The run manifest at "
                "ml/outputs/run_manifest.json carries the seed, the configuration "
                "checksum, the commit and the environment."
            ),
        },
    }
