"""Cross-component contract checks without camera or participant data."""

import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema.exceptions import ValidationError

from model.inference.app import app
from tools.service_contract import validate_observation


ROOT = Path(__file__).resolve().parents[1]


class ServiceContractTests(unittest.TestCase):
    def setUp(self):
        example_path = ROOT / "contracts/examples/v2/synthetic-observation.json"
        self.observation = json.loads(example_path.read_text(encoding="utf-8"))

    def test_synthetic_example_and_inference_use_the_same_observation_contract(self):
        validate_observation(self.observation)
        request = {
            "schema_version": "1.0",
            "sequence": 0,
            "start_ms": 0,
            "end_ms": 1000,
            "phase": "running",
            "measurement_quality": "good",
            "features": {"forward_delta": .9, "lateral_delta": 0.0},
        }
        validate_observation(TestClient(app).post("/v1/infer", json=request).json())

    def test_missing_fields_extra_fields_nonfinite_and_interval_order_rejected(self):
        for field in self.observation:
            invalid = dict(self.observation)
            del invalid[field]
            with self.subTest(missing=field), self.assertRaises(ValidationError):
                validate_observation(invalid)

        invalid_fields = [
            {"video": "synthetic-forbidden"},
            {"start_ms": 1000, "end_ms": 1000},
            {"end_ms": 1501},
            {"collapse_probability": float("nan")},
            {"collapse_probability": 1.1},
        ]
        for patch in invalid_fields:
            with self.subTest(patch=patch), self.assertRaises((ValidationError, ValueError)):
                validate_observation(dict(self.observation, **patch))

    def test_api_has_no_esper_dependency_or_temporal_threshold_comparisons(self):
        # Architecture regression: API only stores/queries CEP decisions.
        pom = (ROOT / "backend/api/pom.xml").read_text(encoding="utf-8")
        self.assertNotIn("esper", pom)
        for path in (ROOT / "backend/api/src/main/java").rglob("*.java"):
            source = path.read_text(encoding="utf-8")
            self.assertNotIn("com.espertech", source)
            self.assertNotIn("holdMs() >=", source)
            self.assertNotIn("recoveryMs() >=", source)
        self.assertNotIn("duration_ms", TestClient(app).get("/health").json())


if __name__ == "__main__":
    unittest.main()
