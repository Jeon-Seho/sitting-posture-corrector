"""Train-only feature augmentation, evaluated on untouched participant recordings."""

import argparse
from collections import defaultdict
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

from .evaluate import THRESHOLDS, scores_and_metrics, training_weights
from .replay import load_catalog, prepare_capture, private_destination
from .trees import TREE_CONFIGS, fit_tree, predict_tree, select_tree


SEED = 20261108
COPIES = 4
# Feature units are fractions of baseline shoulder width or normalized ratios.
JITTER_STD = np.asarray([.005, .005, .002, .004, .004, .005])


def augment_training(windows, forbidden_participants=()):
    """Four derived training views per original; no test participant is accepted."""
    if not windows:
        raise ValueError("training windows are required")
    if {w.participant for w in windows} & set(forbidden_participants):
        raise ValueError("validation or test participant in augmentation input")
    original = np.asarray([w.features for w in windows], dtype=float)
    if original.ndim != 2 or original.shape[1] != 6 or not np.isfinite(original).all():
        raise ValueError("expected six finite features")
    # A horizontal reflection with left/right landmark identities exchanged
    # negates lateral offset and shoulder tilt, while the other features stay.
    reflected = original.copy()
    reflected[:, (1, 2)] *= -1
    rng = np.random.default_rng(SEED)
    noises = [np.clip(rng.normal(size=original.shape), -2, 2) * JITTER_STD for _ in range(3)]
    views = [original, reflected, original + noises[0], original + noises[1], reflected + noises[2]]
    labels = np.tile(np.asarray([w.label for w in windows], dtype=int), COPIES + 1)
    # Each original plus its views retains its original total sample weight.
    weights = np.tile(training_weights(windows) / (COPIES + 1), COPIES + 1)
    return np.concatenate(views), labels, weights


def fit_augmented(kind, config, windows, forbidden_participants=()):
    from sklearn.ensemble import RandomForestClassifier
    if {w.label for w in windows} != {0, 1}:
        raise ValueError("both classes are needed in every training fold")
    x, y, weights = augment_training(windows, forbidden_participants)
    if kind == "random_forest":
        model = RandomForestClassifier(**config, random_state=7, n_jobs=1)
    elif kind == "lightgbm":
        model = lightgbm.LGBMClassifier(**config, objective="binary", learning_rate=.05,
                                        random_state=7, n_jobs=1, verbosity=-1,
                                        deterministic=True, force_col_wise=True)
    else:
        raise ValueError("unknown model")
    model.fit(x, y, sample_weight=weights)
    return model


def select_augmented(kind, by_person, outer_test=()):
    people = sorted(by_person)
    if set(people) & set(outer_test):
        raise ValueError("outer test participant in inner training groups")
    options = []
    for config_index, config in enumerate(TREE_CONFIGS[kind]):
        predictions = []
        for inner_test in people:
            train = [w for person in people if person != inner_test for w in by_person[person]]
            model = fit_augmented(kind, config, train, set(outer_test) | {inner_test})
            predictions.append((by_person[inner_test], predict_tree(model, by_person[inner_test])))
        for threshold in THRESHOLDS:
            scores = [scores_and_metrics(w, p, threshold)["window"]["balanced_accuracy"] for w, p in predictions]
            if any(score is None for score in scores):
                raise ValueError("each participant needs both classes")
            options.append((statistics.mean(scores), -config_index, -abs(threshold - .5),
                            -threshold, config_index, threshold))
    best = max(options)
    return TREE_CONFIGS[kind][best[-2]], best[-1]


def summarize(items):
    windows = [item["window"]["balanced_accuracy"] for item in items]
    trials = [item["trial_median"]["balanced_accuracy"] for item in items]
    if any(v is None for v in windows + trials):
        raise ValueError("each tested participant must have both classes")
    result = {"participant_mean_window_balanced_accuracy": statistics.mean(windows),
              "participant_min_window_balanced_accuracy": min(windows),
              "participant_max_window_balanced_accuracy": max(windows),
              "participant_mean_trial_balanced_accuracy": statistics.mean(trials)}
    result["three_second_exploratory"] = {
        label: {field: sum(item["three_second_exploratory"][label][field] for item in items)
                for field in ("eligible_trials", "detected_trials")}
        for label in ("neutral", "deviation")
    }
    return result


