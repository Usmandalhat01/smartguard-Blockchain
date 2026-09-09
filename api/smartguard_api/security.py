"""Authentication and request authorisation.

Tokens are HS256 JWTs signed with the key the presentation layer also holds, so
the Next.js proxy can verify a token this service issued without a round trip.
That shared secret is the seam between the two layers.

PyJWT rather than python-jose: HS256 is symmetric, so hmac and hashlib are all
it needs. python-jose drags in `cryptography`, which requires a Rust toolchain
wherever no wheel matches the platform — a heavy dependency to carry for an
algorithm that does not use it.

Passwords are hashed with bcrypt directly rather than through passlib. passlib
has been unmaintained since 2020 and breaks against bcrypt 5.x, which removed
the private attribute it reads to detect the backend version.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import base64
import hashlib
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db
from .models import User
from .policy import Permission, can

# bcrypt's work factor. 12 is roughly 0.3s per hash on commodity hardware —
# slow enough to make offline guessing expensive, fast enough for a login.
BCRYPT_ROUNDS = 12

# auto_error=False so an anonymous request reaches the dependency and gets a
# 401 shaped by this module, rather than FastAPI's default.
bearer_scheme = HTTPBearer(auto_error=False)


def _prepare(password: str) -> bytes:
    """Normalises a password to a fixed-length input for bcrypt.

    bcrypt truncates silently at 72 bytes. A user with a longer passphrase would
    have the tail ignored without being told, and two passwords sharing a 72-byte
    prefix would collide. Hashing to SHA-256 first and base64-encoding gives a
    44-byte input that depends on the whole password.

    The base64 step matters too: a raw SHA-256 digest can contain a null byte,
    and bcrypt truncates at the first one.
    """
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(password), password_hash.encode())
    except ValueError:
        # A malformed stored hash is a failed verification, not a crash.
        return False


def create_access_token(user: User, settings: Settings) -> tuple[str, int]:
    """Claims match what the web layer's session cookie carries, so one can be
    minted from the other without a translation step."""
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=settings.session_ttl_seconds)

    payload = {
        "userId": user.id,
        "walletAddress": user.wallet_address,
        "role": user.role.value,
        "displayName": user.display_name,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    token = jwt.encode(payload, settings.resolved_secret(), algorithm=settings.jwt_algorithm)
    return token, settings.session_ttl_seconds


CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    """Resolves the bearer token to a live user record.

    The token is not trusted on its own. A user deactivated after a token was
    issued is refused, because the claim is a statement about the past.
    """
    if credentials is None:
        raise CREDENTIALS_ERROR

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.resolved_secret(),
            algorithms=[settings.jwt_algorithm],
        )
    except PyJWTError:
        raise CREDENTIALS_ERROR from None

    user_id = payload.get("userId")
    if not user_id:
        raise CREDENTIALS_ERROR

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise CREDENTIALS_ERROR

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require(permission: Permission):
    """Dependency factory guarding a route by permission.

        @router.get("/audit", dependencies=[Depends(require("admin:audit:read"))])

    The message names the permission, because an authenticated user who lacks it
    needs to know what they are missing — not merely that something was refused.
    """

    def dependency(user: CurrentUser) -> User:
        if not can(user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires the '{permission}' permission.",
            )
        return user

    return dependency
