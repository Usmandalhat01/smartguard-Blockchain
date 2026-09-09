"""Inferential comparison between classifiers.

Chapter Five records Objective Four as only partially achieved because "no
inferential statistical test was conducted to establish whether differences
between the compared classifiers were statistically significant".

McNemar's test is the right instrument here. The classifiers are compared on the
*same* held-out rows, so their errors are paired, and McNemar asks precisely
whether the disagreements between two paired classifiers are asymmetric. A
two-sample t-test would assume independence the design does not have.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import stats


def mcnemar(y_true: np.ndarray, pred_a: np.ndarray, pred_b: np.ndarray) -> dict[str, Any]:
    """Compares two classifiers on the same rows.

    Returns the discordant counts alongside the statistic, because the counts
    are what a reader needs in order to judge whether the result is meaningful:
    a significant p-value on two discordant pairs is not evidence of anything.
    """
    correct_a = pred_a == y_true
    correct_b = pred_b == y_true

    # b: a right and b wrong. c: a wrong and b right.
    b = int(np.sum(correct_a & ~correct_b))
    c = int(np.sum(~correct_a & correct_b))
    n = b + c

    if n == 0:
        return {
            "b_only_a_correct": 0,
            "c_only_b_correct": 0,
            "discordant": 0,
            "statistic": None,
            "p_value": None,
            "method": "none",
            "note": "The classifiers made identical predictions on every test row.",
        }

    if n < 25:
        # Exact binomial. The chi-square approximation is unreliable this small.
        p_value = float(stats.binomtest(b, n, 0.5).pvalue)
        return {
            "b_only_a_correct": b,
            "c_only_b_correct": c,
            "discordant": n,
            "statistic": None,
            "p_value": p_value,
            "method": "exact_binomial",
            "note": "Fewer than 25 discordant pairs; exact test used.",
        }

    # Edwards' continuity correction.
    statistic = (abs(b - c) - 1) ** 2 / n
    p_value = float(stats.chi2.sf(statistic, df=1))

    return {
        "b_only_a_correct": b,
        "c_only_b_correct": c,
        "discordant": n,
        "statistic": round(float(statistic), 4),
        "p_value": p_value,
        "method": "chi2_continuity_corrected",
        "note": None,
    }


def interpret(result: dict[str, Any], alpha: float, name_a: str, name_b: str) -> str:
    """A sentence the report can use without overstating what was shown."""
    p = result.get("p_value")
    if p is None:
        return f"{name_a} and {name_b} could not be compared: {result['note']}"

    if p < alpha:
        winner = name_a if result["b_only_a_correct"] > result["c_only_b_correct"] else name_b
        return (
            f"The difference between {name_a} and {name_b} is statistically "
            f"significant (McNemar, p = {p:.3g} < {alpha}), favouring {winner} on "
            f"{result['discordant']:,} discordant test rows."
        )

    return (
        f"The difference between {name_a} and {name_b} is not statistically "
        f"significant (McNemar, p = {p:.3g}, alpha = {alpha}) on "
        f"{result['discordant']:,} discordant test rows. No ranking between them "
        f"is supported by this evidence."
    )
