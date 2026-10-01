"""Strict v2 reader. Never sort away reversals or silently deduplicate captures."""

import csv
import hashlib
import io
import math
from dataclasses import dataclass

from .config import POSTURE_LABELS, SCHEMA


REQUIRED = {
    "schema_version", "participant_code", "capture_id", "sample_index", "elapsed_ms",
    "video_time_ms", "gap_ms", "segment_id", "calibration_id", "pose_model", "feature_version",
    "manual_label", "label_source", "measurement_quality", "review_status",
    "pose_training_eligible", "presence_label", "task_id", "activity", "stop_reason",
    "baseline_head_gap", "baseline_offset", "baseline_tilt",
}


@dataclass(frozen=True)
class Sample:
    index: int
    elapsed_ms: float
    video_time_ms: float
    row: dict
    break_before: tuple


@dataclass(frozen=True)
class Capture:
    spec: object
    samples: tuple


def csv_number(value, field, *, integer=False, minimum=None):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"CSV {field} is missing or not numeric") from None
    if not math.isfinite(parsed) or (minimum is not None and parsed < minimum):
        raise ValueError(f"CSV {field} must be finite and in range")
    if integer and int(parsed) != parsed:
        raise ValueError(f"CSV {field} must be an integer")
    return int(parsed) if integer else parsed


def check_catalog(config):
    paths, hashes, capture_ids = set(), set(), set()
    calibration_owners, calibration_sources = {}, {}
    for spec in config.captures:
        if spec.path in paths or spec.sha256 in hashes or spec.capture_id in capture_ids:
            raise ValueError("Duplicate file/path/hash/capture ownership: repeated downloads must be resolved explicitly")
        paths.add(spec.path)
        hashes.add(spec.sha256)
        capture_ids.add(spec.capture_id)
        for calibration_id in spec.calibration_ids:
            owner = calibration_owners.setdefault(calibration_id, spec.participant_id)
            if owner != spec.participant_id:
                raise ValueError("A calibration identity cannot belong to different participants")
        if spec.role == "calibration":
            if len(spec.calibration_ids) != 1:
                raise ValueError("A personal calibration capture must declare exactly one calibration identity")
            calibration_id = spec.calibration_ids[0]
            if calibration_id in calibration_sources:
                raise ValueError("A calibration identity has duplicate calibration captures")
            calibration_sources[calibration_id] = spec
    for spec in config.captures:
        if spec.role == "posture":
            for calibration_id in spec.calibration_ids:
                reference = calibration_sources.get(calibration_id)
                if reference is None or reference.participant_id != spec.participant_id:
                    raise ValueError("Every posture capture needs its owner's separately cataloged calibration capture")


def metadata(row, spec, aliases, config):
    if row["schema_version"] != SCHEMA:
        raise ValueError("Only posture-pilot-v2 is supported; v1 labels cannot be automatically merged")
    if row["capture_id"] != spec.capture_id or row["participant_code"] not in aliases:
        raise ValueError("CSV capture/participant ownership does not match the manifest")
    if row["calibration_id"] not in spec.calibration_ids:
        raise ValueError("CSV calibration identity is outside the declared ownership catalog")
    if row["pose_model"] not in config.pose_models or row["feature_version"] not in config.feature_versions:
        raise ValueError("CSV model/feature version was not explicitly approved in configuration")
    if row["manual_label"] not in POSTURE_LABELS | {"unlabeled", "transition"}:
        raise ValueError("Unknown v2 manual posture label")
    if row["measurement_quality"] not in ("good", "poor"):
        raise ValueError("Unknown measurement quality")
    if row["review_status"] not in ("pending", "accepted", "excluded"):
        raise ValueError("Unknown review status")
    if row["presence_label"] not in ("seated", "away", "transition", "unknown"):
        raise ValueError("Unknown presence label")
    if row["label_source"] not in ("none", "self_report_reviewed"):
        raise ValueError("v2 labels must keep their reviewed self-report provenance")
    if row["pose_training_eligible"] not in ("0", "1"):
        raise ValueError("pose_training_eligible must be 0 or 1")
    if row["stop_reason"] not in (
        "completed", "manual_stop", "tab_hidden", "camera_disconnected", "session_interrupted",
    ):
        raise ValueError("Unknown or incomplete capture stop reason")
    if not row["task_id"] or not row["activity"]:
        raise ValueError("Task/activity provenance is missing")
    if spec.role == "calibration" and (
        row["manual_label"] != "upright" or row["task_id"] != "neutral" or row["activity"] != "reference"
    ):
        raise ValueError("Personal calibration must be an explicitly reviewed upright reference task, never deviation data")


