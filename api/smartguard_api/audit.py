"""Audit logging — FR-09, NFR-06.

Every significant event, on chain and off, becomes one row of the same shape, so
a reader can reconstruct what happened without interleaving three logs by hand.

Entries are added to the caller's session and committed with the change they
describe. That matters: an audit record that commits separately can survive a
rolled-back transaction and describe something that never happened.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLayer, AuditLog, User


def record(
    db: Session,
    *,
    layer: AuditLayer,
    event_type: str,
    summary: str,
    transaction_id: str | None = None,
    actor: User | None = None,
    actor_address: str | None = None,
    tx_hash: str | None = None,
    gas_used: int | None = None,
    block_number: int | None = None,
    detail: dict[str, Any] | None = None,
) -> AuditLog:
    entry = AuditLog(
        layer=layer,
        event_type=event_type,
        summary=summary,
        transaction_id=transaction_id,
        actor_address=actor_address or (actor.wallet_address if actor else None),
        tx_hash=tx_hash,
        gas_used=gas_used,
        block_number=block_number,
        detail=detail,
    )
    db.add(entry)
    return entry
