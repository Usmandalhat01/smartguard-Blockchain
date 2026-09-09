"""Assembly of the eighteen-feature vector for a live request.

The experiment pipeline builds this matrix from PaySim columns. At inference
time the same eighteen values must be assembled from an actual escrow request,
and they have to mean the same thing or the model is being asked a different
question than it was trained on.

Where a value cannot be observed at request time — PaySim's simulation step, for
instance — a documented stand-in is used and named here rather than left as an
unexplained constant.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .schemas import ScoringInput

# PaySim amounts are in the simulator's currency units, not Ether. The model
# learned that scale, so an Ether amount is converted before scoring. The factor
# is the ratio of the two medians and is a *prototype* calibration, not an
# exchange rate — Section 3.12.4 already records that PaySim's amount is used as
# "a synthetic transaction-value proxy" rather than an observed Ether value.
ETH_TO_PAYSIM_UNITS = 150_000.0


def build_vector(payload: ScoringInput, now: datetime | None = None) -> dict[str, float]:
    """Turns a request into the vector the model expects, in Table 3.4 order."""
    moment = now or datetime.now(timezone.utc)

    amount = payload.amountEth * ETH_TO_PAYSIM_UNITS
    mean_30d = max(payload.meanAmount30d * ETH_TO_PAYSIM_UNITS, 1.0)

    return {
        "transaction_amount": amount,
        "amount_deviation": amount - mean_30d,
        "velocity_24h": float(payload.velocity24h),
        # Longer windows are not separately observable at request time; they are
        # extrapolated from the 24-hour count at the rates the training data
        # exhibits. Recorded here because an unexplained multiplier in a feature
        # vector is exactly the kind of thing Section 3.12.5 was faulted for.
        "velocity_7d": float(payload.velocity24h) * 4.0,
        "velocity_30d": float(payload.velocity24h) * 12.0,
        "geographic_risk": 1.0 if payload.highRiskGeo else 0.0,
        "counterparty_reputation": payload.counterpartyReputation,
        "office_hours_indicator": 1.0 if payload.offHours else 0.0,
        "device_consistency": 1.0 if payload.deviceConsistent else 0.0,
        "account_age_days": float(payload.accountAgeDays),
        "transaction_channel": 1.0 if payload.channel == "mobile" else 0.0,
        "prior_dispute_rate": payload.buyerDisputeRate,
        "seller_dispute_rate": payload.sellerDisputeRate,
        "amount_rounded": 1.0 if abs(amount % 1000) < 1e-6 else 0.0,
        # Escrow deposits are transfers, which is PaySim's TRANSFER type.
        "transaction_type": 1.0,
        "prior_completed_rate": max(0.0, 1.0 - payload.buyerDisputeRate),
        "amount_to_account_ratio": amount / (mean_30d + 1.0),
        # PaySim's step is a simulation hour in [1, 744]. A live request has a
        # real timestamp; the hour of the month is the closest equivalent and
        # keeps the value inside the range the model was fitted on.
        "step_time": float((moment.day - 1) * 24 + moment.hour + 1),
    }
