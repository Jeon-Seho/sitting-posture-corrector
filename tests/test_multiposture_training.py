"""Synthetic-only training, geometry, quality, provenance and participant boundaries."""

import csv
import tempfile
import unittest
from pathlib import Path

import joblib
import numpy as np

from model.analysis.multiposture import (
    LABELS, POINTS, ROOT, baseline_reference, features, fit_reference_scatter,
    frame_points, load_csv, private_path, research_predict, split_subjects, train,
)


def synthetic_points(label="TUP", variation=0):
    p = np.array([[0., -.7, 0.], [-.1, -.75, 0.], [-.12, -.75, 0.], [-.14, -.75, 0.],
                  [.1, -.75, 0.], [.12, -.75, 0.], [.14, -.75, 0.], [-.2, -.7, 0.],
                  [.2, -.7, 0.], [-.08, -.6, 0.], [.08, -.6, 0.], [-.5, 0., 0.], [.5, 0., 0.]])
    changes = {"TUP": [0, 0, 0], "TLF": [0, .2, -.3], "TLB": [0, -.2, .3],
               "TLL": [-.3, 0, 0], "TLR": [.3, 0, 0]}
    p[:11] += np.array(changes[label]) + variation
    return p


def frame(points):
    return {"quality": "measurable", "worldLandmarks": [dict(zip("xyz", row)) for row in points]}


class MultiPostureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="explicit-synthetic-pose13-")
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def dataset(self):
        path = self.folder / "explicit-synthetic.csv"
        fields = ["subject", "upperbody_label"] + [f"{p}_{a}" for p in POINTS for a in "xyz"]
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for person in range(7):
                for label in LABELS:
                    for repeat in range(5):
                        p = synthetic_points(label, repeat * .002 + person * .0001)
                        row = dict(zip(fields[2:], p.ravel()))
                        row.update(subject="synthetic-" + str(person), upperbody_label=label)
                        writer.writerow(row)
        return path

    def test_shape_translation_scale_invariance_retains_rotation(self):
        p = synthetic_points()
        np.testing.assert_allclose(features(p), features(p * 3 + [2, -4, 1]), atol=1e-12)
        angle = .3
        r = np.array([[np.cos(angle), -np.sin(angle), 0], [np.sin(angle), np.cos(angle), 0], [0, 0, 1]])
        self.assertGreater(np.linalg.norm(features(p) - features(p @ r.T)), .1)
        self.assertEqual(len(features(p)), 36)
        self.assertEqual(len(features(p, "nose3")), 3)

    def test_invalid_observations_rejected_and_counted_without_fake_values(self):
        p = synthetic_points()
        p[12] = p[11]
        with self.assertRaises(ValueError):
            features(p)
        p = synthetic_points()
        p[0, 0] = np.nan
        with self.assertRaises(ValueError):
            features(p)
        with self.assertRaises(ValueError):
            frame_points({"worldLandmarks": frame(synthetic_points())["worldLandmarks"]})
        with self.assertRaises(ValueError):
            frame_points({"quality": "measurable", "landmarks": frame(synthetic_points())["worldLandmarks"]})
        path = self.dataset()
        text = path.read_text()
        path.write_text(text.replace("0.0", "nan", 1))
        rows, rejected = load_csv(path)
        self.assertEqual((len(rows), rejected), (174, 1))

    def test_participants_never_overlap_and_missing_identity_or_class_fails(self):
        rows, _ = load_csv(self.dataset())
        roles = split_subjects(rows)
        sets = [set(people) for people in roles.values()]
        self.assertEqual(set.union(*sets), {r["subject"] for r in rows})
        for i, a in enumerate(sets):
            for b in sets[i + 1:]:
                self.assertFalse(a & b)
        with self.assertRaises(ValueError):
            split_subjects([r for r in rows if r["label"] != "TLR"])
        path = self.dataset()
        path.write_text(path.read_text().replace("synthetic-0", "", 1))
        with self.assertRaises(ValueError):
            load_csv(path)

    def test_private_output_protection_and_real_provenance(self):
        with self.assertRaises(ValueError):
            private_path(ROOT / "model" / "weights.json")
        path = self.dataset()
        with self.assertRaisesRegex(ValueError, "reviewed"):
            train(path, self.folder / "real-mislabelled")

    def test_synthetic_training_export_and_personal_score_never_claim_normal(self):
        path = self.dataset()
        report = train(path, self.folder / "run", data_kind="synthetic")
        self.assertEqual(report["data_kind"], "synthetic")
        bundle = joblib.load(self.folder / "run/research-model.joblib")
        self.assertFalse(bundle["service_ready"])
        self.assertFalse(set(bundle["training_subjects"]) & set(report["split_subjects"]["test"]))
        self.assertEqual(bundle["reference_scatter"]["training_rows"], 25)
        p = synthetic_points()
        ref = baseline_reference([frame(p)] * 15, "mediapipe_world")
        unchanged = research_predict(bundle, frame(p), ref)
        changed = research_predict(bundle, frame(synthetic_points("TLL")), ref)
        self.assertAlmostEqual(unchanged["personal_deviation"]["distance_units"], 0)
        self.assertGreater(changed["personal_deviation"]["distance_units"], 0)
        for result in (unchanged, changed):
            self.assertIsNone(result["service_label"])
            self.assertIsNone(result["alert"])
            self.assertIsNone(result["personal_deviation"]["threshold"])
        d = changed["personal_deviation"]
        np.testing.assert_allclose(np.array(d["world_delta"]),
                                   np.array(d["reference_relative_delta"]) + np.array(d["shoulder_center_delta"]))
        missing = research_predict(bundle, {"quality": "unmeasurable"}, ref)
        self.assertEqual(missing["state"], "unmeasurable")
        self.assertIsNone(missing["external_trunk_prediction"])
        with self.assertRaises(ValueError):
            baseline_reference([frame(p)] * 15, "image_normalized")
        with self.assertRaises(ValueError):
            baseline_reference([frame(p)] * 14, "mediapipe_world")
        with self.assertRaises(ValueError):
            train(path, self.folder / "run", data_kind="synthetic")

    def test_reference_scatter_uses_upright_only(self):
        rows, _ = load_csv(self.dataset())
        scatter = fit_reference_scatter(rows)
        for row in rows:
            if row["label"] != "TUP":
                row["points"] = synthetic_points("TLL") * 100
        self.assertEqual(scatter, fit_reference_scatter(rows))

    def test_holdout_changes_do_not_change_selection_export_or_scatter(self):
        path = self.dataset()
        before = train(path, self.folder / "before", data_kind="synthetic")
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            fields, rows = reader.fieldnames, list(reader)
        for row in rows:
            if row["subject"] in before["split_subjects"]["test"]:
                row["nose_x"] = str(float(row["nose_x"]) + 5)
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        after = train(path, self.folder / "after", data_kind="synthetic")
        self.assertEqual(before["selected"], after["selected"])
        self.assertEqual(before["candidates"], after["candidates"])
        a = joblib.load(self.folder / "before/research-model.joblib")
        b = joblib.load(self.folder / "after/research-model.joblib")
        self.assertEqual(a["reference_scatter"], b["reference_scatter"])
        probe = features(synthetic_points(), a["feature_mode"])
        np.testing.assert_allclose(a["classifier"].predict_proba([probe]), b["classifier"].predict_proba([probe]))


if __name__ == "__main__":
    unittest.main()
