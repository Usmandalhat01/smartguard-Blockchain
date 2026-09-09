"""Configuration loading.

The whole experiment is described by config.yaml plus the commit that ran it.
Nothing reads an environment variable or a hard-coded constant.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"


@dataclass(frozen=True)
class Paths:
    """Canonical locations. Created on demand so a fresh clone just works."""

    root: Path = ROOT
    data_raw: Path = ROOT / "data" / "raw"
    data_interim: Path = ROOT / "data" / "interim"
    artifacts: Path = ROOT / "artifacts"
    outputs: Path = ROOT / "outputs"
    figures: Path = ROOT / "outputs" / "figures"
    tables: Path = ROOT / "outputs" / "tables"

    def ensure(self) -> None:
        for path in (
            self.data_raw, self.data_interim, self.artifacts,
            self.outputs, self.figures, self.tables,
        ):
            path.mkdir(parents=True, exist_ok=True)

    # --- named artefacts, so no stage invents its own filename -------------
    @property
    def features(self) -> Path:
        return self.data_interim / "features.parquet"

    @property
    def split_indices(self) -> Path:
        return self.artifacts / "split_indices.npz"

    def model(self, name: str) -> Path:
        return self.artifacts / f"model_{name}.joblib"

    def predictions(self, name: str) -> Path:
        return self.artifacts / f"predictions_{name}.parquet"

    @property
    def manifest(self) -> Path:
        return self.outputs / "run_manifest.json"


PATHS = Paths()


def load_config(path: Path | None = None) -> dict[str, Any]:
    with open(path or CONFIG_PATH) as handle:
        return yaml.safe_load(handle)


def git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, stderr=subprocess.DEVNULL,
        ).decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def git_dirty() -> bool | None:
    try:
        out = subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT, stderr=subprocess.DEVNULL,
        ).decode().strip()
        return len(out) > 0
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def file_sha256(path: Path) -> str:
    """Checksum of a produced artefact. Appendix A records the model checksum as
    missing; this is how it stops being missing."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def config_sha256(config: dict[str, Any]) -> str:
    """Checksum of the configuration itself, so a run can be tied to the exact
    parameters that produced it even if config.yaml is later edited."""
    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def environment_record() -> dict[str, Any]:
    """Hardware and software metadata. Correction 17 found latency and gas
    results unusable because none of this was retained."""
    import platform
    import sys

    record: dict[str, Any] = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "processor": platform.processor() or platform.machine(),
        "cpu_count": None,
        "total_memory_gb": None,
    }

    try:
        import os
        record["cpu_count"] = os.cpu_count()
    except Exception:
        pass

    try:
        import psutil
        record["total_memory_gb"] = round(psutil.virtual_memory().total / 1024**3, 1)
    except ImportError:
        pass

    for package in ("numpy", "pandas", "sklearn", "imblearn", "scipy"):
        try:
            module = __import__(package)
            record[f"{package}_version"] = getattr(module, "__version__", "unknown")
        except ImportError:
            record[f"{package}_version"] = "not installed"

    return record
