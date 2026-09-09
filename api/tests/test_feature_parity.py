"""Training and inference must build the same features.

Train/serve skew does not fail loudly. A feature computed from a different
quantity than the model learned returns a confident, meaningless number, and
nothing in the stack objects — which is exactly how it survives to production.

One instance of this was already found and fixed: `amount_to_account_ratio` was
trained as `amount / (balance + 1)` and served as `amount / (mean_amount + 1)`.
Those are different quantities. For a clean 1.5 ETH request against a 1.6 ETH
mean the served value was ~0.94, which the model reads as an account being
almost fully drained. See docs/DECISIONS.md D-012.

This test constructs one row through both paths and asserts they agree.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from smartguard_api.features import ETH_TO_PAYSIM_UNITS, build_vector
from smartguard_api.inference import FEATURE_ORDER
from smartguard_api.schemas import ScoringInput

ML_ROOT = Path(__file__).resolve().parents[2] / "ml"


def _training_features():
    """Imports the pipeline's feature builder, if its dependencies are present."""
    if str(ML_ROOT) not in sys.path:
        sys.path.insert(0, str(ML_ROOT))
    try:
        from smartguard_ml.features import FEATURE_NAMES, build_features  # noqa: PLC0415
    except ImportError:
        pytest.skip("The experiment pipeline's dependencies are not installed here")
    return FEATURE_NAMES, build_features


def test_the_two_layers_agree_on_the_feature_list():
    """The order matters: the model was fitted on columns in this sequence and
    scoring a differently-ordered frame silently produces nonsense."""
    names, _ = _training_features()
    assert FEATURE_ORDER == names


def test_amount_to_account_ratio_matches_the_training_expression():
    """The specific skew that was found, pinned so it cannot return."""
    payload = ScoringInput(
        amountEth=1.5, sellerId="s", accountAgeDays=189, velocity24h=1,
        counterpartyReputation=0.97, sellerDisputeRate=0.02, buyerDisputeRate=0.01,
        deviceConsistent=True, highRiskGeo=False, offHours=False,
        meanAmount30d=1.6, accountBalanceEth=12.0, channel="web",
    )
    vector = build_vector(payload, now=datetime(2026, 9, 9, 12, tzinfo=timezone.utc))

    amount = 1.5 * ETH_TO_PAYSIM_UNITS
    balance = 12.0 * ETH_TO_PAYSIM_UNITS
    expected = amount / (balance + 1.0)

    assert vector["amount_to_account_ratio"] == pytest.approx(expected)

    # And explicitly not the quantity it used to be computed from.
    mean = 1.6 * ETH_TO_PAYSIM_UNITS
    assert vector["amount_to_account_ratio"] != pytest.approx(amount / (mean + 1.0))


def test_a_full_drain_approaches_one():
    """The shape the model learned: a fraudulent row empties the account, so the
    ratio approaches 1. If the served feature cannot reach that range, the model
    can never recognise the pattern it was trained on."""
    payload = ScoringInput(
        amountEth=10.0, sellerId="s", accountAgeDays=3, velocity24h=9,
        counterpartyReputation=0.2, sellerDisputeRate=0.4, buyerDisputeRate=0.3,
        deviceConsistent=False, highRiskGeo=True, offHours=True,
        meanAmount30d=1.0, accountBalanceEth=10.0, channel="mobile",
    )
    vector = build_vector(payload)
    assert 0.95 < vector["amount_to_account_ratio"] <= 1.0


def test_every_feature_is_produced():
    payload = ScoringInput(
        amountEth=1.0, sellerId="s", accountAgeDays=100, velocity24h=2,
        counterpartyReputation=0.8, sellerDisputeRate=0.05, buyerDisputeRate=0.05,
        deviceConsistent=True, highRiskGeo=False, offHours=False,
        meanAmount30d=1.0, accountBalanceEth=5.0, channel="web",
    )
    vector = build_vector(payload)
    assert set(vector) == set(FEATURE_ORDER)
    assert all(isinstance(value, (int, float)) for value in vector.values())


def test_step_time_stays_in_the_trained_range():
    """PaySim's step is 1-744. A value outside that is one the model never saw."""
    payload = ScoringInput(
        amountEth=1.0, sellerId="s", accountAgeDays=100, velocity24h=1,
        counterpartyReputation=0.9, sellerDisputeRate=0.02, buyerDisputeRate=0.01,
        deviceConsistent=True, highRiskGeo=False, offHours=False,
        meanAmount30d=1.0, accountBalanceEth=5.0, channel="web",
    )
    for day in (1, 15, 28, 31):
        vector = build_vector(
            payload, now=datetime(2026, 1, day, 23, tzinfo=timezone.utc),
        )
        assert 1 <= vector["step_time"] <= 744
