"""Compare 5-view and 25-view training on unmodified held-out participants."""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import platform
import sys

import joblib
import lightgbm
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier

from .augment import JITTER_STD, SEED, augment_training, fit_augmented, select_augmented, summarize
from .evaluate import scores_and_metrics, training_weights
from .replay import load_catalog, prepare_capture, private_destination
from .trees import TREE_CONFIGS, fit_tree, predict_tree, select_tree


EXTRA_VIEWS = 20
TOTAL_VIEWS = 25


def augment_25_views(windows, forbidden_participants=()):
    """Keep the original 5-view recipe and add 20 independent mild jitters."""
    base_x, _, _ = augment_training(windows, forbidden_participants)
    count = len(windows)
    original = base_x[:count]
    reflected = base_x[count:2 * count]
    rng = np.random.default_rng(SEED + 1)
    views = [base_x]
    for index in range(EXTRA_VIEWS):
        reference = original if index % 2 == 0 else reflected
        noise = np.clip(rng.normal(size=original.shape), -2, 2) * JITTER_STD
        views.append(reference + noise)
    labels = np.tile(np.asarray([w.label for w in windows], dtype=int), TOTAL_VIEWS)
    weights = np.tile(training_weights(windows) / TOTAL_VIEWS, TOTAL_VIEWS)
    return np.concatenate(views), labels, weights


def fit_25_views(kind, config, windows, forbidden_participants=()):
    if {w.label for w in windows} != {0, 1}:
        raise ValueError("both classes are required in the training fold")
    x, y, weights = augment_25_views(windows, forbidden_participants)
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


