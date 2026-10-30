"""Reproducible CPU research baseline; never interprets trunk labels as service truth."""

import argparse
import csv
import hashlib
import json
import platform
import random
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.covariance import LedoitWolf
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, recall_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits


ROOT = Path(__file__).resolve().parents[2]
SOURCE = "https://zenodo.org/records/14230872"
DATA_URL = SOURCE + "/files/data.csv?download=1"
EXPECTED_MD5 = "7efbc94d653acf32eefecec3ff26d6c6"
LABELS = ["TUP", "TLF", "TLB", "TLL", "TLR"]
POINTS = ["nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
          "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
          "mouth_right", "left_shoulder", "right_shoulder"]
FEATURE_VERSION = "pose13-relative-shape-v1"


def private_path(path):
    """Refuse data/weight writes into any versioned workspace location."""
    path = Path(path).resolve()
    try:
        parts = path.relative_to(ROOT).parts
    except ValueError:
        return path  # An explicitly supplied external storage location.
    if len(parts) < 2 or parts[0] not in {"data", "artifacts", "runs", "checkpoints"}:
        raise ValueError("Use an ignored data/artifacts/runs/checkpoints directory or external storage")
    if path.is_symlink():
        raise ValueError("Private output must not be a symlink")
    return path


def write_json(path, document):
    path = private_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def download(folder):
    folder = private_path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen("https://zenodo.org/api/records/14230872", timeout=60) as response:
        record = json.load(response)
    meta = record["metadata"]
    if meta.get("access_right") != "open" or meta.get("license", {}).get("id") != "cc-by-4.0":
        raise ValueError("Source access/license changed; inspect before downloading")
    spec = next(f for f in record["files"] if f["key"] == "data.csv")
    if spec["checksum"] != "md5:" + EXPECTED_MD5:
        raise ValueError("Source dataset changed; register a new reviewed revision")
    target = folder / "data.csv"
    if not target.exists():
        temporary = folder / "data.csv.partial"
        if temporary.exists():
            raise ValueError("Partial download already exists; inspect it before retrying")
        with urllib.request.urlopen(DATA_URL, timeout=60) as response, temporary.open("xb") as handle:
            for block in iter(lambda: response.read(1024 * 1024), b""):
                handle.write(block)
        if digest(temporary, "md5") != EXPECTED_MD5:
            raise ValueError("Downloaded file checksum mismatch")
        temporary.replace(target)
    if digest(target, "md5") != EXPECTED_MD5:
        raise ValueError("Existing data file is not the reviewed source revision")
    write_json(folder / "source.json", {
        "source": SOURCE, "doi": "10.5281/zenodo.14230872", "license": "CC-BY-4.0",
        "creators": [c["name"] for c in meta["creators"]],
        "md5": EXPECTED_MD5, "sha256": digest(target), "bytes": target.stat().st_size,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    })
    return target


def validate_points(points):
    points = np.asarray(points, dtype=float)
    if points.shape != (13, 3) or not np.isfinite(points).all():
        raise ValueError("Exactly 13 finite xyz points in original MediaPipe order are required")
    if np.linalg.norm(points[12] - points[11]) <= 1e-6:
        raise ValueError("Degenerate shoulder span is unmeasurable")
    return points


def features(points, mode="face13"):
    p = validate_points(points)
    shoulder = p[12] - p[11]
    span = np.linalg.norm(shoulder)
    center = (p[11] + p[12]) / 2
    q = (p[:11] - center) / span
    if mode == "nose3":
        return np.array([-q[0, 1], q[0, 0], shoulder[1] / span])
    if mode == "face13":
        # Retain shoulder orientation. Rotating it flat would erase actual lean.
        return np.concatenate([q.ravel(), shoulder / span])
    raise ValueError("Unknown feature version")


