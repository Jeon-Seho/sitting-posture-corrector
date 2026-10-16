"""
(D-21) 실시간 계약 v1: posture.features.v1 → posture.inference.v1.

- 메시지 키는 session_id (같은 세션의 시작·특징·종료 순서 보장).
- session_started / session_ended 는 바꾸지 않고 그대로 넘긴다(계약 규칙).
- features 는 입력 v2 구간 1개 → 관측 v2 1개.
  점수는 팀 기준 규칙(reference-feature-rule-v1, 팀 model/inference/service.py와 같은 식):
      점수 = min(1, max(|head_gap|/0.22, |lateral_offset|/0.20, |shoulder_tilt|/0.03) * 0.7)
  측정 중(running)·품질 good·특징 있음·현재/기준 품질 ≥ 0.65 일 때만 유효하고, 그 외에는
  valid=false·점수 0·유형 none. 점수는 보정된 확률이 아니라 규칙 점수다.
- LSTM(입력 v2 기준)은 모델이 정해지면 바꾼다(회의 안건 8 보류). 기존 posture.summary 경로는 그대로 둔다.
- (D-36) 처리할 수 없는 메시지는 posture.dlq로 넘기고 다음 메시지로 간다(파티션이 막히지 않게).
  DLQ 메시지 형식은 api-server DeadLetterPublisher와 같다.
"""
import json
import logging
import math
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import KafkaError

logger = logging.getLogger("inference-service.realtime")

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:19092")
FEATURES_V1_TOPIC = os.getenv("KAFKA_TOPIC_POSTURE_FEATURES_V1", "posture.features.v1")
INFERENCE_V1_TOPIC = os.getenv("KAFKA_TOPIC_POSTURE_INFERENCE_V1", "posture.inference.v1")
V1_CONSUMER_GROUP_ID = os.getenv("KAFKA_V1_CONSUMER_GROUP_ID", "inference-service-v1")
DLQ_TOPIC = os.getenv("KAFKA_TOPIC_POSTURE_DLQ", "posture.dlq")
DLQ_MAX_PAYLOAD_CHARS = 256 * 1024
REALTIME_ENABLED = os.getenv("REALTIME_V1_ENABLED", "true").lower() != "false"

MODEL_VERSION = "reference-feature-rule-v1"
MINIMUM_FEATURE_QUALITY = 0.65
HEAD_GAP_SCALE = 0.22
LATERAL_OFFSET_SCALE = 0.20
SHOULDER_TILT_SCALE = 0.03
REFERENCE_SCORE_SCALE = 0.7
PASS_THROUGH_KINDS = ("session_started", "session_ended")


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def score_feature_deltas(features: dict) -> Tuple[float, str]:
    head = abs(features["head_gap_delta"]) / HEAD_GAP_SCALE
    lateral = abs(features["lateral_offset_delta"]) / LATERAL_OFFSET_SCALE
    tilt = abs(features["shoulder_tilt_delta"]) / SHOULDER_TILT_SCALE
    score = min(1.0, max(head, lateral, tilt) * REFERENCE_SCORE_SCALE)
    if score == 0:
        return 0.0, "none"
    if lateral > head and lateral > tilt:
        # 원본 양수는 거울 화면의 왼쪽 기울기
        return score, "left_lean" if features["lateral_offset_delta"] > 0 else "right_lean"
    return score, "unspecified"


def observation_from_features(body: dict) -> dict:
    """입력 v2 구간 1개 → 관측 v2."""
    features = body.get("features")
    valid = (
        body.get("phase") == "running"
        and body.get("measurement_quality") == "good"
        and isinstance(features, dict)
        and all(_finite(features.get(k)) for k in (
            "head_gap_delta", "lateral_offset_delta", "shoulder_tilt_delta",
            "current_quality", "baseline_quality"))
        and features["current_quality"] >= MINIMUM_FEATURE_QUALITY
        and features["baseline_quality"] >= MINIMUM_FEATURE_QUALITY
    )
    score, deviation_type = (score_feature_deltas(features) if valid else (0.0, "none"))
    return {
        "schema_version": "2.0",
        "sequence": body["sequence"],
        "start_ms": body["start_ms"],
        "end_ms": body["end_ms"],
        "phase": body["phase"],
        "valid": bool(valid),
        "collapse_probability": score,
        "deviation_type": deviation_type,
        "model_version": MODEL_VERSION,
    }


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def process_features_message(msg: dict, now: Optional[str] = None) -> Tuple[Optional[dict], Optional[str]]:
    """
    posture.features.v1 메시지 1개를 posture.inference.v1 메시지 1개로 바꾼다.
    반환: (보낼 메시지, 건너뛴 이유). 보낼 메시지가 None이면 이유가 있다.
    """
    if not isinstance(msg, dict):
        return None, "객체가 아님"
    session_id = msg.get("session_id")
    kind = msg.get("kind")
    body = msg.get("body")
    if msg.get("schema_version") != "1.0" or not session_id or not isinstance(body, dict):
        return None, "봉투 형식이 맞지 않음(schema_version/session_id/body)"
    if kind in PASS_THROUGH_KINDS:
        return msg, None  # 바꾸지 않고 그대로
    if kind != "features":
        return None, f"모르는 kind: {kind}"
    for key in ("sequence", "start_ms", "end_ms", "phase", "measurement_quality"):
        if key not in body:
            return None, f"body.{key} 없음"
    try:
        observation = observation_from_features(body)
    except (TypeError, KeyError, ValueError) as exc:
        return None, f"관측 계산 실패: {exc}"
    return {
        "schema_version": "1.0",
        "message_id": str(uuid.uuid4()),
        "session_id": session_id,
        "user_id": msg.get("user_id"),
        "produced_at": now or _now_utc(),
        "kind": "observation",
        "body": observation,
    }, None


