"""HTTP inference checks using only explicit synthetic normalized deltas."""

import json
import unittest

from fastapi.testclient import TestClient

from model.inference.app import app


class InferenceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.body = {
            "schema_version": "1.0",
            "sequence": 0,
            "start_ms": 0,
            "end_ms": 1000,
            "phase": "running",
            "measurement_quality": "good",
            "features": {"forward_delta": .9, "lateral_delta": .1},
        }

    def test_stateless_score_and_type_without_event_decisions(self):
        result = self.client.post("/v1/infer", json=self.body).json()
        self.assertEqual(result["collapse_probability"], .9)
        self.assertEqual(result["deviation_type"], "forward_slouch")
        self.assertTrue(result["valid"])
        self.assertNotIn("duration_ms", result)
        self.assertNotIn("alert", result)
        self.assertEqual(result, self.client.post("/v1/infer", json=self.body).json())

    def test_poor_quality_missing_features_and_rest_are_not_normal_observations(self):
        invalid_measurements = [
            {"measurement_quality": "poor"},
            {"features": None},
            {"phase": "rest"},
            {"phase": "away"},
        ]
        for patch in invalid_measurements:
            with self.subTest(patch=patch):
                result = self.client.post("/v1/infer", json=dict(self.body, **patch)).json()
                self.assertFalse(result["valid"])
                self.assertEqual(result["collapse_probability"], 0)

    def test_lateral_sign_and_zero_features(self):
        for lateral, kind in [(-.8, "left_lean"), (.8, "right_lean"), (0.0, "none")]:
            body = dict(self.body, features={"forward_delta": 0.0, "lateral_delta": lateral})
            self.assertEqual(self.client.post("/v1/infer", json=body).json()["deviation_type"], kind)

    def test_unknown_fields_bool_numeric_and_invalid_interval_rejected(self):
        invalid_fields = [
            {"secret": "synthetic-forbidden"},
            {"start_ms": -1},
            {"end_ms": 0},
            {"end_ms": 1501},
            {"sequence": True},
            {"schema_version": "2.0"},
            {"features": {"forward_delta": 1.1, "lateral_delta": 0.0}},
        ]
        for patch in invalid_fields:
            with self.subTest(patch=patch):
                response = self.client.post("/v1/infer", json=dict(self.body, **patch))
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json(), {"error": "invalid_contract"})

    def test_nonfinite_features_rejected_without_reflecting_values(self):
        for value in [float("nan"), float("inf"), float("-inf")]:
            body = dict(self.body, features={"forward_delta": value, "lateral_delta": 0.0})
            response = self.client.post(
                "/v1/infer",
                content=json.dumps(body),
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json(), {"error": "invalid_contract"})


if __name__ == "__main__":
    unittest.main()
