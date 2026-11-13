"""Synthetic-only checks for the two-stage replay experiment."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import joblib
import numpy as np

from model.analysis.replay_pilot import two_stage
from model.analysis.replay_pilot.augment_50k import fit_25_views
from model.analysis.replay_pilot.evaluate import scores_and_metrics, training_weights
from model.analysis.replay_pilot.replay import prepare_capture
from test_replay_pilot import capture


class TwoStageTest(unittest.TestCase):
    def setUp(self):
        self.loaded = [(f"P{i + 1:03d}", str(i) * 64, capture(f"synthetic-person-{i}", .05 + i * .01))
                       for i in range(3)]
        self.groups, self.spans, _ = two_stage.make_groups(self.loaded)
        self.reference = [w for w in self.groups["P001"] if w.label == 0]

    def test_reference_only_augmentation_preserves_weights_and_excludes_test_person(self):
        originals = copy.deepcopy(self.reference)
        with patch.object(two_stage, "TRAIN_SHIFTS", (-6.0, 0.0, 6.0)):
            x, target, weights = two_stage.correction_training_views(self.reference, self.spans, {"P999"})
        n = len(self.reference)
        original_x = np.asarray([w.features for w in self.reference])
        self.assertEqual(x.shape, (3 * n, 7))
        np.testing.assert_allclose(x[n:2*n, :6], original_x)
        np.testing.assert_allclose(x[:n, 4] - original_x[:, 4], -6 / x[:n, 6])
        np.testing.assert_allclose(x[2*n:, 4] - original_x[:, 4], 6 / x[2*n:, 6])
        np.testing.assert_allclose(target.reshape(3, n)[:, 0], [-6, 0, 6])
        np.testing.assert_allclose(weights.reshape(3, n).sum(axis=0), training_weights(self.reference))
        self.assertEqual(self.reference, originals)
        with self.assertRaisesRegex(ValueError, "validation or test"):
            two_stage.correction_training_views(self.reference, self.spans, {"P001"})
        with self.assertRaisesRegex(ValueError, "guided reference"):
            two_stage.correction_training_views(self.groups["P001"], self.spans)

    def test_translation_does_not_modify_registration_or_original(self):
        source = self.loaded[0][2]
        before = copy.deepcopy(source)
        shifted = two_stage.shift_measurement(source, 14.4)
        self.assertEqual(source, before)
        self.assertEqual(shifted["frames"][0], before["frames"][0])
        index = next(i for i, f in enumerate(source["frames"]) if f["phase"] == "hold")
        self.assertAlmostEqual(shifted["frames"][index]["image"][0]["y"],
                               before["frames"][index]["image"][0]["y"] + .03)
        self.assertEqual(shifted["frames"][index]["world"], before["frames"][index]["world"])

    def test_out_of_frame_is_unmeasurable_before_correction(self):
        source = self.loaded[0][2]
        shifted = two_stage.shift_measurement(source, 480)
        windows, counts = prepare_capture("P001", "synthetic", shifted)
        self.assertEqual(windows, [])
        self.assertGreater(counts["invalid_frames"], 0)
        with self.assertRaisesRegex(ValueError, "at least one window"):
            two_stage.input_matrix(windows, {"synthetic": 128})

    def test_correction_removes_only_the_designated_feature(self):
        windows = self.reference[:2]

        class CheckingClassifier:
            classes_ = [0, 1]

            def predict_proba(self, x):
                original, span = two_stage.input_matrix(windows, self_spans)
                expected = original.copy()
                expected[:, 4] -= 6 / span
                np.testing.assert_allclose(x, expected)
                return np.tile([.7, .3], (len(x), 1))

        self_spans = self.spans
        self.assertEqual(two_stage.scores(CheckingClassifier(), windows, self.spans, [6, 6]), [.3, .3])
        with self.assertRaisesRegex(ValueError, "one finite correction"):
            two_stage.scores(CheckingClassifier(), windows, self.spans, [6])
        with self.assertRaisesRegex(ValueError, "at least one window"):
            two_stage.input_matrix([], self.spans)

    def test_group_separation_scenarios_and_saved_models(self):
        people = sorted(self.groups)
        config = {"n_estimators": 5, "max_depth": 3, "min_samples_leaf": 2}
        threshold = .5
        folds = []
        for held in people:
            train = [w for p in people if p != held for w in self.groups[p]]
            model = fit_25_views("random_forest", config, train, {held})
            windows = self.groups[held]
            outcome = scores_and_metrics(windows, two_stage.scores(model, windows, self.spans,
                                                                   np.zeros(len(windows))), threshold)
            folds.append({"test_participant": held, "training_participants": [p for p in people if p != held],
                          "models": {"random_forest_25x": {"config": config, "threshold": threshold, **outcome}}})
        prior = {"input_sha256": sorted(d for _, d, _ in self.loaded), "folds": folds,
                 "code_sha256": {}, "all_data_candidates": {"random_forest": {"config": config, "threshold": threshold}}}
        params = {"n_estimators": 5, "max_depth": 3, "min_samples_leaf": 2, "random_state": 7, "n_jobs": 1}
        original_data = copy.deepcopy(self.loaded)
        with patch.object(two_stage, "CORRECTOR_CONFIG", params), \
             patch.object(two_stage, "TRAIN_SHIFTS", (-6.0, 0.0, 6.0)), \
             patch.object(two_stage, "TEST_SHIFTS", {"unchanged": 0.0, "down": 6.0}), \
             patch.object(two_stage, "fit_corrector", wraps=two_stage.fit_corrector) as fitted:
            report, classifiers, correctors, corrected_classifiers = two_stage.experiment(self.loaded, prior, False)
        self.assertEqual(self.loaded, original_data)
        two_people_excluded = 0
        for call in fitted.call_args_list:
            training_windows = call.args[0]
            excluded = set(call.args[2]) if len(call.args) > 2 else set()
            self.assertFalse({w.participant for w in training_windows} & excluded)
            self.assertTrue(all(w.label == 0 for w in training_windows))
            two_people_excluded += len(excluded) == 2
        self.assertEqual(two_people_excluded, 3)
        self.assertEqual(report["participants"], 3)
        self.assertFalse(report["identity_reviewed"])
        for fold in report["folds"]:
            self.assertNotIn(fold["test_participant"], fold["training_participants"])
            self.assertEqual(fold["corrector_synthetic_views"], fold["corrector_reference_windows"] * 3)
            self.assertEqual(fold["classifier_cross_fitted_windows"], fold["classifier_original_windows"])
        self.assertEqual(set(report["scenarios"]["down"]["comparison"]),
                         {"uncorrected", "learned_correction", "trained_with_correction", "synthetic_oracle"})
        self.assertEqual({p["test_participant"] for p in report["scenarios"]["down"]["participants"]}, set(people))
        self.assertNotIn("synthetic-person", json.dumps(report))
        with tempfile.TemporaryDirectory(prefix="two-stage-synthetic-") as tmp:
            out = Path(tmp) / "results"
            two_stage.save(out, report, classifiers, correctors, corrected_classifiers)
            loaded_corrector = joblib.load(out / "all-data-synthetic-vertical-corrector.joblib")
            loaded_classifier = joblib.load(out / "all-data-posture.joblib")
            np.testing.assert_allclose(two_stage.correction_prediction(loaded_corrector, self.reference, self.spans),
                                       two_stage.correction_prediction(correctors["all-data"], self.reference, self.spans))
            np.testing.assert_allclose(two_stage.scores(loaded_classifier, self.reference, self.spans,
                                                        np.zeros(len(self.reference))),
                                       two_stage.scores(classifiers["all-data"], self.reference, self.spans,
                                                        np.zeros(len(self.reference))))
            self.assertTrue((out / "all-data-posture-after-correction.joblib").exists())


if __name__ == "__main__":
    unittest.main()
