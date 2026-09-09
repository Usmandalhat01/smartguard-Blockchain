"""Administration routes and the separation between reading and writing."""

from __future__ import annotations

import pytest


@pytest.mark.parametrize("role", ["buyer", "seller", "arbitrator"])
def test_only_an_administrator_reads_settings(client, tokens, auth, role):
    assert client.get("/api/v1/admin/settings",
                      headers=auth(tokens[role])).status_code == 403


def test_an_administrator_reads_settings(client, tokens, auth):
    response = client.get("/api/v1/admin/settings", headers=auth(tokens["admin"]))
    assert response.status_code == 200
    assert response.json()["riskThreshold"] == 0.75


def test_changing_the_gate_is_recorded(client, tokens, auth):
    client.put("/api/v1/admin/settings", headers=auth(tokens["admin"]),
               json={"riskThreshold": 0.4})

    entries = client.get("/api/v1/admin/audit", headers=auth(tokens["admin"])).json()
    updates = [e for e in entries if e["eventType"] == "admin.settings.update"]
    assert updates
    assert "0.4" in updates[0]["summary"]


def test_a_new_gate_applies_to_the_next_escrow(client, tokens, auth, seller_id, scorer):
    from tests.test_escrows import create

    scorer.forced_score = 0.5
    client.put("/api/v1/admin/settings", headers=auth(tokens["admin"]),
               json={"riskThreshold": 0.3})

    response = create(client, auth, tokens["buyer"], seller_id)
    assert response.status_code == 422


def test_a_past_prediction_keeps_the_threshold_it_was_judged_against(
    client, tokens, auth, seller_id,
):
    """Moving the gate must not rewrite what an earlier decision meant."""
    from tests.test_escrows import create

    reference = create(client, auth, tokens["buyer"], seller_id).json()["reference"]
    client.put("/api/v1/admin/settings", headers=auth(tokens["admin"]),
               json={"riskThreshold": 0.1})

    escrow = client.get(f"/api/v1/escrows/{reference}",
                        headers=auth(tokens["buyer"])).json()
    assert escrow["prediction"]["thresholdAtScoring"] == 0.75


def test_an_out_of_range_threshold_is_rejected(client, tokens, auth):
    response = client.put("/api/v1/admin/settings", headers=auth(tokens["admin"]),
                          json={"riskThreshold": 1.4})
    assert response.status_code == 422


def test_the_audit_log_is_administrator_only(client, tokens, auth):
    assert client.get("/api/v1/admin/audit",
                      headers=auth(tokens["arbitrator"])).status_code == 403


def test_the_model_card_names_what_is_not_known(client, tokens, auth):
    response = client.get("/api/v1/admin/model", headers=auth(tokens["admin"]))
    assert response.status_code == 200

    body = response.json()
    assert body["featureCount"] == 18
    assert body["inferenceBudgetMs"] == 2000
