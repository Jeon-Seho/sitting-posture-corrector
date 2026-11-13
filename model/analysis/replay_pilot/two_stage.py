"""Exploratory two-stage pilot for *synthetic* vertical image translations.

The correction target is the injected translation, not real chair motion.
No reference is automatically updated, and no service API is modified.
"""
import argparse
from collections import defaultdict
from copy import deepcopy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import platform
import statistics
import sys

import joblib
import lightgbm
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestRegressor

from .augment_50k import fit_25_views
from .evaluate import scores_and_metrics, training_weights
from .replay import INDICES, baseline, finite, load_catalog, prepare_capture, private_destination


HEIGHT = 480
TRAIN_SHIFTS = tuple(float(x) for x in np.linspace(-0.03 * HEIGHT, 0.03 * HEIGHT, 51))
TEST_SHIFTS = {"unchanged": 0.0, "up_3pct": -0.03 * HEIGHT,
               "down_3pct": 0.03 * HEIGHT, "up_6pct": -0.06 * HEIGHT,
               "down_6pct": 0.06 * HEIGHT}
CORRECTOR_CONFIG = {"n_estimators": 80, "max_depth": 8, "min_samples_leaf": 20,
                    "random_state": 7, "n_jobs": 1}


def input_matrix(windows, spans):
    """Six posture changes and registration shoulder span, without labels."""
    if not windows:
        raise ValueError("at least one window is required")
    x = np.asarray([w.features for w in windows], dtype=float)
    size = np.asarray([spans[w.capture] for w in windows], dtype=float)
    if x.shape != (len(windows), 6) or not np.isfinite(x).all():
        raise ValueError("six finite input features are required")
    if not np.isfinite(size).all() or (size <= 0).any():
        raise ValueError("positive registration shoulder spans are required")
    return x, size


def correction_training_views(windows, spans, forbidden_participants=()):
    """Augment only training participants' guided reference windows in memory."""
    if any(w.label != 0 for w in windows):
        raise ValueError("correction training requires guided reference windows")
    if {w.participant for w in windows} & set(forbidden_participants):
        raise ValueError("validation or test participant in correction training")
    x, size = input_matrix(windows, spans)
    inputs, targets = [], []
    for shift_px in TRAIN_SHIFTS:
        shifted = x.copy()
        shifted[:, 4] += shift_px / size
        inputs.append(np.column_stack((shifted, size)))
        targets.append(np.full(len(windows), shift_px))
    weights = np.tile(training_weights(windows) / len(TRAIN_SHIFTS), len(TRAIN_SHIFTS))
    return np.concatenate(inputs), np.concatenate(targets), weights


def fit_corrector(windows, spans, forbidden_participants=()):
    x, y, weights = correction_training_views(windows, spans, forbidden_participants)
    model = RandomForestRegressor(**CORRECTOR_CONFIG)
    model.fit(x, y, sample_weight=weights)
    return model


def correction_prediction(model, windows, spans):
    x, size = input_matrix(windows, spans)
    offsets_px = model.predict(np.column_stack((x, size)))
    if not np.isfinite(offsets_px).all():
        raise ValueError("correction prediction must be finite")
    return offsets_px


def corrected_windows(model, windows, spans):
    """Apply the predicted shift without changing timestamps, labels or reference."""
    x, size = input_matrix(windows, spans)
    x[:, 4] -= correction_prediction(model, windows, spans) / size
    return [replace(w, features=tuple(row)) for w, row in zip(windows, x)]


def cross_fitted_training(groups, spans, excluded, corrector_cache):
    """Each participant's classifier inputs use a corrector trained on others."""
    people = sorted(set(groups) - set(excluded))
    if len(people) < 2:
        raise ValueError("at least two classifier training participants are required")
    result = []
    for held in people:
        absent = frozenset(set(excluded) | {held})
        if absent not in corrector_cache:
            reference = [w for p in groups if p not in absent for w in groups[p] if w.label == 0]
            corrector_cache[absent] = fit_corrector(reference, spans, absent)
        result.extend(corrected_windows(corrector_cache[absent], groups[held], spans))
    return result


