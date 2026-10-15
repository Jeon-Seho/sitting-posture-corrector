"""WebSocket /v2/realtime contract (BE API spec 2026-10-13, FE 연동 명세), synthetic examples only."""

import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts"
REALTIME = CONTRACTS / "realtime"
EXAMPLES = REALTIME / "examples-v2"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


REGISTRY = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema))
    for schema in (load(path) for path in CONTRACTS.rglob("*.schema.json"))
    if "$id" in schema
)


class RealtimeWsV2Tests(unittest.TestCase):
    def setUp(self):
        schema = load(REALTIME / "realtime-ws.v2.schema.json")
        Draft202012Validator.check_schema(schema)
        self.validator = Draft202012Validator(
            schema, registry=REGISTRY, format_checker=Draft202012Validator.FORMAT_CHECKER
        )

    def example(self, name):
        return load(EXAMPLES / f"ws-{name}.json")

    def rejects(self, payload):
        with self.assertRaises(ValidationError):
            self.validator.validate(payload)

    def test_every_example_matches(self):
        names = sorted(path.name for path in EXAMPLES.glob("*.json"))
        self.assertEqual(len(names), 18)
        for path in EXAMPLES.glob("*.json"):
            with self.subTest(example=path.name):
                self.validator.validate(load(path))

    def test_hello_names_exactly_one_target_for_its_purpose(self):
        measure = self.example("hello-measure")
        self.rejects({**measure, "calibration_id": measure["session_id"]})
        self.rejects({k: v for k, v in measure.items() if k != "session_id"})
        self.rejects({**self.example("hello-calibration"), "purpose": "measure"})
        # v1 resume fields are gone (no reconnection, ADR 0024).
        self.rejects({**measure, "last_event_id": 0})

    def test_features_carry_frames_and_only_false_validity(self):
        features = self.example("features")
        marked = copy.deepcopy(features)
        marked["items"][0]["frames"][0]["valid"] = True
        self.rejects(marked)
        self.rejects({"type": "features", "items": []})

    def test_observation_reason_follows_validity(self):
        valid = self.example("observation")
        bad = copy.deepcopy(valid)
        bad["observation"]["invalid_reason"] = "unmeasurable"
        self.rejects(bad)
        invalid = self.example("observation-unmeasurable")
        bad = copy.deepcopy(invalid)
        bad["observation"]["invalid_reason"] = None
        self.rejects(bad)

    def test_no_five_minute_fields(self):
        # 10/14: sessions under 5 min are stored (DB V2.3), so these fields were dropped.
        self.rejects({**self.example("ready-measure"), "min_record_ms": 300000})
        self.rejects({**self.example("progress"), "recordable": True})
        ended = copy.deepcopy(self.example("decision-session-ended"))
        ended["event"]["recorded"] = True
        self.rejects(ended)

    def test_calibration_result_shapes(self):
        ok = self.example("calibration-result-ok")
        self.rejects({k: v for k, v in ok.items() if k != "baseline_id"})
        self.rejects({**ok, "reason": "too_few_frames"})
        partial = copy.deepcopy(ok)
        del partial["landmarks"]["right_shoulder"]
        self.rejects(partial)
        failed = self.example("calibration-result-failed")
        self.rejects({**failed, "reason": "camera_off"})

    def test_closed_reasons_and_unknown_types(self):
        self.rejects({"type": "closed", "reason": "reconnect"})
        self.rejects({"type": "resume", "last_event_id": 1})


if __name__ == "__main__":
    unittest.main()
