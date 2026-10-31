"""Kafka transport for frame inference v3 (plan 0064).

posture.inference-request.v3 -> predict_frames (the same stateless code as POST /v3/infer)
-> posture.inference-result.v3, key session_id. The API judgement engine owns all timing rules.

Off unless POSEGOOD_KAFKA_BOOTSTRAP_SERVERS is set; HTTP keeps working either way. Requests are read
from the latest offset: a result the API no longer waits for is useless. A message that cannot be read
goes to posture.dlq with its reason only. Its payload holds coordinates, so it is never copied to the
DLQ or to logs.
"""

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .schemas import InferenceRequestV3
from .service import predict_frames


logger = logging.getLogger("posegood.inference.kafka")

UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
SCHEMA_VERSION = "1.0"


class RequestMessage(BaseModel):
    """contracts/realtime/kafka-inference-request.v1.schema.json"""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    schema_version: Literal["1.0"]
    message_id: str = Field(pattern=UUID_PATTERN)
    session_id: str = Field(pattern=UUID_PATTERN)
    sequence: int = Field(ge=0)
    produced_at: str = Field(min_length=1, max_length=64)
    body: InferenceRequestV3


class InvalidMessage(ValueError):
    """The request cannot be read; the reason never contains input values."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def result_message(raw, now: Optional[str] = None) -> dict:
    """One request message (bytes or str) -> its result message (kafka-inference-result.v1)."""
    try:
        request = RequestMessage.model_validate_json(raw)
    except ValidationError as error:
        # Field locations only: pydantic's messages would echo the rejected values.
        fields = sorted({".".join(str(part) for part in item["loc"]) for item in error.errors()})
        raise InvalidMessage("contract mismatch: " + ", ".join(fields[:5])) from None
    return {
        "schema_version": SCHEMA_VERSION,
        "message_id": str(uuid.uuid4()),
        "session_id": request.session_id,
        "sequence": request.sequence,
        "produced_at": now or _now(),
        "body": predict_frames(request.body),
    }


def dead_letter(consumer: str, topic: str, partition: int, offset: int, key: Optional[str], reason: str,
                now: Optional[str] = None) -> dict:
    """posture.dlq record in the processing services' shape, without the payload (coordinates)."""
    return {
        "schema_version": SCHEMA_VERSION,
        "failed_at": now or _now(),
        "consumer": consumer,
        "source_topic": topic,
        "source_partition": partition,
        "source_offset": offset,
        "key": key,
        "reason": reason,
        "payload": None,
        "payload_truncated": False,
    }


class Settings:
    def __init__(self, environ=os.environ) -> None:
        self.bootstrap_servers = environ.get("POSEGOOD_KAFKA_BOOTSTRAP_SERVERS", "").strip()
        self.request_topic = environ.get("POSEGOOD_KAFKA_REQUEST_TOPIC", "posture.inference-request.v3")
        self.result_topic = environ.get("POSEGOOD_KAFKA_RESULT_TOPIC", "posture.inference-result.v3")
        self.dlq_topic = environ.get("POSEGOOD_KAFKA_DLQ_TOPIC", "posture.dlq")
        self.group_id = environ.get("POSEGOOD_KAFKA_GROUP_ID", "inference-v3")

    @property
    def enabled(self) -> bool:
        return bool(self.bootstrap_servers)


class KafkaWorker:
    """Consumes requests on its own thread and publishes one result per request."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or Settings()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self.processed = 0
        self.dead_lettered = 0

    def start(self) -> None:
        if not self.settings.enabled or self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="inference-kafka-v3", daemon=True)
        self._thread.start()
        logger.info("kafka inference started (%s -> %s, group=%s)",
                    self.settings.request_topic, self.settings.result_topic, self.settings.group_id)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=10)
            self._thread = None

    def status(self) -> dict:
        return {"enabled": self.settings.enabled, "running": self._thread is not None,
                "processed": self.processed, "dead_lettered": self.dead_lettered}

    def _run(self) -> None:
        from kafka import KafkaConsumer, KafkaProducer  # only needed when Kafka is on
        from kafka.errors import KafkaError

        settings = self.settings
        try:
            consumer = KafkaConsumer(
                settings.request_topic,
                bootstrap_servers=settings.bootstrap_servers,
                group_id=settings.group_id,
                auto_offset_reset="latest",
                enable_auto_commit=True,
                fetch_max_wait_ms=50,
                # The API creates the topics when it switches to Kafka: notice them within seconds.
                metadata_max_age_ms=10000,
                consumer_timeout_ms=1000,
                key_deserializer=lambda key: key.decode("utf-8") if key is not None else None,
            )
            producer = KafkaProducer(
                bootstrap_servers=settings.bootstrap_servers,
                key_serializer=lambda key: key.encode("utf-8") if key is not None else None,
                value_serializer=lambda value: json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                acks="all",
                linger_ms=0,
            )
        except KafkaError as error:
            logger.error("kafka inference not started: %s", type(error).__name__)
            self._thread = None
            return
        try:
            while not self._stop.is_set():
                for message in consumer:
                    self._handle(producer, message, KafkaError)
                    if self._stop.is_set():
                        break
        except Exception:  # noqa: BLE001 - do not let the thread die silently
            logger.exception("kafka inference loop stopped")
        finally:
            consumer.close()
            producer.flush(timeout=5)
            producer.close(timeout=5)

    def _handle(self, producer, message, kafka_error) -> None:
        settings = self.settings
        try:
            result = result_message(message.value)
        except InvalidMessage as error:
            logger.warning("inference request to DLQ (%s-%s@%s): %s",
                           message.topic, message.partition, message.offset, error)
            record = dead_letter(settings.group_id, message.topic, message.partition, message.offset,
                                 message.key, str(error))
            try:
                producer.send(settings.dlq_topic, key=message.key, value=record)
                self.dead_lettered += 1
            except kafka_error as failed:
                logger.error("DLQ publish failed: %s", type(failed).__name__)
            return
        try:
            producer.send(settings.result_topic, key=result["session_id"], value=result)
            self.processed += 1
        except kafka_error as failed:
            logger.warning("inference result not published: %s", type(failed).__name__)


worker = KafkaWorker()
