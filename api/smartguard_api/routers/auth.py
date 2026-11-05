"""Authentication — `POST /api/v1/auth/login`.

The presentation layer calls this and re-signs the returned claims into its own
HttpOnly cookie, so the browser never holds a bearer token in JavaScript.
"""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..models import AuditLayer, Role, User
from ..schemas import LinkWalletRequest, LoginRequest, LoginResponse, Principal
from ..security import CurrentUser, create_access_token, hash_password, verify_password
from .. import audit

router = APIRouter(prefix="/auth", tags=["auth"])

# A real bcrypt hash of a random value, computed once at import. Verifying an
# unknown account against it costs the same as a genuine check, so response
# timing does not reveal which accounts exist. Generated rather than hard-coded
# so it is always a valid hash for the installed bcrypt version.
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))

HOME_FOR: dict[Role, str] = {
    Role.BUYER: "/escrows",
    Role.SELLER: "/escrows",
    Role.ARBITRATOR: "/disputes",
    Role.ADMIN: "/admin",
}


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LoginResponse:
    user = db.query(User).filter(User.email == payload.email.lower()).one_or_none()

    password_ok = verify_password(
        payload.password, user.password_hash if user else DUMMY_HASH,
    )

    # One message for every failure mode — unknown account, wrong password,
    # deactivated account — so the response is not an account enumeration oracle.
    if not user or not password_ok or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Those credentials were not recognised.",
        )

    token, expires_in = create_access_token(user, settings)

    audit.record(
        db,
        layer=AuditLayer.APPLICATION,
        event_type="auth.login",
        summary=f"{user.display_name} signed in as {user.role.value}.",
        actor=user,
    )
    db.commit()

    return LoginResponse(
        accessToken=token,
        expiresIn=expires_in,
        principal=Principal(
            userId=user.id,
            walletAddress=user.wallet_address,
            role=user.role,
            displayName=user.display_name,
        ),
        redirectTo=HOME_FOR[user.role],
    )


def wallet_link_message(user: User) -> str:
    return f"SmartGuard wallet link for account {user.id}"


@router.put("/wallet")
def link_wallet(
    payload: LinkWalletRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Binds the caller's account to a wallet they control.

    Contract roles are wallet addresses, and the seeded addresses belong to
    nobody. The caller proves control by signing a fixed message; the address
    recovered from the signature must equal the one claimed. Claiming an address
    without the key is refused, and an address already held by another account
    is refused rather than reassigned.
    """
    from eth_account import Account
    from eth_account.messages import encode_defunct
    from web3 import Web3

    try:
        recovered = Account.recover_message(
            encode_defunct(text=wallet_link_message(user)), signature=payload.signature,
        )
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed signature.") from error
    if recovered.lower() != payload.address.lower():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The signature does not match that address.")

    address = Web3.to_checksum_address(payload.address)
    holder = db.query(User).filter(User.wallet_address == address).one_or_none()
    if holder is not None and holder.id != user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "That wallet is linked to another account.")

    user.wallet_address = address
    audit.record(
        db, layer=AuditLayer.APPLICATION, event_type="auth.wallet.link",
        summary=f"{user.display_name} linked wallet {address}.", actor=user,
    )
    db.commit()
    return {"walletAddress": address}
