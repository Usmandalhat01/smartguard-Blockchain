"""Derivation of every reported figure and table.

This module reads *only* the saved prediction files and the saved split. It does
not load a model, does not touch the raw data, and cannot re-partition anything.

That constraint is the point. Correction 2 required the confusion matrix, the
classification report, the ROC curves, the AUCs and the comparison table to be
"regenerate[d] [...] from one saved test split and one set of prediction files".
Because every figure below is computed from the same arrays in the same
function, they cannot disagree with each other. If Table 4.1 says the F1 is
0.62, the confusion matrix beside it produces 0.62.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")  # No display on a build machine or in CI.

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score, auc, classification_report, confusion_matrix,
    f1_score, precision_recall_curve, precision_score, recall_score, roc_curve,
)

from .config import PATHS
from . import stats as stats_module

# A print-legible palette that survives greyscale reproduction, which a bound
# thesis may well be subjected to.
PALETTE = ["#2A4B8D", "#A8471B", "#1B6E4B", "#6B4C9A", "#8A6A12", "#4A5568"]

plt.rcParams.update({
    "figure.dpi": 150,
    "savefig.dpi": 200,
    "savefig.bbox": "tight",
    "font.size": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linewidth": 0.6,
})


def load_predictions(label: str) -> pd.DataFrame:
    path = PATHS.predictions(label)
    if not path.exists():
        raise FileNotFoundError(
            f"No predictions at {path}. Run `make evaluate` first — this module "
            "is not permitted to compute predictions itself.",
        )
    return pd.read_parquet(path)


def metrics_at(y_true: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, float]:
    """Every headline metric, from one thresholding of one score array."""
    predicted = (scores >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, predicted, labels=[0, 1]).ravel()

    fpr, tpr, _ = roc_curve(y_true, scores)

    return {
        "threshold": float(threshold),
        "accuracy": float(accuracy_score(y_true, predicted)),
        "precision_fraud": float(precision_score(y_true, predicted, zero_division=0)),
        "recall_fraud": float(recall_score(y_true, predicted, zero_division=0)),
        "f1_fraud": float(f1_score(y_true, predicted, zero_division=0)),
        "roc_auc": float(auc(fpr, tpr)),
        "true_negatives": int(tn),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_positives": int(tp),
        "false_positive_rate": float(fp / (fp + tn)) if (fp + tn) else 0.0,
    }


# ------------------------------------------------------------ figure 4.1 ---

def confusion_figure(label: str, y_true, scores, threshold: float, path: Path) -> None:
    """The confusion matrix, annotated with the metrics it implies.

    The metrics are printed on the figure itself. The review found a matrix that
    "did not generate the reported classification metrics"; putting the derived
    values on the same image as the counts makes that class of contradiction
    visible rather than latent.
    """
    predicted = (scores >= threshold).astype(int)
    matrix = confusion_matrix(y_true, predicted, labels=[0, 1])
    derived = metrics_at(y_true, scores, threshold)

    fig, ax = plt.subplots(figsize=(4.6, 4.0))
    ax.imshow(matrix, cmap="Blues", aspect="auto")
    ax.grid(False)

    ticks = ["Legitimate", "Fraudulent"]
    ax.set_xticks([0, 1], labels=ticks)
    ax.set_yticks([0, 1], labels=ticks)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")

    peak = matrix.max()
    for i in range(2):
        for j in range(2):
            ax.text(
                j, i, f"{matrix[i, j]:,}",
                ha="center", va="center",
                color="white" if matrix[i, j] > peak * 0.5 else "#14181F",
                fontsize=11, fontweight="600",
            )

    ax.set_title(
        f"{label} · held-out test, threshold {threshold:.2f}\n"
        f"precision {derived['precision_fraud']:.3f} · "
        f"recall {derived['recall_fraud']:.3f} · "
        f"F1 {derived['f1_fraud']:.3f}",
        fontsize=9,
    )

    fig.savefig(path)
    plt.close(fig)


# ------------------------------------------------------------ figure 4.2 ---

def roc_figure(results: dict[str, dict], path: Path) -> None:
    fig, ax = plt.subplots(figsize=(5.4, 4.6))

    ordered = sorted(results.items(), key=lambda kv: -kv[1]["metrics"]["roc_auc"])
    for i, (label, payload) in enumerate(ordered):
        fpr, tpr, _ = roc_curve(payload["y_true"], payload["scores"])
        ax.plot(
            fpr, tpr,
            color=PALETTE[i % len(PALETTE)], linewidth=1.6,
            label=f"{label} (AUC {payload['metrics']['roc_auc']:.4f})",
        )

    ax.plot([0, 1], [0, 1], color="#98A0AE", linewidth=1, linestyle="--",
            label="Chance (AUC 0.5000)")
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_title("ROC curves on the held-out test partition", fontsize=10)
    ax.legend(loc="lower right", frameon=False, fontsize=8)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.02)

    fig.savefig(path)
    plt.close(fig)


# ------------------------------------------------------------ figure 4.3 ---

def comparison_figure(table: pd.DataFrame, path: Path) -> None:
    metrics = ["accuracy", "precision_fraud", "recall_fraud", "f1_fraud", "roc_auc"]
    pretty = ["Accuracy", "Precision", "Recall", "F1", "ROC-AUC"]

    fig, ax = plt.subplots(figsize=(7.4, 4.0))
    x = np.arange(len(metrics))
    width = 0.8 / len(table)

    for i, (_, row) in enumerate(table.iterrows()):
        ax.bar(
            x + i * width - 0.4 + width / 2,
            [row[m] for m in metrics],
            width,
            label=row["model"],
            color=PALETTE[i % len(PALETTE)],
        )

    ax.set_xticks(x, labels=pretty)
    ax.set_ylabel("Score")
    ax.set_ylim(0, 1.05)
    ax.set_title("Classifier comparison on one held-out test partition", fontsize=10)
    ax.legend(frameon=False, fontsize=8, ncol=2)

    fig.savefig(path)
    plt.close(fig)


# ------------------------------------------------------------ figure 4.3 ---

def radar_figure(
    table: pd.DataFrame, timings: dict[str, float], path: Path, top_n: int = 3,
) -> None:
    """The three strongest classifiers across six dimensions at once.

    Section 4.3.4 describes this figure as plotting "the three strongest
    classifiers against six dimensions", and records that it could not be
    regenerated because "the underlying prediction and timing records were
    unavailable". The sixth dimension is inference speed, which is why the
    evaluation stage records microseconds per row.

    Speed is normalised against the slowest of the plotted models rather than
    against an absolute scale, so the axis says "fastest of these three", not
    "fast". An absolute speed axis would need a stated reference machine.
    """
    metrics = ["accuracy", "precision_fraud", "recall_fraud", "f1_fraud", "roc_auc"]
    pretty = ["Accuracy", "Precision\n(fraud)", "Recall\n(fraud)", "F1\n(fraud)",
              "ROC-AUC", "Inference\nspeed"]

    plotted = table.head(top_n)

    # Slower is a larger microseconds-per-row, so the axis is inverted to make
    # "further from the centre is better" hold on all six — otherwise the
    # enclosed area carries no meaning. The fastest of the plotted models sits
    # at 1.0 and the rest fall proportionally below it.
    speeds = {m: timings.get(m) for m in plotted["model"]}
    usable = [v for v in speeds.values() if v]
    fastest = min(usable) if usable else None

    def speed_score(model: str) -> float:
        measured = speeds.get(model)
        if not measured or not fastest:
            return 0.0
        return fastest / measured

    angles = np.linspace(0, 2 * np.pi, len(pretty), endpoint=False).tolist()
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(5.2, 5.2), subplot_kw={"polar": True})

    for i, (_, row) in enumerate(plotted.iterrows()):
        values = [float(row[m]) for m in metrics]
        values.append(speed_score(row["model"]))
        closed = values + values[:1]

        ax.plot(angles, closed, color=PALETTE[i % len(PALETTE)], linewidth=1.6,
                label=row["model"])
        ax.fill(angles, closed, color=PALETTE[i % len(PALETTE)], alpha=0.10)

    ax.set_xticks(angles[:-1], labels=pretty, fontsize=8)
    ax.set_ylim(0, 1.0)
    ax.set_yticks([0.25, 0.5, 0.75, 1.0], labels=["0.25", "0.50", "0.75", "1.00"],
                  fontsize=7)
    ax.set_rlabel_position(180 / len(pretty))
    ax.grid(alpha=0.3, linewidth=0.6)
    ax.set_title(
        f"Multi-dimensional comparison, {top_n} strongest by fraud-class F1\n"
        "all axes oriented so that further from the centre is better",
        fontsize=9, pad=18,
    )
    ax.legend(loc="upper right", bbox_to_anchor=(1.22, 1.14), frameon=False,
              fontsize=8)

    fig.savefig(path)
    plt.close(fig)


# ------------------------------------------------------------ figure 4.5 ---

def threshold_figure(
    label: str, y_true, scores, configured: float, sweep: pd.DataFrame, path: Path,
) -> None:
    """Precision, recall and false-positive rate across the operating range.

    Correction 5 required this to be regenerated from saved probabilities before
    0.75 could be described as anything other than a configured value. The
    configured point is marked, and the sweep is what decides whether the report
    may call it an optimum.
    """
    fig, ax = plt.subplots(figsize=(6.0, 4.0))

    ax.plot(sweep["threshold"], sweep["precision_fraud"], color=PALETTE[0],
            linewidth=1.6, label="Precision (fraud)")
    ax.plot(sweep["threshold"], sweep["recall_fraud"], color=PALETTE[1],
            linewidth=1.6, label="Recall (fraud)")
    ax.plot(sweep["threshold"], sweep["f1_fraud"], color=PALETTE[2],
            linewidth=1.6, label="F1 (fraud)")
    ax.plot(sweep["threshold"], sweep["false_positive_rate"], color=PALETTE[3],
            linewidth=1.2, linestyle="--", label="False positive rate")

    ax.axvline(configured, color="#14181F", linewidth=1, linestyle=":")
    ax.annotate(
        f"configured {configured:.2f}",
        xy=(configured, 0.02), xytext=(configured + 0.02, 0.06),
        fontsize=8, color="#14181F",
    )

    best = sweep.loc[sweep["f1_fraud"].idxmax()]
    ax.axvline(float(best["threshold"]), color=PALETTE[2], linewidth=1, linestyle=":")
    ax.annotate(
        f"max F1 at {best['threshold']:.2f}",
        xy=(best["threshold"], 0.9), xytext=(best["threshold"] + 0.02, 0.92),
        fontsize=8, color=PALETTE[2],
    )

    ax.set_xlabel("Risk score threshold")
    ax.set_ylabel("Value")
    ax.set_ylim(0, 1.02)
    ax.set_title(f"{label} · threshold sensitivity on the held-out test partition",
                 fontsize=10)
    ax.legend(frameon=False, fontsize=8, loc="center right")

    fig.savefig(path)
    plt.close(fig)


def threshold_sweep(y_true, scores, config: dict) -> pd.DataFrame:
    settings = config["threshold"]
    grid = np.arange(
        settings["sweep_start"],
        settings["sweep_stop"] + settings["sweep_step"] / 2,
        settings["sweep_step"],
    )
    return pd.DataFrame([metrics_at(y_true, scores, float(t)) for t in grid])


# ------------------------------------------------------------ figure 4.4 ---

def importance_figure(importances: pd.DataFrame, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(6.0, 4.4))
    top = importances.head(10).iloc[::-1]

    ax.barh(top["feature"], top["importance"], color=PALETTE[0], height=0.68)
    ax.set_xlabel("Mean decrease in Gini impurity")
    ax.set_title("Feature importance, ten most influential", fontsize=10)
    ax.grid(axis="y", visible=False)

    fig.savefig(path)
    plt.close(fig)


# ------------------------------------------------------------- assembly ----

def build(config: dict[str, Any], labels: list[str], proposed: str) -> dict[str, Any]:
    """Produces every figure, table and metric from the saved predictions."""
    PATHS.ensure()
    threshold = config["threshold"]["configured"]

    results: dict[str, dict] = {}
    for label in labels:
        frame = load_predictions(label)
        y_true = frame["y_true"].to_numpy()
        scores = frame["score"].to_numpy()
        results[label] = {
            "y_true": y_true,
            "scores": scores,
            "metrics": metrics_at(y_true, scores, threshold),
        }

    # --- Table 4.1 ------------------------------------------------------
    table = pd.DataFrame([
        {"model": label, **payload["metrics"]} for label, payload in results.items()
    ]).sort_values("f1_fraud", ascending=False).reset_index(drop=True)
    table.to_csv(PATHS.tables / "table_4_1_classification.csv", index=False)

    # --- classification report, per model -------------------------------
    reports = {}
    for label, payload in results.items():
        predicted = (payload["scores"] >= threshold).astype(int)
        reports[label] = classification_report(
            payload["y_true"], predicted,
            target_names=["legitimate", "fraudulent"],
            output_dict=True, zero_division=0,
        )
    (PATHS.tables / "classification_reports.json").write_text(
        json.dumps(reports, indent=2) + "\n",
    )

    # --- figures ---------------------------------------------------------
    #
    # Filenames follow the figure numbers in the corrected report, so assembling
    # the document is a copy rather than a renumbering exercise:
    #
    #   Figure 4.1  ROC curves                 Section 4.3.3
    #   Figure 4.2  Model comparison           Section 4.3.4
    #   Figure 4.3  Radar comparison           Section 4.3.4
    #   Figure 4.4  Feature importance         Section 4.3.5
    #   Figure 4.5  Threshold sensitivity      Section 4.3.6
    #
    # The confusion matrix carries no number because Section 4.3.2 removed it:
    # the matrix in the submitted report described 1,906,034 observations and
    # could not be reconciled with the documented 954,393-row test partition.
    # This run reconciles, so the matrix can be reinstated — see docs/FIGURES.md
    # for where it goes and what renumbering that implies.
    confusion_figure(
        proposed, results[proposed]["y_true"], results[proposed]["scores"],
        threshold, PATHS.figures / "confusion_matrix_section_4_3_2.png",
    )
    roc_figure(results, PATHS.figures / "figure_4_1_roc_curves.png")
    comparison_figure(table, PATHS.figures / "figure_4_2_model_comparison.png")

    # Figure 4.3's sixth axis is inference speed, recorded by the evaluate
    # stage. Absent that file the radar is skipped rather than drawn with a
    # fabricated axis.
    timings: dict[str, float] = {}
    records_path = PATHS.outputs / "evaluation_records.json"
    if records_path.exists():
        timings = {
            record["model"]: record.get("microseconds_per_row")
            for record in json.loads(records_path.read_text())
        }
    radar_figure(table, timings, PATHS.figures / "figure_4_3_radar_comparison.png")

    # Figure 4.4 is read from the artefact the evaluate stage wrote, so this
    # module still never loads a model.
    importance_path = PATHS.tables / "feature_importance.csv"
    if importance_path.exists():
        importance_figure(
            pd.read_csv(importance_path),
            PATHS.figures / "figure_4_4_feature_importance.png",
        )

    sweep = threshold_sweep(
        results[proposed]["y_true"], results[proposed]["scores"], config,
    )
    sweep.to_csv(PATHS.tables / "threshold_sensitivity.csv", index=False)
    threshold_figure(
        proposed, results[proposed]["y_true"], results[proposed]["scores"],
        threshold, sweep, PATHS.figures / "figure_4_5_threshold_sensitivity.png",
    )

    # --- inferential comparison, Objective Four -------------------------
    alpha = config["statistics"]["alpha"]
    comparisons = []
    for label in labels:
        if label == proposed:
            continue
        result = stats_module.mcnemar(
            results[proposed]["y_true"],
            (results[proposed]["scores"] >= threshold).astype(int),
            (results[label]["scores"] >= threshold).astype(int),
        )
        comparisons.append({
            "proposed": proposed,
            "comparator": label,
            **result,
            "significant": bool(result["p_value"] is not None and result["p_value"] < alpha),
            "interpretation": stats_module.interpret(result, alpha, proposed, label),
        })

    (PATHS.tables / "statistical_comparison.json").write_text(
        json.dumps(comparisons, indent=2) + "\n",
    )

    best_threshold = sweep.loc[sweep["f1_fraud"].idxmax()]

    return {
        "threshold_applied": threshold,
        "table_4_1": table.to_dict(orient="records"),
        "statistical_comparison": comparisons,
        "threshold_analysis": {
            "configured": threshold,
            "max_f1_threshold": float(best_threshold["threshold"]),
            "max_f1": float(best_threshold["f1_fraud"]),
            "f1_at_configured": float(results[proposed]["metrics"]["f1_fraud"]),
        },
    }
