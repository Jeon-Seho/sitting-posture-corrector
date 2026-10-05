# database — 자세교정 서비스 DB

MySQL 서비스 스키마의 실행 파일(스키마·시드·마이그레이션)과 ERD를 둔다. 설계 문서는 `docs/db/`에 있다 (DB-01~04).

---

## 1. 적용 순서

빈 MySQL(8.0.16 이상)에 아래 순서대로 적용한다. **순서를 바꾸면 실패한다.**

| 순서 | 파일 | 하는 일 | 앞 단계가 필요한 이유 |
|---|---|---|---|
| 1 | `schema/schema_V0_3.sql` | 데이터베이스 `posture_service`와 테이블 17개 생성 | — |
| 2 | `migrations/` 번호순 | 스키마 변경분 적용 | **현재 파일 없음** — 건너뛴다 |
| 3 | `seed/seed_01_feature_def.sql` | 특징값 3개 | 테이블이 있어야 한다 |
| 4 | `seed/seed_02_safety_range.sql` | 절대 안전 범위 | 특징값을 참조한다 (현재 행 없음) |
| 5 | `seed/seed_03_model_version.sql` | 규칙 기반 모델 1건 | — |
| 6 | `seed/seed_04_threshold_policy.sql` | 기본 판정 정책 1건 | — |

```bash
# 1) 스키마 (데이터베이스 생성 포함)
mysql -u <계정> -p < database/schema/schema_V0_3.sql

# 2) 마이그레이션 — 파일이 생기면 번호순으로
# for f in database/migrations/[0-9]*.sql; do mysql -u <계정> -p posture_service < "$f"; done

# 3) 시드 — 번호순
for f in database/seed/seed_0*.sql; do mysql -u <계정> -p < "$f"; done
```

**적용 후 확인** — 테이블 17개, `feature_def` 3행, `safety_range` 0행, `model_version` 1행, `threshold_policy` 1행이면 정상이다.

**다시 처음부터 적용할 때** — `posture_service` 데이터베이스를 지운 뒤 1번부터 다시 한다. 스키마 파일은 이미 있는 테이블 위에 다시 적용하면 실패한다(의도된 동작).

접속 정보는 `.env`로만 관리하고 커밋하지 않는다.

---

## 2. 버전과 환경

| 항목 | 내용 |
|---|---|
| 스키마 파일 | `schema/schema_V0_3.sql` |
| 대응 명세서 | DB 명세서 V0.3 (DRAFT) — DB-03 V0.3, DB-04 V0.1 |
| 데이터베이스 이름 | `posture_service` (가칭, DB-03 D-33) |
| DBMS | MySQL 8.0.16 이상 (CHECK 제약 강제, 함수 기반 유니크 키 사용) |
| 문자셋 | `utf8mb4` / `utf8mb4_0900_ai_ci`. 장치 식별값과 파일 위치만 `utf8mb4_bin`(대소문자 구분) |

**스키마 파일 번호** — 명세서 버전과 같아야 한다(작업규칙 1.7). 지금은 명세서가 V0.3(DRAFT)이라 `schema_V0_3.sql`이다. 리뷰를 거쳐 명세서가 V1.0이 되면 `schema_V1_0.sql`로 다시 만든다.

**이 파일은 명세서에서 생성했다.** SQL을 직접 고치지 말고, 명세서를 고친 뒤 다시 만든다. 직접 고치면 명세서와 스키마가 어긋난다.

---

## 3. 폴더 구성

```
database/
├── README.md                          ← 이 문서
├── .gitignore                         ← 커밋 금지 대상 (4장)
├── schema/
│   └── schema_V0_3.sql                ← 명세서 버전과 같은 번호
├── seed/
│   ├── seed_01_feature_def.sql
│   ├── seed_02_safety_range.sql       ← 현재 행 없음 (6장)
│   ├── seed_03_model_version.sql
│   └── seed_04_threshold_policy.sql   ← 임시값 (6장)
├── migrations/                        ← 아직 없음. 보류 테이블·인덱스가 여기로 들어온다
└── erd/
    ├── posture_erd.drawio             ← 원본 (개념·논리 2페이지)
    ├── posture_erd_concept.png
    └── posture_erd_logical.png
```

---

## 4. 커밋 금지 규칙 (작업규칙 1.6)

