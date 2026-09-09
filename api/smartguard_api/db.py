"""Database session management."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings
from .models import Base

settings = get_settings()

# SQLite needs check_same_thread off for TestClient's threading; PostgreSQL
# takes pool settings instead. The models are portable between them.
_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=not _is_sqlite,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all() -> None:
    """Creates the schema.

    Adequate for a prototype. A production deployment needs Alembic migrations,
    because create_all cannot alter an existing table and a schema change would
    silently do nothing.
    """
    Base.metadata.create_all(bind=engine)
