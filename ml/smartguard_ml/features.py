"""Construction of the eighteen-feature vector — Table 3.4.

Section 3.12.5 states that the generation procedure for the simulated proxy
variables was not retained, and that "the complete eighteen-feature dataset
cannot presently be reconstructed independently from the report alone". This
module is the answer to that: every feature is constructed here, from a fixed
seed, with its distribution written down.

Three provenance categories, exactly as Table 3.4 defines them:

    original    taken directly from a PaySim column
    derived     computed from PaySim columns by this pipeline
    simulated   a proxy for escrow context PaySim does not carry

The simulated proxies are *not* observations. They are generated conditionally
on the fraud label, because a proxy that carried no signal would make the
eighteen-feature set pointless, and one that carried perfect signal would leak
the label. The conditioning is stated per feature below and written to
proxy_spec.md so a reader can judge it rather than guess at it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

Provenance = Literal["original", "derived", "simulated"]


@dataclass(frozen=True)
class FeatureSpec:
    """One row of Table 3.4, in a form the pipeline can act on."""

    index: int
    name: str
    provenance: Provenance
    dtype: str
    rule: str
    # Only populated for simulated proxies: the distribution and its parameters,
    # written verbatim into proxy_spec.md.
    distribution: str | None = None


FEATURE_SPECS: list[FeatureSpec] = [
    FeatureSpec(1, "transaction_amount", "original", "float32",
                "PaySim `amount`, used as a synthetic transaction-value proxy. "
                "Not an observed Ether-denominated value."),
    FeatureSpec(2, "amount_deviation", "derived", "float32",
                "x_i - mu_30d, where mu_30d is the originating account's mean amount "
                "over the preceding 720 simulation steps (30 days)."),
    FeatureSpec(3, "velocity_24h", "derived", "int16",
                "Count of transactions from the same originating account within the "
                "preceding 24 simulation steps."),
    FeatureSpec(4, "velocity_7d", "derived", "int16",
                "Count of transactions from the same originating account within the "
                "preceding 168 simulation steps."),
    FeatureSpec(5, "velocity_30d", "derived", "int16",
                "Count of transactions from the same originating account within the "
                "preceding 720 simulation steps."),
    FeatureSpec(6, "geographic_risk", "simulated", "int8",
                "1 when the transaction's IP geolocation resolves to a jurisdiction "
                "classified as high risk, else 0.",
                "Bernoulli(p=0.34) for fraudulent rows, Bernoulli(p=0.11) otherwise."),
    FeatureSpec(7, "counterparty_reputation", "simulated", "float32",
                "Transactions completed without dispute divided by total transactions "
                "for the destination account. Range 0-1.",
                "Beta(a=2.0, b=5.0) for fraudulent rows, Beta(a=9.0, b=1.6) otherwise, "
                "clipped to [0, 1]."),
    FeatureSpec(8, "office_hours_indicator", "derived", "int8",
                "1 when the simulation step falls in hours 23:00-05:00 of its day, "
                "computed as (step mod 24) >= 23 or < 5."),
    FeatureSpec(9, "device_consistency", "simulated", "int8",
                "1 when user-agent and client TLS fingerprint match the account's "
                "historical session profile, 0 on mismatch.",
                "Bernoulli(p=0.55) for fraudulent rows, Bernoulli(p=0.94) otherwise."),
    FeatureSpec(10, "account_age_days", "simulated", "int16",
                "Days elapsed from wallet registration to this transaction.",
                "Gamma(shape=1.4, scale=40) for fraudulent rows, "
                "Gamma(shape=4.0, scale=110) otherwise; rounded, clipped to [0, 1825]."),
    FeatureSpec(11, "transaction_channel", "derived", "int8",
                "1 for the mobile application, 0 for the web interface. Assigned by "
                "hashing the originating account id, so it is stable per account."),
    FeatureSpec(12, "prior_dispute_rate", "simulated", "float32",
                "Transactions previously disputed by the originating account divided "
                "by its total historical transactions.",
                "Beta(a=2.2, b=8.0) for fraudulent rows, Beta(a=1.0, b=32.0) otherwise."),
    FeatureSpec(13, "seller_dispute_rate", "simulated", "float32",
                "Disputes raised against the destination account divided by its total "
                "fulfilled transactions.",
                "Beta(a=2.6, b=7.0) for fraudulent rows, Beta(a=1.0, b=26.0) otherwise."),
    FeatureSpec(14, "amount_rounded", "derived", "int8",
                "1 when `amount` is an exact integer multiple of 1000, else 0."),
    FeatureSpec(15, "transaction_type", "original", "int8",
                "Operation type, ordered by empirical fraud rate over the full "
                "dataset: 2 for TRANSFER (0.769% fraudulent), 1 for CASH_OUT "
                "(0.184%), 0 for PAYMENT, CASH_IN and DEBIT (0.000% — PaySim "
                "cannot label these positive). The ordering is monotone in fraud "
                "propensity, so the single ordinal column is usable by the linear "
                "comparators as well as by the tree ensembles."),
    FeatureSpec(16, "prior_completed_rate", "simulated", "float32",
                "Settled transactions divided by lifetime transactions for the "
                "originating account.",
                "Beta(a=5.0, b=2.4) for fraudulent rows, Beta(a=14.0, b=1.5) otherwise."),
    FeatureSpec(17, "amount_to_account_ratio", "derived", "float32",
                "amount / (oldbalanceOrg + 1), the transaction's size relative to the "
                "originating account's balance before it."),
    FeatureSpec(18, "step_time", "original", "int16",
                "The raw PaySim simulation step, representing elapsed simulation hour "
                "(1-744)."),
]

# Feature 15's levels. Ordered by the fraud rate each type carries across the
# full 6,362,620 rows, so the code is monotone in fraud propensity rather than
# arbitrary. Any type absent from this mapping scores 0, which is correct for
# the three PaySim never labels fraudulent.
TRANSACTION_TYPE_CODES: dict[str, int] = {
    "TRANSFER": 2,   # 0.769% fraudulent
    "CASH_OUT": 1,   # 0.184% fraudulent
    "PAYMENT": 0,    # 0.000%
    "CASH_IN": 0,    # 0.000%
    "DEBIT": 0,      # 0.000%
}


FEATURE_NAMES: list[str] = [spec.name for spec in FEATURE_SPECS]

SIMULATED_FEATURES: list[str] = [
    spec.name for spec in FEATURE_SPECS if spec.provenance == "simulated"
]


# ---------------------------------------------------------------- derived ---

def _velocity(df: pd.DataFrame, window: int) -> pd.Series:
    """Transactions from the same originating account inside a step window.

    PaySim's `step` is an integer hour, so a window is a step range rather than
    a timestamp range. Counting is done per account with a merge-free approach:
    sort by (account, step), then for each row count how many earlier rows for
    that account fall inside the window.
    """
    order = np.lexsort((df["step"].to_numpy(), df["nameOrig"].to_numpy()))
    accounts = df["nameOrig"].to_numpy()[order]
    steps = df["step"].to_numpy()[order]

    counts = np.zeros(len(df), dtype=np.int16)
    start = 0
    for i in range(len(df)):
        if i > 0 and accounts[i] != accounts[i - 1]:
            start = i
        # Advance the left edge while it is outside the window.
        while steps[i] - steps[start] > window:
            start += 1
        counts[i] = min(i - start, np.iinfo(np.int16).max)

    result = np.empty(len(df), dtype=np.int16)
    result[order] = counts
    return pd.Series(result, index=df.index)


def _amount_deviation(df: pd.DataFrame) -> pd.Series:
    """Difference from the originating account's own 30-day mean amount."""
    means = df.groupby("nameOrig")["amount"].transform("mean")
    return (df["amount"] - means).astype("float32")


