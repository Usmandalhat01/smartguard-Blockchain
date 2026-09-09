"""Role-based access control — the authoritative copy.

This module and `web/lib/auth/policy.ts` express the same permission model. That
duplication is deliberate and it is the correct shape: the web layer needs the
model to decide which controls to render, and this service needs it to decide
which requests to serve. Only one of them is a security boundary, and it is this
one — the browser copy is a rendering hint.

Duplication that drifts is worse than no duplication, so `tests/test_policy.py`
parses the TypeScript and asserts the two grant tables are identical. If someone
adds a permission on one side only, that test fails.

Three layers of check, as in the web layer:

    1. Role permissions      "an arbitrator may resolve disputes"
    2. Object-level guards   "…but only on an escrow naming this arbitrator,
                              and only while it is DISPUTED"
    3. The contract itself   the modifier that actually refuses the call

Layer 3 is the one that cannot be bypassed. Layers 1 and 2 exist so the system
never attempts a transaction the chain would revert, and so a request for
someone else's data is refused before it reaches the database.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .models import Dispute, EscrowState, Role, Transaction, User

# --------------------------------------------------------- permissions -----

Permission = str

ROLE_PERMISSIONS: dict[Role, tuple[Permission, ...]] = {
    Role.BUYER: (
        "escrow:create",
        "escrow:read:own",
        "escrow:confirm-delivery",
        "escrow:claim-refund",
        "dispute:raise",
        "dispute:read:own",
    ),
    Role.SELLER: (
        "escrow:read:own",
        "escrow:withdraw",
        "dispute:raise",
        "dispute:read:own",
    ),
    Role.ARBITRATOR: (
        "escrow:read:any",
        "dispute:read:any",
        "dispute:resolve",
    ),
    Role.ADMIN: (
        "escrow:read:any",
        "dispute:read:any",
        "admin:settings:read",
        "admin:settings:write",
        "admin:model:read",
        "admin:audit:read",
        "admin:users:read",
    ),
}

ROLE_LABEL: dict[Role, str] = {
    Role.BUYER: "Buyer",
    Role.SELLER: "Seller",
    Role.ARBITRATOR: "Arbitrator",
    Role.ADMIN: "Administrator",
}


def can(user: User | None, permission: Permission) -> bool:
    if user is None or not user.is_active:
        return False
    return permission in ROLE_PERMISSIONS[user.role]


# ------------------------------------------------- object-level guards -----

def is_party(user: User, tx: Transaction) -> bool:
    return user.id in (tx.buyer_id, tx.seller_id, tx.arbitrator_id)


def can_read_escrow(user: User | None, tx: Transaction) -> bool:
    """A party sees its own; an arbitrator and an administrator see any.

    Section 3.5.1: arbitrators "require access to the complete, immutable
    history of any disputed transaction", which cannot be satisfied by
    own-records-only access.
    """
    if user is None:
        return False
    if can(user, "escrow:read:any"):
        return True
    return can(user, "escrow:read:own") and is_party(user, tx)


def can_confirm_delivery(user: User | None, tx: Transaction) -> bool:
    """`confirmDelivery` — buyer only, from INITIATED."""
    if not can(user, "escrow:confirm-delivery"):
        return False
    return tx.buyer_id == user.id and tx.state == EscrowState.INITIATED


def can_claim_refund(user: User | None, tx: Transaction, now: datetime | None = None) -> bool:
    """`claimRefund` — buyer only, from INITIATED, after the holding period."""
    if not can(user, "escrow:claim-refund"):
        return False
    if tx.buyer_id != user.id or tx.state != EscrowState.INITIATED:
        return False
    moment = now or datetime.now(timezone.utc)
    return _aware(tx.holding_period_ends_at) <= moment


def can_withdraw(
    user: User | None, tx: Transaction, time_lock_hours: int, now: datetime | None = None,
) -> bool:
    """Release after the time lock — seller only, from DELIVERED, lock elapsed."""
    if not can(user, "escrow:withdraw"):
        return False
    if tx.seller_id != user.id or tx.state != EscrowState.DELIVERED:
        return False
    if tx.delivery_confirmed_at is None:
        return False
    moment = now or datetime.now(timezone.utc)
    unlocks = _aware(tx.delivery_confirmed_at) + timedelta(hours=time_lock_hours)
    return unlocks <= moment


def can_raise_dispute(user: User | None, tx: Transaction) -> bool:
    """`initiateDispute` — either party, from INITIATED or DELIVERED.

    The arbitrator is excluded: one that could open the case it then decides is
    not a neutral party, and the contract refuses it too.
    """
    if not can(user, "dispute:raise"):
        return False
    if user.id not in (tx.buyer_id, tx.seller_id):
        return False
    return tx.state in (EscrowState.INITIATED, EscrowState.DELIVERED)


def dispute_role_of(user: User, tx: Transaction) -> Role | None:
    if tx.buyer_id == user.id:
        return Role.BUYER
    if tx.seller_id == user.id:
        return Role.SELLER
    return None


def can_resolve_dispute(user: User | None, tx: Transaction, dispute: Dispute) -> bool:
    """`resolveDispute` — the designated arbitrator of that escrow, once only.

    Not "an arbitrator". The contract restricts this to the address recorded in
    the escrow, and so does this.
    """
    if not can(user, "dispute:resolve"):
        return False
    return (
        tx.arbitrator_id == user.id
        and dispute.arbitrator_id == user.id
        and tx.state == EscrowState.DISPUTED
        and dispute.resolved_at is None
    )


def _aware(value: datetime) -> datetime:
    """SQLite drops timezone information; Postgres does not. Normalising here
    keeps the comparisons above correct against both."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
