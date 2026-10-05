"""Synthetic shared cases exercise feature transport, stateless scoring and contracts."""

import copy
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import ValidationError

from model.inference.app import app
from tools.service_contract import validate_inference_request_v2, validate_observation


EXAMPLES = Path(__file__).resolve().parents[1] / "contracts/examples/v2"


def read_example(filename):
    return json.loads((EXAMPLES / filename).read_text(encoding="utf-8"))


class InferenceV2Tests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.body = read_example("synthetic-feature-request.json")

    def infer(self, body):
        response = self.client.post("/v2/infer", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        observation = response.json()
        validate_observation(observation)
        return observation

    def test_shared_reference_cases_match_local_rule_score_and_mirrored_direction(self):
        fixture = read_example("reference-feature-cases.json")
        self.assertTrue(fixture["synthetic"])
        for sequence, case in enumerate(fixture["cases"]):
            with self.subTest(case=case["name"]):
                body = dict(
                    self.body,
                    sequence=sequence,
                    start_ms=sequence * 1000,
                    end_ms=(sequence + 1) * 1000,
                    phase=case["phase"],
                    measurement_quality=case["measurement_quality"],
                    features=case["expected_features"],
                )
                validate_inference_request_v2(body)
                result = self.infer(body)
                expected = case["expected_observation"]
                self.assertEqual(result["valid"], expected["valid"])
                self.assertAlmostEqual(
                    result["collapse_probability"], expected["collapse_probability"], places=14,
                )
                self.assertEqual(result["deviation_type"], expected["deviation_type"])
                self.assertEqual(result["model_version"], fixture["model_version"])
                for field in ("sequence", "start_ms", "end_ms", "phase"):
                    self.assertEqual(result[field], body[field])

    def test_each_quality_threshold_excludes_measurement_without_rejecting_contract(self):
        for field in ("current_quality", "baseline_quality"):
            for value, valid in ((0.0, False), (0.649999, False), (0.65, True), (1.0, True)):
                with self.subTest(field=field, value=value):
                    body = copy.deepcopy(self.body)
                    body["features"][field] = value
                    result = self.infer(body)
                    self.assertEqual(result["valid"], valid)
                    if not valid:
                        self.assertEqual(result["collapse_probability"], 0.0)
                        self.assertEqual(result["deviation_type"], "none")

    def test_finite_deltas_are_unbounded_and_capped_only_when_scoring(self):
        for field, value, kind in (
            ("head_gap_delta", 2.2, "unspecified"),
            ("lateral_offset_delta", -2.0, "right_lean"),
            ("shoulder_tilt_delta", 1e308, "unspecified"),
        ):
            with self.subTest(field=field, value=value):
                body = copy.deepcopy(self.body)
                for delta in ("head_gap_delta", "lateral_offset_delta", "shoulder_tilt_delta"):
                    body["features"][delta] = value if delta == field else 0.0
                validate_inference_request_v2(body)
                result = self.infer(body)
                self.assertTrue(result["valid"])
                self.assertEqual(result["collapse_probability"], 1.0)
                self.assertEqual(result["deviation_type"], kind)

    def test_stateless_output_omits_calibration_identity_and_temporal_decisions(self):
        first = self.infer(self.body)
        self.assertEqual(first, self.infer(self.body))
        other_calibration = dict(self.body, baseline_id="00000000-0000-4000-8000-000000000002")
        self.assertEqual(first, self.infer(other_calibration))
        for field in ("baseline_id", "features", "duration_ms", "alert", "event", "state"):
            self.assertNotIn(field, first)

    def test_invalid_fields_are_rejected_without_reflecting_input(self):
        invalid_patches = [
            {"schema_version": "1.0"},
            {"feature_version": "unknown"},
            {"baseline_id": "synthetic-participant-name"},
            {"baseline_id": "00000000000040008000000000000001"},
            {"baseline_id": None},
            {"sequence": True},
            {"sequence": -1},
            {"sequence": 1.5},
            {"start_ms": -1},
            {"end_ms": 0},
            {"end_ms": 1501},
            {"start_ms": 1000, "end_ms": 1000},
            {"phase": "unknown"},
            {"measurement_quality": "excellent"},
            {"video": "synthetic-forbidden"},
            {"features": []},
        ]
        for patch in invalid_patches:
            with self.subTest(patch=patch):
                response = self.client.post("/v2/infer", json=dict(self.body, **patch))
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json(), {"error": "invalid_contract"})

        invalid_features = [
            {"current_quality": -0.01},
            {"baseline_quality": 1.01},
            {"head_gap_delta": True},
            {"lateral_offset_delta": "0.2"},
            {"shoulder_tilt_delta": None},
            {"landmarks": []},
        ]
        for patch in invalid_features:
            with self.subTest(features=patch):
                body = dict(self.body, features=dict(self.body["features"], **patch))
                response = self.client.post("/v2/infer", json=body)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json(), {"error": "invalid_contract"})

    def test_missing_required_request_and_feature_fields_are_rejected(self):
        for field in self.body:
            with self.subTest(missing=field):
                body = dict(self.body)
                del body[field]
                response = self.client.post("/v2/infer", json=body)
                self.assertEqual(response.status_code, 422)
        for field in self.body["features"]:
            with self.subTest(missing_feature=field):
                body = copy.deepcopy(self.body)
                del body["features"][field]
                self.assertEqual(self.client.post("/v2/infer", json=body).status_code, 422)

    def test_nonfinite_features_are_rejected_without_reflecting_values(self):
        for field in self.body["features"]:
            for value in (float("nan"), float("inf"), float("-inf")):
                with self.subTest(field=field, value=value):
                    body = copy.deepcopy(self.body)
                    body["features"][field] = value
                    response = self.client.post(
                        "/v2/infer",
                        content=json.dumps(body),
                        headers={"Content-Type": "application/json"},
                    )
                    self.assertEqual(response.status_code, 422)
                    self.assertEqual(response.json(), {"error": "invalid_contract"})

    def test_versions_keep_their_distinct_legacy_direction_contracts(self):
        legacy = {
            "schema_version": "1.0", "sequence": 0, "start_ms": 0, "end_ms": 1000,
            "phase": "running", "measurement_quality": "good",
            "features": {"forward_delta": 0.0, "lateral_delta": 0.2},
        }
        old_result = self.client.post("/v1/infer", json=legacy).json()
        self.assertEqual(old_result["model_version"], "baseline-feature-rule-v1")
        self.assertEqual(old_result["collapse_probability"], 0.2)
        self.assertEqual(old_result["deviation_type"], "right_lean")
        new_result = self.infer(self.body)
        self.assertEqual(new_result["collapse_probability"], 0.7)
        self.assertEqual(new_result["deviation_type"], "left_lean")


