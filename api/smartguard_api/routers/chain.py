"""Operator view of the blockchain bridge."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..chain_sync import CURSOR_KEY, sync_once
from ..config import Settings, get_settings
from ..db import get_db
from ..models import SystemSetting
from ..settings_store import current as current_settings
from ..security import CurrentUser, require

router = APIRouter(prefix="/chain", tags=["chain"])


def _chain(request: Request):
    chain = getattr(request.app.state, "chain", None)
    if chain is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The blockchain bridge is not configured on this server.",
        )
    return chain


@router.get("/info")
def chain_info(request: Request, user: CurrentUser) -> dict:
    """Public facts the interface needs to talk to the contracts."""
    chain = getattr(request.app.state, "chain", None)
    if chain is None:
        return {"enabled": False}
    return {
        "enabled": True,
        "chainId": chain.w3.eth.chain_id,
        "network": "Ethereum Sepolia" if chain.w3.eth.chain_id == 11155111 else f"Chain {chain.w3.eth.chain_id}",
        "escrowContract": chain.escrow_address,
        "riskOracleContract": chain.oracle_address,
        "oracleOperator": chain.operator.address,
        # The contract's own timings are what actually bind; the interface shows
        # these, not the database settings, so a mismatch cannot mislead a user.
        "timeLockSeconds": chain.escrow.functions.timeLockSeconds().call(),
        "holdingPeriodSeconds": chain.escrow.functions.holdingPeriodSeconds().call(),
    }


@router.get("/status", dependencies=[Depends(require("admin:settings:read"))])
def chain_status(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    chain = getattr(request.app.state, "chain", None)
    if chain is None:
        return {"enabled": False}
    row = db.get(SystemSetting, CURSOR_KEY)
    report = chain.status()
    # The gate exists twice: the API refuses above the database value, the
    # contract above its own. The operator key cannot change the contract's
    # (setRiskThreshold is owner-only), so a mismatch is reported, not fixed.
    wanted = round(float(current_settings(db, settings)["riskThreshold"]) * 100)
    in_sync = report.get("riskThreshold") == wanted if report.get("connected") else None
    return {"enabled": True, **report, "configuredThreshold": wanted, "thresholdInSync": in_sync,
            "syncCursor": int(row.value) if row else None}


@router.post("/sync", dependencies=[Depends(require("admin:settings:write"))])
def chain_sync(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """Runs one sync pass now, for an operator who does not want to wait."""
    result = sync_once(
        db, _chain(request),
        start_block=settings.chain_start_block, confirmations=settings.chain_confirmations,
    )
    return result.__dict__
