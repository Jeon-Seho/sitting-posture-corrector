"""Flat WS contracts, synthetic inputs only."""

import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts"
REALTIME = CONTRACTS / "realtime"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


class FlatContractTests(unittest.TestCase):
    def setUp(self):
        registry = Registry().with_resources(
            (s["$id"], Resource.from_contents(s))
            for s in (load(p) for p in CONTRACTS.rglob("*.schema.json")) if "$id" in s
        )
        self.validators = {}
        for name in ("realtime-ws.schema.json", "kafka-keypoints.schema.json"):
            schema = load(REALTIME / name)
            Draft202012Validator.check_schema(schema)
            self.validators[name] = Draft202012Validator(schema, registry=registry)
        self.ws = self.validators["realtime-ws.schema.json"]

    def test_new_examples_and_existing_inputs_and_responses(self):
        for path in (REALTIME / "examples-ws").glob("*.json"):
            with self.subTest(path=path.name):
                self.ws.validate(load(path))
        for path in (REALTIME / "examples-ws/legacy").glob("*.json"):
            if path.name == "ws-ack.json":
                with self.assertRaises(ValidationError):
                    self.ws.validate(load(path))
            else:
                self.ws.validate(load(path))

    def test_phase_fields_and_mixed_messages_are_rejected(self):
        normal = load(REALTIME / "examples-ws/ws-features.json")
        missing = copy.deepcopy(normal)
        del missing["t_ms"]
        for patch in ({"p": None}, {"items": []}, {"frames": []}, {"valid": False},
                      {"schema_version": "3.0"}, {"phase": "unmeasurable"},
                      {"phase": "rest"}, {"sequence": 1.5}):
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                self.ws.validate({**normal, **patch})
        with self.assertRaises(ValidationError):
            self.ws.validate(missing)
        blank = load(REALTIME / "examples-ws/ws-no-observation.json")
        for patch in ({"t_ms": None}, {"p": []}):
            with self.assertRaises(ValidationError):
                self.ws.validate({**blank, **patch})



if __name__ == "__main__":
    unittest.main()
