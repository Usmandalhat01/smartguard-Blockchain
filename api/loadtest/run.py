"""Runs the load test and records the conditions it ran under.

The corrections do not dispute the load figures in Section 4.5. They say the
figures cannot be relied on, and they list exactly why:

    the hardware, operating system, network conditions, node provider, worker
    configuration, concurrency schedule, and run-to-run variability were not
    retained in the report

Every item on that list is recorded below. The concurrency schedule is swept
rather than fixed at one point, because NFR-05's "at least thirty concurrent
escrow cycles per minute" is a floor: a single measurement at the floor shows
the target was met but says nothing about headroom, and a curve shows where the
layer actually saturates. Each level is repeated, because run-to-run
variability is one of the things that was missing.

    python -m loadtest.run                 # full sweep
    LOAD_LEVELS=30 LOAD_REPEATS=1 python -m loadtest.run    # one quick point

The API is started by this script rather than assumed to be running, so the
worker configuration is a recorded fact instead of whatever happened to be up.

Nothing here touches Sepolia. See loadtest/locustfile.py for why.
"""

from __future__ import annotations

import csv
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = API_ROOT.parent
EVIDENCE = REPO_ROOT / "docs" / "evidence"
VENV_PYTHON = API_ROOT / ".venv" / "bin" / "python"

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOAD_PORT", "8010"))
BASE_URL = f"http://{HOST}:{PORT}"

# uvicorn workers. Recorded because it is the single configuration choice that
# most changes the result, and the one the report never stated.
WORKERS = int(os.environ.get("LOAD_WORKERS", "1"))

# Concurrency levels, in simulated users. NFR-05's floor is 30 cycles/minute;
# these bracket it well above and below.
LEVELS = [int(v) for v in os.environ.get("LOAD_LEVELS", "10,30,60").split(",")]
REPEATS = int(os.environ.get("LOAD_REPEATS", "3"))
RUN_SECONDS = int(os.environ.get("LOAD_SECONDS", "60"))
SPAWN_RATE = float(os.environ.get("LOAD_SPAWN_RATE", "5"))

# NFR-01 and NFR-05, from the requirements table.
NFR01_BUDGET_MS = 2000
NFR05_CYCLES_PER_MINUTE = 30


def log(message: str) -> None:
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def environment() -> dict:
    """Everything the corrections list as unretained, plus the versions."""
    def version(module: str) -> str | None:
        try:
            return __import__(module).__version__
        except Exception:
            return None

    cpu_brand = None
    physical = logical = None
    memory_bytes = None
    if platform.system() == "Darwin":
        def sysctl(key: str) -> str | None:
            try:
                return subprocess.run(
                    ["sysctl", "-n", key], capture_output=True, text=True, timeout=5,
                ).stdout.strip() or None
            except Exception:
                return None
        cpu_brand = sysctl("machdep.cpu.brand_string")
        physical = sysctl("hw.physicalcpu")
        logical = sysctl("hw.logicalcpu")
        memory_bytes = sysctl("hw.memsize")

    return {
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "hardware": {
            "cpu": cpu_brand,
            "physicalCores": int(physical) if physical else os.cpu_count(),
            "logicalCores": int(logical) if logical else os.cpu_count(),
            "memoryBytes": int(memory_bytes) if memory_bytes else None,
            "machine": platform.machine(),
        },
        "operatingSystem": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "platform": platform.platform(),
        },
        "runtime": {
            "python": sys.version.split()[0],
            "fastapi": version("fastapi"),
            "uvicorn": version("uvicorn"),
            "sklearn": version("sklearn"),
            "locust": version("locust"),
        },
        "serverConfiguration": {
            "server": "uvicorn",
            "workers": WORKERS,
            "host": HOST,
            "port": PORT,
            "reload": False,
        },
        "network": {
            "transport": "loopback (127.0.0.1)",
            "note": (
                "The client and the server share one machine, so the figures "
                "exclude network latency and also share CPU with the server. "
                "Both effects are stated rather than corrected for."
            ),
        },
        "nodeProvider": {
            "used": False,
            "note": (
                "No node provider is involved: the on-chain leg is excluded. "
                "Live chain latency is measured separately in "
                "docs/evidence/sepolia-measurements.json (Alchemy)."
            ),
        },
        "schedule": {
            "levels": LEVELS,
            "repeatsPerLevel": REPEATS,
            "runSeconds": RUN_SECONDS,
            "spawnRatePerSecond": SPAWN_RATE,
            "waitTimeSeconds": [0.5, 1.5],
            "taskRatio": {"POST /risk/score": 3, "POST /escrows": 1},
        },
    }


