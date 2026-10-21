# 백엔드 개발 상태

> 기준: 2026-10-21 · 브랜치 `fix/db-backend-v5-2-sync` · 커밋 `b4122e9` · DB 스키마 V2.4 (작업본, 커밋 전)
> 갱신 규칙: backend/AGENTS.md. 할 일은 계획, 결정 이유는 ADR을 본다.
> 코드 경로: `backend/api/src/main/java/org/posegood/api/` 기준(시험은 `src/test/...`).

## 1. 요약

- 지금 앱이 쓰는 판정 경로: API 안 판정([ADR 0020](decisions/0020-single-api-decision-engine.md)) — `/v2/realtime` → `FrameFeatures` → FastAPI `/v2/infer` → `engine/SessionEngine` → MySQL. Kafka 경로 전환은 [계획 0031](plans/active/0031-realtime-kafka-transition.md)을 따른다.
- 큰 한계:
  - 진행 중 세션 상태가 API 메모리에만 있어 한 인스턴스로만 돌린다. 재시작하면 `404 SESSION_LOST`.
  - 실제 MySQL 통합 시험(`-Pmysql-integration`) 통과 기록이 없다.

## 2. 영역별 현황

### 2.1 계정·동의

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 가입·로그인·로그아웃·CSRF·`/v2/auth/me` | DB/BE | 구현됨 | `account/AuthController.java` |
| 비밀번호 변경 (현재 로그인 포함 `SPRING_SESSION` 행 모두 삭제, 실시간 연결 닫기) | DB/BE | 구현됨 | `AuthController.java` `PUT /v2/auth/password`, `AccountRepository.removeLogins` |
| 탈퇴 접수 (철회 없음, CLOSED 로그인은 `403 ACCOUNT_CLOSED`) | DB/BE | 구현됨 | `AuthController.java` `DELETE /v2/auth/account`, [계획 0026](plans/active/0026-backend-v2-rebuild.md) 10/15 기록 |
| 가입 동의 저장 (필수 5종 + 선택) | DB/BE | 구현됨 | `account/ConsentRepository.java`, [ADR 0022](decisions/0022-db-v23-feature-v2-integration.md) |
| 선택 정보 동의 철회 (나이·직업 비움) | DB/BE | 구현됨 | `workspace/WorkspaceController.java` `PUT /v2/consents/optional-profile` |
| 매시간 탈퇴 삭제 스케줄러 제거 | DB/BE | 구현됨 | 계획 0026 10/15 기록 (`purgeWithdrawn` 삭제) |

### 2.2 설정·기록

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 설정 조회·저장 `/v2/workspace` | DB/BE | 구현됨 | `workspace/WorkspaceController.java` |
| 기록 목록·저장·삭제 `/v2/records` (세션 테이블에서 다시 만듦) | DB/BE | 구현됨 | `workspace/RecordRebuild.java`, `RecordRebuildTest.java` |
| `daily_stat` 쓰기 중단 (읽기만) | DB/BE | 구현됨 | `session/SessionRepository.java` 66줄 주석, 계획 0026 10/15 기록 |
| 알림 설정 `alerts_on` → `sound_alert_enabled` → 세션 `alert_enabled` | DB/BE | 구현됨 | ADR 0022, `backend/README.md` |

### 2.3 기준 자세

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| `POST /v2/baselines`, `GET /v2/baselines/current` (이력 행 추가) | DB/BE | 구현됨 | `session/BaselineController.java`, ADR 0022 |
| WebSocket 등록 (`purpose: calibration` → `calibration_result`) | DB/BE | 구현됨 | `realtime/RealtimeHandlerV2.java` |

### 2.4 측정·실시간 판정 (API 안)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 세션 REST (`PUT`·`/end`·`GET`·`/metadata`·`DELETE`) | DB/BE | 구현됨 | `session/SessionController.java` |
| 판정 엔진 (붕괴·회복·재알림) | DB/BE | 구현됨 (Kafka 전환 뒤 삭제 예정) | `engine/`, `SessionEngineTest.java`, ADR 0020 |
| `/v1/realtime` WebSocket | DB/BE | 구현됨 (FE가 v2로 옮기면 삭제) | `realtime/RealtimeHandler.java`, 계획 0031 10/17 기록 |
| `/v2/realtime` WebSocket (좌표 → `FrameFeatures`) | DB/BE | 구현됨 | `realtime/RealtimeHandlerV2.java`, `RealtimeHandlerV2Test.java`, [ADR 0024](decisions/0024-session-ends-on-lost-connection.md) |
| HTTP 특징 입력 S2 `POST /v2/sessions/{id}/features` | DB/BE | 구현됨 (v1 정리 때 삭제) | `SessionController.java`, 계획 0031 10/17 기록 |
| 시작 시 스키마 확인 (V2.4, 13테이블, V2.4에서 지운 `feature_archive.row_count`가 남으면 거부) | DB/BE | 구현됨 (MySQL로는 미확인) | `system/SchemaVerifier.java`, `database/README.md` 11장 |

### 2.5 Kafka 전환 (계획 0031)