def experiment(loaded, identity_reviewed, revision="unknown"):
    people = sorted({person for person, _, _ in loaded})
    if len(people) < 3:
        raise ValueError("at least three participant groups are required")
    folds, saved, diagnostics = [], {}, {}
    for held in people:
        # Assign participants before constructing windows or augmenting training.
        train_people = set(people) - {held}
        by_person = defaultdict(list)
        for person, digest, data in loaded:
            windows, counts = prepare_capture(person, digest[:16], data)
            by_person[person].extend(windows)
            diagnostics.setdefault(digest, counts)
        if any({w.label for w in by_person[p]} != {0, 1} for p in people):
            raise ValueError("each participant needs windows in both classes")
        train_groups = {p: by_person[p] for p in sorted(train_people)}
        train = [w for p in sorted(train_people) for w in train_groups[p]]
        test = by_person[held]
        fold = {"test_participant": held, "training_participants": sorted(train_people),
                "original_training_windows": len(train), "generated_training_windows": len(train) * COPIES,
                "untouched_test_windows": len(test), "models": {}}
        for kind in TREE_CONFIGS:
            config, threshold = select_tree(kind, train_groups)
            ordinary = fit_tree(kind, config, train)
            fold["models"][kind + "_original"] = {"config": dict(config), "threshold": threshold,
                **scores_and_metrics(test, predict_tree(ordinary, test), threshold)}
            config, threshold = select_augmented(kind, train_groups, {held})
            augmented = fit_augmented(kind, config, train, {held})
            fold["models"][kind + "_augmented"] = {"config": dict(config), "threshold": threshold,
                **scores_and_metrics(test, predict_tree(augmented, test), threshold)}
            saved[(held, kind)] = augmented
        folds.append(fold)
    summary = {key: summarize([fold["models"][key] for fold in folds])
               for key in ("random_forest_original", "random_forest_augmented", "lightgbm_original", "lightgbm_augmented")}
    # Separate deployment-unready candidates trained on all original participants.
    full_groups = defaultdict(list)
    for person, digest, data in loaded:
        windows, _ = prepare_capture(person, digest[:16], data)
        full_groups[person].extend(windows)
    full_train = [w for p in people for w in full_groups[p]]
    candidates = {}
    for kind in TREE_CONFIGS:
        config, threshold = select_augmented(kind, full_groups)
        saved[("all-data", kind)] = fit_augmented(kind, config, full_train)
        candidates[kind] = {"config": dict(config), "threshold": threshold,
                            "status": "no_independent_test_for_full_data_model"}
    code_hash = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in Path(__file__).parent.glob("*.py")}
    report = {"schema_version": "replay-pilot-augmentation-v1", "identity_reviewed": identity_reviewed,
              "purpose": "exploratory_weak_label_pilot", "participants": len(people), "captures": len(loaded),
              "input_sha256": sorted(d for _, d, _ in loaded), "code_revision": revision, "code_sha256": code_hash,
              "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                              "numpy": np.__version__, "scikit_learn": sklearn.__version__,
                              "lightgbm": lightgbm.__version__, "joblib": joblib.__version__},
              "settings": {"outer_split": "leave_one_participant_out", "inner_split": "leave_one_training_participant_out",
                           "train_only_augmentation": True, "seed": SEED, "derived_views_per_original": COPIES,
                           "transformations": ["horizontal reflection", "jitter A", "jitter B", "reflected jitter"],
                           "jitter_standard_deviation": JITTER_STD.tolist(), "jitter_clip_standard_deviations": 2,
                           "sample_weight": "original total weight shared by its five views",
                           "tree_config_candidates": TREE_CONFIGS, "threshold_candidates": THRESHOLDS,
                           "features": ["head_gap_delta", "lateral_offset_delta", "shoulder_tilt_delta",
                                        "face_height_delta", "shoulder_height_delta", "shoulder_width_ratio_delta"]},
              "capture_diagnostics": diagnostics, "folds": folds, "summary": summary,
              "all_data_candidates": candidates,
              "limitations": ["Guided tasks are weak labels and participant identity has not necessarily been reviewed.",
                              "Synthetic feature views are correlated and are not additional people or real-world recordings.",
                              "Reflection and noise may alter labels in borderline examples; physical plausibility is unverified.",
                              "v8 omits transitions and everyday work; no real-world false-alarm rate or onset latency can be measured.",
                              "Final all-data candidates have no independent held-out test and are not deployed models."]}
    return report, saved


def save_outputs(output, report, models):
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    artifacts = {}
    for (fold, kind), model in models.items():
        if kind == "random_forest":
            name = f"{fold}-augmented-random-forest.joblib"
            joblib.dump(model, output / name)
        else:
            name = f"{fold}-augmented-lightgbm.txt"
            model.booster_.save_model(str(output / name))
        artifacts[name] = hashlib.sha256((output / name).read_bytes()).hexdigest()
    report["model_artifact_sha256"] = artifacts
    with (output / "report.json").open("x", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--allow-unverified-identities", action="store_true")
    parser.add_argument("--revision", default="unknown")
    args = parser.parse_args()
    try:
        output = private_destination(args.output)
        if output.exists():
            raise ValueError("output must not exist")
        if args.revision != "unknown" and (len(args.revision) != 40 or any(c not in "0123456789abcdef" for c in args.revision)):
            raise ValueError("revision must be a full lowercase Git commit")
        catalog_path = Path(args.catalog)
        catalog_hash = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
        catalog, loaded = load_catalog(catalog_path, args.allow_unverified_identities)
        report, models = experiment(loaded, catalog.get("identity_reviewed") is True, args.revision)
        if hashlib.sha256(catalog_path.read_bytes()).hexdigest() != catalog_hash:
            raise ValueError("catalog changed during experiment")
        load_catalog(catalog_path, args.allow_unverified_identities)
        report["source_integrity_rechecked"] = True
        save_outputs(output, report, models)
        print(f"Train-only augmentation: {report['participants']} participant groups, identity_reviewed={report['identity_reviewed']}.")
        for name, metrics in report["summary"].items():
            print(f"{name}: {metrics['participant_mean_window_balanced_accuracy']:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"Augmentation pilot failed: {type(exc).__name__}. Check the private catalog and output location.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