def load_csv(path):
    rows, rejected = [], 0
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"subject", "upperbody_label"} | {f"{p}_{a}" for p in POINTS for a in "xyz"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Missing subject, label or one of the 13 selected landmark columns")
        for index, row in enumerate(reader):
            if not row["subject"] or row["upperbody_label"] not in LABELS:
                raise ValueError("Missing participant identity or unsupported external label")
            try:
                points = validate_points([[float(row[f"{p}_{a}"]) for a in "xyz"] for p in POINTS])
            except (ValueError, TypeError):
                rejected += 1
                continue
            rows.append({"subject": row["subject"], "label": row["upperbody_label"],
                         "points": points, "source_row": index})
    if not rows:
        raise ValueError("No measurable rows")
    return rows, rejected


def split_subjects(rows, seed=42):
    people = sorted({r["subject"] for r in rows})
    if len(people) < 7:
        raise ValueError("At least seven participants required for train/validation/test")
    random.Random(seed).shuffle(people)
    test_n, val_n = max(2, round(len(people) * .23)), max(2, round(len(people) * .15))
    roles = {"test": people[:test_n], "validation": people[test_n:test_n + val_n],
             "train": people[test_n + val_n:]}
    for role, subjects in roles.items():
        if {r["label"] for r in rows if r["subject"] in subjects} != set(LABELS):
            raise ValueError("Every predeclared split must contain all classes: " + role)
    return roles


def matrix(rows, mode):
    return np.array([features(r["points"], mode) for r in rows]), np.array([r["label"] for r in rows])


def estimator(kind, seed=42):
    if kind == "logistic":
        return make_pipeline(StandardScaler(), LogisticRegression(
            C=1., class_weight="balanced", max_iter=2000, random_state=seed))
    if kind == "forest":
        return RandomForestClassifier(n_estimators=200, max_depth=10, min_samples_leaf=5,
                                      class_weight="balanced", random_state=seed, n_jobs=1)
    raise ValueError("Unknown model kind")


def evaluate(model, rows, mode):
    x, y = matrix(rows, mode)
    pred = model.predict(x)
    return {
        "rows": len(rows), "accuracy": float(accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, labels=LABELS, average="macro", zero_division=0)),
        "balanced_accuracy": float(np.mean(recall_score(y, pred, labels=LABELS, average=None, zero_division=0))),
        "class_recall": dict(zip(LABELS, recall_score(y, pred, labels=LABELS, average=None, zero_division=0).tolist())),
        "confusion_matrix": confusion_matrix(y, pred, labels=LABELS).tolist(),
        "classes": LABELS, "confusion_axis": "rows=actual; columns=predicted",
    }


def fit_reference_scatter(rows):
    """Learn only within-person TUP scatter, never a universal upright center/threshold."""
    residuals = []
    for subject in sorted({r["subject"] for r in rows}):
        x = np.array([features(r["points"]) for r in rows if r["subject"] == subject and r["label"] == "TUP"])
        if len(x) < 2:
            raise ValueError("Need at least two training upright observations per subject")
        residuals.extend(x - np.median(x, axis=0))
    x = np.asarray(residuals)
    # Unitless scale floor avoids singular precision in explicitly synthetic fixtures.
    scales = np.maximum(np.sqrt(np.mean(x ** 2, axis=0)), .02)
    precision = LedoitWolf(assume_centered=True).fit(x / scales).precision_
    return {"scales": scales.tolist(), "precision": precision.tolist(),
            "scope": "external_train_TUP_within_subject_scatter_not_personal_normality",
            "dimensions": 36, "training_rows": len(x), "threshold": None}


def baseline_reference(frames, coordinate_space):
    """Explicit quality and world coordinates required; no fallback to image coordinates."""
    if coordinate_space != "mediapipe_world":
        raise ValueError("Image coordinates cannot be mixed with the external 3D feature model")
    usable = [frame_points(frame) for frame in frames]
    if len(usable) < 15:
        raise ValueError("At least 15 measurable baseline frames required")
    return np.median(np.array(usable), axis=0)


def frame_points(frame):
    if frame.get("quality") != "measurable":
        raise ValueError("Missing or low measurement quality is unmeasurable")
    points = frame.get("worldLandmarks", [])
    if len(points) != 13:
        raise ValueError("Missing complete world landmarks is unmeasurable")
    return validate_points([[p.get(a, float("nan")) for a in "xyz"] for p in points])


