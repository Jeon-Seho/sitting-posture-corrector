"""
(D-21) posture.features → posture.inference 변환 단위 테스트.

(계획 0098) features 본문은 좌표 구간(프레임 9점 + 기준 9점)이고, 점수는 HTTP /infer와 같은 프레임 RF다.
팀 계약 예제(contracts/realtime/examples)와 합성 좌표만 쓴다. Kafka에는 접속하지 않는다.
"""
import copy
import json
from pathlib import Path

import pytest

from app.realtime import (
    RealtimeFeaturesConsumer, dead_letter, load_inference, observation_from_keypoints, process_features_message,
)
from model.inference.frame_model import RF_MODEL_VERSION
from model.inference.service import REFERENCE_MODEL_VERSION, FrameInference

EXAMPLES = Path(__file__).resolve().parents[3] / "contracts" / "realtime" / "examples"
FEATURES_MSG = json.loads((EXAMPLES / "features-features.json").read_text(encoding="utf-8"))
STARTED_MSG = json.loads((EXAMPLES / "features-session-started.json").read_text(encoding="utf-8"))
SESSION = FEATURES_MSG["session_id"]
OBSERVATION_FIELDS = {"schema_version", "sequence", "start_ms", "end_ms", "phase", "valid",
                      "collapse_probability", "deviation_type", "model_version"}


@pytest.fixture(scope="module")
def rf():
    inference = load_inference()
    assert inference is not None and inference.rf is not None
    return inference


def body(**change):
    return {**copy.deepcopy(FEATURES_MSG["body"]), **change}


def test_features_become_observation_envelope(rf):
    out, reason = process_features_message(copy.deepcopy(FEATURES_MSG), rf, now="2026-10-06T06:00:01.020Z")
    assert reason is None
    assert out["kind"] == "observation"
    assert out["session_id"] == SESSION and out["user_id"] == "synthetic-user-1"
    assert out["schema_version"] == "1.0" and out["produced_at"] == "2026-10-06T06:00:01.020Z"
    assert out["message_id"] != FEATURES_MSG["message_id"]
    observation = out["body"]
    # 관측 계약(posture-observation)에는 invalid_reason이 없다
    assert set(observation) == OBSERVATION_FIELDS
    assert observation["valid"] is True
    assert observation["model_version"] == RF_MODEL_VERSION
    assert 0 < observation["collapse_probability"] <= 1
    # 합성 예시는 코가 기준보다 0.06 내려간 자세 — HTTP 응답 예시와 같이 이탈 쪽
    assert observation["collapse_probability"] >= 0.7


def test_session_started_and_ended_pass_through_unchanged(rf):
    out, _ = process_features_message(copy.deepcopy(STARTED_MSG), rf)
    assert out == STARTED_MSG
    ended = {**STARTED_MSG, "kind": "session_ended", "body": {"end_ms": 3000}}
    out, _ = process_features_message(copy.deepcopy(ended), rf)
    assert out == ended


@pytest.mark.parametrize("change", [{"phase": "rest"}, {"phase": "away"}, {"frames": [None, None]}, {"frames": []}])
def test_excluded_or_empty_intervals_score_zero(rf, change):
    observation = observation_from_keypoints(body(**change), rf)
    assert observation["valid"] is False
    assert observation["collapse_probability"] == 0.0 and observation["deviation_type"] == "none"
    assert observation["phase"] == body(**change)["phase"]


def test_low_visibility_on_any_model_point_is_unmeasurable(rf):
    frames = copy.deepcopy(FEATURES_MSG["body"]["frames"])
    frames[0][5][2] = 0.5  # 입 왼쪽 visibility < 0.65 — 학습 조건과 같이 그 프레임을 쓰지 않는다
    assert observation_from_keypoints(body(frames=frames), rf)["valid"] is False


def test_rule_mode_scores_the_same_keypoints(monkeypatch):
    monkeypatch.setenv("POSEGOOD_INFERENCE_MODEL", "rule")
    inference = load_inference()
    assert inference is not None and inference.rf is None
    observation = observation_from_keypoints(body(), inference)
    assert observation["valid"] is True and observation["model_version"] == REFERENCE_MODEL_VERSION


def test_bad_model_configuration_loads_nothing(monkeypatch, tmp_path):
    monkeypatch.setenv("POSEGOOD_INFERENCE_MODEL", "lstm")
    assert load_inference() is None
    monkeypatch.setenv("POSEGOOD_INFERENCE_MODEL", "frame-rf-100x")
    monkeypatch.setenv("POSEGOOD_MODEL_DIR", str(tmp_path))  # 가중치 없음
    assert load_inference() is None


