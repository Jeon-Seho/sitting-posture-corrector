"""Measure explicitly synthetic loopback HTTP requests; no latency/FPS/accuracy pass target.

Run with the existing .venv after Java JAR packaging. Counts are total requests per
target, not per worker. Results contain aggregate samples/metadata, never raw inputs.
"""

import argparse
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.benchmark.config import BenchmarkConfig
from tools.benchmark.manifest import artifact_hashes, runtime_manifest, source_revision, utc_now
from tools.benchmark.runner import MODEL_VERSION, POLICY, load_fixture, run_target, target_passed
from tools.runtime import ROOT
from tools.service_processes import ServiceEndpoints, running_services


REPORT_SCHEMA = "posegood.synthetic-server-benchmark.v1"
CACHE_OUTPUT = ROOT / ".cache/benchmarks"


def output_path(value, run_id):
    candidate = Path(value).expanduser().absolute() if value else CACHE_OUTPUT / (run_id + ".json")
    if candidate.is_symlink() or candidate.parent.is_symlink():
        raise ValueError("output file/parent cannot be a symlink")
    # Inspect task-owned repository ancestors before resolving them. OS aliases
    # above an explicit external parent (for example macOS /var) remain usable.
    if candidate.is_relative_to(ROOT):
        for parent in candidate.parents:
            if parent == ROOT:
                break
            if parent.is_symlink():
                raise ValueError("repository output ancestors cannot be symlinks")
    destination = candidate.resolve()
    if destination.suffix.lower() != ".json":
        raise ValueError("output must be a .json report")
    within_repository = destination.is_relative_to(ROOT.resolve())
    within_cache = destination.is_relative_to(CACHE_OUTPUT.resolve())
    if within_repository and not within_cache:
        raise ValueError("repository results must stay under .cache/benchmarks; no tracked source/data output")
    if destination.exists() and not within_cache:
        raise ValueError("refusing to overwrite an existing external file")
    return destination


def write_report(destination, report):
    destination.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    if destination.is_relative_to(CACHE_OUTPUT.resolve()):
        # The repeatable make-check target owns this ignored aggregate report.
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(encoded)
        try:
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    else:
        with destination.open("x", encoding="utf-8") as output:
            output.write(encoded)


def benchmark(config, destination):
    config.validate()
    fixture, fixture_manifest = load_fixture()
    run_id = str(uuid.uuid4())
    report = {
        "schema_version": REPORT_SCHEMA,
        "run_id": run_id,
        "started_at": utc_now(),
        "measurement_kind": "current-device synthetic loopback server HTTP benchmark",
        "interpretation": {
            "camera_fps_measured": False,
            "model_accuracy_measured": False,
            "medical_or_posture_improvement_measured": False,
            "performance_pass_cutoff": None,
            "latency_scope": "request start through complete HTTP response body; client JSON/schema validation excluded",
            "throughput_scope": "entire phase wall time including client validation/thread scheduling; successful and attempted rates separated",
            "http_transport": "urllib HTTP/1.1; Connection: close per request; environment proxies, redirects and automatic retries disabled",
            "scope_limit": "loopback/local development reference-feature-rule-v1; no camera, learned-model, remote-network or production load measurement",
            "warmup": "reported separately; allocation can leave workers unwarmed if total warmup < concurrency",
        },
        "config": config.manifest(),
        "fixture": fixture_manifest,
        "source_before": source_revision(),
        "service_artifact_sha256": artifact_hashes(),
        "runtime": runtime_manifest(),
        "targets": [],
        "run_error": None,
    }
    report["config"].update(session_policy=dict(POLICY), accepted_model_version=MODEL_VERSION)
    try:
        endpoints = ServiceEndpoints.allocate()
        with running_services(endpoints):
            for target in (("infer", "features") if config.target == "both" else (config.target,)):
                report["targets"].append(run_target(target, config, endpoints, fixture, run_id))
    except Exception as error:
        # Setup/process cleanup errors cannot be a successful zero-sample benchmark.
        report["run_error"] = {"category": "setup_execution_or_cleanup_error", "exception_type": type(error).__name__}
    report["finished_at"] = utc_now()
    report["source_after"] = source_revision()
    report["source_changed_during_run"] = report["source_before"] != report["source_after"]
    report["all_requested_contract_checks_succeeded"] = (
        report["run_error"] is None
        and len(report["targets"]) == (2 if config.target == "both" else 1)
        and all(target_passed(target) for target in report["targets"])
    )
    write_report(destination, report)
    return report


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("both", "infer", "features"), default="both")
    parser.add_argument("--warmup", type=int, default=10, help="total unmeasured preparation requests per target")
    parser.add_argument("--repetitions", type=int, default=100, help="total measured requests per target")
    parser.add_argument("--concurrency", type=int, default=1, help="independent sequential workers/sessions, 1..64")
    parser.add_argument("--timeout", type=float, default=5.0, help="socket operation timeout in seconds, <=60")
    parser.add_argument("--max-duration", type=float, default=300.0, help="target scheduling time limit; unfinished work is explicitly skipped, <=3600 seconds")
    parser.add_argument("--output", help="ignored .cache/benchmarks/*.json or a new external .json file")
    args = parser.parse_args(argv)
    config = BenchmarkConfig(args.target, args.warmup, args.repetitions, args.concurrency, args.timeout, args.max_duration)
    try:
        config.validate()
        destination = output_path(args.output, str(uuid.uuid4()))
    except ValueError as error:
        parser.error(str(error))
    return config, destination


def main(argv=None):
    config, destination = parse_args(argv)
    report = benchmark(config, destination)
    for target in report["targets"]:
        value = target["measurement"]
        latency = value["success_latency_ms"]
        print("{target}: success={successful} failed={failed} skipped={skipped} median_ms={median} p95_ms={p95} successful_rps={rps}".format(
            target=target["target"], **{key: value[key] for key in ("successful", "failed", "skipped")},
            median=latency["median"], p95=latency["p95"], rps=value["successful_requests_per_second"],
        ))
    print("Synthetic current-device HTTP measurement; no camera FPS, accuracy or performance pass cutoff.")
    print("Report: " + str(destination))
    if report["source_changed_during_run"]:
        print("Source changed during measurement; both source fingerprints are preserved.")
    return 0 if report["all_requested_contract_checks_succeeded"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError) as error:
        sys.exit(str(error))
