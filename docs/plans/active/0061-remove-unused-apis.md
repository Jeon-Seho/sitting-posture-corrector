# 앱 기능이 없는 REST 4개 삭제

- 상태: in_progress (BE 코드·시험·문서 변경, 단위 빌드 통과. MySQL 통합·HTTP smoke는 아직 — 아래 「검증 결과」)
- 담당: Kimyoujin(BE)
- 시작일: 2026-10-28
- 관련 요구사항/ADR: [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md)(앱은 좌표만, `/v2/realtime`), [BE API 명세](../../design/api-spec.md), [계약 accounts.v2](../../../contracts/accounts.v2.md), FE 요청 BE-1([FE 제안서](../../design/fe-server-proposal.md) 1장)

## 문제와 완료 기준

API를 한 번에 만들면서 앱 기능이 없는 경로까지 생겼다. 앱(FE V3)이 부르는 것은 A2~A5·A8, B1·B2, S1·S4, `/v2/realtime`이고,
W1·W2·A6·A7·C1·R1·R3은 화면이 있어 연결만 남았다. 아래 4개는 쓰는 화면도 계획도 없다.

| API | 지운 이유 |
| --- | --- |
| S2 `POST /v2/sessions/{id}/features` | 측정은 `/v2/realtime`으로만 한다(ADR 0021). BE-1에서 지우기로 했던 것 |
| R2 `POST /v2/records` | 앱 기록을 서버 판정과 대조해 세션을 닫던 경로. 서버가 측정 종료 때 직접 저장한다. BE-1 |
| S5 `GET /v2/sessions/{id}/metadata` | 쓰는 화면이 없다. 시각은 WS `ready.started_at`·`closed.ended_at`, 기준은 B2, 저장된 세션은 R1 |
| S6 `DELETE /v2/sessions/{id}` | R3 `DELETE /v2/records/{id}`와 같은 일(기록 = 세션) |

완료 기준:

- 4개 경로가 서버에 없다(`MySqlIntegrationTest.unusedRoutesAreRemoved`가 확인).
- 이 경로로 측정하던 시험(`MySqlIntegrationTest`, `SessionServiceTest`, `tools/service_smoke.py`)이 `/v2/realtime`으로 같은 것을 확인한다.
- `make check-backend`(MySQL 통합 포함) 통과.
- 지운 코드는 git 이력(이 계획의 커밋 직전)과 작성자 로컬 백업에 있다.

## 범위와 제외

- 범위(BE): `backend/api`의 `SessionController`·`SessionService`(`features`·`metadata`·`closeForRecord` 삭제), `WorkspaceController`·`WorkspaceService`(`save` 삭제),
  `ServerRecordVerifier` 파일 삭제, `RecordValidator`의 기록 검사 삭제(설정 검사는 W2가 써서 남김), `SessionRepository.closeLost` 삭제,
  `SessionRequests.FeatureResponse` 삭제. 시험 `SessionServiceTest`·`RecordValidatorTest`·`MySqlIntegrationTest`, `tools/service_smoke.py`(+ 새 `tools/realtime_client.py`).
  문서 [BE API 명세](../../design/api-spec.md), [백엔드 상태](../../backend-status.md), `backend/README.md`, 계약 `accounts.v2.md`·`contracts/README.md`, `docs/code-structure.md` 한 줄.
- 남긴 것(판단 필요): S3 `POST /v2/sessions/{id}/end` — 앱은 부르지 않지만, S1 뒤 WS가 열리지 않은 세션을 닫을 수단이 이것뿐이다. W1 응답의 `records` — R1과 겹치지만 응답 형식을 바꾸는 일이라 FE가 W1을 붙이기 전에 함께 정한다.
- 남긴 것(다른 쪽이 씀): 계약 `feature-response.v1.schema.json`과 예시·`tests/test_feature_response.py` — 부하 측정 도구가 아직 쓴다. 추론 입력 `inference-request.v2`는 API → FastAPI 계약이라 그대로다.
  `SessionService.accept`의 재전송 지문 비교(같은 순번·같은 본문이면 다시 쓰기)는 S2 재시도용이었다. `/v2/realtime`은 중복 순번을 먼저 409로 거절하므로 지금은 닿지 않는다 — 재전송 기억(120개)과 함께 정리할지 따로 정한다.
