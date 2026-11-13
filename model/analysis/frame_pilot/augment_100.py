"""Extend the existing 25-view RF augmentation to 100 views per frame."""

import numpy as np
from sklearn.ensemble import RandomForestClassifier

from model.analysis.replay_pilot.evaluate import training_weights

from .augment import JITTER_STD, SEED, TOTAL_VIEWS as BASE_VIEWS, augment_25_views


TOTAL_VIEWS = 100


def augment_100_views(samples, forbidden_participants=()):
    """Retain the 25-view recipe, then add 75 of the same bounded jitters.

    The forest consumes float32 features; preallocating that dtype keeps the
    100-view matrix compact while preserving the forest's actual input values.
    Each original sample and all its views retain its original total weight.
    """
    base, _, _ = augment_25_views(samples, forbidden_participants)
    count = len(samples)
    original, reflected = base[:count], base[count:2 * count]
    views = np.empty((TOTAL_VIEWS * count, 6), dtype=np.float32)
    views[:BASE_VIEWS * count] = base
    rng = np.random.default_rng(SEED + 1)
    for index in range(TOTAL_VIEWS - 5):
        noise = rng.normal(size=original.shape)
        if index < 20:
            continue  # Advance past the 20 jitters already included in base.
        np.clip(noise, -2, 2, out=noise)
        noise *= JITTER_STD
        source = original if index % 2 == 0 else reflected
        start = (5 + index) * count
        views[start:start + count] = source + noise
    labels = np.tile(np.asarray([sample.label for sample in samples], dtype=int), TOTAL_VIEWS)
    weights = np.tile(training_weights(samples) / TOTAL_VIEWS, TOTAL_VIEWS)
    return views, labels, weights


def fit_100_views(samples, config, forbidden_participants=()):
    if {sample.participant for sample in samples} & set(forbidden_participants):
        raise ValueError("validation or test participant in classifier training")
    if {sample.label for sample in samples} != {0, 1}:
        raise ValueError("both classes are required in each training fold")
    x, y, weights = augment_100_views(samples, forbidden_participants)
    model = RandomForestClassifier(**config, random_state=7, n_jobs=1)
    model.fit(x, y, sample_weight=weights)
    return model
