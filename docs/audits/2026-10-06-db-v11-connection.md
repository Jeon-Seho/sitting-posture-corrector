# 앱·DB 스키마 V1.1 연결 결과

- 분야: 백엔드
- 작업: GP-0068
- 확인일: 2026-10-06
- 브랜치: `jin_db_v11` (`lee_app1` + `feature/db-schema-v1.1`)
- 수행: 우진 요청, Lellon_CL
- 결정: [ADR 0018](../decisions/0018-db-schema-v11-service-storage.md), 진행 기록: [전환 계획 0021](../plans/active/0021-db-schema-v03-alignment.md)

API·프론트가 DB 담당의 스키마 V1.1(`database/`)만 사용하도록 연결했다. 아래는 연결에 성공한 범위,
실행한 검증과 결과, 아직 하지 못한 검증, 다음에 고치거나 정해야 할 항목이다.

## 1. 연결에 성공한 것

| 영역 | 연결 내용 | 확인 방법 |
| --- | --- | --- |
| 스키마 적용 | Compose `db`가 빈 볼륨에서 `schema_V1_1.sql`과 시드 4개를 그대로 적용한다. 테이블 24개, 정책 `DEFAULT_TEMP`, 모델 `REFERENCE-RULE-1`·`RULE-PROTO-1` | 일회용 Compose MySQL 8.4.11 |
| API 시작 검증 | Flyway를 빼고, API가 시작할 때 테이블·컬럼·시드를 확인한다. 없으면 시작하지 않는다 | 전체 스택 기동 |
| 계정 | 가입·로그인·로그아웃·비밀번호 변경(다른 로그인 철회)이 `user_account`, `SPRING_SESSION*`에 저장된다 | 실제 MySQL 시험, 전체 스택 |
| 탈퇴 | `deletion_request` 기록 → `CLOSED` → 이메일·해시·이름·나이·직업 NULL → 소유 행 삭제 → `DONE`. 같은 이메일로 다시 가입할 수 있다 | 실제 MySQL 시험 |
| 설정 | 판정 정책이 `threshold_policy` 행(같은 값 조합 재사용, `USER`)이 된다. 0.5초 단위가 아닌 값은 400. 알림 사용은 `sound_alert_enabled` | 실제 MySQL 시험 |
| 측정 시작 | 프론트가 장치·영상 크기·기준 요약(평균·표준편차·표본 수·보정 시간·화면 위치)을 보내고, `capture_device`·`baseline_posture`·`baseline_feature`·`monitor_session`이 만들어진다. 새 기준은 이전 활성 기준을 비활성화한다 | 실제 MySQL 시험, 프론트 시험 |
| 측정 입력 | 추론 결과·중복 재전송 판별(`input_result`)과 CEP 전달 대기(`cep_outbox`)를 먼저 저장하고 CEP 확인 뒤 확정한다 | 실제 MySQL 시험, 전체 스택 |
| 복구 | API·CEP 재시작 뒤 확정 입력을 재생해 같은 요약·사건을 복구한다 | 전체 스택(컨테이너 재생성) |
| 사건 | 붕괴→`collapse_event`+`correction_alert`, 재알림·회복·중단을 각 행으로 나눈다. 확정된 사건이 바뀌면 502로 거부하고 트랜잭션을 되돌린다 | 실제 MySQL 시험 |
| 종료 | `monitor_session.ended_at`·`end_reason`·`good_sec`, `excluded_interval`(일시정지·자리 비움·판정 불가·누락) | 실제 MySQL 시험, 전체 스택(`USER_STOP`, 3000ms, `SESSION_END`) |
| 기록 | 앱 기록 원문이 `client_record`에 저장되고 확인한 요약과 대조된다 | 실제 MySQL 시험 |

## 2. 실행한 검증

환경: Windows 11, JDK 21.0.12(Temurin), Maven 3.9.11, Node 24.18, Python 3.13, Docker 29.6.2.

| 검증 | 결과 |
| --- | --- |
| 백엔드 `mvn verify` | 59개 통과. `PersistentMySqlTest` 14개는 일회용 Compose MySQL에서 실제로 실행(합성 계정·입력, 끝나면 삭제) |
| 프론트 `npm run check` | 테스트 246개, 타입 검사, 빌드 통과 |
| 전체 스택(일회용 Compose, 이미지 빌드) | 프론트 2, 계정·특징 10, 재시작 후 복구·종료 14 확인 통과 |
| `tools/check_repository.py` | 통과 |
| Python `unittest`(152개) | 3개 오류. 배포 잠금이 POSIX 전용이라 Windows에서만 나며, 변경 전 코드에서도 같다 |

