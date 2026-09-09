"""Stage entry points.

Each stage is runnable on its own and writes its output to a named path, so a
partial rerun is possible and a stage cannot silently depend on another stage's
in-memory state.

    python -m smartguard_ml.pipeline features
    python -m smartguard_ml.pipeline split
    python -m smartguard_ml.pipeline train
    python -m smartguard_ml.pipeline evaluate
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

    # PaySim labels fraud only on TRANSFER and CASH_OUT. Keeping the other three
    # operation types would add three million rows that cannot be positive by
    # construction, which inflates accuracy and teaches the model nothing.
    before = len(raw)
    raw = raw[raw["type"].isin(PAYSIM_FRAUD_TYPES)].reset_index(drop=True)
    _log(f"  kept {len(raw):,} of {before:,} rows ({', '.join(PAYSIM_FRAUD_TYPES)})")

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
        "raw_rows": before,
        "rows_after_type_filter": int(len(raw)) if frac >= 1.0 else None,
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
    _log("wrote prediction files; no metric has been computed yet")


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