def wait_for_health(timeout: float = 90.0) -> bool:
    import urllib.error
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE_URL}/health", timeout=3) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, OSError, TimeoutError):
            time.sleep(1)
    return False


def port_is_free() -> bool:
    with socket.socket() as s:
        return s.connect_ex((HOST, PORT)) != 0


def start_api() -> subprocess.Popen:
    log(f"starting uvicorn on {BASE_URL} with {WORKERS} worker(s)")
    process = subprocess.Popen(
        [
            str(VENV_PYTHON), "-m", "uvicorn", "smartguard_api.main:app",
            "--host", HOST, "--port", str(PORT),
            "--workers", str(WORKERS), "--log-level", "warning",
        ],
        cwd=API_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    if not wait_for_health():
        process.send_signal(signal.SIGTERM)
        stderr = (process.stderr.read() if process.stderr else "") or ""
        raise RuntimeError(
            f"the API did not become healthy at {BASE_URL}/health.\n{stderr[-2000:]}"
        )
    log("API healthy")
    return process


def run_locust(users: int, out_prefix: Path) -> dict:
    """One headless Locust run. Returns the parsed statistics."""
    cmd = [
        str(VENV_PYTHON), "-m", "locust",
        "-f", str(API_ROOT / "loadtest" / "locustfile.py"),
        "--headless",
        "--host", BASE_URL,
        "--users", str(users),
        "--spawn-rate", str(SPAWN_RATE),
        "--run-time", f"{RUN_SECONDS}s",
        "--csv", str(out_prefix),
        "--only-summary",
        "--stop-timeout", "10",
    ]
    done = subprocess.run(cmd, cwd=API_ROOT, capture_output=True, text=True,
                          timeout=RUN_SECONDS + 180)
    stats_file = out_prefix.with_name(out_prefix.name + "_stats.csv")
    if not stats_file.exists():
        raise RuntimeError(
            f"locust produced no stats for {users} users.\n"
            f"{(done.stdout + done.stderr)[-2000:]}"
        )

    rows = list(csv.DictReader(stats_file.open()))
    by_name = {r["Name"]: r for r in rows}

    def number(row: dict, key: str) -> float:
        value = row.get(key, "")
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    aggregated = by_name.get("Aggregated", {})
    result = {
        "users": users,
        "requests": int(number(aggregated, "Request Count")),
        "failures": int(number(aggregated, "Failure Count")),
        "requestsPerSecond": round(number(aggregated, "Requests/s"), 3),
        "endpoints": {},
    }

    for name, row in by_name.items():
        if name == "Aggregated":
            continue
        result["endpoints"][name] = {
            "requests": int(number(row, "Request Count")),
            "failures": int(number(row, "Failure Count")),
            "medianMs": number(row, "Median Response Time"),
            "meanMs": round(number(row, "Average Response Time"), 2),
            "minMs": number(row, "Min Response Time"),
            "maxMs": number(row, "Max Response Time"),
            "p95Ms": number(row, "95%"),
            "p99Ms": number(row, "99%"),
            "requestsPerSecond": round(number(row, "Requests/s"), 3),
        }

    escrow = result["endpoints"].get("POST /escrows", {})
    result["escrowCyclesPerMinute"] = round(
        escrow.get("requestsPerSecond", 0.0) * 60, 2,
    )
    score = result["endpoints"].get("POST /risk/score", {})
    result["scoreP95Ms"] = score.get("p95Ms")
    result["meetsNfr01"] = bool(score and score.get("p95Ms", 1e9) <= NFR01_BUDGET_MS)
    result["meetsNfr05"] = result["escrowCyclesPerMinute"] >= NFR05_CYCLES_PER_MINUTE
    return result


def summarise(values: list[float]) -> dict:
    if not values:
        return {}
    ordered = sorted(values)
    n = len(ordered)
    mean = sum(ordered) / n
    variance = sum((v - mean) ** 2 for v in ordered) / n
    median = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return {
        "runs": n,
        "min": round(ordered[0], 3),
        "max": round(ordered[-1], 3),
        "mean": round(mean, 3),
        "median": round(median, 3),
        "stdDev": round(variance ** 0.5, 3),
    }


def main() -> int:
    if not VENV_PYTHON.exists():
        log(f"no interpreter at {VENV_PYTHON}")
        return 1

    if not port_is_free():
        log(f"port {PORT} is already in use. Set LOAD_PORT to a free port.")
        return 1

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    workdir = EVIDENCE / "load-test-raw"
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir()

    record = {
        "test": "Application-layer load test, NFR-01 and NFR-05",
        "targets": {
            "NFR-01": f"risk-scoring response within {NFR01_BUDGET_MS} ms",
            "NFR-05": (
                f"at least {NFR05_CYCLES_PER_MINUTE} concurrent escrow cycles "
                f"per minute without functional failure"
            ),
        },
        "scope": {
            "included": "FastAPI application layer, model inference, PostgreSQL",
            "excluded": (
                "On-chain settlement. Sepolia inclusion takes about 11 s "
                "(sepolia-measurements.json), so including it would measure "
                "Ethereum's block interval rather than this system's capacity."
            ),
        },
        "environment": environment(),
        "runs": [],
    }

    api = start_api()
    try:
        for users in LEVELS:
            for repeat in range(1, REPEATS + 1):
                prefix = workdir / f"users{users}_run{repeat}"
                log(f"level {users} users, repetition {repeat}/{REPEATS}, "
                    f"{RUN_SECONDS}s")
                result = run_locust(users, prefix)
                result["repetition"] = repeat
                record["runs"].append(result)
                log(f"    {result['requests']:,} requests, "
                    f"{result['failures']} failures, "
                    f"{result['requestsPerSecond']:.1f} req/s, "
                    f"score p95 {result['scoreP95Ms']} ms, "
                    f"{result['escrowCyclesPerMinute']:.1f} cycles/min")
    finally:
        log("stopping the API")
        api.send_signal(signal.SIGTERM)
        try:
            api.wait(timeout=30)
        except subprocess.TimeoutExpired:
            api.kill()

    # Run-to-run variability, per level.
    record["byLevel"] = {}
    for users in LEVELS:
        runs = [r for r in record["runs"] if r["users"] == users]
        record["byLevel"][str(users)] = {
            "requestsPerSecond": summarise([r["requestsPerSecond"] for r in runs]),
            "escrowCyclesPerMinute": summarise(
                [r["escrowCyclesPerMinute"] for r in runs]),
            "scoreP95Ms": summarise(
                [r["scoreP95Ms"] for r in runs if r["scoreP95Ms"] is not None]),
            "totalFailures": sum(r["failures"] for r in runs),
            "meetsNfr01": all(r["meetsNfr01"] for r in runs),
            "meetsNfr05": all(r["meetsNfr05"] for r in runs),
        }

    best = max(record["runs"], key=lambda r: r["escrowCyclesPerMinute"], default=None)
    record["verdict"] = {
        "nfr01": all(r["meetsNfr01"] for r in record["runs"]),
        "nfr05": any(r["meetsNfr05"] for r in record["runs"]),
        "peakEscrowCyclesPerMinute": best["escrowCyclesPerMinute"] if best else None,
        "totalRequests": sum(r["requests"] for r in record["runs"]),
        "totalFailures": sum(r["failures"] for r in record["runs"]),
    }

    out = EVIDENCE / "load-test.json"
    out.write_text(json.dumps(record, indent=2) + "\n")

    print()
    log(f"wrote {out.relative_to(REPO_ROOT)}")
    v = record["verdict"]
    log(f"NFR-01 (p95 <= {NFR01_BUDGET_MS} ms): "
        f"{'met' if v['nfr01'] else 'NOT met'}")
    log(f"NFR-05 (>= {NFR05_CYCLES_PER_MINUTE} cycles/min): "
        f"{'met' if v['nfr05'] else 'NOT met'} "
        f"(peak {v['peakEscrowCyclesPerMinute']})")
    log(f"{v['totalRequests']:,} requests, {v['totalFailures']} failures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
