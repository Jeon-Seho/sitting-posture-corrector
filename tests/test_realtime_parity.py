"""T-15 inference parity: the team inference (model/inference) against the shared synthetic cases.

backend/inference/tests/test_parity.py checks the processing-side inference against the same file,
so both inference paths give the same observation for the same input (plan 0031, D-57).
"""

import json
import math
import unittest
from pathlib import Path

from model.inference.schemas import InferenceRequestV2
from model.inference.service import predict_feature_observation


ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "contracts/realtime/parity/inference-cases.v1.json"


class InferenceParityTests(unittest.TestCase):
    def test_team_inference_matches_the_shared_cases(self):
        cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
        self.assertGreaterEqual(len(cases), 100)
        for case in cases:
            with self.subTest(sequence=case["request"]["sequence"]):
                actual = dict(predict_feature_observation(InferenceRequestV2.model_validate(case["request"])))
                expected = dict(case["expected"])
                self.assertTrue(math.isclose(actual.pop("collapse_probability"),
                                             expected.pop("collapse_probability"), rel_tol=0, abs_tol=1e-12))
                self.assertEqual(expected, actual)


if __name__ == "__main__":
    unittest.main()
