# 실시간 판정을 Kafka 경로로 옮기기 (아키텍처 v5.2)

- 상태: in_progress (0단계 끝 2026-10-16, 1단계 PM 차례. ADR 0020 대체는 DB/BE 합의 대기)
- 담당: DevOps/BE(처리 서비스·계약·compose·통합 테스트), PM(`ws` — `realtime/` Kafka 연결), DB/BE(`session/` 결과 쓰기 중단·REST 정리)
- 시작일: 2026-10-16
- 관련 요구사항/ADR: [ADR 0020](../../decisions/0020-single-api-decision-engine.md)(대체 예정), [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md),
  [ADR 0024](../../decisions/0024-session-ends-on-lost-connection.md), [연동 명세](../../design/api-ws-spec.md), [아키텍처 v5.2 변경 안내](../../design/architecture_v5.2_change_notes.md),
  [스택별 역할](../../design/architecture_v5.2_stack_roles.md), [계획 0029](0029-merge-backend-data-platform.md). 지운 계획 0022(Kafka 실시간 경로)를 이 계획이 대신한다.

## 문제와 완료 기준

지금 실시간 판정은 두 곳에 있다.

| 경로 | 위치 | 상태 |
|---|---|---|
| API 안 판정(ADR 0020) | `backend/api` — `RealtimeHandlerV2` → `SessionService` → `FrameFeatures` → FastAPI `/v2/infer` → `engine/SessionEngine` → `persist()`가 결과 테이블에 씀 | 앱이 쓰는 경로. 한 대, 진행 상태는 메모리 |
| Kafka 경로(아키텍처 v5.2) | `posture.features.v1` → `backend/inference` → `posture.inference.v1` → `backend/processing` 판정(상태머신, Redis 복원·DLQ) → `posture.episodes.v1` → 판정 결과 저장(DB V2.3) | 서버 PC에서 동작 확인(2026-10-16 통합 테스트 11단계: 저장·멱등·lag 0). 앱 입구가 없음 |

두 판정기는 같은 규칙(`legacy-interrupt-v1`, 3초·3초·60초)이다. 아키텍처 v5.2대로 앱 입구(`ws`)를 Kafka 경로에 잇고 API 안 판정을 지운다.

완료 기준(모두 서버 PC에서 확인):

1. 앱이 `/v2/realtime`으로 보낸 구간이 Kafka 경로를 거쳐 같은 WebSocket v2 메시지(`ack`·`progress`·`observation`·`decision`·`alert`·`stalled`·`closed`)로 돌아온다. 앱 코드와 [WebSocket v2 계약](../../../contracts/realtime/realtime-ws.v2.schema.json)은 바꾸지 않는다.
2. 결과 테이블(`collapse_event`·`correction_alert`·`monitor_session` 종료 값·`excluded_interval`)은 판정 결과 저장만 쓴다. API는 세션 행 만들기(종료 값 제외)만 한다.
3. 같은 입력으로 API 안 판정과 Kafka 경로가 같은 사건·요약을 낸다(아래 T-15).
4. 통합 테스트 WebSocket 시나리오 PASS, 컨슈머 그룹 lag 0, DLQ 0.
5. API 안 판정(`engine/`·`InferenceClient`·메모리 진행 상태)과 io-inference 컨테이너를 지우고 ADR 0020을 대체하는 ADR을 남긴다.

## 범위와 제외

- 바꾸는 곳: `backend/api`(`realtime/`·`session/`·`workspace/`), `backend/processing`(판정·판정 결과 저장), `contracts/realtime/`(Kafka 계약 v1 추가 필드·토픽), `infra/compose/bigdata.yaml`(io-api의 Kafka·Redis 연결), `tools/platform/`(통합 테스트), `tests/test_service_contracts.py`(ADR 0020 회귀 시험).
- 제외:
  - 앱 화면과 WebSocket v2 계약.
  - 좌표 → 특징 계산을 추론으로 옮기는 일(D-34, 본문 v3). 이 계획에서는 `ws`가 지금의 Java `FrameFeatures`로 계산해 입력 v2 본문으로 보낸다.
  - 자세 등록 계산을 추론으로 옮기는 일(D-35). 등록 연결(`purpose: calibration`)은 지금처럼 API 안에서 계산·저장한다.
  - 입출구 서버 여러 대(D-42).

## 지금 API가 하는데 Kafka 경로에 없는 것

