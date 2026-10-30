"""Representative synthetic v2 inference behavior through the HTTP boundary."""

import copy
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from model.inference.app import app


EXAMPLES = Path(__file__).resolve().parents[1] / "contracts/examples/v2"


class InferenceV2Tests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.body = json.loads((EXAMPLES / "synthetic-feature-request.json").read_text(encoding="utf-8"))

    def infer(self, body):
        response = self.client.post("/v2/infer", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        for field in ("sequence", "start_ms", "end_ms", "phase"):
            self.assertEqual(result[field], body[field])
        return result

    def test_normal_and_mirrored_lateral_scores(self):
        for delta, score, direction in ((0.0, 0.0, "none"), (0.2, 0.7, "left_lean"), (-0.2, 0.7, "right_lean")):
            with self.subTest(delta=delta):
                body = copy.deepcopy(self.body)
                body["features"]["lateral_offset_delta"] = delta
                result = self.infer(body)
                self.assertTrue(result["valid"])
                self.assertAlmostEqual(result["collapse_probability"], score)
                self.assertEqual(result["deviation_type"], direction)

    def test_poor_quality_rest_and_away_are_invalid(self):
        for patch in ({"measurement_quality": "poor"}, {"phase": "rest"}, {"phase": "away"}):
            with self.subTest(patch=patch):
                result = self.infer(dict(self.body, **patch))
                self.assertFalse(result["valid"])
                self.assertEqual(result["collapse_probability"], 0.0)
                self.assertEqual(result["deviation_type"], "none")

    def test_representative_invalid_request_is_rejected(self):
        response = self.client.post("/v2/infer", json=dict(self.body, sequence=-1))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json(), {"error": "invalid_contract"})

    def test_same_input_has_independent_output(self):
        first = self.infer(self.body)
        first["collapse_probability"] = -1
        second = self.infer(self.body)
        self.assertAlmostEqual(second["collapse_probability"], 0.7)
        self.assertEqual(second, self.infer(self.body))


if __name__ == "__main__":
    unittest.main()