이 프로젝트는 카메라 기반 개인정보를 다루므로 아래는 **저장소에 올리지 않는다.**

| 금지 대상 | 비고 |
|---|---|
| DB 접속 정보·계정·비밀번호 | `.env`, 접속 설정 파일. 예시는 `.env.example`로만 |
| 인증서·키 파일 | 지갑, 인증서, 토큰 |
| 사용자·피험자 데이터 덤프 | 시드는 **마스터 데이터만** 허용 |
| 키포인트 원본 파일 | Parquet/NPZ 등. DB에는 경로 메타만 |
| 영상·이미지 원본 | 계획서 개인정보 방침상 저장 자체가 금지 |
| 피험자 식별 가능 정보 | 익명 코드 외 일체 |

- `.gitignore`에 위 경로를 등록했다 (`database/.gitignore`).
- 시드 파일에 실사용자 계정이 들어가면 안 된다. 테스트 계정은 명시적으로 표기한다.
- 이미 커밋된 경우 파일 삭제로 끝내지 말고 이력에서 제거한 뒤 팀에 공지한다.

---

## 5. 스키마 범위

**17개 테이블, 122개 컬럼.** 키와 제약은 아래와 같다.

| 구분 | 수 | 비고 |
|---|---|---|
| PK | 17 | |
| UK | 11 | UK-11(활성 기준 자세는 사용자당 하나)은 함수 기반 유니크 키 |
| FK | 19 | 삭제 동작은 DB-04 1-1절 |
| CHECK | 55 | 허용값, 범위, 행 간 규칙 (탈퇴 계정, 세션 종료, 이벤트 회복 등) |

**제외한 것 (보류)** — 팀 결정이 나면 `migrations/`에 추가한다.

| 항목 | 이유 |
|---|---|
| T-36 `collapse_type`, `collapse_event.collapse_type_code`, FK-15 | 붕괴 유형 코드 체계(3·2·7종) 미결 |
| T-41 `user_consent`, UK-08, FK-19 | 서비스 학습 동의 범위 미결 |

**인덱스** — 보조 인덱스는 넣지 않았다. 인덱스는 DB-05에서 쿼리 목록을 먼저 만든 뒤 설계하고, 테이블 생성과 다른 파일로 둔다(작업규칙 4.7).

다만 InnoDB는 FK 컬럼에 쓸 인덱스가 없으면 **자동으로 만든다.** 지금 자동 생성되는 인덱스는 11개다. DB-05 인덱스 시트에서 이 11개를 포함해 정리한다.

| 테이블 | 자동 생성 인덱스 (FK 이름과 같음) | 컬럼 |
|---|---|---|
| `user_account` | `fk_user_account_threshold_policy` | threshold_policy_id |
| `baseline_posture` | `fk_baseline_posture_user_account` | user_account_id |
| `baseline_feature` | `fk_baseline_feature_feature_def` | feature_code |
| `monitor_session` | `fk_monitor_session_user_account` | user_account_id |
| `monitor_session` | `fk_monitor_session_capture_device` | capture_device_id, user_account_id |
| `monitor_session` | `fk_monitor_session_baseline_posture` | baseline_posture_id, user_account_id |
| `monitor_session` | `fk_monitor_session_threshold_policy` | threshold_policy_id |
| `monitor_session` | `fk_monitor_session_model_version` | model_version_code |
| `feature_archive` | `fk_feature_archive_monitor_session` | monitor_session_id |
| `deployment` | `fk_deployment_model_version` | model_version_code |
| `error_log` | `fk_error_log_monitor_session` | monitor_session_id |

---

## 6. 시드 내용

시드는 시스템이 처음부터 갖고 있어야 하는 마스터 데이터다. 사용자 데이터는 넣지 않는다.

| 파일 | 내용 | 없으면 | 상태 |
|---|---|---|---|
| `seed_01_feature_def.sql` | 특징값 3개 (`HEAD_GAP`, `LATERAL_OFFSET`, `SHOULDER_TILT`) | 기준 자세를 저장할 수 없다 | 프로토타입 기준. SFR-014 목록이 확정되면 추가 |
| `seed_02_safety_range.sql` | 절대 안전 범위 | 기준 자세 등록 시 안전 범위 검사(BR-04)를 못 한다 | **행 없음** — 값의 근거가 없다 (모델 + PI가 측면 검증 후 결정) |
| `seed_03_model_version.sql` | 규칙 기반 모델 1건 (`RULE-PROTO-1`) | 측정 세션을 만들 수 없다 | 확정 |
| `seed_04_threshold_policy.sql` | 기본 판정 정책 1건 (`DEFAULT_TEMP`) | 회원가입을 할 수 없다 | **임시값** |

