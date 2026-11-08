"""Nested participant-held-out evaluation of rule and logistic baselines."""

from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import platform
import statistics
import sys

import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from .replay import prepare_capture, rule_score


CS = (0.01, 0.1, 1.0, 10.0)
THRESHOLDS = tuple(i / 20 for i in range(2, 19))


def trial_key(window):
    return (window.participant, window.capture, window.trial)


def scores_and_metrics(windows, scores, threshold):
    if len(windows) != len(scores):
        raise ValueError("score count does not match windows")
    confusion = [[0, 0], [0, 0]]
    trials = defaultdict(list)
    chunks = defaultdict(list)
    for window, score in zip(windows, scores):
        predicted = int(score >= threshold)
        confusion[window.label][predicted] += 1
        trials[trial_key(window)].append((window.label, float(score)))
        chunks[(trial_key(window), window.chunk)].append((window.time_ms, predicted))
    trial_confusion = [[0, 0], [0, 0]]
    for rows in trials.values():
        labels = {r[0] for r in rows}
        if len(labels) != 1:
            raise ValueError("a trial crossed a label boundary")
        label = rows[0][0]
        trial_confusion[label][int(statistics.median(r[1] for r in rows) >= threshold)] += 1
    detected = set()
    for (key, _), rows in chunks.items():
        start = last = None
        for t, candidate in sorted(rows):
            if last is not None and t - last > 1500:
                start = None
            if not candidate:
                start = None
            elif start is None:
                start = t
            if start is not None and t - start >= 3000:
                detected.add(key)
            last = t
    episodes = {"neutral": {"eligible_trials": 0, "detected_trials": 0},
                "deviation": {"eligible_trials": 0, "detected_trials": 0}}
    for key, rows in trials.items():
        group = episodes["deviation" if rows[0][0] else "neutral"]
        group["eligible_trials"] += 1
        group["detected_trials"] += int(key in detected)
    def summarize(matrix):
        totals = [sum(row) for row in matrix]
        recalls = [matrix[i][i] / totals[i] if totals[i] else None for i in range(2)]
        return {"confusion_actual_rows_predicted_columns": matrix,
                "recall_reference": recalls[0], "recall_deviation": recalls[1],
                "balanced_accuracy": sum(recalls) / 2 if None not in recalls else None}
    return {"window": summarize(confusion), "trial_median": summarize(trial_confusion),
            "three_second_exploratory": episodes}


def training_weights(windows):
    counts = Counter(trial_key(w) for w in windows)
    trials_by_class = defaultdict(set)
    for w in windows:
        trials_by_class[(w.participant, w.label)].add(trial_key(w))
    weights = [1 / (counts[trial_key(w)] * len(trials_by_class[(w.participant, w.label)])) for w in windows]
    factor = len(weights) / sum(weights)
    return np.asarray(weights, dtype=float) * factor


def fit_model(windows, feature_count, c):
    if {w.label for w in windows} != {0, 1}:
        raise ValueError("each training fold needs both classes")
    x = np.asarray([w.features[:feature_count] for w in windows], dtype=float)
    y = np.asarray([w.label for w in windows], dtype=int)
    weights = training_weights(windows)
    scaler = StandardScaler().fit(x, sample_weight=weights)
    classifier = LogisticRegression(C=c, solver="liblinear", max_iter=1000, random_state=7)
    classifier.fit(scaler.transform(x), y, sample_weight=weights)
    return scaler, classifier


def predict(model, windows, feature_count):
    x = np.asarray([w.features[:feature_count] for w in windows], dtype=float)
    return model[1].predict_proba(model[0].transform(x))[:, 1].tolist()


def select_rule(by_person):
    options = []
    for threshold in THRESHOLDS:
        values = []
        for windows in by_person.values():
            score = scores_and_metrics(windows, [rule_score(w.features) for w in windows], threshold)["window"]["balanced_accuracy"]
            if score is None:
                raise ValueError("each participant needs both labeled classes")
            values.append(score)
        options.append((statistics.mean(values), -abs(threshold - 0.7), -threshold, threshold))
    return max(options)[-1]


def select_logistic(by_person, feature_count):
    people = sorted(by_person)
    candidates = []
    for c in CS:
        held_predictions = []
        for held in people:
            train = [w for p in people if p != held for w in by_person[p]]
            model = fit_model(train, feature_count, c)
            held_predictions.append((by_person[held], predict(model, by_person[held], feature_count)))
        for threshold in THRESHOLDS:
            values = [scores_and_metrics(w, s, threshold)["window"]["balanced_accuracy"] for w, s in held_predictions]
            if any(v is None for v in values):
                raise ValueError("each participant needs both labeled classes")
            candidates.append((statistics.mean(values), -c, -abs(threshold - 0.5), -threshold, c, threshold))
    best = max(candidates)
    return best[-2], best[-1]