| # | 항목 | 지금(API 안) | Kafka 경로 | 이 계획에서 | 담당 |
|---|---|---|---|---|---|
| 1 | 좌표 → 특징 변화량 | `FrameFeatures.interval` | 추론은 입력 v2 변화량만 받음 | `ws`가 `FrameFeatures`로 계산해 `features.v1`(본문 v2)로 발행 | PM |
| 2 | 추론 | FastAPI `/v2/infer`(`model/inference`) | `backend/inference`(`reference-feature-rule-v1`) | 같은 입력으로 결과 비교(T-15) | DevOps/BE |
| 3 | 판정 | `SessionEngine` | `V1SessionJudge` | 같은 관측열로 사건·요약 비교(T-15) | DevOps/BE |
| 4 | `progress.paused_reason` | `SessionEngine.pausedReason()` | 없음 | `ws`가 `inference.v1` 관측의 `phase`·`valid`로 계산(`rest`·`away`·`unmeasurable`) | PM |
| 5 | `observation.invalid_reason` | `invalidReason(관측, 힌트)` | 없음 | `ws`가 발행 때 계산한 힌트(`head_turn`)와 관측 `valid`로 계산 | PM |
| 6 | `excluded_interval` | `persist()`가 씀 | 판정이 사건을 내지 않고 저장도 안 씀 | 판정이 `excluded_started`·`excluded_ended` 발행 + 저장이 기록(D-39) | DevOps/BE |
| 7 | 종료 사유 | 끊김이면 `DISCONNECTED` | `session_ended`에 사유 없음 | 계약 v1 `session_ended.reason`(D-55) | DevOps/BE |
| 8 | `alert` | `alertEnabled`이고 `collapse_confirmed`·`reminder`일 때 | 없음 | 1단계는 `ws`가 같은 규칙, D-54 뒤 `posture.alerts.v1` | PM → DevOps/BE |
| 9 | `stalled` | 추론 502·503 | 없음 | 발행한 뒤 5초 동안 관측이 안 오면 `stalled` | PM |
| 10 | `progress` | 구간마다 `frames()` 응답으로 | `episodes.v1` `progress`(약 1초) | `ack`는 발행 확인 뒤 바로, `progress`는 `episodes.v1`에서 | PM |
| 11 | 세션 조회·종료 REST | `SessionController`(GET·`/end`·`/metadata`·`/features`), `WorkspaceService.closeForRecord`·`delete`, `ServerRecordVerifier`가 메모리 상태를 읽음 | — | 끝난 세션은 DB, 진행 중 요약은 `ws`가 받은 마지막 `progress`. `POST /v2/sessions/{id}/features`는 Kafka 모드에서 쓰지 않음(FE 확인) | DB/BE |
| 12 | 결과 쓰기 | `persist()` | 판정 결과 저장 | Kafka 모드에서 `persist()`·`InferenceClient`를 쓰지 않음 | DB/BE |
| 13 | 세션 시작 | `openRealtime` | `session_started`(정책·`baseline_id`·`frame`) | `ws`가 `hello`를 받아들일 때 한 번만 발행 | PM |
| 14 | io-api ↔ Kafka·Redis | 없음 | — | compose io-api에 `KAFKA_BOOTSTRAP_SERVERS=kafka:19092`·`REDIS_HOST=redis`, `depends_on` | DevOps/BE |

## 작업 단계

- [x] 0. 준비(DevOps/BE) — T-15 동등성 시험(#2·#3), D-39(#6), compose(#14). D-55(#7)는 DB V2.3에 종료 사유 칸이 없어 빼고, D-54(#8)는 1단계 뒤.
- [ ] 1. `ws` Kafka 연결(PM) — 설정 `posegood.realtime.pipeline=local|kafka`(기본 `local`). `kafka`이면 `RealtimeHandlerV2`가 `SessionService.frames`·`finish` 대신 Kafka로 발행하고 결과 토픽을 받아 보낸다(#1·#4·#5·#8·#9·#10·#13). 연결 규칙·`closed` 사유·`hello` 검사는 그대로 둔다.
- [ ] 2. API 결과 쓰기 중단·REST 정리(DB/BE) — `kafka`일 때 #11·#12.
- [ ] 3. 전환 시험(DevOps/BE) — 통합 테스트에 WebSocket 시나리오(가입 → 기준 → 세션 → `/v2/realtime` → 구간 → `end` → `closed(ended)` → 세션 조회), DB 세 곳 일치, `local`로 되돌리기 확인.
  도구 `tools/platform/ws_realtime_smoke.py`·통합 테스트 12단계 준비됨(10/16) — 지금 `local`로 기준값을 확인하고, 1단계 뒤 `kafka`로 같은 기대값을 확인한다.
- [ ] 4. 전환·정리(전원) — 서버 기본값 `kafka` → 앱 왕복(T-13) → API 안 판정·io-inference 삭제, ADR 0020 대체 ADR, `tests/test_service_contracts.py`의 ADR 0020 회귀 시험을 새 구조에 맞춤, `docs/architecture.md` 갱신.
- [ ] 다음 계획 — D-34(좌표 계산을 추론으로, 본문 v3), D-35(등록 계산을 추론으로).

## 결정과 진행 기록

- 2026-10-16 DevOps/BE: 아키텍처 v5.2대로 Kafka 경로로 옮긴다(A안). 근거: v5.2 확정 구조(입출구 서버와 처리 서비스는 Kafka로만), Kafka 경로의 판정 결과 저장(DB V2.3)이 서버에서 확인됨, 같은 규칙의 판정기 두 벌을 유지하지 않음.
- 합의 전 잠정값: `stalled` 5초, 종료 뒤 최종 `decision(session_ended)` 대기 5초(그 뒤 `closed(ended)`만), `ws` 컨슈머 그룹은 인스턴스마다(`io-ws-${HOSTNAME}`, `auto.offset.reset=latest`).
- 남은 질문: ADR 0020 대체(DB/BE), `POST /v2/sessions/{id}/features` 처리(FE), 최대 측정 시간(지금 5000초).

## 검증 결과와 남은 한계

- 0단계(2026-10-16, 서버 PC): `backend/gradlew -p backend :processing:test :api:test` 성공(동등성 시험 `SessionEngineParityTest`·`V1SessionJudgeParityTest` 포함),
  `tests/test_realtime_parity.py`·`tests/test_realtime_contracts.py` 통과, `tools/platform/integration_test.sh --quick` PASS 60 / FAIL 0 / SKIP 4
  (11단계 제외 구간 PAUSE·MISSING 저장). 동등성 결과: 합성 관측 약 1,500개에서 두 판정의 사건·요약·제외 구간이 같고, 무작위 입력 5,000개에서 두 추론이 같다.
  알려진 차이 1개 — `good_sec` 반올림(API 버림, 판정 결과 저장 반올림).
- 3단계 도구는 가짜 서버로 흐름만 확인했다(실제 io-api로는 아직). 계획한 나머지 검증은 위 완료 기준 1~5다.
