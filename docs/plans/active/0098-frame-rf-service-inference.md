# 0098 프레임 RF를 서비스 추론에 연결

- 상태: in_progress (2026-11-19 시작, 브랜치 `feature/repo-frame-rf-inference`)
- 담당: ML(jisung)은 추론 서버(HTTP `/infer`, Kafka 소비자 `backend/inference`)와 계약을 담당한다. Java API의 키포인트 요청 전환(local `/infer`, Kafka `posture.features`)은 BE가 담당한다.
- 관련: [ADR 0050](../../decisions/0050-frame-rf-service-inference.md), [ADR 0020](../../decisions/0020-single-api-decision-engine.md), [ADR 0047](../../decisions/0047-posture-from-deviation-probability.md),
  [RF 후보](../../../model/pretrained/frame-rf-100x/README.md), [분석 요약](../../../model/docs/2026-11-19-ml-review/README.md)

## 목표

local 실시간 경로(기본)에서 규칙 점수 대신 `model/pretrained/frame-rf-100x`의 2단계 프레임 RF 점수로 판정한다.
시간 판정(3초 확정·3초 복귀·60초 재알림·측정 불가 처리)은 API 판정 엔진 그대로다. 이번 범위에서 바꾸지 않는다.

(2026-11-20 팀 결정) 실시간 판정은 Kafka 경로 **BE → `posture.features` → 추론 → `posture.inference` → 판정(처리 서비스) → BE**로 한다.
특징 계산은 추론에서 한다. 그래서 Kafka 추론 소비자도 같은 키포인트 입력과 RF를 쓴다(아래 「Kafka 경로」).

## 브랜치 기준과 병합 순서