def research_predict(bundle, frame, baseline=None, coordinate_space="mediapipe_world"):
    if coordinate_space != "mediapipe_world":
        raise ValueError("Unsupported coordinate space")
    try:
        p = frame_points(frame)
        reference = validate_points(baseline) if baseline is not None else None
    except (ValueError, TypeError):
        return {"schema_version": "pose13-research-result-v1", "state": "unmeasurable",
                "personal_deviation": None, "external_trunk_prediction": None}
    proba = bundle["classifier"].predict_proba([features(p, bundle["feature_mode"])])[0]
    classes = bundle["classifier"].classes_
    deviation = None
    if reference is not None:
        # Equal anatomical-group weighting stops six eye points dominating distance.
        q = features(p) - features(reference)
        groups = [[0, 1, 2], list(range(3, 21)), list(range(21, 27)),
                  list(range(27, 33)), list(range(33, 36))]
        z = q / np.array(bundle["reference_scatter"]["scales"])
        weighted = z.copy()
        for group in groups:
            weighted[group] /= np.sqrt(len(group) * len(groups))
        precision = np.array(bundle["reference_scatter"]["precision"])
        distance = float(np.sqrt(max(0., weighted @ precision @ weighted)))
        c0, ct = reference[11:13].mean(axis=0), p[11:13].mean(axis=0)
        s0 = np.linalg.norm(reference[12] - reference[11])
        st = np.linalg.norm(p[12] - p[11])
        absolute = (p - reference) / s0
        relative = ((p - ct) - (reference - c0)) / s0
        deviation = {"distance_units": distance, "threshold": None,
                     "normality_verified": False, "reference_relative_delta": relative.tolist(),
                     "world_delta": absolute.tolist(), "shoulder_center_delta": ((ct - c0) / s0).tolist(),
                     "shoulder_span_ratio": float(st / s0),
                     "distance_scope": "relative_shape_only_external_scatter_domain_unvalidated"}
    return {"schema_version": "pose13-research-result-v1", "state": "research_only",
            "domain_validated": False, "personal_deviation": deviation,
            "external_trunk_prediction": str(classes[np.argmax(proba)]),
            "external_trunk_probabilities": dict(zip(map(str, classes), proba.tolist())),
            "service_label": None, "alert": None}


