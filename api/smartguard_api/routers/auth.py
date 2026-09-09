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
from ..schemas import LoginRequest, LoginResponse, Principal
from ..security import create_access_token, hash_password, verify_password
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
