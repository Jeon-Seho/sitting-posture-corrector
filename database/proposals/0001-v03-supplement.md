# DB 건의안 0001: 스키마 V0.3 보완 마이그레이션

- 상태: 제안 (DB 담당 검토 대기)
- 제안: 동욱 (klaod-tech), 2026-10-05
- 대상: [schema_V0_3.sql](../schema/schema_V1_0.sql) (V0.3과 같은 내용, 2026-10-05 V1.0으로 확정), 이후 `migrations/`
- 관련: [전환 계획 0021](../../docs/plans/active/0021-db-schema-v03-alignment.md), V1 마이그레이션(대체 대상)(`V1__accounts_and_durable_sessions.sql`, 2026-10-06 삭제)

## 왜 필요한가

서비스 DB의 기준은 V0.3으로 정했다. 그런데 이미 동작하는 API·CEP 서버(jisung, `backend/`)는
V0.3에 없는 테이블로 **중복 재전송 처리·CEP 재시작 복구·로그인 유지·동의 기록**을 하고 있다.
V0.3으로 옮기면서 이 기능을 잃지 않도록, 빠진 부분을 기존 구현(V1)에서 가져와 마이그레이션으로 추가하자는 제안이다.
V0.3의 테이블·제약은 바꾸지 않고 **추가만** 한다(작업규칙 4.7: 한 파일 한 목적, 적용된 파일 수정 금지).

## 추가 제안 목록 (이름 - 하는 일)

| 번호 | 마이그레이션 파일 | 이름 | 하는 일 |
| --- | --- | --- | --- |
| 1 | `001_create_input_result.sql` | `input_result` | 측정 중 들어온 관측 입력을 순번별로 기록한다. 같은 요청이 다시 오면 저장된 결과를 돌려줘 **중복 집계를 막는다** |
| 2 | `002_create_cep_outbox.sql` | `cep_outbox` | CEP(시간 판정 서버)에 아직 전달되지 않은 입력을 표시한다. CEP가 재시작되면 **여기서 다시 보낸다** |
| 3 | `003_create_confirmed_snapshot.sql` | `confirmed_snapshot` | 사용자에게 확인 응답을 보낸 시점의 세션 요약을 저장한다. 응답이 유실돼도 **어디까지 확정됐는지** 증명한다 |
| 4 | `004_create_cep_cleanup.sql` | `cep_cleanup` | 세션·계정을 지운 뒤 CEP 쪽 정리가 끝날 때까지 **재시도 목록**으로 남긴다 |
| 5 | `005_create_login_session.sql` | `SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES` | 로그인 상태와 CSRF 토큰을 서버에 저장한다. 만료되면 자동으로 로그아웃된다(Spring Session 표준 이름 유지) |
| 6 | `006_add_auth_epoch_user_account.sql` | `user_account.auth_epoch` | 비밀번호 변경·탈퇴 때 값을 올려 **다른 기기의 기존 로그인을 끊는다** |
| 7 | `007_create_user_consent.sql` | `user_consent` (보류된 T-41) | 동의 종류별로 동의·철회 시각을 기록한다. 아래 '동의' 절 참고 |
| 8 | `008_create_client_record.sql` | `client_record` | 앱이 측정 종료 때 만든 기록 원문(JSON)을 계정별로 보관한다. 기록 상세 화면이 그대로 동작하게 한다 |
| 9 | `009_alter_excluded_interval_reason.sql` | `excluded_interval.exclusion_reason`에 `MISSING` 추가 | 입력이 끊긴 구간(누락)을 일시정지·자리 비움·판정 불가와 **구분해서** 제외한다 |
| 10 | `010_insert_model_version_reference.sql` | `model_version` 행 `REFERENCE-RULE-1` | 서버가 실제로 쓰는 규칙(`reference-feature-rule-v1`, 세 특징 변화량)을 모델 버전으로 등록한다 |
| 11 | `011_add_profile_user_account.sql` | `user_account.age`, `user_account.occupation` | 가입 때 받는 나이·직업을 계정에 저장한다. 사용자 정보 확인과 기록 해석에 쓴다 |

