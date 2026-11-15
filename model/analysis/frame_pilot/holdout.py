"""Fixed-configuration, participant-held-out comparison of frame augmentation.

Use only reviewed identities for claims about new people. An explicitly
unreviewed catalog can be used for exploratory engineering measurements.
No participant's held-out frames enter either model's training or augmentation.
"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import itertools
import json
from pathlib import Path
import platform
import statistics
import subprocess
import sys

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier

from model.analysis.replay_pilot.evaluate import scores_and_metrics, training_weights
from model.analysis.replay_pilot.replay import private_destination

from .artifacts import REPORT_SCHEMA
from .augment import TOTAL_VIEWS
from .frames import MIN_VISIBILITY
from .replay import load_catalog
from .train import (CONFIGS, CORRECTOR_CONFIG, TRAIN_SHIFTS, _code_hashes, _prepare_groups,
                    _references, correct_samples, fit_corrector, fit_forest, predict_scores, save)


def fit_original(samples, config, forbidden_participants=()):
    """Identical classifier and weighting, but without synthetic feature views."""
    if {sample.participant for sample in samples} & set(forbidden_participants):
        raise ValueError("validation or test participant in classifier training")
    if {sample.label for sample in samples} != {0, 1}:
        raise ValueError("both classes are required in each training fold")
    x = np.asarray([sample.features for sample in samples], dtype=float)
    if x.shape != (len(samples), 6) or not np.isfinite(x).all():
        raise ValueError("six finite frame features are required")
    model = RandomForestClassifier(**config, random_state=7, n_jobs=1)
    model.fit(x, [sample.label for sample in samples], sample_weight=training_weights(samples))
    return model


def matrix_metrics(matrix):
    """Keep per-class support visible; a one-class group has no balanced score."""
    (tn, fp), (fn, tp) = matrix
    total = tn + fp + fn + tp
    reference_support, deviation_support = tn + fp, fn + tp
    reference_recall = tn / reference_support if reference_support else None
    deviation_recall = tp / deviation_support if deviation_support else None
    precision = tp / (tp + fp) if tp + fp else None
    deviation_f1 = 2 * tp / (2 * tp + fp + fn) if deviation_support else None
    reference_f1 = 2 * tn / (2 * tn + fp + fn) if reference_support else None
    return {
        "confusion_actual_rows_predicted_columns": matrix,
        "reference_support": reference_support, "deviation_support": deviation_support,
        "accuracy": (tn + tp) / total if total else None,
        "recall_reference": reference_recall, "recall_deviation": deviation_recall,
        "precision_deviation": precision, "f1_deviation": deviation_f1,
        "macro_f1": (reference_f1 + deviation_f1) / 2 if None not in (reference_f1, deviation_f1) else None,
        "balanced_accuracy": (reference_recall + deviation_recall) / 2
        if None not in (reference_recall, deviation_recall) else None,
    }


def metrics(samples, scores, threshold):
    result = scores_and_metrics(samples, scores, threshold)
    return {"frame": matrix_metrics(result["window"]["confusion_actual_rows_predicted_columns"]),
            "trial_median": matrix_metrics(result["trial_median"]["confusion_actual_rows_predicted_columns"])}


def summarize(folds, method, section):
    rows = [fold["methods"][method][section] for fold in folds]
    complete = [row for row in rows if row["balanced_accuracy"] is not None]
    if not complete:
        raise ValueError("at least one evaluation group needs both classes")
    matrix = [[sum(row["confusion_actual_rows_predicted_columns"][i][j] for row in rows)
               for j in range(2)] for i in range(2)]
    return {
        "complete_groups": len(complete), "single_class_groups": len(rows) - len(complete),
        "participant_mean_balanced_accuracy": statistics.mean(row["balanced_accuracy"] for row in complete),
        "participant_mean_reference_recall": statistics.mean(row["recall_reference"] for row in complete),
        "participant_mean_deviation_recall": statistics.mean(row["recall_deviation"] for row in complete),
        "participant_mean_macro_f1": statistics.mean(row["macro_f1"] for row in complete),
        "pooled": matrix_metrics(matrix),
    }


def experiment(loaded, identity_reviewed, revision="unknown", *, workers=3, threshold=.5,
               min_visibility=MIN_VISIBILITY, config=CONFIGS[1], corrector_config=CORRECTOR_CONFIG,
               shifts=TRAIN_SHIFTS, progress=None):
    """Compare original and 25-view RF on the same untouched held-out frames."""
    people = sorted({person for person, _, _ in loaded})
    if len(people) < 3:
        raise ValueError("at least three participant groups are required")
    if len({digest for _, digest, _ in loaded}) != len(loaded):
        raise ValueError("capture hashes must be unique")
    if not isinstance(workers, int) or isinstance(workers, bool) or not 1 <= workers <= 4:
        raise ValueError("workers must be between one and four")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not 0 <= threshold <= 1:
        raise ValueError("threshold must be between zero and one")
    if not np.isfinite(threshold):
        raise ValueError("threshold must be finite")
    report_progress = progress if progress is not None else lambda *_: None

    # Fix all group assignments before making frame examples. Each capture is
    # processed independently using only its own registration, with no fitted
    # population transform; these examples can then be reused by each fold.
    assignments = {held: {person: "test" if person == held else "train" for person in people}
                   for held in people}
    groups, spans, diagnostics = _prepare_groups(loaded, assignments[people[0]], min_visibility,
                                                  require_both_classes=False)
    for held in people:
        training = [sample for person in people if assignments[held][person] == "train"
                    for sample in groups[person]]
        if {sample.label for sample in training} != {0, 1}:
            raise ValueError("each held-out fold requires both training classes")
    if not any({sample.label for sample in groups[person]} == {0, 1} for person in people):
        raise ValueError("at least one participant needs both evaluation classes")

    # The same training-participant set occurs in multiple folds. Cache only
    # models with identical excluded sets; held people are never fit inputs.
    excluded_sets = [frozenset(), *(frozenset([person]) for person in people),
                     *(frozenset(pair) for pair in itertools.combinations(people, 2))]
    correctors = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(fit_corrector, _references(groups, excluded), spans,
                            corrector_config, shifts, excluded): excluded for excluded in excluded_sets}
        for index, future in enumerate(as_completed(jobs), 1):
            correctors[jobs[future]] = future.result()
            report_progress("correctors", index, len(jobs))

    def score_fold(held):
        forbidden = {held}
        training = []
        for person in people:
            if person != held:
                training.extend(correct_samples(correctors[frozenset((held, person))], groups[person], spans))
        original = fit_original(training, config, forbidden)
        augmented = fit_forest(training, config, forbidden)
        test = correct_samples(correctors[frozenset((held,))], groups[held], spans)
        return {"test_participant": held, "training_participants": [p for p in people if p != held],
                "training_frames": len(training), "augmented_training_views": len(training) * TOTAL_VIEWS,
                "test_frames": len(test), "test_frames_augmented": False,
                "methods": {"original": metrics(test, predict_scores(original, test), threshold),
                            "augmented_25x": metrics(test, predict_scores(augmented, test), threshold)}}

    def train_all():
        corrected = []
        for person in people:
            corrected.extend(correct_samples(correctors[frozenset((person,))], groups[person], spans))
        return len(corrected), fit_forest(corrected, config)

    folds = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(score_fold, held): held for held in people}
        candidate_job = pool.submit(train_all)
        for index, future in enumerate(as_completed(jobs), 1):
            folds.append(future.result())
            report_progress("held_out_folds", index, len(jobs))
        full_frames, classifier = candidate_job.result()
    folds.sort(key=lambda fold: fold["test_participant"])

    source_hashes = _code_hashes()
    source_hashes["frame_pilot/holdout.py"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    labels = Counter(sample.label for group in groups.values() for sample in group)
    summary = {method: {section: summarize(folds, method, section) for section in ("frame", "trial_median")}
               for method in ("original", "augmented_25x")}
    report = {
        "schema_version": REPORT_SCHEMA,
        "purpose": "exploratory_fixed_configuration_participant_holdout_frame_rf",
        "identity_reviewed": bool(identity_reviewed), "participants": len(people), "captures": len(loaded),
        "input_sha256": sorted(digest for _, digest, _ in loaded), "code_revision": revision,
        "code_sha256": source_hashes,
        "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                        "numpy": np.__version__, "scikit_learn": sklearn.__version__,
                        "joblib": joblib.__version__},
        "settings": {"input": "one_frame", "features": 6, "canonical_size": [640, 480],
                     "visibility_minimum": min_visibility, "workers": workers,
                     "evaluation": "leave_one_provisional_participant_out",
                     "model_selection": "fixed_before_evaluation_no_test_tuning",
                     "threshold": threshold, "config": config, "corrector_config": corrector_config,
                     "classifier_training": "cross_fitted_corrector_original_vs_25_training_views",
                     "corrector_training": "reference_frames_and_synthetic_vertical_shifts",
                     "synthetic_shifts_canonical_px": shifts,
                     "sample_weight": "participant_class_trial_balanced", "labels": "guided_task_not_ground_truth",
                     "seed": 7},
        "valid_training_frame_labels": {"neutral": labels[0], "deviation": labels[1]},
        "capture_diagnostics": diagnostics, "folds": folds, "summary": summary,
        "all_data_candidate": {"config": config, "threshold": threshold,
                               "threshold_status": "display_only_not_selected_or_validated",
                               "frames": full_frames, "training_views": full_frames * TOTAL_VIEWS,
                               "status": "no_independent_test_for_full_data_model"},
        "limitations": [
            "Participant identity and guided labels may be unverified; group leakage remains possible.",
            "The 0.5 threshold and configuration were fixed, not optimized or calibrated.",
            "The full-data candidate has no independent test; held-out folds evaluate the procedure.",
            "Adjacent frames and synthetic views are correlated, not independent people or trials.",
            "The dataset does not establish real-world false alarms, onset latency or chair-motion correction.",
        ],
    }
    return report, correctors[frozenset()], classifier


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--output", required=True, help="new private output directory outside Git")
    parser.add_argument("--allow-unverified-identities", action="store_true")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--classifier-trees", type=int, default=CONFIGS[1]["n_estimators"])
    parser.add_argument("--corrector-trees", type=int, default=CORRECTOR_CONFIG["n_estimators"])
    parser.add_argument("--threshold", type=float, default=.5,
                        help="fixed before evaluation; not selected or calibrated on test groups")
    parser.add_argument("--min-visibility", type=float, default=MIN_VISIBILITY)
    args = parser.parse_args()
    try:
        if args.classifier_trees <= 0 or args.corrector_trees <= 0:
            raise ValueError("tree counts must be positive")
        output = private_destination(args.output)
        if output.exists():
            raise ValueError("output must not exist")
        catalog_path = Path(args.catalog)
        catalog_hash = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
        catalog, loaded = load_catalog(catalog_path, args.allow_unverified_identities)
        try:
            revision = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                                      text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            revision = "unknown"

        def progress(stage, completed, total):
            if completed == 1 or completed == total or completed % 5 == 0:
                print(f"{stage}: {completed}/{total}", flush=True)

        report, corrector, classifier = experiment(
            loaded, catalog.get("identity_reviewed") is True, revision, workers=args.workers,
            threshold=args.threshold, min_visibility=args.min_visibility,
            config={**CONFIGS[1], "n_estimators": args.classifier_trees},
            corrector_config={**CORRECTOR_CONFIG, "n_estimators": args.corrector_trees}, progress=progress)
        if hashlib.sha256(catalog_path.read_bytes()).hexdigest() != catalog_hash:
            raise ValueError("catalog changed during evaluation")
        load_catalog(catalog_path, args.allow_unverified_identities)
        report["catalog_sha256"] = catalog_hash
        report["source_integrity_rechecked"] = True
        save(output, report, corrector, classifier)
        print(f"Completed {report['participants']} provisional participant folds; "
              f"identity_reviewed={report['identity_reviewed']}.")
        for method in ("original", "augmented_25x"):
            value = report["summary"][method]["frame"]["participant_mean_balanced_accuracy"]
            print(f"{method} participant mean frame balanced accuracy: {value:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        # Catalog paths and participant names are private.
        print(f"Frame holdout failed: {type(exc).__name__}. Check the private inputs and settings.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