def read_capture(spec, config):
    raw = spec.path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != spec.sha256:
        raise ValueError("Capture SHA-256 changed or does not match the catalog")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    columns = reader.fieldnames or []
    if len(columns) != len(set(columns)) or not (REQUIRED | set(config.feature_columns)).issubset(columns):
        raise ValueError("Nonduplicated v2 metadata and selected feature columns are required")
    aliases = next(item.source_codes for item in config.participants if item.id == spec.participant_id)
    samples = []
    calibrations_seen = set()
    for line, row in enumerate(reader, start=2):
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("CSV row has missing or excess cells")
            metadata(row, spec, aliases, config)
            calibrations_seen.add(row["calibration_id"])
            index = csv_number(row["sample_index"], "sample_index", integer=True, minimum=0)
            elapsed = csv_number(row["elapsed_ms"], "elapsed_ms", minimum=0)
            video_time = csv_number(row["video_time_ms"], "video_time_ms", minimum=0)
            segment = csv_number(row["segment_id"], "segment_id", integer=True, minimum=0)
            breaks = []
            if not samples:
                if index != 0 or row["gap_ms"]:
                    raise ValueError("A capture must begin with sample_index=0 and an empty initial gap_ms")
            else:
                previous = samples[-1]
                if index <= previous.index or elapsed <= previous.elapsed_ms:
                    raise ValueError("Sample indices and elapsed timestamps must strictly increase; duplicates/reversals are rejected")
                if segment < int(previous.row["segment_id"]):
                    raise ValueError("segment_id reversed")
                gap = csv_number(row["gap_ms"], "gap_ms", minimum=0)
                if not math.isclose(gap, elapsed - previous.elapsed_ms, abs_tol=1e-6, rel_tol=1e-9):
                    raise ValueError("gap_ms does not match the actual elapsed timestamp difference")
                if index != previous.index + 1:
                    breaks.append("missing_sample_index")
                if gap > config.window.max_gap_ms:
                    breaks.append("observation_gap")
                if video_time <= previous.video_time_ms:
                    breaks.append("video_time_reset")
                if breaks and config.window.discontinuity_policy == "reject":
                    raise ValueError("Configured discontinuity rejection: " + ", ".join(breaks))
            samples.append(Sample(index, elapsed, video_time, row, tuple(breaks)))
        except ValueError as error:
            raise ValueError(f"Capture CSV line {line}: {error}") from None
    if not samples:
        raise ValueError("Capture CSV contains no observations")
    if calibrations_seen != set(spec.calibration_ids):
        raise ValueError("Declared calibration identities must exactly match observed identities")
    return Capture(spec, tuple(samples))


def read_captures(config):
    check_catalog(config)
    captures = tuple(read_capture(spec, config) for spec in config.captures)
    baselines = {}
    for capture in captures:
        for sample in capture.samples:
            row = sample.row
            key = (capture.spec.participant_id, row["calibration_id"], row["pose_model"], row["feature_version"])
            baseline = tuple(csv_number(row[name], name) for name in (
                "baseline_head_gap", "baseline_offset", "baseline_tilt",
            ))
            if baselines.setdefault(key, baseline) != baseline:
                raise ValueError("Baseline columns changed without a new calibration/model/feature identity")
    return captures
