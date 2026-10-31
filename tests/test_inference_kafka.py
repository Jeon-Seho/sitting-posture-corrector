"""Kafka transport of frame inference v3 (plan 0084): message contracts and the worker's pure handling.

Synthetic examples only. The broker round trip on the API side is backend/api KafkaInferenceRoundTripTest.
"""

import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from model.inference.kafka_worker import (
    InvalidMessage, KafkaWorker, Settings, dead_letter, result_message,
)


CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"
EXAMPLES = CONTRACTS / "realtime" / "examples-inference-v3"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


REGISTRY = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema))
    for schema in (load(path) for path in CONTRACTS.rglob("*.schema.json"))
    if "$id" in schema
)


def validator(name):
    schema = load(CONTRACTS / "realtime" / name)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=REGISTRY, format_checker=Draft202012Validator.FORMAT_CHECKER)


class KafkaInferenceContractTests(unittest.TestCase):
    def setUp(self):
        self.request = load(EXAMPLES / "request.json")
        self.result = load(EXAMPLES / "result.json")

    def test_examples_match_their_schemas_and_each_other(self):
        validator("kafka-inference-request.v1.schema.json").validate(self.request)
        validator("kafka-inference-result.v1.schema.json").validate(self.result)
        self.assertEqual(self.result["session_id"], self.request["session_id"])
        self.assertEqual(self.result["sequence"], self.request["sequence"])
        self.assertEqual([f["t_ms"] for f in self.result["body"]["frames"]],
                         [f["t_ms"] for f in self.request["body"]["frames"]])

    def test_the_result_example_is_the_worker_output(self):
        produced = result_message(json.dumps(self.request), now=self.result["produced_at"])
        validator("kafka-inference-result.v1.schema.json").validate(produced)
        self.assertNotEqual(produced["message_id"], self.request["message_id"])
        produced["message_id"] = self.result["message_id"]
        self.assertEqual(produced, self.result)
        # bytes from the consumer work the same
        self.assertEqual(result_message(json.dumps(self.request).encode("utf-8"))["body"], self.result["body"])

    def test_unreadable_requests_are_rejected_without_echoing_values(self):
        cases = {
            "not json": "{",
            "extra field": dict(self.request, extra=1),
            "upper case uuid": dict(self.request, session_id=self.request["session_id"].upper()),
            "negative sequence": dict(self.request, sequence=-1),
            "wrong version": dict(self.request, schema_version="2.0"),
            "no frames": dict(self.request, body=dict(self.request["body"], frames=[])),
        }
        secret = copy.deepcopy(self.request)
        secret["body"]["frames"][0]["p"][0][0] = 7.123456  # out of range: must not appear in the reason
        cases["joint out of range"] = secret
        for name, value in cases.items():
            with self.subTest(case=name):
                raw = value if isinstance(value, str) else json.dumps(value)
                with self.assertRaises(InvalidMessage) as caught:
                    result_message(raw)
                self.assertNotIn("7.123456", str(caught.exception))
                self.assertNotIn("0.52", str(caught.exception))

    def test_dead_letters_carry_no_payload(self):
        record = dead_letter("inference-v3", "posture.inference-request.v3", 1, 9, "key", "contract mismatch: body",
                            now="2026-10-31T00:00:00.000Z")
        self.assertIsNone(record["payload"])
        self.assertFalse(record["payload_truncated"])
        self.assertEqual(record["source_offset"], 9)

    def test_the_worker_is_off_without_a_broker(self):
        settings = Settings({})
        self.assertFalse(settings.enabled)
        self.assertEqual(settings.request_topic, "posture.inference-request.v3")
        self.assertEqual(settings.result_topic, "posture.inference-result.v3")
        worker = KafkaWorker(settings)
        worker.start()
        self.assertEqual(worker.status()["running"], False)
        self.assertTrue(Settings({"POSEGOOD_KAFKA_BOOTSTRAP_SERVERS": "kafka:19092"}).enabled)


if __name__ == "__main__":
    unittest.main()
