"""Participant separation and augmentation evaluation on synthetic data only."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from model.analysis.frame_pilot import holdout
from model.analysis.frame_pilot.artifacts import load_models
from model.analysis.frame_pilot.data import prepare_capture
from model.analysis.frame_pilot.train import candidate_only
from test_model_frame_pilot import short_capture


SMALL_CLASSIFIER = {"n_estimators": 3, "max_depth": 3, "min_samples_leaf": 1}
SMALL_CORRECTOR = {"n_estimators": 2, "max_depth": 3, "min_samples_leaf": 1}


def synthetic_captures(include_incomplete=True):
    loaded = [(f"P{i:03d}", str(i) * 64, short_capture(f"synthetic-{i}", .04 + .01 * i))
              for i in range(1, 5)]
    if include_incomplete:
        data = loaded[-1][2]
        data["frames"] = [frame for frame in data["frames"]
                          if frame["phase"] == "registering" or frame["task"] == "neutral"]
    return loaded


class FrameHoldoutTest(unittest.TestCase):
    def test_matrix_metrics_and_single_class_denominators(self):
        result = holdout.matrix_metrics([[7, 3], [2, 8]])
        self.assertEqual(result["accuracy"], .75)
        self.assertEqual(result["balanced_accuracy"], .75)
        self.assertAlmostEqual(result["precision_deviation"], 8 / 11)
        only_reference = holdout.matrix_metrics([[9, 1], [0, 0]])
        self.assertEqual(only_reference["recall_reference"], .9)
        self.assertIsNone(only_reference["balanced_accuracy"])
        self.assertIsNone(only_reference["macro_f1"])

    def test_real_rf_holdout_never_trains_on_excluded_participants(self):
        loaded = synthetic_captures()
        progress = []
        with patch.object(holdout, "fit_corrector", wraps=holdout.fit_corrector) as correctors, \
             patch.object(holdout, "fit_forest", wraps=holdout.fit_forest) as augmented, \
             patch.object(holdout, "fit_original", wraps=holdout.fit_original) as originals:
            report, corrector, classifier = holdout.experiment(
                loaded, False, "synthetic", workers=2, config=SMALL_CLASSIFIER,
                corrector_config=SMALL_CORRECTOR, shifts=(-6., 0., 6.),
                progress=lambda *value: progress.append(value))
        self.assertEqual(len(report["folds"]), 4)
        self.assertEqual(report["summary"]["augmented_25x"]["frame"]["complete_groups"], 3)
        self.assertEqual(report["summary"]["augmented_25x"]["frame"]["single_class_groups"], 1)
        self.assertEqual(report["settings"]["threshold"], .5)
        self.assertEqual(report["settings"]["model_selection"], "fixed_before_evaluation_no_test_tuning")
        self.assertFalse(report["identity_reviewed"])
        for call in correctors.call_args_list:
            training, forbidden = call.args[0], set(call.args[4])
            self.assertFalse({s.participant for s in training} & forbidden)
            self.assertTrue(all(s.label == 0 for s in training))
        for fitted in (augmented, originals):
            for call in fitted.call_args_list:
                training = call.args[0]
                forbidden = set(call.args[2]) if len(call.args) > 2 else set()
                self.assertFalse({s.participant for s in training} & forbidden)
        for fold in report["folds"]:
            self.assertNotIn(fold["test_participant"], fold["training_participants"])
            self.assertFalse(fold["test_frames_augmented"])
            self.assertEqual(fold["augmented_training_views"], fold["training_frames"] * 25)
            left = fold["methods"]["original"]["frame"]
            right = fold["methods"]["augmented_25x"]["frame"]
            self.assertEqual(left["reference_support"], right["reference_support"])
            self.assertEqual(left["deviation_support"], right["deviation_support"])
            self.assertEqual(left["reference_support"] + left["deviation_support"], fold["test_frames"])
        self.assertEqual(corrector.n_features_in_, 7)
        self.assertEqual(list(classifier.classes_), [0, 1])
        _, expected_corrector, expected_classifier = candidate_only(
            loaded, False, "synthetic", config=SMALL_CLASSIFIER,
            corrector_config=SMALL_CORRECTOR, shifts=(-6., 0., 6.))
        np.testing.assert_allclose(corrector.predict([[0.] * 6 + [100.]]),
                                   expected_corrector.predict([[0.] * 6 + [100.]]))
        np.testing.assert_allclose(classifier.predict_proba([[0.] * 6, [.1] * 6]),
                                   expected_classifier.predict_proba([[0.] * 6, [.1] * 6]))
        self.assertIn("frame_pilot/holdout.py", report["code_sha256"])
        self.assertTrue(any(stage == "correctors" and done == total for stage, done, total in progress))
        self.assertTrue(any(stage == "held_out_folds" and done == total for stage, done, total in progress))
        samples, _, _ = prepare_capture("P001", "synthetic", loaded[0][2])
        with self.assertRaisesRegex(ValueError, "participant"):
            holdout.fit_original(samples, SMALL_CLASSIFIER, {"P001"})

    def test_cli_on_synthetic_captures_saves_both_models_and_report(self):
        with tempfile.TemporaryDirectory(prefix="posegood-holdout-synthetic-") as tmp:
            root = Path(tmp)
            source = root / "captures"
            source.mkdir()
            for i in range(1, 5):
                (source / f"{i}.json").write_text(json.dumps(short_capture(f"synthetic-{i}", .04 + .01 * i)),
                                                  encoding="utf-8")
            catalog, output = root / "catalog.json", root / "result"
            created = subprocess.run([sys.executable, "-m", "model.analysis.frame_pilot", "catalog",
                                      "--input", str(source), "--output", str(catalog)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(created.returncode, 0, created.stderr)
            trained = subprocess.run([sys.executable, "-m", "model.analysis.frame_pilot.holdout",
                                      "--catalog", str(catalog), "--output", str(output),
                                      "--allow-unverified-identities", "--workers", "2",
                                      "--classifier-trees", "2", "--corrector-trees", "2"],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(trained.returncode, 0, trained.stderr)
            corrector, classifier, report = load_models(output)
            self.assertEqual(len(report["folds"]), 4)
            self.assertTrue(report["source_integrity_rechecked"])
            self.assertEqual(report["all_data_candidate"]["training_views"],
                             report["all_data_candidate"]["frames"] * 25)
            self.assertEqual(report["all_data_candidate"]["threshold_status"],
                             "display_only_not_selected_or_validated")
            self.assertEqual(len(corrector.estimators_), 2)
            self.assertEqual(len(classifier.estimators_), 2)


if __name__ == "__main__":
    unittest.main()
