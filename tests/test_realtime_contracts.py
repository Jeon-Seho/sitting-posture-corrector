"""Draft Kafka topic and WebSocket contracts (plan 0022 step 1), synthetic examples only."""

import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts"
REALTIME = CONTRACTS / "realtime"
EXAMPLES = REALTIME / "examples"
SCHEMAS = {
    "features-": "kafka-features.v1.schema.json",
    "inference-": "kafka-inference.v1.schema.json",
    "episodes-": "kafka-episodes.v1.schema.json",
    "ws-": "realtime-ws.v1.schema.json",
}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


REGISTRY = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema))
    for schema in (load(path) for path in CONTRACTS.rglob("*.schema.json"))
    if "$id" in schema
)


def validator(name):
    schema = load(REALTIME / name)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=REGISTRY, format_checker=Draft202012Validator.FORMAT_CHECKER)


def check_session(message):
    """Nested events must belong to the session named by the envelope or WebSocket frame."""
    event = message.get("event") or message.get("body", {}).get("event")
    if event and event["session_id"] != message["session_id"]:
        raise ValueError("event session differs from the message session")


class RealtimeContractTests(unittest.TestCase):
    def example(self, name):
        return load(EXAMPLES / name)

    def test_every_example_matches_its_schema(self):
        names = sorted(path.name for path in EXAMPLES.glob("*.json"))
        self.assertEqual(len(names), 12)
        for name in names:
            schema = next(value for prefix, value in SCHEMAS.items() if name.startswith(prefix))
            with self.subTest(example=name):
                payload = self.example(name)
                validator(schema).validate(payload)
                check_session(payload)

    def test_unknown_fields_and_raw_pose_data_are_rejected(self):
        features = self.example("features-features.json")
        cases = [
            dict(features, extra="synthetic-forbidden"),
            dict(features, body=dict(features["body"], landmarks=[])),
        ]
        for payload in cases:
            with self.subTest(payload=list(payload)), self.assertRaises(ValidationError):
                validator("kafka-features.v1.schema.json").validate(payload)

    def test_body_must_match_its_kind(self):
        features = self.example("features-features.json")
        ended = self.example("features-session-ended.json")
        with self.assertRaises(ValidationError):
            validator("kafka-features.v1.schema.json").validate(dict(features, body=ended["body"]))
        observation = self.example("inference-observation.json")
        with self.assertRaises(ValidationError):
            validator("kafka-inference.v1.schema.json").validate(dict(observation, kind="session_ended"))

    def test_only_notifying_events_become_alerts(self):
        alert = self.example("ws-alert.json")
        with self.assertRaises(ValidationError):
            validator("realtime-ws.v1.schema.json").validate(dict(alert, kind="recovery_confirmed"))

    def test_feature_batches_are_bounded(self):
        frame = self.example("ws-features.json")
        for items in ([], frame["items"] * 31):
            with self.subTest(size=len(items)), self.assertRaises(ValidationError):
                validator("realtime-ws.v1.schema.json").validate(dict(frame, items=items))

    def test_nested_event_must_belong_to_the_message_session(self):
        for name in ("episodes-decision.json", "ws-decision.json"):
            payload = copy.deepcopy(self.example(name))
            event = payload.get("event") or payload["body"]["event"]
            event["session_id"] = "00000000-0000-4000-8000-0000000000ff"
            with self.subTest(example=name), self.assertRaises(ValueError):
                check_session(payload)


if __name__ == "__main__":
    unittest.main()