인덱스는 V0.3 원칙대로 DB-05 쿼리 목록을 만든 뒤 별도 파일로 둔다. 위 파일에는 PK·UK·FK만 둔다.

## 테이블 초안

모든 시각은 UTC `DATETIME(3)`, 문자셋은 V0.3과 같다. 컬럼 이름은 V1 구현에서 가져와 V0.3 규칙에 맞췄다.

### 1. input_result

| 컬럼 | 형식 | 설명 |
| --- | --- | --- |
| `monitor_session_id` | BIGINT, PK·FK → `monitor_session` (CASCADE) | 소속 세션 |
| `input_seq` | BIGINT, PK | 세션 내 입력 순번 |
| `input_kind` | VARCHAR(16) | 관측 / 종료 등 입력 종류 |
| `request_fingerprint` | CHAR(64) ascii | 요청 내용의 SHA-256. 같은 순번에 다른 내용이 오면 거부 |
| `observation` | JSON | 추론 결과(점수·유효 여부). 영상·랜드마크·원본 변화량은 넣지 않음 |
| `process_status` | VARCHAR(16) | PENDING / CONFIRMED / REJECTED |
| `rejection_status` | INT, 기본 0 | 거부 시 HTTP 상태 코드 |

### 2. cep_outbox

| 컬럼 | 형식 | 설명 |
| --- | --- | --- |
| `monitor_session_id`, `input_seq` | PK·FK → `input_result` (CASCADE) | 전달할 입력 |
| `completed` | BOOLEAN, 기본 FALSE | CEP가 받았는지 |

### 3. confirmed_snapshot

| 컬럼 | 형식 | 설명 |
| --- | --- | --- |
| `monitor_session_id` | BIGINT, PK·FK → `monitor_session` (CASCADE) | 소속 세션 |
| `snapshot_fingerprint` | CHAR(64) ascii, PK | 요약의 SHA-256 |
| `payload` | JSON | 확인된 세션 요약(통계·사건 수). 원 관측은 넣지 않음 |

### 4. cep_cleanup

| 컬럼 | 형식 | 설명 |
| --- | --- | --- |
| `client_session_uuid` | VARCHAR(36), PK | 지워진 세션의 클라이언트 식별자. 세션 행이 지워진 뒤에도 남아야 하므로 FK 없음 |
| `created_at` | DATETIME(3) | 정리 요청 시각 |
| `attempted_at` | DATETIME(3) NULL | 마지막 재시도 시각 |

### 5. SPRING_SESSION, SPRING_SESSION_ATTRIBUTES

Spring Session JDBC의 MySQL 표준 정의를 그대로 쓴다(라이브러리가 이 이름을 찾는다). 현재 정의는 V1 마이그레이션 마지막 부분과 같다.
로그인 유지 수단을 Redis 등으로 바꾸기로 하면 이 항목은 빠진다.

### 6. user_account.auth_epoch

`BIGINT NOT NULL DEFAULT 0`. 로그인 세션에 발급 당시 값을 넣어 두고, 값이 달라진 세션은 거부한다.

### 7. user_consent

| 컬럼 | 형식 | 설명 |
| --- | --- | --- |
| `user_account_id` | BIGINT, PK·FK → `user_account` (CASCADE) | 동의한 사용자 |
| `consent_type` | VARCHAR(20), PK | `SERVICE_STORAGE`(필수) / `TRAINING_USE`(선택) |
| `consent_version` | VARCHAR(30), PK | 동의 문구 버전. 예: `service-v1` |
| `consented_at` | DATETIME(3) | 동의 시각 |
| `withdrawn_at` | DATETIME(3) NULL | 철회 시각. NULL: 유효 |

### 8. client_record

| 컬럼 | 형식 | 설명 |
| --- | --- | --- |
| `user_account_id` | BIGINT, PK·FK → `user_account` (CASCADE) | 기록 소유자 |
| `client_record_id` | VARCHAR(128) ascii, PK | 앱이 만든 기록 ID |
| `record_fingerprint` | CHAR(64) ascii | 같은 ID 재전송 시 내용 일치 확인 |
| `payload` | JSON | 기록 원문(요약·사건·적용 설정). 영상·좌표 없음 |
| `created_at` | DATETIME(3) | 저장 시각 |

