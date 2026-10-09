"""
(D-21) posture.features.v1 → posture.inference.v1 변환 단위 테스트.

팀 계약 예제(contracts/realtime/examples)와 같은 형태의 메시지를 쓴다. Kafka에는 접속하지 않는다.
"""
import copy

import pytest

from app.realtime import dead_letter, observation_from_features, process_features_message, score_feature_deltas

SESSION = "00000000-0000-4000-8000-0000000000a1"

FEATURES_MSG = {
    "schema_version": "1.0",
    "message_id": "00000000-0000-4000-8000-000000000002",
    "session_id": SESSION,
    "user_id": "synthetic-user-1",
    "produced_at": "2026-10-06T06:00:01.000Z",
    "kind": "features",
    "body": {
        "schema_version": "2.0",
        "feature_version": "shoulder-relative-deltas-v1",
        "baseline_id": "00000000-0000-4000-8000-000000000001",
        "sequence": 0,
        "start_ms": 0,
        "end_ms": 1000,
        "phase": "running",
        "measurement_quality": "good",
        "features": {
            "head_gap_delta": 0.0,
            "lateral_offset_delta": 0.2,
            "shoulder_tilt_delta": 0.0,
            "current_quality": 0.9,
            "baseline_quality": 0.8,
        },
    },
}

STARTED_MSG = {
    "schema_version": "1.0",
    "message_id": "00000000-0000-4000-8000-000000000001",
    "session_id": SESSION,
    "user_id": "synthetic-user-1",
    "produced_at": "2026-10-06T06:00:00.000Z",
    "kind": "session_started",
    "body": {
        "policy": {"hold_ms": 3000, "recovery_ms": 2000, "reminder_ms": 60000, "threshold": 0.7},
        "baseline_id": "00000000-0000-4000-8000-000000000001",
        "frame": {"width": 640, "height": 480},
    },
}


def test_features_become_observation_envelope():
    out, reason = process_features_message(copy.deepcopy(FEATURES_MSG), now="2026-10-06T06:00:01.020Z")
    assert reason is None
    assert out["kind"] == "observation"
    assert out["session_id"] == SESSION and out["user_id"] == "synthetic-user-1"
    assert out["schema_version"] == "1.0" and out["produced_at"] == "2026-10-06T06:00:01.020Z"
    assert out["message_id"] != FEATURES_MSG["message_id"]
    body = out["body"]
    assert set(body) == {"schema_version", "sequence", "start_ms", "end_ms", "phase", "valid",
                         "collapse_probability", "deviation_type", "model_version"}
    # 좌우 0.2/0.20 = 1.0 → ×0.7 = 0.7, 좌우가 우세하고 양수 → left_lean
    assert body["valid"] is True
    assert body["collapse_probability"] == pytest.approx(0.7)
    assert body["deviation_type"] == "left_lean"
    assert body["model_version"] == "reference-feature-rule-v1"


def test_session_started_and_ended_pass_through_unchanged():
    out, _ = process_features_message(copy.deepcopy(STARTED_MSG))
    assert out == STARTED_MSG
    ended = {**STARTED_MSG, "kind": "session_ended", "body": {"end_ms": 3000}}
    out, _ = process_features_message(copy.deepcopy(ended))
    assert out == ended


@pytest.mark.parametrize("change", [
    {"measurement_quality": "poor", "features": None},
    {"phase": "rest"},
    {"phase": "away"},
])
def test_invalid_segments_score_zero(change):
    body = {**copy.deepcopy(FEATURES_MSG["body"]), **change}
    obs = observation_from_features(body)
    assert obs["valid"] is False and obs["collapse_probability"] == 0.0 and obs["deviation_type"] == "none"
    assert obs["phase"] == body["phase"]


def test_low_quality_is_invalid():
    body = copy.deepcopy(FEATURES_MSG["body"])
    body["features"]["current_quality"] = 0.64
    assert observation_from_features(body)["valid"] is False


