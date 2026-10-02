"""Small standard-library softmax baseline and train-only sequence perturbations."""

import math
import random
import statistics
from collections import Counter


def temporal_features(times, sequence):
    """Mean, population SD and least-squares slope/second for each of three deltas."""
    if len(times) != len(sequence) or len(times) < 2 or any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError("Strictly increasing observed times are required")
    if any(len(row) != 3 or not all(math.isfinite(v) for v in row) for row in sequence):
        raise ValueError("Three finite pose deltas are required")
    seconds = [(t - times[0]) / 1000 for t in times]
    centered = [t - statistics.fmean(seconds) for t in seconds]
    denominator = sum(t * t for t in centered)
    result = []
    for column in zip(*sequence):
        mean = statistics.fmean(column)
        result.extend((mean, statistics.pstdev(column), sum(t * (v - mean) for t, v in zip(centered, column)) / denominator))
    return result


def sequence(window):
    observations = window["observations"]
    return [o["elapsed_ms"] for o in observations], [o["features"] for o in observations]


def augmentation_scales(train):
    if not train or any(w["split_role"] != "train" for w in train):
        raise ValueError("Only training windows may fit augmentation statistics")
    by_class = {}
    for window in train:
        by_class.setdefault(window["label"], []).extend(sequence(window)[1])
    squared = [0., 0., 0.]
    count = 0
    for rows in by_class.values():
        means = [statistics.fmean(col) for col in zip(*rows)]
        for row in rows:
            count += 1
            for j in range(3):
                squared[j] += (row[j] - means[j]) ** 2
    return [math.sqrt(value / count) for value in squared]


def training_examples(train, settings, seed):
    scales = augmentation_scales(train)
    rng = random.Random(seed)
    examples = []
    for window in train:
        times, rows = sequence(window)
        examples.append({"features": temporal_features(times, rows), "label": window["label"], "source_window_id": window["window_id"], "synthetic": False})
        for _ in range(settings["copies"]):
            # Keep chronology, label and source identity. No left/right mirroring or time warping.
            multiplier = [max(.8, min(1.2, rng.gauss(1, settings["scale_sd"]))) for _ in scales]
            offset = [rng.gauss(0, settings["offset_sd"] * sd) for sd in scales]
            perturbed = [[v * multiplier[j] + offset[j] + rng.gauss(0, settings["jitter_sd"] * scales[j]) for j, v in enumerate(row)] for row in rows]
            examples.append({"features": temporal_features(times, perturbed), "label": window["label"], "source_window_id": window["window_id"], "synthetic": True})
    return examples, scales


def fit_scaler(original_examples):
    if not original_examples or any(e["synthetic"] for e in original_examples):
        raise ValueError("Scaler uses original training examples only")
    columns = list(zip(*(e["features"] for e in original_examples)))
    return {"means": [statistics.fmean(c) for c in columns], "scales": [statistics.pstdev(c) or 1. for c in columns]}


def standardize(features, scaler):
    return [(v - mean) / sd for v, mean, sd in zip(features, scaler["means"], scaler["scales"])]


def probabilities(features, weights):
    scores = [sum(v * w for v, w in zip(features + [1.], row)) for row in weights]
    maximum = max(scores)
    exp = [math.exp(s - maximum) for s in scores]
    total = sum(exp)
    return [v / total for v in exp]


def fit(examples, classes, scaler, optimizer):
    weights = [[0.] * (len(scaler["means"]) + 1) for _ in classes]
    counts = Counter(e["label"] for e in examples)
    if set(counts) != set(classes):
        raise ValueError("All classes must have training examples")
    rows = [(standardize(e["features"], scaler), classes.index(e["label"]), 1 / (len(classes) * counts[e["label"]])) for e in examples]
    for _ in range(optimizer["epochs"]):
        gradient = [[0.] * len(weights[0]) for _ in classes]
        for values, target, contribution in rows:
            predicted = probabilities(values, weights)
            for k, p in enumerate(predicted):
                error = (p - (k == target)) * contribution
                for j, value in enumerate(values + [1.]):
                    gradient[k][j] += error * value
        for k in range(len(classes)):
            for j in range(len(weights[k])):
                regularization = optimizer["l2"] * weights[k][j] if j < len(weights[k]) - 1 else 0
                weights[k][j] -= optimizer["learning_rate"] * (gradient[k][j] + regularization)
    if not all(math.isfinite(v) for row in weights for v in row):
        raise ValueError("Optimization diverged")
    return weights


def evaluate(windows, classes, scaler, weights):
    matrix = [[0 for _ in classes] for _ in classes]
    predictions = []
    for window in windows:
        times, rows = sequence(window)
        p = probabilities(standardize(temporal_features(times, rows), scaler), weights)
        predicted = max(range(len(p)), key=p.__getitem__)
        actual = classes.index(window["label"])
        matrix[actual][predicted] += 1
        predictions.append({"window_id": window["window_id"], "capture_id": window["capture_id"], "label": classes[actual], "predicted": classes[predicted]})
    f1, recalls = [], []
    for k in range(len(classes)):
        tp = matrix[k][k]
        support = sum(matrix[k])
        predicted = sum(row[k] for row in matrix)
        f1.append(2 * tp / (support + predicted) if support + predicted else 0.)
        recalls.append(tp / support if support else 0.)
    total = sum(map(sum, matrix))
    return {
        "windows": total, "accuracy": sum(matrix[k][k] for k in range(len(classes))) / total,
        "macro_f1": statistics.fmean(f1), "balanced_accuracy": statistics.fmean(recalls),
        "class_recall": dict(zip(classes, recalls)), "confusion_matrix": matrix,
        "confusion_axis": "rows=actual; columns=predicted", "classes": classes,
        "predictions": predictions,
    }
