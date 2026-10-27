# database — 자세교정 서비스 DB

MySQL 서비스 스키마의 실행 파일(스키마·시드·마이그레이션)과 ERD를 둔다. DB 명세서, 버전별 「DB-V2.x-변경사항」, 설계 문서(DB-01~04)는 저장소 밖 팀 공유 위치에 있다. 자료별 식별 정보와 문의 대상은 [외부 문서 참조](#외부-문서-참조)를 확인한다.

---

## 1. 적용 순서

빈 MySQL(8.0.16 이상)에 아래 순서대로 적용한다. **순서를 바꾸면 실패한다.**

| 순서 | 파일 | 하는 일 | 앞 단계가 필요한 이유 |
|---|---|---|---|
| 1 | `schema/schema_V2_6.sql` | 데이터베이스 `posture_service`와 테이블 14개 생성 | — |
| 2 | `seed/seed_04_threshold_policy.sql` | 기본 판정 정책 1건 | 테이블이 있어야 한다 |

```bash
# 1) 스키마 (데이터베이스 생성 포함)
mysql -u <계정> -p < database/schema/schema_V2_6.sql

# 2) 시드 — 번호순
for f in database/seed/seed_0*.sql; do mysql -u <계정> -p < "$f"; done
```

새 DB에는 `migrations/`를 적용하지 않는다 (7장).

**적용 후 확인** — 테이블 14개, `threshold_policy` 1행이면 정상이다.

**V2.5로 만든 DB** — 지우지 않고 migration 016을 적용하면 V2.6과 같아진다. 로그인 유지 토큰 테이블 `refresh_token`이 생기고 기존 행은 그대로다. 로그인 방식이 바뀌어(ADR 0031) 적용 뒤 모든 사용자는 다시 로그인한다. 되돌리기는 파일 머리말에 있다.

```bash
mysql -u <계정> -p posture_service < database/migrations/016_create_refresh_token.sql
```

**V2.4로 만든 DB** — 지우지 않고 migration 015를 적용하면 V2.5와 같아지고, 이어서 016을 적용한다. 기준 자세에 등록 식별자 `client_registration_uuid`가 생기고, 기존 행은 `UUID()`로 채운다. UK-14(사용자, 등록 시각)는 UK-16(사용자, 등록 식별자)으로 바뀐다(ADR 0028). **새 API는 015를 적용하지 않은 DB에서 시작하지 않는다.**

```bash
mysql -u <계정> -p posture_service < database/migrations/015_alter_baseline_posture_registration.sql
# 이어서 016
```

**V2.3으로 만든 DB** — migration 013·014를 번호순으로 적용하면 V2.4가 되고, 이어서 015·016을 적용한다. 013에서 `feature_archive.row_count` 값만 사라지고(쓰는 코드·요구사항이 없다) 014는 설명만 바꾼다. 되돌리는 방법은 각 파일 머리말에 있다.

```bash
mysql -u <계정> -p posture_service < database/migrations/013_alter_feature_archive.sql
mysql -u <계정> -p posture_service < database/migrations/014_update_comment_v24.sql
# 이어서 015~016
```

**V2.2로 만든 DB** — migration 011~016을 번호순으로 적용한다. 011·012를 먼저 적용하고 이어서 위 013~016을 적용한다. 새 컬럼 `daily_stat.min_until_collapse_sec`·`max_until_collapse_sec`는 NULL로 시작한다(Spark J2가 일별 집계 때 채운다 — J2는 구현 전, 11장).

```bash
mysql -u <계정> -p posture_service < database/migrations/011_add_until_collapse_daily_stat.sql
mysql -u <계정> -p posture_service < database/migrations/012_create_user_consent.sql
# 이어서 013~016
```

**적용 후 확인 (V2.2·V2.3·V2.4·V2.5 → V2.6)** — 테이블 14개(`user_consent`·`refresh_token` 포함, `refresh_token` 컬럼 7개), `daily_stat` 컬럼 10개, `feature_archive` 컬럼 7개(`row_count` 없음), `baseline_posture` 컬럼 22개(`client_registration_uuid` 포함)이고 인덱스 `ux_baseline_posture_registered`(UK-14)가 없으면 정상이다.

**V2.1·V2.0·V1.x로 만든 DB** — migration으로 올리지 않는다. V2.0·V2.1은 테이블을 지운 변경이고(작업규칙 1.4), V2.2는 기준 자세 PK와 세션의 기준 자세 참조가 바뀌어 기존 세션을 새 구조로 옮길 수 없다. 필요한 데이터를 먼저 백업하고, `posture_service` 데이터베이스를 지운 뒤 1번부터 다시 만든다.

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
| 스키마 파일 | `schema/schema_V2_6.sql` (현재, 새 DB용). `schema/schema_V2_3.sql`·`schema_V2_4.sql`·`schema_V2_5.sql`은 이전 버전으로 남겨 둔다(V2.3은 FE 시험 `consents.test.ts`가 읽는다). `schema/schema_V2_2.sql`은 `migrations/`(011~)의 출발점으로 둔다 |
| 대응 명세서 | DB 명세서 V2.6 (2026-10-27) — V2.5 + 로그인 유지 토큰 T-51 `refresh_token` ([ADR 0031](../docs/decisions/0031-jwt-access-refresh-login.md)). V2.5는 V2.4 + 기준 자세 등록 시각을 서버 시각으로, 재전송은 등록 식별자로 구분 ([ADR 0028](../docs/decisions/0028-server-time-for-baseline-registration.md), 「DB-V2.5-변경사항」). V2.4는 V2.3 + 아키텍처 v5.2 결정 반영: `feature_archive.row_count` 삭제, 설명 갱신 (「DB-V2.4-변경사항」). V2.3은 V2.2 + 붕괴까지 걸린 시간 최소·최대, 사용자 동의 (「DB-V2.3-변경사항」). V2.2는 V2.1 + 컬럼 정리·기준 자세 이력 보존 (「DB-V2.2-변경사항」). V2.1은 V2.0 초안 + 추가 수정 (「V2.0 추가 수정사항 정리」 V1.1). CR-04 승인자·회의록 기재 전, 문서(REQ-01, DB-01~04) 반영 전 |
| 데이터베이스 이름 | `posture_service` (가칭, DB-03 D-33) |
| DBMS | MySQL 8.0.16 이상 (CHECK 제약 강제) |
| 문자셋 | `utf8mb4` / `utf8mb4_0900_ai_ci`. 세션 폴더 경로(`feature_archive.file_uri`)만 `utf8mb4_bin`(대소문자 구분) |
| 시간대 | `SPRING_SESSION`(V2.6부터 안 씀)을 뺀 모든 `DATETIME(3)`은 **KST(한국 표준시, +09:00)**로 저장한다. 일별 통계의 날짜 기준(`STAT_TIMEZONE`)도 `Asia/Seoul` (CR-04) |

**스키마 파일 번호** — 명세서 버전과 같아야 한다(작업규칙 1.7). V2.0·V2.1은 테이블을 지운 변경이라, V2.2는 기존 데이터를 옮길 수 없는 변경이라 migration 없이 DB를 새로 만든다(작업규칙 1.4). 이전 스키마 파일(V1.x, V2.0, V2.1)과 migration 001~010은 V2.2 스키마에 흡수하고 지웠다(git 이력에 남음). V2.3은 컬럼·테이블을 더하기만 한 변경이라 운영 중인 DB용 `migrations/` 011·012와 새 DB용 `schema_V2_3.sql`에 함께 반영했고, 두 방법의 결과가 같은지 확인한다(8장). 이후 변경도 같은 방식으로 한다. V2.4는 쓰는 곳이 없는 컬럼 1개(`row_count`)를 지우고 설명을 바꾼 변경이다. 지우는 값은 사라져도 되므로(「DB-V2.4-변경사항」 결정 4) DB를 새로 만들지 않고 migration 013·014로 올린다. V2.5는 컬럼·UK·CHECK를 더하고 UK-14를 바꾼 변경이라 기존 행을 그대로 두고 migration 015로 올린다.

**스키마 파일은 명세서에서 생성했다.** SQL을 직접 고치지 말고, 명세서를 고친 뒤 다시 만든다. 직접 고치면 명세서와 스키마가 어긋난다. `schema_V2_4.sql`은 「DB-V2.4-변경사항」으로 V2.3에서, `schema_V2_5.sql`은 ADR 0028로 V2.4에서, `schema_V2_6.sql`은 ADR 0031로 V2.5에서 만들었다. 명세서 V2.4~V2.6을 고친 뒤 명세서에서 다시 생성해 맞춘다.

### 외부 문서 참조

| 자료 | 식별 정보 | 접근 안내·문의 대상 |
|---|---|---|
| DB 명세서·버전별 변경사항 | 위 "대응 명세서" 행의 판본·문서명 | 저장소 밖 팀 공유 자료. 공유 주소는 미기재이며 DB 담당에 문의 |
| DB-01~04·REQ-01·작업규칙 | 본문의 문서 ID와 절·규칙 번호. 개별 판본이 적히지 않은 인용은 원문 판본 미확인 | DB 담당에 해당 원문과 인용 절 확인. 요구사항 공유 위치는 [문서 이동 안내](../docs/removed-docs.md#3-feklaod-tech-이-pr-작성자가-만든-문서-9개) 참고 |
| DB-05 인덱스 시트 | 5장에 인용한 시트명. 개별 판본·갱신일 미기재 | 공유 주소 미기재. DB 담당에 원문 위치 문의 |

저장소 안에서 실행 구조는 [스키마 파일](schema/), [마이그레이션](migrations/), [ERD](erd/)로 확인한다. 외부 원문과 별개인 로컬 산출물이며, 외부 공유 주소를 확인한 항목은 위 표에 추가한다.

---

## 3. 폴더 구성

```
database/
├── README.md                          ← 이 문서
├── .gitignore                         ← 커밋 금지 대상 (4장)
├── schema/
│   ├── schema_V2_2.sql                ← migrations의 출발점 (DB CI 기준 스키마)
│   ├── schema_V2_3.sql                ← 이전 버전 (FE 시험이 읽는다)
│   ├── schema_V2_4.sql                ← 이전 버전
│   ├── schema_V2_5.sql                ← 이전 버전
│   └── schema_V2_6.sql                ← 현재. 새 DB는 이 파일로 만든다
├── seed/
│   └── seed_04_threshold_policy.sql   ← 기본 판정 정책 (6장)
├── migrations/                        ← V2.2 → V2.3 → V2.4 → V2.5 → V2.6. 다음 번호 017 (7장)
│   ├── 011_add_until_collapse_daily_stat.sql
│   ├── 012_create_user_consent.sql
│   ├── 013_alter_feature_archive.sql
│   ├── 014_update_comment_v24.sql
│   ├── 015_alter_baseline_posture_registration.sql
│   └── 016_create_refresh_token.sql
├── tests/
│   └── integrity_check.py             ← 무결성 검사 (8장)
└── erd/                               ← 아직 V2.3 (V2.4~V2.6 반영 전 — `feature_archive.row_count` 삭제, `baseline_posture.client_registration_uuid`·`refresh_token` 추가 필요)
    ├── posture_erd_V2_3.drawio        ← 원본 (개념·논리 2페이지)
    ├── posture_erd_V2_3-개념 ERD.png   ← draw.io에서 내보낸 그림
    └── posture_erd_V2_3-논리 ERD.png
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

**14개 테이블, 106개 컬럼.** V2.0(16개)에서 V2.1 추가 수정으로 4개를 지웠고, V2.2에서 컬럼 13개를 지우고 2개를 더했다(12개 테이블, 92개 컬럼). V2.3에서 `daily_stat` 컬럼 2개를 더하고 `user_consent`(5개 컬럼)를 새로 설계해 넣었다(99개 컬럼). V2.4에서 `feature_archive.row_count`를 지웠고(98개), V2.5에서 `baseline_posture.client_registration_uuid`를 더했다(99개). V2.6에서 `refresh_token`(7개 컬럼)을 더했다. 키와 제약은 아래와 같다.

| 구분 | 수 | 비고 |
|---|---|---|
| PK | 14 | `baseline_posture`는 `baseline_posture_id`(대리키), `correction_alert`는 (`monitor_session_id`, `event_seq`, `attempted_at`) |
| UK | 8 | UK-01·03·05·06·13·15·16·17. UK-13은 `SPRING_SESSION.SESSION_ID`. UK-16(사용자, 등록 식별자)이 V2.5에서 UK-14(사용자, 등록 시각)를 대신한다. UK-17은 `refresh_token.token_hash`(V2.6) |
| FK | 14 | 삭제 동작은 DB-04 1-1절. FK-27은 세션 → 기준 자세 (사용자 일치 복합 FK), FK-19는 동의 → 계정 (CASCADE), FK-28은 로그인 유지 토큰 → 계정 (CASCADE, V2.6) |
| CHECK | 55 | 허용값, 범위(관절 좌표 18개 포함), 행 간 규칙 (세션 종료, 이벤트 회복, 삭제 요청 등) |

**V2.6에서 바꾼 것** ([ADR 0031](../docs/decisions/0031-jwt-access-refresh-login.md), migration 016)

| 대상 | 내용 |
|---|---|
| T-51 `refresh_token`, UK-17(토큰 해시), FK-28(→ `user_account`, CASCADE), CHECK 4개 | 추가. 로그인 유지 토큰(refresh, 14일)의 SHA-256과 교체·철회 시각. 원문은 앱의 HttpOnly 쿠키에만 있다. access 토큰(JWT, 30분)은 저장하지 않는다 |
| `SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES` | API가 더 쓰지 않는다. 테이블은 남겨 둔다(정리는 나중에) |

**V2.5에서 바꾼 것** ([ADR 0028](../docs/decisions/0028-server-time-for-baseline-registration.md), migration 015)

| 대상 | 내용 |
|---|---|
| `baseline_posture.client_registration_uuid`, UK-16, CHECK `ck_baseline_posture_client_registration_uuid` | 추가. 앱이 등록마다 발급하는 UUID로 재전송 중복을 막는다(WebSocket 등록은 서버가 발급). 기존 행은 `UUID()`로 채운다 |
| UK-14 `ux_baseline_posture_registered` (사용자, 등록 시각) | 삭제. FK-04(사용자) 인덱스 역할은 UK-16이 이어받는다 |
| `baseline_posture.registered_at` 설명 | 서버가 등록을 받은 시각. 앱은 시각을 보내지 않는다 |

**V2.4에서 바꾼 것** (「DB-V2.4-변경사항」, migration 013·014)

| 대상 | 내용 |
|---|---|
| `feature_archive.row_count`, CHECK `ck_feature_archive_row_count` | 삭제 (013). 쓰는 코드·요구사항이 없다 |
| `feature_archive` 설명 | 세션 폴더 1행 기준으로 (013). 경로 `/data/users/{user_account_id}/{세션 시작일(KST)}/{client_session_uuid}/`, 폴더 하나에 파일 3개. Spark J1이 기록하고 J3가 지운다 |
| `user_account.account_status`·`sound_alert_enabled` 설명 | 탈퇴 철회 없음, 알림 켜기·끄기 원본 (014) |
| `monitor_session.good_sec`, `daily_stat` 시간 값 설명 | 0.1초 아래 버림을 세션(최소·최대는 표본)마다 하고 합계는 다시 버리지 않는다. `daily_stat`은 Spark J2만 쓴다 (014) |
| `deletion_request.request_status` 설명 | 입출구 서버는 `REQUESTED`만 넣고 상태는 J3만 바꾼다 (014). 구조(`request_scope`·`DONE`·`data_deleted_at`)는 그대로 — 다음 버전에서 정한다 |

**V2.3에서 더한 것** (「DB-V2.3-변경사항」, migration 011·012)

| 대상 | 내용 |
|---|---|
| `daily_stat.min_until_collapse_sec`·`max_until_collapse_sec` | 추가 (011). 바른 자세에서 붕괴까지 걸린 시간의 하루 최소·최대 (9장 「붕괴까지 걸린 시간」) |
| T-41 `user_consent`, FK-19 | 추가 (012). 보류였던 테이블을 FE 동의 제안서(2026-10-13)로 다시 설계했다. 동의 6종(이용약관·회원 정보·선택 정보·관절 좌표·측정 기록·만 14세 이상)을 항목별로, 동의할 때마다 1행. 학습용 동의는 두지 않는다. PK (`user_account_id`, `consent_type`, `agreed_at`) — 예전 대리키와 UK-08은 없앴다 |

**V2.2에서 바꾼 것** (「DB-V2.2-변경사항」)

| 대상 | 내용 |
|---|---|
| `threshold_policy.policy_name`·`created_by`·`notify_max_per_hour`, UK-12 | 삭제. 기본 정책은 백엔드 설정의 값 4개로 UK-03에서 찾는다. 시간당 알림 상한은 두지 않고 재알림 간격으로만 제한한다 |
| `baseline_posture` | 다시 촬영할 때마다 **새 행**을 넣는다. PK를 `baseline_posture_id`(대리키)로 바꾸고 `calibration_uuid`(UK-04)·`calibration_sec`·`sample_count`를 지웠다. 사용자별로 `baseline_posture_id`가 가장 큰 행이 현재 기준. 재전송 중복은 UK-14(사용자, 등록 시각)가 막는다(V2.5에서 UK-16(사용자, 등록 식별자)으로 바뀜) |
| `monitor_session.calibration_uuid` → `baseline_posture_id` | 값 복사 대신 FK-27로 기준 자세를 가리킨다. 세션이 쓴 기준 자세는 지울 수 없다 |
| `monitor_session.end_reason` | 삭제. 종료 방식(사용자 종료·연결 끊김·오류)은 구분하지 않는다 |
| `excluded_interval.exclusion_reason` | 유지. 우선순위를 자리 비움 → 일시정지 → 입력 누락 → 판정 불가로 바꿨다 (BR-52) |
| `collapse_event.end_reason` | 삭제. 종료 사유는 시각으로 판정한다 — `recovered_at` 있음: 회복 / 세션 `ended_at`과 같음: 세션 종료 / 그 밖: 제외 구간 중단 |
| `correction_alert.correction_alert_id`·`attempt_seq`·`delivered`·`suppress_reason`, UK-07 | 삭제. 알림이 꺼져도 알림 시점을 기록하고, 표시 여부는 세션의 `alert_enabled`로 판단한다. PK는 (`monitor_session_id`, `event_seq`, `attempted_at`) |
| `collapse_type` | 보류 테이블을 명세에서도 뺐다 |

**V2.1에서 지운 것 (V2.0 추가 수정)**

| 대상 | 이유 |
|---|---|
| T-31 `baseline_feature`, T-27 `feature_def`, FK-03·05·06 | 기준 자세에 특징값 대신 **관절 좌표 18개**(코·눈·귀·입 양끝·어깨의 x·y)를 저장한다. 특징값은 판정할 때 좌표에서 계산한다 |
| T-28 `safety_range` | 행이 없었다. 안전 범위 검사는 하지 않는다 (2026-10-10 결정) |
| `baseline_posture.deactivated_at`·`feature_version`·`normalization_scale`·`target_center_x`·`target_center_y`·`target_area_ratio`, UK-10·UK-11 | 정규화 상수와 대상 위치·크기는 좌표에서 계산한다 |
| `monitor_session.frame_width`·`frame_height` | 지정된 카메라 한 대를 같은 해상도(`CAPTURE_RESOLUTION`)로 쓴다 |
| T-50 `client_record`, FK-26 | 기록 화면 응답을 정규화 테이블(`monitor_session`·`collapse_event`·`correction_alert`·`threshold_policy`)로 만든다 |
| `user_account.auth_epoch` | 로그인 끊기는 그 사용자의 `SPRING_SESSION` 행을 지워서 한다 (9장) |

**V2.0에서 지운 것 (CR-04)**

| 대상 | 이유 |
|---|---|
| T-26 `capture_device`, `monitor_session.capture_device_id` | 장치 정보를 저장하지 않는다 |
| T-32 `model_version`, `monitor_session.model_version_code` | 서비스 DB에는 모델 버전 관리 테이블·세션별 버전 칼럼을 두지 않는다 (팀 회의). 개발·연동·연구의 내부 관리는 별도이며 서비스 화면에는 표시하지 않는다([내부 관리 기준](../contracts/README.md#모델명특징-버전의-내부-관리)) |
| T-42 `deployment`, T-43 `error_log` | 배포는 이미지 태그·CI 기록으로, 오류는 애플리케이션 로그로 남긴다 |
| T-44 `input_result`, T-45 `cep_outbox`, T-46 `confirmed_snapshot`, T-47 `cep_cleanup` | CEP를 쓰지 않는다. 붕괴 확정·회복·재알림 판정은 백엔드가 맡는다 |
| `ck_user_account_identity` | 식별 컬럼 3개(`login_email`, `password_hash`, `display_name`)를 다시 NOT NULL로 했다. 탈퇴 때 비우지 않고 행째 지운다 (9장) |

**외부 라이브러리 테이블** — `SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES`는 Spring Session JDBC 표준 정의를 그대로 쓴다. **V2.6부터 API가 쓰지 않는다**(로그인은 `refresh_token`, ADR 0031). 대문자 이름과 `BIGINT`(밀리초) 시각은 이름 규칙 예외다(건의안 0001 #5).

**보류 — 명세에서 뺀 것** — 팀 결정이 나면 명세서에 다시 넣고 다음 버전 스키마와 `migrations/`에 반영한다.

| 항목 | 이유 |
|---|---|
| T-36 `collapse_type`, `collapse_event.collapse_type_code`, FK-15 | 붕괴 유형 코드 체계(3·2·7종) 미결 |

**인덱스** — 보조 인덱스는 넣지 않았다. 인덱스는 DB-05에서 쿼리 목록을 먼저 만든 뒤 설계하고, 테이블 생성과 다른 파일로 둔다(작업규칙 4.7). 판정 정책 검색(설정 저장·기본 정책 조회)은 UK-03이, 사용자의 현재 기준 자세 조회는 UK-16(V2.4까지는 UK-14)이 인덱스를 겸하므로 따로 만들지 않는다.

다만 InnoDB는 FK 컬럼에 쓸 인덱스가 없으면 **자동으로 만든다.** 지금 자동 생성되는 인덱스는 5개다. DB-05 인덱스 시트에서 이 5개를 포함해 정리하고, `SPRING_SESSION`의 보조 인덱스 2개(`EXPIRY_TIME`, `PRINCIPAL_NAME`)도 이때 둔다.

| 테이블 | 자동 생성 인덱스 (FK 이름과 같음) | 컬럼 |
|---|---|---|
| `user_account` | `fk_user_account_threshold_policy` | threshold_policy_id |
| `monitor_session` | `fk_monitor_session_user_account` | user_account_id |
| `monitor_session` | `fk_monitor_session_threshold_policy` | threshold_policy_id |
| `monitor_session` | `fk_monitor_session_baseline_posture` | baseline_posture_id, user_account_id |
| `feature_archive` | `fk_feature_archive_monitor_session` | monitor_session_id |

---

## 6. 시드 내용

시드는 시스템이 처음부터 갖고 있어야 하는 마스터 데이터다. 사용자 데이터는 넣지 않는다. `seed_03_model_version.sql`은 V2.0에서, `seed_01_feature_def.sql`·`seed_02_safety_range.sql`은 V2.1에서 지웠다(테이블 삭제). 번호는 다시 쓰지 않으므로 새 시드는 `seed_05`부터 매긴다.

| 파일 | 내용 | 없으면 | 상태 |
|---|---|---|---|
| `seed_04_threshold_policy.sql` | 기본 판정 정책 1건 (값 4개) | 개발·시험 DB에서 첫 가입 때 백엔드가 같은 값으로 새로 넣는다 | threshold만 **확정**(0.700), 나머지 3개는 **임시값** |

**기본 판정 정책의 값** — 백엔드 설정의 기본값 4개와 같아야 한다. 백엔드는 이 값으로 UK-03에서 행을 찾는다.

| 컬럼 | 값 | 근거 | 결정 주체 |
|---|---|---|---|
| `threshold` | 0.700 | **확정 (2026-10-10)** — 화면 자세 점수 30점. FE 기본값·「보통」 민감도·서버 판정과 같음 | 모델 |
| `hold_seconds` | 3.0 | 임시 — REQ 10장 #4 초기값 3초 | 모델 + PM |
| `recover_seconds` | 3.0 | 임시 — FE 설정 범위(1~10초) 안. 2026-10-06 2.0→3.0 (ADR 0020 개정, #16) | 모델 + PM |
| `realert_seconds` | 60 | 임시 — FE 설정 범위(15~180초) 안. 2026-10-06 30→60 (#16) | PM + FE |

**값이 확정되면 이 행을 고치지 않는다.** 판정 정책은 한 번 기록하면 바꾸지 않는다(BR-65). 그 사이 세션이 이 행을 가리키고 있을 수 있다. 확정값은 새 값 조합으로 새 행을 넣고, 백엔드 설정의 기본값 4개만 바꾼다. (V2.0·V2.2에서 행을 직접 고친 것은 모든 DB를 새로 만드는 변경이라서다.)

---

## 7. 마이그레이션 규칙 (작업규칙 4.7)

- 파일명은 `<3자리>_<동작>_<대상>.sql`이고, 번호 순서대로 적용한다.
- **이미 적용된 파일은 수정하지 않는다.** 변경은 새 번호 파일로 추가한다.
- 한 파일은 한 목적만 담는다.
- 인덱스는 테이블 생성과 다른 파일에 둔다. 초기 적재 때 인덱스 없이 넣기 위해서다.
- migration과 시드 파일은 `SET NAMES utf8mb4;`로 시작한다. 빠지면 접속 문자셋에 따라 한글이 깨진 채 저장된다.
- 새 DB는 최신 스키마 파일로 만들고, `migrations/`는 이미 만든 DB를 올릴 때만 적용한다.
- 테이블을 지우거나 기존 데이터를 옮길 수 없는 변경은 migration을 만들지 않고 DB를 새로 만든다(작업규칙 1.4). V2.0 → V2.1, V2.1 → V2.2가 이 경우다. V2.4의 컬럼 삭제(`row_count`)는 값이 사라져도 되는 컬럼이라 migration으로 한다(2장).
- 파일마다 머리말에 되돌리는 방법(롤백 SQL)을 적는다.
- V1.0 → V1.1용 001~010은 V2.0 스키마에 흡수했다. 번호는 다시 쓰지 않으므로 **다음 파일은 016**부터 매긴다.

| 파일 | 버전 | 내용 | 기존 데이터 |
|---|---|---|---|
| `011_add_until_collapse_daily_stat.sql` | V2.2 → V2.3 | `daily_stat`에 `min_until_collapse_sec`·`max_until_collapse_sec`와 CHECK 3개 추가 | 그대로. 새 컬럼은 NULL |
| `012_create_user_consent.sql` | V2.2 → V2.3 | `user_consent` 테이블 생성 (FK-19, CHECK 2개) | 영향 없음. 이미 가입한 사용자의 동의 행은 비어 있다(언제 받을지는 백엔드가 정한다) |
| `013_alter_feature_archive.sql` | V2.3 → V2.4 | `feature_archive.row_count`와 CHECK 삭제, 세션 폴더 기준 설명 | 행은 그대로. `row_count` 값은 사라지고 되돌려도 0이 된다 |
| `014_update_comment_v24.sql` | V2.3 → V2.4 | `user_account`·`monitor_session`·`daily_stat`·`deletion_request` 설명만 | 영향 없음 |
| `015_alter_baseline_posture_registration.sql` | V2.4 → V2.5 | `baseline_posture.client_registration_uuid`·UK-16·CHECK 추가, UK-14 삭제, `registered_at` 설명 | 행은 그대로. 기존 행의 등록 식별자는 `UUID()`로 채운다. 되돌릴 때 같은 사용자·같은 등록 시각 행이 있으면 UK-14를 다시 만들지 못한다 |
| `016_create_refresh_token.sql` | V2.5 → V2.6 | T-51 `refresh_token`·UK-17·FK-28·CHECK 4개 추가 | 행은 그대로. 남아 있는 `SPRING_SESSION` 로그인은 의미가 없어져 모든 사용자가 다시 로그인한다. 되돌리기는 `DROP TABLE refresh_token` |

---

## 8. 재현 검증 (작업규칙 4.7)

| 단계 | 내용 | 2026-10-13 결과 (MySQL 8.0.46, V2.3) |
|---|---|---|
| 1 | 빈 DB에 스키마 적용 → 오류 0 | 통과 (경고 0) |
| 2 | 시드 적용 → 오류 0 | 통과 |
| 3 | 애플리케이션 기동 → 연결·기본 조회 성공 | **백엔드 연결 후 확인** — 대신 아래 무결성 검사로 기본 쓰기·조회를 확인 |
| 4 | 롤백(데이터베이스 삭제 후 재적용) 1회 성공 | 통과 |

**V2.4~V2.6은 아직 재현 검증 전이다.** 위 표와 아래 개수는 V2.3 결과다. V2.4~V2.6 스키마, migration 013~016, 고친 무결성 검사는 실행하지 않았다(2026-10-21, 2026-10-26, 2026-10-27). DB CI 또는 로컬 MySQL로 확인한 뒤 이 장을 갱신한다.

**DB CI** (`.github/workflows/db-ci.yml`) — 최신 스키마(지금 `schema_V2_6.sql`, 파일 이름순으로 가장 뒤의 파일) + 시드로 만든 DB와, 기준 스키마(`schema_V2_2.sql`) + 시드 + `migrations/` 전부(011~016)로 만든 DB의 구조·마스터 데이터를 비교한다. 설명(COMMENT)도 비교 대상이다. 두 결과가 같아야 한다(V2.3: 2026-10-13 로컬 재현 350줄 일치). 테이블 수(13)와 `threshold_policy` 행 수(1)는 1장 「적용 후 확인」 값과 같다. 데이터가 든 V2.2 DB에 011·012를 적용해도 기존 행이 그대로임을 함께 확인했다.

**무결성 검사 (`tests/integrity_check.py`) — V2.3 기준 130개 항목 모두 통과(2026-10-13).** V2.4에 맞춰 철회 검사(S1-1-1)를 지우고 `row_count`를 뺐으며 적재 경로를 세션 폴더 형식으로 바꿨다. V2.5에 맞춰 기준 자세 재전송 검사를 UK-16(등록 식별자)으로 바꾸고, 같은 등록 시각 허용·식별자 길이·UK-14 없음 검사를 더했다 — 실행 전이라 새 개수는 아직 모른다. 테스트 계정(`test-*@example.invalid`)과 합성 좌표값으로 확인하고 행을 모두 지운다. DB CI가 새 DB에서 실행한다.

| 분류 | 확인한 것 |
|---|---|
| 키 | 같은 이메일 재가입 거부(대소문자 무시), 같은 등록 재전송 거부(UK-16, 같은 등록 식별자), 같은 클라이언트 세션 식별자·로그인 세션 식별자 재전송 거부, 같은 알림 재전송 거부(PK), 같은 값 조합 정책 중복 거부(UK-03), 없는 사용자의 기준 자세·없는 이벤트의 알림 거부(FK-04·16) |
| 식별 컬럼 (CR-04) | `login_email`·`password_hash`·`display_name` NULL 거부 |
| 기본 정책 | 가입 때 값 4개로 기본 정책을 찾아 연결 |
| 기준 자세 | 좌표 0~1 범위 밖 거부 |
| 기준 자세 다시 촬영 | 새 행이 생기고 예전 행이 남음. 현재 기준은 가장 큰 ID — 시계가 늦은 기기에서 촬영해도 나중에 저장한 행이 현재 기준. 예전 세션은 예전 기준을, 새 세션은 새 기준을 가리킴. 세션이 쓴 기준 자세는 삭제·ID 변경 거부(FK-27). 다른 사용자의 기준 자세로 세션 시작 거부(FK-27) |
| 세션 | 시작 때 현재 기준·정책·`sound_alert_enabled` → `alert_enabled` 복사. 종료 시각만 있고 바른 자세 시간이 없으면 거부 |
| 이벤트·알림 | 종료 시각 없는 회복 시각, 종료 뒤·확정 전 회복 시각 거부. 종료 사유를 시각으로 판정(회복·세션 종료·제외 구간 중단). 첫 알림 = 가장 이른 알림 시각 |
| 행 간 규칙·허용값 | 분자 > 분모 통계, 붕괴까지 걸린 시간의 최소 > 최대·한쪽만 있음·음수, 0.5 단위 위반, 제외 구간 종료 < 시작, 없는 제외 사유·사유 NULL, 나이 범위(1~120) — 모두 거부 (제외 사유 4개는 허용) |
| 삭제 차단 | 적재 기록이 남은 세션, 세션이 남은 사용자, 사용 중인 정책, 삭제 요청 행이 남은 사용자 — 모두 삭제 거부 |
| 시나리오 1 (탈퇴, DB-04 V0.2 6-1) | 접수하면 계정 CLOSED와 함께 그 사용자의 로그인 세션·속성이 지워지고 다른 사용자의 로그인 세션은 그대로. 유예 중에는 식별 정보·기록이 그대로이고 같은 이메일 재가입은 거부(철회 없음). 유예 종료 대상은 폐쇄 시각 + 30일로 계산. 최종 삭제는 한 트랜잭션에서 성공하고(세션 → 기준 자세 순) 제외 구간·이벤트·알림이 연쇄 삭제. 삭제 뒤 같은 이메일로 재가입 가능. 중간에 실패하면 전부 되돌아감 |
| 시나리오 2 (기록 삭제) | 세션을 지워도 일별 통계는 그대로. 세션을 지운 뒤 현재 기준만 남기고 예전 기준 자세 삭제(D-39) |
| 세션 없는 계정 삭제 | 기준 자세·일별 통계 연쇄 삭제 (FK-04·17) |
| 로그인 세션 | 로그인 세션 삭제 시 속성 연쇄 삭제 |
| 사용자 동의 | 가입 동의 6행 저장, 같은 동의 재전송·없는 종류(학습용)·없는 사용자·동의 전 철회 시각 거부. 선택 정보 철회 때 나이·직업 비움. 약관 개정 재동의는 새 행, 현재 상태는 가장 최근 행. 탈퇴 최종 삭제 때 함께 삭제, 기록만 삭제할 때는 남음 |
| 폐기 확인 | 폐기·보류 테이블 5개와 V2.1·V2.2·V2.4 폐기 컬럼 21개(V2.4 `row_count` 포함)가 DB에 없고, V2.2·V2.3·V2.5 추가 컬럼 5개(V2.5 `client_registration_uuid` 포함)가 있고 UK-14 인덱스가 없음 |

---

## 9. 백엔드 구현 시 주의

| 상황 | 해야 할 것 | 근거 |
|---|---|---|
| 모든 시각 | KST로 저장한다. 연결할 때 세션 시간대를 `Asia/Seoul`로 둔다 (`connectionTimeZone=Asia/Seoul`) | CR-04 |
| 가입 | 기본 정책을 설정에 둔 값 4개(threshold·hold·recover·realert)로 찾는다. 없으면 같은 값으로 새로 넣고(중복 오류 1062가 나면 다시 찾음) 사용자가 그 행을 가리키게 한다. 값은 6장 시드와 같아야 한다 | UK-03 |
| 비밀번호 | 백엔드에서 단방향 해시로 만들어 `password_hash`에 넣는다. 평문은 저장하지도 응답하지도 않는다 | SER-004 |
| 로그인 | `account_status`가 ACTIVE인 계정만 통과시킨다. 탈퇴를 접수한 계정(CLOSED)은 유예 중에도 이메일·비밀번호 해시가 남아 있지만, 비밀번호가 맞아도 막는다(403 `ACCOUNT_CLOSED` — 되돌릴 수 없고 30일 뒤 삭제된다고 안내) | D-34, 탈퇴 철회 없음 (2026-10-15) |
| 로그인 끊기의 전제 | 로그인 수단은 Spring Session뿐이다(remember-me 쿠키·JWT 같은 세션 밖 인증을 쓰지 않는다). `PRINCIPAL_NAME`은 항상 채운다. 이메일 변경 기능을 넣으면 변경 때 예전 세션도 정리한다 | V2.1 (`auth_epoch` 삭제) |
| 기준 자세 등록·다시 촬영 | 촬영할 때마다 **새 행을 INSERT**한다(UPDATE하지 않는다). 촬영이 완료됐을 때만 넣고, 취소·실패하면 넣지 않는다. `registered_at`은 **서버가 등록을 받은 시각**이다(앱은 시각을 보내지 않는다, ADR 0028). **REST `POST /v2/baselines`(B1)**: 앱이 낸 평균과 `registration_id`(촬영마다 앱이 한 번 만드는 UUID)를 받는다. 표본 20 이상·촬영 3초 이상을 넣기 전에 검사한다. 재전송 때도 같은 `registration_id`가 온다 — 같은 (사용자, 등록 식별자) 행이 있으면 좌표가 같을 때 그 행을, 다를 때 409를 돌려준다(UK-16). **WebSocket `/v2/realtime` 등록(`purpose: calibration`)**: 서버가 판정 가능 프레임 15장 이상으로 평균을 내고 등록 식별자도 서버가 만든다. 재전송이 없다. 앱은 B1만 쓰기로 했다(FE ADR 0021, V3 브랜치) — WebSocket 등록을 남길지는 미결([개발 상태](../docs/backend-status.md) 4장) | BR-63, UK-16, ADR 0028 |
| 기준 자세 좌표 | MediaPipe 정규화 좌표(0~1), 촬영 동안의 평균. 0~1 밖의 값(화면 밖 추정)은 DB가 거부하므로 보정 실패로 처리한다. 좌표 수집 조건(MediaPipe 모델·`CAPTURE_RESOLUTION`·관절 목록)을 바꾸면 모든 사용자가 다시 촬영한다 | ck_baseline_posture_* |
| 안전 범위 검사 | 하지 않는다 (2026-10-10 결정). `safety_range` 테이블도 없다 | V2.1, BR-04 |
| 세션 생성 | 그 사용자의 기준 자세가 없으면 측정을 시작하지 않는다. 시작할 때 현재 기준(그 사용자의 `baseline_posture_id`가 가장 큰 행 — 등록 시각으로 고르지 않는다)의 ID, `user_account.threshold_policy_id`, `user_account.sound_alert_enabled`(→ `alert_enabled`)를 세션에 넣는다. `alert_enabled`는 측정 중에 바꾸지 않는다. 해상도는 저장하지 않는다(프론트엔드가 실제로 받은 해상도가 다르면 시작하지 않는다) | BR-02, BR-64, FK-27 |
| 세션 저장 재전송 | `client_session_uuid` 중복(1062)이면 새 행을 만들지 말고 기존 행을 돌려준다 | BR-62 |
| 세션 종료 | `ended_at`, `good_sec`을 저장 서비스 한 곳에서 한 번에 채운다. 종료 방식은 저장하지 않는다 | ck_monitor_session_end |
| 제외 구간 | 한 시점에 사유 하나만 붙인다. 겹치면 우선순위 **자리 비움(`ABSENCE`) → 일시정지(`PAUSE`) → 입력 누락(`MISSING`) → 판정 불가(`UNMEASURABLE`)**로 고른다. 사유가 바뀌면 새 행으로 나눈다. 구간이 겹치지 않으므로 유효 측정 시간은 세션 길이에서 구간 합을 빼서 구한다 | BR-52, SFR-029 |
| 붕괴 이벤트 종료 | 세션 종료로 끝나면 `ended_at`에 세션 종료 시각을, 제외로 끝나면 제외 구간 시작 시각을 **그대로** 넣는다. 회복으로 끝나면 `recovered_at`도 채운다. 종료 사유는 이 시각으로 판정한다 | SFR-025, ck_collapse_event_recovered |
| 교정 알림 | 알림이 켜져 있든 꺼져 있든 이벤트 확정 때 1회, 이후 `realert_seconds`마다 행을 넣는다. `attempted_at`은 판정기가 메시지에 담은 시각(저장 시각 금지) — 재전송은 PK 중복(1062)으로 막힌다. 표시 여부는 세션 `alert_enabled`로 판단한다. 회복 시간은 첫 알림(가장 이른 시각)부터 잰다 | BR-13, BR-21 |
| 설정 변경 | 같은 값 조합의 정책을 찾고, 없으면 새로 넣는다. 넣다가 중복 오류(1062)가 나면 다시 찾아 그 행을 쓴다. 그다음 사용자가 그 정책을 가리키게 한다. 정책 행은 UPDATE하지 않는다 | BR-64, BR-65, UK-03 |
| 일별 통계 | **Spark J2**가 매일 00:00에 전날(KST) 세션을 사용자별로 집계해 쓴다. 입출구 서버는 읽기만 한다 — 둘 다 쓰면 두 번 더해진다. 세션 시작 시각의 KST 날짜로 집계한다. `alerted_event_count`는 `alert_enabled`가 참인 세션에서 알림 행이 있는 이벤트 수 | BR-61, BR-22, CR-04 |
| 붕괴까지 걸린 시간 (최소·최대) | J2가 함께 계산한다. 실행 시간(`started_at` → `ended_at`)이 5분(`STAT_MIN_SESSION_SEC`) 이상인 세션만 쓴다 — 더 짧은 세션은 시험·잘못 시작한 기록으로 보고 뺀다. 세션마다 구간을 나눈다: 세션 시작 또는 직전 붕괴 이벤트의 `ended_at` → 다음 붕괴의 `started_at`, 마지막 구간은 → 세션 `ended_at`(붕괴 없이 끝난 구간도 표본에 넣는다). 각 구간 길이에서 겹친 제외 구간 시간을 뺀다. 그날 모든 표본의 최솟값·최댓값을 넣고, 표본이 없으면 둘 다 NULL. 주·월 값은 일별 최솟값의 최솟값, 최댓값의 최댓값 | BR-20, BR-53, ck_daily_stat_until_collapse |
| 탈퇴 접수 | 삭제 요청(`REQUESTED`, `account_closed_at`)과 계정 CLOSED를 한 트랜잭션으로 처리하고, 그 사용자의 `refresh_token` 행을 모두 철회한다(`revoked_at`, V2.6). 식별 정보와 기록은 지우지 않는다. **되돌릴 수 없다**(철회 없음) | D-34, DB-04 6-1 |
| 탈퇴 철회 | **하지 않는다** (2026-10-15 결정). 접수한 탈퇴는 되돌릴 수 없다. 30일 유예는 남긴다 — Kafka(3일)·DLQ(7일)·Redis 보존 기간이 모두 30일보다 짧아, 유예 뒤에 지우면 서버 어디에도 데이터가 남지 않는다. `deletion_request` 상태를 바꾸는 쪽은 J3뿐이라 철회·삭제가 겹칠 일이 없다 | 「아키텍처 v5.2 전환 영향」 공지 ① |
| 탈퇴 최종 삭제 | **Spark J3**가 매일 04:00에 처리한다(입출구 서버는 접수만). 유예가 끝났고 상태가 `REQUESTED`(재시도면 `FAILED`)인 요청만 `PROCESSING`으로 바꾼 뒤 시작한다. 대상은 `account_closed_at + WITHDRAWAL_GRACE_DAY(30일) ≤ 현재`로 계산한다(삭제 예정일 컬럼 없음). 사용자 폴더를 먼저 지우고 `deleted_at`을 채운 뒤, 적재 기록 → 세션 → 일별 통계 → 기준 자세 → 삭제 요청 → 계정을 한 트랜잭션으로 지운다(세션이 기준 자세를 막으므로 세션이 먼저). 동의 기록은 계정 삭제에 연쇄된다(FK-19). 완료 안내는 **J3가 직접**, 커밋 뒤에 미리 읽어 둔 연락처로 보낸다. 롤백(`FAILED`)이면 보내지 않고, 발송이 실패해도 삭제는 되돌리지 않으며 로그에는 사용자 ID만 남긴다 | D-34, DB-04 6-1, 아키텍처 v5.2 ⑳ |
| 삭제 배치 공통 | (J3) 파일 먼저, 행은 하위부터, 사용자 한 명 단위 트랜잭션. 실패하면 되돌리고 요청을 FAILED로 둔다. 기록만 삭제할 때는 세션을 지운 뒤 현재 기준을 뺀 예전 기준 자세 행도 지운다 | DB-04 6장, D-39 |
| 비밀번호 변경 | 그 사용자의 `refresh_token` 행을 모두 철회한다(`revoked_at`, V2.6). 열린 실시간 연결도 닫히고, 앱은 다시 로그인한다. 이미 발급된 access 토큰은 만료(최대 30분)까지 남는다 | ADR 0031, `contracts/accounts.v2.md` |
| 가입 동의 | 계정 행과 필수 동의 5행(`TERMS`·`ACCOUNT_INFO`·`POSE_COORDINATES`·`MEASUREMENT_RECORD`·`AGE_14_OVER`)을 한 트랜잭션으로 넣는다. 하나라도 빠지면 가입을 거부한다. 선택 정보(`OPTIONAL_PROFILE`)는 동의했을 때만 넣고, 동의가 없으면 나이·직업을 받지 않는다. 거부는 저장하지 않는다. 만 14세 미만은 가입을 막는다(나이를 입력했는데 14 미만이면 거부 — DB는 검사하지 않는다) | FE 동의 제안서, FK-19 |
| 동의 변경 | 선택 정보 동의를 철회하면 그 행에 `withdrawn_at`을 채우고 `user_account.age`·`occupation`을 같은 트랜잭션에서 비운다. 다시 동의하면 새 행. 약관이 바뀌면 새 `document_version`으로 다시 동의받아 새 행을 넣는다(종류별 가장 최근 행이 현재 상태). 필수 동의 철회는 탈퇴 요청으로 처리하고, 탈퇴 접수 때는 `withdrawn_at`을 채우지 않는다 — 동의 행은 유예가 끝나 계정을 지울 때 함께 지워진다(FK-19) | 동의 제안서 1·4장 |
| 로그인 유지 토큰 | `refresh_token`에는 토큰 원문이 아니라 SHA-256만 넣는다. 쓸 때마다 새 행으로 바꾸고(`rotated_at`), 만료된 지 하루 지난 행은 API가 매일 04:30(KST)에 지운다 | ADR 0031 |

---

## 10. 작업규칙과 다른 점

| CR-ID | 내용 | 상태 |
|---|---|---|
| CR-01 | 시드 목록 변경 — 작업규칙의 `seed_03_posture_state_code`·`seed_05_capture_protocol` 삭제. 이 폴더의 시드는 `seed_04`뿐이다 (`seed_01`·`seed_02`는 V2.1에서 삭제) | 발행 대기 (DB-03 7-2절), 팀장·PM 승인 |
| CR-02 | 실행 폴더 이름 `db/` → `database/` | 작업규칙 V1.2에 반영 |
| CR-03 | 스키마 V1.0 확정과 DB 건의안 0001 반영(V1.1) | V2.0에 통합 (CR-04) |
| CR-04 | V2.0 — 테이블 8개·컬럼 2개 삭제, 식별 컬럼 NOT NULL, 탈퇴 30일 유예 후 삭제, 기본 정책 값 변경, KST 저장. V2.1 — 관절 좌표 저장, 테이블 4개 삭제, `auth_epoch`·세션 해상도 삭제. V2.2 — 컬럼 정리, 기준 자세 이력 보존(V2.1의 덮어쓰기 대체). V2.3 — 붕괴까지 걸린 시간 최소·최대, 사용자 동의. 이 폴더와 명세서 V2.3에 반영했다 | 승인 대기 (팀장·PM 승인 필요). 문서(REQ-01, DB-01~04) 반영 대기 |

저장소의 `database/AGENTS.md`는 이 README와 별개로 그대로 둔다.

---

## 11. 백엔드 코드와의 관계

DB를 쓰는 백엔드는 두 곳이다. 입출구 서버는 **V2.6**, 처리 서비스는 아직 **V2.3** 표기로 확인한다. 둘 다 테이블을 만들거나 고치지 않는다. 스키마와 시드는 1장 절차로만 적용한다.

| 구성 | 위치 | 시작할 때 DB 확인 | 맞지 않으면 |
|---|---|---|---|
| 입출구 서버 (계정·설정·기준 자세·세션·기록) | `backend/api` — `SchemaVerifier` | 테이블 12개(`SPRING_SESSION` 2개는 확인하지 않음, `refresh_token` 포함), V2.0·V2.1에서 지운 테이블 12개가 남아 있지 않은지, 필수 컬럼 13개(기준 자세 ID·좌표·등록 식별자, 세션의 `baseline_posture_id`, `sound_alert_enabled`, 붕괴까지 걸린 시간 최소·최대, `user_consent.document_version`, `correction_alert.attempted_at`, `refresh_token`의 토큰 해시·교체·철회 시각 등), V2.4에서 지운 컬럼(`feature_archive.row_count`)이 남아 있지 않은지 | **시작하지 않는다** — V2.5 DB는 016을, V2.4 DB는 015~016을, V2.3 DB는 013~016을 적용해야 시작한다 |
| 처리 서비스 (판정 결과 저장) | `backend/processing` — `ServiceSchemaVerifier` | 테이블 13개, 지운 테이블, 저장에 쓸 컬럼, V2.3 표시(migration 011·012), 접속 계정의 SELECT·INSERT·UPDATE·DELETE 권한. V2.4 표기·`row_count` 확인은 DevOps 반영 전 | 시작은 한다. 시작 로그와 `GET /store/service-db`로 알린다 |

**설정**

| 항목 | 값 |
|---|---|
| 접속 시간대 | `connectionTimeZone=Asia/Seoul` — `backend/api` `application.properties`, `compose.yaml` |
| 기본 판정 정책 | `posegood.default-policy.threshold`·`hold-seconds`·`recover-seconds`·`realert-seconds` (기본 0.7·3·3·60). 6장 시드와 같아야 한다. 가입 때 이 값으로 UK-03에서 찾고, 없으면 넣는다 |
| Compose `db` | **빈 볼륨에서만** `infra/mysql/initdb/10-posegood-schema.sh`가 `schema_V2_5.sql` → 시드를 실행한다. `POSEGOOD_DB_INIT_SCHEMA=false`면 건너뛴다. V2.1 이하로 만든 볼륨은 지운 뒤 다시 만들고, V2.5로 만든 볼륨은 migration 016을, V2.4는 015~016을, V2.3은 013~016을, V2.2는 011~016을 적용한다(1장). **초기화 스크립트는 아직 `schema_V2_5.sql`을 가리킨다 — V2.6으로 바꾸는 것은 DevOps 몫** |

**아키텍처 v5.2 역할 분담과 구현 상태** — 배치 일은 입출구 서버에서 빠졌고, Spark 배치(`bigdata/jobs/`, 예정)가 맡는다. 실시간 판정 결과 저장은 [계획 0031](../docs/plans/active/0031-realtime-kafka-transition.md)로 처리 서비스에 옮긴다.

| 일 | 담당 | 상태 (2026-10-20) |
|---|---|---|
| 실시간 판정 결과 저장 (`collapse_event`·`correction_alert`·`excluded_interval`·세션 종료 값) | 지금 입출구 서버(API 안 판정) → 계획 0031 2단계 뒤 처리 서비스만 | 입출구 서버가 쓰는 중. 둘이 함께 쓰지 않도록 전환 시점을 맞춘다 |
| 탈퇴 접수 | 입출구 서버 `auth` | 구현됨. 철회 없음 |
| 탈퇴 최종 삭제·완료 안내 | Spark J3 (매일 04:00) | **구현 전.** 입출구 서버의 삭제 스케줄러는 이미 지웠으므로, J3가 생기기 전까지 유예가 끝난 계정이 지워지지 않는다 |
| `daily_stat` 집계 | Spark J2 (매일 00:00) | **구현 전.** 세션 종료 때 누적하던 코드는 이미 지웠으므로, J2가 생기기 전까지 일별 통계가 채워지지 않는다 |
| `feature_archive` 기록 | Spark J1 (매시간) | **구현 전.** 세션 폴더 하나를 1행으로 기록한다(2026-10-15). 경로와 컬럼 설명은 V2.4에 반영했다(5장) |

- 실시간 판정을 Kafka 경로로 옮기는 단계와 남은 한계는 [계획 0031](../docs/plans/active/0031-realtime-kafka-transition.md)에 둔다.