@pytest.mark.parametrize("bad", [
    "not a dict",
    {**FEATURES_MSG, "schema_version": "2.0"},
    {**FEATURES_MSG, "session_id": None},
    {**FEATURES_MSG, "kind": "observation"},
    {**FEATURES_MSG, "body": {"sequence": 0}},
    # 옛 특징 변화량 본문은 더 받지 않는다
    {**FEATURES_MSG, "body": {
        "schema_version": "2.0", "feature_version": "shoulder-relative-deltas-v1",
        "baseline_id": "00000000-0000-4000-8000-000000000001", "sequence": 0, "start_ms": 0, "end_ms": 500,
        "phase": "running", "measurement_quality": "good",
        "features": {"head_gap_delta": 0.0, "lateral_offset_delta": 0.2, "shoulder_tilt_delta": 0.0,
                     "current_quality": 0.9, "baseline_quality": 0.8}}},
    {**FEATURES_MSG, "body": body(end_ms=2000)},
    {**FEATURES_MSG, "body": body(baseline=FEATURES_MSG["body"]["baseline"][:8])},
    {**FEATURES_MSG, "body": body(landmarks=[])},
])
def test_bad_messages_are_skipped_not_raised(rf, bad):
    out, reason = process_features_message(copy.deepcopy(bad), rf)
    assert out is None and reason


def test_invalid_baseline_geometry_is_skipped(rf):
    # 어깨 두 점이 겹치면 기준을 만들 수 없다
    baseline = copy.deepcopy(FEATURES_MSG["body"]["baseline"])
    baseline[8] = list(baseline[7])
    out, reason = process_features_message({**FEATURES_MSG, "body": body(baseline=baseline)}, rf)
    assert out is None and reason == "기준 9점이 유효하지 않음"


def test_skip_reason_does_not_carry_coordinates(rf):
    frames = copy.deepcopy(FEATURES_MSG["body"]["frames"])
    frames[0][0][0] = 1.2345678  # 범위(-1..2) 안이지만 visibility 범위를 벗어난 값도 함께
    frames[0][0][2] = 1.7654321
    out, reason = process_features_message({**FEATURES_MSG, "body": body(frames=frames)}, rf)
    assert out is None
    assert "1.2345678" not in reason and "1.7654321" not in reason


def test_dead_letter_message_fields():
    m = dead_letter("posture.features", 1, 42, SESSION, "모르는 kind: x", '{"kind":"x"}', now="2026-10-09T05:00:00.000Z")
    assert m == {
        "schema_version": "1.0", "failed_at": "2026-10-09T05:00:00.000Z", "consumer": "inference-service",
        "source_topic": "posture.features", "source_partition": 1, "source_offset": 42, "key": SESSION,
        "reason": "모르는 kind: x", "payload": '{"kind":"x"}', "payload_truncated": False,
    }


def test_dead_letter_truncates_huge_payload():
    from app.realtime import DLQ_MAX_PAYLOAD_CHARS
    m = dead_letter("t", 0, 0, None, "r", "x" * (DLQ_MAX_PAYLOAD_CHARS + 5))
    assert len(m["payload"]) == DLQ_MAX_PAYLOAD_CHARS and m["payload_truncated"] is True


class _Msg:
    def __init__(self, value, topic="posture.features", partition=0, offset=7, key=SESSION):
        self.value, self.topic, self.partition, self.offset, self.key = value, topic, partition, offset, key


class _Producer:
    def __init__(self):
        self.sent = []

    def send(self, topic, key=None, value=None):
        self.sent.append((topic, key, value))


def test_consumer_routes_bad_messages_to_dlq_and_good_to_inference(rf):
    from app.realtime import DLQ_TOPIC, INFERENCE_TOPIC
    c = RealtimeFeaturesConsumer(rf)
    c._producer = _Producer()
    c._handle(_Msg("not json"))
    c._handle(_Msg(json.dumps({**FEATURES_MSG, "kind": "observation"})))
    c._handle(_Msg(json.dumps(FEATURES_MSG)))
    topics = [s[0] for s in c._producer.sent]
    assert topics == [DLQ_TOPIC, DLQ_TOPIC, INFERENCE_TOPIC]
    assert c.dead_lettered == 2 and c.processed == 1
    assert c._producer.sent[0][2]["source_offset"] == 7 and c._producer.sent[0][1] == SESSION
    assert c._producer.sent[2][2]["body"]["model_version"] == RF_MODEL_VERSION


def test_consumer_does_not_start_without_a_model(monkeypatch):
    monkeypatch.setenv("POSEGOOD_INFERENCE_MODEL", "lstm")
    c = RealtimeFeaturesConsumer()
    c.start()
    status = c.status()
    assert status["running"] is False and status["modelVersion"] is None


def test_health_is_down_when_realtime_has_no_model(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "check_redis", lambda: {"status": "UP"})
    monkeypatch.setattr(main, "check_kafka", lambda: {"status": "UP"})
    monkeypatch.setattr(main, "realtime_consumer", RealtimeFeaturesConsumer())
    assert main.health().status_code == 503
    monkeypatch.setattr(main, "realtime_consumer", RealtimeFeaturesConsumer(FrameInference()))
    assert main.health().status_code == 200
