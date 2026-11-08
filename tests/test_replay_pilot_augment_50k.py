"""Synthetic tests for 25-view, participant-separated augmentation."""

import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import joblib
import lightgbm
import numpy as np

from model.analysis.replay_pilot.augment import JITTER_STD, augment_training
from model.analysis.replay_pilot.augment_50k import TOTAL_VIEWS, TREE_CONFIGS, augment_25_views, experiment, save_outputs
from model.analysis.replay_pilot.evaluate import training_weights
from model.analysis.replay_pilot.replay import prepare_capture
from model.analysis.replay_pilot.trees import predict_tree
from test_replay_pilot import capture


SMALL_CONFIGS = {
    "random_forest": ({"n_estimators": 5, "max_depth": 3, "min_samples_leaf": 2},),
    "lightgbm": ({"n_estimators": 5, "max_depth": 3, "num_leaves": 7, "min_child_samples": 2},),
}


class Augmentation50kTest(unittest.TestCase):
    def setUp(self):
        self.loaded = [(f"P{i + 1:03d}", str(i) * 64, capture(f"synthetic-person-{i}", .05 + i * .01))
                       for i in range(3)]
        self.windows, _ = prepare_capture(*self.loaded[0])

    def test_25_views_are_deterministic_bounded_and_preserve_originals(self):
        original = copy.deepcopy(self.windows)
        base, _, _ = augment_training(self.windows, {"P999"})
        x, y, weights = augment_25_views(self.windows, {"P999"})
        x2, y2, weights2 = augment_25_views(self.windows, {"P999"})
        n = len(self.windows)
        self.assertEqual(x.shape, (TOTAL_VIEWS * n, 6))
        np.testing.assert_array_equal(x[:5*n], base)
        np.testing.assert_array_equal(x, x2)
        np.testing.assert_array_equal(y, y2)
        np.testing.assert_array_equal(weights, weights2)
        for index in range(20):
            reference = base[:n] if index % 2 == 0 else base[n:2*n]
            derived = x[(5 + index)*n:(6 + index)*n]
            self.assertTrue(np.all(np.abs(derived - reference) <= 2 * JITTER_STD + 1e-12))
        np.testing.assert_allclose(weights.reshape(TOTAL_VIEWS, n).sum(axis=0), training_weights(self.windows))
        for i in range(TOTAL_VIEWS):
            np.testing.assert_array_equal(y[i*n:(i+1)*n], [w.label for w in self.windows])
        self.assertEqual(self.windows, original)

    def test_excluded_participant_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "validation or test"):
            augment_25_views(self.windows, {"P001"})

    def test_grouped_comparison_and_model_round_trip(self):
        with patch.dict(TREE_CONFIGS, SMALL_CONFIGS, clear=True):
            report, models = experiment(self.loaded, False, "synthetic")
        self.assertEqual(report["participants"], 3)
        self.assertEqual(report["all_data_training_views"], report["all_data_original_windows"] * 25)
        self.assertEqual(len(report["folds"]), 3)
        for fold in report["folds"]:
            self.assertNotIn(fold["test_participant"], fold["training_participants"])
            self.assertEqual(fold["training_views_25x"], fold["original_training_windows"] * 25)
            original_test, _ = prepare_capture(*self.loaded[int(fold["test_participant"][1:]) - 1])
            self.assertEqual(fold["untouched_test_windows"], len(original_test))
            for kind in TREE_CONFIGS:
                a, b = fold["models"][kind + "_5x"], fold["models"][kind + "_25x"]
                self.assertEqual((a["config"], a["threshold"]), (b["config"], b["threshold"]))
        with tempfile.TemporaryDirectory(prefix="posegood-25x-synthetic-") as temporary:
            output = Path(temporary) / "results"
            save_outputs(output, report, models)
            forest = joblib.load(output / "all-data-25x-random-forest.joblib")
            np.testing.assert_allclose(predict_tree(forest, self.windows), predict_tree(models[("all-data", "random_forest")], self.windows))
            booster = lightgbm.Booster(model_file=str(output / "all-data-25x-lightgbm.txt"))
            np.testing.assert_allclose(booster.predict(np.asarray([w.features for w in self.windows]), num_threads=1),
                                       predict_tree(models[("all-data", "lightgbm")], self.windows))


if __name__ == "__main__":
    unittest.main()
