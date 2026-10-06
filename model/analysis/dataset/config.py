"""Explicit research configuration. No empirical defaults are selected here."""

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path


SCHEMA = "posture-pilot-v2"
POSTURE_LABELS = {"upright", "lean_left", "lean_right", "trunk_forward", "head_forward"}
NUMERIC_FEATURES = {
    "head_gap", "lateral_offset", "shoulder_tilt", "visibility",
    "baseline_head_gap", "baseline_offset", "baseline_tilt",
    "delta_head_gap", "delta_offset", "delta_tilt",
}
ROLES = ("train", "validation", "test")


def text(value, name):
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ValueError(f"{name} must be a nonempty, trimmed string")
    return value


def number(value, name, *, integer=False, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    if value < minimum or (integer and int(value) != value):
        raise ValueError(f"{name} is outside its explicit configuration range")
    return int(value) if integer else value


def fields(value, required, name, optional=()):
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    missing = set(required) - value.keys()
    unknown = value.keys() - set(required) - set(optional)
    if missing or unknown:
        raise ValueError(f"{name} fields: missing={sorted(missing)}, unknown={sorted(unknown)}")


def unique_strings(value, name, *, allow_empty=False):
    if not isinstance(value, list) or (not allow_empty and not value):
        raise ValueError(f"{name} must be an explicit list")
    result = tuple(text(item, name) for item in value)
    if len(result) != len(set(result)):
        raise ValueError(f"{name} contains duplicates")
    return result


@dataclass(frozen=True)
class Participant:
    id: str
    source_codes: tuple
    evaluation_only: bool


@dataclass(frozen=True)
class CaptureSpec:
    path: Path
    sha256: str
    capture_id: str
    participant_id: str
    role: str
    calibration_ids: tuple


@dataclass(frozen=True)
class WindowOptions:
    duration_ms: float
    stride_ms: float
    max_gap_ms: float
    min_samples: int
    discontinuity_policy: str


@dataclass(frozen=True)
class DatasetConfig:
    document: dict
    source: Path
    sha256: str
    data_kind: str
    dataset_version: str
    participants: tuple
    captures: tuple
    split: dict
    fit_roles: tuple
    feature_columns: tuple
    label_mapping: dict
    pose_models: tuple
    feature_versions: tuple
    window: WindowOptions


def parse_config(document, source, digest):
    fields(document, {
        "schema_version", "data_kind", "dataset_version", "participants", "captures",
        "split", "fit_roles", "feature_columns", "label_mapping", "pose_models",
        "feature_versions", "window",
    }, "config")
    if document["schema_version"] != "posture-dataset-config-v1":
        raise ValueError("posture-dataset-config-v1 configuration required")
    if document["data_kind"] not in ("synthetic", "private"):
        raise ValueError("data_kind must explicitly be synthetic or private")
    participants = []
    ids, codes = set(), set()
    if not isinstance(document["participants"], list) or not document["participants"]:
        raise ValueError("participants must be a nonempty registry")
    for item in document["participants"]:
        fields(item, {"id", "source_codes", "evaluation_only"}, "participant")
        participant_id = text(item["id"], "participant.id")
        aliases = unique_strings(item["source_codes"], "participant.source_codes")
        if participant_id in ids or codes.intersection(aliases):
            raise ValueError("participant identity or source-code ownership is duplicated")
        if type(item["evaluation_only"]) is not bool:
            raise ValueError("evaluation_only must be an explicit boolean")
        ids.add(participant_id)
        codes.update(aliases)
        participants.append(Participant(participant_id, aliases, item["evaluation_only"]))

    captures = []
    if not isinstance(document["captures"], list) or not document["captures"]:
        raise ValueError("captures must be a nonempty catalog")
    for item in document["captures"]:
        fields(item, {"path", "sha256", "capture_id", "participant_id", "role", "calibration_ids"}, "capture")
        owner = text(item["participant_id"], "capture.participant_id")
        if owner not in ids:
            raise ValueError("capture has an unregistered participant owner")
        if item["role"] not in ("calibration", "posture"):
            raise ValueError("capture role must be calibration or posture")
        digest_value = text(item["sha256"], "capture.sha256")
        if not re.fullmatch(r"[0-9a-f]{64}", digest_value):
            raise ValueError("capture.sha256 must be a lowercase SHA-256 digest")
        path = (source.parent / text(item["path"], "capture.path")).resolve()
        captures.append(CaptureSpec(
            path, digest_value, text(item["capture_id"], "capture.capture_id"), owner,
            item["role"], unique_strings(item["calibration_ids"], "capture.calibration_ids"),
        ))

    feature_columns = unique_strings(document["feature_columns"], "feature_columns")
    if not set(feature_columns).issubset(NUMERIC_FEATURES):
        raise ValueError("Only explicit numeric pose features are supported; predictions/task cues are not training features")
    mapping = document["label_mapping"]
    if not isinstance(mapping, dict) or not mapping or not set(mapping).issubset(POSTURE_LABELS):
        raise ValueError("label_mapping must explicitly map reviewed v2 posture labels; v1/transition/unlabeled cannot be mixed")
    for label in mapping.values():
        text(label, "label_mapping target")
    fit_roles = unique_strings(document["fit_roles"], "fit_roles")
    if not set(fit_roles).issubset({"train", "validation"}):
        raise ValueError("test participants must never fit transforms or tune models")
    window = document["window"]
    fields(window, {"duration_ms", "stride_ms", "max_gap_ms", "min_samples", "discontinuity_policy"}, "window")
    if window["discontinuity_policy"] not in ("reject", "break"):
        raise ValueError("discontinuity_policy must explicitly be reject or break")
    options = WindowOptions(
        number(window["duration_ms"], "window.duration_ms", minimum=1),
        number(window["stride_ms"], "window.stride_ms", minimum=1),
        number(window["max_gap_ms"], "window.max_gap_ms", minimum=1),
        number(window["min_samples"], "window.min_samples", integer=True, minimum=2),
        window["discontinuity_policy"],
    )
    if not isinstance(document["split"], dict):
        raise ValueError("split must explicitly describe method/fold/seed")
    return DatasetConfig(
        document, source, digest, document["data_kind"],
        text(document["dataset_version"], "dataset_version"), tuple(participants), tuple(captures),
        document["split"], fit_roles, feature_columns, dict(mapping),
        unique_strings(document["pose_models"], "pose_models"),
        unique_strings(document["feature_versions"], "feature_versions"), options,
    )


def load_config(path):
    source = Path(path).resolve()
    raw = source.read_bytes()
    document = json.loads(raw.decode("utf-8-sig"))
    return parse_config(document, source, hashlib.sha256(raw).hexdigest())