- 제외: DB(V2.6 그대로), 앱 코드, 다른 담당의 도구(아래 표).

### 다른 담당에게 알릴 것

| 담당 | 고칠 곳 | 내용 |
| --- | --- | --- |
| FE | `docs/design/api-ws-spec.md` 3장(「R2·S2는 서버 코드에 아직 있다」), `fe-server-proposal.md` 1.0·BE-1 | S2·R2·S5·S6 삭제됨. BE-1의 S2·R2 부분 끝 |
| FE | `tools/browser/scenarios.mjs`(check-browser) | 옛 앱의 S2 흐름(`/features` 요청·재전송)을 확인한다. 이 변경 전부터 V3 앱과 맞지 않는다 |
| DevOps | `tools/deploy/smoke.py`(check-compose) | S2로 측정하고 S5로 재시작 뒤를 확인한다 — `/v2/realtime`과 S4·R1로. B1도 계획 0060의 `frames` 본문으로(이미 알림) |
| 부하 측정(benchmark-server) | `tools/benchmark/runner.py`, `tools/server_benchmark.py` | S2로 부하를 건다 — `/v2/realtime`으로 옮기기. 옮긴 뒤 `feature-response.v1` 계약·예시·시험을 지울 수 있다 |
| 데이터 플랫폼 | `tools/platform/io_api_smoke.py`(S2·S5·S6) | S2 → `/v2/realtime`(`ws_realtime_smoke.py`), S5 빼기, S6 → R3 |
| PM·문서 | `docs/index.md` | 이 계획 링크 |

## 작업 단계

- [x] 관련 문서와 현재 구현 확인(앱이 부르는 API, 도구가 부르는 API)
- [x] BE 코드 삭제(위 범위)
- [x] BE 시험을 `/v2/realtime`으로 옮김: `SessionServiceTest`(`frames`), `MySqlIntegrationTest`(측정·추론 실패 `stalled`·남의 세션 `not_owner`·경로 삭제 확인), `service_smoke.py`
- [x] BE 문서·계약 동기화
- [x] 단위 빌드 `gradlew -p backend build`
- [ ] MySQL이 있는 환경에서 `make check-backend`
- [ ] 다른 담당에게 알림(위 표)

## 결정과 진행 기록

- 2026-10-28 사용자 요청: 지워도 되는 API는 지우고 지운 코드는 로컬에 따로 보관. 「지워도 되는 것」은 앱 기능도 계획도 없는 4개로 정했다. S3와 W1 `records`는 위 이유로 남겼다.
- 판정 상태를 잃은 세션(API 재시작 뒤 `SESSION_LOST`)의 DB 행은 R2가 닫았다(전체 MISSING, good=0). R2를 지우면 그 행은 `ended_at` NULL로 남고 R1에 나오지 않는다.
  앱은 이미 R2를 부르지 않았으므로 실제 동작은 바뀌지 않는다. 시작할 때 열린 행을 닫는 등 서버 쪽 정리는 따로 정한다(남은 일).
- REST 오류에서 `SESSION_ENDED`·`INFERENCE_FAILED`가 없어졌다(S2만 냈다). 실시간 연결은 `closed(ended)`·`stalled`로 그대로 알린다.

## 검증 결과와 남은 한계

실행한 것(2026-10-28, Windows):

- `backend/gradlew -p backend build` — **통과.** 시험 147개 중 실패 0, 건너뜀 11(MySQL이 없어 `MySqlIntegrationTest` 11개 — 새 `unusedRoutesAreRemoved` 포함).
  `SessionServiceTest` 3개는 `/v2/realtime` 입력(`frames`)으로 바꿔 통과.
- `python -m py_compile tools/service_smoke.py tools/realtime_client.py` — 통과.

실행하지 못한 것: `make check-backend`의 MySQL 통합 시험과 HTTP smoke. 이 PC에는 MySQL80 서비스가 있지만 시험용 비밀번호(`POSEGOOD_TEST_MYSQL_PASSWORD` 또는 `.cache/test-mysql-password`)가 설정돼 있지 않다.
`MySqlIntegrationTest`의 바뀐 시나리오(실시간 측정 9초 요약, `stalled` 뒤 다음 구간, 열린 채 남는 유실 세션)와 `service_smoke.py`의 실제 추론 + `/v2/realtime` 측정은 아직 돌려 보지 않았다.