def experiment(loaded, identity_reviewed, revision="unknown"):
    people = sorted({person for person, _, _ in loaded})
    if len(people) < 3:
        raise ValueError("at least three participant groups are required")
    folds, models, diagnostics = [], {}, {}
    for held in people:
        # The participant split is made before any training-window augmentation.
        train_people = set(people) - {held}
        groups = defaultdict(list)
        for person, digest, data in loaded:
            windows, counts = prepare_capture(person, digest[:16], data)
            groups[person].extend(windows)
            diagnostics.setdefault(digest, counts)
        if any({w.label for w in groups[p]} != {0, 1} for p in people):
            raise ValueError("each participant needs usable windows in both classes")
        training = {p: groups[p] for p in sorted(train_people)}
        train = [w for p in sorted(train_people) for w in training[p]]
        test = groups[held]
        fold = {"test_participant": held, "training_participants": sorted(train_people),
                "original_training_windows": len(train), "training_views_5x": len(train) * 5,
                "training_views_25x": len(train) * TOTAL_VIEWS,
                "untouched_test_windows": len(test), "models": {}}
        for kind in TREE_CONFIGS:
            original_config, original_threshold = select_tree(kind, training)
            original = fit_tree(kind, original_config, train)
            fold["models"][kind + "_original"] = {"config": dict(original_config), "threshold": original_threshold,
                **scores_and_metrics(test, predict_tree(original, test), original_threshold)}
            # Choose model parameters and threshold only within the 5-view training groups.
            config, threshold = select_augmented(kind, training, {held})
            model_5 = fit_augmented(kind, config, train, {held})
            model_25 = fit_25_views(kind, config, train, {held})
            for label, model in (("5x", model_5), ("25x", model_25)):
                fold["models"][kind + "_" + label] = {"config": dict(config), "threshold": threshold,
                    **scores_and_metrics(test, predict_tree(model, test), threshold)}
            models[(held, kind)] = model_25
        folds.append(fold)
    keys = [kind + suffix for kind in TREE_CONFIGS for suffix in ("_original", "_5x", "_25x")]
    summary = {key: summarize([fold["models"][key] for fold in folds]) for key in keys}
    full_groups = defaultdict(list)
    for person, digest, data in loaded:
        windows, _ = prepare_capture(person, digest[:16], data)
        full_groups[person].extend(windows)
    full_train = [w for p in people for w in full_groups[p]]
    candidates = {}
    for kind in TREE_CONFIGS:
        config, threshold = select_augmented(kind, full_groups)
        models[("all-data", kind)] = fit_25_views(kind, config, full_train)
        candidates[kind] = {"config": dict(config), "threshold": threshold,
                            "status": "no_independent_test_for_full_data_model"}
    code_hash = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob("*.py")}
    report = {"schema_version": "replay-pilot-augmentation-50k-v1", "identity_reviewed": identity_reviewed,
              "purpose": "exploratory_weak_label_pilot", "participants": len(people), "captures": len(loaded),
              "input_sha256": sorted(d for _, d, _ in loaded), "code_revision": revision, "code_sha256": code_hash,
              "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                              "numpy": np.__version__, "scikit_learn": sklearn.__version__,
                              "lightgbm": lightgbm.__version__, "joblib": joblib.__version__},
              "settings": {"outer_split": "leave_one_participant_out", "inner_split": "leave_one_training_participant_out",
                           "train_only_augmentation": True, "augmentation_seed": SEED, "extra_jitter_seed": SEED + 1,
                           "views_per_original": TOTAL_VIEWS, "derived_views_per_original": TOTAL_VIEWS - 1,
                           "five_view_prefix": "same original 5-view augmentation recipe",
                           "additional_views": "20 clipped noise views; half are horizontally reflected",
                           "jitter_standard_deviation": JITTER_STD.tolist(), "jitter_clip_standard_deviations": 2,
                           "model_selection": "nested training participants on 5x only; same config/threshold applied to 5x and 25x",
                           "sample_weight": "original total weight shared by its views", "tree_config_candidates": TREE_CONFIGS,
                           "features": ["head_gap_delta", "lateral_offset_delta", "shoulder_tilt_delta",
                                        "face_height_delta", "shoulder_height_delta", "shoulder_width_ratio_delta"]},
              "capture_diagnostics": diagnostics, "folds": folds, "summary": summary,
              "all_data_original_windows": len(full_train), "all_data_training_views": len(full_train) * TOTAL_VIEWS,
              "all_data_candidates": candidates,
              "limitations": ["Guided task labels and participant identity are not necessarily verified.",
                              "Synthetic feature views are correlated and are not new people or real recordings.",
                              "Small noise and reflection may alter labels; physical realism is not established.",
                              "No automatic chair-motion compensation is implemented or tested.",
                              "v8 omits transitions and everyday work, so real-world false-alarm rate and onset latency cannot be measured.",
                              "All-data models have no independent test and must not be deployed as validated models."]}
    return report, models


def save_outputs(output, report, models):
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    artifacts = {}
    for (fold, kind), model in models.items():
        if kind == "random_forest":
            name = f"{fold}-25x-random-forest.joblib"
            joblib.dump(model, output / name)
        else:
            name = f"{fold}-25x-lightgbm.txt"
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
        initial_catalog_hash = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
        catalog, loaded = load_catalog(catalog_path, args.allow_unverified_identities)
        report, models = experiment(loaded, catalog.get("identity_reviewed") is True, args.revision)
        if hashlib.sha256(catalog_path.read_bytes()).hexdigest() != initial_catalog_hash:
            raise ValueError("catalog changed during experiment")
        load_catalog(catalog_path, args.allow_unverified_identities)
        report["source_integrity_rechecked"] = True
        save_outputs(output, report, models)
        print(f"Participant groups: {report['participants']}; identity_reviewed={report['identity_reviewed']}")
        print(f"All-data training: {report['all_data_original_windows']} original windows, {report['all_data_training_views']} views.")
        for name, metrics in report["summary"].items():
            print(f"{name}: {metrics['participant_mean_window_balanced_accuracy']:.3f}")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"Augmentation pilot failed: {type(exc).__name__}. Check the private inputs and output location.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
