"""Development accounts.

Creates one user per role so the four workspaces can be exercised
independently. The credentials match the ones the presentation layer prints on
its login screen, so the two layers agree.

A deployment provisions accounts through the account directory and publishes no
passwords anywhere.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Role, User
from .security import hash_password

ACCOUNTS = [
    {
        "email": "amina.yusuf@example.ng",
        "password": "buyer-demo-2026",
        "role": Role.BUYER,
        "display_name": "Amina Yusuf",
        "wallet_address": "0x8E5E31Db3b4b153Eb0134741c1D8DF6517734c3c",
    },
    {
        "email": "tunde.okafor@example.ng",
        "password": "seller-demo-2026",
        "role": Role.SELLER,
        "display_name": "Tunde Okafor",
        "wallet_address": "0xc77539E8F5d0aC1D4a9E4d0f0F1e79Cc3F5B2a11",
    },
    {
        "email": "n.eze@arbitration.ng",
        "password": "arbitrator-demo-2026",
        "role": Role.ARBITRATOR,
        "display_name": "Dr Ngozi Eze",
        "wallet_address": "0xaa2D8f3B7c6E1a4D9F0b5C8e2A7d3F1b6E9c4B5D",
    },
    {
        "email": "operator@smartguard.ng",
        "password": "admin-demo-2026",
        "role": Role.ADMIN,
        "display_name": "System Operator",
        "wallet_address": "0xFDD3a1B2c4E6f8A0b2D4e6F8a0C2e4D6b8F0a2C4",
    },
]


def seed_users(db: Session) -> list[User]:
    """Idempotent: existing accounts are left alone."""
    created = []
    for spec in ACCOUNTS:
        existing = db.query(User).filter(User.email == spec["email"]).one_or_none()
        if existing is not None:
            created.append(existing)
            continue

        user = User(
            email=spec["email"],
            password_hash=hash_password(spec["password"]),
            role=spec["role"],
            display_name=spec["display_name"],
            wallet_address=spec["wallet_address"],
        )
        db.add(user)
        created.append(user)

    db.commit()
    return created


if __name__ == "__main__":
    from .db import SessionLocal, create_all

    create_all()
    with SessionLocal() as session:
        users = seed_users(session)
        print(f"seeded {len(users)} accounts:")
        for user in users:
            print(f"  {user.role.value:<11} {user.email}")
