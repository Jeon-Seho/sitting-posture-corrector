"""Participant-held-out tree baselines for the private v8 replay pilot."""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import statistics
import sys
import warnings

import joblib
import lightgbm
import numpy as np
from sklearn.ensemble import RandomForestClassifier

from .evaluate import THRESHOLDS, experiment, scores_and_metrics, training_weights
from .replay import load_catalog, prepare_capture, private_destination


# A deliberately small search: the independent samples are people, not windows.
TREE_CONFIGS = {
    "random_forest": (
        {"n_estimators": 120, "max_depth": 4, "min_samples_leaf": 10},
        {"n_estimators": 120, "max_depth": 8, "min_samples_leaf": 5},
    ),
    "lightgbm": (
        {"n_estimators": 100, "max_depth": 3, "num_leaves": 7, "min_child_samples": 40},
        {"n_estimators": 100, "max_depth": 4, "num_leaves": 15, "min_child_samples": 20},
    ),
}


def fit_tree(kind, config, windows):
    if {w.label for w in windows} != {0, 1}:
        raise ValueError("both classes are needed in every training fold")
    features = np.asarray([w.features for w in windows], dtype=float)
    labels = np.asarray([w.label for w in windows], dtype=int)
    if kind == "random_forest":
        model = RandomForestClassifier(**config, random_state=7, n_jobs=1)
    elif kind == "lightgbm":
        model = lightgbm.LGBMClassifier(**config, objective="binary", learning_rate=0.05,
                                        random_state=7, n_jobs=1, verbosity=-1,
                                        deterministic=True, force_col_wise=True)
    else:
        raise ValueError("unknown tree model")
    model.fit(features, labels, sample_weight=training_weights(windows))
    return model


def predict_tree(model, windows):
    x = np.asarray([w.features for w in windows], dtype=float)
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="X does not have valid feature names", category=UserWarning)
        return model.predict_proba(x)[:, 1].tolist()


def select_tree(kind, by_person):
    people = sorted(by_person)
    options = []
    for config_index, config in enumerate(TREE_CONFIGS[kind]):
        predictions = []
        for held in people:
            train = [w for person in people if person != held for w in by_person[person]]
            fitted = fit_tree(kind, config, train)
            predictions.append((by_person[held], predict_tree(fitted, by_person[held])))
        for threshold in THRESHOLDS:
            results = [scores_and_metrics(windows, scores, threshold)["window"]["balanced_accuracy"]
                       for windows, scores in predictions]
            if any(result is None for result in results):
                raise ValueError("each participant needs both classes")
            # Equal score: prefer the first, smaller model and a threshold closer to 0.5.
            options.append((statistics.mean(results), -config_index, -abs(threshold - 0.5),
                            -threshold, config_index, threshold))
    best = max(options)
    return TREE_CONFIGS[kind][best[-2]], best[-1]


def tree_experiment(loaded, identity_reviewed, revision="unknown"):
    # Recalculate B0 and B1 on the same inputs, rather than trusting a separate report.
    report, _ = experiment(loaded, identity_reviewed, revision)
    people = sorted({p for p, _, _ in loaded})
    saved = {}
    for fold in report["folds"]:
        held = fold["test_participant"]
        assignments = {p: ("test" if p == held else "train") for p in people}
        by_person = defaultdict(list)
        for person, digest, data in loaded:
            windows, _ = prepare_capture(person, digest[:16], data)
            by_person[person].extend(windows)
        train_groups = {p: by_person[p] for p in people if assignments[p] == "train"}
        train = [w for p in sorted(train_groups) for w in train_groups[p]]
        test = by_person[held]
        for kind in TREE_CONFIGS:
            config, threshold = select_tree(kind, train_groups)
            model = fit_tree(kind, config, train)
            scores = predict_tree(model, test)
            fold["models"][kind] = {"config": dict(config), "threshold": threshold,
                                    **scores_and_metrics(test, scores, threshold)}
            saved[(held, kind)] = model
    for kind in TREE_CONFIGS:
        items = [fold["models"][kind] for fold in report["folds"]]
        window = [item["window"]["balanced_accuracy"] for item in items]
        trial = [item["trial_median"]["balanced_accuracy"] for item in items]
        report["summary"][kind] = {
            "participant_mean_window_balanced_accuracy": statistics.mean(window),
            "participant_min_window_balanced_accuracy": min(window),
            "participant_max_window_balanced_accuracy": max(window),
            "participant_mean_trial_balanced_accuracy": statistics.mean(trial),
        }
    # Separate all-data candidates: selection uses grouped CV, no untouched test remains.
    full_groups = defaultdict(list)
    for person, digest, data in loaded:
        windows, _ = prepare_capture(person, digest[:16], data)
        full_groups[person].extend(windows)
    full_train = [w for p in people for w in full_groups[p]]
    report["all_data_candidates"] = {}
    for kind in TREE_CONFIGS:
        config, threshold = select_tree(kind, full_groups)
        saved[("all-data", kind)] = fit_tree(kind, config, full_train)
        report["all_data_candidates"][kind] = {
            "config": dict(config), "threshold": threshold,
            "status": "exploratory_only_no_independent_test_for_this_fitted_model",
        }
    report["schema_version"] = "replay-pilot-trees-report-v1"
    report["environment"]["lightgbm"] = lightgbm.__version__
    report["environment"]["joblib"] = joblib.__version__
    report["settings"]["tree_config_candidates"] = TREE_CONFIGS
    report["settings"]["tree_features"] = ["head_gap_delta", "lateral_offset_delta", "shoulder_tilt_delta",
                                             "face_height_delta", "shoulder_height_delta", "shoulder_width_ratio_delta"]
    report["settings"]["tree_training"] = "participant/class/trial weighted; random_state=7; one CPU thread"
    report["limitations"].append("All-data candidates have no untouched test set and must not be used as deployed models.")
    return report, saved


def save_report_and_models(output, report, models):
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    artifacts = {}
    for (fold, kind), model in models.items():
        if kind == "random_forest":
            name = f"{fold}-random-forest.joblib"
            joblib.dump(model, output / name)
        else:
            name = f"{fold}-lightgbm.txt"
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
        catalog, loaded = load_catalog(args.catalog, args.allow_unverified_identities)
        report, models = tree_experiment(loaded, catalog.get("identity_reviewed") is True, args.revision)
        save_report_and_models(output, report, models)
        print(f"Exploratory tree comparison: {report['participants']} participant groups, identity_reviewed={report['identity_reviewed']}.")
        for name, values in report["summary"].items():
            print(f"{name}: {values['participant_mean_window_balanced_accuracy']:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        # Private paths and participant names must never be written to logs.
        print(f"Tree pilot failed: {type(exc).__name__}. Check the private catalog and output location.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
