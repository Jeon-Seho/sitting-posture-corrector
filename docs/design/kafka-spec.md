# Kafka 명세 — 처리 서비스 층 토픽·메시지 (아키텍처 v5.2)

- 담당: DevOps/BE (토픽·봉투·컨슈머 그룹·DLQ·보존). 본문 형식(입력·관측·사건)은 [계약](../../contracts/README.md)의 기존 버전을 그대로 쓴다.
- 기준: [실시간 계약 v1 스키마](../../contracts/realtime/) `kafka-*.v1.schema.json`, [아키텍처 v5.2 스택별 역할](architecture_v5.2_stack_roles.md),
  [실시간 판정 Kafka 전환 계획 0031](../plans/active/0031-realtime-kafka-transition.md).
- 갱신: 2026-10-17

> **이름 주의 — 「v1」이 둘이다.** 이 문서의 v1은 **Kafka 계약 v1**(`posture.*.v1` 토픽, `kafka-*.v1.schema.json`)이다.
> 앱 ↔ 입출구 서버 **WebSocket v1**(`/v1/realtime`, `realtime-ws.v1.schema.json`)과는 다른 것이고, WebSocket이 v2로 바뀌어도
> Kafka 계약 v1과 처리 서비스 시험용 입구 `POST /api/v1/realtime/features`, 재생 도구 `tools/platform/replay_realtime_v1.py`는 그대로 쓴다.

## 1. 흐름

```
앱 ─WebSocket /v2/realtime─▶ 입출구 서버 ws ─▶ posture.features.v1 ─▶ 추론(backend/inference) ─▶ posture.inference.v1
                                                                                                      │
앱 ◀─WebSocket─ 입출구 서버 ws ◀── posture.episodes.v1 ◀── 판정(backend/processing) ◀────────────────┘
                                          │
                                          └──▶ 판정 결과 저장(backend/processing report) ──▶ MySQL posture_service(V2.3)
```

- 서비스끼리, 입출구 서버와 처리 서비스 사이는 Kafka로만 주고받는다(직접 HTTP 호출 없음).
- **지금 상태(2026-10-17)**: 앱이 쓰는 실시간 판정은 아직 입출구 서버 안(ADR 0020)이다. 입출구 서버 `ws`를 Kafka에 잇는 일은
  계획 0031 1단계(PM)다. 그 전까지 Kafka 경로는 처리 서비스의 **시험용 입구**(4장)로 넣어 확인한다(통합 테스트 8·9·11단계).
- 추론의 최종 위치는 GPU PC(`SERVER_LAN_IP:KAFKA_EXTERNAL_PORT`, 기본 9094)다. 지금은 서버 PC 안의 같은 서비스가 대신 돈다.

## 2. 토픽

| 토픽 | 파티션 | 키 | 생산 → 소비(컨슈머 그룹) | `kind` | 스키마 |
| --- | --- | --- | --- | --- | --- |
| `posture.features.v1` | 3 | `session_id` | 입출구 `ws`(지금은 시험용 입구) → 추론(`inference-service-v1`) | `session_started` / `features` / `session_ended` | [kafka-features.v1](../../contracts/realtime/kafka-features.v1.schema.json) |
| `posture.inference.v1` | 3 | `session_id` | 추론 → 판정(`judge-v1`) | `session_started` / `observation` / `session_ended` | [kafka-inference.v1](../../contracts/realtime/kafka-inference.v1.schema.json) |
| `posture.episodes.v1` | 3 | `session_id` | 판정 → 판정 결과 저장(`report-store-v1`), 입출구 `ws`(계획 0031 1단계) | `decision` / `progress` | [kafka-episodes.v1](../../contracts/realtime/kafka-episodes.v1.schema.json) |
| `posture.dlq` | 1 | 원래 키 | 추론·판정·저장 컨슈머 → 사람이 확인 | — | 5장 |
| `posture.alerts.v1` | 3 | `session_id` | 판정 결과 저장 → 입출구 `ws` | (예정, D-54) | 미정 |

- 토픽은 처리 서비스가 시작할 때 없으면 만든다(복제 1, 단일 브로커). 브로커 기본 파티션도 3이다.
- 보존: 지금은 브로커 기본값(7일). 목표는 v1 토픽 3일·DLQ 7일(D-49, 탈퇴 30일 삭제보다 짧게).
- 컨슈머는 처리한 뒤 커밋한다. 처리 서비스가 다시 시작하면 마지막 커밋 다음부터 읽는다.
- 옛 경로 토픽 `posture.summary`·`posture.inference`(그룹 `inference-service`·`api-server-cep`)는 정리 예정이다(D-38). 새 작업에 쓰지 않는다.

## 3. 메시지

### 3.1 공통 봉투

| 필드 | 값 |
| --- | --- |
| `schema_version` | `"1.0"` |
| `message_id` | 메시지마다 새 UUID |
| `session_id` | 측정 세션 UUID(= `monitor_session.client_session_uuid`). **메시지 키와 같다** |
| `user_id` | 로그인 계정 ID(문자열) |
| `produced_at` | 생산 시각(ISO-8601 UTC, `Z`) |
| `kind` | 아래 표 |
| `body` | `kind`별 본문 |

모르는 필드는 거부한다. 원본 영상·이메일은 어떤 메시지에도 넣지 않는다.

### 3.2 `kind`별 본문

