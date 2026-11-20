"""Synthetic frame inputs for parity, model loading, and POST /infer behavior."""

from contextlib import ExitStack
import hashlib
import os
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import joblib
from fastapi.testclient import TestClient
from numpy import array_equal as np_array_equal, column_stack as np_column_stack
from numpy.random import default_rng
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

from model.analysis.frame_pilot import frames as research_frames
from model.analysis.frame_pilot.inference import FramePredictor
from model.analysis.replay_pilot import replay
from model.inference.app import create_app
from model.inference.frame_features import baseline_geometry, frame_features, geometry, service_precision
from model.inference.frame_model import (
    DEFAULT_MODEL_DIR, MODEL_HASHES, CompiledForest, FrameRandomForest, load_frame_model,
)
from model.inference.schemas import FeatureDeltaRequest
from model.inference.service import predict_feature_observation, transform_probability


# Handwritten reference and variations; no person, camera, or capture data.
BASELINE = (
    (0.50, 0.38), (0.53, 0.35), (0.47, 0.35), (0.56, 0.39), (0.44, 0.39),
    (0.53, 0.42), (0.47, 0.42), (0.66, 0.59), (0.34, 0.59),
)


def synthetic_frame(dx=0, dy=0):
    return [(x + dx, y + dy, 0.99) if i < 7 else (x, y, 0.99)
            for i, (x, y) in enumerate(BASELINE)]


def modified_frame(index, **changes):
    points = synthetic_frame()
    x, y, visibility = points[index]
    points[index] = (changes.get("x", x), changes.get("y", y), changes.get("visibility", visibility))
    return points


def synthetic_request(**changes):
    return {
        "schema_version": "3.0",
        "feature_version": "keypoints-9-v1",
        "baseline_id": "4e485e6b-da3c-454c-ac86-ac651013b99a",
        "sequence": 4,
        "start_ms": 1000,
        "end_ms": 2000,
        "phase": "running",
        "frames": [synthetic_frame(dx=0.065)],
        "baseline": BASELINE,
        **changes,
    }


def synthetic_forests():
    # The target depends on the corrected shoulder-height feature.
    span = baseline_geometry(BASELINE).shoulder_span
    rows = [(0.0, lateral, 0.0, 0.0, height, 0.0)
            for lateral in (-0.2, 0.0, 0.2) for height in (-0.1, 0.0, 0.1)]
    corrector = RandomForestRegressor(n_estimators=7, random_state=21, n_jobs=2)
    corrector.fit([(*row, span) for row in rows], [8 * row[4] - 20 * row[1] for row in rows])
    classifier = RandomForestClassifier(n_estimators=7, random_state=42, n_jobs=2)
    classifier.fit(rows, [int(row[4] > 0) for row in rows])
    return corrector, classifier


class FeatureParityTests(unittest.TestCase):
    def test_geometry_and_frame_features_match_research(self):
        reference = baseline_geometry(BASELINE)
        oracle = research_frames.reference_from_points(BASELINE, quality_verified=True)
        self.assertEqual(oracle.geometry, reference)
        frames = (
            synthetic_frame(), synthetic_frame(dx=0.061235, dy=0.042115),
            modified_frame(7, x=0.683344, y=0.610005), modified_frame(6, y=0.429995),
            modified_frame(3, visibility=0.649), modified_frame(3, visibility=0.64),
            modified_frame(1, x=-0.000001), modified_frame(4, y=float("nan")),
            modified_frame(1, y=None), modified_frame(0, x=0.56), modified_frame(7, x=0.40),
        )
        for index, points in enumerate(frames):
            with self.subTest(frame=index):
                self.assertEqual(replay.geometry(points), geometry(points))
                self.assertEqual(research_frames.frame_features(points, oracle), frame_features(points, reference))
        points = frames[1]
        self.assertEqual(research_frames.service_precision(points), service_precision(points))
        self.assertEqual(replay.feature_deltas(service_precision(points), oracle.geometry),
                         frame_features(points, reference)[0])

    def test_probability_transform(self):
        self.assertEqual([0, 0.7, 1], [transform_probability(p) for p in (0, 0.5, 1)])
        scores = [transform_probability(index / 100) for index in range(101)]
        self.assertTrue(all(left < right for left, right in zip(scores, scores[1:])))


class InferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        corrector, classifier = synthetic_forests()
        cls.model = FrameRandomForest(corrector, classifier)
        cls.reference = baseline_geometry(BASELINE)
        reference = research_frames.reference_from_points(BASELINE, quality_verified=True)
        cls.oracle = FramePredictor(corrector, classifier, reference)

    def client(self, mode="frame-rf-100x"):
        context = ExitStack()
        self.addCleanup(context.close)
        context.enter_context(patch.dict(os.environ, {"POSEGOOD_INFERENCE_MODEL": mode}))
        return context.enter_context(TestClient(create_app(frame_model=self.model)))

    def test_synthetic_rf_probabilities_match_frame_predictor(self):
        frames = [synthetic_frame(dx=dx) for dx in (-0.07, 0, 0.065)]
        features = [frame_features(points, self.reference)[0] for points in frames]
        expected = [self.oracle.predict(points)["score"] for points in frames]
        self.assertGreater(len(set(expected)), 1)
        self.assertEqual(expected, self.model.predict_probabilities(features, self.reference.shoulder_span))

    def test_running_averages_usable_probabilities_before_transform(self):
        client = self.client()
        self.assertEqual(client.get("/health").json(), {
            "status": "ok", "model_version": "frame-rf-100x-v1", "learned": True,
        })
        frames = [synthetic_frame(dx=-0.07), synthetic_frame(dx=0.065), synthetic_frame(dx=0.065)]
        expected = transform_probability(sum(self.oracle.predict(points)["score"] for points in frames) / len(frames))
        body = synthetic_request(frames=[None, modified_frame(0, x=0.58), *frames])
        response = client.post("/infer", json=body)
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual({
            "schema_version": "2.0", "sequence": 4, "start_ms": 1000, "end_ms": 2000, "phase": "running",
            "valid": True, "collapse_probability": expected, "deviation_type": "left_lean",
            "model_version": "frame-rf-100x-v1", "invalid_reason": None,
        }, response.json())

    def test_unusable_frames_and_inactive_phases(self):
        client = self.client()
        for changes, reason in (
            ({"frames": [modified_frame(3, visibility=0.64)]}, "unmeasurable"),
            ({"frames": [modified_frame(3, visibility=0.649)]}, "unmeasurable"),
            ({"frames": [modified_frame(1, x=1.001)]}, "unmeasurable"),
            ({"frames": [modified_frame(0, x=0.58), None]}, "head_turn"),
            ({"frames": []}, "unmeasurable"),
            ({"frames": [None]}, "unmeasurable"),
            ({"phase": "rest"}, None),
            ({"phase": "away"}, None),
        ):
            with self.subTest(changes=changes.keys(), reason=reason):
                response = client.post("/infer", json=synthetic_request(**changes))
                self.assertEqual(200, response.status_code, response.text)
                result = response.json()
                self.assertFalse(result["valid"])
                self.assertEqual(reason, result["invalid_reason"])
                self.assertEqual(0, result["collapse_probability"])
                self.assertEqual("none", result["deviation_type"])

    def test_bad_contract_and_invalid_baseline_do_not_echo_points(self):
        client = self.client()
        for changes in (
            {"baseline": BASELINE[:-1]}, {"baseline": [(0.5, 0.5)] * 9},
            {"baseline": [(1.01, 0.5), *BASELINE[1:]]}, {"frames": None},
            {"frames": [None] * 31}, {"frames": [synthetic_frame()[:-1]]},
            {"frames": [modified_frame(3, visibility=1.01)]}, {"frames": [modified_frame(3, x="0.56")]},
            {"frames": [modified_frame(3, x=True)]}, {"end_ms": 2501}, {"baseline_id": "invalid"},
        ):
            with self.subTest(changes=changes.keys()):
                response = client.post("/infer", json=synthetic_request(**changes))
                self.assertEqual(422, response.status_code)
                self.assertEqual({"error": "invalid_contract"}, response.json())

    def test_rule_mode_uses_v2_score_and_accepts_ears_with_low_visibility(self):
        client = self.client(mode="rule")
        self.assertEqual(client.get("/health").json(), {
            "status": "ok", "model_version": "reference-feature-rule-v1", "learned": False,
        })
        usable = [synthetic_frame(dx=0.064), synthetic_frame(dx=0.0321234)]
        usable[0][3] = (*usable[0][3][:2], 0.1)
        body = synthetic_request(frames=[*usable, modified_frame(0, x=0.58), None])
        current = [replay.geometry(frame) for frame in usable]
        deltas = [sum(row[i] for row in current) / len(current) - self.reference[i] for i in range(3)]
        rule_body = {key: value for key, value in body.items() if key not in {"baseline", "frames"}}
        rule_body.update(
            schema_version="2.0", feature_version="shoulder-relative-deltas-v1", measurement_quality="good",
            features=dict(zip(("head_gap_delta", "lateral_offset_delta", "shoulder_tilt_delta",
                               "current_quality", "baseline_quality"), (*deltas, 0.99, 1))),
        )
        expected = predict_feature_observation(FeatureDeltaRequest.model_validate(rule_body))
        response = client.post("/infer", json=body)
        self.assertEqual(200, response.status_code, response.text)
        self.assertTrue(response.json()["valid"])
        self.assertEqual(dict(expected, invalid_reason=None), response.json())


