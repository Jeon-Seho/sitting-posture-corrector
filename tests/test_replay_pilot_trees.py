"""Synthetic participant-held-out tests for offline tree comparisons."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import joblib
import lightgbm
import numpy as np

from model.analysis.replay_pilot.trees import (
    TREE_CONFIGS, predict_tree, save_report_and_models, tree_experiment,
)
from model.analysis.replay_pilot.replay import prepare_capture
from test_replay_pilot import capture


SMALL_CONFIGS = {
    "random_forest": ({"n_estimators": 5, "max_depth": 3, "min_samples_leaf": 2},),
    "lightgbm": ({"n_estimators": 5, "max_depth": 3, "num_leaves": 7, "min_child_samples": 2},),
}


class TreePilotTest(unittest.TestCase):
    def test_synthetic_nested_participant_comparison_and_saved_models(self):
        loaded = [(f"P{i + 1:03d}", str(i) * 64, capture(f"synthetic-person-{i}", .05 + i * .01))
                  for i in range(3)]
        with patch.dict(TREE_CONFIGS, SMALL_CONFIGS, clear=True):
            report, models = tree_experiment(loaded, False, "synthetic-revision")
        self.assertEqual(len(report["folds"]), 3)
        self.assertEqual(len(models), 8)
        for fold in report["folds"]:
            self.assertNotIn(fold["test_participant"], fold["training_participants"])
            self.assertEqual(len(fold["training_participants"]), 2)
            for kind in SMALL_CONFIGS:
                self.assertIsNotNone(fold["models"][kind]["window"]["balanced_accuracy"])
        self.assertEqual(set(report["summary"]),
                         {"B0_fixed", "B0_tuned", "B1_three", "B1_extended", "random_forest", "lightgbm"})
        self.assertIn("no_independent_test", report["all_data_candidates"]["random_forest"]["status"])
        self.assertNotIn("synthetic-person", json.dumps(report))
        windows, _ = prepare_capture(*loaded[0])
        with tempfile.TemporaryDirectory(prefix="posegood-tree-synthetic-") as temporary:
            output = Path(temporary) / "result"
            save_report_and_models(output, report, models)
            self.assertEqual(len(json.loads((output / "report.json").read_text(encoding="utf-8"))["model_artifact_sha256"]), 8)
            forest = joblib.load(output / "all-data-random-forest.joblib")
            np.testing.assert_allclose(predict_tree(forest, windows),
                                       predict_tree(models[("all-data", "random_forest")], windows))
            booster = lightgbm.Booster(model_file=str(output / "all-data-lightgbm.txt"))
            self.assertEqual(booster.num_feature(), 6)
            inputs = np.asarray([w.features for w in windows])
            np.testing.assert_allclose(booster.predict(inputs, num_threads=1),
                                       predict_tree(models[("all-data", "lightgbm")], windows))


if __name__ == "__main__":
    unittest.main()