**기본 판정 정책의 임시값**

| 컬럼 | 값 | 근거 | 결정 주체 |
|---|---|---|---|
| `threshold` | 0.500 | 임시 — 확률 중간값 | 모델 |
| `hold_seconds` | 3.0 | REQ 10장 #4 초기값 3초 | 모델 + PM |
| `recover_seconds` | 2.0 | 임시 — FE 설정 범위(1~10초) 안 | 모델 + PM |
| `realert_seconds` | 30 | 임시 — FE 설정 범위(15~180초) 안 | PM + FE |
| `notify_max_per_hour` | 12 | 임시 — 근거 없음 | PM |

**값이 확정되면 이 행을 고치지 않는다.** 판정 정책은 한 번 기록하면 바꾸지 않는다(BR-65). 그 사이 세션이 이 행을 가리키고 있을 수 있다. 확정값은 이름 `DEFAULT`로 새 행을 추가하고, 백엔드의 기본 정책 이름 설정만 바꾼다.

---

## 7. 마이그레이션 규칙 (작업규칙 4.7)

- 파일명은 `<3자리>_<동작>_<대상>.sql`이고, 번호 순서대로 적용한다.
- **이미 적용된 파일은 수정하지 않는다.** 변경은 새 번호 파일로 추가한다.
- 한 파일은 한 목적만 담는다.
- 인덱스는 테이블 생성과 다른 파일에 둔다. 초기 적재 때 인덱스 없이 넣기 위해서다.

---

## 8. 재현 검증 (작업규칙 4.7)

| 단계 | 내용 | 2026-10-02 결과 (MySQL 8.0.46) |
|---|---|---|
| 1 | 빈 DB에 스키마·마이그레이션 적용 → 오류 0 | 통과 (경고 0) |
| 2 | 시드 적용 → 오류 0 | 통과 |
| 3 | 애플리케이션 기동 → 연결·기본 조회 성공 | **백엔드 연결 후 확인** — 대신 아래 무결성 검증으로 기본 쓰기·조회를 확인 |
| 4 | 롤백(데이터베이스 삭제 후 재적용) 1회 성공 | 통과 |

**무결성 검증 — 57개 항목 모두 통과.** 테스트 계정(`test-*@example.invalid`)으로 확인한 뒤 데이터베이스를 지우고 다시 만들었다.

| 분류 | 확인한 것 |
|---|---|
| 키 | 같은 이메일 재가입 거부(대소문자 무시), 같은 클라이언트 세션 식별자 재전송 거부, 활성 기준 자세 2개 거부, 없는 특징값 코드 거부 |
| 사용자 일치 (D-35) | 다른 사용자의 장치나 기준 자세로 세션을 만들면 거부 |
| 행 간 규칙 | 활성 계정의 이메일 누락, 종료 시각만 있는 세션, 회복이 아닌데 회복 시각, 사유 없는 억제 알림, 분자 > 분모 통계, 0.5 단위 위반, LSTM인데 모델 파일 위치 없음 — 모두 거부 |
| 삭제 차단 | 적재 기록이 남은 세션, 세션이 남은 사용자, 사용 중인 정책·모델·특징값, 보관 기간 중인 탈퇴 사용자 — 모두 삭제 거부 |
| 시나리오 1 (탈퇴) | DB-04 6-1 순서대로 한 트랜잭션에서 성공. 제외 구간·이벤트·알림·기준 특징값이 연쇄 삭제되고, 오류 기록은 남은 채 세션 연결만 비워짐. 탈퇴 처리 후 같은 이메일로 재가입 가능 |
| 시나리오 2 (세션만 삭제) | 세션을 지워도 일별 통계는 그대로 |
| 기준 자세 교체 (D-27) | 기존 기준 비활성 전환 + 새 기준 등록을 한 트랜잭션으로 처리 |

---

## 9. 백엔드 구현 시 주의

