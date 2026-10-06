"""Browser-facing response guard, using hand-written synthetic observations only."""

import copy
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import ValidationError

from model.inference.app import app
from tools.service_contract import validate_feature_response


EXAMPLES = Path(__file__).resolve().parents[1] / "contracts/examples/v2"


class FeatureResponseTests(unittest.TestCase):
    def setUp(self):
        self.response = json.loads((EXAMPLES / "synthetic-feature-response.json").read_text())
        self.request = json.loads((EXAMPLES / "synthetic-feature-request.json").read_text())

    def test_synthetic_envelope_matches_the_actual_inference_output(self):
        observation = TestClient(app).post("/v2/infer", json=self.request).json()
        self.assertEqual(self.response["observation"], observation)
        validate_feature_response(self.response, self.request)

    def test_unknown_raw_fields_and_missing_payloads_are_rejected(self):
        for patch in ({"video": "synthetic-forbidden"}, {"observation": None}, {"session": None}):
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                validate_feature_response(dict(self.response, **patch))
        invalid = copy.deepcopy(self.response)
        invalid["observation"]["features"] = self.request["features"]
        with self.assertRaises(ValidationError):
            validate_feature_response(invalid)

    def test_unacknowledged_sequence_and_time_are_rejected(self):
        for section, patch in (
            ("session", {"last_sequence": -1}),
            ("summary", {"total_ms": 999}),
        ):
            invalid = copy.deepcopy(self.response)
            target = invalid["session"] if section == "session" else invalid["session"]["summary"]
            target.update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_feature_response(invalid)

    def test_response_cannot_change_the_original_interval_or_phase(self):
        for patch in ({"sequence": 1}, {"start_ms": 1}, {"end_ms": 999}, {"phase": "rest"}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_feature_response(self.response, dict(self.request, **patch))


if __name__ == "__main__":
    unittest.main()