## 3. 하지 못한 검증

- `make check-compose` 전체(백업·복원 포함): Windows 문제(4장 1번)로 이 PC에서 실행하지 못했다.
  상태 확인 명령만 바꾼 임시 설정으로 위 검증을 했다. Linux/macOS CI 결과는 아직 없다.
- 계정 브라우저 smoke: 가입까지 통과한 뒤 실패한다. 기다리는 홈 문구 `님의 오늘`이 `lee_app1` 화면 재구성(`36a0108`)에서
  이미 사라졌다(기존 문제, 4장 2번). 새 계정 기본 설정 기대값은 `DEFAULT_TEMP`로 고쳤다.
- 실제 카메라로 보정해 서버에 저장되는 값은 확인하지 않았다. 합성 카메라와 합성 수치만 사용했다.

## 4. 다음에 고치거나 필요한 것

### 바로 고칠 것

1. **Windows에서 `check-compose`**: Windows bind mount에서 비밀 파일이 world-writable로 보여 MySQL이
   `mysql-app.cnf`·`mysql-backup.cnf`를 무시한다. 상태 확인·백업·복원이 이 파일을 쓴다. 다른 방식(예: 비밀번호 파일에서
   `MYSQL_PWD` 설정)이나 Linux 전용 실행 안내가 필요하다.
2. **계정 브라우저 smoke 갱신**: `tools/browser/accounts.mjs`의 화면 문구 대기를 새 데스크톱 화면에 맞춘다.
3. **Windows 한글 출력**: `tools/account_browser_smoke.py`가 로그를 cp949로 읽어 실패한다. `PYTHONUTF8=1` 없이도 되도록
   파일 인코딩을 UTF-8로 지정한다.
4. **CI 확인**: PR에서 `harness`의 `check-compose`가 V1.1 기준으로 통과하는지 본다.

### 팀 결정이 필요한 것

| 항목 | 현재 처리 | 결정할 사람 |
| --- | --- | --- |
| 기본 판정 정책 | 시드 `DEFAULT_TEMP`(0.5·3초·2초·30초·12회)를 임시로 쓴다. 앱의 이전 기본값은 0.7·60초였다 | 모델·PM. 확정되면 `DEFAULT` 행을 넣고 `posegood.default-policy-name`만 바꾼다 |
| 보존 기간 | 탈퇴는 보관 0일로 바로 지운다 | PM·DB |
| 동의 저장 | `user_consent`(T-41) 보류로 가입 동의를 저장하지 않는다 | PM·DB |
| 붕괴 유형 | T-36 보류로 좌우 방향(`deviation_type`)을 사건 테이블에 저장하지 않는다. 기록 원문에만 남는다 | 모델·DB |
| 확인되지 않은 종료 | V1.1에 저장 칸이 없어 앱이 같은 `end_ms`로 다시 보낸다 | DB(칸 추가 여부) |
| 화면 위치 정의 | 어깨 중점과 코·어깨 상자 면적(0..1)을 `target_center_*`·`target_area_ratio`로 저장한다 | DB·모델(명세서 정의와 맞는지) |
| 명세서 반영 | DB 명세서(DB-01~04)는 아직 V0.3 표기다(CR-03) | DB |

### 이후 작업

- `daily_stat` 집계 배치(API는 채우지 않는다), `feature_archive`가 있는 세션의 탈퇴 배치.
- 인덱스(DB-05): 세션 조회·복구 조회에 맞춘 보조 인덱스.
- 운영 배포: 운영 서버가 정해지면 빈 볼륨으로 시작한다. 이전 V1 테이블 DB가 있다면 API가 시작을 거부하므로 이관 계획이 필요하다.
- 프론트 기록 화면을 `monitor_session`·사건 테이블에서 다시 만들 수 있으면 `client_record`(임시 테이블)를 없앤다.
- Kafka 실시간 경로([계획 0022](../plans/active/0022-kafka-realtime-pipeline.md))의 기준 자세 토픽은 이번 `baseline_posture` 저장을 기준으로 정한다.
