# 백엔드 개발 상태

> 기준: 2026-11-09 · 브랜치 `develop` `6cae21f`(PR #93·#98·#99·#100, DB 스키마 V2.6. backend 코드는 `fe5058b`와 같음). 10/27~11/03의 BE 브랜치(PR #65·#68·#70·#77·#96·#98)는 모두 develop에 들어갔다. FE V3(PR #69)·FE observation 4.0 대응(PR #99)의 요청·결정도 함께 본다.
> 갱신 규칙: backend/AGENTS.md. 할 일은 계획, 결정 이유는 ADR을 본다.
> 코드 경로: `backend/api/src/main/java/org/posegood/api/` 기준(시험은 `src/test/...`).

## 1. 요약

- 서버에 구현된 판정 경로: API 안 판정([ADR 0020](decisions/0020-single-api-decision-engine.md)) — `/v2/realtime` → `FrameFeatures` → FastAPI `/v2/infer` → `engine/SessionEngine` → MySQL. Kafka 경로 전환은 [계획 0031](plans/active/0031-realtime-kafka-transition.md)을 따른다.
- 큰 한계:
  - 진행 중 세션 상태가 API 메모리에만 있어 한 인스턴스로만 돌린다. 재시작하면 진행 중이던 세션은 `404 SESSION_LOST`(끝난 세션은 S4가 DB로 답함, BE-11).
  - 실제 MySQL 통합 시험(`-Pmysql-integration`)은 2026-11-11 로컬 MySQL 8로 통과했다(2.7). CI·서버 MySQL에서는 아직이다.

## 2. 영역별 현황

### 2.1 계정·동의

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 가입·로그인·로그아웃·`/v2/auth/me` | DB/BE | 구현됨 | `account/AuthController.java` |
| **로그인 토큰**(ADR 0031): access 토큰(JWT HS256, 30분, Bearer, 저장 안 함) + refresh 토큰(HttpOnly 쿠키, 14일, 교체·30초 유예·재사용 감지), `POST /v2/auth/refresh`, WS `hello.access_token`. 쿠키 세션·CSRF·`LoginLifetime` 삭제 | DB/BE | 구현됨 (develop PR #68, MySQL 통합 시험 통과 2.7). FE 토큰 처리(PR #69·#75)·DevOps 도구·초기화 스크립트·`POSEGOOD_JWT_SECRET`(`a793405`) 대응 끝 | `account/AuthTokens.java`, `RefreshTokenRepository.java`, `SecurityConfiguration.java`, `AuthTokensTest`, `api-spec.md` 1·4장 A8, DB V2.6 |
| 비밀번호 변경 (그 사용자의 refresh 토큰 모두 철회, 실시간 연결 닫기. access 토큰은 만료까지 남음) | DB/BE | 구현됨 | `AuthController.java` `PUT /v2/auth/password`, `AccountRepository.removeLogins` |
| 비밀번호 재설정(일회용 메일 링크 30분, 해시만 저장, 완료 시 모든 로그인 철회. 비밀번호를 메일로 보내지 않음) | DB/BE | BE 구현됨·**기본 꺼짐** — DB 표 `password_reset_token`(V2.7, migration 017 작성 — DB 적용 전)·SMTP 설정 전. 단위 시험만, MySQL·실제 메일 미확인 | `account/PasswordResetService.java`, `PasswordResetServiceTest`, [인계](design/social-login-password-reset-handoff.md) |
| Discord 로그인·가입·계정 연결(OAuth 코드 + PKCE, 같은 이메일 자동 연결 안 함, 비밀번호 없는 계정) | DB/BE | BE 구현됨·**기본 꺼짐** — DB 표 `social_identity`(V2.7, migration 017 작성 — DB 적용 전)·Discord 앱 설정 전. 단위 시험만, MySQL·실제 Discord 미확인. 데스크톱 앱은 후속 | `account/SocialLoginService.java`, `SocialController.java`, `SocialLoginServiceTest`, [인계](design/social-login-password-reset-handoff.md) |
| 탈퇴 접수 (철회 없음, CLOSED 로그인은 `403 ACCOUNT_CLOSED`) | DB/BE | 구현됨 | `AuthController.java` `DELETE /v2/auth/account`, [계획 0026](plans/active/0026-backend-v2-rebuild.md) 10/15 기록 |
| 가입 동의 저장 (필수 5종 + 선택) | DB/BE | 구현됨 | `account/ConsentRepository.java`, [ADR 0021](decisions/0021-app-sends-information-server-judges.md) 3절(좌표 전송 동의 필수), [DB 안내](../database/README.md)(`user_consent`) |
| 선택 정보 동의 철회 (나이·직업 비움) | DB/BE | 구현됨 | `workspace/WorkspaceController.java` `PUT /v2/consents/optional-profile` |
| 매시간 탈퇴 삭제 스케줄러 제거 | DB/BE | 구현됨 | 계획 0026 10/15 기록 (`purgeWithdrawn` 삭제) |

### 2.2 설정·기록

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 설정 조회·저장 `/v2/workspace` | DB/BE | 구현됨 | `workspace/WorkspaceController.java` |
| 기록 목록·삭제 `/v2/records` (세션 테이블에서 다시 만듦). 기록 저장(R2)은 2026-10-28 삭제 — 서버가 측정 종료 때 저장(계획 0062) | DB/BE | 구현됨 | `workspace/RecordRebuild.java`, `RecordRebuildTest.java` |
| `daily_stat` 쓰기 중단 (읽기만) | DB/BE | 구현됨 | `session/SessionRepository.java` 66줄 주석, 계획 0026 10/15 기록 |
| 알림 설정 `alerts_on` → `sound_alert_enabled` → 세션 `alert_enabled`. 새 계정 기본값 켜짐(DB V2.6, 2026-10-27 — 미결이던 DB false / FE 켜짐을 켜짐으로 정함) | DB/BE | 구현됨 (develop PR #70) | [ADR 0021](decisions/0021-app-sends-information-server-judges.md) 1절 5번, [DB 안내](../database/README.md) 세션 줄, `backend/README.md`, migration 016 |
| 일별 통계 조회 T1 `GET /v2/stats/daily`, 기록 하나 조회 R1b `GET /v2/records/{id}` | DB/BE | 구현 전 — T1 형식은 확정(2026-10-26: 어제까지로 자름, 빈 날은 0으로 채움, `{today, from, to, days}` 객체, 필드는 `daily_stat` 컬럼 이름 그대로). `daily_stat`은 Spark J2(매일 00:10, 2026-11-01 서버 cron 등록, PR #93)가 채운다. 11/08부터 어제~7일 전을 매일 다시 계산해 바뀐 날만 쓴다(D-81, PR #100) — 최근 7일 값과 `computed_at`은 바뀔 수 있다. R1b는 형식 미정 | FE 요청 BE-2·BE-5 ③ ([FE 제안서](design/fe/fe-server-proposal.md) 1장, V3 브랜치), [API 명세 T1](design/api-spec.md#t1) |

표시 정책(2026-10-22 확정): 오늘 목록·요약·달력·그래프는 앱이 로컬에 수집한 서버 결과로 집계한다([FE 연동 명세 4.5](design/fe/api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위)). 서버 통계(T1)는 어제까지 제공·표시한다 — T1이 `to`를 어제로 자른다.

기록 재계산의 한계(2026-11-10 확인, `workspace/ClosedSessions.java` — 11/11 `RecordHistory`에서 옮겨 S4도 같이 씀):

- 기록의 `server.modelVersion`은 측정 당시가 아니라 지금 설정된 모델 버전이다(기록에 모델 버전을 저장하지 않음). 모델을 바꾸면 옛 기록에도 새 버전이 보인다.
- `GET /v2/workspace`·`GET /v2/records`·`PUT /v2/workspace` 응답은 그 사용자의 끝난 세션 전체와 사건을 매번 다시 계산한다. 기록이 많이 쌓이면 느려질 수 있다.
- `ended_at`이 비어 있는 세션은 목록에 나오지 않는다(4장 「S1은 됐는데 WebSocket이 열리지 않은 세션」과 같은 원인).

### 2.3 기준 자세

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| `POST /v2/baselines`, `GET /v2/baselines/current` (이력 행 추가) | DB/BE | 구현됨 | `session/BaselineController.java`, [ADR 0028](decisions/0028-server-time-for-baseline-registration.md), [ADR 0021](decisions/0021-app-sends-information-server-judges.md) 5절 |
| B1 등록 시각을 서버 시각으로, 재전송은 `registration_id`(UK-16)로 (DB V2.5, migration 015) | DB/BE | 구현됨 (develop PR #65, MySQL 통합 시험 통과 2.7). FE V3가 `registration_id`로 바꿈(PR #69) | [ADR 0028](decisions/0028-server-time-for-baseline-registration.md), `session/BaselineRepository.java` |
| WebSocket 등록 (`purpose: calibration` → `calibration_result`) | DB/BE | **삭제함** (develop PR #70, 2026-10-27) — 등록은 B1뿐. 코드·계약·예시 5개·시험 정리 | `api-spec.md` 11.4 |

### 2.4 측정·실시간 판정 (API 안)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 세션 REST (`PUT`·`/end`·`GET`) | DB/BE | 구현됨. `/metadata`(S5)·`DELETE`(S6)는 2026-10-28 삭제(앱 기능 없음, 기록 삭제는 R3) | `session/SessionController.java`, [계획 0062](plans/active/0062-remove-unused-apis.md) |
| 판정 엔진 (붕괴·회복·재알림) | DB/BE | 구현됨 (Kafka 전환 뒤 삭제 예정) | `engine/`, `SessionEngineTest.java`, ADR 0020 |
| `/v1/realtime` WebSocket | DB/BE | 삭제함 (develop PR #65) — 코드·계약 `realtime-ws.v1`·예시·시험. nginx 경로·infra 안내도 2026-11-09 삭제(D-72, 3장) | `api-spec.md` 10장, `7034f0e` |
| `/v2/realtime` 서버 시각 전달: `ready.started_at`, `closed.ended_at`(끝나기 전에 닫히면 null) | DB/BE | 구현됨 (develop PR #65). FE V3는 대응함(PR #69), Kafka `ws`는 전환 때 맞춤 | [ADR 0028](decisions/0028-server-time-for-baseline-registration.md) 3번, `realtime/RealtimeHandlerV2.java`, `RealtimeHandlerV2Test` |
| `/v2/realtime` WebSocket (좌표 → `FrameFeatures`) | DB/BE | 구현됨 | `realtime/RealtimeHandlerV2.java`, `RealtimeHandlerV2Test.java`, [ADR 0024](decisions/0024-session-ends-on-lost-connection.md) |
| `/v2/realtime` `observation` 3.0 → **4.0** (`sequence`·`valid`·`posture`·`collapse_probability`·`hold_ms`·`recovery_ms`·`invalid_reason`). `sequence`는 앱이 보낸 순번(자정 넘김 뒤에도), `posture`는 세션 `threshold`를 적용한 그 구간의 `good`·`bad`(이탈 후보와 같은 비교 `DecisionRules.candidate`), `hold_ms`는 확정 규칙이 세는 이탈 연속 시간(`Timeline.holdMs`, FE 요청), `recovery_ms`는 회복 규칙이 세는 열린 사건의 바른 연속 시간(`Timeline.recoveryMs`, 사건이 없으면 0, 11/03 FE 요청). 판정 불가면 `posture`·점수 null, `hold_ms`·`recovery_ms` 0. 보내는 시점·순서는 그대로(구간마다) | DB/BE | 구현됨 (develop PR #96, `recovery_ms`는 PR #98 `61365a4`, 2026-11-03, 단위 88개 통과 2.7) — 호환성 깨짐이지만 FE 대응도 develop에 들어감(PR #99): `validObservation`(`frontend/src/features/session/live/messages.ts` 135줄)이 판정 불가 점수 null·`recovery_ms`를 받고, 전환 기간용으로 3.0도 읽음 | `contract/Observation.java` `V4`, `engine/SessionEngine.live`, `SessionEngineTest`(`liveRecoveryIsTheGoodTimeTheOpenEpisodeCounts`), `RealtimeHandlerV2Test`, [계획 0084](plans/active/0084-server-3s-frame-batch-inference.md), `api-spec.md` 9장 |
| 최대 측정 시간 없앰(기본 24시간 = 계약 상한), 재전송 기억 최근 120개 구간 | DB/BE | 구현됨 (develop PR #65) — 2026-10-26 결정. 측정이 길어도 세션 메모리가 늘지 않음 | `engine/SessionEngine.java` `RETRY_WINDOW`, `SessionEngineTest`, `api-spec.md` 11.3 |
| 측정불가(판정 불가·자리 비움) 30분이면 그 지점에서 종료·저장, `closed(unmeasurable_timeout)` | DB/BE | 구현됨, **기본 켜짐 30분**(10/28, 5분에서 바꿈 — `POSEGOOD_UNMEASURABLE_TIMEOUT`, 0이면 끔). 앱은 10/27부터 이 사유를 처리 | `session/SessionService.java`, `SessionServiceTest`, `api-spec.md` 11.3 |
| HTTP 특징 입력 S2 `POST /v2/sessions/{id}/features`, 기록 저장 R2 `POST /v2/records` | DB/BE | **삭제함** (develop PR #77, 2026-10-28) — 앱이 쓰지 않음. MySQL 통합 시험·`service_smoke.py`는 `/v2/realtime`으로 옮김. compose·배포·부하·데이터 플랫폼 도구는 담당에게 알림(계획 0062). 판정 상태를 잃은 세션 행을 닫던 R2가 없어져 그 행은 열린 채 남음 | [계획 0062](plans/active/0062-remove-unused-apis.md), 2.6 BE-1 |
| `/v2/realtime` `valid_ms`·특징을 유효 하위 구간마다 계산 (`api-spec.md` 11.3) | DB/BE | **보류** (2026-10-26) — 지금은 구간 안 판정 가능 프레임 전체를 평균 내고, 유효하면 구간 전체 길이를 `valid_ms`·판정 시간에 더함. 유효·판정 불가 프레임이 섞인 구간에서만 다름 | `session/FrameFeatures.java`, `engine/Timeline.java`, FE 요청 BE-5 ②, 4장 |
| 시작 시 스키마 확인 (V2.6, 12테이블(`SPRING_SESSION` 2개는 확인 안 함), `refresh_token`·`baseline_posture.client_registration_uuid` 필수, V2.4에서 지운 `feature_archive.row_count`가 남으면 거부) | DB/BE | 구현됨 (MySQL 통합 시험 통과 2.7) | `system/SchemaVerifier.java`, `database/README.md` 11장 |

### 2.5 Kafka 전환 (계획 0031)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 1단계 `ws` Kafka 연결 (`posegood.realtime.pipeline`) | PM | 구현 전 | 0031 기준, 10/21 확인 — `backend/api`에 설정 없음 |
| 2단계 API 결과 쓰기 중단·REST 정리 | DB/BE | 구현 전 | 0031 2단계 |
| 4단계 API 안 판정 삭제, ADR 0020 대체 | 전원 | 구현 전 | 0031 4단계 |

### 2.6 FE 요청·배포 (V3 브랜치 기준)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| BE-1: v1 정리 때 `POST /v2/records`·S2 삭제, 동의 문서 `POSE_COORDINATES` 문구를 좌표 프레임 전송에 맞춤 | DB/BE | 일부 — `/v1/realtime`·S2·R2 삭제함(R2·S2는 10/28, 계획 0062), 동의 문구는 구현 전 | FE 제안서 1장, `7034f0e` |
| BE-5: ① 로그인 고정 만료, ② `valid_ms` 하위 구간, ③ T1·R1b, ④ 옛 프로토타입 주석, ⑤ 문서에 남은 옛 앱 동작 | DB/BE | ①④⑤ 끝, ③ T1 형식 확정·구현 전, R1b 구현 전(2.2), ② 보류(2.4·4장) | FE 제안서 1장(V3 브랜치) |
| BE-3: 앱에 W1 `GET /v2/workspace` 연결 (S1 `policy`가 계정 값과 달라 409가 나지 않게) | FE | 끝 — FE가 11/03 develop에서 확인(프로필 화면이 W1·W2 사용, `features/profile/ServerAccountPage.tsx`) | FE 제안서 1장 「끝난 요청」 |
| BE-4: 판정 시간 규칙 이름·단위 통일 (W1·W2 `holdSeconds` 초 / S1 `hold_ms` ms) | DB/BE | 구현 전 (4장 결정 뒤) | FE 제안서 1장 |
| BE-6 (자정 끊기·서버 시각, FE ADR 0029): ① KST 자정에 측정 끊기, ② `ready.started_at`·`closed.ended_at`, ③ A4·R1·T1 `today`, ④ `Cache-Control`, ⑤ J2 실행 시점, ⑥ 계약 맞춤 | DB/BE | ② 끝(`b903751`), ④ FE 철회, ⑤ 끝(Spark, PR #93 — J2 매일 00:10), ① **B안 구현**(10/28 develop PR #77, 같은 연결에서 서버가 새 세션으로 넘김·`session_rollover`, 설정 `midnight-rollover` 기본 꺼짐 — 4장), ③ A4·R1 `today` 구현(R1은 `{today, records}` 객체로 — 호환성 깨짐), T1은 형식에 포함, ⑥ 병합 때(`unmeasurable_timeout` 추가 알림) | FE 제안서 1장·1.1(V3 `259c752`) |
| BE-7: [API 명세](design/api-spec.md) 필드 표에 없던 시간 필드 — 프레임 `t_ms`, 사건 `timestamp_ms`·`onset_ms` | DB/BE | 끝 (2026-11-04 문서만) — 코드에서 뜻을 확인해 `api-spec.md` 9장 SessionView·11.2에 넣음. `t_ms`는 서버가 판정·시간 계산에 쓰지 않음 | FE 제안서 1장, `engine/EpisodeLedger.java`, `engine/Timeline.java` |
| BE-10: 측정 중 WS 줄이기 — `observation`에 `alerting`·`keep_rate`, 결과 요약·사건은 끝난 뒤 S4로 | DB/BE | 구현 전 — 실시간 판정 다시 만들 때 | FE 제안서 1장, [계획 0059](plans/completed/0059-slim-realtime-results-over-api.md) |
| BE-11: S1 `policy` 빼기(없으면 계정 정책), 재배포를 자정과 겹치지 않게, S4가 메모리에 세션이 없으면 DB 값으로 답하기 | DB/BE | S4만 구현(`feature/backend-session-view-from-db`, 11/11): 메모리에 끝난 결과가 없으면 DB에 끝난 값으로 다시 만든 결과(R1 `server.view`와 같음). kafka 모드의 「메모리에 있지만 비어 있는」 세션도 DB가 먼저. 진행 중 세션의 kafka `progress`는 D-57 병합 뒤 PM과. 나머지 두 개는 구현 전 | FE 제안서 1장, FE `fe-measure-end-plan.md` 6장 1번(`fix/fe-realtime-kafka-mode`), `session/SessionService.get`, `workspace/ClosedSessions.java`, `api-spec.md` S4 |
| BE-13: 쉬기 10분 자동 종료를 누가 하는지 (FE 의견: 서버가 `rest` 길이를 세어 `closed(rest_timeout)`) | DB/BE·FE | 미결 (4장) — 10/20 결정이지만 서버·앱 모두 구현 없음 | FE 제안서 1장 |
| R1 `GET /v2/records` 응답을 `{today, records}` 객체로, A2·A3·A4에 `today` | DB/BE | 구현됨 (develop PR #65, MySQL 통합 시험 통과 2.7). 앱(`storage/serverRecords.ts`)·DevOps `io_api_smoke.py`가 `{today, records}`로 읽음 | `workspace/WorkspaceController.java`, `common/KstTime.today()`, `api-spec.md` R1·A4 |
| 화면·API 분리 배포용 CORS (`SecurityConfiguration`) | DB/BE | 구현됨 (`POSEGOOD_CORS_ALLOWED_ORIGINS`, 비우면 CORS 없음). DevOps 요청: `compose.yaml` `api`·`bigdata.yaml` `io-api`에 변수 전달(`compose.yaml`은 목록에 없으면 컨테이너에 안 닿음), 서버 값 `https://app.posegood.site` | `design/fe-server-proposal.md` 9장(옛 `fe-deploy.md`, 그 전 `fe-domain-idea.md`) 9.3.1 S-1 |

### 2.7 검증

| 검사 | 마지막 결과 | 날짜 | 비고 |
|---|---|---|---|
| `backend/gradlew -p backend :api:test` (단위) | 93개 중 81 통과, 실패 0, 건너뜀 12 (`MySqlIntegrationTest`) | 2026-11-11 | `feature/backend-session-view-from-db`(develop `faff869` + S4 DB 조회) 기준, `python tools/dev.py check-backend`(Checkstyle·빌드 포함). 바꾼 파일에 Checkstyle 경고 없음 |
| `backend/gradlew -p backend :api:test -Pmysql-integration` | 93개 모두 통과(`MySqlIntegrationTest` 12개 포함), 실패 0, 건너뜀 0 | 2026-11-11 | `feature/backend-session-view-from-db` 기준. 로컬 MySQL80(Windows) 일회용 DB. `measurementWritesTheV2TablesAndRecordsAreRebuilt`에 「메모리에서 뺀 끝난 세션 → S4 200, R1 `server.view`와 같음」 추가 |
| `tests/test_realtime_ws_v2.py`, `tests/test_realtime_contracts.py` | 11개·8개 통과 | 2026-11-04 | develop `fe5058b`(observation 4.0·`recovery_ms`) 기준. 저장소 `.venv`에서 `python -m unittest` |
| `python tools/check_repository.py` | 통과 | 2026-10-26 | 구조·Markdown 링크 |
| `python tools/dev.py check-backend` (단위 + `-Pmysql-integration` + `service_smoke.py`) | 통과 — 시험 147개, 실패 0, 건너뜀 0(`MySqlIntegrationTest` 11개 포함), smoke 6단계 PASS | 2026-10-29 | 계획 0062(REST 4개 삭제) 커밋 `1b58f80` 기준. 로컬 MySQL80(Windows)에 일회용 DB |
| `database/tests/integrity_check.py` | 확인 필요 | — | V2.4~V2.6에 맞춰 고쳤고 아직 실행 전 (V2.3 기준 130개 통과, 2026-10-13). V2.6: `refresh_token` 제약·탈퇴 철회·CASCADE 검사 추가 |
| `tools/service_smoke.py` | 통과 | 2026-10-29 | 위 `check-backend`의 마지막 단계. 실제 추론 + `/v2/realtime` 측정, `daily_stat` 0행 확인 |
| `make check-compose` (구형 종합 검사) | 삭제로 폐기 | 2026-10-29 | 당시 실패 원인 분석은 [계획 0030](plans/active/0030-make-check-failures.md)에 보존. 현재 재실행 과제가 아니며, 기본 검사와 별도 MySQL·플랫폼 점검은 [품질 기준](quality.md)을 따름 |

위 날짜별 통과 결과는 당시 명령 구성의 기록이다. 현재 `check-backend`는 기본 Java 시험·Checkstyle·빌드만 실행하며,
MySQL 통합은 `-Pmysql-integration`으로 별도 실행한다. `service_smoke.py`·`check_repository.py`는 제거했으며 과거 통과 수치를 현재 검증으로 사용하지 않는다.

## 3. 문서·코드 불일치

| 위치 | 어긋난 내용 | 고칠 곳 | 상태 |
|---|---|---|---|
| `infra/nginx/default.conf` `location = /api/v1/realtime`, `infra/README.md` 44·158줄, `infra/compose/bigdata.yaml` 383줄 주석 | ~~API에서 지운 `/v1/realtime`을 아직 전달·안내함~~ → nginx 블록·안내 문구 삭제 | DB/BE — 2026-11-09 DevOps 요청(D-72). 서버 반영(`nginx -t`·web 다시 띄우기)은 DevOps | 해결 (2026-11-09, 이 브랜치) |
| `docs/architecture.md` 108줄 | ~~"`/v1/realtime`도 함께 열어 두고, 넘어간 뒤 지운다"~~ → "서버의 `/v1/realtime`은 2026-10-26 지웠다"로 고쳐짐 | — | 해결 (2026-11-03 확인) |
| `docs/design/architecture_v5.2_change_notes.md` 「자세 등록」·FE 줄, `architecture_v5.2_stack_roles.md` 추론 서비스 줄 | 등록 전용 WS·추론이 평균 계산 — 앱은 3초 평균을 B1으로 보냄(FE ADR 0021, BE-5 ⑤) | PM·DevOps(문서 담당)에 갱신 요청 | 요청 전 |
| `docs/plans/active/0031-realtime-kafka-transition.md` 79·84줄 | 최대 측정 시간을 「팀 회의 결과를 따른다, 5000초 유지」로 적음 — 2026-10-26 결정(제품 한도 없음)·10/28 결정(측정불가 30분 자동 종료, 기본 켬)과 다름. 10/26 v1 정리 기록도 없음 | 계획 공동 담당(DevOps·PM)에 갱신 요청(BE가 계획 0031을 직접 고치지 않기로 함) | 요청 전 |
| `infra/mysql/initdb/10-posegood-schema.sh` | ~~빈 볼륨에 `schema_V2_5.sql`을 적용함~~ → 2026-10-27 `schema_V2_6.sql`로 고침(DB). ~~`POSEGOOD_JWT_SECRET` 전달~~ → DevOps가 반영(`a793405`, `infra/README.md` 79줄: 없으면 호스트가 처음 한 번 만들어 유지) | — | 해결 (compose 전달 경로는 DevOps 확인) |
| `tools/platform/io_api_smoke.py`, `tools/platform/ws_realtime_smoke.py` | ~~쿠키·CSRF 로그인과 쿠키 WS 인증~~ → Bearer 토큰·`hello.access_token`으로 바뀜(`a793405`) | — | 해결 (2026-11-03 확인) |
| `tools/platform/io_api_smoke.py` 204·205줄 | ~~R1을 배열로 읽음~~ → `{today, records}` 객체로 읽음 | — | 해결 (2026-11-03 확인) |
| `contracts/consent-documents.v2.md` `POSE_COORDINATES` | "측정 중에는 기준 대비 **특징 변화량**"을 보낸다고 적힘 — `/v2/realtime`은 좌표 프레임을 받는다 | 문구 수정 (BE-1, 공지 ⑦ 개인정보 고지와 함께) | 구현 전 |
| `docs/design/fe/api-ws-spec.md`, `fe-server-proposal.md`, `fe-3sec.md` | ~~`observation` 3.0 필드(`valid_ms`·`start_ms` 등)와 「서버가 3초 묶음」 기준~~ → FE가 4.0(구간마다)으로 고침, `fe-3sec.md`는 지움(`a90274d`, PR #99) | — | 해결 (2026-11-04 확인) |

## 4. 미결 결정

| 질문 | 담당 | 관련 문서 |
|---|---|---|
| API 다중 인스턴스 (진행 상태 공유·세션 고정) | DB/BE·DevOps | `backend/README.md` 「다음 결정」 1, D-42 |
| 자정 넘김을 켜는 시점 (`POSEGOOD_MIDNIGHT_ROLLOVER=true`) — 앱이 `session_rollover`(기록 나누기, 새 `session_id`로 S3·기록 저장)를 처리한 뒤. Spark J2는 00:10에 돈다(BE-6 ⑤ 끝, PR #93). `monitor_session.client_session_uuid` 주석(「클라이언트가 발급」)을 서버 발급까지로 고칠지(migration 필요) | DB/BE·FE·Spark | `api-spec.md` 11.3, FE ADR 0029 |
| ADR 0020 대체 시점 | DB/BE·DevOps | 계획 0031 |
| 적재된 세션의 기록 삭제 방식 (`RECORDS_ONLY` 유지 여부) | DB/BE·J3 | 「DB-V2.4-변경사항」 7장 (보류) |
| 삭제 완료 기록(`DONE`·`data_deleted_at`)을 DB에 남길지 | DB/BE·PM | 「DB-V2.4-변경사항」 7장 (보류), 공지 ⑦ |
| S1은 됐는데 WebSocket이 열리지 않은 세션을 누가 닫을지 (앱 S3 / 서버 시간 제한). 측정 종료 저장(`end`·연결 끊김)이 DB 오류로 실패한 세션도 같다 — 판정은 끝났지만 다시 저장하는 길은 S3뿐이고 앱은 S3를 부르지 않는다(`RealtimeHandlerV2.end`, 2026-11-10 확인) | DB/BE·FE | FE 제안서 1장 질문(10/22). 안 닫으면 `ended_at` NULL 행이 남아 J1·J2·기록 목록에 영향 |
| 판정 시간 규칙 이름·단위 (BE-4) | DB/BE·FE | 2.6 |
| 쉬기 10분 자동 종료를 서버가 할지 (BE-13, 안: `closed(rest_timeout)`) | DB/BE·FE | 2.6, FE 제안서 1장 |
| 세션 안 시각(③) — 서버 시계로 경과 ms의 상한을 검사할지 (보류) | DB/BE | ADR 0028 4번 |
| `valid_ms` 하위 구간 (BE-5 ②, 보류) — 특징을 낼 조각(가장 긴 조각/조각별 추론), 구간 안 판정 불가가 연속 시간을 끊는지, 그 시간을 `excluded_interval`에 남길지(`RecordRebuild`가 행 합계로 유효 시간을 다시 만듦), Kafka 판정과 맞추기. 줄어든 시간은 `unknown_ms`로(FE 앱이 `valid = normal + deviation`, `total = 각 시간 합`을 검사) | DB/BE·DevOps | 2.4, `api-spec.md` 11.3 |

## 5. 갱신 기록

| 날짜 | 내용 | 커밋 |
|---|---|---|
| 2026-10-21 | 처음 작성 | `b4122e9` 기준 |
| 2026-10-21 | DevOps·Spark 담당 항목 제거 (처리 서비스, 옛 CEP 경로, J1~J3, 서버 PC 검증 기록) | `3f2bbf8` 이후 |
| 2026-10-21 | `database/README.md` 9장 비밀번호 변경·11장 링크를 고쳐 불일치 2건 제거 | `3f2bbf8` 이후 |
| 2026-10-21 | DB V2.4 작업본 반영: `SchemaVerifier` V2.4 확인, 무결성 검사·README 철회 문구 정리(불일치 2건 제거), `row_count` 미결 → 확정(삭제), 보류 결정 2건 추가 | 커밋 전 |
| 2026-10-22 | 탈퇴 철회 경로 삭제, 서버 통계는 어제까지·오늘 화면은 로컬 수집 결과 사용으로 표시 정책 명시 | - |
| 2026-10-26 | 기준을 `develop`으로. 불일치 4건 해결(`AuthController` 주석, `backend/README.md` 링크, `service_smoke.py` 기대값, 계획 0026 표) → 새 불일치 3건 기록. FE V3의 요청(BE-1·3·4, T1·R1b, CORS)과 미결 4건 추가 | `2de7c83` |
| 2026-10-26 | ADR 0028: B1 등록 시각 서버화·`registration_id`, DB V2.5(migration 015). `registered_at` 설명 불일치 해결, 미결 1건 결정, ④-A·③ 기록 | `cab11c1` |
| 2026-10-26 | ADR 0028 ④ 구현: `/v2/realtime` `ready.started_at`·`closed.ended_at`, 계약·예시·시험. 미결 1건 → 구현됨 | `b903751` |
| 2026-10-26 | FE 요청 BE-5 반영: ① 로그인 고정 30분 만료 구현(refresh 토큰 전환 예정, 4장), ③ T1·R1b 제공하지 않음, ④ 옛 프로토타입 주석 정리, ⑤ 옛 앱 동작 문서 정리(BE 문서만: api-spec 11.4·README. infra·아키텍처 문서는 담당에 요청, 3장). ② `valid_ms` 하위 구간은 보류(4장). BE-1·계획 0031의 `/v1/realtime` 삭제 | `7034f0e` |
| 2026-10-26 | BE-5 ③ 「T1·R1b 제공하지 않음」을 되돌림(없앤 경로가 아니라 구현 전). T1 형식 확정(API 명세 T1) | `fdd1269` |
| 2026-10-26 | 최대 측정 시간 결정(D안): 제품 한도 없앰·재전송 기억 120개, 측정불가 5분 자동 종료(기본 꺼짐). 미결 「최대 측정 시간」 → 「자동 종료 켜는 시점」 | `725bca0` |
| 2026-10-27 | BE-6 ③: A2·A3·A4 `today`, R1을 `{today, records}` 객체로(호환성 깨짐). BE-6 ① 자정 끊기 보류. `closed` 사유 이름 `unmeasurable_timeout` 유지 | `d27a97d` |
| 2026-10-27 | 계획 0031에 넣었던 BE 기록을 되돌리고(공동 문서), 그 근거를 이 문서·api-spec으로 옮김. 계획 0031 갱신은 담당에 요청(3장) | `80ba7db` |

| 2026-10-27 | 로그인 토큰(ADR 0031): JWT access + refresh, DB V2.6(`refresh_token`, migration 016), 쿠키 세션·CSRF·`LoginLifetime` 삭제, WS `hello.access_token`. 미결 「refresh 토큰」 → 구현됨. DevOps 요청 2건(초기화 스크립트·JWT 비밀값, 점검 도구) 추가 | `351eb3f` (PR #68) |
| 2026-10-27 | 알림 기본값 결정: 새 계정 켜짐(DB V2.6 `sound_alert_enabled` 기본값 참, 버전은 그대로 V2.6). 미결 「알림 기본값」 삭제 | `465f464` (PR #70) |
| 2026-10-27 | WebSocket 자세 등록 삭제(코드·계약·예시·시험, `phase: calibration` 포함). 미결 「WS 등록을 남길지」 → 삭제. api-spec 머리말 갱신(V2.6) | `465f464` (PR #70) |
| 2026-10-27 | FE 요청(서버 공개 연결) 반영: REST CORS 구현(FE 제안서 9.3.1 S-1, 단위·MySQL 통합 시험). DB 초기화 스크립트 V2.5 → V2.6(불일치 1건 해결) | `0f0f83e` (PR #70) |
| 2026-10-28 | 측정불가 자동 종료 5분 → 30분으로 바꾸고 기본으로 켬(앱이 `closed(unmeasurable_timeout)`을 10/27부터 처리). 미결 「측정불가 자동 종료를 켜는 시점」 삭제 | `6903c1e` (PR #77) |
| 2026-10-28 | 자정 넘김 B안 구현(BE-6 ①): 자정을 넘는 구간 또는 00:00:30에 이전 세션을 마지막 구간 끝에서 끝내 저장하고 같은 연결에서 서버가 만든 새 세션(같은 기준 자세·설정·알림, `started_at` = 자정)으로 넘김, `session_rollover`. 앱 시간·순번은 연결 기준 그대로 받아 서버가 바꿈. 실패하면 `closed(day_changed)`. 기본 꺼짐. 계약·예시·단위 시험. 실제 MySQL 시험(`INSERT … SELECT`)은 아직 | `cb92081` (PR #77) |
| 2026-10-29 | `check-backend`(MySQL 통합 11개·smoke 포함) 통과 기록. api-spec의 요청·응답 예시를 합성 실행에서 받은 실제 값으로 바꿈(R1 `type`·소수 시간·`server.view` 객체, WS `hello.access_token` 등 예시와 달랐던 곳 바로잡음) | `f11f0a8` (PR #77) |
| 2026-10-29 | 10/28 B1 프레임 배열·서버 평균(`748af6a`)을 되돌림: B1은 다시 앱이 낸 평균(`calibration_ms`·`sample_count`·`landmarks`)을 받는다. 422 `BASELINE_REJECTED` 삭제. alert_enabled 시험 수정(V2.6 기본값)은 유지. 철회 이유는 [계획 0063](plans/completed/0063-baseline-frames-over-rest.md) | `6ecfa0b` (PR #77) |
| 2026-11-03 | 실시간 `observation` 4.0(구간마다, `posture`·`hold_ms` 추가, `sequence` 유지, 판정 불가 점수 null, 3.0 필드 6개 삭제 — 호환성 깨짐). 임계값 비교를 `DecisionRules.candidate`로 모음. FE 문서 불일치 1건 추가(3장) | `1d6f811`·`45c5c19` (PR #96) |
| 2026-11-03 | 문서 최신화: 기준을 develop `e01ba49`로, develop에 들어간 항목의 「(브랜치)」·「커밋 전」을 PR·커밋으로, 2.7에 11/03 단위 87개·MySQL 통합 11개 기록, develop 앱이 observation 4.0을 버리는 위험(1·2.4장) 추가, 3장 불일치 4건 해결 확인(architecture.md, 점검 도구 2건, JWT 비밀값) | 이 커밋 |
| 2026-11-03 | 실시간 `observation` 4.0에 `recovery_ms` 추가(FE 요청, 계획 0084 29번): 열린 사건의 바른 연속 시간, 사건이 없거나 판정 불가면 0. 판정 방식은 그대로 | `61365a4` (PR #98) |
| 2026-11-09 | 문서 최신화: 기준을 develop `6cae21f`로(11/04 `fe5058b` 기준 작업에 PR #100 반영). J2 최근 7일 다시 계산(D-81)을 T1 줄·API 명세·DB 안내(규칙·구현 상태 — 계획 0085가 DB/BE에 요청)에 반영. nginx `/v1/realtime` 정리는 DevOps 요청으로 DB/BE 담당(3장). FE observation 4.0 대응(PR #99)이 들어와 「develop 앱이 4.0을 버린다」 위험 삭제(1·2.4장), 3장 FE 문서 불일치 해결. J2 00:10(PR #93)으로 BE-6 ⑤ 끝·4장 문구 고침. BE-3 끝(FE 확인), FE 새 요청 BE-7(명세 시간 필드 — `api-spec.md`에 넣어 끝)·BE-10·BE-11·BE-13 추가. 2.7에 단위 88개·계약 시험 19개 다시 실행 | 이 커밋 |
| 2026-11-09 | nginx `/api/v1/realtime` 블록과 infra 안내(`infra/README.md`·`bigdata.yaml` 주석)의 v1 문구 삭제(DevOps 요청 D-72). 처리 서비스 시험용 입구 `/api/v1/realtime/features`는 다른 경로라 그대로 | 이 커밋 |
| 2026-11-10 | 2.2 기록 줄에서 지운 기록 저장(R2) 빼기, 기록 재계산 한계 3건 기록. 4장 「닫히지 않는 세션」에 종료 저장 실패 경우 추가(`ca038e2`) | 커밋 전 |
| 2026-11-11 | BE-11 중 S4: 메모리에 끝난 결과가 없으면 DB에 끝난 값으로 다시 만든 결과로 답함(kafka 모드에서 S4가 빈 결과를 주던 문제 대비, 계획 0031 11번). 기록 목록의 DB 읽기를 `ClosedSessions`로 옮겨 R1·S4가 같이 씀. 단위 시험 2개·MySQL 통합 확인 추가(MySQL 통합 포함 93개 통과, 2.7) | 이 커밋 |

## 이메일 인증·비밀번호 재설정 후속 인계 (2026-10-26)

[연결 인계](design/email-account-handoff.md)는 프론트가 준비한 페이지/제안 요청과 BE·DB·SMTP 후속 작업을 구분한다. 서버 비밀번호는 기존 BCrypt12 해시 저장을 유지한다. 이번 작업에서 SMTP/이메일 인증 API/재설정 API/DB migration은 구현·적용하지 않았다. 실제 계정·메일 발송과 프론트 로컬 미리보기를 혼동하지 않는다.