| 토픽 | `kind` | 본문 |
| --- | --- | --- |
| features.v1 | `session_started` | `policy`(hold·recovery·reminder ms, threshold), `baseline_id`, 화면 크기 |
| features.v1 | `features` | 0.5초 구간 1개 — 지금은 [입력 v2](../../contracts/inference-request.v2.schema.json)(특징 변화량). 좌표 구간(본문 v3)은 D-34 |
| features.v1 | `session_ended` | `end_ms` |
| inference.v1 | `session_started`·`session_ended` | features.v1에서 받은 것을 **바꾸지 않고** 넘긴다(판정이 한 토픽만 읽도록) |
| inference.v1 | `observation` | [관측 v2](../../contracts/posture-observation.v2.schema.json)(`sequence`, `start_ms`·`end_ms`, 점수, `valid`, `phase`) |
| episodes.v1 | `decision` | [사건 v1](../../contracts/posture-event.v1.schema.json) + 그 시점 요약 + `last_sequence` |
| episodes.v1 | `progress` | 약 1초(메시지 시각 기준)마다 요약 + `last_sequence` |

사건 종류(`decision.event.kind`): `collapse_confirmed`·`reminder`·`recovery_confirmed`·`interrupted`·`session_ended`·`excluded_started`·`excluded_ended`.
`interrupted`·제외 구간의 `reason`: `rest`·`away`·`unmeasurable`·`missing`(·`missing_sequence`), 세션 종료로 끊기면 `ended`.

### 3.3 순서와 중복

- 키가 `session_id`라 한 세션의 메시지는 한 파티션에서 순서대로 처리된다. 시작 → 구간 → 종료를 **같은 토픽·같은 키**로 보낸다.
- 같은 세션의 같은 `sequence`는 한 번만 반영한다(재전송 무시). `last_sequence`는 줄어들지 않는다.
- `event_id`는 세션마다 1부터 1씩 증가한다. 사건(`decision`)은 그 사건이 반영된 `progress`보다 먼저 나간다.
- 시간은 도착 시각이 아니라 메시지의 `start_ms`·`end_ms`(세션 시작 기준 ms)로 계산한다.
- 판정 상태는 Redis(`posture:v1:judge:{session_id}`, TTL 1시간)에 저장해 처리 서비스가 다시 시작해도 이어 간다.

## 4. 시험용 입구 (처리 서비스)

입출구 서버가 Kafka에 이어지기 전까지 Kafka 경로를 시험하는 입구다. 운영 앱은 쓰지 않는다.

- `POST http://<서버>:<API_SERVER_HOST_PORT>/api/v1/realtime/features` — 본문은 features.v1 메시지 1개 또는 배열(최대 200개).
  배열은 모두 검사를 통과해야 순서대로 발행한다. 성공 202, 형식 오류 400(이유 목록). 환경변수 `REALTIME_TEST_ENTRY_ENABLED=false`면 404.
- 재생 도구: `python3 tools/platform/replay_realtime_v1.py --api http://localhost:8080/api/v1/realtime/features`
  (T-10과 같은 합성 시나리오 172개 메시지, `--dump`·`--range`·`--session-id`).
- 다른 운영 API는 [처리 서비스 HTTP API](processing-api-spec.md).

## 5. DLQ `posture.dlq`

처리하지 못한 메시지(JSON 파싱 실패, 스키마·`kind` 불일치, DB 제약 위반)는 버리지 않고 DLQ로 넘긴 뒤 다음 메시지를 계속 처리한다.
DB 연결 장애는 DLQ가 아니라 같은 메시지를 재시도한다(판정 결과 저장, 5초 간격).

| 필드 | 값 |
| --- | --- |
| `schema_version` | `"1.0"` |
| `failed_at` | 넘긴 시각 |
| `consumer` | 컨슈머 그룹(예: `inference-service-v1`) |
| `source_topic`·`source_partition`·`source_offset`·`key` | 원래 위치 |
| `reason` | 이유(예: `JSON 파싱 실패: …`) |
| `payload` | 원문 문자열(256KB 넘으면 자르고 `payload_truncated: true`) |

확인: `docker exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic posture.dlq --from-beginning --timeout-ms 5000`

## 6. 접속 주소

| 누가 | 주소 |
| --- | --- |
| compose 안 컨테이너(처리 서비스·추론·입출구 서버) | `kafka:19092` |
| 서버 PC 안(CLI·디버깅) | `localhost:<KAFKA_HOST_PORT>`(기본 9092, 127.0.0.1에만 열림) |
| 외부 GPU PC(추론 이전 뒤) | `<SERVER_LAN_IP>:<KAFKA_EXTERNAL_PORT>`(기본 9094, 방화벽으로 GPU PC IP만 허용) |

값은 `infra/compose/.env`([env.example](../../infra/compose/env.example))에서 정한다.

## 7. 바꾸는 법

- 본문 필드를 바꾸거나 `kind`를 더하면 스키마(`contracts/realtime/kafka-*.v1.schema.json`)·합성 예시(`contracts/realtime/examples/`)·
  `tests/test_realtime_contracts.py`·동등성 시험 데이터(`contracts/realtime/parity/`)·이 문서를 함께 고친다.
- 기존 소비자가 읽지 못하는 변경(필드 의미 변경·필수 필드 추가)은 새 토픽 버전(`*.v2`)으로 내고 두 버전을 함께 운영한 뒤 옛 토픽을 정리한다.
- 예정된 변경: 좌표 구간 본문 v3(D-34), 세션 종료 사유(D-55), 알림 토픽 `posture.alerts.v1`(D-54).