def scores(classifier, windows, spans, offsets_px):
    x, size = input_matrix(windows, spans)
    offsets_px = np.asarray(offsets_px, dtype=float)
    if offsets_px.shape != (len(windows),) or not np.isfinite(offsets_px).all():
        raise ValueError("one finite correction is required for each window")
    if list(classifier.classes_) != [0, 1]:
        raise ValueError("classifier must have reference and deviation classes")
    corrected = x.copy()
    corrected[:, 4] -= offsets_px / size
    return classifier.predict_proba(corrected)[:, 1].tolist()


def shift_measurement(data, shift_px):
    """Only synthetic test translations; never change registration or input."""
    translated = deepcopy(data)
    for frame in translated["frames"]:
        if frame["phase"] != "hold":
            continue
        for i in INDICES:
            point = frame["image"][i]
            if isinstance(point, dict) and finite(point.get("y")):
                point["y"] += shift_px / HEIGHT
    return translated


def make_groups(loaded, shift_px=0.0):
    groups, spans = defaultdict(list), {}
    diagnostics = defaultdict(int)
    for person, digest, source in loaded:
        capture = digest[:16]
        if capture in spans:
            raise ValueError("capture ID collision")
        spans[capture] = baseline(source["frames"], source["markers"])[7]
        data = shift_measurement(source, shift_px) if shift_px else source
        windows, counts = prepare_capture(person, capture, data)
        groups[person].extend(windows)
        for name, value in counts.items():
            diagnostics[name] += value
    return dict(groups), spans, dict(diagnostics)


def aggregate(folds):
    def mean(section, key):
        values = [fold[section][key] for fold in folds]
        if any(value is None for value in values):
            raise ValueError("both guided classes are required for each participant")
        return statistics.mean(values)
    return {"participant_mean_window_balanced_accuracy": mean("window", "balanced_accuracy"),
            "participant_mean_reference_recall": mean("window", "recall_reference"),
            "participant_mean_deviation_recall": mean("window", "recall_deviation"),
            "participant_mean_trial_balanced_accuracy": mean("trial_median", "balanced_accuracy"),
            "three_second_exploratory": {
                label: {field: sum(f["three_second_exploratory"][label][field] for f in folds)
                        for field in ("eligible_trials", "detected_trials")}
                for label in ("neutral", "deviation")}}


def prior_fold_map(prior, loaded):
    people = sorted({p for p, _, _ in loaded})
    if len(people) < 3 or sorted(d for _, d, _ in loaded) != prior.get("input_sha256"):
        raise ValueError("prior model selection requires the same catalog and at least three people")
    folds = {f["test_participant"]: f for f in prior["folds"]}
    if set(folds) != set(people):
        raise ValueError("prior and current participants differ")
    for held in people:
        if set(folds[held]["training_participants"]) != set(people) - {held}:
            raise ValueError("prior fold is not participant-held-out")
    for name, digest in prior["code_sha256"].items():
        if hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest() != digest:
            raise ValueError("prior model code no longer matches its report")
    return people, folds