class InferenceRequestV2ContractTests(unittest.TestCase):
    def setUp(self):
        self.body = read_example("synthetic-feature-request.json")

    def test_example_and_nullable_features_follow_input_contract(self):
        validate_inference_request_v2(self.body)
        validate_inference_request_v2(dict(self.body, features=None))

    def test_required_fields_and_extra_fields_are_rejected(self):
        for field in self.body:
            with self.subTest(missing=field), self.assertRaises(ValidationError):
                body = dict(self.body)
                del body[field]
                validate_inference_request_v2(body)
        for field in self.body["features"]:
            with self.subTest(missing_feature=field), self.assertRaises(ValidationError):
                body = copy.deepcopy(self.body)
                del body["features"][field]
                validate_inference_request_v2(body)
        with self.assertRaises(ValidationError):
            validate_inference_request_v2(dict(self.body, participant_name="synthetic-forbidden"))
        with self.assertRaises(ValidationError):
            validate_inference_request_v2(
                dict(self.body, features=dict(self.body["features"], landmarks=[]))
            )

    def test_invalid_identity_versions_types_quality_and_intervals_are_rejected(self):
        invalid_patches = [
            {"baseline_id": "synthetic-not-a-uuid"},
            {"schema_version": "1.0"},
            {"feature_version": "unknown"},
            {"sequence": True},
            {"start_ms": 1000, "end_ms": 1000},
            {"start_ms": 1000, "end_ms": 999},
            {"end_ms": 1501},
        ]
        for patch in invalid_patches:
            with self.subTest(patch=patch), self.assertRaises((ValidationError, ValueError)):
                validate_inference_request_v2(dict(self.body, **patch))
        for patch in (
            {"head_gap_delta": True},
            {"lateral_offset_delta": "0.2"},
            {"current_quality": -0.01},
            {"baseline_quality": 1.01},
        ):
            with self.subTest(features=patch), self.assertRaises(ValidationError):
                validate_inference_request_v2(
                    dict(self.body, features=dict(self.body["features"], **patch))
                )

    def test_nonfinite_values_are_not_json_numbers(self):
        for field in self.body["features"]:
            for value in (float("nan"), float("inf"), float("-inf")):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    body = copy.deepcopy(self.body)
                    body["features"][field] = value
                    validate_inference_request_v2(body)


if __name__ == "__main__":
    unittest.main()
