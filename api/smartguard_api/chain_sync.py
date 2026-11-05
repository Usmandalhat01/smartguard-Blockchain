"""Mirrors contract events into the database (FR-09, NFR-06).

The chain is the source of truth for an escrow's state once funds are in it.
The wallet, not this service, sends deposits, deliveries, releases, disputes
and refunds, so the database learns of them only by reading the logs. This
module does that reading.

Properties that matter:

* **Idempotent.** Each log is identified by (transaction hash, log index) and
  recorded once in the audit log. Replaying a block range changes nothing, so a
  crash between processing and saving the cursor costs a repeat, not a
  duplicate.
* **Resumable.** The next block to read is stored in `system_settings`.
* **Reorg-tolerant.** Only blocks at least `confirmations` deep are read.
* **Forward-only.** An event never moves an escrow backwards. A late or
  repeated log cannot reopen a completed escrow.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from . import audit
from .chain import ChainClient
from .models import (
    AuditLayer, AuditLog, Dispute, EscrowState, Outcome, Role, SystemSetting, Transaction,
)

logger = logging.getLogger("smartguard.sync")

CURSOR_KEY = "chainCursor"
CHUNK = 2000  # public RPC providers cap eth_getLogs ranges

_ORDER = {
    EscrowState.INITIATED: 0, EscrowState.DELIVERED: 1,
    EscrowState.DISPUTED: 2, EscrowState.COMPLETED: 3,
}
_OUTCOMES = {
    1: Outcome.RELEASED_TO_SELLER, 2: Outcome.RESOLVED_FOR_SELLER,
    3: Outcome.RESOLVED_FOR_BUYER, 4: Outcome.TIMEOUT_REFUND,
}


@dataclass
class SyncResult:
    from_block: int
    to_block: int
    applied: int = 0
    skipped_duplicates: int = 0
    unknown_escrows: int = 0
    errors: list[str] = field(default_factory=list)


def _ts(seconds: int) -> datetime:
    return datetime.fromtimestamp(int(seconds), tz=timezone.utc)


def _hex(value) -> str:
    text = value.hex() if hasattr(value, "hex") else str(value)
    return text if text.startswith("0x") else "0x" + text


def _cursor(db: Session, default: int) -> int:
    row = db.get(SystemSetting, CURSOR_KEY)
    return int(row.value) if row else default


def _save_cursor(db: Session, block: int) -> None:
    row = db.get(SystemSetting, CURSOR_KEY)
    if row is None:
        db.add(SystemSetting(key=CURSOR_KEY, value=str(block), updated_by="chain-sync"))
    else:
        row.value = str(block)


def _already_recorded(db: Session, tx_hash: str, log_index: int) -> bool:
    rows = db.query(AuditLog).filter(AuditLog.tx_hash == tx_hash).all()
    return any((r.detail or {}).get("logIndex") == log_index for r in rows)


def _advance(tx: Transaction, state: EscrowState) -> None:
    if _ORDER[state] > _ORDER[tx.state]:
        tx.state = state


def _apply(db: Session, event: dict, holding_seconds: int) -> str:
    """Applies one event. Returns 'applied' or 'unknown'."""
    name, args = event["event"], event["args"]
    escrow_hex = _hex(args["escrowId"]).lower()
    detail = {"logIndex": event["logIndex"], "event": name}

    tx = db.query(Transaction).filter(Transaction.escrow_id == escrow_hex).one_or_none()
    layer = AuditLayer.ORACLE if name == "RiskScoreRecorded" else AuditLayer.BLOCKCHAIN

    def log(summary: str, actor: str | None = None) -> None:
        audit.record(
            db, layer=layer, event_type=f"chain.{name}", summary=summary,
            transaction_id=tx.id if tx else None, actor_address=actor,
            tx_hash=event["txHash"], block_number=event["blockNumber"], detail=detail,
        )

    if tx is None:
        log(f"{name} for an escrow this database does not know ({escrow_hex[:10]}…).")
        return "unknown"

    if name == "RiskScoreRecorded":
        detail["score"] = args["score"]
        log(f"Risk score {args['score']} recorded on chain (oracle nonce {args['nonce']}).",
            args["operator"])
    elif name == "FundsDeposited":
        detail["amountWei"] = str(args["amount"])
        _advance(tx, EscrowState.INITIATED)
        # The holding period runs from the deposit, as the contract computes it,
        # not from when the score was written.
        tx.holding_period_ends_at = _ts(args["timestamp"]) + timedelta(seconds=holding_seconds)
        log(f"Deposit of {args['amount']} wei accepted by the contract at risk score "
            f"{args['riskScore']} (threshold {args['threshold']}).", args["buyer"])
    elif name == "DeliveryConfirmed":
        _advance(tx, EscrowState.DELIVERED)
        tx.delivery_confirmed_at = _ts(args["timestamp"])
        log("Buyer confirmed delivery on chain. Time lock started.", args["buyer"])
    elif name == "DisputeInitiated":
        _advance(tx, EscrowState.DISPUTED)
        if tx.dispute is None:
            raised_by = Role.BUYER if args["raisedBy"].lower() == tx.buyer.wallet_address.lower() else Role.SELLER
            db.add(Dispute(
                reference=f"DSP-{205 + db.query(Dispute).count()}",
                transaction_id=tx.id, arbitrator_id=tx.arbitrator_id,
                raised_by_role=raised_by, raised_at=_ts(args["timestamp"]),
                reason="Raised on chain; no reason text is stored by the contract.",
            ))
        log("Dispute raised on chain. Decision authority passed to the arbitrator.", args["raisedBy"])
    elif name == "DisputeResolved":
        if tx.dispute is not None and tx.dispute.resolved_at is None:
            tx.dispute.resolution_for_seller = bool(args["releasedToSeller"])
            tx.dispute.resolved_at = _ts(args["timestamp"])
            tx.dispute.resolution_note = "Resolved on chain; no note is stored by the contract."
        log(f"Arbitrator resolved for the {'seller' if args['releasedToSeller'] else 'buyer'}.",
            args["arbitrator"])
    elif name == "FundsReleased":
        _advance(tx, EscrowState.COMPLETED)
        tx.outcome = _OUTCOMES.get(int(args["outcome"]), tx.outcome)
        tx.completed_at = _ts(args["timestamp"])
        log(f"{args['amount']} wei released to {args['recipient']} ({tx.outcome.value}).",
            args["recipient"])
    return "applied"


def sync_once(db: Session, chain: ChainClient, *, start_block: int = 0, confirmations: int = 2) -> SyncResult:
    """Reads the next unseen block range and applies it. Commits once at the end."""
    head = chain.latest_block() - confirmations
    first = _cursor(db, start_block)
    result = SyncResult(from_block=first, to_block=first - 1)
    if head < first:
        return result

    holding_seconds = chain.escrow.functions.holdingPeriodSeconds().call()
    block = first
    while block <= head:
        upper = min(block + CHUNK - 1, head)
        for event in chain.fetch_events(block, upper):
            if _already_recorded(db, event["txHash"], event["logIndex"]):
                result.skipped_duplicates += 1
                continue
            try:
                outcome = _apply(db, event, holding_seconds)
            except Exception as error:  # noqa: BLE001
                db.rollback()
                result.errors.append(f"{event['event']}@{event['blockNumber']}: {error}")
                logger.exception("could not apply %s", event["event"])
                return result  # cursor not advanced: retry the range next time
            result.applied += outcome == "applied"
            result.unknown_escrows += outcome == "unknown"
        result.to_block = upper
        _save_cursor(db, upper + 1)
        db.commit()
        block = upper + 1
    return result