1. 유진님의 `refactor/repo-remove-api-version-paths`를 먼저 병합한다(2026-11-20 #138로 병합됨). RF 브랜치 `feature/repo-frame-rf-inference`는 이 브랜치 위에 작업했으며 [이름 규칙 ADR 0049](../../decisions/0049-no-version-in-names.md)를 따른다.
2. RF 브랜치(PR #140)와 BE의 키포인트 요청 전환(local `/infer`와 Kafka `posture.features` 둘 다)을 함께 병합하고 배포한다. Kafka 경로에서는 옛 Java가 보낸 특징 변화량 본문이 DLQ로 간다. 현재 develop의 Java API는 `POST /infer`에 특징 변화량을 보낸다. RF 쪽 `/infer`는 프레임 9점과 기준 9점을 요구하므로, 이전 Java 요청은 422를 받는다. `POSEGOOD_INFERENCE_MODEL=rule`을 선택해도 키포인트 요청을 사용한다.

## 결정 (2026-11-19 사용자)

1. **특징 계산 위치: 추론 서버.** API는 관절 9개 원좌표와 기준 9점을 넘기고, Python이 학습 코드와 같은 식으로 6특징을 계산한다.
2. **임계값: 점수 변환.** RF 확률 p를 `s = 1.4·p (p ≤ 0.5)`, `s = 0.4 + 0.6·p (p > 0.5)`로 바꿔 보낸다. RF 0.5가 기존 기본 임계값 0.7에 맞고,
   앱 민감도(0.6/0.7/0.8)와 DB 정책을 그대로 쓴다. 0.6은 p≈0.43, 0.8은 p≈0.67에 해당한다. 보정된 확률이 아니다.
3. **9점 품질: 측정 불가.** RF 입력 9점 중 하나라도 visibility < 0.65이거나 0~1 밖이면 그 프레임은 쓰지 않는다(학습 조건과 같음). 규칙으로 대체하지 않는다.
4. **모델 실패 시 대체 없음.** 가중치를 불러오지 못하면 추론 서버는 `/health` 503, `/infer` 503을 낸다. 규칙으로 몰래 바꾸지 않는다.

## API → 추론 서버 계약 (`POST /infer`)

[키포인트 요청 스키마](../../../contracts/inference-request.schema.json)의 필드 이름은 snake_case다.

| 필드 | 값 |
| --- | --- |
| `schema_version` | `"3.0"` |
| `feature_version` | `"keypoints-9-v1"` (앱 좌표 구간과 같은 관절 순서: 코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨) |
| `baseline_id` | UUID 문자열(출력에 넣지 않음) |
| `sequence` / `start_ms` / `end_ms` / `phase` | 세션별 순번과 세션 상대 구간. `0 < end_ms − start_ms ≤ 1500`, phase는 running·rest·away |
| `frames` | 0~30개. 각 항목은 관절 9개 `[x, y, visibility]` 배열 또는 `null`(사람 없음 또는 앱이 판정 불가로 표시). x·y는 −1~2, visibility는 0~1 |
| `baseline` | 기준 자세 9점 `[x, y]`(DB 저장 평균, 0~1). visibility 없음 |

응답은 [관측](../../../contracts/posture-observation.schema.json)(`schema_version "2.0"`, sequence·start_ms·end_ms·phase·valid·collapse_probability·deviation_type·model_version)에
`invalid_reason`을 더한 것이다. `invalid_reason`은 `valid:true`면 `null`, 아니면 `"unmeasurable"`·`"head_turn"`(running) 또는 `null`(rest·away)이다.
BE가 자체 판정 가능 검사를 지워도 판정 불가 사유를 추론 서버에서 받을 수 있게 한다.
`valid:false`이면 `collapse_probability 0`, `deviation_type "none"`이다.

### 추론 서버 동작

- 모델은 환경변수 `POSEGOOD_INFERENCE_MODEL`로 고른다: `frame-rf-100x`(기본) 또는 `rule`.
  - `frame-rf-100x` → `model_version "frame-rf-100x-v1"`
  - `rule` → `model_version "reference-feature-rule-v1"` (키포인트에서 변화량을 계산한 뒤 기존 규칙 점수식을 적용)
- phase가 running이 아니면 `valid:false`.
- 프레임마다(`null` 제외):
  - **RF:** `model/analysis/frame_pilot/frames.py`의 `frame_features`와 같은 검사·특징(9점 모두 유한·0~1·visibility ≥ 0.65, FE와 같은 반올림,
    `replay_pilot.replay.geometry` 유효, 얼굴 길이 있음, 고개 돌림 `|turn − 기준 turn| > 0.15`이면 제외).
    통과한 프레임은 보정기(입력 6특징 + 기준 어깨 폭) → 다섯 번째 특징(어깨 높이, index 4)에서 `보정값/기준 어깨 폭`을 뺌 → 분류기 `predict_proba[:,1]`.
    `model/analysis/frame_pilot/inference.py`의 `FramePredictor.predict`와 같은 계산이다.
  - **규칙:** API `FrameFeatures`와 같은 판정 가능 검사(코·양어깨 visibility 0.65~1, 좌표 0.02~0.98, 어깨 폭 ≥ 64px, 양 귀 좌표 유한)와 같은 고개 돌림 검사.
- 쓸 수 있는 프레임이 없으면 `valid:false`.
- 점수:
  - RF: 쓸 수 있는 프레임 p의 평균에 점수 변환을 적용한다.
  - 규칙: 쓸 수 있는 프레임의 (head_gap, lateral, tilt) 평균에서 기준을 빼고 기존 `score_feature_deltas`를 적용한다.
- `deviation_type`: 두 모델 모두 쓸 수 있는 프레임의 앞 3개 변화량 평균으로 기존 규칙 방식(좌우 비율이 엄격히 가장 크면 left/right_lean, 아니면 unspecified)을 쓴다.
  점수가 0이면 `none`이다. RF는 방향을 예측하지 않으므로 표시용이다.
- 기준 9점의 기하가 유효하지 않으면 422.
- 가중치는 `POSEGOOD_MODEL_DIR`(기본 `model/pretrained/frame-rf-100x`)에서 시작할 때 한 번 불러온다. 코드에 고정한 SHA-256으로 검증한다.
  - corrector `95c6a22e7b997f18601e7355137381978d83b766c03dacf1e27e3eed018b468a`
  - posture `097ac911f8a98b4153cd98db135e55e0b52fa0ef971dbf247978609b407e0059`
  - 클래스 [0,1]과 특징 수 6/7을 확인한 뒤 보정기와 분류기를 `CompiledForest`로 변환한다.
- `/health`: `{"status":"ok","model_version":<선택한 모델의 model_version>,"learned":<RF면 true>}`. 불러오기 실패면 503 `{"status":"error"}`.
- Kafka 소비자도 같은 입력·같은 코드로 계산한다(아래 「Kafka 경로」).
- 좌표·특징 값을 로그와 오류 응답에 남기지 않는다.

### BE 연결 시 할 일 (전세호)

- `SessionService.frames`에서 `FrameFeatures.interval`을 이용한 local 평균과 자체 품질·고개 돌림 검사를 제거하고 키포인트 요청을 만든다.
  - `frames`는 각 프레임의 `tracked()`가 참이면 `p`, 거짓이면 `null`을 넣는다.
  - `baseline`은 세션 기준 9점이다. `LiveSession`에 캐시하고, 없으면 `baselines.find`로 읽는다(자정 넘김 새 세션 포함).
- `InferenceClient`는 `POST /infer`에 키포인트 요청을 보내고, 응답의 구간·순번·phase를 대조한다. `valid`와 `invalid_reason`을 판정 엔진에 전달해 측정 불가 사유를 추론 응답에서 가져온다.
- `InferenceRequest.java`의 계약 주석을 키포인트 요청용 `contracts/inference-request.schema.json`에 맞춘다. 같은 파일 이름이 가리키는 요청 형식이 바뀐다.
- [BE API 명세](../../design/api-spec.md)에서 `/infer` 키포인트 요청과 `invalid_reason` 응답을 설명한다. 기존 특징 변화량 링크를 [키포인트 요청 예시](../../../contracts/examples/inference/synthetic-inference-request.json)와 [응답 예시](../../../contracts/examples/inference/synthetic-inference-response.json)로 갱신하고 변경 이력에 호환성 변경을 기록한다.
- IT용 가짜 추론 서버 `SyntheticInference`가 키포인트 요청을 읽고 `invalid_reason`을 포함한 관측 응답을 반환하도록 바꾼다.
- `posegood.model-version=${POSEGOOD_MODEL_VERSION:frame-rf-100x-v1}`.
- Kafka 경로: `KafkaPipeline.frames`도 `FrameFeatures.interval` 대신 위와 같은 키포인트 요청을 `posture.features`의 `features` 본문으로 보낸다.
  [Kafka features 예시](../../../contracts/realtime/examples/features-features.json)가 바뀌어 `KafkaPipelineTest`의 `sameShape`는 Java 변경 전까지 실패한다.
  처리 서비스의 시험 입구(`RealtimeTestEntryController`·`RealtimeEnvelopeValidator`)도 옛 특징 변화량 본문만 받으므로 함께 바꾼다.
- 고개 돌림 힌트: Kafka 관측에는 `invalid_reason`이 없다(관측 계약 그대로). `KafkaResults`가 붙이는 `head_turn`은 Java가 좌표로 계속 검사하거나,
  관측 계약에 `invalid_reason`을 더하는 별도 변경이 필요하다(결정 전).

## Kafka 경로 (2026-11-20)

- `posture.features`의 `kind:"features"` 본문 = [키포인트 요청](../../../contracts/inference-request.schema.json)(`/infer`와 같음). [kafka-features](../../../contracts/realtime/kafka-features.schema.json)가 이것을 `$ref`한다.
- `backend/inference/app/realtime.py`가 `model.inference`의 `InferenceRequest`로 검사하고 `FrameInference.predict`로 관측을 만든다. 출력은 [관측](../../../contracts/posture-observation.schema.json)이라 `invalid_reason`을 뺀다.
- `POSEGOOD_INFERENCE_MODEL`(기본 `frame-rf-100x`, `rule` 가능)과 `POSEGOOD_MODEL_DIR`은 HTTP 서버와 같다. 모델을 못 불러오면 소비를 시작하지 않고 `/health`가 503(DOWN)이다. 메시지는 Kafka에 남는다.
- 형식이 틀린 본문(옛 특징 변화량 포함)·기준 9점 기하 오류·모델 계산 실패는 `posture.dlq`로 보낸다. 사유 문자열에 좌표 값을 넣지 않는다.
- 이미지: `backend/inference/Dockerfile`은 저장소 루트에서 빌드하고(`infra/compose/bigdata.yaml` context `../..`) `model/inference`와 가중치 두 파일을 넣는다. 의존성에 numpy 1.26.4·scikit-learn 1.6.1·joblib 1.4.2를 더했다(가중치를 만든 판).

## 작업 나눔

| 담당 | 파일 |
| --- | --- |
| Python | `model/inference/*`, `model/inference/requirements.txt`(신규), `infra/docker/inference.Dockerfile`, `compose.yaml`(inference 환경변수만), `tests/test_inference.py` |
| Python (Kafka) | `backend/inference/app/*`, `backend/inference/tests/*`, `backend/inference/Dockerfile`·`requirements.txt`·`pytest.ini`, `infra/compose/bigdata.yaml`(빌드 위치만) |
| 계약 (Kafka) | `contracts/realtime/kafka-features.schema.json`, `contracts/realtime/examples/features-features.json`, `contracts/realtime/README.md`, `docs/design/kafka-spec.md` |
| 문서 | `contracts/inference-request.schema.json`·`contracts/examples/inference/*`(합성)·`contracts/README.md`, `model/BACKEND_DATA_FLOW.md`, `model/pretrained/frame-rf-100x/README.md`, `docs/decisions/0050-frame-rf-service-inference.md`, `docs/index.md` 한 줄, `backend/README.md`의 추론 설명 |

## 속도 개선

추론 서버는 시작할 때 sklearn 보정기와 분류기의 트리 노드를 `CompiledForest`의 NumPy 배열로 변환한다. 추론 시 각 깊이에서 모든 트리를 한꺼번에 탐색하고 sklearn과 같은 트리 순서로 출력을 합산한다.
실제 가중치와 무작위 합성 입력 5,000개로 비교한 보정값과 이탈 클래스 점수의 최대 절대 차이는 모두 0이었다. 앞서 측정한 프레임당 RF 계산 시간은 10.5 ms에서 0.23 ms로 줄었다.

Windows에서 [합성 키포인트 요청](../../../contracts/examples/inference/synthetic-inference-request.json)의 프레임을 1장 또는 5장 보냈다. 단계별 시간은 7회 반복에서 회당 요청 평균의 중앙값이다. HTTP 전체에는 단일 클라이언트의 루프백 왕복과 Uvicorn·FastAPI 처리가 포함되며, 연결은 재사용했다.

| 단계 (ms/요청) | 1프레임 | 5프레임 |
| --- | ---: | ---: |
| JSON 파싱 (`json.loads`) | 0.009 | 0.023 |
| 입력 검사 (`InferenceRequest.model_validate`) | 0.006 | 0.014 |
| 기준 기하와 프레임 특징 계산 | 0.048 | 0.217 |
| CompiledForest 보정·분류 | 0.240 | 0.383 |
| 응답 직렬화 (`jsonable_encoder`와 `JSONResponse`) | 0.020 | 0.020 |
| HTTP 전체, 변경 전 | 1.475 | 1.829 |
| HTTP 전체, 변경 후 | 1.318 | 1.795 |

- `/infer`를 `async def`로 선언해 워커의 이벤트 루프에서 짧고 프레임 수가 제한된 메모리 내 계산을 수행한다. 단일 워커 후보 비교에서 스레드풀 전환을 없앴을 때 1,083 req/s를 기록했다. FastAPI의 요청 검사, 오류 응답, 내부 토큰 검사와 OpenAPI 계약을 유지했다.
- `model_validate_json`은 파싱과 입력 검사 합계에서 1프레임 0.005 ms, 5프레임 0.011 ms를 줄였다. 기존 FastAPI 파싱 경로를 유지했다. `JSONResponse` 직접 반환은 직렬화에서 약 0.015 ms를 줄였지만, `async def`와 함께 적용한 후보 처리량은 1,040 req/s였다. 기존 직렬화 경로를 유지했다.
- 추론 이미지의 런타임 요구 사항에 `uvicorn[standard]==0.39.0`을 추가했다. Linux Docker에서는 `uvloop`와 `httptools`를 자동 선택한다. Windows 측정은 `asyncio`와 `h11`을 사용했으며 `uvloop`와 `httptools`의 효과는 측정하지 못했다. 로컬 Docker 데몬에 연결할 수 없어 이미지 빌드는 미검증이다.

이전 Windows 부하 기록은 16개 클라이언트가 합성 프레임 1개를 담은 `POST /infer`를 워커 수마다 8초 동안 반복한 결과다.

| Uvicorn 프로세스 | sklearn req/s | sklearn p50 | CompiledForest req/s | p50 | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 59 | 250 ms | 402 | 35 ms | 45 ms |
| 2 | 107 | 116 ms | 652 | 21 ms | 27 ms |
| 4 | — | — | 1,101 | 12 ms | 24 ms |

HTTP 개선 전후에도 같은 부하 설정으로 18095 포트에서 측정했다. 이번 측정에서는 모든 워커의 시작과 연결 예열을 확인하고, 8초 안에 응답이 완료된 요청을 셌다.

| Uvicorn 워커 | 개선 전 req/s | 개선 후 req/s | p50 전 → 후 (ms) | p95 전 → 후 (ms) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 429 | 1,044 | 36.46 → 14.01 | 49.39 → 22.45 |
| 2 | 780 | 1,640 | 20.20 → 8.69 | 24.72 → 19.51 |
| 4 | 1,158 | 1,594 | 12.17 → 8.78 | 27.70 → 20.74 |

4워커 측정에서 Windows의 공유 소켓 시작 오류와 재측정 중 읽기 타임아웃이 관찰됐다. 측정 스크립트가 워커 생성 전에 공유 소켓을 비차단 모드로 설정하고 수신 대기하도록 한 뒤, 4워커 재측정은 1,272 → 1,545 req/s로 완료됐다. 재측정의 p50은 11.80 → 9.07 ms, p95는 22.83 → 21.50 ms였다.

측정 때마다 서버와 해당 서버가 띄운 워커의 종료를 기다렸고 `netstat`으로 18095 포트가 비었는지 확인했다. 이 Windows 환경에서는 CIM 조회가 거부되어 Uvicorn 감독 프로세스가 보유한 워커 핸들로 확인했다.

Compose의 `POSEGOOD_INFERENCE_WORKERS` 기본값은 2다. 추론 서버에 할당된 CPU 코어 수 이내에서 처리량과 응답 시간을 비교해 프로세스 수를 고른다. 프로세스마다 시작할 때 모델을 한 번씩 메모리에 올리므로 메모리 여유도 함께 확인한다.

## 검증

- [x] `python -m unittest tests.test_inference tests.test_inference_internal_auth tests.test_realtime_parity tests.test_realtime_contracts tests.test_deploy_configuration` (Windows 가상 환경)에서 28개를 모두 통과했다.
- [x] `python -m unittest discover -s tests` (Windows 가상 환경)에서 228개 중 208개 통과, 실패 1개, 오류 12개, 건너뜀 7개를 확인했다. 기존과 같이 배치 J1·J2·J3에서 `tzdata` 누락으로 12건, `test_model_live_comparison` 브라우저 시험에서 1건이 발생했다.
- [x] HTTP 개선 전후 비교에서 RF·규칙·모델 구성 오류 모드별 합성 요청 12종의 HTTP 상태, 헤더, 본문이 일치했다. OpenAPI, `/health`, 잘못된 본문을 보낸 미인증 요청의 401도 확인했다.
- [ ] (BE 연결 후) 실제 API → `/infer` 흐름 확인 — BE 작업
- [x] Kafka 소비자: `backend/inference`에서 `pytest`(Python 3.11, `requirements.txt`·`requirements-dev.txt`) 31개 통과 — 좌표 구간 → RF 관측, 옛 특징 변화량·형식 오류·기준 기하 오류 → DLQ, 모델 없음 → 소비 안 함·`/health` 503, 합성 좌표 3종 × RF·규칙에서 Kafka 관측 = `/infer` 관측(`invalid_reason` 제외)
- [x] `python -m unittest tests.test_realtime_contracts tests.test_inference tests.test_inference_internal_auth tests.test_realtime_parity tests.test_deploy_configuration` 28개 통과(바뀐 Kafka features 예시 포함)
- [ ] (BE 연결 후) 실제 BE → Kafka → 추론 → 판정 → BE 흐름, `inference-service` 이미지 빌드
- [x] 실제 가중치와 합성 요청으로 프레임 추론 점수 확인(경로 통합 전 기록): 같은 자세 0.081, 고개 숙임 0.905, 옆 이동 0.808(left_lean), 9점 visibility 0.5 → unmeasurable, rest → valid:false. TestClient 기준 평균 13.4ms/요청
- [ ] Docker 이미지 빌드(Docker 엔진이 꺼져 있어 미확인)
- [x] 합성 키포인트 예시 JSON Schema 검증(기존 기록)
- [x] 문서 상대 링크, 충돌 표시, `git diff --check` 검증

## 남은 한계

- 서비스 기준 자세는 9점 visibility를 저장하지 않는다. RF 학습은 9점 품질이 검증된 기준을 전제로 했지만, 서비스 기준은 앱이 코·어깨만 검사한다.
- RF 후보는 독립 시험이 없고 0.5 기준도 검증 전이다(가중치 README). 점수 변환은 운영 편의일 뿐 보정이 아니다.
- 측정 불가가 늘면 판정 엔진의 "중단 → 재확정 알림" 문제가 더 자주 나타날 수 있다(분석 요약 2번, BE 판정 엔진 과제).