def test_score_rule_matches_team_reference():
    # 어깨 기울기 0.12/0.03 = 4 → ×0.7 = 2.8 → 상한 1.0, 기울기 우세 → unspecified
    score, kind = score_feature_deltas({"head_gap_delta": 0.18, "lateral_offset_delta": 0.15,
                                        "shoulder_tilt_delta": -0.12})
    assert score == 1.0 and kind == "unspecified"
    # 정상 자세 예: 0.01/0.03 ≈ 0.333 → ×0.7 ≈ 0.233
    score, _ = score_feature_deltas({"head_gap_delta": 0.02, "lateral_offset_delta": 0.01,
                                     "shoulder_tilt_delta": -0.01})
    assert score == pytest.approx(0.2333, abs=1e-3)
    score, kind = score_feature_deltas({"head_gap_delta": 0.0, "lateral_offset_delta": -0.3,
                                        "shoulder_tilt_delta": 0.0})
    assert kind == "right_lean"
    assert score_feature_deltas({"head_gap_delta": 0.0, "lateral_offset_delta": 0.0,
                                 "shoulder_tilt_delta": 0.0}) == (0.0, "none")


@pytest.mark.parametrize("bad", [
    "not a dict",
    {**FEATURES_MSG, "schema_version": "2.0"},
    {**FEATURES_MSG, "session_id": None},
    {**FEATURES_MSG, "kind": "observation"},
    {**FEATURES_MSG, "body": {"sequence": 0}},
])
def test_bad_messages_are_skipped_not_raised(bad):
    out, reason = process_features_message(bad)
    assert out is None and reason


def test_non_finite_feature_is_invalid_not_error():
    body = copy.deepcopy(FEATURES_MSG["body"])
    body["features"]["head_gap_delta"] = float("nan")
    assert observation_from_features(body)["valid"] is False


def test_dead_letter_message_fields():
    m = dead_letter("posture.features.v1", 1, 42, SESSION, "모르는 kind: x", '{"kind":"x"}', now="2026-10-09T05:00:00.000Z")
    assert m == {
        "schema_version": "1.0", "failed_at": "2026-10-09T05:00:00.000Z", "consumer": "inference-service-v1",
        "source_topic": "posture.features.v1", "source_partition": 1, "source_offset": 42, "key": SESSION,
        "reason": "모르는 kind: x", "payload": '{"kind":"x"}', "payload_truncated": False,
    }


def test_dead_letter_truncates_huge_payload():
    from app.realtime import DLQ_MAX_PAYLOAD_CHARS
    m = dead_letter("t", 0, 0, None, "r", "x" * (DLQ_MAX_PAYLOAD_CHARS + 5))
    assert len(m["payload"]) == DLQ_MAX_PAYLOAD_CHARS and m["payload_truncated"] is True


class _Msg:
    def __init__(self, value, topic="posture.features.v1", partition=0, offset=7, key=SESSION):
        self.value, self.topic, self.partition, self.offset, self.key = value, topic, partition, offset, key


class _Producer:
    def __init__(self):
        self.sent = []

    def send(self, topic, key=None, value=None):
        self.sent.append((topic, key, value))


def test_consumer_routes_bad_messages_to_dlq_and_good_to_inference():
    import json
    from app.realtime import DLQ_TOPIC, INFERENCE_V1_TOPIC, RealtimeFeaturesConsumer
    c = RealtimeFeaturesConsumer()
    c._producer = _Producer()
    c._handle(_Msg("not json"))
    c._handle(_Msg(json.dumps({**FEATURES_MSG, "kind": "observation"})))
    c._handle(_Msg(json.dumps(FEATURES_MSG)))
    topics = [s[0] for s in c._producer.sent]
    assert topics == [DLQ_TOPIC, DLQ_TOPIC, INFERENCE_V1_TOPIC]
    assert c.dead_lettered == 2 and c.processed == 1
    assert c._producer.sent[0][2]["source_offset"] == 7 and c._producer.sent[0][1] == SESSION
