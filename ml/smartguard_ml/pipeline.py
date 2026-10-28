"""Stage entry points.

Each stage is runnable on its own and writes its output to a named path, so a
partial rerun is possible and a stage cannot silently depend on another stage's
in-memory state.

    python -m smartguard_ml.pipeline features
    python -m smartguard_ml.pipeline split
    python -m smartguard_ml.pipeline train
    python -m smartguard_ml.pipeline evaluate
    python -m smartguard_ml.pipeline provenance
    python -m smartguard_ml.pipeline report
    python -m smartguard_ml.pipeline all
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from . import evaluate as evaluate_stage
from . import features as feature_stage
from . import provenance as provenance_stage
from . import report as report_stage
from . import split as split_stage
from . import train as train_stage
from .config import (
    PATHS, config_sha256, environment_record, git_commit, git_dirty, load_config,
)

PAYSIM_FRAUD_TYPES = ("TRANSFER", "CASH_OUT")


def _log(message: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {message}", flush=True)


# ------------------------------------------------------------- features ----

def stage_features(config: dict[str, Any]) -> None:
    PATHS.ensure()
    dataset = config["dataset"]
    source = PATHS.root / dataset["source_csv"]

    is_standin = False
    if not source.exists():
        fallback = PATHS.data_raw / "SAMPLE_paysim.csv"
        if not fallback.exists():
            raise SystemExit(
                f"\nPaySim not found at {source}\n\n"
                "Download it from Kaggle (dataset: ealaxi/paysim1), which needs a\n"
                "free account, and place the CSV at that path:\n\n"
                "  kaggle datasets download -d ealaxi/paysim1 -p ml/data/raw --unzip\n\n"
                "Or generate a development stand-in to exercise the pipeline:\n\n"
                "  python scripts/make_sample_paysim.py\n",
            )
        source = fallback
        is_standin = True
        _log("=" * 68)
        _log("USING THE DEVELOPMENT STAND-IN, NOT PaySim.")
        _log("No figure produced by this run may appear in the report.")
        _log("=" * 68)

    _log(f"reading {source.name}")
    raw = pd.read_csv(source)
    _log(f"  {len(raw):,} rows, {int(raw['isFraud'].sum()):,} fraudulent")

    if len(raw) != dataset["expected_rows"]:
        _log(
            f"  WARNING: expected {dataset['expected_rows']:,} rows. The report "
            f"cites that figure; reconcile before publishing.",
        )

    # PaySim labels fraud only on TRANSFER and CASH_OUT, so the other three
    # operation types cannot be positive by construction. Dropping them yields a
    # denser training signal — but it also changes every row count in Table 3.5,
    # and that table is the one the supervisor's corrections reconciled by hand
    # (Section 4.3.2 exists because an earlier confusion matrix described
    # 1,906,034 observations instead of the documented 954,393).
    #
    # Re-opening a settled count is a worse outcome than a diluted majority
    # class, so the filter defaults to off and the partition reproduces
    # Table 3.5 exactly. `transaction_type` is feature 15, so the model can
    # still learn that the three excluded types never carry a positive label.
    # See docs/DECISIONS.md D-009.
    raw_rows = len(raw)
    type_filter_applied = bool(dataset.get("restrict_to_fraud_types", False))

    if type_filter_applied:
        before = raw_rows
        raw = raw[raw["type"].isin(PAYSIM_FRAUD_TYPES)].reset_index(drop=True)
        _log(
            f"  restrict_to_fraud_types: kept {len(raw):,} of {before:,} rows "
            f"({', '.join(PAYSIM_FRAUD_TYPES)}) — Table 3.5 must be regenerated",
        )
    else:
        counts = raw["type"].value_counts()
        _log(
            f"  all {len(raw):,} rows retained across {len(counts)} operation types "
            f"(Table 3.5 reconciliation)",
        )

    duplicates = int(raw.duplicated().sum())
    missing = int(raw.isna().sum().sum())
    _log(f"  duplicates: {duplicates:,} · missing values: {missing:,}")

    frac = dataset.get("sample_frac", 1.0)
    if frac < 1.0:
        _log(f"  sampling {frac:.0%} (stratified on the fraud label)")
        raw = (
            raw.groupby("isFraud", group_keys=False)
            .apply(lambda g: g.sample(frac=frac, random_state=config["seed"]))
            .reset_index(drop=True)
        )
        _log(f"  {len(raw):,} rows retained")

    _log("building the eighteen-feature matrix")
    started = time.perf_counter()
    features = feature_stage.build_features(raw, config["seed"])
    _log(f"  built in {time.perf_counter() - started:.1f}s")

    features.to_parquet(PATHS.features, index=False)
    feature_stage.write_proxy_spec(PATHS.root.parent / "docs" / "proxy_spec.md",
                                   config["seed"])

    # Correction 10: report the actual counts rather than asserting that
    # preprocessing removed some unspecified number of records.
    (PATHS.tables / "preprocessing_counts.json").write_text(json.dumps({
        "raw_rows": raw_rows,
        "restrict_to_fraud_types": type_filter_applied,
        "rows_after_type_filter": int(len(raw)) if type_filter_applied else None,
        "duplicate_rows_found": duplicates,
        "missing_values_found": missing,
        "rows_used": int(len(features)),
        "fraud_rows_used": int(features["is_fraud"].sum()),
        "sample_frac": frac,
        "source_file": source.name,
        "is_development_standin": is_standin,
    }, indent=2) + "\n")

    _log(f"wrote {PATHS.features.relative_to(PATHS.root)}")


# ---------------------------------------------------------------- split ----

def stage_split(config: dict[str, Any]) -> None:
    features = pd.read_parquet(PATHS.features)
    labels = features["is_fraud"]

    split = split_stage.make_split(labels, config, config["seed"])
    split_stage.assert_disjoint(split)
    split_stage.save(split, PATHS.split_indices)

    table = split.describe(labels)
    table.to_csv(PATHS.tables / "table_3_5_partition.csv", index=False)

    _log("partition (Table 3.5), computed from the saved indices:")
    print(table.to_string(index=False))
    _log(f"wrote {PATHS.split_indices.relative_to(PATHS.root)}")


# ---------------------------------------------------------------- train ----

def _load_partitions(config: dict[str, Any]):
    features = pd.read_parquet(PATHS.features)
    split = split_stage.load(PATHS.split_indices)
    X = features[feature_stage.FEATURE_NAMES]
    y = features["is_fraud"]
    return (
        X.iloc[split.train], y.iloc[split.train],
        X.iloc[split.validation], y.iloc[split.validation],
        X.iloc[split.test], y.iloc[split.test],
    )


def stage_train(config: dict[str, Any]) -> None:
    X_train, y_train, X_val, y_val, _, _ = _load_partitions(config)
    _log(f"training on {len(X_train):,} rows, validating on {len(X_val):,}")

    records = []
    for name, spec in config["models"].items():
        records.append(train_stage.train_one(
            name, spec, X_train, y_train, X_val, y_val, config,
        ))

    ablation = config.get("ablation", {})
    if ablation.get("enabled"):
        target = ablation["model"]
        _log(f"ablation: {target} without SMOTE, same split")
        records.append(train_stage.train_one(
            target, config["models"][target], X_train, y_train, X_val, y_val,
            config, balance=False, suffix="_no_smote",
        ))

    train_stage.write_records(records, PATHS.outputs / "training_records.json")
    _log(f"wrote {(PATHS.outputs / 'training_records.json').relative_to(PATHS.root)}")


# ------------------------------------------------------------- evaluate ----

def _labels(config: dict[str, Any]) -> tuple[list[str], str]:
    labels = list(config["models"].keys())
    if config.get("ablation", {}).get("enabled"):
        labels.append(f"{config['ablation']['model']}_no_smote")
    proposed = next(
        (name for name, spec in config["models"].items() if spec.get("proposed")),
        labels[0],
    )
    return labels, proposed


def stage_evaluate(config: dict[str, Any]) -> None:
    _, _, _, _, X_test, y_test = _load_partitions(config)
    labels, _ = _labels(config)

    _log(f"scoring the held-out test partition: {len(X_test):,} rows, "
         f"{int(y_test.sum()):,} fraudulent")

    records = [evaluate_stage.evaluate_one(label, X_test, y_test) for label in labels]
    (PATHS.outputs / "evaluation_records.json").write_text(
        json.dumps(records, indent=2) + "\n",
    )

    # Section 4.3.5's ranking. Extracted here because this stage already holds
    # every fitted estimator; report.py stays unable to load a model.
    _, proposed = _labels(config)
    importances = evaluate_stage.feature_importances(
        proposed, list(X_test.columns),
    )
    if importances is not None:
        importances.to_csv(PATHS.tables / "feature_importance.csv", index=False)
        top = importances.iloc[0]
        _log(
            f"  feature importance for {proposed}: {len(importances)} features, "
            f"strongest {top['feature']} at {top['importance']:.4f}",
        )
    else:
        _log(f"  {proposed} exposes no feature importances; Figure 4.4 omitted")

    _log("wrote prediction files; no metric has been computed yet")


# ----------------------------------------------------------- provenance ----

def stage_provenance(config: dict[str, Any]) -> None:
    """Separates what the model learned from what the simulation supplied.

    Table 4.1 reports an ROC AUC of 1.0000 for four of six classifiers, logistic
    regression among them. That is not attainable on PaySim's observed variables,
    and Section 3.12.5 says why it is attainable here: eight of the eighteen
    features are drawn from distributions conditioned on the fraud label. This
    stage measures how much of the reported performance that accounts for, so
    Chapter Four can state a defensible figure instead of a circular one.
    """
    settings = config.get("provenance", {})
    if not settings.get("enabled", True):
        _log("provenance analysis disabled in config")
        return

    drop = list(settings.get("drop", ["simulated"]))
    X_train, y_train, _, _, X_test, y_test = _load_partitions(config)
    _, proposed = _labels(config)
    threshold = config["threshold"]["configured"]

    # --- 1. each feature's separability on its own -------------------------
    auc = provenance_stage.single_feature_auc(X_test, y_test)
    auc.to_csv(PATHS.tables / "feature_provenance_auc.csv", index=False)

    best = auc.iloc[0]
    _log(f"strongest single feature: {best['feature']} ({best['provenance']}) "
         f"at AUC {best['auc_alone']:.4f} alone")
    for group, rows in auc.groupby("provenance"):
        _log(f"  {group:<10} n={len(rows):<3} max AUC {rows['auc_alone'].max():.4f} "
             f"mean {rows['auc_alone'].mean():.4f}")

    # --- 2. the same estimator without the simulated proxies ---------------
    _log(f"refitting {proposed} on non-{'/'.join(drop)} features only")
    record = provenance_stage.ablate(
        proposed, config["models"][proposed], config,
        X_train, y_train, X_test, y_test, drop, log=_log,
    )

    full = provenance_stage.full_feature_metrics(proposed, threshold)
    record["full_feature_metrics"] = full

    path = PATHS.outputs / "provenance_analysis.json"
    path.write_text(json.dumps(record, indent=2) + "\n")

    ablated = record["metrics"]
    rows = []
    for name, metrics in (("all_18_features", full), ("observed_only", ablated)):
        if metrics is None:
            continue
        rows.append({"feature_set": name, **{
            k: metrics[k] for k in
            ("accuracy", "precision_fraud", "recall_fraud", "f1_fraud", "roc_auc")
        }})
    comparison = pd.DataFrame(rows)
    comparison.to_csv(PATHS.tables / "provenance_ablation.csv", index=False)

    if full is not None:
        _log(f"  all 18 features:  F1 {full['f1_fraud']:.4f} · "
             f"AUC {full['roc_auc']:.4f}")
    _log(f"  observed only:    F1 {ablated['f1_fraud']:.4f} · "
         f"AUC {ablated['roc_auc']:.4f}")
    if full is not None:
        _log(f"  the simulated proxies account for "
             f"{full['f1_fraud'] - ablated['f1_fraud']:+.4f} F1 and "
             f"{full['roc_auc'] - ablated['roc_auc']:+.4f} AUC")

    _log(f"wrote {path.relative_to(PATHS.root)}")


# --------------------------------------------------------------- report ----

def stage_report(config: dict[str, Any]) -> None:
    labels, proposed = _labels(config)
    _log(f"deriving every figure from saved predictions (proposed: {proposed})")

    summary = report_stage.build(config, labels, proposed)

    counts_path = PATHS.tables / "preprocessing_counts.json"
    data_source = json.loads(counts_path.read_text()) if counts_path.exists() else {}

    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "seed": config["seed"],
        "data_source": {
            "file": data_source.get("source_file"),
            "is_development_standin": data_source.get("is_development_standin"),
            "rows_used": data_source.get("rows_used"),
            "fraud_rows_used": data_source.get("fraud_rows_used"),
        },
        "config_sha256": config_sha256(config),
        "repository": {"commit": git_commit(), "dirty_working_tree": git_dirty()},
        "environment": environment_record(),
        "summary": summary,
    }
    PATHS.manifest.write_text(json.dumps(manifest, indent=2, default=str) + "\n")

    print()
    table = pd.DataFrame(summary["table_4_1"])
    display = table[[
        "model", "accuracy", "precision_fraud", "recall_fraud", "f1_fraud", "roc_auc",
    ]].copy()
    for column in display.columns[1:]:
        display[column] = display[column].map(lambda v: f"{v:.4f}")
    print("Table 4.1 — held-out test partition, threshold "
          f"{summary['threshold_applied']:.2f}")
    print(display.to_string(index=False))

    print()
    for comparison in summary["statistical_comparison"]:
        print(f"  {comparison['interpretation']}")

    analysis = summary["threshold_analysis"]
    print()
    print(f"Threshold: configured {analysis['configured']:.2f} gives F1 "
          f"{analysis['f1_at_configured']:.4f}; the sweep maximum is F1 "
          f"{analysis['max_f1']:.4f} at {analysis['max_f1_threshold']:.2f}.")
    if abs(analysis["configured"] - analysis["max_f1_threshold"]) > 1e-9:
        print("  The configured value is NOT the empirical optimum. Section 4.3.6 "
              "must describe it as a configuration value.")

    if manifest["data_source"].get("is_development_standin"):
        print()
        print("  " + "=" * 66)
        print("  These figures come from the development stand-in, not PaySim.")
        print("  They demonstrate that the pipeline runs. They are not results.")
        print("  " + "=" * 66)

    print()
    _log(f"wrote {PATHS.manifest.relative_to(PATHS.root)}")


STAGES = {
    "features": stage_features,
    "split": stage_split,
    "train": stage_train,
    "evaluate": stage_evaluate,
    "provenance": stage_provenance,
    "report": stage_report,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="SmartGuard experiment pipeline")
    parser.add_argument("stage", choices=[*STAGES, "all"])
    parser.add_argument("--config", default=None, help="override config.yaml")
    args = parser.parse_args(argv)

    from pathlib import Path
    config = load_config(Path(args.config) if args.config else None)

    _log(f"seed {config['seed']} · config sha256 {config_sha256(config)[:12]}")
    if git_dirty():
        _log("WARNING: working tree is dirty; this run cannot be tied to a commit")

    stages = list(STAGES) if args.stage == "all" else [args.stage]
    for name in stages:
        _log(f"--- {name} ---")
        STAGES[name](config)

    return 0


if __name__ == "__main__":
    sys.exit(main())
