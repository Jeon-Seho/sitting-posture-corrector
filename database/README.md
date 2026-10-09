# database — 자세교정 서비스 DB

MySQL 서비스 스키마의 실행 파일(스키마·시드·마이그레이션)과 ERD를 둔다. 설계 문서는 `docs/db/`에 있다 (DB-01~04).

---

## 1. 적용 순서

빈 MySQL(8.0.16 이상)에 아래 순서대로 적용한다. **순서를 바꾸면 실패한다.**

| 순서 | 파일 | 하는 일 | 앞 단계가 필요한 이유 |
|---|---|---|---|
| 1 | `schema/schema_V2_1.sql` | 데이터베이스 `posture_service`와 테이블 12개 생성 | — |
| 2 | `seed/seed_04_threshold_policy.sql` | 기본 판정 정책 1건 | 테이블이 있어야 한다 |

```bash
# 1) 스키마 (데이터베이스 생성 포함)
mysql -u <계정> -p < database/schema/schema_V2_1.sql

# 2) 시드 — 번호순
for f in database/seed/seed_0*.sql; do mysql -u <계정> -p < "$f"; done
```

`migrations/`는 비어 있다 (7장).

**적용 후 확인** — 테이블 12개, `threshold_policy` 1행이면 정상이다.

**V2.0·V1.x로 만든 DB** — V2.1은 테이블을 지운 변경이라 migration으로 올리지 않는다(작업규칙 1.4). 필요한 데이터를 먼저 백업하고, `posture_service` 데이터베이스를 지운 뒤 1번부터 다시 만든다.

```bash
mysql -u <계정> -p -e "DROP DATABASE IF EXISTS posture_service"
# 이어서 위 1) 2) 실행
```

**다시 처음부터 적용할 때** — `posture_service` 데이터베이스를 지운 뒤 1번부터 다시 한다. 스키마 파일은 이미 있는 테이블 위에 다시 적용하면 실패한다(의도된 동작).

접속 정보는 `.env`로만 관리하고 커밋하지 않는다.

---

## 2. 버전과 환경

| 항목 | 내용 |
|---|---|
| 스키마 파일 | `schema/schema_V2_1.sql` (현재, 이후 `migrations/`의 기준) |
| 대응 명세서 | DB 명세서 V2.1 (확정 2026-10-09) — V2.0 초안 + 추가 수정 (「V2.0 추가 수정사항 정리」 V1.1). CR-04 승인자·회의록 기재 전, 문서(REQ-01, DB-01~04) 반영 전 |
| 데이터베이스 이름 | `posture_service` (가칭, DB-03 D-33) |
| DBMS | MySQL 8.0.16 이상 (CHECK 제약 강제) |
| 문자셋 | `utf8mb4` / `utf8mb4_0900_ai_ci`. 파일 위치(`feature_archive.file_uri`)만 `utf8mb4_bin`(대소문자 구분) |
| 시간대 | `SPRING_SESSION`을 뺀 모든 `DATETIME(3)`은 **KST(한국 표준시, +09:00)**로 저장한다. 일별 통계의 날짜 기준(`STAT_TIMEZONE`)도 `Asia/Seoul` (CR-04) |

**스키마 파일 번호** — 명세서 버전과 같아야 한다(작업규칙 1.7). V2.0과 V2.1은 테이블을 지운 변경이라 migration 없이 DB를 새로 만든다(작업규칙 1.4). 이전 스키마 파일(V1.x, V2.0)과 migration 001~010은 V2.1 스키마에 흡수하고 지웠다(git 이력에 남음). 이후 변경은 운영 중인 DB용 `migrations/` 파일과 새 DB용 다음 버전 스키마 파일(`schema_V2_x.sql`)에 함께 반영하고, 두 방법의 결과가 같은지 확인한다(8장).

**스키마 파일은 명세서에서 생성했다.** SQL을 직접 고치지 말고, 명세서를 고친 뒤 다시 만든다. 직접 고치면 명세서와 스키마가 어긋난다.

---

## 3. 폴더 구성