def experiment(loaded, prior, identity_reviewed):
    people, previous = prior_fold_map(prior, loaded)
    classifiers, correctors, corrected_classifiers, corrector_cache, trained_folds = {}, {}, {}, {}, []
    for held in people:
        # Split people before preparing any windows or synthetic samples.
        assignments = {p: p != held for p in people}
        groups, spans, _ = make_groups(loaded)
        if any({w.label for w in groups[p]} != {0, 1} for p in people):
            raise ValueError("each participant needs valid reference and deviation windows")
        training = [w for p in people if assignments[p] for w in groups[p]]
        reference = [w for w in training if w.label == 0]
        config = previous[held]["models"]["random_forest_25x"]["config"]
        classifiers[held] = fit_25_views("random_forest", config, training, {held})
        correctors[held] = fit_corrector(reference, spans, {held})
        corrector_cache[frozenset({held})] = correctors[held]
        corrected_training = cross_fitted_training(groups, spans, {held}, corrector_cache)
        corrected_classifiers[held] = fit_25_views("random_forest", config, corrected_training, {held})
        trained_folds.append({"test_participant": held,
                              "training_participants": [p for p in people if assignments[p]],
                              "classifier_original_windows": len(training),
                              "classifier_augmented_views": len(training) * 25,
                              "corrector_reference_windows": len(reference),
                              "corrector_synthetic_views": len(reference) * len(TRAIN_SHIFTS),
                              "classifier_cross_fitted_windows": len(corrected_training),
                              "threshold": previous[held]["models"]["random_forest_25x"]["threshold"]})

    scenarios = {}
    for name, shift_px in TEST_SHIFTS.items():
        groups, spans, diagnostics = make_groups(loaded, shift_px)
        results = defaultdict(list)
        error_by_class = defaultdict(list)
        participant_results = []
        for held in people:
            windows = groups[held]
            threshold = previous[held]["models"]["random_forest_25x"]["threshold"]
            offsets = correction_prediction(correctors[held], windows, spans)
            choices = {"uncorrected": np.zeros(len(windows)), "learned_correction": offsets,
                       "trained_with_correction": offsets,
                       "synthetic_oracle": np.full(len(windows), shift_px)}
            person = {"test_participant": held, "windows": len(windows),
                      "comparison": {}, "correction_mae_px_by_guided_task": {}}
            for label, correction in choices.items():
                classifier = corrected_classifiers[held] if label == "trained_with_correction" else classifiers[held]
                result = scores_and_metrics(windows, scores(classifier, windows, spans, correction), threshold)
                if name == "unchanged" and label == "uncorrected":
                    old = previous[held]["models"]["random_forest_25x"]
                    if any(result[k] != old[k] for k in ("window", "trial_median", "three_second_exploratory")):
                        raise ValueError("retrained classifier does not reproduce prior held-out results")
                results[label].append(result)
                person["comparison"][label] = result
            for class_id, class_name in ((0, "reference"), (1, "deviation")):
                errors = [abs(offset - shift_px) for w, offset in zip(windows, offsets) if w.label == class_id]
                if not errors:
                    raise ValueError("each participant needs both guided classes")
                error_by_class[class_name].append(statistics.mean(errors))
                person["correction_mae_px_by_guided_task"][class_name] = statistics.mean(errors)
            participant_results.append(person)
        scenarios[name] = {"synthetic_shift_px": shift_px,
                           "capture_diagnostics": diagnostics,
                           "participant_mean_correction_mae_px_by_guided_task": {
                               key: statistics.mean(values) for key, values in error_by_class.items()},
                           "comparison": {label: aggregate(values) for label, values in results.items()},
                           "participants": participant_results}

    # This all-person pair has no separate independent evaluation.
    groups, spans, _ = make_groups(loaded)
    all_windows = [w for p in people for w in groups[p]]
    references = [w for w in all_windows if w.label == 0]
    candidate = prior["all_data_candidates"]["random_forest"]
    classifiers["all-data"] = fit_25_views("random_forest", candidate["config"], all_windows)
    correctors["all-data"] = fit_corrector(references, spans)
    corrected_training = cross_fitted_training(groups, spans, set(), corrector_cache)
    corrected_classifiers["all-data"] = fit_25_views("random_forest", candidate["config"], corrected_training)
    report = {"schema_version": "replay-two-stage-synthetic-translation-v1",
              "purpose": "exploratory_not_real_chair_motion_or_service_validation",
              "identity_reviewed": identity_reviewed,
              "participants": len(people), "captures": len(loaded),
              "input_sha256": sorted(d for _, d, _ in loaded),
              "source_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                for p in Path(__file__).parent.glob("*.py")},
              "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                              "numpy": np.__version__, "scikit_learn": sklearn.__version__,
                              "lightgbm": lightgbm.__version__, "joblib": joblib.__version__},
              "settings": {"split": "leave_one_participant_out_before_windows_and_augmentation",
                           "corrector_target": "known injected vertical image translation in pixels",
                           "corrector_training": "guided reference windows only, synthetic feature shifts",
                           "corrector_input": "six reference-relative features and registration shoulder span",
                           "corrector_config": CORRECTOR_CONFIG,
                           "train_shifts_px": list(TRAIN_SHIFTS),
                           "train_weights": "per-original participant/trial weight divided among 51 views",
                           "classifier": "25-view RF; prior training-only selected config and threshold",
                           "two_stage_classifier_training": "participant-held-out corrector predictions within training participants",
                           "threshold_selection": "prior uncorrected classifier, not re-tuned for the two-stage model",
                           "synthetic_oracle": "knows injected shift and is not deployable",
                           "reference_is_never_updated": True},
              "folds": trained_folds, "scenarios": scenarios,
              "all_data_candidate": {"corrector_reference_windows": len(references),
                                     "corrector_synthetic_views": len(references) * len(TRAIN_SHIFTS),
                                     "classifier_original_windows": len(all_windows),
                                     "classifier_training_views": len(all_windows) * 25,
                                     "classifier_cross_fitted_windows": len(corrected_training),
                                     "threshold": candidate["threshold"],
                                     "status": "not_independently_tested_do_not_deploy"},
              "limitations": ["No actual chair-motion or correct-baseline targets exist in these v8 recordings.",
                              "The injected offset is known; natural translation already present is not measured.",
                              "The synthetic model handles image vertical translation only; it does not distinguish its cause.",
                              "The previously selected classifier threshold was not retuned for the two-stage model.",
                              "Guided posture labels and participant identities are not independently verified.",
                              "Real-life false alarms, true correction error and re-registration cannot be evaluated.",
                              "Same six participants were used in prior experiments; exploratory selection bias remains."]}
    return report, classifiers, correctors, corrected_classifiers


