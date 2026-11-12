"""The prior 25-view feature recipe, independent of LightGBM.

Keep this small recipe local so the historical replay experiment and its
recorded code hashes remain unchanged. A parity test checks both recipes.
"""

import numpy as np

from model.analysis.replay_pilot.evaluate import training_weights


SEED = 20261108
JITTER_STD = np.asarray([.005, .005, .002, .004, .004, .005])
TOTAL_VIEWS = 25


def augment_25_views(samples, forbidden_participants=()):
    if not samples:
        raise ValueError("training frames are required")
    if {sample.participant for sample in samples} & set(forbidden_participants):
        raise ValueError("validation or test participant in augmentation input")
    original = np.asarray([sample.features for sample in samples], dtype=float)
    if original.ndim != 2 or original.shape[1] != 6 or not np.isfinite(original).all():
        raise ValueError("expected six finite features")
    reflected = original.copy()
    reflected[:, (1, 2)] *= -1
    rng = np.random.default_rng(SEED)
    noises = [np.clip(rng.normal(size=original.shape), -2, 2) * JITTER_STD for _ in range(3)]
    views = [original, reflected, original + noises[0], original + noises[1], reflected + noises[2]]
    rng = np.random.default_rng(SEED + 1)
    for index in range(20):
        reference = original if index % 2 == 0 else reflected
        noise = np.clip(rng.normal(size=original.shape), -2, 2) * JITTER_STD
        views.append(reference + noise)
    labels = np.tile(np.asarray([sample.label for sample in samples], dtype=int), TOTAL_VIEWS)
    weights = np.tile(training_weights(samples) / TOTAL_VIEWS, TOTAL_VIEWS)
    return np.concatenate(views), labels, weights
