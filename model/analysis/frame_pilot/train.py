"""Participant-held-out training for an exploratory two-stage frame RF."""

from collections import defaultdict
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import platform
import statistics
import sys

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

from model.analysis.replay_pilot.evaluate import THRESHOLDS, scores_and_metrics, training_weights
from model.analysis.replay_pilot.replay import private_destination

from .artifacts import CLASSIFIER_FILE, CORRECTOR_FILE, REPORT_SCHEMA
from .augment import augment_25_views
from .data import prepare_capture
from .frames import MIN_VISIBILITY


CONFIGS = (
    {"n_estimators": 120, "max_depth": 4, "min_samples_leaf": 10},
    {"n_estimators": 120, "max_depth": 8, "min_samples_leaf": 5},
)
CORRECTOR_CONFIG = {"n_estimators": 80, "max_depth": 8, "min_samples_leaf": 20}
# Canonical 640x480 pixels; the target is injected translation, not real chair motion.
TRAIN_SHIFTS = tuple(float(value) for value in np.linspace(-14.4, 14.4, 51))


def _inputs(samples, spans):
    if not samples:
        raise ValueError("training or evaluation frames are required")
    x = np.asarray([sample.features for sample in samples], dtype=float)
    size = np.asarray([spans[sample.capture] for sample in samples], dtype=float)
    if x.shape != (len(samples), 6) or not np.isfinite(x).all():
        raise ValueError("six finite frame features are required")
    if not np.isfinite(size).all() or (size <= 0).any():
        raise ValueError("positive reference shoulder widths are required")
    return x, size


def fit_corrector(samples, spans, config, shifts, forbidden_participants=()):
    """Fit only training participants' reference frames and synthetic shifts."""
    if {sample.participant for sample in samples} & set(forbidden_participants):
        raise ValueError("validation or test participant in corrector training")
    if not samples or any(sample.label != 0 for sample in samples):
        raise ValueError("corrector training requires guided reference frames")
    if not shifts or not all(np.isfinite(shift) for shift in shifts):
        raise ValueError("finite synthetic shifts are required")
    x, size = _inputs(samples, spans)
    views, targets = [], []
    for shift in shifts:
        shifted = x.copy()
        shifted[:, 4] += shift / size
        views.append(np.column_stack((shifted, size)))
        targets.append(np.full(len(samples), shift))
    weights = np.tile(training_weights(samples) / len(shifts), len(shifts))
    model = RandomForestRegressor(**config, random_state=7, n_jobs=1)
    model.fit(np.concatenate(views), np.concatenate(targets), sample_weight=weights)
    return model


def correct_samples(corrector, samples, spans):
    x, size = _inputs(samples, spans)
    correction = np.asarray(corrector.predict(np.column_stack((x, size))), dtype=float)
    if correction.shape != (len(samples),) or not np.isfinite(correction).all():
        raise ValueError("corrector returned invalid shifts")
    x[:, 4] -= correction / size
    return [replace(sample, features=tuple(row)) for sample, row in zip(samples, x)]


def fit_forest(samples, config, forbidden_participants=()):
    if {sample.participant for sample in samples} & set(forbidden_participants):
        raise ValueError("validation or test participant in classifier training")
    if {sample.label for sample in samples} != {0, 1}:
        raise ValueError("both classes are required in each training fold")
    x, y, weights = augment_25_views(samples, forbidden_participants)
    model = RandomForestClassifier(**config, random_state=7, n_jobs=1)
    model.fit(x, y, sample_weight=weights)
    return model


def predict_scores(model, samples):
    if not samples or list(model.classes_) != [0, 1]:
        raise ValueError("valid samples and both classifier classes are required")
    scores = model.predict_proba(np.asarray([sample.features for sample in samples], dtype=float))[:, 1]
    if not np.isfinite(scores).all() or (scores < 0).any() or (scores > 1).any():
        raise ValueError("classifier returned invalid scores")
    return scores.tolist()


def _references(groups, excluded):
    return [sample for person, samples in groups.items() if person not in excluded
            for sample in samples if sample.label == 0]


def cross_fitted_training(groups, spans, excluded, corrector_config, shifts):
    """Each classifier-training person's correction is fit on other people."""
    people = sorted(set(groups) - set(excluded))
    if len(people) < 2:
        raise ValueError("at least two classifier-training participants are required")
    result = []
    for held in people:
        forbidden = set(excluded) | {held}
        corrector = fit_corrector(_references(groups, forbidden), spans,
                                  corrector_config, shifts, forbidden)
        result.extend(correct_samples(corrector, groups[held], spans))
    return result


def _metrics(samples, scores, threshold):
    result = scores_and_metrics(samples, scores, threshold)
    return {"frame": result["window"], "trial_median": result["trial_median"]}


