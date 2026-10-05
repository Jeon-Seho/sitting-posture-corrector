# 서비스 DB를 스키마 V0.3 기준으로 전환

- 분야: 백엔드
- 작업: GP-0068
- 상태: blocked (DB 건의안 GP-0067 검토 대기)
- 담당: 동욱 요청, klaod-tech_CL 분석
- 시작일: 2026-10-05
- 관련 요구사항/ADR: [database 안내](../../../database/README.md), [ADR 0013](../../decisions/0013-frontend-server-feature-connection.md),
  [ADR 0014](../../decisions/0014-mysql-persistence-and-accounts.md), [계정 계약](../../../contracts/accounts.v1.md)

## 문제와 완료 기준

`jin_app`과 `develop`을 합치면서 서비스 DB 설계가 두 벌이 되었다.

- `develop`(PR #8): 명세서에서 생성한 [스키마 V0.3](../../../database/schema/schema_V0_3.sql), 테이블 17개, 시드 4개.
- `jin_app`(jisung): API가 Flyway로 적용하는 [V1 마이그레이션](../../../database/migrations/V1__accounts_and_durable_sessions.sql), 테이블 11개.

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

- 2026-10-05: `jin_app` + `develop` 병합. 충돌은 `database/README.md` 하나였고 develop 문서를 기준으로 전환 절을 덧붙였다.
  코드는 아직 V1을 사용한다.

팀 결정이 필요한 질문(추측으로 확정하지 않는다):

1. **운영 테이블**: `input_results`·`cep_outbox`·`confirmed_snapshots`·`cep_cleanup`·`SPRING_SESSION*`을 V0.3 위
   추가 마이그레이션으로 승인할지, 명세서에 반영할지. 없으면 중복 재전송·CEP 복구·로그인 유지가 동작하지 않는다.
2. **기준 특징 저장**: V0.3은 `baseline_feature`에 기준 평균값을 저장한다. ADR 0013은 기준 특징 원값을 서버로 보내지 않는다.
   어느 쪽을 따를지.
3. **프로필**: V0.3은 표시 이름만 둔다. 현재 앱과 계정 계약은 나이·직업을 받는다. 화면에서 뺄지, 명세서에 추가할지.
4. **기본 정책 값**: 시드 `DEFAULT_TEMP`는 임계 0.5·재알림 30초, ADR 0012와 앱 기본값은 0.7·60초.
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
| 4 기본 정책 값 | 시드 `DEFAULT_TEMP`(0.5·3초·2초·30초·12회)를 임시로 그대로 쓴다. 확정 시 `DEFAULT` 행으로 교체 |
| 5 기록 원문 | `client_record`로 보관(건의안 8번) |
| 6 적용 방식 | 미정. 건의안 검토 때 함께 결정 |
| 7 탈퇴 | V0.3의 `deletion_request` 절차를 따른다. 보관 기간은 미정 |
| 동의 | 기존 `service-v1` 보관 동의와 학습용 선택 동의를 T-41 `user_consent`로 이관(건의안 7번). 학습 활용 범위는 미정 |

## 작업 단계

- [x] `jin_app` + `develop` 병합, 스키마 대응표 작성
- [x] 사용자 방향 결정, DB 건의안 0001 작성(GP-0067)
- [ ] DB 담당 건의안 검토·승인, 남은 질문 6
- [ ] ADR 0013 개정(기준 특징 서버 저장)
- [ ] 결정에 따른 추가 마이그레이션 파일과 Flyway 구성
- [ ] `backend/api` 저장소 계층을 V0.3으로 교체, 시험 갱신
- [ ] 계약·프론트 계정 화면 동기화
- [ ] `make check-compose`, `make check-backend`, `make check`

## 검증 결과와 남은 한계

- 병합 직후 상태만 확인했다. 백엔드 코드 변경 전이므로 V0.3 위의 동작은 검증하지 않았다.
- 이 PC에는 Maven이 없고 JDK가 25이며 Docker 데몬이 꺼져 있어 `check-backend`·`check-compose`를 실행하지 못했다.
