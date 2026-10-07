# 서비스 DB를 스키마 V0.3(현 V1.1) 기준으로 전환

- 분야: 백엔드
- 작업: GP-0068
- 상태: in_progress (구현·실제 MySQL 검증 완료, develop 병합 PR #11·#13 2026-10-06. 남은 것: `make check-compose` 전체)
- 담당: 동욱 요청, klaod-tech_CL 분석, 우진 요청·Lellon_CL 구현(2026-10-06, 브랜치 `jin_db_v11`)
- 시작일: 2026-10-05
- 관련 요구사항/ADR: [database 안내](../../../database/README.md), [ADR 0013](../../decisions/0013-frontend-server-feature-connection.md),
  [ADR 0014](../../decisions/0014-mysql-persistence-and-accounts.md), [계정 계약](../../../contracts/accounts.v1.md)

## 문제와 완료 기준

`jin_app`과 `develop`을 합치면서 서비스 DB 설계가 두 벌이 되었다.

- `develop`(PR #8): 명세서에서 생성한 [스키마 V0.3](../../../database/schema/schema_V1_0.sql) (V0.3과 같은 내용, 2026-10-05 V1.0으로 확정), 테이블 17개, 시드 4개.
- `jin_app`(jisung): API가 Flyway로 적용하는 V1 마이그레이션(`V1__accounts_and_durable_sessions.sql`, 2026-10-06 삭제), 테이블 11개.

사용자 결정(2026-10-05)으로 V0.3을 기준으로 한다. 완료 기준은 다음과 같다.

1. API 영구 모드가 V0.3 테이블(+ 승인된 추가 마이그레이션)만 사용하고 V1 테이블을 만들지 않는다.
2. 기존 계정·측정·중복 재전송·삭제 시험이 V0.3 위에서 실제 MySQL로 통과한다(`make check-compose`).
3. V0.3에 없는 운영 테이블은 DB 담당자 승인을 받은 마이그레이션으로만 추가한다.

## 범위와 제외

변경 대상: `backend/api`의 계정·작업공간·세션 저장(`UserStore`, `JdbcWorkspaceStore`, `JdbcSessionStore`,
`PersistentSessionService`, `PersistentRecoveryWorker`, `AuthController`, 관련 시험), Flyway 구성, `contracts/accounts.v1.md`,
필요 시 프론트 계정 화면. 제외: CEP 판정 규칙, 추론 점수, HDFS 적재(`feature_archive`), 배포 기록(`deployment`).

## 테이블 대응

| V1 (현재 코드) | V0.3 | 차이 |
| --- | --- | --- |
| `users` (UUID, email, password_hash, auth_epoch, profile JSON, 동의 버전) | `user_account` (BIGINT, login_email, password_hash, display_name, account_status) | ID 형식, 나이·직업 없음, 동의 없음(T-41 보류), `auth_epoch` 없음 |
| `workspaces.rules` JSON | `user_account.threshold_policy_id` → `threshold_policy` | 정책은 불변 행·이름/값 조합 유일, `notify_max_per_hour` 추가, 0.5초 단위 |
| `workspaces.preferences` JSON | `user_account.sound_alert_enabled`만 | 그 외 화면 선호 저장 위치 없음 |
| `measurement_sessions` (UUID PK, policy/snapshot JSON, baseline_id, model_version) | `monitor_session` (BIGINT PK, `client_session_uuid`, 장치·기준 자세·정책·모델 FK, 해상도, `good_sec`) | 장치·기준 자세 행이 먼저 있어야 세션 생성 가능 |
| (없음, 기준은 브라우저에만) | `capture_device`, `baseline_posture`, `baseline_feature` | 기준 특징 평균·위치를 서버에 저장 |
| `session_events` (CEP 사건 JSON) | `collapse_event`, `correction_alert`, `excluded_interval` | 세션 상대 ms → UTC 절대시각, 사건 종류 분해 |
| `records` (프론트 기록 JSON) | `monitor_session` 요약 + `daily_stat` | 기록 원문 보관 위치 없음 |
| `input_results`, `cep_outbox`, `confirmed_snapshots`, `cep_cleanup` | 없음 | 중복 재전송·CEP 복구용 운영 상태 |
| `SPRING_SESSION*` | 없음 | 서버 로그인 세션 저장 |
| 즉시 cascade 삭제 | `deletion_request` + `account_status=CLOSED` + 배치 | 탈퇴 절차가 다름 |

## 결정과 진행 기록

- 2026-10-06: DB 담당(sunshine-yj)이 건의안 0001을 V1.1(`feature/db-schema-v1.1`)로 반영했다. 7번 `user_consent`만 보류.
  `lee_app1` + V1.1을 `jin_db_v11`로 합치고 API·프론트를 V1.1에 연결했다. 결정은 [ADR 0018](../../decisions/0018-db-schema-v11-service-storage.md).
  - 남은 질문 6(적용 방식): API는 Flyway를 쓰지 않고 시작할 때 검증만 한다. Compose는 빈 볼륨에서 `database/` 파일을 그대로 적용한다.
  - 사용자 결정: "전체 연결, V1.1에 맞게 적용"(V1.1 추가 컬럼을 요청하지 않고 코드를 맞춤), 탈퇴는 V1.1 절차(보관 0일).
  - 세션 생성에 `setup`(장치·영상 크기·기준 요약)을 추가했다. 프론트는 보정 때 표본 수·시간·표준편차·화면 위치를 함께 계산한다.

- 2026-10-05: `jin_app` + `develop` 병합. 충돌은 `database/README.md` 하나였고 develop 문서를 기준으로 전환 절을 덧붙였다.
  코드는 아직 V1을 사용한다.

팀 결정이 필요한 질문(추측으로 확정하지 않는다):

1. **운영 테이블**: `input_results`·`cep_outbox`·`confirmed_snapshots`·`cep_cleanup`·`SPRING_SESSION*`을 V0.3 위
   추가 마이그레이션으로 승인할지, 명세서에 반영할지. 없으면 중복 재전송·CEP 복구·로그인 유지가 동작하지 않는다.
2. **기준 특징 저장**: V0.3은 `baseline_feature`에 기준 평균값을 저장한다. ADR 0013은 기준 특징 원값을 서버로 보내지 않는다.
   어느 쪽을 따를지.
3. **프로필**: V0.3은 표시 이름만 둔다. 현재 앱과 계정 계약은 나이·직업을 받는다. 화면에서 뺄지, 명세서에 추가할지.
4. **기본 정책 값**: 시드 `DEFAULT_TEMP`는 임계 0.5·재알림 30초, ADR 0012와 앱 기본값은 0.7·60초. (2026-10-07: 시드가 0.5·3초·3초·60초로 바뀌어 임계값 0.5 vs 0.7만 남음)
5. **기록 원문**: 프론트 `RecordItem` 원문을 서버에 계속 보관할지, `monitor_session`·사건 테이블에서 다시 만들지.
6. **스키마 적용 방식**: V0.3은 `CREATE DATABASE`·`USE`를 포함한 수동 적용 파일이고 이름 규칙이 Flyway(`V<n>__`)와 다르다.
   API가 Flyway로 적용할지, 운영자가 수동 적용하고 API는 검증만 할지.
7. **탈퇴**: 즉시 cascade 삭제를 `deletion_request` 배치 절차로 바꿀지와 보관 기간.

2026-10-05 사용자 결정(구조는 V0.3, 빠진 부분은 기존 구현으로 채움):

| 질문 | 결정 |
| --- | --- |
| 1 운영 테이블 | V1의 운영 테이블을 V0.3 이름 규칙으로 옮겨 [DB 건의안 0001](../../../database/proposals/0001-v03-supplement.md) 1~6·8번으로 제안 |
| 2 기준 특징 저장 | V0.3을 따른다(`baseline_feature` 저장). ADR 0013 개정이 필요하다 |
| 3 프로필 | 나이·직업을 유지한다. 건의안 11번으로 V0.3에 추가를 요청 |
| 4 기본 정책 값 | 시드 `DEFAULT_TEMP`(당시 0.5·3초·2초·30초·12회)를 임시로 그대로 쓴다. 확정 시 `DEFAULT` 행으로 교체. 2026-10-07 현재 시드는 0.5·3초·3초·60초·12회(develop #16) |
| 5 기록 원문 | `client_record`로 보관(건의안 8번) |
| 6 적용 방식 | 미정. 건의안 검토 때 함께 결정 |
| 7 탈퇴 | V0.3의 `deletion_request` 절차를 따른다. 보관 기간은 미정 |
| 동의 | 기존 `service-v1` 보관 동의와 학습용 선택 동의를 T-41 `user_consent`로 이관(건의안 7번). 학습 활용 범위는 미정 |

## 작업 단계

- [x] `jin_app` + `develop` 병합, 스키마 대응표 작성
- [x] 사용자 방향 결정, DB 건의안 0001 작성(GP-0067)
- [x] DB 담당 건의안 검토·승인(V1.1), 남은 질문 6 → ADR 0018
- [x] ADR 0013 개정(영구 모드 세션 생성의 기준 요약) → ADR 0018
- [x] Flyway 제거, Compose `infra/mysql/initdb`, API 시작 시 스키마 검증, DB 이름 `posture_service`
- [x] `backend/api` 저장소 계층을 V1.1로 교체, 시험 갱신(실제 MySQL 14개 포함)
- [x] 계약·프론트 계정 화면 동기화(`contracts/accounts.v1.md`, 사용자 ID·이름 30자·데모 표시 기기 저장·세션 `setup`)
- [ ] `make check-compose` 전체(백업·복원 포함) — Windows 비밀 파일 권한 문제로 이 PC에서 미실행(아래)
- [x] 팀 리뷰 후 develop 병합(PR #11·#13, 2026-10-06)

## 저장 대응 (구현)

| 기능 | V1.1 위치 |
| --- | --- |
| 계정·프로필·로그인 철회 | `user_account`(`display_name`·`age`·`occupation`·`auth_epoch`), `SPRING_SESSION*` |
| 설정 | `user_account.threshold_policy_id` → `threshold_policy`(값 조합 행, `USER`), `sound_alert_enabled` = `alerts_on` |
| 세션 생성 | `capture_device`(키·이름), `baseline_posture`+`baseline_feature`(기준 요약), `monitor_session`(`REFERENCE-RULE-1`, 해상도, `alert_enabled`) |
| 입력·전달·복구 | `input_result`(`FEATURE`/`OBSERVATION`, `PENDING`/`CONFIRMED`/`REJECTED`), `cep_outbox`, `cep_cleanup` |
| 조회 요약 | `confirmed_snapshot`: 세션별 최신 1행은 전체 요약, 이전은 증명 |
| 사건 | `collapse_event`, `correction_alert`; 종료 때 `excluded_interval`(PAUSE/ABSENCE/UNMEASURABLE/MISSING), `monitor_session.ended_at`·`good_sec` |
| 기록 원문 | `client_record` |
| 탈퇴 | `deletion_request`(`ACCOUNT_ALL`) → `CLOSED`·식별 컬럼 NULL → 소유 행 삭제 → `DONE` |

## 검증 결과와 남은 한계

결과 정리와 다음 할 일: [2026-10-06 연결 결과](../../audits/2026-10-06-db-v11-connection.md).

2026-10-06, Windows 11, JDK 21.0.12(Temurin), Maven 3.9.11, Docker 29.6.2, MySQL 8.4.11(Compose 이미지).

- `mvn verify`(backend): 59개 통과. `PersistentMySqlTest` 14개는 일회용 Compose MySQL(빈 볼륨 → V1.1 init, 테이블 24개)에서
  실제로 실행해 통과했다(합성 계정·입력만, 시험 후 프로젝트·볼륨 삭제).
- 프론트 `tsc -b`, `vitest` 246개 통과.
- 전체 스택(일회용 Compose: MySQL·API·CEP·추론·프론트, 실제 이미지 빌드): 프론트 2, 계정·특징 10, API·CEP 재시작 후 복구·종료 14 확인 통과.
  종료 세션 행 `USER_STOP`·`good_sec 0.0`·3000ms, `collapse_event` 1건 `SESSION_END`.
- 계정 브라우저 smoke는 가입까지 통과 후 홈 문구 `님의 오늘` 대기에서 실패했다. 이 문구는 `lee_app1`의 화면 재구성(`36a0108`)에서
  이미 사라졌고 smoke가 갱신되지 않은 기존 문제다. 기본 설정 기대값만 `DEFAULT_TEMP`로 고쳤다.
- `make check-compose`는 이 PC에서 실행하지 못했다. Windows bind mount의 비밀 파일이 world-writable로 보여 MySQL이
  `mysql-app.cnf`를 무시하고 healthcheck가 실패한다(이번 변경 전부터 같은 설정). 검증은 healthcheck만 바꾼 임시 override로 했다.
  Linux/macOS CI의 `check-compose` 결과는 아직 없다.
- 한계: 확인되지 않은 종료는 저장하지 않는다(클라이언트가 같은 `end_ms`로 재시도). 사건 좌우 방향은 T-36 보류로 미저장.
  `daily_stat`은 배치 범위. 동의 미저장(T-41 보류). 이전 V1 테이블의 자료 이관 없음(운영 배포 이력 없음, [infra 안내](../../../infra/README.md)).
