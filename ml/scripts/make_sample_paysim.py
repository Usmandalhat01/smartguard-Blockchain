#!/usr/bin/env python3
"""Generates a PaySim-shaped CSV for developing the pipeline.

This is NOT PaySim and produces no result that may appear in the report. It
exists so the pipeline can be exercised end to end before the real 470 MB
download is in place, and so a change to the pipeline can be tested in seconds
rather than hours.

The real dataset is López-Rojas, Elmir and Axelsson (2016), on Kaggle as
`ealaxi/paysim1`. Every run against this stand-in prints a warning, and
`run_manifest.json` records which source was used.

    python scripts/make_sample_paysim.py --rows 200000 --fraud-rate 0.0013
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

TYPES = ["PAYMENT", "TRANSFER", "CASH_OUT", "CASH_IN", "DEBIT"]
# Shares roughly matching the published dataset's composition.
TYPE_WEIGHTS = [0.338, 0.084, 0.352, 0.219, 0.007]


def build(rows: int, fraud_rate: float, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    step = rng.integers(1, 745, rows)
    kind = rng.choice(TYPES, size=rows, p=TYPE_WEIGHTS)

    # A heavy right tail, as real transaction amounts have.
    amount = np.round(rng.lognormal(mean=8.9, sigma=1.6, size=rows), 2)

    n_accounts = max(1000, rows // 8)
    orig = np.array([f"C{i:010d}" for i in rng.integers(0, n_accounts, rows)])
    dest = np.array([f"C{i:010d}" for i in rng.integers(0, n_accounts, rows)])

    old_balance_orig = np.round(rng.lognormal(mean=9.6, sigma=1.4, size=rows), 2)
    new_balance_orig = np.maximum(old_balance_orig - amount, 0).round(2)
    old_balance_dest = np.round(rng.lognormal(mean=9.2, sigma=1.7, size=rows), 2)
    new_balance_dest = (old_balance_dest + amount).round(2)

    # PaySim labels fraud only on TRANSFER and CASH_OUT, and fraudulent rows
    # skew to large amounts that drain the originating account.
    eligible = np.isin(kind, ["TRANSFER", "CASH_OUT"])
    target = int(rows * fraud_rate)

    weights = np.where(eligible, amount, 0.0)
    if weights.sum() > 0 and target > 0:
        weights = weights / weights.sum()
        fraud_idx = rng.choice(rows, size=min(target, int(eligible.sum())),
                               replace=False, p=weights)
    else:
        fraud_idx = np.array([], dtype=int)

    is_fraud = np.zeros(rows, dtype=np.int8)
    is_fraud[fraud_idx] = 1

    amount[fraud_idx] = old_balance_orig[fraud_idx]
    new_balance_orig[fraud_idx] = 0.0

    return pd.DataFrame({
        "step": step,
        "type": kind,
        "amount": amount,
        "nameOrig": orig,
        "oldbalanceOrg": old_balance_orig,
        "newbalanceOrig": new_balance_orig,
        "nameDest": dest,
        "oldbalanceDest": old_balance_dest,
        "newbalanceDest": new_balance_dest,
        "isFraud": is_fraud,
        "isFlaggedFraud": np.zeros(rows, dtype=np.int8),
    })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=200_000)
    parser.add_argument("--fraud-rate", type=float, default=0.0013)
    parser.add_argument("--seed", type=int, default=20260909)
    parser.add_argument(
        "--out", type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "raw" / "SAMPLE_paysim.csv",
    )
    args = parser.parse_args()

    frame = build(args.rows, args.fraud_rate, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.out, index=False)

    fraud = int(frame["isFraud"].sum())
    print(f"wrote {args.out}")
    print(f"  {len(frame):,} rows · {fraud:,} fraudulent ({fraud / len(frame) * 100:.4f}%)")
    print()
    print("  This is a development stand-in, not PaySim. No figure derived from")
    print("  it may appear in the report.")


if __name__ == "__main__":
    main()