| 상황 | 해야 할 것 | 근거 |
|---|---|---|
| 모든 시각 | UTC로 저장한다. 연결할 때 세션 시간대를 `+00:00`으로 둔다 | CONVENTIONS |
| 가입 | 기본 정책을 이름(`DEFAULT_TEMP`)으로 찾는다. 이름은 설정값으로 둔다 | UK-12 |
| 비밀번호 | 백엔드에서 단방향 해시로 만들어 `password_hash`에 넣는다. 평문은 저장하지도 응답하지도 않는다 | SER-004 |
| 로그인 | `account_status`가 ACTIVE인 계정만 통과시킨다. 탈퇴 요청 직후(CLOSED)에도 삭제가 끝날 때까지 이메일·비밀번호 해시가 남아 있으므로, 비밀번호가 맞아도 막아야 한다 | D-34, DB-04 6-1 |
| 세션 생성 | 세션의 사용자 = 장치의 사용자 = 기준 자세의 사용자. 다르면 DB가 거부한다 | D-35 |
| 세션 저장 재전송 | `client_session_uuid` 중복(1062)이면 새 행을 만들지 말고 기존 행을 돌려준다 | BR-62 |
| 세션 종료 | `ended_at`, `end_reason`, `good_sec`을 한 번에 채운다 | ck_monitor_session_end |
| 기준 자세 재등록 | 한 트랜잭션에서 **기존 기준의 `deactivated_at`을 먼저 채우고** 새 기준을 넣는다. 순서가 반대면 활성 기준이 2개가 돼 거부된다 | D-27, UK-11 |
| 설정 변경 | 같은 값 조합의 정책을 찾고, 없으면 새로 넣는다(`created_by='USER'`, 이름 없음). 그다음 사용자가 그 정책을 가리키게 한다. 정책 행은 UPDATE하지 않는다 | BR-64, BR-65 |
| 안전 범위 검사 | 범위 행이 없는 특징값은 검사를 건너뛰고 로그를 남긴다 | seed_02 |
| 기준 자세의 특징값 버전 | `FEAT-PROTO-1` (모델 버전 `RULE-PROTO-1`과 같은 값) | seed_03 |
| 삭제 배치 | 파일 먼저, 행은 하위부터, 사용자 한 명 단위 트랜잭션 | DB-04 6장 |
| 오류 메시지 | 이메일 등 식별 정보를 넣지 않는다 | DB-04 9장 #5 |

---

## 10. 작업규칙과 다른 점

| CR-ID | 내용 | 상태 |
|---|---|---|
| CR-01 | 시드 목록 변경 — `seed_03_posture_state_code`·`seed_05_capture_protocol` 삭제, `seed_03_model_version` 추가. 이 폴더는 개정안을 따랐다 | 발행 대기 (DB-03 7-2절), 팀장·PM 승인 |
| CR-02 | 실행 폴더 이름 `db/` → `database/`. 저장소에 `database/`가 이미 있어 그대로 쓴다. 작업규칙 1.1 디렉터리 구조와 4.7의 `db/README.md` 경로가 바뀐다 | 신규 — 10/5 리뷰에서 CR-01과 함께 승인 요청 |

저장소의 `database/AGENTS.md`는 이 README와 별개로 그대로 둔다.

---

## 11. 현재 백엔드 코드와의 관계 (전환 중)

팀 결정(2026-10-05)으로 **서비스 DB 스키마의 기준은 이 폴더의 V0.3**이다.
`jin_app` 병합으로 들어온 API(`backend/api`)는 아직 이전 설계인 Flyway
[V1 마이그레이션](migrations/V1__accounts_and_durable_sessions.sql)의 테이블(`users`, `workspaces`,
`measurement_sessions`, `session_events`, `records`, `cep_outbox`, `SPRING_SESSION` 등)을 사용한다.

- 두 설계는 같은 목적의 테이블을 다른 이름·구조로 정의하므로 한 DB에 함께 적용하지 않는다.
- V1은 V0.3으로 대체할 대상이다. 전환 범위·대응표·보류 항목은 [전환 계획](../docs/plans/active/0021-db-schema-v03-alignment.md)에 둔다.
- 전환이 끝나기 전까지 `make check-compose`와 API 영구 모드는 V1 기준으로 동작한다. 이를 V0.3 검증 결과로 보고하지 않는다.
