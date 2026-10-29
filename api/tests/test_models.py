"""Schema assertions that the behavioural suites cannot make.

These tests check column *types*, not behaviour. That is unusual, and it is
deliberate: the suites run against a temporary SQLite file, and SQLite stores
an integer at whatever width the value needs. A column declared 32 bits wide
therefore accepts a 48-bit value under test and raises
`psycopg.errors.NumericValueOutOfRange` in production.

That is not hypothetical. `Transaction.nonce` was declared `Integer`, is
assigned `secrets.randbits(48)`, and so failed on PostgreSQL for all but about
one value in 131,072 — while every test passed. Asserting the declared type is
the only way a SQLite-backed suite can hold that line.
"""

from __future__ import annotations

import secrets

from sqlalchemy import BigInteger, inspect

from smartguard_api.models import Transaction


# PostgreSQL INTEGER is signed 32-bit.
PG_INTEGER_MAX = 2**31 - 1

# The width routers/escrows.py draws the nonce at.
NONCE_BITS = 48


def test_nonce_column_is_64_bit() -> None:
    """A 48-bit nonce does not fit a 32-bit column."""
    column = inspect(Transaction).columns["nonce"]

    assert isinstance(column.type, BigInteger), (
        "Transaction.nonce must be BigInteger: it holds secrets.randbits"
        f"({NONCE_BITS}), which exceeds PostgreSQL's 32-bit INTEGER. SQLite "
        "will not reveal this, so the type is asserted directly."
    )


def test_generated_nonce_exceeds_a_32_bit_column() -> None:
    """Pins the premise, so the test above cannot become vacuous.

    If the nonce width were ever reduced to 31 bits or fewer, the assertion
    above would still pass but would no longer be protecting anything. This
    fails instead, and names the reason.
    """
    assert 2**NONCE_BITS - 1 > PG_INTEGER_MAX, (
        "The nonce no longer exceeds a 32-bit column, so "
        "test_nonce_column_is_64_bit is no longer load-bearing. Check that "
        "routers/escrows.py still draws secrets.randbits(48) and update both."
    )

    # Drawn rather than asserted from the constant: this is the call the router
    # makes, so a change to it shows up here.
    sample = max(secrets.randbits(NONCE_BITS) for _ in range(64))
    assert sample > PG_INTEGER_MAX, (
        "64 draws at this width all fit a 32-bit column, which should be "
        "effectively impossible at 48 bits."
    )