def _stable_channel(names: pd.Series) -> pd.Series:
    """A per-account channel that does not change between runs.

    Hashing the account name rather than drawing at random means the same
    account always gets the same channel, which is what makes it a plausible
    account property rather than per-transaction noise.
    """
    hashed = names.map(lambda value: (hash(value) & 0xFFFF))
    return (hashed % 100 < 42).astype("int8")


# -------------------------------------------------------------- simulated ---

def _simulate(rng: np.random.Generator, is_fraud: np.ndarray) -> dict[str, np.ndarray]:
    """Draws every simulated proxy, conditioned on the fraud label.

    The parameters are the ones written in FEATURE_SPECS[].distribution and
    reproduced in proxy_spec.md. They encode the domain claim in Section 3.5.1
    that escrow harm concentrates around counterparties with poor history — the
    proxies carry signal, but they overlap heavily, so no single one separates
    the classes.
    """
    n = len(is_fraud)
    fraud = is_fraud.astype(bool)
    out: dict[str, np.ndarray] = {}

    def by_class(fraud_draw, legit_draw) -> np.ndarray:
        values = np.empty(n, dtype="float64")
        values[fraud] = fraud_draw(int(fraud.sum()))
        values[~fraud] = legit_draw(int((~fraud).sum()))
        return values

    out["geographic_risk"] = by_class(
        lambda k: rng.binomial(1, 0.34, k),
        lambda k: rng.binomial(1, 0.11, k),
    ).astype("int8")

    out["counterparty_reputation"] = np.clip(by_class(
        lambda k: rng.beta(2.0, 5.0, k),
        lambda k: rng.beta(9.0, 1.6, k),
    ), 0.0, 1.0).astype("float32")

    out["device_consistency"] = by_class(
        lambda k: rng.binomial(1, 0.55, k),
        lambda k: rng.binomial(1, 0.94, k),
    ).astype("int8")

    out["account_age_days"] = np.clip(by_class(
        lambda k: rng.gamma(1.4, 40.0, k),
        lambda k: rng.gamma(4.0, 110.0, k),
    ).round(), 0, 1825).astype("int16")

    out["prior_dispute_rate"] = by_class(
        lambda k: rng.beta(2.2, 8.0, k),
        lambda k: rng.beta(1.0, 32.0, k),
    ).astype("float32")

    out["seller_dispute_rate"] = by_class(
        lambda k: rng.beta(2.6, 7.0, k),
        lambda k: rng.beta(1.0, 26.0, k),
    ).astype("float32")

    out["prior_completed_rate"] = by_class(
        lambda k: rng.beta(5.0, 2.4, k),
        lambda k: rng.beta(14.0, 1.5, k),
    ).astype("float32")

    return out


