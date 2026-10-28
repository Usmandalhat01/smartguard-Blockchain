"""Controlled load against the application and intelligence layer.

NFR-01 sets a two-second target for a risk-scoring response. NFR-05 requires at
least thirty concurrent escrow cycles per minute without functional failure
under controlled load testing. Section 4.5 reports both, and the corrections
record why those figures could not be relied on:

    the hardware, operating system, network conditions, node provider, worker
    configuration, concurrency schedule, and run-to-run variability were not
    retained in the report

Every one of those is a property of *how the test was run* rather than of the
system under test, which is why `run.py` and not this file is the artefact that
closes the gap: it records the environment and the schedule alongside the
numbers. This file only defines the work.

Two tasks are driven, in a 3:1 ratio:

    POST /risk/score    the scoring call NFR-01 bounds
    POST /escrows       the application-layer escrow cycle NFR-05 counts

The on-chain leg is deliberately excluded. A Sepolia transaction takes about
eleven seconds to be included (docs/evidence/sepolia-measurements.json), so a
test that waited for inclusion would measure Ethereum's block interval rather
than this system's capacity, and each repetition would spend real testnet ether.
Section 4.5 must therefore state that NFR-05 is evidenced for the application
layer and that end-to-end cycle time is bounded below by block inclusion.

Payloads are drawn from a seeded generator, so two runs present the same
sequence of work and a difference between them is a difference in the system,
not in the input.
"""

from __future__ import annotations

import os
import random

from locust import HttpUser, between, events, task

# One per role exists in the seed; escrow creation needs `escrow:create`, which
# is the buyer's.
BUYER_EMAIL = os.environ.get("LOAD_EMAIL", "amina.yusuf@example.ng")
BUYER_PASSWORD = os.environ.get("LOAD_PASSWORD", "buyer-demo-2026")

SELLER_ID = os.environ.get("LOAD_SELLER_ID", "tunde.okafor@example.ng")

# Seeded so the request mix is reproducible across repetitions.
SEED = int(os.environ.get("LOAD_SEED", "20260909"))


@events.init_command_line_parser.add_listener
def _(parser) -> None:
    parser.add_argument(
        "--scenario", default="mixed",
        help="mixed (3:1 score to escrow), score-only, or escrow-only",
    )


class EscrowUser(HttpUser):
    """One simulated buyer, holding a session cookie as a browser would."""

    # NFR-05 counts cycles per minute, so the pacing has to be realistic rather
    # than a tight loop: a think time between requests is what makes the
    # concurrency figure mean "thirty users doing this" instead of "one user as
    # fast as possible".
    wait_time = between(0.5, 1.5)

    def on_start(self) -> None:
        self.rng = random.Random(SEED + self.environment.runner.user_count)
        self.authenticated = False

        with self.client.post(
            "/auth/login",
            json={"email": BUYER_EMAIL, "password": BUYER_PASSWORD},
            name="POST /auth/login",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                self.authenticated = True
                response.success()
            else:
                # Without a session every later request is a 401, which would
                # look like a capacity failure rather than a setup failure.
                response.failure(
                    f"login failed with {response.status_code}; is the database "
                    f"seeded? run python -m smartguard_api.seed",
                )

    def scoring_payload(self) -> dict:
        """A plausible request, inside the bounds ScoringInput enforces."""
        rng = self.rng
        balance = round(rng.uniform(0.5, 40.0), 4)
        return {
            "amountEth": round(rng.uniform(0.01, min(balance, 10.0)), 4),
            "sellerId": SELLER_ID,
            "accountAgeDays": rng.randint(1, 3650),
            "velocity24h": rng.randint(0, 40),
            "counterpartyReputation": round(rng.random(), 4),
            "sellerDisputeRate": round(rng.betavariate(1.2, 20.0), 4),
            "buyerDisputeRate": round(rng.betavariate(1.2, 20.0), 4),
            "deviceConsistent": rng.random() > 0.15,
            "highRiskGeo": rng.random() < 0.2,
            "offHours": rng.random() < 0.3,
            "meanAmount30d": round(rng.uniform(0.05, 12.0), 4),
            "accountBalanceEth": balance,
            "channel": rng.choice(["web", "mobile"]),
        }

    @task(3)
    def score(self) -> None:
        if not self.authenticated:
            return
        self.client.post(
            "/risk/score",
            json=self.scoring_payload(),
            name="POST /risk/score",
        )

    @task(1)
    def create_escrow(self) -> None:
        """A full application-layer escrow cycle: score, then persist."""
        if not self.authenticated:
            return
        scoring = self.scoring_payload()
        with self.client.post(
            "/escrows",
            json={
                "sellerId": SELLER_ID,
                "amountEth": scoring["amountEth"],
                "itemDescription": "Load-test escrow, generated request",
                "scoring": scoring,
            },
            name="POST /escrows",
            catch_response=True,
        ) as response:
            # A risk score above the threshold is a *correct* refusal, not a
            # failure. Counting it as one would make the error rate a function
            # of the random payload mix.
            if response.status_code in (200, 201, 409, 422):
                response.success()
            elif response.status_code == 403:
                response.success()
            else:
                response.failure(f"unexpected {response.status_code}")
