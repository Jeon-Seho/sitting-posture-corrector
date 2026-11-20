"""T-15 추론 동등성: Kafka 추론(app.realtime)과 HTTP /infer(model/inference)가 같은 좌표에 같은 관측을 낸다.

(계획 0098) 두 경로 모두 model/inference의 특징 계산·프레임 RF를 쓴다. Kafka 관측에는 계약대로 invalid_reason만 없다.
입력은 저장소의 합성 좌표 예시다(실제 참여자 좌표 아님).
"""

import json
from pathlib import Path

import pytest

from app.realtime import load_inference, observation_from_keypoints
from model.inference.schemas import InferenceRequest

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
REQUESTS = [
    CONTRACTS / "examples" / "inference" / "synthetic-inference-request.json",
    CONTRACTS / "examples" / "inference" / "synthetic-inference-request-with-null-frames.json",
    CONTRACTS / "realtime" / "examples" / "features-features.json",
]


def request_body(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["body"] if "body" in data else data


@pytest.mark.parametrize("mode", ["frame-rf-100x", "rule"])
@pytest.mark.parametrize("path", REQUESTS, ids=lambda p: p.name)
def test_kafka_observation_matches_http_infer(monkeypatch, mode, path):
    monkeypatch.setenv("POSEGOOD_INFERENCE_MODEL", mode)
    inference = load_inference()
    assert inference is not None
    body = request_body(path)
    expected = dict(inference.predict(InferenceRequest.model_validate(body)))
    expected.pop("invalid_reason")
    assert observation_from_keypoints(body, inference) == expected