def select_forest(groups, spans, configs, corrector_config, shifts, outer_test=()):
    """Choose classifier configuration and threshold only inside training groups."""
    people = sorted(groups)
    if len(people) < 3 or not configs or set(people) & set(outer_test):
        raise ValueError("at least three training participants and one configuration are required")
    prepared = []
    for held in people:
        forbidden = set(outer_test) | {held}
        corrector = fit_corrector(_references(groups, forbidden), spans,
                                  corrector_config, shifts, forbidden)
        training = cross_fitted_training(groups, spans, forbidden, corrector_config, shifts)
        validation = correct_samples(corrector, groups[held], spans)
        prepared.append((forbidden, training, validation))
    options = []
    for index, config in enumerate(configs):
        predictions = []
        for forbidden, training, validation in prepared:
            model = fit_forest(training, config, forbidden)
            predictions.append((validation, predict_scores(model, validation)))
        for threshold in THRESHOLDS:
            metrics = [_metrics(samples, scores, threshold)["frame"]["balanced_accuracy"]
                       for samples, scores in predictions]
            if any(value is None for value in metrics):
                raise ValueError("every participant needs both guided classes")
            options.append((statistics.mean(metrics), -index, -abs(threshold - .5),
                            -threshold, index, threshold))
    best = max(options)
    return dict(configs[best[-2]]), best[-1]


def _prepare_groups(loaded, assignments, min_visibility, *, require_both_classes=True):
    groups, spans, diagnostics = defaultdict(list), {}, {}
    for person, digest, data in loaded:
        if person not in assignments:
            raise ValueError("capture has no participant assignment")
        capture = digest[:16]
        if capture in spans:
            raise ValueError("capture ID collision")
        samples, counts, reference = prepare_capture(person, capture, data, min_visibility=min_visibility)
        groups[person].extend(samples)
        spans[capture] = reference.geometry[7]
        diagnostics[digest] = counts
    if any(not groups[person] for person in assignments):
        raise ValueError("every participant needs at least one usable frame")
    if require_both_classes and any({sample.label for sample in groups[person]} != {0, 1} for person in assignments):
        raise ValueError("every participant needs valid frames in both guided classes")
    return dict(groups), spans, diagnostics


def _code_hashes():
    root = Path(__file__).parents[1]
    source_files = [Path(__file__), Path(__file__).with_name("__main__.py"),
                    Path(__file__).with_name("data.py"), Path(__file__).with_name("frames.py"),
                    Path(__file__).with_name("inference.py"), Path(__file__).with_name("replay.py"),
                    Path(__file__).with_name("artifacts.py"), Path(__file__).with_name("augment.py"),
                    root / "replay_pilot" / "replay.py", root / "replay_pilot" / "evaluate.py"]
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files}


def candidate_only(loaded, identity_reviewed, revision="unknown", *, min_visibility=MIN_VISIBILITY,
                   config=CONFIGS[1], corrector_config=CORRECTOR_CONFIG, shifts=TRAIN_SHIFTS):
    """Train fixed-configuration candidates without claiming an evaluation.

    All participants contribute training data. An incomplete guided class is
    allowed, but no threshold or performance is selected from those data.
    """
    people = sorted({person for person, _, _ in loaded})
    if len(people) < 2:
        raise ValueError("at least two participant groups are required for cross-fitting")
    if len({digest for _, digest, _ in loaded}) != len(loaded):
        raise ValueError("capture hashes must be unique")
    groups, spans, diagnostics = _prepare_groups(
        loaded, {person: "train" for person in people}, min_visibility, require_both_classes=False)
    corrected = cross_fitted_training(groups, spans, set(), corrector_config, shifts)
    classifier = fit_forest(corrected, config)
    corrector = fit_corrector(_references(groups, set()), spans, corrector_config, shifts)
    report = {
        "schema_version": REPORT_SCHEMA,
        "purpose": "exploratory_frame_two_stage_rf_candidate_without_evaluation",
        "identity_reviewed": bool(identity_reviewed),
        "participants": len(people), "captures": len(loaded),
        "input_sha256": sorted(digest for _, digest, _ in loaded), "code_revision": revision,
        "code_sha256": _code_hashes(),
        "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                        "numpy": np.__version__, "scikit_learn": sklearn.__version__,
                        "joblib": joblib.__version__},
        "settings": {"input": "one_frame", "features": 6, "canonical_size": [640, 480],
                     "visibility_minimum": min_visibility,
                     "evaluation": "none_all_participants_used_for_training",
                     "classifier_training": "cross_fitted_corrector_and_25_training_views",
                     "corrector_training": "reference_frames_and_synthetic_vertical_shifts",
                     "synthetic_shifts_canonical_px": shifts, "corrector_config": corrector_config,
                     "config": config, "sample_weight": "participant_class_trial_balanced",
                     "labels": "guided_task_not_ground_truth", "seed": 7},
        "capture_diagnostics": diagnostics,
        "incomplete_class_groups": sum({sample.label for sample in samples} != {0, 1}
                                       for samples in groups.values()),
        "folds": [], "summary": None,
        "all_data_candidate": {"config": config, "threshold": .5,
                               "threshold_status": "display_only_not_selected_or_validated",
                               "frames": len(corrected),
                               "status": "no_independent_test_for_full_data_model"},
        "limitations": [
            "No model or threshold selection and no independent evaluation were performed.",
            "The 0.5 threshold is a display placeholder, not a validated operating point.",
            "Guided labels and participant identity may be unverified.",
            "Adjacent frames and synthetic views are correlated, not independent people or trials.",
            "Visibility is estimated and does not guarantee detection of physical occlusion.",
            "Synthetic vertical translation is not validated real chair-motion correction.",
            "Scores are uncalibrated and this candidate is not a deployment model.",
        ],
    }
    return report, corrector, classifier


