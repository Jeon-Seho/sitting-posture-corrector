"""
자세 분석 시스템 추론 서비스 진입점 — Kafka 컨슈머 하나.

(D-21) 실시간 Kafka 계약: posture.features(좌표 구간) → 프레임 RF 점수(app/realtime.py, 계획 0098) → posture.inference,
처리 못 한 메시지는 posture.dlq(D-36). MySQL에는 접근하지 않는다.

(D-38·D-63, 2026-10-21) 옛 posture.summary → posture.inference 컨슈머와 시험 LSTM(app/model.py·train_test_model.py)은 지웠다.
점수 계산은 HTTP /infer와 같은 model/inference 코드를 쓴다(계획 0098, ADR 0050).
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
import redis
from kafka import KafkaAdminClient
from kafka.errors import KafkaError

from app.realtime import realtime_consumer

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("inference-service")

# kafka-python 라이브러리 자체의 로거(`kafka.conn`, `kafka.coordinator` 등)는
# INFO 레벨에서 커넥션/브로커 버전 프로빙마다 여러 줄씩 로그를 남긴다.
# /health가 Docker healthcheck(기본 15초 간격)로 계속 호출되면서 매번
# 새 KafkaAdminClient를 만들다 보니 이 로그가 끊임없이 쌓여서, 정작
# 중요한 실시간 처리·DLQ 같은 우리 애플리케이션
# 로그가 `docker compose logs --tail=N`의 짧은 창 밖으로 금방 밀려나는
# 문제가 있었다. kafka-python 쪽 로거만 WARNING 이상으로 올려서
# 연결 실패 같은 진짜 문제는 여전히 보이돼 정상 커넥션 로그는 숨긴다.
logging.getLogger("kafka").setLevel(os.getenv("KAFKA_LOG_LEVEL", "WARNING"))

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:19092")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # (D-21) 실시간 Kafka 계약: posture.features → posture.inference
    realtime_consumer.start()
    yield
    # 종료 시 정리
    realtime_consumer.stop()


app = FastAPI(title="posture-inference-service", version="0.3.0", lifespan=lifespan)


def check_redis() -> dict:
    try:
        client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, socket_connect_timeout=3)
        client.ping()
        return {"status": "UP", "host": REDIS_HOST, "port": REDIS_PORT}
    except Exception as exc:  # noqa: BLE001 - 헬스체크는 원인 종류와 무관하게 DOWN 처리
        return {"status": "DOWN", "error": str(exc)}


def check_kafka() -> dict:
    try:
        admin = KafkaAdminClient(
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            request_timeout_ms=3000,
            client_id="inference-service-healthcheck",
        )
        topics = admin.list_topics()
        admin.close()
        return {"status": "UP", "bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS, "topics": topics}
    except KafkaError as exc:
        return {"status": "DOWN", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"status": "DOWN", "error": str(exc)}


@app.get("/health")
def health():
    redis_result = check_redis()
    kafka_result = check_kafka()
    realtime_result = realtime_consumer.status()
    # (계획 0098) 실시간 소비가 켜져 있는데 모델을 못 불러왔으면 DOWN(규칙으로 대체하지 않음)
    model_ready = not realtime_result["enabled"] or realtime_result["modelVersion"] is not None
    overall_up = redis_result["status"] == "UP" and kafka_result["status"] == "UP" and model_ready

    body = {
        "status": "UP" if overall_up else "DOWN",
        "components": {
            "redis": redis_result,
            "kafka": kafka_result,
            "realtime": realtime_result,
        },
    }
    return JSONResponse(
        content=body,
        status_code=status.HTTP_200_OK if overall_up else status.HTTP_503_SERVICE_UNAVAILABLE,
    )


@app.get("/")
def root():
    return {"service": "posture-inference-service", "docs": "/docs", "health": "/health"}