def model_parameters(model):
    scaler, classifier = model
    return {"scaler_mean": scaler.mean_.tolist(), "scaler_scale": scaler.scale_.tolist(),
            "coefficient": classifier.coef_[0].tolist(), "intercept": float(classifier.intercept_[0])}


def experiment(loaded, identity_reviewed, revision="unknown"):
    people = sorted({p for p, _, _ in loaded})
    if len(people) < 3:
        raise ValueError("at least three distinct participant groups are required")
    results, parameters, diagnostics = [], {}, {}
    all_by_model = defaultdict(list)
    for held in people:
        # Assign all captures to train or test before creating any time windows.
        assignments = {p: ("test" if p == held else "train") for p in people}
        by_person = defaultdict(list)
        for person, digest, data in loaded:
            if person not in assignments:
                raise ValueError("capture has no participant assignment")
            windows, counts = prepare_capture(person, digest[:16], data)
            by_person[person].extend(windows)
            diagnostics.setdefault(digest, counts)
        if any({w.label for w in by_person[p]} != {0, 1} for p in people):
            raise ValueError("every participant must have usable windows in both classes")
        train_people = {p: by_person[p] for p in people if assignments[p] == "train"}
        train = [w for p in sorted(train_people) for w in train_people[p]]
        test = by_person[held]
        fold = {"test_participant": held, "training_participants": sorted(train_people), "models": {}}
        thresholds = {"B0_fixed": 0.7, "B0_tuned": select_rule(train_people)}
        test_rule = [rule_score(w.features) for w in test]
        for name, threshold in thresholds.items():
            fold["models"][name] = {"threshold": threshold, **scores_and_metrics(test, test_rule, threshold)}
            all_by_model[name].append(fold["models"][name])
        for name, count in (("B1_three", 3), ("B1_extended", 6)):
            c, threshold = select_logistic(train_people, count)
            model = fit_model(train, count, c)
            predicted = predict(model, test, count)
            fold["models"][name] = {"C": c, "threshold": threshold, **scores_and_metrics(test, predicted, threshold)}
            all_by_model[name].append(fold["models"][name])
            parameters[f"{held}_{name}"] = {"C": c, "threshold": threshold, **model_parameters(model)}
        results.append(fold)
    summary = {}
    for name, items in all_by_model.items():
        window = [item["window"]["balanced_accuracy"] for item in items]
        trial = [item["trial_median"]["balanced_accuracy"] for item in items]
        summary[name] = {"participant_mean_window_balanced_accuracy": statistics.mean(window),
                         "participant_min_window_balanced_accuracy": min(window),
                         "participant_max_window_balanced_accuracy": max(window),
                         "participant_mean_trial_balanced_accuracy": statistics.mean(trial)}
    hashes = {}
    for path in Path(__file__).parent.glob("*.py"):
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    report = {"schema_version": "replay-pilot-report-v1", "purpose": "exploratory_weak_label_pilot",
              "identity_reviewed": identity_reviewed, "participants": len(people), "captures": len(loaded),
              "input_sha256": sorted(digest for _, digest, _ in loaded), "code_revision": revision,
              "code_sha256": hashes, "environment": {"python": sys.version.split()[0], "platform": platform.platform(),
                  "numpy": np.__version__, "scikit_learn": sklearn.__version__},
              "settings": {"outer_split": "leave_one_participant_out", "inner_split": "leave_one_training_participant_out",
                  "window_ms": 1000, "min_span_ms": 800, "min_samples": 5, "max_gap_ms": 500,
                  "output_stride_ms_min": 500, "C_candidates": CS, "threshold_candidates": THRESHOLDS,
                  "seed": 7, "labels": "guided_task_not_ground_truth"},
              "capture_diagnostics": diagnostics, "folds": results, "summary": summary,
              "limitations": ["Guided task labels are not verified ground truth.",
                  "v8 omits transitions and everyday work; real-life false-alarm rate and onset latency cannot be measured.",
                  "Scores are not validated probabilities; no service deployment is implied."]}
    return report, parameters


def write_outputs(path, report, parameters):
    path.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, content in (("report.json", report), ("fold-models.json", parameters)):
        with (path / name).open("x", encoding="utf-8") as handle:
            json.dump(content, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
