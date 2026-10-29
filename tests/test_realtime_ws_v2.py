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
        self.assertEqual(len(names), 14)
        for path in EXAMPLES.glob("*.json"):
            with self.subTest(example=path.name):
                self.validator.validate(load(path))

    def test_hello_is_measure_only(self):
        measure = self.example("hello-measure")
        self.rejects({**measure, "calibration_id": measure["session_id"]})
        self.rejects({k: v for k, v in measure.items() if k != "session_id"})
        self.rejects({k: v for k, v in measure.items() if k != "access_token"})
        # WebSocket posture registration was removed on 2026-10-27 (B1 only).
        calibration = {k: v for k, v in measure.items() if k != "session_id"}
        self.rejects({**calibration, "purpose": "calibration", "calibration_id": measure["session_id"]})
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

    def test_calibration_messages_are_gone(self):
        self.rejects({"type": "ready", "purpose": "calibration", "calibration_id": self.example("hello-measure")["session_id"]})
        self.rejects({"type": "calibration_result", "status": "failed", "calibration_id": self.example("hello-measure")["session_id"],
                      "valid_frames": 0, "reason": "incomplete"})
        calibration_phase = copy.deepcopy(self.example("features"))
        calibration_phase["items"][0]["phase"] = "calibration"
        self.rejects(calibration_phase)

    def test_server_times(self):
        # BE b903751 (fix/repo-backend-sync), FE ADR 0029: the record's start and end come from the server.
        ready = self.example("ready-measure")
        self.rejects({k: v for k, v in ready.items() if k != "started_at"})
        # A number (e.g. epoch ms) instead of an ISO-8601 string is refused.
        self.rejects({**ready, "started_at": 12345})
        closed = self.example("closed")
        # null: the connection closed before the session ended (the app keeps it as not confirmed).
        self.validator.validate({**closed, "reason": "server_shutdown", "ended_at": None})
        self.rejects({"type": "closed", "reason": "ended"})
        self.rejects({**closed, "ended_at": 12345})

    def test_midnight_rollover(self):
        # BE-6 1 plan B: the connection moves to a new server-made session at KST midnight.
        rollover = self.example("session-rollover")
        self.rejects({k: v for k, v in rollover.items() if k != "at_ms"})
        self.rejects({**rollover, "ended": {k: v for k, v in rollover["ended"].items() if k != "ended_at"}})
        self.rejects({**rollover, "at_ms": -1})
        self.rejects({**rollover, "started_at": 12345})
        # If the server cannot continue, it closes with day_changed and the previous session's end.
        self.validator.validate({**self.example("closed"), "reason": "day_changed"})

    def test_closed_reasons_and_unknown_types(self):
        self.rejects({"type": "closed", "reason": "reconnect"})
        self.rejects({"type": "resume", "last_event_id": 1})


if __name__ == "__main__":
    unittest.main()
