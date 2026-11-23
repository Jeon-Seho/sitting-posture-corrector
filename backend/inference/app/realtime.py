"""
(D-21) 실시간 Kafka 계약: posture.features → posture.inference.

- 메시지 키는 session_id (같은 세션의 시작·특징·종료 순서 보장).
- session_started / session_ended 는 바꾸지 않고 그대로 넘긴다(계약 규칙).
- features 는 좌표 구간 1개(프레임 9점 + 기준 9점, contracts/inference-request.schema.json) → 관측 1개.
  (계획 0098, ADR 0050) HTTP /infer와 같은 코드(model/inference)로 특징 6개를 계산하고 프레임 RF로 점수를 낸다.
  POSEGOOD_INFERENCE_MODEL=rule이면 같은 좌표로 기준 규칙 점수를 낸다. 점수는 보정된 확률이 아니다.
- 모델을 불러오지 못하면 소비를 시작하지 않는다(규칙으로 몰래 바꾸지 않음). 메시지는 Kafka에 남는다.
- 관측 계약(posture-observation)에는 invalid_reason이 없어서 posture.inference에는 넣지 않는다.
- (D-36) 처리할 수 없는 메시지는 posture.dlq로 넘기고 다음 메시지로 간다(파티션이 막히지 않게).
  DLQ 메시지 형식은 api-server DeadLetterPublisher와 같다.
"""
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import KafkaError
from pydantic import ValidationError

from model.inference.frame_model import DEFAULT_MODEL_DIR, RF_MODEL, PredictionError, load_frame_model
from model.inference.schemas import InferenceRequest
from model.inference.service import FrameInference, InvalidBaseline

logger = logging.getLogger("inference-service.realtime")

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:19092")
FEATURES_TOPIC = os.getenv("KAFKA_TOPIC_POSTURE_FEATURES", "posture.features")
INFERENCE_TOPIC = os.getenv("KAFKA_TOPIC_POSTURE_INFERENCE", "posture.inference")
CONSUMER_GROUP_ID = os.getenv("KAFKA_CONSUMER_GROUP_ID", "inference-service")
DLQ_TOPIC = os.getenv("KAFKA_TOPIC_POSTURE_DLQ", "posture.dlq")
DLQ_MAX_PAYLOAD_CHARS = 256 * 1024
REALTIME_ENABLED = os.getenv("REALTIME_ENABLED", "true").lower() != "false"
PASS_THROUGH_KINDS = ("session_started", "session_ended")


def load_inference() -> Optional[FrameInference]:
    """POSEGOOD_INFERENCE_MODEL(기본 frame-rf-100x, 또는 rule)대로 추론기를 만든다. 실패하면 None."""
    mode = os.getenv("POSEGOOD_INFERENCE_MODEL", RF_MODEL)
    if mode == "rule":
        return FrameInference()
    if mode != RF_MODEL:
        logger.error("POSEGOOD_INFERENCE_MODEL 값이 맞지 않음(frame-rf-100x 또는 rule)")
        return None
    try:
        directory = Path(os.getenv("POSEGOOD_MODEL_DIR", str(DEFAULT_MODEL_DIR)))
        return FrameInference(load_frame_model(directory))
    except Exception:  # noqa: BLE001 - 원인과 무관하게 소비하지 않는다
        logger.exception("프레임 RF 모델을 불러오지 못함")
        return None


