"""Contract acceptance and rejection without a camera or participant data."""

import unittest

from jsonschema import ValidationError

from tools.validate_contract import ROOT, make_validator, read_json, validate_payload


class ContractTests(unittest.TestCase):
    def fixture(self, name):
        return read_json(ROOT / "contracts/examples" / (name + ".json"))

    def test_schema_and_all_examples(self):
        make_validator()
        examples = list((ROOT / "contracts/examples").glob("*.json"))
        self.assertGreaterEqual(len(examples), 3)
        for path in examples:
            with self.subTest(path=path.name):
                validate_payload(read_json(path))

    def test_required_fields(self):
        base = self.fixture("normal")
        for field in base:
            with self.subTest(field=field):
                payload = dict(base)
                del payload[field]
                with self.assertRaises(ValidationError):
                    validate_payload(payload)

    def test_invalid_state_combinations(self):
        cases = [
            ("normal", "deviation_type", "left_lean"),
            ("normal", "measurement_quality", "poor"),
            ("normal", "confidence", None),
            ("normal", "duration_ms", 100),
            ("deviation", "deviation_type", None),
            ("deviation", "measurement_quality", "poor"),
            ("deviation", "confidence", None),
            ("unmeasurable", "confidence", 0.9),
            ("unmeasurable", "duration_ms", 500),
            ("unmeasurable", "deviation_type", "forward_slouch"),
            ("unmeasurable", "measurement_quality", "good"),
        ]
        for name, field, value in cases:
            with self.subTest(name=name, field=field):
                payload = self.fixture(name)
                payload[field] = value
                with self.assertRaises(ValidationError):
                    validate_payload(payload)

    def test_invalid_values_and_extra_fields(self):
        for field, value in [
            ("schema_version", "2.0"), ("status", "healthy"),
            ("timestamp_ms", -1), ("timestamp_ms", True), ("timestamp_ms", 1.5),
            ("duration_ms", -1), ("duration_ms", "100"),
            ("confidence", -0.01), ("confidence", 1.01), ("confidence", True),
            ("deviation_type", "diagnosis"), ("participant_name", "synthetic"),
        ]:
            with self.subTest(field=field, value=value):
                payload = self.fixture("deviation")
                payload[field] = value
                with self.assertRaises(ValidationError):
                    validate_payload(payload)

    def test_score_boundaries_and_candidate_types(self):
        for score in (0, 1):
            for kind in ("forward_slouch", "left_lean", "right_lean"):
                payload = self.fixture("deviation")
                payload.update(confidence=score, deviation_type=kind, duration_ms=0)
                validate_payload(payload)

    def test_non_finite_values(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                payload = self.fixture("normal")
                payload["confidence"] = value
                with self.assertRaises(ValueError):
                    validate_payload(payload)


if __name__ == "__main__":
    unittest.main()
