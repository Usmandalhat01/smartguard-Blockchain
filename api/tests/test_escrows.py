"""The escrow lifecycle and the access control around it."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from smartguard_api.db import SessionLocal
from smartguard_api.models import EscrowState, Transaction


def scoring_payload(seller_id: str, **overrides) -> dict:
    payload = {
        "amountEth": 1.5,
        "sellerId": seller_id,
        "accountAgeDays": 189,
        "velocity24h": 1,
        "counterpartyReputation": 0.97,
        "sellerDisputeRate": 0.02,
        "buyerDisputeRate": 0.01,
        "deviceConsistent": True,
        "highRiskGeo": False,
        "offHours": False,
        "meanAmount30d": 1.6,
        "accountBalanceEth": 12.0,
        "channel": "web",
    }
    payload.update(overrides)
    return payload


def create(client, auth, token, seller_id, **overrides):
    scoring = scoring_payload(seller_id, **overrides)
    return client.post("/api/v1/escrows", headers=auth(token), json={
        "sellerId": seller_id,
        "amountEth": scoring["amountEth"],
        "itemDescription": "Refurbished MacBook Pro 14 inch, M3, 512GB",
        "scoring": scoring,
    })


# ------------------------------------------------------------ FR-01/02 -----

def test_a_low_risk_escrow_is_admitted(client, tokens, auth, seller_id):
    response = create(client, auth, tokens["buyer"], seller_id)
    assert response.status_code == 201

    body = response.json()
    assert body["state"] == "INITIATED"
    assert body["prediction"]["riskScore"] <= 0.75
    assert body["prediction"]["thresholdAtScoring"] == 0.75


def test_a_high_risk_escrow_is_refused_before_anything_is_written(
    client, tokens, auth, seller_id,
):
    response = create(
        client, auth, tokens["buyer"], seller_id,
        highRiskGeo=True, deviceConsistent=False,
    )
    assert response.status_code == 422
    assert "exceeds the configured gate" in response.json()["detail"]

    with SessionLocal() as session:
        assert session.query(Transaction).count() == 0


def test_the_refusal_is_recorded_in_the_audit_log(client, tokens, auth, seller_id):
    create(client, auth, tokens["buyer"], seller_id,
           highRiskGeo=True, deviceConsistent=False)

    entries = client.get("/api/v1/admin/audit", headers=auth(tokens["admin"])).json()
    kinds = {entry["eventType"] for entry in entries}
    assert "risk.gate.reject" in kinds


def test_the_client_cannot_supply_its_own_score(client, tokens, auth, seller_id):
    """A riskScore field in the payload must be rejected outright, not honoured.

    If a client could assert its own score the gate would be decorative.
    """
    response = client.post("/api/v1/escrows", headers=auth(tokens["buyer"]), json={
        "sellerId": seller_id,
        "amountEth": 1.5,
        "itemDescription": "Something entirely ordinary",
        "riskScore": 0.01,
        "scoring": scoring_payload(seller_id),
    })
    assert response.status_code == 422


def test_scoring_fails_closed_when_the_model_is_unavailable(
    client, tokens, auth, seller_id, scorer,
):
    scorer.raise_on_score = True
    response = create(client, auth, tokens["buyer"], seller_id)

    assert response.status_code == 503
    assert "no funds have been committed" in response.json()["detail"].lower()

    with SessionLocal() as session:
        assert session.query(Transaction).count() == 0


def test_a_seller_cannot_create_an_escrow(client, tokens, auth, seller_id):
    response = create(client, auth, tokens["seller"], seller_id)
    assert response.status_code == 403


def test_an_administrator_cannot_create_an_escrow(client, tokens, auth, seller_id):
    response = create(client, auth, tokens["admin"], seller_id)
    assert response.status_code == 403


# --------------------------------------------------------------- FR-07 -----

def test_a_buyer_sees_only_its_own_escrows(client, tokens, auth, seller_id):
    create(client, auth, tokens["buyer"], seller_id)

    listed = client.get("/api/v1/escrows", headers=auth(tokens["buyer"])).json()
    assert len(listed) == 1


def test_an_arbitrator_sees_every_escrow(client, tokens, auth, seller_id):
    create(client, auth, tokens["buyer"], seller_id)
    listed = client.get("/api/v1/escrows", headers=auth(tokens["arbitrator"])).json()
    assert len(listed) == 1


def test_an_unrelated_escrow_returns_404_not_403(client, tokens, auth, seller_id):
    """404, so the response does not confirm that the escrow exists."""
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]

    from smartguard_api.models import Role, User
    with SessionLocal() as session:
        # Point the escrow at a different seller so the real one is not a party.
        tx = session.query(Transaction).one()
        other = session.query(User).filter(User.role == Role.ADMIN).one()
        tx.seller_id = other.id
        session.commit()

    response = client.get(f"/api/v1/escrows/{reference}", headers=auth(tokens["seller"]))
    assert response.status_code == 404


def test_permitted_actions_are_computed_per_principal(client, tokens, auth, seller_id):
    body = create(client, auth, tokens["buyer"], seller_id).json()
    assert "confirm-delivery" in body["permittedActions"]
    assert "raise-dispute" in body["permittedActions"]
    # The holding period has not elapsed.
    assert "claim-refund" not in body["permittedActions"]

    seen_by_seller = client.get(
        f"/api/v1/escrows/{body['reference']}", headers=auth(tokens["seller"]),
    ).json()
    assert "confirm-delivery" not in seen_by_seller["permittedActions"]


# --------------------------------------------------------------- FR-03 -----

def test_the_buyer_confirms_delivery(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]

    response = client.post(
        f"/api/v1/escrows/{reference}/confirm-delivery", headers=auth(tokens["buyer"]),
    )
    assert response.status_code == 200
    assert response.json()["state"] == "DELIVERED"


def test_the_seller_cannot_confirm_delivery(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    response = client.post(
        f"/api/v1/escrows/{reference}/confirm-delivery", headers=auth(tokens["seller"]),
    )
    assert response.status_code == 403


def test_delivery_cannot_be_confirmed_twice(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    client.post(f"/api/v1/escrows/{reference}/confirm-delivery",
                headers=auth(tokens["buyer"]))
    again = client.post(f"/api/v1/escrows/{reference}/confirm-delivery",
                        headers=auth(tokens["buyer"]))
    assert again.status_code == 403


def test_withdrawal_is_refused_while_the_time_lock_runs(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    client.post(f"/api/v1/escrows/{reference}/confirm-delivery",
                headers=auth(tokens["buyer"]))

    response = client.post(f"/api/v1/escrows/{reference}/withdraw",
                           headers=auth(tokens["seller"]))
    assert response.status_code == 403


def test_withdrawal_succeeds_once_the_time_lock_elapses(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    client.post(f"/api/v1/escrows/{reference}/confirm-delivery",
                headers=auth(tokens["buyer"]))

    with SessionLocal() as session:
        tx = session.query(Transaction).filter(Transaction.reference == reference).one()
        tx.delivery_confirmed_at = datetime.now(timezone.utc) - timedelta(hours=49)
        session.commit()

    response = client.post(f"/api/v1/escrows/{reference}/withdraw",
                           headers=auth(tokens["seller"]))
    assert response.status_code == 200
    assert response.json()["outcome"] == "released_to_seller"


# --------------------------------------------------------------- FR-04 -----

def test_either_party_may_raise_a_dispute(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]

    response = client.post(
        f"/api/v1/escrows/{reference}/dispute",
        headers=auth(tokens["seller"]),
        json={"reason": "The buyer has not responded to two delivery attempts."},
    )
    assert response.status_code == 201
    assert response.json()["raisedByRole"] == "seller"


def test_the_arbitrator_cannot_raise_the_dispute_it_would_decide(
    client, tokens, auth, seller_id,
):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    response = client.post(
        f"/api/v1/escrows/{reference}/dispute",
        headers=auth(tokens["arbitrator"]),
        json={"reason": "Opening this case on my own initiative for review."},
    )
    assert response.status_code == 403


def test_a_short_reason_is_rejected(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    response = client.post(
        f"/api/v1/escrows/{reference}/dispute",
        headers=auth(tokens["buyer"]),
        json={"reason": "bad"},
    )
    assert response.status_code == 422


# --------------------------------------------------------------- FR-05 -----

def _disputed(client, tokens, auth, seller_id) -> str:
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    client.post(
        f"/api/v1/escrows/{reference}/dispute",
        headers=auth(tokens["buyer"]),
        json={"reason": "The consignment arrived twelve units short of the order."},
    )
    return reference


@pytest.mark.parametrize("for_seller,expected", [
    (True, "resolved_for_seller"),
    (False, "resolved_for_buyer"),
])
def test_the_arbitrator_directs_the_funds(
    client, tokens, auth, seller_id, for_seller, expected,
):
    reference = _disputed(client, tokens, auth, seller_id)
    response = client.post(
        f"/api/v1/escrows/{reference}/resolve",
        headers=auth(tokens["arbitrator"]),
        json={"releaseToSeller": for_seller,
              "note": "The courier record supports this direction of the ruling."},
    )
    assert response.status_code == 200
    assert response.json()["outcome"] == expected


@pytest.mark.parametrize("role", ["buyer", "seller", "admin"])
def test_nobody_else_may_resolve(client, tokens, auth, seller_id, role):
    reference = _disputed(client, tokens, auth, seller_id)
    response = client.post(
        f"/api/v1/escrows/{reference}/resolve",
        headers=auth(tokens[role]),
        json={"releaseToSeller": True,
              "note": "Attempting to resolve without the authority to do so."},
    )
    assert response.status_code == 403


def test_a_dispute_cannot_be_resolved_twice(client, tokens, auth, seller_id):
    reference = _disputed(client, tokens, auth, seller_id)
    body = {"releaseToSeller": True,
            "note": "The courier record supports release to the seller."}

    client.post(f"/api/v1/escrows/{reference}/resolve",
                headers=auth(tokens["arbitrator"]), json=body)
    again = client.post(f"/api/v1/escrows/{reference}/resolve",
                        headers=auth(tokens["arbitrator"]), json=body)
    assert again.status_code == 403


# --------------------------------------------------------------- FR-06 -----

def test_refund_is_refused_before_the_holding_period_elapses(
    client, tokens, auth, seller_id,
):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    response = client.post(f"/api/v1/escrows/{reference}/refund",
                           headers=auth(tokens["buyer"]))
    assert response.status_code == 403


def test_refund_succeeds_after_the_holding_period(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]

    with SessionLocal() as session:
        tx = session.query(Transaction).filter(Transaction.reference == reference).one()
        tx.holding_period_ends_at = datetime.now(timezone.utc) - timedelta(hours=1)
        session.commit()

    response = client.post(f"/api/v1/escrows/{reference}/refund",
                           headers=auth(tokens["buyer"]))
    assert response.status_code == 200
    assert response.json()["outcome"] == "timeout_refund"


def test_refund_is_refused_once_delivery_is_confirmed(client, tokens, auth, seller_id):
    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    client.post(f"/api/v1/escrows/{reference}/confirm-delivery",
                headers=auth(tokens["buyer"]))

    with SessionLocal() as session:
        tx = session.query(Transaction).filter(Transaction.reference == reference).one()
        tx.holding_period_ends_at = datetime.now(timezone.utc) - timedelta(hours=1)
        session.commit()

    response = client.post(f"/api/v1/escrows/{reference}/refund",
                           headers=auth(tokens["buyer"]))
    assert response.status_code == 403