```
database/
├── README.md                          ← 이 문서
├── .gitignore                         ← 커밋 금지 대상 (4장)
├── schema/
│   └── schema_V2_1.sql                ← 현재. 새 DB는 이 파일로 만든다
├── seed/
│   └── seed_04_threshold_policy.sql   ← 임시값 (6장)
├── migrations/                        ← 비어 있음. 다음 번호 011 (7장)
├── tests/
│   └── integrity_check.py             ← 무결성 검사 (8장)
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

**12개 테이블, 103개 컬럼.** V2.0(16개)에서 V2.1 추가 수정으로 4개를 지웠다. 키와 제약은 아래와 같다.

| 구분 | 수 | 비고 |
|---|---|---|
| PK | 12 | `baseline_posture`의 PK는 `user_account_id` (사용자당 1행) |
| UK | 8 | UK-13은 `SPRING_SESSION.SESSION_ID` |
| FK | 11 | 삭제 동작은 DB-04 1-1절 |
| CHECK | 59 | 허용값, 범위(관절 좌표 18개 포함), 행 간 규칙 (세션 종료, 이벤트 회복, 삭제 요청 등) |

**V2.1에서 지운 것 (V2.0 추가 수정)**

| 대상 | 이유 |
|---|---|
| T-31 `baseline_feature`, T-27 `feature_def`, FK-03·05·06 | 기준 자세에 특징값 대신 **관절 좌표 18개**(코·눈·귀·입 양끝·어깨의 x·y)를 저장한다. 특징값은 판정할 때 좌표에서 계산한다 |
| T-28 `safety_range` | 행이 없었다. 안전 범위 검사를 유지할지는 미결 (9장) |
| `baseline_posture.baseline_posture_id`·`deactivated_at`·`feature_version`·`normalization_scale`·`target_center_x`·`target_center_y`·`target_area_ratio`, UK-10·UK-11 | 기준 자세는 사용자당 1행이고 다시 촬영하면 덮어쓴다. 정규화 상수와 대상 위치·크기는 좌표에서 계산한다 |
| `monitor_session.baseline_posture_id`, FK-09 | 세션은 대신 `calibration_uuid` 값을 복사해 어느 기준으로 측정했는지 구분한다 (FK 아님) |
| `monitor_session.frame_width`·`frame_height` | 지정된 카메라 한 대를 같은 해상도(`CAPTURE_RESOLUTION`)로 쓴다 |
| T-50 `client_record`, FK-26 | 기록 화면 응답을 정규화 테이블(`monitor_session`·`collapse_event`·`correction_alert`·`threshold_policy`)로 만든다 |
| `user_account.auth_epoch` | 로그인 끊기는 그 사용자의 `SPRING_SESSION` 행을 지워서 한다 (9장) |

**V2.0에서 지운 것 (CR-04)**

| 대상 | 이유 |
|---|---|
| T-26 `capture_device`, `monitor_session.capture_device_id` | 장치 정보를 저장하지 않는다 |
| T-32 `model_version`, `monitor_session.model_version_code` | 모델 버전 관리를 하지 않는다 (팀 회의) |
| T-42 `deployment`, T-43 `error_log` | 배포는 이미지 태그·CI 기록으로, 오류는 애플리케이션 로그로 남긴다 |
| T-44 `input_result`, T-45 `cep_outbox`, T-46 `confirmed_snapshot`, T-47 `cep_cleanup` | CEP를 쓰지 않는다. 붕괴 확정·회복·재알림 판정은 백엔드가 맡는다 |
| `ck_user_account_identity` | 식별 컬럼 3개(`login_email`, `password_hash`, `display_name`)를 다시 NOT NULL로 했다. 탈퇴 때 비우지 않고 행째 지운다 (9장) |

**외부 라이브러리 테이블** — `SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES`는 Spring Session JDBC 표준 정의를 그대로 쓴다. 대문자 이름과 `BIGINT`(밀리초) 시각은 이름 규칙 예외다(건의안 0001 #5).

**제외한 것 (보류)** — 팀 결정이 나면 `migrations/`에 추가한다.

| 항목 | 이유 |
|---|---|
| T-36 `collapse_type`, `collapse_event.collapse_type_code`, FK-15 | 붕괴 유형 코드 체계(3·2·7종) 미결 |
| T-41 `user_consent`, UK-08, FK-19 | 서비스 학습 동의 범위 미결 (건의안 0001 #7도 보류) |

**인덱스** — 보조 인덱스는 넣지 않았다. 인덱스는 DB-05에서 쿼리 목록을 먼저 만든 뒤 설계하고, 테이블 생성과 다른 파일로 둔다(작업규칙 4.7). 판정 정책 검색(설정 저장)은 UK-03이 인덱스를 겸하므로 따로 만들지 않는다.

다만 InnoDB는 FK 컬럼에 쓸 인덱스가 없으면 **자동으로 만든다.** 지금 자동 생성되는 인덱스는 4개다. DB-05 인덱스 시트에서 이 4개를 포함해 정리하고, `SPRING_SESSION`의 보조 인덱스 2개(`EXPIRY_TIME`, `PRINCIPAL_NAME`)도 이때 둔다.

| 테이블 | 자동 생성 인덱스 (FK 이름과 같음) | 컬럼 |
|---|---|---|
| `user_account` | `fk_user_account_threshold_policy` | threshold_policy_id |
| `monitor_session` | `fk_monitor_session_user_account` | user_account_id |
| `monitor_session` | `fk_monitor_session_threshold_policy` | threshold_policy_id |
| `feature_archive` | `fk_feature_archive_monitor_session` | monitor_session_id |

---

## 6. 시드 내용

시드는 시스템이 처음부터 갖고 있어야 하는 마스터 데이터다. 사용자 데이터는 넣지 않는다. `seed_03_model_version.sql`은 V2.0에서, `seed_01_feature_def.sql`·`seed_02_safety_range.sql`은 V2.1에서 지웠다(테이블 삭제). 번호는 다시 쓰지 않으므로 새 시드는 `seed_05`부터 매긴다.

| 파일 | 내용 | 없으면 | 상태 |
|---|---|---|---|
| `seed_04_threshold_policy.sql` | 기본 판정 정책 1건 (`DEFAULT_TEMP`) | 회원가입을 할 수 없다 | **임시값**. V2.1에서 값 변경 없음 |

**기본 판정 정책의 임시값**

| 컬럼 | 값 | 근거 | 결정 주체 |
|---|---|---|---|
| `threshold` | 0.500 | 임시 — 확률 중간값 | 모델 |
| `hold_seconds` | 3.0 | REQ 10장 #4 초기값 3초 | 모델 + PM |
| `recover_seconds` | 3.0 | 임시 — FE 설정 범위(1~10초) 안. 2026-10-06 2.0→3.0 (ADR 0012 개정, #16) | 모델 + PM |
| `realert_seconds` | 60 | 임시 — FE 설정 범위(15~180초) 안. 2026-10-06 30→60 (#16) | PM + FE |
| `notify_max_per_hour` | 12 | 임시 — 근거 없음 | PM |

**값이 확정되면 이 행을 고치지 않는다.** 판정 정책은 한 번 기록하면 바꾸지 않는다(BR-65). 그 사이 세션이 이 행을 가리키고 있을 수 있다. 확정값은 이름 `DEFAULT`로 새 행을 추가하고, 백엔드의 기본 정책 이름 설정만 바꾼다. (V2.0에서 행을 직접 고친 것은 모든 DB를 새로 만드는 주 버전 변경이라서다.)

---

## 7. 마이그레이션 규칙 (작업규칙 4.7)

- 파일명은 `<3자리>_<동작>_<대상>.sql`이고, 번호 순서대로 적용한다.
- **이미 적용된 파일은 수정하지 않는다.** 변경은 새 번호 파일로 추가한다.
- 한 파일은 한 목적만 담는다.
- 인덱스는 테이블 생성과 다른 파일에 둔다. 초기 적재 때 인덱스 없이 넣기 위해서다.
- migration과 시드 파일은 `SET NAMES utf8mb4;`로 시작한다. 빠지면 접속 문자셋에 따라 한글이 깨진 채 저장된다.
- 새 DB는 최신 스키마 파일로 만들고, `migrations/`는 이미 만든 DB를 올릴 때만 적용한다.
- 테이블을 지우는 변경은 migration을 만들지 않고 DB를 새로 만든다(작업규칙 1.4). V2.0 → V2.1이 이 경우다.
- **지금은 비어 있다.** V1.0 → V1.1용 001~010은 V2.0 스키마에 흡수했다. 번호는 다시 쓰지 않으므로 **다음 파일은 011**부터 매긴다.

---

## 8. 재현 검증 (작업규칙 4.7)

| 단계 | 내용 | 2026-10-09 결과 (MySQL 8.0.46, V2.1) |
|---|---|---|
| 1 | 빈 DB에 스키마 적용 → 오류 0 | 통과 (경고 0) |
| 2 | 시드 적용 → 오류 0 | 통과 |
| 3 | 애플리케이션 기동 → 연결·기본 조회 성공 | **백엔드 연결 후 확인** — 대신 아래 무결성 검사로 기본 쓰기·조회를 확인 |
| 4 | 롤백(데이터베이스 삭제 후 재적용) 1회 성공 | 통과 |

**DB CI** (`.github/workflows/db-ci.yml`) — 최신 스키마 + 시드로 만든 DB와, 기준 스키마(`schema_V2_1.sql`) + 시드 + `migrations/`로 만든 DB의 구조·마스터 데이터를 비교한다. V2.1은 migration이 없으므로 두 결과가 같아야 한다. 테이블 수(12)와 `threshold_policy` 행 수(1)는 1장 「적용 후 확인」 값과 같다.

**무결성 검사 (`tests/integrity_check.py`) — 87개 항목 모두 통과.** 테스트 계정(`test-*@example.invalid`)과 합성 좌표값으로 확인하고 행을 모두 지운다. DB CI가 새 DB에서 실행한다.

| 분류 | 확인한 것 |
|---|---|
| 키 | 같은 이메일 재가입 거부(대소문자 무시), 사용자당 기준 자세 2행 거부(PK), 다른 사용자와 같은 보정 식별자 거부(UK-04), 같은 클라이언트 세션 식별자·로그인 세션 식별자 재전송 거부, 없는 사용자의 기준 자세 거부(FK-04) |
| 식별 컬럼 (CR-04) | `login_email`·`password_hash`·`display_name` NULL 거부 |
| 기준 자세 | 좌표 0~1 범위 밖 거부, 보정 시간 0 거부, UUID 길이가 아닌 보정 식별자 거부 |
| 기준 자세 다시 촬영 (B안) | 세션 시작 때 기준 자세의 `calibration_uuid`가 세션에 복사됨. 다시 촬영하면 같은 행이 UPDATE되고(사용자당 1행 유지), 이전 세션은 이전 값을, 새 세션은 새 값을 가짐 |
| 행 간 규칙·허용값 | 종료 시각만 있는 세션, 회복이 아닌데 회복 시각, 사유 없는 억제 알림, 분자 > 분모 통계, 0.5 단위 위반, 없는 제외 사유(`MISSING`은 허용), 나이 범위(1~120), UUID 길이가 아닌 세션 보정 식별자 — 모두 거부 |
| 삭제 차단 | 적재 기록이 남은 세션, 세션이 남은 사용자, 사용 중인 정책, 삭제 요청 행이 남은 사용자 — 모두 삭제 거부 |
| 시나리오 1 (탈퇴, DB-04 V0.2 6-1) | 접수하면 계정 CLOSED와 함께 그 사용자의 로그인 세션·속성이 지워지고 다른 사용자의 로그인 세션은 그대로. 유예 중에는 식별 정보·기록이 그대로이고 같은 이메일 재가입은 거부. 철회하면 계정 ACTIVE + 요청 행 삭제. 유예 종료 대상은 폐쇄 시각 + 30일로 계산(30일이 안 지난 요청은 제외). 최종 삭제는 한 트랜잭션에서 성공하고 제외 구간·이벤트·알림이 연쇄 삭제. 삭제 뒤 같은 이메일로 재가입 가능. 중간에 실패하면 전부 되돌아감 |
| 시나리오 2 (세션만 삭제) | 세션을 지워도 일별 통계는 그대로 |
| 세션 없는 계정 삭제 | 기준 자세·일별 통계 연쇄 삭제 (FK-04·17) |
| 로그인 세션 | 로그인 세션 삭제 시 속성 연쇄 삭제 |
| V2.1 폐기 확인 | 폐기·보류 테이블 6개와 폐기 컬럼(`auth_epoch`, `feature_version`, `frame_width` 등)이 DB에 없음 |

---

## 9. 백엔드 구현 시 주의

| 상황 | 해야 할 것 | 근거 |
|---|---|---|
| 모든 시각 | KST로 저장한다. 연결할 때 세션 시간대를 `Asia/Seoul`로 둔다 (`connectionTimeZone=Asia/Seoul`) | CR-04 |
| 가입 | 기본 정책을 이름(`DEFAULT_TEMP`)으로 찾는다. 이름은 설정값으로 둔다 | UK-12 |
| 비밀번호 | 백엔드에서 단방향 해시로 만들어 `password_hash`에 넣는다. 평문은 저장하지도 응답하지도 않는다 | SER-004 |
| 로그인 | `account_status`가 ACTIVE인 계정만 통과시킨다. 탈퇴 유예 중(CLOSED)에도 이메일·비밀번호 해시가 남아 있으므로, 비밀번호가 맞아도 철회 외에는 막아야 한다 | D-34, DB-04 9장 #4 |
| 로그인 끊기의 전제 | 로그인 수단은 Spring Session뿐이다(remember-me 쿠키·JWT 같은 세션 밖 인증을 쓰지 않는다). `PRINCIPAL_NAME`은 항상 채운다. 이메일 변경 기능을 넣으면 변경 때 예전 세션도 정리한다 | V2.1 (`auth_epoch` 삭제) |
| 기준 자세 등록·다시 촬영 | 처음이면 INSERT, 이미 있으면 **같은 행을 UPDATE**한다(`calibration_uuid`·`registered_at`·`sample_count`·좌표 18개). 촬영이 완료됐을 때만 바꾸고, 취소·실패하면 기존 값을 둔다. `calibration_uuid`는 프론트엔드가 촬영마다 새로 만든다. 같은 값으로 다시 오면 이미 반영된 것으로 보고 그대로 응답한다 | BR-63, UK-04 |
| 기준 자세 좌표 | MediaPipe 정규화 좌표(0~1), 촬영 동안의 평균. 0~1 밖의 값(화면 밖 추정)은 DB가 거부하므로 보정 실패로 처리한다. 좌표 수집 조건(MediaPipe 모델·`CAPTURE_RESOLUTION`·관절 목록)을 바꾸면 모든 사용자가 다시 촬영한다 | ck_baseline_posture_* |
| 안전 범위 검사 | `safety_range` 테이블이 없다. 검사를 유지할지는 미결이고, 유지하면 범위값은 코드나 설정에 둔다 | V2.1, BR-04 |
| 세션 생성 | 그 사용자의 기준 자세가 없으면 측정을 시작하지 않는다. 시작할 때 `baseline_posture.calibration_uuid`와 `user_account.threshold_policy_id`를 세션에 복사한다. 해상도는 저장하지 않는다(프론트엔드가 실제로 받은 해상도가 다르면 시작하지 않는다) | V2.1 B안, BR-64 |
| 세션 저장 재전송 | `client_session_uuid` 중복(1062)이면 새 행을 만들지 말고 기존 행을 돌려준다 | BR-62 |
| 세션 종료 | `ended_at`, `end_reason`, `good_sec`을 한 번에 채운다 | ck_monitor_session_end |
| 설정 변경 | 같은 값 조합의 정책을 찾고, 없으면 새로 넣는다(`created_by='USER'`, 이름 없음). 넣다가 중복 오류(1062)가 나면 다시 찾아 그 행을 쓴다. 그다음 사용자가 그 정책을 가리키게 한다. 정책 행은 UPDATE하지 않는다 | BR-64, BR-65, UK-03 |
| 일별 통계 | 세션 시작 시각의 KST 날짜로 집계한다 | BR-61, CR-04 |
| 탈퇴 접수 | 삭제 요청(`REQUESTED`, `account_closed_at`)과 계정 CLOSED를 한 트랜잭션으로 처리하고, 그 사용자의 `SPRING_SESSION` 행을 모두 지운다(`PRINCIPAL_NAME`으로 찾음). 식별 정보와 기록은 지우지 않는다 | D-34, DB-04 6-1 |
| 탈퇴 철회 | 요청 행을 잠그고 `REQUESTED`일 때만, 계정 ACTIVE + 요청 행 삭제를 한 트랜잭션으로. 이력은 남기지 않는다 | DB-04 6-1-1 |
| 탈퇴 최종 삭제 | 대상은 `account_closed_at + WITHDRAWAL_GRACE_DAY(30일) ≤ 현재`로 계산한다(삭제 예정일 컬럼 없음). 파일을 먼저 지우고 `deleted_at`을 채운 뒤, 적재 기록 → 세션 → 일별 통계 → 기준 자세 → 삭제 요청 → 계정을 한 트랜잭션으로 지운다. 완료 안내는 커밋 뒤에, 미리 읽어 둔 연락처로 보낸다 | D-34, DB-04 6-1 |
| 삭제 배치 공통 | 파일 먼저, 행은 하위부터, 사용자 한 명 단위 트랜잭션. 실패하면 되돌리고 요청을 FAILED로 둔다 | DB-04 6장 |
| 비밀번호 변경 | 지금 쓰는 세션을 뺀 그 사용자의 `SPRING_SESSION` 행을 지워 다른 기기의 기존 로그인을 끊는다 | 건의안 0001 #6, V2.1 |
| 가입 동의 | 저장하지 않는다. `user_consent`가 보류 중이다 | 건의안 0001 #7 |
| 로그인 세션 | 서버 DB는 스키마 파일로 만든다. Windows 로컬 DB의 덤프로 만들면 `SPRING_SESSION` 이름이 소문자로 바뀌어 라이브러리가 찾지 못한다 | 건의안 0001 #5 |

---

## 10. 작업규칙과 다른 점

| CR-ID | 내용 | 상태 |
|---|---|---|
| CR-01 | 시드 목록 변경 — 작업규칙의 `seed_03_posture_state_code`·`seed_05_capture_protocol` 삭제. 이 폴더의 시드는 `seed_04`뿐이다 (`seed_01`·`seed_02`는 V2.1에서 삭제) | 발행 대기 (DB-03 7-2절), 팀장·PM 승인 |
| CR-02 | 실행 폴더 이름 `db/` → `database/` | 작업규칙 V1.2에 반영 |
| CR-03 | 스키마 V1.0 확정과 DB 건의안 0001 반영(V1.1) | V2.0에 통합 (CR-04) |
| CR-04 | V2.0 — 테이블 8개·컬럼 2개 삭제, 식별 컬럼 NOT NULL, 탈퇴 30일 유예 후 삭제, 기본 정책 값 변경, KST 저장. V2.1 — 기준 자세 사용자당 1행(관절 좌표 저장), 테이블 4개 삭제, `auth_epoch`·세션 해상도 삭제. 이 폴더와 명세서 V2.1에 반영했다 | 승인 대기 (V2.1은 SFR-011이 바뀌므로 팀장·PM 승인 필요). 문서(REQ-01, DB-01~04) 반영 대기 |

저장소의 `database/AGENTS.md`는 이 README와 별개로 그대로 둔다.

---

## 11. 백엔드 코드와의 관계

API(`backend/api`) 영구 모드는 아직 **V1.1 테이블**을 쓴다([ADR 0018](../docs/decisions/0018-db-schema-v11-service-storage.md)). 아래를 V2.1에 맞게 고치기 전까지 V2.1 스키마로는 API 영구 모드와 Compose `db`가 시작되지 않는다.

| 고칠 곳 | 내용 |
|---|---|
| `SchemaVerifier` | 확인하는 테이블 24개 → 12개. `model_version`의 `REFERENCE-RULE-1` 확인을 뺀다 |
| `JdbcSessionStore`, `SessionSetup`, `UserStore`, `PersistentSessionService` | V2.0·V2.1에서 지운 테이블·컬럼(`capture_device`, `input_result`, `cep_outbox`, `confirmed_snapshot`, `cep_cleanup`, `feature_def`, `safety_range`, `baseline_feature`, `client_record`, `auth_epoch`, `monitor_session.capture_device_id`·`model_version_code`·`baseline_posture_id`·`frame_width`·`frame_height`)을 쓰지 않게 한다. 기준 자세·세션 생성·탈퇴는 9장대로 바꾼다 |
| `application-persistent.properties` | `connectionTimeZone=UTC` → `Asia/Seoul`, `posegood.model-version-code` 삭제 |
| `compose.yaml`, `tools/compose_smoke.py` | 접속 주소의 `connectionTimeZone=UTC` → `Asia/Seoul` |
| `infra/mysql/initdb/10-posegood-schema.sh` | `schema_V1_1.sql` → `schema_V2_1.sql` |
| 테스트 | `PersistentMySqlTest` 등 V1.1 테이블을 쓰는 검증 |

- API는 테이블을 만들거나 마이그레이션하지 않는다. 시작할 때 테이블·`user_account` 컬럼·시드를 확인하고, 없으면 시작하지 않는다.
- Compose `db`는 **빈 볼륨에서만** `infra/mysql/initdb`가 1장 순서(스키마 → 시드)를 그대로 실행한다. `POSEGOOD_DB_INIT_SCHEMA=false`면 건너뛴다. 이전 버전으로 만든 볼륨은 V2.1로 올리지 않고 지운 뒤 다시 만든다(1장).
- 기본 정책 이름은 API 설정 `posegood.default-policy-name`(기본 `DEFAULT_TEMP`)이다. 확정 정책 `DEFAULT` 행을 넣으면 이 설정만 바꾼다.
- 저장 대응과 남은 한계는 [전환 계획](../docs/plans/active/0021-db-schema-v03-alignment.md)에 둔다.
