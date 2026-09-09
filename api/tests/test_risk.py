"""The scoring endpoint."""

from __future__ import annotations

from tests.test_escrows import scoring_payload


def test_scoring_returns_the_gate_verdict(client, tokens, auth, seller_id):
    response = client.post("/api/v1/risk/score", headers=auth(tokens["buyer"]),
                           json=scoring_payload(seller_id))
    assert response.status_code == 200

    body = response.json()
    assert 0.0 <= body["riskScore"] <= 1.0
    assert body["threshold"] == 0.75
    assert body["withinGate"] is True
    assert body["source"] == "model"


def test_scoring_reports_a_score_above_the_gate(client, tokens, auth, seller_id):
    response = client.post(
        "/api/v1/risk/score", headers=auth(tokens["buyer"]),
        json=scoring_payload(seller_id, highRiskGeo=True, deviceConsistent=False),
    )
    assert response.json()["withinGate"] is False


def test_latency_is_reported_against_the_nfr01_budget(client, tokens, auth, seller_id):
    body = client.post("/api/v1/risk/score", headers=auth(tokens["buyer"]),
                       json=scoring_payload(seller_id)).json()
    assert body["latencyMs"] >= 0
    assert body["exceededBudget"] is False


def test_the_response_carries_a_server_side_timing_header(client, tokens, auth, seller_id):
    response = client.post("/api/v1/risk/score", headers=auth(tokens["buyer"]),
                           json=scoring_payload(seller_id))
    assert "X-Response-Time-Ms" in response.headers


def test_out_of_range_features_are_rejected(client, tokens, auth, seller_id):
    response = client.post(
        "/api/v1/risk/score", headers=auth(tokens["buyer"]),
        json=scoring_payload(seller_id, counterpartyReputation=40.0),
    )
    assert response.status_code == 422


def test_scoring_requires_the_create_permission(client, tokens, auth, seller_id):
    response = client.post("/api/v1/risk/score", headers=auth(tokens["seller"]),
                           json=scoring_payload(seller_id))
    assert response.status_code == 403


def test_failure_is_reported_as_unavailable_not_as_a_safe_score(
    client, tokens, auth, seller_id, scorer,
):
    scorer.raise_on_score = True
    response = client.post("/api/v1/risk/score", headers=auth(tokens["buyer"]),
                           json=scoring_payload(seller_id))

    assert response.status_code == 503
    assert "fail closed" in response.json()["detail"].lower()


def test_health_reports_degraded_without_a_model(client, scorer):
    scorer.is_available = False
    scorer.load_error = "No model artefact"

    body = client.get("/api/v1/health").json()
    assert body["status"] == "degraded"
    assert body["model"] is False
