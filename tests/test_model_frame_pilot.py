"""Synthetic tests for the frame-level RF candidate and quality boundary."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestClassifier

from model.analysis.frame_pilot.data import prepare_capture
from model.analysis.frame_pilot.frames import frame_features, reference_from_capture, reference_from_points
from model.analysis.frame_pilot.inference import FramePredictor
from model.analysis.frame_pilot.replay import read_replay as read_frame_replay
from model.analysis.frame_pilot import train
from model.analysis.frame_pilot.artifacts import load_models, load_predictor
from model.analysis.frame_pilot.train import candidate_only, experiment, fit_forest, save
from model.analysis.replay_pilot.replay import read_replay
from test_replay_pilot import JOINTS, POINTS, capture


class CountingClassifier:
    """A real small forest with a call counter, not a substitute for inference."""

    def __init__(self):
        self.model = RandomForestClassifier(n_estimators=5, random_state=7).fit(
            [[0.] * 6, [.1] * 6, [.2] * 6, [.3] * 6], [0, 0, 1, 1])
        self.classes_ = self.model.classes_
        self.n_features_in_ = self.model.n_features_in_
        self.calls = 0

    def predict_proba(self, x):
        self.calls += 1
        return self.model.predict_proba(x)


class CountingCorrector:
    def __init__(self):
        self.model = DummyRegressor(strategy="constant", constant=0.).fit(np.zeros((2, 7)), [0., 0.])
        self.n_features_in_ = self.model.n_features_in_
        self.calls = 0

    def predict(self, x):
        self.calls += 1
        return self.model.predict(x)


def points():
    return [(x, y, .99) for x, y in POINTS]


def short_capture(name, shift=.06):
    result = capture(name, shift)
    result["frames"] = [f for f in result["frames"]
                        if (f["phase"] == "registering" and f["elapsedMs"] <= 3000)
                        or (f["phase"] == "hold" and
                            (9000 <= f["elapsedMs"] <= 10000 or 17000 <= f["elapsedMs"] <= 18000))]
    return result


class FramePilotTest(unittest.TestCase):
    def setUp(self):
        self.reference = reference_from_points(POINTS, quality_verified=True)
        self.classifier = CountingClassifier()
        self.corrector = CountingCorrector()
        self.predictor = FramePredictor(self.corrector, self.classifier, self.reference)

    def test_each_valid_frame_calls_the_classifier_without_a_timer(self):
        first = self.predictor.predict(points())
        changed = points()
        x, y, visibility = changed[0]
        changed[0] = (x, y + .04, visibility)
        second = self.predictor.predict(changed)
        self.assertTrue(first["valid"] and second["valid"])
        self.assertEqual(self.classifier.calls, 2)
        self.assertEqual(self.corrector.calls, 2)
        self.assertIsInstance(first["score"], float)
        self.assertIsNone(first["reason"])

    def test_low_visibility_and_missing_points_never_score_and_recover_immediately(self):
        for index in (0, 1, 3, 5, 6, 7):
            with self.subTest(point=JOINTS[index]):
                sample = points()
                x, y, _ = sample[index]
                sample[index] = (x, y, .2)
                result = self.predictor.predict(sample)
                self.assertEqual(result, {"valid": False, "score": None, "reason": "unmeasurable"})
        self.assertEqual(self.predictor.predict(points()[:-1])["score"], None)
        self.assertEqual(self.predictor.predict(points(), measurable=False)["score"], None)
        self.assertEqual(self.classifier.calls, 0)
        self.assertEqual(self.corrector.calls, 0)
        self.assertTrue(self.predictor.predict(points())["valid"])
        self.assertEqual(self.classifier.calls, 1)

    def test_head_turn_and_invalid_values_are_unmeasurable(self):
        turned = points()
        x, y, visibility = turned[0]
        turned[0] = (x + .1, y, visibility)
        self.assertEqual(self.predictor.predict(turned)["reason"], "head_turn")
        malformed = points()
        malformed[5] = (float("nan"), .5, .99)
        self.assertEqual(self.predictor.predict(malformed)["reason"], "unmeasurable")
        self.assertEqual(self.classifier.calls, 0)

    def test_frame_and_service_precision_are_consistent(self):
        original = points()
        near_boundary = list(original)
        x, y, _ = near_boundary[5]
        near_boundary[5] = (x, y, .649)
        # FE transmits visibility to two decimals, so .649 becomes .65.
        self.assertTrue(self.predictor.predict(near_boundary)["valid"])
        near_boundary[5] = (x, y, .644)
        self.assertFalse(self.predictor.predict(near_boundary)["valid"])

    def test_low_visibility_breaks_registration_and_does_not_modify_source(self):
        data = short_capture("synthetic-registration")
        for frame in data["frames"]:
            if frame["phase"] == "registering":
                frame["image"][9]["visibility"] = .1
        before = copy.deepcopy(data)
        with self.assertRaisesRegex(ValueError, "registration"):
            reference_from_capture(data["frames"], data["markers"])
        self.assertEqual(data, before)

    def test_a_baseline_without_quality_evidence_is_not_silently_accepted(self):
        with self.assertRaisesRegex(ValueError, "visibility must be verified"):
            reference_from_points(POINTS)

    def test_frame_examples_do_not_average_and_quality_breaks_continuity(self):
        data = short_capture("synthetic-frames")
        hold = [f for f in data["frames"] if f["phase"] == "hold" and f["task"] == "deviation"]
        hold[1]["image"][0]["y"] += .03
        hold[2]["image"][9]["visibility"] = .2
        samples, counts, _ = prepare_capture("P001", "synthetic", data)
        times = {sample.time_ms: sample for sample in samples}
        self.assertIn(hold[0]["elapsedMs"], times)
        self.assertIn(hold[1]["elapsedMs"], times)
        self.assertNotEqual(times[hold[0]["elapsedMs"]].features[0], times[hold[1]["elapsedMs"]].features[0])
        self.assertNotIn(hold[2]["elapsedMs"], times)
        self.assertNotEqual(times[hold[1]["elapsedMs"]].chunk, times[hold[3]["elapsedMs"]].chunk)
        self.assertEqual(counts["excluded_unmeasurable"], 1)

    def test_4_by_3_replay_is_canonical_and_other_ratios_are_rejected(self):
        data = short_capture("synthetic-4-by-3")
        doubled = copy.deepcopy(data)
        for frame in doubled["frames"]:
            frame["width"], frame["height"] = 1280, 960
        with tempfile.TemporaryDirectory(prefix="posegood-frame-synthetic-") as tmp:
            path = Path(tmp) / "synthetic.json"
            path.write_text(json.dumps(doubled), encoding="utf-8")
            with self.assertRaises(ValueError):
                read_replay(path)
            loaded, _ = read_frame_replay(path)
            self.assertEqual((loaded["frames"][0]["width"], loaded["frames"][0]["height"]), (1280, 960))
            first, _, _ = prepare_capture("P001", "a", data)
            second, _, _ = prepare_capture("P001", "a", loaded)
            self.assertEqual([s.features for s in first], [s.features for s in second])
            doubled["frames"][0]["width"] = 1920
            path.write_text(json.dumps(doubled), encoding="utf-8")
            with self.assertRaises(ValueError):
                read_frame_replay(path)
            doubled["frames"][0]["width"], doubled["frames"][0]["height"] = 640, 480
            path.write_text(json.dumps(doubled), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "dimensions changed"):
                read_frame_replay(path)

    def test_new_replay_reader_preserves_v8_identity_time_and_marker_guards(self):
        data = short_capture("synthetic-format")
        with tempfile.TemporaryDirectory(prefix="posegood-frame-v8-") as tmp:
            path = Path(tmp) / "synthetic.json"
            for name in ("label", "time", "identity", "marker"):
                modified = copy.deepcopy(data)
                if name == "label":
                    modified["labelKind"] = "verified"
                elif name == "time":
                    modified["frames"][2]["elapsedMs"] = modified["frames"][1]["elapsedMs"]
                elif name == "identity":
                    modified["participant"] = ""
                else:
                    modified["markers"] = [{"afterFrame": 0, "elapsedMs": -1, "reason": "stopped"}]
                path.write_text(json.dumps(modified), encoding="utf-8")
                with self.subTest(name=name), self.assertRaises(ValueError):
                    read_frame_replay(path)

    def test_participant_split_actual_training_and_artifact_reloading(self):
        loaded = [(f"P{i:03d}", str(i) * 64, short_capture(f"synthetic-person-{i}", .04 + .01 * i))
                  for i in range(1, 5)]
        configs = ({"n_estimators": 5, "max_depth": 3, "min_samples_leaf": 1},)
        corrector_config = {"n_estimators": 3, "max_depth": 3, "min_samples_leaf": 1}
        with patch.object(train, "fit_corrector", wraps=train.fit_corrector) as fitted, \
             patch.object(train, "fit_forest", wraps=train.fit_forest) as fitted_classifier:
            report, corrector, candidate = experiment(loaded, False, "synthetic", configs=configs,
                                                       corrector_config=corrector_config, shifts=(-6., 0., 6.))
        self.assertFalse(report["identity_reviewed"])
        self.assertEqual(len(report["folds"]), 4)
        for fold in report["folds"]:
            self.assertNotIn(fold["test_participant"], fold["training_participants"])
        for call in fitted.call_args_list:
            training, forbidden = call.args[0], set(call.args[4]) if len(call.args) > 4 else set()
            self.assertFalse({sample.participant for sample in training} & forbidden)
            self.assertTrue(all(sample.label == 0 for sample in training))
        for call in fitted_classifier.call_args_list:
            training, forbidden = call.args[0], set(call.args[2]) if len(call.args) > 2 else set()
            self.assertFalse({sample.participant for sample in training} & forbidden)
        samples, _, reference = prepare_capture("P001", "synthetic", loaded[0][2])
        with self.assertRaisesRegex(ValueError, "participant"):
            fit_forest(samples, configs[0], {"P001"})
        self.assertNotIn("synthetic-person", json.dumps(report))
        with tempfile.TemporaryDirectory(prefix="posegood-frame-model-") as tmp:
            directory = Path(tmp) / "candidate"
            save(directory, report, corrector, candidate)
            restored_corrector, restored, restored_report = load_models(directory)
            self.assertEqual(restored_report["settings"]["input"], "one_frame")
            np.testing.assert_allclose(candidate.predict_proba([samples[0].features]),
                                       restored.predict_proba([samples[0].features]))
            raw = list(samples[0].features) + [reference.geometry[7]]
            np.testing.assert_allclose(corrector.predict([raw]), restored_corrector.predict([raw]))
            self.assertTrue(FramePredictor(restored_corrector, restored, reference).predict(points())["valid"])
            loaded_predictor, _ = load_predictor(directory, reference)
            self.assertEqual(loaded_predictor.min_visibility, report["settings"]["visibility_minimum"])
            frame_values, reason = frame_features(points(), reference)
            self.assertIsNone(reason)
            span = reference.geometry[7]
            shifted = list(frame_values)
            shifted[4] -= float(restored_corrector.predict([shifted + [span]])[0]) / span
            expected = float(restored.predict_proba([shifted])[0][1])
            self.assertAlmostEqual(loaded_predictor.predict(points())["score"], expected)
            (directory / "frame-corrector.joblib").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "does not match"):
                load_models(directory)

    def test_candidate_only_records_missing_class_and_never_reports_validation(self):
        loaded = [(f"P{i:03d}", str(i) * 64, short_capture(f"synthetic-{i}", .04 + .01 * i))
                  for i in range(1, 5)]
        incomplete = loaded[-1][2]
        incomplete["frames"] = [frame for frame in incomplete["frames"]
                                if frame["phase"] == "registering" or frame["task"] == "neutral"]
        config = {"n_estimators": 2, "max_depth": 3, "min_samples_leaf": 1}
        report, corrector, classifier = candidate_only(
            loaded, False, "synthetic", config=config, corrector_config=config, shifts=(-6., 0., 6.))
        self.assertEqual(report["incomplete_class_groups"], 1)
        self.assertEqual(report["folds"], [])
        self.assertIsNone(report["summary"])
        self.assertEqual(report["all_data_candidate"]["threshold_status"], "display_only_not_selected_or_validated")
        self.assertEqual(corrector.n_features_in_, 7)
        self.assertEqual(list(classifier.classes_), [0, 1])
        with self.assertRaisesRegex(ValueError, "both guided classes"):
            experiment(loaded, False, configs=(config,), corrector_config=config, shifts=(-6., 0., 6.))

    def test_cli_catalog_and_frame_training_with_synthetic_data(self):
        with tempfile.TemporaryDirectory(prefix="posegood-frame-cli-") as tmp:
            root = Path(tmp)
            source = root / "captures"
            source.mkdir()
            for i in range(1, 5):
                (source / f"{i}.json").write_text(json.dumps(short_capture(f"synthetic-{i}", .04 + .01 * i)),
                                                  encoding="utf-8")
            catalog, output = root / "catalog.json", root / "output"
            cmd = [sys.executable, "-m", "model.analysis.frame_pilot"]
            created = subprocess.run(cmd + ["catalog", "--input", str(source), "--output", str(catalog)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(created.returncode, 0, created.stderr)
            trained = subprocess.run(cmd + ["evaluate", "--catalog", str(catalog), "--output", str(output),
                                             "--allow-unverified-identities", "--classifier-trees", "2",
                                             "--corrector-trees", "2"],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(trained.returncode, 0, trained.stderr)
            _, _, report = load_models(output)
            self.assertEqual(report["participants"], 4)
            self.assertEqual(report["settings"]["input"], "one_frame")
            self.assertFalse(report["identity_reviewed"])
            candidate = root / "candidate"
            trained = subprocess.run(cmd + ["evaluate", "--catalog", str(catalog), "--output", str(candidate),
                                             "--allow-unverified-identities", "--candidate-only",
                                             "--classifier-trees", "2", "--corrector-trees", "2"],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(trained.returncode, 0, trained.stderr)
            _, _, report = load_models(candidate)
            self.assertEqual(report["settings"]["evaluation"], "none_all_participants_used_for_training")
            self.assertEqual(report["all_data_candidate"]["threshold_status"], "display_only_not_selected_or_validated")


if __name__ == "__main__":
    unittest.main()