def train(path, output, seed=42, data_kind="real"):
    output = private_path(output)
    if output.exists():
        raise ValueError("Choose a new run directory; never overwrite an existing experiment")
    if data_kind not in {"real", "synthetic"}:
        raise ValueError("Explicit real or synthetic data kind required")
    if data_kind == "real" and digest(path, "md5") != EXPECTED_MD5:
        raise ValueError("Real input must match the reviewed MultiPosture revision")
    rows, rejected = load_csv(path)
    roles = split_subjects(rows, seed)
    by_role = {role: [r for r in rows if r["subject"] in subjects] for role, subjects in roles.items()}
    candidates, trained = {}, {}
    with threadpool_limits(limits=1):
        for mode in ("nose3", "face13"):
            for kind in ("logistic", "forest"):
                name = mode + "_" + kind
                model = estimator(kind, seed)
                x, y = matrix(by_role["train"], mode)
                model.fit(x, y)
                trained[name] = model
                candidates[name] = {"mode": mode, "kind": kind,
                                    "validation": evaluate(model, by_role["validation"], mode)}
                print("validation", name, round(candidates[name]["validation"]["macro_f1"], 4), flush=True)
        selected = max(candidates, key=lambda k: candidates[k]["validation"]["macro_f1"])
        # Candidate selection is frozen before any held-out participant evaluation.
        holdout = {name: evaluate(model, by_role["test"], candidates[name]["mode"]) for name, model in trained.items()}
        meta = candidates[selected]
        development = by_role["train"] + by_role["validation"]
        x, y = matrix(development, meta["mode"])
        final = estimator(meta["kind"], seed).fit(x, y)
        final_holdout = evaluate(final, by_role["test"], meta["mode"])
        scatter = fit_reference_scatter(development)
        bundle = {"schema_version": "multiposture-research-model-v1", "feature_version": FEATURE_VERSION,
                  "feature_mode": meta["mode"], "classifier": final, "reference_scatter": scatter,
                  "dataset_sha256": digest(path), "coordinate_space": "external_hip_normalized_xyz",
                  "service_ready": False, "training_subjects": roles["train"] + roles["validation"]}
        bundle["data_kind"] = data_kind
        # Held-out subjects never enter the exported model or reference scatter fit.
        output.mkdir(parents=True)
        joblib.dump(bundle, output / "research-model.joblib", compress=3)
        write_json(output / "reference-scatter.json", scatter)
        probes = matrix(by_role["test"][:1], meta["mode"])[0]
        for _ in range(20):
            final.predict_proba(probes)
        durations = []
        for _ in range(200):
            started = time.perf_counter()
            final.predict_proba(probes)
            durations.append((time.perf_counter() - started) * 1000)
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        commit = "unavailable"
    report = {
        "schema_version": "multiposture-training-report-v1", "seed": seed,
        "source": SOURCE if data_kind == "real" else "explicit_synthetic_fixture",
        "data_kind": data_kind, "license": "CC-BY-4.0" if data_kind == "real" else "synthetic_fixture",
        "dataset_sha256": digest(path),
        "data_rows": len(rows), "rejected_rows": rejected, "participants": len({r['subject'] for r in rows}),
        "split_subjects": roles, "split_rows": {r: len(v) for r, v in by_role.items()},
        "selection": "validation_macro_f1_only; fixed_hyperparameters; no_holdout_tuning",
        "selected": selected, "candidates": candidates, "candidate_holdout": holdout,
        "exported_model_holdout": final_holdout, "refit": "train+validation; test excluded",
        "model_bytes": (output / "research-model.joblib").stat().st_size,
        "prediction_latency_ms": {"p50": float(np.median(durations)), "p95": float(np.percentile(durations, 95)),
                                  "scope": "single_row_classifier_only_local_cpu_not_full_camera_pipeline"},
        "environment": {"python": sys.version.split()[0], "numpy": np.__version__, "sklearn": sklearn.__version__,
                        "platform": platform.platform(), "processor": platform.processor(), "commit": commit,
                        "source_sha256": digest(Path(__file__))},
        "limitations": ["external_trunk_labels_not_personal_deviation_truth", "no_temporal_training",
                        "no_personal_baseline_holdout_evaluation", "live_coordinate_domain_unvalidated",
                        "no_alert_or_normality_threshold", "small_heldout_participant_count"],
    }
    write_json(output / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("download")
    fetch.add_argument("--output", type=Path, default=ROOT / "data/external/multiposture-v1")
    fit = commands.add_parser("train")
    fit.add_argument("--input", type=Path, required=True)
    fit.add_argument("--output", type=Path, required=True)
    fit.add_argument("--seed", type=int, default=42)
    fit.add_argument("--data-kind", choices=["real", "synthetic"], default="real")
    predict = commands.add_parser("predict")
    predict.add_argument("--model", type=Path, required=True)
    predict.add_argument("--input", type=Path, required=True)
    predict.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "download":
            print(download(args.output))
        elif args.command == "train":
            report = train(args.input, args.output, args.seed, args.data_kind)
            print(json.dumps({"selected": report["selected"], "holdout": report["exported_model_holdout"]}))
        else:
            # Joblib is executable serialization: load only locally created, trusted artifacts.
            model = joblib.load(args.model)
            if model.get("schema_version") != "multiposture-research-model-v1":
                raise ValueError("Unsupported research model")
            document = json.loads(args.input.read_text(encoding="utf-8-sig"))
            if document.get("schema_version") != "pose13-research-input-v1":
                raise ValueError("Unsupported research input")
            space = document.get("coordinate_space")
            reference = baseline_reference(document["baseline_frames"], space) if document.get("baseline_frames") else None
            result = research_predict(model, document["frame"], reference, space)
            write_json(args.output, result)
            print(args.output)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, "External research experiment failed: " + str(error) + "\n")


if __name__ == "__main__":
    main()
