"""Prepare private reproducibility manifests and observed windows, without fitting."""

import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

from .captures import csv_number, read_captures
from .config import load_config
from .splits import participant_split
from .windows import exclusion_reason, observation, prepare_capture, run_key


ROOT = Path(__file__).resolve().parents[3]
OUTPUT_FILES = ("manifest.json", "windows.jsonl", "calibrations.json")
PUBLISH_ORDER = ("calibrations.json", "windows.jsonl", "manifest.json")


def validate_output(output):
    target = Path(output).resolve()
    if target.exists():
        raise ValueError("Output must be a new directory; preparation never overwrites an existing run")
    if target == ROOT or ROOT in target.parents:
        for name in OUTPUT_FILES:
            result = subprocess.run(
                ["git", "check-ignore", "--no-index", "--quiet", str(target / name)],
                cwd=ROOT, capture_output=True,
            )
            if result.returncode != 0:
                raise ValueError("Repository output must be Git-ignored; use database/temp, data, runs or .cache")
    return target


def personal_calibration(capture, config, role):
    excluded = Counter()
    runs, current = [], []
    for sample in capture.samples:
        reason = exclusion_reason(sample, {"upright": "personal_reference"})
        boundary = sample.break_before or (current and run_key(current[-1]) != run_key(sample))
        if reason or boundary:
            if current:
                runs.append(current)
                current = []
            if reason:
                excluded[reason] += 1
        if reason is None:
            current.append(sample)
    if current:
        runs.append(current)
    if not runs:
        raise ValueError("Personal calibration has no reviewed, good, eligible reference observations")
    return {
        "participant_id": capture.spec.participant_id,
        "split_role": role,
        "capture_id": capture.spec.capture_id,
        "capture_sha256": capture.spec.sha256,
        "calibration_id": capture.spec.calibration_ids[0],
        "purpose": "personal_calibration_only",
        "global_fit_allowed": False,
        "evaluation_windows_allowed": False,
        "derived_baseline_verified": False,
        "excluded_rows": dict(excluded),
        "observed_runs": [{
            "schema_version": run[0].row["schema_version"],
            "pose_model": run[0].row["pose_model"],
            "feature_version": run[0].row["feature_version"],
            "baseline_columns": {
                name: csv_number(run[0].row[name], name)
                for name in ("baseline_head_gap", "baseline_offset", "baseline_tilt")
            },
            "observations": [observation(sample, config.feature_columns) for sample in run],
        } for run in runs],
    }


def code_metadata():
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return {
        "git_revision": revision.stdout.strip() if revision.returncode == 0 else None,
        "preparation_modules_sha256": digest.hexdigest(),
        "python_version": platform.python_version(),
    }


def assert_sources_unchanged(config):
    if hashlib.sha256(config.source.read_bytes()).hexdigest() != config.sha256:
        raise ValueError("Configuration changed during preparation")
    for capture in config.captures:
        if hashlib.sha256(capture.path.read_bytes()).hexdigest() != capture.sha256:
            raise ValueError("Capture changed during preparation")


def build_dataset(config):
    # This order is intentional: splitting precedes source loading and window generation.
    split = participant_split(config)
    captures = read_captures(config)
    windows, calibrations, diagnostics = [], [], []
    for capture in captures:
        role = split["participant_roles"][capture.spec.participant_id]
        if capture.spec.role == "calibration":
            calibrations.append(personal_calibration(capture, config, role))
            continue
        built, diagnostic = prepare_capture(capture, config, role)
        for window in built:
            identity = {
                "config_sha256": config.sha256,
                "capture_sha256": capture.spec.sha256,
                "first_sample_index": window["observations"][0]["sample_index"],
                "last_sample_index": window["observations"][-1]["sample_index"],
                "split_role": role,
            }
            encoded = json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
            window["window_id"] = hashlib.sha256(encoded).hexdigest()
        windows.extend(built)
        diagnostics.append(diagnostic)
    manifest = {
        "schema_version": "posture-dataset-manifest-v1",
        "preparation_status": "complete",
        "data_kind": config.data_kind,
        "dataset_version": config.dataset_version,
        "source_config": str(config.source),
        "config_sha256": config.sha256,
        "configuration": config.document,
        "code": code_metadata(),
        "split": split,
        "feature_columns": list(config.feature_columns),
        "window_semantics": "actual endpoints; first observation at/after target duration; no interpolation",
        "training_executed": False,
        "transforms_fitted": False,
        "derived_baseline_verified": False,
        "captures": [{
            "path": str(capture.spec.path),
            "sha256": capture.spec.sha256,
            "capture_id": capture.spec.capture_id,
            "participant_id": capture.spec.participant_id,
            "capture_role": capture.spec.role,
            "split_role": split["participant_roles"][capture.spec.participant_id],
            "calibration_ids": list(capture.spec.calibration_ids),
            "global_fit_allowed": capture.spec.role == "posture" and split["participant_roles"][capture.spec.participant_id] in config.fit_roles,
        } for capture in captures],
        "window_counts": dict(Counter(window["split_role"] for window in windows)),
        "diagnostics": diagnostics,
    }
    return manifest, windows, calibrations


def write_private(path, content):
    with path.open("x", encoding="utf-8") as handle:
        if os.name != "nt":
            os.chmod(path, 0o600)
        handle.write(content)


def file_identity(stat):
    return stat.st_dev, stat.st_ino


def publish(stage, target):
    # mkdir refuses even a concurrently created empty directory on every platform.
    target.mkdir(mode=0o700, exist_ok=False)
    directory_identity = file_identity(target.stat())
    created = []
    try:
        # Readers require the completed manifest; it is the last file published.
        for name in PUBLISH_ORDER:
            destination = target / name
            with destination.open("xb") as output:
                created.append((destination, file_identity(os.fstat(output.fileno()))))
                if os.name != "nt":
                    os.chmod(destination, 0o600)
                with (stage / name).open("rb") as source:
                    shutil.copyfileobj(source, output)
    except Exception:
        # Never overwrite or remove files another writer created/replaced in this directory.
        for path, identity in reversed(created):
            try:
                if file_identity(path.lstat()) == identity:
                    path.unlink()
            except FileNotFoundError:
                pass
        try:
            if file_identity(target.lstat()) == directory_identity:
                target.rmdir()  # A foreign file leaves the directory intact.
        except OSError:
            pass
        raise


def prepare_dataset(config_path, output):
    target = validate_output(output)
    config = load_config(config_path)
    manifest, windows, calibrations = build_dataset(config)
    assert_sources_unchanged(config)
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".dataset-preparation-", dir=target.parent))
    try:
        write_private(stage / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        write_private(stage / "calibrations.json", json.dumps(calibrations, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        write_private(stage / "windows.jsonl", "".join(
            json.dumps(window, ensure_ascii=False, allow_nan=False) + "\n" for window in windows
        ))
        # Recheck immediately before publishing: source bytes must still match their hashes.
        assert_sources_unchanged(config)
        publish(stage, target)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return manifest