def save(output, report, classifiers, correctors, corrected_classifiers):
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    artifacts = {}
    for stage, models in (("posture", classifiers), ("synthetic-vertical-corrector", correctors),
                          ("posture-after-correction", corrected_classifiers)):
        for fold, model in models.items():
            name = f"{fold}-{stage}.joblib"
            joblib.dump(model, output / name)
            artifacts[name] = hashlib.sha256((output / name).read_bytes()).hexdigest()
    report["model_artifact_sha256"] = artifacts
    with (output / "report.json").open("x", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--prior-report", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--allow-unverified-identities", action="store_true")
    args = parser.parse_args()
    try:
        output = private_destination(args.output)
        if output.exists():
            raise ValueError("output must not exist")
        catalog_path, prior_path = Path(args.catalog), Path(args.prior_report)
        catalog_digest = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
        prior_digest = hashlib.sha256(prior_path.read_bytes()).hexdigest()
        catalog, loaded = load_catalog(catalog_path, args.allow_unverified_identities)
        prior = json.loads(prior_path.read_text(encoding="utf-8"))
        report, classifiers, correctors, corrected_classifiers = experiment(loaded, prior, catalog.get("identity_reviewed") is True)
        if hashlib.sha256(catalog_path.read_bytes()).hexdigest() != catalog_digest:
            raise ValueError("catalog changed during experiment")
        if hashlib.sha256(prior_path.read_bytes()).hexdigest() != prior_digest:
            raise ValueError("prior report changed during experiment")
        load_catalog(catalog_path, args.allow_unverified_identities)
        report["source_integrity_rechecked"] = True
        report["prior_report_sha256"] = prior_digest
        save(output, report, classifiers, correctors, corrected_classifiers)
        print(f"Participants: {report['participants']}; identity_reviewed={report['identity_reviewed']}")
        print(f"All-data correction views: {report['all_data_candidate']['corrector_synthetic_views']}")
        for name, scenario in report["scenarios"].items():
            raw = scenario["comparison"]["uncorrected"]["participant_mean_window_balanced_accuracy"]
            adjusted = scenario["comparison"]["learned_correction"]["participant_mean_window_balanced_accuracy"]
            trained = scenario["comparison"]["trained_with_correction"]["participant_mean_window_balanced_accuracy"]
            print(f"{name}: uncorrected={raw:.3f}, correction_only={adjusted:.3f}, two_stage={trained:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"Two-stage pilot failed: {type(exc).__name__}. Check private inputs and output.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