def dead_letter(source_topic: str, partition: int, offset: int, key: Optional[str],
                reason: str, payload: Optional[str], now: Optional[str] = None) -> dict:
    """(D-36) DLQ 메시지. api-server DeadLetterPublisher와 같은 필드."""
    truncated = payload is not None and len(payload) > DLQ_MAX_PAYLOAD_CHARS
    return {
        "schema_version": "1.0",
        "failed_at": now or _now_utc(),
        "consumer": V1_CONSUMER_GROUP_ID,
        "source_topic": source_topic,
        "source_partition": partition,
        "source_offset": offset,
        "key": key,
        "reason": reason,
        "payload": payload[:DLQ_MAX_PAYLOAD_CHARS] if truncated else payload,
        "payload_truncated": truncated,
    }


class RealtimeFeaturesConsumer:
    """posture.features.v1 → posture.inference.v1 (별도 스레드, 별도 컨슈머 그룹)."""

    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._producer: Optional[KafkaProducer] = None
        self.processed = 0
        self.skipped = 0
        self.dead_lettered = 0

    def start(self) -> None:
        if not REALTIME_ENABLED or self._thread is not None:
            if not REALTIME_ENABLED:
                logger.info("REALTIME_V1_ENABLED=false — features.v1 소비 비활성화")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="realtime-v1-consumer", daemon=True)
        self._thread.start()
        logger.info("v1 컨슈머 시작 (%s → %s, group=%s)", FEATURES_V1_TOPIC, INFERENCE_V1_TOPIC, V1_CONSUMER_GROUP_ID)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=10)
            self._thread = None
        if self._producer is not None:
            self._producer.flush(timeout=5)
            self._producer.close(timeout=5)
            self._producer = None

    def status(self) -> dict:
        return {"enabled": REALTIME_ENABLED, "running": self._thread is not None,
                "processed": self.processed, "skipped": self.skipped, "deadLettered": self.dead_lettered}

    def _run(self) -> None:
        try:
            consumer = KafkaConsumer(
                FEATURES_V1_TOPIC,
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                group_id=V1_CONSUMER_GROUP_ID,
                auto_offset_reset="earliest",
                enable_auto_commit=True,
                key_deserializer=lambda k: k.decode("utf-8") if k is not None else None,
                value_deserializer=lambda v: v.decode("utf-8"),
                consumer_timeout_ms=1000,
            )
            self._producer = KafkaProducer(
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
                key_serializer=lambda k: k.encode("utf-8") if k is not None else None,
                acks="all",
                retries=3,
                linger_ms=5,
            )
        except KafkaError as exc:
            logger.error("v1 컨슈머/프로듀서 생성 실패: %s", exc)
            return
        try:
            while not self._stop_event.is_set():
                for message in consumer:
                    if self._stop_event.is_set():
                        break
                    self._handle(message)
        except Exception:  # noqa: BLE001 - 스레드가 조용히 죽지 않게
            logger.exception("v1 컨슈머 루프 예외, 스레드 종료")
        finally:
            consumer.close()

    def _handle(self, message) -> None:
        raw = message.value
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError as exc:
            self._dead_letter(message, f"JSON 파싱 실패: {exc}")
            return
        out, reason = process_features_message(msg)
        if out is None:
            self._dead_letter(message, reason)
            return
        try:
            self._producer.send(INFERENCE_V1_TOPIC, key=out["session_id"], value=out)
            self.processed += 1
        except KafkaError as exc:
            self.skipped += 1
            logger.warning("inference.v1 발행 실패 (session_id=%s): %s", out.get("session_id"), exc)

    def _dead_letter(self, message, reason: str) -> None:
        self.skipped += 1
        logger.warning("features.v1 메시지를 DLQ로 (%s-%s@%s, key=%s): %s",
                       message.topic, message.partition, message.offset, message.key, reason)
        try:
            self._producer.send(DLQ_TOPIC, key=message.key,
                                value=dead_letter(message.topic, message.partition, message.offset,
                                                  message.key, reason, message.value))
            self.dead_lettered += 1
        except KafkaError as exc:
            logger.error("DLQ 발행 실패 (%s-%s@%s): %s", message.topic, message.partition, message.offset, exc)


realtime_consumer = RealtimeFeaturesConsumer()