def observation_from_keypoints(body: dict, inference: FrameInference) -> dict:
    """좌표 구간 1개 → 관측. 형식이 틀리면 ValidationError, 기준 9점이 틀리면 InvalidBaseline."""
    observation = dict(inference.predict(InferenceRequest.model_validate(body)))
    observation.pop("invalid_reason", None)
    return observation


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def process_features_message(msg: dict, inference: FrameInference,
                             now: Optional[str] = None) -> Tuple[Optional[dict], Optional[str]]:
    """
    posture.features 메시지 1개를 posture.inference 메시지 1개로 바꾼다.
    반환: (보낼 메시지, 건너뛴 이유). 보낼 메시지가 None이면 이유가 있다.
    이유에는 좌표 값을 넣지 않는다.
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
    try:
        observation = observation_from_keypoints(body, inference)
    except ValidationError as exc:
        fields = sorted({".".join(str(part) for part in error["loc"][:1]) for error in exc.errors()})
        return None, f"좌표 구간 형식이 맞지 않음: {', '.join(fields) or 'body'}"
    except InvalidBaseline:
        return None, "기준 9점이 유효하지 않음"
    except PredictionError:
        return None, "모델 계산 실패"
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
        "consumer": CONSUMER_GROUP_ID,
        "source_topic": source_topic,
        "source_partition": partition,
        "source_offset": offset,
        "key": key,
        "reason": reason,
        "payload": payload[:DLQ_MAX_PAYLOAD_CHARS] if truncated else payload,
        "payload_truncated": truncated,
    }


class RealtimeFeaturesConsumer:
    """posture.features → posture.inference (별도 스레드, 별도 컨슈머 그룹)."""

    def __init__(self, inference: Optional[FrameInference] = None) -> None:
        self._inference = inference
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._producer: Optional[KafkaProducer] = None
        self.processed = 0
        self.skipped = 0
        self.dead_lettered = 0

    def start(self) -> None:
        if not REALTIME_ENABLED or self._thread is not None:
            if not REALTIME_ENABLED:
                logger.info("REALTIME_ENABLED=false — features 소비 비활성화")
            return
        if self._inference is None:
            self._inference = load_inference()
        if self._inference is None:
            logger.error("추론 모델이 없어 features 소비를 시작하지 않음")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="realtime-consumer", daemon=True)
        self._thread.start()
        logger.info("실시간 컨슈머 시작 (%s → %s, group=%s, model=%s)", FEATURES_TOPIC, INFERENCE_TOPIC,
                    CONSUMER_GROUP_ID, self._inference.model_version)

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
                "modelVersion": self._inference.model_version if self._inference is not None else None,
                "processed": self.processed, "skipped": self.skipped, "deadLettered": self.dead_lettered}

    def _run(self) -> None:
        try:
            consumer = KafkaConsumer(
                FEATURES_TOPIC,
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                group_id=CONSUMER_GROUP_ID,
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
            logger.error("실시간 컨슈머/프로듀서 생성 실패: %s", exc)
            return
        try:
            while not self._stop_event.is_set():
                for message in consumer:
                    if self._stop_event.is_set():
                        break
                    self._handle(message)
        except Exception:  # noqa: BLE001 - 스레드가 조용히 죽지 않게
            logger.exception("실시간 컨슈머 루프 예외, 스레드 종료")
        finally:
            consumer.close()

    def _handle(self, message) -> None:
        raw = message.value
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError as exc:
            self._dead_letter(message, f"JSON 파싱 실패: {exc}")
            return
        out, reason = process_features_message(msg, self._inference)
        if out is None:
            self._dead_letter(message, reason)
            return
        try:
            self._producer.send(INFERENCE_TOPIC, key=out["session_id"], value=out)
            self.processed += 1
        except KafkaError as exc:
            self.skipped += 1
            logger.warning("inference 발행 실패 (session_id=%s): %s", out.get("session_id"), exc)

    def _dead_letter(self, message, reason: str) -> None:
        self.skipped += 1
        logger.warning("features 메시지를 DLQ로 (%s-%s@%s, key=%s): %s",
                       message.topic, message.partition, message.offset, message.key, reason)
        try:
            self._producer.send(DLQ_TOPIC, key=message.key,
                                value=dead_letter(message.topic, message.partition, message.offset,
                                                  message.key, reason, message.value))
            self.dead_lettered += 1
        except KafkaError as exc:
            logger.error("DLQ 발행 실패 (%s-%s@%s): %s", message.topic, message.partition, message.offset, exc)


realtime_consumer = RealtimeFeaturesConsumer()
