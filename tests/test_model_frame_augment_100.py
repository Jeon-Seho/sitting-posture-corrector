"""Synthetic tests for the 100-view extension of frame augmentation."""

import copy
import unittest

import numpy as np

from model.analysis.frame_pilot.augment import JITTER_STD, augment_25_views
from model.analysis.frame_pilot.augment_100 import TOTAL_VIEWS, augment_100_views, fit_100_views
from model.analysis.frame_pilot.data import prepare_capture
from model.analysis.replay_pilot.evaluate import training_weights
from test_model_frame_pilot import short_capture


class FrameAugmentation100Test(unittest.TestCase):
    def setUp(self):
        self.samples, _, _ = prepare_capture("P001", "synthetic", short_capture("synthetic-100-view"))

    def test_prior_views_are_preserved_and_each_sample_keeps_its_total_weight(self):
        before = copy.deepcopy(self.samples)
        base, labels25, _ = augment_25_views(self.samples, {"P999"})
        x, y, weights = augment_100_views(self.samples, {"P999"})
        x2, y2, weights2 = augment_100_views(self.samples, {"P999"})
        n = len(self.samples)
        self.assertEqual(x.shape, (100 * n, 6))
        self.assertEqual(x.dtype, np.float32)
        np.testing.assert_array_equal(x[:25 * n], base.astype(np.float32))
        np.testing.assert_array_equal(y[:25 * n], labels25)
        np.testing.assert_array_equal(x, x2)
        np.testing.assert_array_equal(y, y2)
        np.testing.assert_array_equal(weights, weights2)
        np.testing.assert_allclose(weights.reshape(TOTAL_VIEWS, n).sum(axis=0), training_weights(self.samples))
        for index in range(20, 95):
            reference = base[:n] if index % 2 == 0 else base[n:2 * n]
            derived = x[(5 + index) * n:(6 + index) * n]
            self.assertTrue(np.all(np.abs(derived - reference) <= 2 * JITTER_STD + 1e-6))
        self.assertEqual(self.samples, before)

    def test_held_out_participant_cannot_enter_augmentation_or_training(self):
        with self.assertRaisesRegex(ValueError, "validation or test"):
            augment_100_views(self.samples, {"P001"})
        with self.assertRaisesRegex(ValueError, "participant"):
            fit_100_views(self.samples, {"n_estimators": 2, "max_depth": 3, "min_samples_leaf": 1}, {"P001"})

    def test_classifier_uses_two_labeled_classes(self):
        model = fit_100_views(self.samples, {"n_estimators": 2, "max_depth": 3, "min_samples_leaf": 1})
        self.assertEqual(list(model.classes_), [0, 1])
        self.assertEqual(model.n_features_in_, 6)


if __name__ == "__main__":
    unittest.main()
