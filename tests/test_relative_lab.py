"""Explicit synthetic fixtures; no participant data or trained weights."""
import math
import unittest
from model.analysis.train_relative_lab import sequence


class RelativeLabSyntheticTests(unittest.TestCase):
    def test_sequences_have_finite_features_and_zero_initial_velocity(self):
        for label in range(3):
            rows = sequence(122, label)
            self.assertEqual(len(rows), 30)
            self.assertEqual(rows[0][3:], [0., 0., 0.])
            self.assertTrue(all(len(row) == 6 and all(math.isfinite(v) for v in row) for row in rows))

    def test_seeds_are_reproducible_and_distinct(self):
        self.assertEqual(sequence(122, 1), sequence(122, 1))
        self.assertNotEqual(sequence(122, 1), sequence(123, 1))

    def test_stable_normal_and_deviation_are_separate_synthetic_cases(self):
        normal = sequence(122, 0)
        deviation = sequence(122, 2)
        self.assertLess(max(abs(v) for row in normal for v in row[:3]), .12)
        self.assertGreater(max(abs(v) for row in deviation for v in row[:3]), .12)