def experiment(loaded, identity_reviewed, revision="unknown", *, min_visibility=MIN_VISIBILITY,
               configs=CONFIGS, corrector_config=CORRECTOR_CONFIG, shifts=TRAIN_SHIFTS):
    people = sorted({person for person, _, _ in loaded})
    if len(people) < 4:
        raise ValueError("at least four participant groups are required for nested two-stage training")
    if len({digest for _, digest, _ in loaded}) != len(loaded):
        raise ValueError("capture hashes must be unique")
    folds = []
    diagnostics = {}
    for held in people:
        # Fix the outer split before producing any frames or fitting either stage.
        assignments = {person: "test" if person == held else "train" for person in people}
        groups, spans, diagnostics = _prepare_groups(loaded, assignments, min_visibility)
        training = {person: groups[person] for person in people if assignments[person] == "train"}
        config, threshold = select_forest(training, spans, configs, corrector_config, shifts, {held})
        corrector = fit_corrector(_references(groups, {held}), spans, corrector_config, shifts, {held})
        corrected_training = cross_fitted_training(groups, spans, {held}, corrector_config, shifts)
        classifier = fit_forest(corrected_training, config, {held})
        test = correct_samples(corrector, groups[held], spans)
        folds.append({"test_participant": held, "training_participants": sorted(training),
                      "config": config, "threshold": threshold,
                      **_metrics(test, predict_scores(classifier, test), threshold)})
    # Full-data artifacts are exploratory candidates and have no independent test.
    groups, spans, _ = _prepare_groups(loaded, {person: "train" for person in people}, min_visibility)
    config, threshold = select_forest(groups, spans, configs, corrector_config, shifts)
    corrector = fit_corrector(_references(groups, set()), spans, corrector_config, shifts)
    corrected_training = cross_fitted_training(groups, spans, set(), corrector_config, shifts)
    classifier = fit_forest(corrected_training, config)
    balanced = [fold["frame"]["balanced_accuracy"] for fold in folds]
    report = {
        "schema_version": REPORT_SCHEMA,
        "purpose": "exploratory_frame_two_stage_rf_not_validated_for_service",
        "identity_reviewed": bool(identity_reviewed),
        "participants": len(people), "captures": len(loaded),
        "input_sha256": sorted(digest for _, digest, _ in loaded), "code_revision": revision,
        "code_sha256": _code_hashes(),
        "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                        "numpy": np.__version__, "scikit_learn": sklearn.__version__,
                        "joblib": joblib.__version__},
        "settings": {"input": "one_frame", "features": 6, "canonical_size": [640, 480],
                     "visibility_minimum": min_visibility,
                     "split": "leave_one_participant_out_before_frame_preparation",
                     "selection": "inner_leave_one_training_participant_out",
                     "classifier_training": "cross_fitted_corrector_and_25_training_views",
                     "corrector_training": "reference_frames_and_synthetic_vertical_shifts",
                     "synthetic_shifts_canonical_px": shifts, "corrector_config": corrector_config,
                     "sample_weight": "participant_class_trial_balanced",
                     "threshold_candidates": THRESHOLDS, "configs": configs,
                     "labels": "guided_task_not_ground_truth", "seed": 7},
        "capture_diagnostics": diagnostics, "folds": folds,
        "summary": {"participant_mean_frame_balanced_accuracy": statistics.mean(balanced),
                    "participant_min_frame_balanced_accuracy": min(balanced),
                    "participant_max_frame_balanced_accuracy": max(balanced)},
        "all_data_candidate": {"config": config, "threshold": threshold,
                               "frames": len(corrected_training),
                               "status": "no_independent_test_for_full_data_model"},
        "limitations": [
            "Guided labels and participant identity may be unverified.",
            "Adjacent frames and synthetic views are correlated, not independent people or trials.",
            "Visibility is estimated and does not guarantee detection of physical occlusion.",
            "Synthetic vertical translation is not validated real chair-motion correction.",
            "Scores are uncalibrated; service alert timing is outside this model.",
            "The full-data candidate has no independent test and is not a deployment model.",
        ],
    }
    return report, corrector, classifier


def save(output, report, corrector, classifier):
    output = private_destination(output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    hashes = {}
    for name, model in ((CORRECTOR_FILE, corrector), (CLASSIFIER_FILE, classifier)):
        path = output / name
        joblib.dump(model, path)
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    report["model_artifact_sha256"] = hashes
    with (output / "report.json").open("x", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