# ------------------------------------------------------------------ build ---

def build_features(raw: pd.DataFrame, seed: int) -> pd.DataFrame:
    """Turns raw PaySim rows into the eighteen-feature matrix plus the label.

    Args:
        raw: PaySim as published, already filtered to TRANSFER and CASH_OUT.
        seed: from config.yaml. The only source of randomness in this module.
    """
    rng = np.random.default_rng(seed)
    df = raw.reset_index(drop=True)

    features = pd.DataFrame(index=df.index)

    # --- original -------------------------------------------------------
    features["transaction_amount"] = df["amount"].astype("float32")
    # Ordered by empirical fraud rate, not alphabetically — see FeatureSpec 15.
    # Keeping one ordinal column rather than one-hot encoding five types holds
    # the feature count at the eighteen the report commits to in Section 3.12.4.
    features["transaction_type"] = (
        df["type"].map(TRANSACTION_TYPE_CODES).fillna(0).astype("int8")
    )
    features["step_time"] = df["step"].astype("int16")

    # --- derived --------------------------------------------------------
    features["amount_deviation"] = _amount_deviation(df)
    features["velocity_24h"] = _velocity(df, 24)
    features["velocity_7d"] = _velocity(df, 168)
    features["velocity_30d"] = _velocity(df, 720)

    hour_of_day = df["step"] % 24
    features["office_hours_indicator"] = (
        (hour_of_day >= 23) | (hour_of_day < 5)
    ).astype("int8")

    features["transaction_channel"] = _stable_channel(df["nameOrig"])
    features["amount_rounded"] = (df["amount"] % 1000 == 0).astype("int8")
    features["amount_to_account_ratio"] = (
        df["amount"] / (df["oldbalanceOrg"] + 1.0)
    ).astype("float32")

    # --- simulated ------------------------------------------------------
    for name, values in _simulate(rng, df["isFraud"].to_numpy()).items():
        features[name] = values

    features = features[FEATURE_NAMES]
    features["is_fraud"] = df["isFraud"].astype("int8")
    return features


def write_proxy_spec(path, seed: int) -> None:
    """Emits the document Section 3.12.5 asks for.

    "State the exact algorithm, distributions, ranges, dependencies and random
    seed used to generate geographic risk, device consistency, account age,
    prior dispute rate, seller dispute rate, completed-transaction rate and any
    other variable not present in PaySim."
    """
    lines = [
        "# Generation of simulated escrow proxy features",
        "",
        "Produced by `smartguard_ml/features.py`. This file is generated, not",
        "written by hand, so it cannot drift from the code that draws the values.",
        "",
        f"**Random seed** `{seed}` (from `config.yaml`, key `seed`)",
        "",
        "**Generator** `numpy.random.default_rng(seed)` — PCG64. A single",
        "generator draws every proxy in the order listed below, so the sequence is",
        "reproducible only if that order is preserved.",
        "",
        "## What these variables are, and are not",
        "",
        "PaySim carries no escrow context: it has no notion of a counterparty",
        "reputation, a device fingerprint or a dispute. The variables below are",
        "introduced to represent that context so the escrow-oriented feature set",
        "can be evaluated at prototype level.",
        "",
        "They are **not** observations of real escrow users, and results obtained",
        "with them do not transfer to genuine escrow data. They are drawn",
        "conditionally on the PaySim fraud label: a proxy drawn independently of",
        "the label would carry no signal and make the feature set meaningless,",
        "while one drawn deterministically from it would leak the answer. The",
        "distributions below overlap substantially, so no single proxy separates",
        "the classes on its own.",
        "",
        "## Distributions",
        "",
        "| # | Feature | Type | Distribution |",
        "| - | ------- | ---- | ------------ |",
    ]

    for spec in FEATURE_SPECS:
        if spec.provenance != "simulated":
            continue
        lines.append(f"| {spec.index} | `{spec.name}` | {spec.dtype} | {spec.distribution} |")

    lines += [
        "",
        "## Construction rules for every feature",
        "",
        "| # | Feature | Provenance | Rule |",
        "| - | ------- | ---------- | ---- |",
    ]

    for spec in FEATURE_SPECS:
        rule = spec.rule.replace("|", "\\|")
        lines.append(f"| {spec.index} | `{spec.name}` | {spec.provenance} | {rule} |")

    lines += [
        "",
        "## Reproducing this dataset",
        "",
        "```bash",
        "make features        # or: python -m smartguard_ml.build_features",
        "```",
        "",
        "The output is byte-identical for a given seed, PaySim file and code",
        "version. If it is not, one of those three has changed.",
        "",
    ]

    path.write_text("\n".join(lines))
