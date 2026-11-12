"""Synthetic leakage, augmentation and held-out evaluation tests."""

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import joblib
import lightgbm
import numpy as np

from model.analysis.replay_pilot.augment import (
    COPIES, JITTER_STD, TREE_CONFIGS, augment_training, experiment, save_outputs,
)
from model.analysis.replay_pilot.evaluate import training_weights
from model.analysis.replay_pilot.replay import prepare_capture
from model.analysis.replay_pilot.trees import predict_tree
from test_replay_pilot import capture


SMALL_CONFIGS = {
    "random_forest": ({"n_estimators": 5, "max_depth": 3, "min_samples_leaf": 2},),
    "lightgbm": ({"n_estimators": 5, "max_depth": 3, "num_leaves": 7, "min_child_samples": 2},),
}


class AugmentationPilotTest(unittest.TestCase):
    def setUp(self):
        self.loaded = [(f"P{i + 1:03d}", str(i) * 64, capture(f"synthetic-person-{i}", .05 + .01 * i))
                       for i in range(3)]
        self.windows, _ = prepare_capture(*self.loaded[0])

    def test_augmentation_is_bounded_repeatable_and_preserves_weights(self):
        original = copy.deepcopy(self.windows)
        x, y, weights = augment_training(self.windows, {"P999"})
        x2, y2, weights2 = augment_training(self.windows, {"P999"})
        n = len(self.windows)
        self.assertEqual(x.shape, (n * (COPIES + 1), 6))
        np.testing.assert_array_equal(x, x2)
        np.testing.assert_array_equal(y, y2)
        np.testing.assert_array_equal(weights, weights2)
        np.testing.assert_allclose(x[:n], [w.features for w in self.windows])
        np.testing.assert_allclose(x[n:2*n, [0, 3, 4, 5]], x[:n, [0, 3, 4, 5]])
        np.testing.assert_allclose(x[n:2*n, [1, 2]], -x[:n, [1, 2]])
        for start, reference in ((2, x[:n]), (3, x[:n]), (4, x[n:2*n])):
            self.assertTrue(np.all(np.abs(x[start*n:(start+1)*n] - reference) <= 2 * JITTER_STD + 1e-12))
        np.testing.assert_allclose(weights.reshape(COPIES + 1, n).sum(axis=0), training_weights(self.windows))
        for block in range(COPIES + 1):
            np.testing.assert_array_equal(y[block*n:(block+1)*n], [w.label for w in self.windows])
        self.assertEqual(self.windows, original)

    def test_forbidden_participant_cannot_enter_augmentation(self):
        with self.assertRaisesRegex(ValueError, "validation or test"):
            augment_training(self.windows, {"P001"})

    def test_nested_folds_score_original_windows_and_saved_model_loads(self):
        with patch.dict(TREE_CONFIGS, SMALL_CONFIGS, clear=True):
            report, models = experiment(self.loaded, False, "synthetic")
        self.assertEqual(len(report["folds"]), 3)
        self.assertFalse(report["identity_reviewed"])
        for fold in report["folds"]:
            self.assertNotIn(fold["test_participant"], fold["training_participants"])
            expected, _ = prepare_capture(*self.loaded[int(fold["test_participant"][1:]) - 1])
            self.assertEqual(fold["untouched_test_windows"], len(expected))
            self.assertEqual(fold["generated_training_windows"], fold["original_training_windows"] * COPIES)
            self.assertEqual(set(fold["models"]), {"random_forest_original", "random_forest_augmented", "lightgbm_original", "lightgbm_augmented"})
        self.assertNotIn("synthetic-person", json.dumps(report))
        self.assertIn("no_independent_test", report["all_data_candidates"]["random_forest"]["status"])
        with tempfile.TemporaryDirectory(prefix="posegood-aug-synthetic-") as temporary:
            output = Path(temporary) / "result"
            save_outputs(output, report, models)
            restored = joblib.load(output / "all-data-augmented-random-forest.joblib")
            np.testing.assert_allclose(predict_tree(restored, self.windows),
                                       predict_tree(models[("all-data", "random_forest")], self.windows))
            booster = lightgbm.Booster(model_file=str(output / "all-data-augmented-lightgbm.txt"))
            inputs = np.asarray([w.features for w in self.windows])
            np.testing.assert_allclose(booster.predict(inputs, num_threads=1),
                                       predict_tree(models[("all-data", "lightgbm")], self.windows))


if __name__ == "__main__":
    unittest.main()
