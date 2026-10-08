"""Capture-level personal split followed by strict observed-window construction."""

import csv
import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace

from ..dataset.captures import csv_number, read_capture
from ..dataset.config import (
    CaptureSpec, Participant, POSTURE_LABELS, WindowOptions, fields, number,
    text, unique_strings,
)
from ..dataset.windows import prepare_capture


FEATURES = ("delta_head_gap", "delta_offset", "delta_tilt")
ROLES = ("train", "validation", "holdout")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_config(path):
    source = Path(path).resolve()
    raw = source.read_bytes()
    document = json.loads(raw.decode("utf-8-sig"))
    fields(document, {
        "schema_version", "purpose", "data_kind", "participant_code", "captures",
        "roles_by_repetition", "labels", "pose_model", "feature_version", "camera_view",
        "window", "augmentation", "optimizer", "seed",
    }, "personal config")
    if document["schema_version"] != "posture-personal-experiment-v1" or document["purpose"] != "same_person_feasibility":
        raise ValueError("Explicit same_person_feasibility configuration required")
    if document["data_kind"] not in ("private", "synthetic"):
        raise ValueError("data_kind must be private or synthetic")
    for name in ("participant_code", "pose_model", "feature_version", "camera_view"):
        text(document[name], name)
    labels = unique_strings(document["labels"], "labels")
    if len(labels) < 2 or not set(labels).issubset(POSTURE_LABELS):
        raise ValueError("At least two reviewed posture classes are required")
    assignments = document["roles_by_repetition"]
    if not isinstance(assignments, dict) or set(assignments.values()) != set(ROLES):
        raise ValueError("Repetitions must explicitly cover train, validation and holdout")
    for repetition in assignments:
        if not isinstance(repetition, str) or str(csv_number(repetition, "repetition", integer=True, minimum=1)) != repetition:
            raise ValueError("Repetition keys must be positive integer strings")
    options = document["window"]
    fields(options, {"duration_ms", "stride_ms", "max_gap_ms", "min_samples"}, "window")
    window = WindowOptions(
        number(options["duration_ms"], "duration_ms", minimum=1),
        number(options["stride_ms"], "stride_ms", minimum=1),
        number(options["max_gap_ms"], "max_gap_ms", minimum=1),
        number(options["min_samples"], "min_samples", integer=True, minimum=2), "break",
    )
    # This experiment reports nonoverlapping windows, never adjacent duplicated endpoints.
    if window.stride_ms < window.duration_ms:
        raise ValueError("Personal experiment requires nonoverlapping window stride")
    augmentation = document["augmentation"]
    fields(augmentation, {"copies", "scale_sd", "offset_sd", "jitter_sd"}, "augmentation")
    number(augmentation["copies"], "copies", integer=True, minimum=1)
    if augmentation["copies"] > 100:
        raise ValueError("At most 100 copies per original window")
    for name in ("scale_sd", "offset_sd", "jitter_sd"):
        number(augmentation[name], name)
        if augmentation[name] > .1:
            raise ValueError("Exploratory perturbations must be small (SD <= 0.1)")
    optimizer = document["optimizer"]
    fields(optimizer, {"epochs", "learning_rate", "l2"}, "optimizer")
    number(optimizer["epochs"], "epochs", integer=True, minimum=1)
    number(optimizer["learning_rate"], "learning_rate", minimum=1e-9)
    number(optimizer["l2"], "l2")
    number(document["seed"], "seed", integer=True)
    if not isinstance(document["captures"], list) or not document["captures"]:
        raise ValueError("Explicit nonempty capture catalog required")
    paths, hashes, identities = set(), set(), set()
    specs = []
    for item in document["captures"]:
        fields(item, {"path", "sha256", "capture_id", "calibration_id", "label", "repetition"}, "capture")
        file_path = (source.parent / text(item["path"], "capture.path")).resolve()
        for name in ("sha256", "capture_id", "calibration_id"):
            text(item[name], "capture." + name)
        if len(item["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in item["sha256"]):
            raise ValueError("Expected lowercase SHA-256")
        if file_path in paths or item["sha256"] in hashes or item["capture_id"] in identities:
            raise ValueError("Duplicate capture/path/hash across experiment roles")
        paths.add(file_path)
        hashes.add(item["sha256"])
        identities.add(item["capture_id"])
        repetition = str(number(item["repetition"], "capture.repetition", integer=True, minimum=1))
        if repetition not in assignments or item["label"] not in labels:
            raise ValueError("Undeclared repetition or label")
        spec = CaptureSpec(file_path, item["sha256"], item["capture_id"], document["participant_code"], "posture", (item["calibration_id"],))
        specs.append((spec, item, assignments[repetition]))
    config = SimpleNamespace(
        source=source, sha256=hashlib.sha256(raw).hexdigest(), document=document,
        participants=(Participant(document["participant_code"], (document["participant_code"],), False),),
        feature_columns=FEATURES, label_mapping={name: name for name in labels},
        pose_models=(document["pose_model"],), feature_versions=(document["feature_version"],),
        window=window, catalog=specs,
    )
    return config


def prepare(config):
    groups = {role: [] for role in ROLES}
    diagnostics, baselines = [], {}
    for spec, declared, role in config.catalog:
        capture = read_capture(spec, config)
        for sample in capture.samples:
            row = sample.row
            for name in ("manual_label", "repetition", "camera_view"):
                expected = {"manual_label": declared["label"], "repetition": str(declared["repetition"]), "camera_view": config.document["camera_view"]}[name]
                if row.get(name) != expected:
                    raise ValueError("Capture label/repetition/view differs from its preassigned role")
            baseline = tuple(csv_number(row[name], name) for name in ("baseline_head_gap", "baseline_offset", "baseline_tilt"))
            if baselines.setdefault(row["calibration_id"], baseline) != baseline:
                raise ValueError("Personal baseline changed without a new identity")
        windows, diagnostic = prepare_capture(capture, config, role)
        # Existing general preparation may share actual endpoint observations. Remove them here.
        previous_end = -1
        for window in windows:
            first = window["observations"][0]["sample_index"]
            if first <= previous_end:
                continue
            previous_end = window["observations"][-1]["sample_index"]
            window["window_id"] = f'{spec.capture_id}:{first}:{previous_end}'
            groups[role].append(window)
        diagnostic["split_role"] = role
        diagnostic["nonoverlapping_windows"] = sum(w["capture_id"] == spec.capture_id for w in groups[role])
        diagnostics.append(diagnostic)
    labels = set(config.label_mapping)
    for role, windows in groups.items():
        if set(w["label"] for w in windows) != labels:
            raise ValueError(f"Each role needs eligible windows for every class: {role}")
    return groups, diagnostics


def catalog_folder(folder):
    """Read only v2 headers to help create an explicit, private catalog; never infer labels."""
    result = []
    for path in sorted(Path(folder).glob("*.csv")):
        raw = path.read_bytes()
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        if not rows or rows[0].get("schema_version") != "posture-pilot-v2":
            continue
        result.append({
            "path": str(path.resolve()), "sha256": hashlib.sha256(raw).hexdigest(),
            "capture_id": rows[0]["capture_id"], "calibration_id": rows[0]["calibration_id"],
            "label": rows[0]["manual_label"], "repetition": int(rows[0]["repetition"]),
        })
    return result
