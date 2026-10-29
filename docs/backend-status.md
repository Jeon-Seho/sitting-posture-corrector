# 백엔드 개발 상태

> 기준: 2026-10-27 · 브랜치 `develop`(PR #65 `2e1fd2b`, DB 스키마 V2.5) · 작업 브랜치 `feature/repo-auth-refresh-token`(로그인 토큰, DB V2.6, ADR 0031). FE `feature/frontend-features-and-integrationV3`(미병합)의 요청·결정도 함께 본다.
> 갱신 규칙: backend/AGENTS.md. 할 일은 계획, 결정 이유는 ADR을 본다.
> 코드 경로: `backend/api/src/main/java/org/posegood/api/` 기준(시험은 `src/test/...`).

## 1. 요약

- 서버에 구현된 판정 경로: API 안 판정([ADR 0020](decisions/0020-single-api-decision-engine.md)) — `/v2/realtime` → `FrameFeatures` → FastAPI `/v2/infer` → `engine/SessionEngine` → MySQL. Kafka 경로 전환은 [계획 0031](plans/active/0031-realtime-kafka-transition.md)을 따른다.
- 큰 한계:
  - 진행 중 세션 상태가 API 메모리에만 있어 한 인스턴스로만 돌린다. 재시작하면 `404 SESSION_LOST`.
  - 실제 MySQL 통합 시험(`-Pmysql-integration`)은 2026-10-29 이 PC의 MySQL 8로 통과했다(`make check-backend`, 4장). CI·서버 MySQL에서는 아직이다.

## 2. 영역별 현황

### 2.1 계정·동의

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 가입·로그인·로그아웃·`/v2/auth/me` | DB/BE | 구현됨 | `account/AuthController.java` |
| **로그인 토큰**(ADR 0031): access 토큰(JWT HS256, 30분, Bearer, 저장 안 함) + refresh 토큰(HttpOnly 쿠키, 14일, 교체·30초 유예·재사용 감지), `POST /v2/auth/refresh`, WS `hello.access_token`. 쿠키 세션·CSRF·`LoginLifetime` 삭제 | DB/BE | 구현됨 (브랜치 `feature/repo-auth-refresh-token`, MySQL로는 미확인) — **호환성 깨짐**: FE 토큰 처리, DevOps 도구·초기화 스크립트·`POSEGOOD_JWT_SECRET` 필요(3장) | `account/AuthTokens.java`, `RefreshTokenRepository.java`, `SecurityConfiguration.java`, `AuthTokensTest`, `api-spec.md` 1·4장 A8, DB V2.6 |
| 비밀번호 변경 (그 사용자의 refresh 토큰 모두 철회, 실시간 연결 닫기. access 토큰은 만료까지 남음) | DB/BE | 구현됨 | `AuthController.java` `PUT /v2/auth/password`, `AccountRepository.removeLogins` |
| 탈퇴 접수 (철회 없음, CLOSED 로그인은 `403 ACCOUNT_CLOSED`) | DB/BE | 구현됨 | `AuthController.java` `DELETE /v2/auth/account`, [계획 0026](plans/active/0026-backend-v2-rebuild.md) 10/15 기록 |
| 가입 동의 저장 (필수 5종 + 선택) | DB/BE | 구현됨 | `account/ConsentRepository.java`, [ADR 0021](decisions/0021-app-sends-information-server-judges.md) 3절(좌표 전송 동의 필수), [DB 안내](../database/README.md)(`user_consent`) |
| 선택 정보 동의 철회 (나이·직업 비움) | DB/BE | 구현됨 | `workspace/WorkspaceController.java` `PUT /v2/consents/optional-profile` |
| 매시간 탈퇴 삭제 스케줄러 제거 | DB/BE | 구현됨 | 계획 0026 10/15 기록 (`purgeWithdrawn` 삭제) |

### 2.2 설정·기록

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 설정 조회·저장 `/v2/workspace` | DB/BE | 구현됨 | `workspace/WorkspaceController.java` |
| 기록 목록·저장·삭제 `/v2/records` (세션 테이블에서 다시 만듦) | DB/BE | 구현됨 | `workspace/RecordRebuild.java`, `RecordRebuildTest.java` |
| `daily_stat` 쓰기 중단 (읽기만) | DB/BE | 구현됨 | `session/SessionRepository.java` 66줄 주석, 계획 0026 10/15 기록 |
| 알림 설정 `alerts_on` → `sound_alert_enabled` → 세션 `alert_enabled`. 새 계정 기본값 켜짐(DB V2.6, 2026-10-27 — 미결이던 DB false / FE 켜짐을 켜짐으로 정함) | DB/BE | 구현됨 (브랜치) | [ADR 0021](decisions/0021-app-sends-information-server-judges.md) 1절 5번, [DB 안내](../database/README.md) 세션 줄, `backend/README.md`, migration 016 |
| 일별 통계 조회 T1 `GET /v2/stats/daily`, 기록 하나 조회 R1b `GET /v2/records/{id}` | DB/BE | 구현 전 — T1 형식은 확정(2026-10-26: 어제까지로 자름, 빈 날은 0으로 채움, `{today, from, to, days}` 객체, 필드는 `daily_stat` 컬럼 이름 그대로). `daily_stat`은 Spark J2가 채우므로 J2 전에는 0만 나옴. R1b는 형식 미정 | FE 요청 BE-2·BE-5 ③ ([FE 제안서](design/fe-server-proposal.md) 1장, V3 브랜치), [API 명세 T1](design/api-spec.md#t1) |

표시 정책(2026-10-22 확정): 오늘 목록·요약·달력·그래프는 앱이 로컬에 수집한 서버 결과로 집계한다([FE 연동 명세 4.5](design/api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위)). 서버 통계(T1)는 어제까지 제공·표시한다 — T1이 `to`를 어제로 자른다.

### 2.3 기준 자세

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| `POST /v2/baselines`, `GET /v2/baselines/current` (이력 행 추가) | DB/BE | 구현됨 | `session/BaselineController.java`, [ADR 0028](decisions/0028-server-time-for-baseline-registration.md), [ADR 0021](decisions/0021-app-sends-information-server-judges.md) 5절 |
| B1 등록 시각을 서버 시각으로, 재전송은 `registration_id`(UK-16)로 (DB V2.5, migration 015) | DB/BE | 구현됨 (브랜치, MySQL로는 미확인) — **호환성 깨짐**: `registered_at`을 보내는 FE V3는 400. FE가 함께 바꿔야 함 | [ADR 0028](decisions/0028-server-time-for-baseline-registration.md), `session/BaselineRepository.java` |
| WebSocket 등록 (`purpose: calibration` → `calibration_result`) | DB/BE | **삭제함** (브랜치, 2026-10-27) — 등록은 B1뿐. 코드·계약·예시 5개·시험 정리 | `api-spec.md` 11.4 |

### 2.4 측정·실시간 판정 (API 안)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 세션 REST (`PUT`·`/end`·`GET`) | DB/BE | 구현됨. `/metadata`(S5)·`DELETE`(S6)는 2026-10-28 삭제(앱 기능 없음, 기록 삭제는 R3) | `session/SessionController.java`, [계획 0061](plans/active/0061-remove-unused-apis.md) |
| 판정 엔진 (붕괴·회복·재알림) | DB/BE | 구현됨 (Kafka 전환 뒤 삭제 예정) | `engine/`, `SessionEngineTest.java`, ADR 0020 |
| `/v1/realtime` WebSocket | DB/BE | 삭제함 (브랜치) — 코드·계약 `realtime-ws.v1`·예시·시험. nginx 경로·infra 안내는 DevOps 몫(3장) | `api-spec.md` 10장, `7034f0e` |
| `/v2/realtime` 서버 시각 전달: `ready.started_at`, `closed.ended_at`(끝나기 전에 닫히면 null) | DB/BE | 구현됨 (브랜치) — **호환성 깨짐**: 엄격한 앱 검증은 새 필드를 거부. FE·Kafka `ws`도 맞춰야 함 | [ADR 0028](decisions/0028-server-time-for-baseline-registration.md) 3번, `realtime/RealtimeHandlerV2.java`, `RealtimeHandlerV2Test` |
| `/v2/realtime` WebSocket (좌표 → `FrameFeatures`) | DB/BE | 구현됨 | `realtime/RealtimeHandlerV2.java`, `RealtimeHandlerV2Test.java`, [ADR 0024](decisions/0024-session-ends-on-lost-connection.md) |
| 최대 측정 시간 없앰(기본 24시간 = 계약 상한), 재전송 기억 최근 120개 구간 | DB/BE | 구현됨 (브랜치) — 2026-10-26 결정. 측정이 길어도 세션 메모리가 늘지 않음 | `engine/SessionEngine.java` `RETRY_WINDOW`, `SessionEngineTest`, `api-spec.md` 11.3 |
| 측정불가(판정 불가·자리 비움) 30분이면 그 지점에서 종료·저장, `closed(unmeasurable_timeout)` | DB/BE | 구현됨, **기본 켜짐 30분**(10/28, 5분에서 바꿈 — `POSEGOOD_UNMEASURABLE_TIMEOUT`, 0이면 끔). 앱은 10/27부터 이 사유를 처리 | `session/SessionService.java`, `SessionServiceTest`, `api-spec.md` 11.3 |
| HTTP 특징 입력 S2 `POST /v2/sessions/{id}/features`, 기록 저장 R2 `POST /v2/records` | DB/BE | **삭제함** (브랜치, 2026-10-28) — 앱이 쓰지 않음. MySQL 통합 시험·`service_smoke.py`는 `/v2/realtime`으로 옮김. compose·배포·부하·데이터 플랫폼 도구는 담당에게 알림(계획 0061). 판정 상태를 잃은 세션 행을 닫던 R2가 없어져 그 행은 열린 채 남음 | [계획 0061](plans/active/0061-remove-unused-apis.md), 2.6 BE-1 |
| `/v2/realtime` `valid_ms`·특징을 유효 하위 구간마다 계산 (`api-spec.md` 11.3) | DB/BE | **보류** (2026-10-26) — 지금은 구간 안 판정 가능 프레임 전체를 평균 내고, 유효하면 구간 전체 길이를 `valid_ms`·판정 시간에 더함. 유효·판정 불가 프레임이 섞인 구간에서만 다름 | `session/FrameFeatures.java`, `engine/Timeline.java`, FE 요청 BE-5 ②, 4장 |
| 시작 시 스키마 확인 (V2.6, 12테이블(`SPRING_SESSION` 2개는 확인 안 함), `refresh_token`·`baseline_posture.client_registration_uuid` 필수, V2.4에서 지운 `feature_archive.row_count`가 남으면 거부) | DB/BE | 구현됨 (MySQL로는 미확인) | `system/SchemaVerifier.java`, `database/README.md` 11장 |

### 2.5 Kafka 전환 (계획 0031)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 1단계 `ws` Kafka 연결 (`posegood.realtime.pipeline`) | PM | 구현 전 | 0031 기준, 10/21 확인 — `backend/api`에 설정 없음 |
| 2단계 API 결과 쓰기 중단·REST 정리 | DB/BE | 구현 전 | 0031 2단계 |
| 4단계 API 안 판정 삭제, ADR 0020 대체 | 전원 | 구현 전 | 0031 4단계 |

### 2.6 FE 요청·배포 (V3 브랜치 기준)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| BE-1: v1 정리 때 `POST /v2/records`·S2 삭제, 동의 문서 `POSE_COORDINATES` 문구를 좌표 프레임 전송에 맞춤 | DB/BE | 일부 — `/v1/realtime`·S2·R2 삭제함(R2·S2는 10/28, 계획 0061), 동의 문구는 구현 전 | FE 제안서 1장, `7034f0e` |
| BE-5: ① 로그인 고정 만료, ② `valid_ms` 하위 구간, ③ T1·R1b, ④ 옛 프로토타입 주석, ⑤ 문서에 남은 옛 앱 동작 | DB/BE | ①④⑤ 끝, ③ T1 형식 확정·구현 전, R1b 구현 전(2.2), ② 보류(2.4·4장) | FE 제안서 1장(V3 브랜치) |
| BE-3: 앱에 W1 `GET /v2/workspace` 연결 (S1 `policy`가 계정 값과 달라 409가 나지 않게) | 확인 필요 — 앱 코드 작업이라 FE와 담당 정리 | 구현 전 | FE 제안서 1장 |
| BE-4: 판정 시간 규칙 이름·단위 통일 (W1·W2 `holdSeconds` 초 / S1 `hold_ms` ms) | DB/BE | 구현 전 (4장 결정 뒤) | FE 제안서 1장 |
| BE-6 (자정 끊기·서버 시각, FE ADR 0029): ① KST 자정에 측정 끊기, ② `ready.started_at`·`closed.ended_at`, ③ A4·R1·T1 `today`, ④ `Cache-Control`, ⑤ J2 실행 시점, ⑥ 계약 맞춤 | DB/BE | ② 끝(`b903751`), ④ FE 철회, ⑤ Spark 몫, ① **B안 구현**(10/28, 같은 연결에서 서버가 새 세션으로 넘김·`session_rollover`, 설정 `midnight-rollover` 기본 꺼짐 — 4장), ③ A4·R1 `today` 구현(R1은 `{today, records}` 객체로 — 호환성 깨짐), T1은 형식에 포함, ⑥ 병합 때(`unmeasurable_timeout` 추가 알림) | FE 제안서 1장·1.1(V3 `259c752`) |
| R1 `GET /v2/records` 응답을 `{today, records}` 객체로, A2·A3·A4에 `today` | DB/BE | 구현됨 (브랜치, MySQL로는 미확인) — **호환성 깨짐**: R1을 배열로 읽는 곳(FE 연동 명세, DevOps `tools/platform/io_api_smoke.py` 172줄)을 맞춰야 함 | `workspace/WorkspaceController.java`, `common/KstTime.today()`, `api-spec.md` R1·A4 |
| 화면·API 분리 배포용 CORS (`SecurityConfiguration`) | DB/BE | 구현됨 (`POSEGOOD_CORS_ALLOWED_ORIGINS`, 비우면 CORS 없음). DevOps 요청: `compose.yaml` `api`·`bigdata.yaml` `io-api`에 변수 전달(`compose.yaml`은 목록에 없으면 컨테이너에 안 닿음), 서버 값 `https://app.posegood.site` | `design/fe-deploy.md`(V3, develop은 `fe-domain-idea.md`) 3.1 S-1 |

### 2.7 검증

| 검사 | 마지막 결과 | 날짜 | 비고 |
|---|---|---|---|
| `backend/gradlew -p backend :api:test` (단위) | 76개 중 67 통과, 실패 0, 건너뜀 9 (`MySqlIntegrationTest`) | 2026-10-27 | 로그인 토큰 후(`AuthTokensTest` 5개, 핸들러 로그인 철회 시험 추가, `LoginLifetimeTest` 삭제, 통합 시험은 토큰 방식으로 고치고 컴파일만 확인). 로컬 JDK 17 |
| `tests/test_realtime_ws_v2.py`, `tests/test_realtime_contracts.py` | 7개·8개 통과 | 2026-10-27 | `hello.access_token` 추가 후. 임시 가상환경(jsonschema 4.23.0)에서 실행 |
| `python tools/check_repository.py` | 통과 | 2026-10-26 | 구조·Markdown 링크 |
| `python tools/dev.py check-backend` (단위 + `-Pmysql-integration` + `service_smoke.py`) | 통과 — 시험 147개, 실패 0, 건너뜀 0(`MySqlIntegrationTest` 11개 포함), smoke 6단계 PASS | 2026-10-29 | 계획 0061(REST 4개 삭제) 커밋 `1b58f80` 기준. 로컬 MySQL80(Windows)에 일회용 DB |
| `database/tests/integrity_check.py` | 확인 필요 | — | V2.4~V2.6에 맞춰 고쳤고 아직 실행 전 (V2.3 기준 130개 통과, 2026-10-13). V2.6: `refresh_token` 제약·탈퇴 철회·CASCADE 검사 추가 |
| `tools/service_smoke.py` | 통과 | 2026-10-29 | 위 `check-backend`의 마지막 단계. 실제 추론 + `/v2/realtime` 측정, `daily_stat` 0행 확인 |
| `make check-compose` | 확인 필요 | 2026-10-14 | 실패 원인 분석만 있음 ([계획 0030](plans/active/0030-make-check-failures.md)) |

## 3. 문서·코드 불일치

| 위치 | 어긋난 내용 | 고칠 곳 | 상태 |
|---|---|---|---|
| `infra/nginx/default.conf` `location = /api/v1/realtime`, `infra/README.md` 44·153줄 | API에서 지운 `/v1/realtime`을 아직 전달·안내함(연결하면 실패) | DevOps(infra 담당)에 삭제 요청 | 요청 전 |
| `docs/architecture.md` 105줄 | "`/v1/realtime`도 함께 열어 두고, 넘어간 뒤 지운다" | 문서 담당에 갱신 요청 | 요청 전 |
| `docs/design/architecture_v5.2_change_notes.md` 「자세 등록」·FE 줄, `architecture_v5.2_stack_roles.md` 추론 서비스 줄 | 등록 전용 WS·추론이 평균 계산 — 앱은 3초 평균을 B1으로 보냄(FE ADR 0021, BE-5 ⑤) | PM·DevOps(문서 담당)에 갱신 요청 | 요청 전 |
| `docs/plans/active/0031-realtime-kafka-transition.md` 79·84줄 | 최대 측정 시간을 「팀 회의 결과를 따른다, 5000초 유지」로 적음 — 2026-10-26 결정(제품 한도 없음, 측정불가 5분 자동 종료)과 다름. 10/26 v1 정리 기록도 없음 | 계획 공동 담당(DevOps·PM)에 갱신 요청(BE가 계획 0031을 직접 고치지 않기로 함) | 요청 전 |
| `infra/mysql/initdb/10-posegood-schema.sh` | ~~빈 볼륨에 `schema_V2_5.sql`을 적용함~~ → 2026-10-27 `schema_V2_6.sql`로 고침(DB). 남은 것: Compose `api`에 `POSEGOOD_JWT_SECRET`(32바이트 이상) 전달 | DevOps에 `POSEGOOD_JWT_SECRET` 추가 요청 | 초기화 스크립트 완료, 비밀값 요청 전 |
| `tools/platform/io_api_smoke.py`, `tools/platform/ws_realtime_smoke.py` | 쿠키·CSRF 로그인(`/v2/auth/csrf`)과 쿠키 WS 인증을 씀 — 토큰 로그인(ADR 0031)에서 실패 | DevOps에 Bearer 토큰·`hello.access_token`으로 바꿔 달라고 요청 | 요청 전 |
| `tools/platform/io_api_smoke.py` 172줄 | R1을 배열로 읽음 — 2026-10-27부터 `{today, records}` 객체 | DevOps에 수정 요청 | 요청 전 |
| `contracts/consent-documents.v2.md` `POSE_COORDINATES` | "측정 중에는 기준 대비 **특징 변화량**"을 보낸다고 적힘 — `/v2/realtime`은 좌표 프레임을 받는다 | 문구 수정 (BE-1, 공지 ⑦ 개인정보 고지와 함께) | 구현 전 |

## 4. 미결 결정

| 질문 | 담당 | 관련 문서 |
|---|---|---|
| API 다중 인스턴스 (진행 상태 공유·세션 고정) | DB/BE·DevOps | `backend/README.md` 「다음 결정」 1, D-42 |
| 자정 넘김을 켜는 시점 (`POSEGOOD_MIDNIGHT_ROLLOVER=true`) — 앱이 `session_rollover`(기록 나누기, 새 `session_id`로 S3·기록 저장)를 처리한 뒤. Spark J2는 00:05 이후에 돌아야 함(BE-6 ⑤). `monitor_session.client_session_uuid` 주석(「클라이언트가 발급」)을 서버 발급까지로 고칠지(migration 필요) | DB/BE·FE·Spark | `api-spec.md` 11.3, FE ADR 0029 |
| ADR 0020 대체 시점 | DB/BE·DevOps | 계획 0031 |
| 적재된 세션의 기록 삭제 방식 (`RECORDS_ONLY` 유지 여부) | DB/BE·J3 | 「DB-V2.4-변경사항」 7장 (보류) |
| 삭제 완료 기록(`DONE`·`data_deleted_at`)을 DB에 남길지 | DB/BE·PM | 「DB-V2.4-변경사항」 7장 (보류), 공지 ⑦ |
| S1은 됐는데 WebSocket이 열리지 않은 세션을 누가 닫을지 (앱 S3 / 서버 시간 제한) | DB/BE·FE | FE 제안서 1장 질문(10/22). 안 닫으면 `ended_at` NULL 행이 남아 J1·J2·기록 목록에 영향 |
| 판정 시간 규칙 이름·단위 (BE-4) | DB/BE·FE | 2.6 |
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

| 2026-10-27 | 로그인 토큰(ADR 0031): JWT access + refresh, DB V2.6(`refresh_token`, migration 016), 쿠키 세션·CSRF·`LoginLifetime` 삭제, WS `hello.access_token`. 미결 「refresh 토큰」 → 구현됨. DevOps 요청 2건(초기화 스크립트·JWT 비밀값, 점검 도구) 추가 | 커밋 전 |
| 2026-10-27 | 알림 기본값 결정: 새 계정 켜짐(DB V2.6 `sound_alert_enabled` 기본값 참, 버전은 그대로 V2.6). 미결 「알림 기본값」 삭제 | 커밋 전 |
| 2026-10-27 | WebSocket 자세 등록 삭제(코드·계약·예시·시험, `phase: calibration` 포함). 미결 「WS 등록을 남길지」 → 삭제. api-spec 머리말 갱신(V2.6) | 커밋 전 |
| 2026-10-27 | FE 요청(서버 공개 연결) 반영: REST CORS 구현(fe-deploy S-1, 단위·MySQL 통합 시험). DB 초기화 스크립트 V2.5 → V2.6(불일치 1건 해결) | 커밋 전 |
| 2026-10-28 | 측정불가 자동 종료 5분 → 30분으로 바꾸고 기본으로 켬(앱이 `closed(unmeasurable_timeout)`을 10/27부터 처리). 미결 「측정불가 자동 종료를 켜는 시점」 삭제 | 커밋 전 |
| 2026-10-28 | 자정 넘김 B안 구현(BE-6 ①): 자정을 넘는 구간 또는 00:00:30에 이전 세션을 마지막 구간 끝에서 끝내 저장하고 같은 연결에서 서버가 만든 새 세션(같은 기준 자세·설정·알림, `started_at` = 자정)으로 넘김, `session_rollover`. 앱 시간·순번은 연결 기준 그대로 받아 서버가 바꿈. 실패하면 `closed(day_changed)`. 기본 꺼짐. 계약·예시·단위 시험. 실제 MySQL 시험(`INSERT … SELECT`)은 아직 | 커밋 전 |
| 2026-10-29 | `check-backend`(MySQL 통합 11개·smoke 포함) 통과 기록. api-spec의 요청·응답 예시를 합성 실행에서 받은 실제 값으로 바꿈(R1 `type`·소수 시간·`server.view` 객체, WS `hello.access_token` 등 예시와 달랐던 곳 바로잡음) | 커밋 전 |
| 2026-10-29 | 10/28 B1 프레임 배열·서버 평균(`748af6a`)을 되돌림: B1은 다시 앱이 낸 평균(`calibration_ms`·`sample_count`·`landmarks`)을 받는다. 422 `BASELINE_REJECTED` 삭제. alert_enabled 시험 수정(V2.6 기본값)은 유지. 철회 이유는 [계획 0060](plans/completed/0060-baseline-frames-over-rest.md) | 커밋 전 |

## 이메일 인증·비밀번호 재설정 후속 인계 (2026-10-26)

[연결 인계](design/email-account-handoff.md)는 프론트가 준비한 페이지/제안 요청과 BE·DB·SMTP 후속 작업을 구분한다. 서버 비밀번호는 기존 BCrypt12 해시 저장을 유지한다. 이번 작업에서 SMTP/이메일 인증 API/재설정 API/DB migration은 구현·적용하지 않았다. 실제 계정·메일 발송과 프론트 로컬 미리보기를 혼동하지 않는다.
