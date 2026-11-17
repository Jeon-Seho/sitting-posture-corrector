"""Compare 100-view frame RF with a verified prior 25-view holdout run."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import copy
import hashlib
import itertools
import json
from pathlib import Path
import platform
import subprocess
import sys

import joblib
import numpy as np
import sklearn

from model.analysis.replay_pilot.replay import private_destination

from .artifacts import REPORT_SCHEMA, load_models
from .augment_100 import TOTAL_VIEWS, fit_100_views
from .checkpoint import Checkpoint
from .holdout import metrics, summarize
from .replay import load_catalog
from .train import (_code_hashes, _prepare_groups, _references, correct_samples,
                    fit_corrector, predict_scores, save)


def current_hashes():
    root = Path(__file__).parents[1]
    hashes = _code_hashes()
    for name in ("holdout.py", "augment_100.py", "checkpoint.py", "holdout_100.py"):
        path = Path(__file__).with_name(name)
        hashes[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def verify_prior(prior, corrector, classifier, loaded, identity_reviewed, catalog_hash):
    """Refuse a comparison if the earlier data, splits, code or settings differ."""
    settings = prior["settings"]
    if (prior.get("schema_version") != REPORT_SCHEMA or prior.get("source_integrity_rechecked") is not True
            or prior.get("catalog_sha256") != catalog_hash
            or prior.get("identity_reviewed") is not bool(identity_reviewed)
            or prior.get("input_sha256") != sorted(digest for _, digest, _ in loaded)
            or prior.get("participants") != len({person for person, _, _ in loaded})
            or prior.get("captures") != len(loaded)):
        raise ValueError("prior data or identity settings differ")
    required = {"input": "one_frame", "features": 6, "canonical_size": [640, 480],
                "evaluation": "leave_one_provisional_participant_out",
                "model_selection": "fixed_before_evaluation_no_test_tuning",
                "classifier_training": "cross_fitted_corrector_original_vs_25_training_views",
                "corrector_training": "reference_frames_and_synthetic_vertical_shifts", "seed": 7}
    if any(settings.get(key) != value for key, value in required.items()):
        raise ValueError("prior evaluation methodology differs")
    threshold, visibility = settings["threshold"], settings["visibility_minimum"]
    if (not isinstance(threshold, (float, int)) or isinstance(threshold, bool) or not np.isfinite(threshold)
            or not 0 <= threshold <= 1 or not isinstance(visibility, (float, int)) or isinstance(visibility, bool)
            or not np.isfinite(visibility) or not 0 <= visibility <= 1):
        raise ValueError("prior threshold or quality setting is invalid")
    if prior["all_data_candidate"].get("threshold") != threshold:
        raise ValueError("prior candidate threshold differs")
    environment = prior["environment"]
    if any(environment.get(key) != value for key, value in {
        "python": sys.version.split()[0], "numpy": np.__version__, "scikit_learn": sklearn.__version__,
        "joblib": joblib.__version__,
    }.items()):
        raise ValueError("prior training environment differs")
    root = Path(__file__).parents[1].resolve()
    for name, digest in prior["code_sha256"].items():
        path = (root / name).resolve()
        path.relative_to(root)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("prior training source changed")
    for model, config, features in ((corrector, settings["corrector_config"], 7),
                                    (classifier, settings["config"], 6)):
        params = model.get_params()
        if (getattr(model, "n_features_in_", None) != features or params.get("random_state") != 7
                or any(params.get(key) != value for key, value in config.items())):
            raise ValueError("prior model settings differ")
    if list(classifier.classes_) != [0, 1]:
        raise ValueError("prior classifier labels differ")


def verify_fold(prior_fold, held, people, groups):
    """Confirm the 25x and 100x comparisons use the exact same original frames."""
    training_frames = sum(len(groups[person]) for person in people if person != held)
    labels = Counter(sample.label for sample in groups[held])
    old = prior_fold["methods"]["augmented_25x"]["frame"]
    if (prior_fold.get("test_participant") != held
            or sorted(prior_fold.get("training_participants", ())) != [p for p in people if p != held]
            or prior_fold.get("test_frames") != len(groups[held])
            or prior_fold.get("training_frames") != training_frames
            or prior_fold.get("augmented_training_views") != training_frames * 25
            or prior_fold.get("test_frames_augmented") is not False
            or old.get("reference_support") != labels[0] or old.get("deviation_support") != labels[1]):
        raise ValueError("prior fold or held-out frame counts differ")


def verify_model(model, config, features):
    params = model.get_params()
    if (getattr(model, "n_features_in_", None) != features or params.get("random_state") != 7
            or any(params.get(key) != value for key, value in config.items())):
        raise ValueError("checkpoint model settings differ")
    if features == 6 and list(model.classes_) != [0, 1]:
        raise ValueError("checkpoint classifier labels differ")


def experiment(loaded, identity_reviewed, prior, prior_corrector, prior_classifier,
               catalog_hash, prior_report_hash, revision="unknown", *, workers=2,
               checkpoint=None, progress=None):
    if not isinstance(workers, int) or isinstance(workers, bool) or not 1 <= workers <= 4:
        raise ValueError("workers must be between one and four")
    verify_prior(prior, prior_corrector, prior_classifier, loaded, identity_reviewed, catalog_hash)
    people = sorted({person for person, _, _ in loaded})
    if len(people) < 3 or len({digest for _, digest, _ in loaded}) != len(loaded):
        raise ValueError("unique captures and at least three participant groups are required")
    settings = prior["settings"]
    config, corrector_config = settings["config"], settings["corrector_config"]
    threshold, visibility = settings["threshold"], settings["visibility_minimum"]
    shifts = tuple(settings["synthetic_shifts_canonical_px"])
    report_progress = progress if progress is not None else lambda *_: None

    # Fix all folds before producing per-capture frames. No population-level
    # transform is fit during frame preparation; each reference is its own.
    assignments = {held: {person: "test" if person == held else "train" for person in people}
                   for held in people}
    groups, spans, diagnostics = _prepare_groups(loaded, assignments[people[0]], visibility,
                                                  require_both_classes=False)
    old_folds = {fold["test_participant"]: fold for fold in prior["folds"]}
    if len(old_folds) != len(prior["folds"]) or set(old_folds) != set(people):
        raise ValueError("prior fold participants differ")
    for held in people:
        verify_fold(old_folds[held], held, people, groups)
        training = [sample for person in people if person != held for sample in groups[person]]
        if {sample.label for sample in training} != {0, 1}:
            raise ValueError("each training fold needs both classes")

    excluded_sets = [*(frozenset([person]) for person in people),
                     *(frozenset(pair) for pair in itertools.combinations(people, 2))]
    # The full-data corrector is unchanged by classifier-view count. Reuse the
    # exact hash-checked 25x candidate corrector only for the full-data model.
    correctors = {frozenset(): prior_corrector}
    pending = []
    for excluded in excluded_sets:
        model = checkpoint.load_model("corrector", sorted(excluded)) if checkpoint else None
        if model is None:
            pending.append(excluded)
        else:
            verify_model(model, corrector_config, 7)
            correctors[excluded] = model
    completed = len(correctors) - 1
    if completed:
        report_progress("correctors_cached", completed, len(excluded_sets))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(fit_corrector, _references(groups, excluded), spans,
                            corrector_config, shifts, excluded): excluded for excluded in pending}
        for future in as_completed(jobs):
            excluded = jobs[future]
            model = future.result()
            correctors[excluded] = model
            if checkpoint:
                checkpoint.save_model("corrector", sorted(excluded), model)
            completed += 1
            report_progress("correctors", completed, len(excluded_sets))

    def score_fold(held):
        training = []
        for person in people:
            if person != held:
                training.extend(correct_samples(correctors[frozenset((held, person))], groups[person], spans))
        classifier = fit_100_views(training, config, {held})
        test = correct_samples(correctors[frozenset((held,))], groups[held], spans)
        new = metrics(test, predict_scores(classifier, test), threshold)
        old = old_folds[held]["methods"]["augmented_25x"]["frame"]
        if (new["frame"]["reference_support"] != old["reference_support"]
                or new["frame"]["deviation_support"] != old["deviation_support"]):
            raise ValueError("test labels differ from prior fold")
        return {"test_participant": held, "training_participants": [p for p in people if p != held],
                "training_frames": len(training), "training_views_25x": len(training) * 25,
                "training_views_100x": len(training) * TOTAL_VIEWS,
                "test_frames": len(test), "test_frames_augmented": False,
                "methods": {"original": copy.deepcopy(old_folds[held]["methods"]["original"]),
                            "augmented_25x": copy.deepcopy(old_folds[held]["methods"]["augmented_25x"]),
                            "augmented_100x": new}}

    def train_all():
        corrected = []
        for person in people:
            corrected.extend(correct_samples(correctors[frozenset((person,))], groups[person], spans))
        return fit_100_views(corrected, config)

    folds, pending_folds = [], []
    for held in people:
        cached = checkpoint.load_json("fold", held) if checkpoint else None
        if cached is None:
            pending_folds.append(held)
        else:
            verify_fold(old_folds[held], held, people, groups)
            if (cached.get("test_participant") != held or cached.get("test_frames") != len(groups[held])
                    or cached.get("test_frames_augmented") is not False
                    or cached.get("methods", {}).get("augmented_25x") != old_folds[held]["methods"]["augmented_25x"]):
                raise ValueError("cached fold differs from prior evaluation")
            folds.append(cached)
    classifier = checkpoint.load_model("classifier", "all-data") if checkpoint else None
    if classifier is not None:
        verify_model(classifier, config, 6)
    if folds:
        report_progress("held_out_folds_cached", len(folds), len(people))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(score_fold, held): held for held in pending_folds}
        candidate_job = pool.submit(train_all) if classifier is None else None
        for future in as_completed(jobs):
            fold = future.result()
            folds.append(fold)
            if checkpoint:
                checkpoint.save_json("fold", fold["test_participant"], fold)
            report_progress("held_out_folds", len(folds), len(people))
        if candidate_job is not None:
            classifier = candidate_job.result()
            if checkpoint:
                checkpoint.save_model("classifier", "all-data", classifier)
    folds.sort(key=lambda fold: fold["test_participant"])
    summary = {method: {section: summarize(folds, method, section) for section in ("frame", "trial_median")}
               for method in ("original", "augmented_25x", "augmented_100x")}
    if summary["augmented_25x"] != prior["summary"]["augmented_25x"]:
        raise ValueError("prior 25x summary does not match its folds")
    labels = Counter(sample.label for group in groups.values() for sample in group)
    frames = sum(labels.values())
    report = {
        "schema_version": REPORT_SCHEMA,
        "purpose": "exploratory_100_vs_25_view_participant_holdout_frame_rf",
        "identity_reviewed": bool(identity_reviewed), "participants": len(people), "captures": len(loaded),
        "input_sha256": sorted(digest for _, digest, _ in loaded), "code_revision": revision,
        "code_sha256": current_hashes(), "prior_25x_report_sha256": prior_report_hash,
        "prior_25x_model_artifact_sha256": prior["model_artifact_sha256"],
        "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                        "numpy": np.__version__, "scikit_learn": sklearn.__version__,
                        "joblib": joblib.__version__},
        "settings": {"input": "one_frame", "features": 6, "canonical_size": [640, 480],
                     "visibility_minimum": visibility, "workers": workers,
                     "evaluation": "leave_one_provisional_participant_out",
                     "model_selection": "fixed_before_evaluation_no_test_tuning",
                     "threshold": threshold, "config": config, "corrector_config": corrector_config,
                     "classifier_training": "cross_fitted_corrector_100_training_views",
                     "corrector_training": "reference_frames_and_synthetic_vertical_shifts",
                     "synthetic_shifts_canonical_px": shifts, "sample_weight": "participant_class_trial_balanced",
                     "labels": "guided_task_not_ground_truth", "seed": 7},
        "valid_training_frame_labels": {"neutral": labels[0], "deviation": labels[1]},
        "capture_diagnostics": diagnostics, "folds": folds, "summary": summary,
        "all_data_candidate": {"config": config, "threshold": threshold,
                               "threshold_status": "display_only_not_selected_or_validated",
                               "frames": frames, "training_views": frames * TOTAL_VIEWS,
                               "corrector_source": "hash_verified_prior_full_data_corrector",
                               "status": "no_independent_test_for_full_data_model"},
        "limitations": [
            "Participant identity and guided labels may be unverified; group leakage remains possible.",
            "The fixed threshold is not calibrated and was not selected on held-out groups.",
            "The full-data candidate has no independent test; held-out folds evaluate the procedure.",
            "Adjacent frames and 100 synthetic views are correlated, not independent people or trials.",
            "The dataset does not establish real-world false alarms, onset latency or chair-motion correction.",
        ],
    }
    return report, prior_corrector, classifier


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--prior-dir", required=True, help="trusted previous 25x result directory")
    parser.add_argument("--output", required=True, help="new private output directory outside Git")
    parser.add_argument("--checkpoint-dir", help="trusted private directory for resumable training")
    parser.add_argument("--allow-unverified-identities", action="store_true")
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    try:
        output = private_destination(args.output)
        if output.exists():
            raise ValueError("output must not exist")
        prior_dir = private_destination(args.prior_dir)
        prior_report_path = prior_dir / "report.json"
        prior_report_hash = hashlib.sha256(prior_report_path.read_bytes()).hexdigest()
        corrector, classifier, prior = load_models(prior_dir)
        catalog_path = Path(args.catalog)
        catalog_hash = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
        catalog, loaded = load_catalog(catalog_path, args.allow_unverified_identities)
        identity_reviewed = catalog.get("identity_reviewed") is True
        verify_prior(prior, corrector, classifier, loaded, identity_reviewed, catalog_hash)
        try:
            revision = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                                      text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            revision = "unknown"
        fingerprint_data = {"catalog_sha256": catalog_hash, "prior_report_sha256": prior_report_hash,
                            "code_sha256": current_hashes(), "identity_reviewed": identity_reviewed,
                            "python": sys.version.split()[0], "numpy": np.__version__,
                            "scikit_learn": sklearn.__version__, "joblib": joblib.__version__}
        fingerprint = hashlib.sha256(json.dumps(fingerprint_data, sort_keys=True).encode()).hexdigest()
        checkpoint = Checkpoint(args.checkpoint_dir, fingerprint) if args.checkpoint_dir else None

        def progress(stage, completed, total):
            if stage.endswith("_cached") or completed == 1 or completed == total or completed % 5 == 0:
                print(f"{stage}: {completed}/{total}", flush=True)

        report, model_corrector, model_classifier = experiment(
            loaded, identity_reviewed, prior, corrector, classifier, catalog_hash,
            prior_report_hash, revision, workers=args.workers, checkpoint=checkpoint, progress=progress)
        if (hashlib.sha256(catalog_path.read_bytes()).hexdigest() != catalog_hash
                or hashlib.sha256(prior_report_path.read_bytes()).hexdigest() != prior_report_hash):
            raise ValueError("catalog or prior report changed during evaluation")
        load_catalog(catalog_path, args.allow_unverified_identities)
        load_models(prior_dir)
        report["catalog_sha256"] = catalog_hash
        report["source_integrity_rechecked"] = True
        save(output, report, model_corrector, model_classifier)
        print(f"Completed {report['participants']} provisional participant folds; "
              f"identity_reviewed={report['identity_reviewed']}.")
        for method in ("augmented_25x", "augmented_100x"):
            value = report["summary"][method]["frame"]["participant_mean_balanced_accuracy"]
            print(f"{method} participant mean frame balanced accuracy: {value:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"Frame 100x holdout failed: {type(exc).__name__}. Check the private inputs and settings.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