`monitor_session`·`collapse_event`에서 같은 화면을 다시 만들 수 있게 되면 이 테이블은 없앨 수 있다.

### 11. user_account.age, user_account.occupation

| 컬럼 | 형식 | 설명 |
| --- | --- | --- |
| `age` | INT NULL, CHECK 1~120 | 가입 시 입력한 나이 |
| `occupation` | VARCHAR(80) NULL | 가입 시 입력한 직업(자유 입력) |

V0.3은 "나이·직업은 사용 목적이 정해질 때까지 받지 않음"으로 정했다. 이 건의는 다음 용도를 근거로 다시 넣자는 것이다.

- **사용자 정보**: 앱은 이미 가입·프로필 화면에서 이름·나이·직업을 받는다([계정 계약](../../contracts/accounts.v1.md)). 저장할 자리가 없으면 화면 입력이 버려진다.
- **기록 해석**: 앉아 있는 시간이 긴 직업군 등 사용 환경을 알아야 측정 결과(유지율·붕괴 간격)를 사람이 해석할 수 있다.
- **분석 시 구분**: `TRAINING_USE` 동의 범위가 정해진 뒤, 동의한 사용자에 한해 연령대·직업군별로 결과를 나눠 볼 수 있다. 동의 없이 분석에 쓰지 않는다.

- 탈퇴(`account_status = CLOSED`) 처리 때 V0.3의 식별 컬럼처럼 `NULL`로 비운다.
- 진단·의료 판단에 쓰지 않는다. 직업은 자유 입력이므로 분석에 쓰려면 분류 기준을 따로 정해야 한다.
- 필수 여부(ACTIVE 계정에 NOT NULL로 강제할지)는 DB 담당 판단에 맡긴다. 현재 앱은 필수로 받는다.

## 동의 (보류된 T-41 채우기)

이미 앱에 있던 두 동의를 그대로 옮긴다.

| 종류 | 기존 위치 | 현재 문구 | 비고 |
| --- | --- | --- | --- |
| `SERVICE_STORAGE` | 서버 계정 가입 화면, 필수 | "계정과 측정 기록을 보관하는 데 동의합니다." (`service-v1`) | 가입 시 기록. 연구·학습 동의가 아님 |
| `TRAINING_USE` | 로컬 프로필 화면, 선택 | "학습용 자료 사용에 동의합니다 (선택)" | 지금까지 화면에만 있고 저장된 적 없음 |

`TRAINING_USE`는 **기록할 자리만 만든다.** 어떤 자료를 얼마나 보관하는지, 철회하면 이미 만든 학습 자료를 어떻게 하는지는
정해지지 않았다. 이 범위가 정해지기 전에는 이 동의만으로 서비스 자료를 분석·학습에 쓰지 않는다
([플랫폼 경계](../../docs/design/data-platform-boundary.md), [연구 프로토콜](../../docs/research/protocol.md)).

## 이번에 하지 않는 것

- **판정 정책 값**: 시드 `DEFAULT_TEMP`(임계 0.5·확정 3초·복귀 2초·재알림 30초·시간당 12회)를 그대로 쓴다.
  어차피 확정 시 `DEFAULT` 행으로 교체할 값이므로 지금 새 행을 넣지 않는다.
- **붕괴 유형**(T-36): 코드 체계가 정해지면 V0.3 계획대로 추가한다. 그 전까지 좌우 방향은 `client_record` 원문에만 남는다.

## 검토 요청

- 1~11번 각각 승인 / 수정 / 거절
- 11번 나이·직업의 용도 승인과 필수 여부
- 5번 로그인 저장 방식(Spring Session JDBC 유지 여부)
- 7번 동의 종류 이름과 `TRAINING_USE`의 범위를 정할 담당
- 승인되면 명세서(DB-03)에 반영할지, `migrations/`만 둘지