| 일 | 담당 | 상태 | 근거 |
|---|---|---|---|
| 1단계 `ws` Kafka 연결 (`posegood.realtime.pipeline`) | PM | 구현 전 | 0031 기준, 10/21 확인 — `backend/api`에 설정 없음 |
| 2단계 API 결과 쓰기 중단·REST 정리 | DB/BE | 구현 전 | 0031 2단계 |
| 4단계 API 안 판정 삭제, ADR 0020 대체 | 전원 | 구현 전 | 0031 4단계 |

### 2.6 검증

| 검사 | 마지막 결과 | 날짜 | 비고 |
|---|---|---|---|
| `backend/gradlew -p backend :api:test` (단위) | 66개 중 57 통과, 실패 0, 건너뜀 9 (`MySqlIntegrationTest`) | 2026-10-21 | V2.4 `SchemaVerifier` 변경 후. 로컬 JDK 17 |
| `-Pmysql-integration` (실제 MySQL) | 확인 필요 | 2026-10-15 | 접속 거부로 미실행 (0026). [계획 0028](plans/active/0028-backend-java17-boot4-gradle.md)에도 미체크. V2.4 스키마로도 아직 실행 전 |
| `database/tests/integrity_check.py` | 확인 필요 | — | V2.4에 맞춰 고쳤고 아직 실행 전 (V2.3 기준 130개 통과, 2026-10-13) |
| `tools/service_smoke.py` | 확인 필요 | — | 아직 `daily_stat` 1행을 기대함 (3장) |
| `make check-compose` | 확인 필요 | 2026-10-14 | 실패 원인 분석만 있음 ([계획 0030](plans/active/0030-make-check-failures.md)) |

## 3. 문서·코드 불일치

| 위치 | 어긋난 내용 | 고칠 곳 | 상태 |
|---|---|---|---|
| `contracts/accounts.v2.md` 26줄 | 탈퇴 철회 `POST /auth/withdrawal/cancel`, `WITHDRAWAL_NOT_CANCELLABLE`가 남음 | 행 삭제 | 구현 전 |
| `docs/design/api-ws-spec.md` 48·187·204줄 | 같은 철회 경로(A8)와 409 코드, A1 설명의 "탈퇴 철회(A8) 뒤" | FE 명세에서 삭제 (FE 담당) | 구현 전 |
| `backend/api/.../account/AuthController.java` 23줄 | 클래스 주석에 "철회" | 주석에서 삭제 | 구현 전 |
| `backend/README.md` 「다음 결정」 2번 | 지운 계획 0022 링크 | [계획 0031](plans/active/0031-realtime-kafka-transition.md)로 | 구현 전 |
| `tools/service_smoke.py` 177~179줄 | `daily_stat` 1행을 기대 — API는 이제 쓰지 않음 | 기대값 삭제 (tools 담당) | 구현 전 |
| 계획 0026 52줄 「DB 쓰기」 | `baseline_posture` 사용자당 1행 덮어쓰기, `calibration_uuid` 복사 (V2.1 기준) — 지금은 매번 새 행, `baseline_posture_id` FK(V2.2~) | 계획 표 갱신 | 구현 전 |

## 4. 미결 결정

| 질문 | 담당 | 관련 문서 |
|---|---|---|
| API 다중 인스턴스 (진행 상태 공유·세션 고정) | DB/BE·DevOps | `backend/README.md` 「다음 결정」 1, D-42 |
| 오늘 통계를 화면에 바로 보여 줄지 | FE·BE | 「아키텍처 v5.2 전환 영향」 공지 ④, [FE 제안](design/fe-server-proposal.md) |
| 최대 측정 시간 (지금 5000초) | 팀 회의 | 계획 0031 10/17 기록, `application.properties` 44줄 |
| ADR 0020 대체 시점 | DB/BE·DevOps | 계획 0031 |
| 알림 기본값 (ADR 0022는 false, FE 화면은 켜짐) | DB·FE | ADR 0022 |
| 적재된 세션의 기록 삭제 방식 (`RECORDS_ONLY` 유지 여부) | DB/BE·J3 | 「DB-V2.4-변경사항」 7장 (보류) |
| 삭제 완료 기록(`DONE`·`data_deleted_at`)을 DB에 남길지 | DB/BE·PM | 「DB-V2.4-변경사항」 7장 (보류), 공지 ⑦ |

## 5. 갱신 기록

| 날짜 | 내용 | 커밋 |
|---|---|---|
| 2026-10-21 | 처음 작성 | `b4122e9` 기준 |
| 2026-10-21 | DevOps·Spark 담당 항목 제거 (처리 서비스, 옛 CEP 경로, J1~J3, 서버 PC 검증 기록) | `3f2bbf8` 이후 |
| 2026-10-21 | `database/README.md` 9장 비밀번호 변경·11장 링크를 고쳐 불일치 2건 제거 | `3f2bbf8` 이후 |
| 2026-10-21 | DB V2.4 작업본 반영: `SchemaVerifier` V2.4 확인, 무결성 검사·README 철회 문구 정리(불일치 2건 제거), `row_count` 미결 → 확정(삭제), 보류 결정 2건 추가 | 커밋 전 |
