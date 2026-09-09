"""Administrator-configurable parameters, held in the database.

Section 3.18 requires the risk threshold to be adjustable "without requiring
changes to the deployed model code", and every change to land in the audit log
with the acting address. Environment variables satisfy neither.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .config import Settings
from .models import SystemSetting, User
from . import audit
from .models import AuditLayer

KEYS = {
    "riskThreshold": float,
    "timeLockHours": int,
    "holdingPeriodHours": int,
    "failClosedOnInferenceError": lambda v: v in ("true", "True", True, 1, "1"),
}


def current(db: Session, settings: Settings) -> dict[str, object]:
    """Database values, falling back to the environment defaults."""
    stored = {row.key: row.value for row in db.query(SystemSetting).all()}

    def get(key: str, default):
        if key not in stored:
            return default
        return KEYS[key](stored[key])

    return {
        "riskThreshold": get("riskThreshold", settings.risk_threshold),
        "timeLockHours": get("timeLockHours", settings.time_lock_hours),
        "holdingPeriodHours": get("holdingPeriodHours", settings.holding_period_hours),
        "modelVersion": settings.model_version,
        "failClosedOnInferenceError": get(
            "failClosedOnInferenceError", settings.fail_closed_on_inference_error,
        ),
    }


def update(db: Session, changes: dict[str, object], actor: User) -> None:
    """Applies changes and records them.

    Historical predictions are untouched: each stores the threshold in force
    when it was made, so moving the gate does not rewrite what a past decision
    meant.
    """
    described = []
    for key, value in changes.items():
        if value is None or key not in KEYS:
            continue

        row = db.get(SystemSetting, key)
        previous = row.value if row else "(default)"

        if row is None:
            row = SystemSetting(key=key, value=str(value))
            db.add(row)
        else:
            row.value = str(value)
        row.updated_by = actor.wallet_address

        described.append(f"{key}: {previous} → {value}")

    if described:
        audit.record(
            db,
            layer=AuditLayer.APPLICATION,
            event_type="admin.settings.update",
            summary="Administrator updated system configuration: "
                    + ", ".join(described) + ".",
            actor=actor,
            detail={"changes": {k: str(v) for k, v in changes.items() if v is not None}},
        )
