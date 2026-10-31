"""Frame inference v3 (plan 0084): shared synthetic reference cases, per-frame results and contracts."""

import copy
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, ValidationError

from model.inference import frames
from model.inference.app import app
from model.inference.schemas import FeatureDeltas
from model.inference.service import REFERENCE_MODEL_VERSION, score_feature_deltas


CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"


def read(path):
    return json.loads((CONTRACTS / path).read_text(encoding="utf-8"))


def validator(name):
    schema = read(name)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


INFERENCE_REQUEST_V3 = validator("inference-request.v3.schema.json")
INFERENCE_RESPONSE_V3 = validator("inference-response.v3.schema.json")


def validate_inference_request_v3(value):
    json.dumps(value, allow_nan=False)
    INFERENCE_REQUEST_V3.validate(value)


def validate_inference_response_v3(value, inference_request=None):
    # One result per request frame, in the same order and with the same t_ms.
    json.dumps(value, allow_nan=False)
    INFERENCE_RESPONSE_V3.validate(value)
    if inference_request is not None:
        sent = [frame["t_ms"] for frame in inference_request["frames"]]
        if [frame["t_ms"] for frame in value["frames"]] != sent:
            raise ValueError("inference request/response frame mismatch")


class FrameRuleParityTests(unittest.TestCase):
    """The Python rule gives the values the API's FrameFeatures.java gives for the same cases."""

    def setUp(self):
        self.fixture = read("examples/frames/reference-rule-cases.json")
        self.assertTrue(self.fixture["synthetic"])
        self.baseline = frames.features(self.fixture["baseline"]["p"])

    def test_baseline_matches(self):
        expected = self.fixture["baseline"]["features"]
        self.assertAlmostEqual(self.baseline.head_gap, expected["head_gap"], places=12)
        self.assertAlmostEqual(self.baseline.quality, expected["quality"], places=12)

    def test_every_frame_case_matches(self):
        for case in self.fixture["frame_cases"]:
            with self.subTest(case=case["name"]):
                expected = case["expected"]
                current = None if case["p"] is None else frames.features(case["p"])
                if expected["features"] is None:
                    self.assertIsNone(current)
                    self.assertEqual(expected["observed"], "unmeasurable")
                    continue
                for name, field in (("head_gap", "head_gap"), ("lateral_offset", "offset"),
                                    ("shoulder_tilt", "tilt"), ("quality", "quality"),
                                    ("head_turn_offset", "turn")):
                    self.assertAlmostEqual(getattr(current, field), expected["features"][name], places=12)
                turned = frames.head_turned(current, self.baseline)
                self.assertEqual(turned, expected["observed"] == "head_turn")
                if turned:
                    continue
                head_gap, offset, tilt = frames.deltas(current, self.baseline)
                self.assertAlmostEqual(head_gap, expected["deltas"]["head_gap"], places=12)
                self.assertAlmostEqual(offset, expected["deltas"]["lateral_offset"], places=12)
                self.assertAlmostEqual(tilt, expected["deltas"]["shoulder_tilt"], places=12)
                score, _ = score_feature_deltas(FeatureDeltas(
                    head_gap_delta=head_gap, lateral_offset_delta=offset, shoulder_tilt_delta=tilt,
                    current_quality=current.quality, baseline_quality=self.baseline.quality))
                self.assertAlmostEqual(score, expected["score"], places=12)


class InferenceV3Tests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.request = read("examples/v3/synthetic-frames-request.json")

    def infer(self, body, status=200):
        response = self.client.post("/v3/infer", json=body)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def test_example_request_gives_the_example_response(self):
        validate_inference_request_v3(self.request)
        result = self.infer(self.request)
        validate_inference_response_v3(result, self.request)
        self.assertEqual(result, read("examples/v3/synthetic-frames-response.json"))
        self.assertEqual(result["model_version"], REFERENCE_MODEL_VERSION)

    def test_every_frame_is_judged_on_its_own(self):
        result = self.infer(self.request)["frames"]
        self.assertEqual([r["invalid_reason"] for r in result],
                         [None, None, "head_turn", "unmeasurable", "unmeasurable", None])
        # A turned head or a missing frame next to a lean does not change the lean's own score.
        self.assertEqual(result[1]["deviation_type"], "left_lean")
        self.assertGreater(result[1]["collapse_probability"], 0.8)
        single = dict(self.request, frames=[self.request["frames"][1]])
        self.assertEqual(self.infer(single)["frames"][0], result[1])

    def test_unusable_baseline_makes_every_frame_unmeasurable(self):
        body = copy.deepcopy(self.request)
        body["baseline"][7] = [0.5, 0.6]  # shoulders closer than 10 % of the width
        body["baseline"][8] = [0.49, 0.6]
        result = self.infer(body)
        self.assertTrue(all(r["invalid_reason"] == "unmeasurable" for r in result["frames"]))

    def test_contract_violations_are_rejected_without_echoing_values(self):
        def broken(change):
            body = copy.deepcopy(self.request)
            change(body)
            return body

        cases = [
            broken(lambda b: b["frames"][0].update(valid=True)),
            broken(lambda b: b["frames"][0].update(p=b["frames"][0]["p"][:8])),
            broken(lambda b: b["frames"][0]["p"][0].__setitem__(0, 2.5)),
            broken(lambda b: b["frames"][0].update(extra=1)),
            broken(lambda b: b.update(frames=[])),
            broken(lambda b: b.update(schema_version="2.0")),
            broken(lambda b: b["baseline"].pop()),
        ]
        for body in cases:
            with self.subTest(body=list(body)):
                self.assertEqual(self.infer(body, status=422), {"error": "invalid_contract"})
        with self.assertRaises(ValidationError):
            validate_inference_request_v3(cases[0])

    def test_response_contract_ties_reason_to_validity(self):
        result = self.infer(self.request)
        bad = copy.deepcopy(result)
        bad["frames"][2]["invalid_reason"] = None
        with self.assertRaises(ValidationError):
            validate_inference_response_v3(bad)
        shifted = copy.deepcopy(result)
        shifted["frames"][0]["t_ms"] += 1
        with self.assertRaises(ValueError):
            validate_inference_response_v3(shifted, self.request)


if __name__ == "__main__":
    unittest.main()