class CompiledForestTests(unittest.TestCase):
    """The array forest must return exactly what scikit-learn returns (synthetic inputs only)."""

    def assert_same(self, forest, rows, *, classifier):
        forest.n_jobs = 1
        expected = forest.predict_proba(rows)[:, 1] if classifier else forest.predict(rows)
        actual = CompiledForest(forest, classifier=classifier).predict(rows)
        self.assertTrue(np_array_equal(expected, actual))

    def test_small_synthetic_forests_match_sklearn(self):
        rng = default_rng(11)
        rows = rng.normal(0, 1, size=(400, 6))
        labels = (rows[:, 0] + rows[:, 4] > 0).astype(int)
        classifier = RandomForestClassifier(n_estimators=9, max_depth=5, random_state=2).fit(rows, labels)
        regressor = RandomForestRegressor(n_estimators=7, max_depth=4, random_state=3).fit(rows, rows[:, 1] * 3)
        probe = rng.normal(0, 1.5, size=(300, 6))
        self.assert_same(classifier, probe, classifier=True)
        self.assert_same(regressor, probe, classifier=False)

    def test_repository_weights_match_sklearn(self):
        rng = default_rng(5)
        features = rng.normal(0, 0.3, size=(2000, 6))
        corrector_rows = np_column_stack([features, rng.uniform(60, 400, 2000)])
        self.assert_same(joblib.load(DEFAULT_MODEL_DIR / "frame-posture.joblib"), features, classifier=True)
        self.assert_same(joblib.load(DEFAULT_MODEL_DIR / "frame-corrector.joblib"), corrector_rows, classifier=False)


class ModelLoadingTests(unittest.TestCase):
    def test_repository_weights_match_sha256_and_load_once_at_startup(self):
        for filename, expected_sha in MODEL_HASHES.items():
            self.assertEqual(expected_sha, hashlib.sha256((DEFAULT_MODEL_DIR / filename).read_bytes()).hexdigest())
        corrector = joblib.load(DEFAULT_MODEL_DIR / "frame-corrector.joblib")
        classifier = joblib.load(DEFAULT_MODEL_DIR / "frame-posture.joblib")
        corrector.n_jobs = classifier.n_jobs = 1
        reference = research_frames.reference_from_points(BASELINE, quality_verified=True)
        oracle = FramePredictor(corrector, classifier, reference)
        body = synthetic_request()
        expected_score = transform_probability(oracle.predict(body["frames"][0])["score"])
        environment = {"POSEGOOD_INFERENCE_MODEL": "frame-rf-100x", "POSEGOOD_MODEL_DIR": str(DEFAULT_MODEL_DIR)}
        with patch.dict(os.environ, environment), patch("model.inference.app.load_frame_model", wraps=load_frame_model) as load:
            application = create_app()
            load.assert_not_called()
            with TestClient(application) as client:
                self.assertEqual(200, client.get("/health").status_code)
                response = client.post("/infer", json=body)
                self.assertEqual(200, response.status_code, response.text)
                result = response.json()
                self.assertTrue(result["valid"])
                self.assertEqual(expected_score, result["collapse_probability"])
                model = application.state.frame_inference.rf
                self.assertIsInstance(model.corrector, CompiledForest)
                self.assertIsInstance(model.classifier, CompiledForest)
                load.assert_called_once_with(DEFAULT_MODEL_DIR)

    def test_checksum_failure_prevents_deserialization_and_returns_503(self):
        with TemporaryDirectory() as directory:
            corrector, classifier = MODEL_HASHES
            copyfile(DEFAULT_MODEL_DIR / corrector, Path(directory) / corrector)
            (Path(directory) / classifier).write_bytes(b"synthetic invalid artifact")
            environment = {"POSEGOOD_INFERENCE_MODEL": "frame-rf-100x", "POSEGOOD_MODEL_DIR": directory}
            with patch.dict(os.environ, environment), patch("joblib.load") as deserialize:
                with self.assertLogs("model.inference.app", level="ERROR"), TestClient(create_app()) as client:
                    for response in (client.get("/health"), client.post("/infer", json=synthetic_request())):
                        self.assertEqual(503, response.status_code)
                        self.assertEqual({"status": "error"}, response.json())
                deserialize.assert_not_called()


if __name__ == "__main__":
    unittest.main()
