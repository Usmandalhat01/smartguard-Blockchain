"""Authentication behaviour."""

from __future__ import annotations

import pytest


def test_login_returns_a_token_and_the_role_home(client):
    response = client.post("/api/v1/auth/login", json={
        "email": "amina.yusuf@example.ng", "password": "buyer-demo-2026",
    })
    assert response.status_code == 200

    body = response.json()
    assert body["principal"]["role"] == "buyer"
    assert body["redirectTo"] == "/escrows"
    assert body["accessToken"]


@pytest.mark.parametrize("role,home", [
    ("arbitrator", "/disputes"),
    ("admin", "/admin"),
    ("seller", "/escrows"),
])
def test_each_role_lands_in_its_own_workspace(client, role, home):
    from smartguard_api.seed import ACCOUNTS

    account = next(a for a in ACCOUNTS if a["role"].value == role)
    response = client.post("/api/v1/auth/login", json={
        "email": account["email"], "password": account["password"],
    })
    assert response.json()["redirectTo"] == home


def test_wrong_password_and_unknown_account_are_indistinguishable(client):
    wrong = client.post("/api/v1/auth/login", json={
        "email": "amina.yusuf@example.ng", "password": "not-the-password",
    })
    unknown = client.post("/api/v1/auth/login", json={
        "email": "nobody@example.com", "password": "anything",
    })

    assert wrong.status_code == unknown.status_code == 401
    # Identical, so the response cannot be used to enumerate accounts.
    assert wrong.json()["detail"] == unknown.json()["detail"]


def test_anonymous_requests_are_refused(client):
    assert client.get("/api/v1/escrows").status_code == 401


def test_a_forged_token_is_refused(client, auth):
    forged = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4Iiwicm9sZSI6ImFkbWluIn0.nope"
    assert client.get("/api/v1/escrows", headers=auth(forged)).status_code == 401


def test_a_token_for_a_deactivated_user_is_refused(client, tokens, auth):
    from smartguard_api.db import SessionLocal
    from smartguard_api.models import Role, User

    with SessionLocal() as session:
        user = session.query(User).filter(User.role == Role.BUYER).one()
        user.is_active = False
        session.commit()

    # The token is still cryptographically valid; the claim is about the past.
    response = client.get("/api/v1/escrows", headers=auth(tokens["buyer"]))
    assert response.status_code == 401


def test_extra_fields_are_rejected(client):
    response = client.post("/api/v1/auth/login", json={
        "email": "amina.yusuf@example.ng",
        "password": "buyer-demo-2026",
        "role": "admin",
    })
    assert response.status_code == 422
