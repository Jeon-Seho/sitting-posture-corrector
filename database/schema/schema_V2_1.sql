-- =====================================================================
-- 자세교정 서비스 스키마 — schema_V2_1.sql
-- 명세서: DB 명세서 V2.1 (확정 2026-10-09) — V2.0 초안 + 추가 수정 (「V2.0 추가 수정사항 정리」 V1.1)
--   CR-04 승인자·회의록 기재 전. 문서(REQ-01, DB-01~04)의 V2.1 반영은 아직이다.
-- 테이블을 지웠으므로 V2.0 DB를 migration으로 올리지 않는다 (작업규칙 1.4).
--   기존 DB는 지우고 이 파일과 시드로 다시 만든다. migrations/는 비어 있고, 다음 번호는 011이다.
-- DBMS: MySQL 8.0.16 이상 (CHECK 제약 강제)
-- 생성: 2026-10-09 (명세서 원천에서 생성 — 손으로 고치지 말고 명세서를 고친 뒤 다시 생성)
--
-- 범위: 12개 테이블 (명세서 14개 중 보류 2개 제외).
--   제외 — T-36 collapse_type, T-41 user_consent, collapse_event.collapse_type_code, UK-08, FK-15, FK-19
-- 폐기 (V2.1): T-27 feature_def, T-28 safety_range, T-31 baseline_feature, T-50 client_record,
--   user_account.auth_epoch,
--   baseline_posture.baseline_posture_id·deactivated_at·feature_version·normalization_scale·target_center_x·target_center_y·target_area_ratio,
--   monitor_session.baseline_posture_id·frame_width·frame_height, UK-10, UK-11, FK-03, FK-05, FK-06, FK-09, FK-26
-- 폐기 (V2.0, CR-04): T-26 capture_device, T-32 model_version, T-42 deployment, T-43 error_log,
--   T-44 input_result, T-45 cep_outbox, T-46 confirmed_snapshot, T-47 cep_cleanup,
--   monitor_session.capture_device_id·model_version_code
-- 시드: seed_04_threshold_policy.sql만 남는다. seed_01_feature_def·seed_02_safety_range는 지운다 (번호는 다시 쓰지 않음).
-- 기준 자세: 사용자당 1행. 다시 촬영하면 UPDATE하고 calibration_uuid·registered_at·좌표가 바뀐다.
--   측정 시작 때 백엔드가 그 사용자의 calibration_uuid를 monitor_session에 복사한다 (FK 아님, B안).
--   좌표 수집 조건(MediaPipe 모델·CAPTURE_RESOLUTION 640×480·관절 목록)은 고정하고, 바꾸면 전원 다시 촬영한다.
-- 로그인 끊기: 비밀번호 변경·탈퇴 때 그 사용자의 SPRING_SESSION 행을 지운다 (PRINCIPAL_NAME으로 찾음).
-- 외부 라이브러리 테이블: SPRING_SESSION, SPRING_SESSION_ATTRIBUTES — Spring Session JDBC 표준 정의를 그대로 쓴다.
--   대문자 이름과 BIGINT(밀리초) 시각은 이름 규칙 예외 (건의안 0001 #5).
--   서버 DB는 이 파일로 만든다. Windows 로컬 DB의 덤프로 만들면 테이블 이름이 소문자로 바뀐다.
-- 인덱스: 보조 인덱스 없음. DB-05(쿼리 목록 → 인덱스) 후 migrations/에 별도 파일로 둔다.
--   InnoDB는 FK 컬럼에 쓸 인덱스가 없으면 자동으로 만든다 — DB-05 인덱스 시트에서 함께 정리한다.
--   SPRING_SESSION 보조 인덱스(EXPIRY_TIME, PRINCIPAL_NAME)도 이때 둔다.
-- 시각: SPRING_SESSION을 뺀 모든 DATETIME(3)은 KST(한국 표준시, +09:00)로 저장한다 (CR-04).
--   DATETIME은 시간대 정보를 저장하지 않는다. 접속하는 애플리케이션도 세션 시간대를 Asia/Seoul로 맞춘다.
-- 삭제 동작: DB-04 1-1절. 「RESTRICT + 삭제 배치」는 RESTRICT로 두고 배치가 순서대로 지운다.
--   탈퇴는 30일 유예 뒤 한 트랜잭션으로 지운다 (DB-04 V0.2 6-1).
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+09:00';

CREATE DATABASE IF NOT EXISTS posture_service DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE posture_service;

-- ---------------------------------------------------------------------
-- T-29 threshold_policy — 판정 정책 (근거 E-08)
-- ---------------------------------------------------------------------
CREATE TABLE threshold_policy (
  threshold_policy_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '정책 식별자 (자연키가 5컬럼이므로 대리키)',
  threshold DECIMAL(4,3) NOT NULL COMMENT '붕괴 판정 임계 (TH_COLLAPSE). 내부 값으로 저장, 화면 점수로 바꾸지 않음',
  hold_seconds DECIMAL(4,1) NOT NULL COMMENT '붕괴 확정 지속 조건 (MIN_DURATION_SEC)',
  recover_seconds DECIMAL(4,1) NOT NULL COMMENT '회복 확정 유지 조건 (RECOVERY_DURATION_SEC)',
  realert_seconds INT NOT NULL COMMENT '재알림 최소 간격 (RE_ALERT_INTERVAL_SEC)',
  notify_max_per_hour INT NOT NULL COMMENT '시간당 알림 상한 (NOTIFY_MAX_PER_HOUR)',
  policy_name VARCHAR(30) NULL COMMENT '시스템 정책 이름. NULL: 사용자 설정으로 생긴 조합. 이름이 있으면 유일 (기본 정책 조회)',
  created_by VARCHAR(10) NOT NULL COMMENT '정책을 만든 주체',
  created_at DATETIME(3) NOT NULL COMMENT '처음 기록된 시각',
  CONSTRAINT pk_threshold_policy PRIMARY KEY (threshold_policy_id),
  CONSTRAINT ux_threshold_policy_values UNIQUE (threshold, hold_seconds, recover_seconds, realert_seconds, notify_max_per_hour),  -- UK-03 (설정 저장 시 검색 인덱스 겸용)
  CONSTRAINT ux_threshold_policy_name UNIQUE (policy_name),  -- UK-12
  CONSTRAINT ck_threshold_policy_threshold CHECK (threshold BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_threshold_policy_hold_seconds CHECK (hold_seconds > 0 AND MOD(hold_seconds, 0.5) = 0),  -- 허용값: 0 초과, 0.5 단위
  CONSTRAINT ck_threshold_policy_recover_seconds CHECK (recover_seconds > 0 AND MOD(recover_seconds, 0.5) = 0),  -- 허용값: 0 초과, 0.5 단위
  CONSTRAINT ck_threshold_policy_realert_seconds CHECK (realert_seconds >= 1),  -- 허용값: 1 이상
  CONSTRAINT ck_threshold_policy_notify_max_per_hour CHECK (notify_max_per_hour >= 1),  -- 허용값: 1 이상
  CONSTRAINT ck_threshold_policy_created_by CHECK (created_by IN ('SYSTEM', 'USER')),  -- 허용값: SYSTEM / USER
  CONSTRAINT ck_threshold_policy_name CHECK ((created_by = 'SYSTEM' AND policy_name IS NOT NULL) OR (created_by = 'USER' AND policy_name IS NULL))  -- E-08 시스템 정책만 이름을 가진다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-29 판정 정책 — 판정 파라미터 값 조합. 기록 후 변경 금지';

-- ---------------------------------------------------------------------
-- T-25 user_account — 사용자 계정 (근거 E-01, E-02 (R-01 병합))
-- ---------------------------------------------------------------------
CREATE TABLE user_account (
  user_account_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '사용자 식별자 (로그인 계정이 바뀔 수 있으므로 대리키)',
  login_email VARCHAR(254) NOT NULL COMMENT '로그인 계정',
  password_hash VARCHAR(100) NOT NULL COMMENT '비밀번호 단방향 해시. 평문 저장·응답 노출 금지',
  display_name VARCHAR(30) NOT NULL COMMENT '표시 이름',
  account_status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' COMMENT '계정 상태. 탈퇴 요청 접수 시 CLOSED, 유예 기간 안에 철회하면 ACTIVE',
  joined_at DATETIME(3) NOT NULL COMMENT '가입 시각',
  threshold_policy_id BIGINT NOT NULL COMMENT '다음 측정부터 적용할 판정 정책 (사용자 설정 병합)',
  sound_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT '소리 알림 사용 (사용자 설정 병합). 저장 여부 미결',
  age INT NULL COMMENT '가입 시 입력한 나이. 선택. NULL: 입력 안 함',
  occupation VARCHAR(80) NULL COMMENT '가입 시 입력한 직업(자유 입력). 선택. NULL: 입력 안 함',
  CONSTRAINT pk_user_account PRIMARY KEY (user_account_id),
  CONSTRAINT ux_user_account_login_email UNIQUE (login_email),  -- UK-01
  CONSTRAINT fk_user_account_threshold_policy FOREIGN KEY (threshold_policy_id) REFERENCES threshold_policy (threshold_policy_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-01
  CONSTRAINT ck_user_account_account_status CHECK (account_status IN ('ACTIVE', 'CLOSED')),  -- 허용값: ACTIVE / CLOSED
  CONSTRAINT ck_user_account_age CHECK (age BETWEEN 1 AND 120)  -- 허용값: 1 ~ 120
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-25 사용자 계정 — 로그인 계정과 다음 측정에 적용할 설정';

-- ---------------------------------------------------------------------
-- T-30 baseline_posture — 기준 자세 (근거 E-04)
-- ---------------------------------------------------------------------
CREATE TABLE baseline_posture (
  user_account_id BIGINT NOT NULL COMMENT '기준 자세 소유 사용자. 사용자당 1행 — 다시 촬영하면 이 행을 덮어쓴다',
  calibration_uuid VARCHAR(36) NOT NULL COMMENT '클라이언트가 발급한 보정 식별자. 다시 촬영할 때마다 새 값. 세션이 측정 시작 때 복사해 기준이 바뀐 시점을 구분',
  calibration_sec DECIMAL(4,1) NOT NULL COMMENT '보정에 쓴 시간 (CALIBRATION_SEC 값 — V2.1 기준 3초)',
  sample_count INT NOT NULL COMMENT '보정에 쓴 표본 수',
  registered_at DATETIME(3) NOT NULL COMMENT '현재 기준을 촬영(보정 완료)한 시각. 다시 촬영하면 갱신',
  nose_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 코 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  nose_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 코 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  left_eye_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 왼쪽 눈 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  left_eye_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 왼쪽 눈 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  right_eye_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 오른쪽 눈 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  right_eye_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 오른쪽 눈 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  left_ear_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 왼쪽 귀 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  left_ear_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 왼쪽 귀 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  right_ear_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 오른쪽 귀 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  right_ear_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 오른쪽 귀 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  mouth_left_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 입 왼쪽 끝 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  mouth_left_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 입 왼쪽 끝 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  mouth_right_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 입 오른쪽 끝 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  mouth_right_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 입 오른쪽 끝 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  left_shoulder_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 왼쪽 어깨 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  left_shoulder_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 왼쪽 어깨 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  right_shoulder_x DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 오른쪽 어깨 x 좌표 평균. MediaPipe 정규화 좌표 — 화면 가로 길이에 대한 비율',
  right_shoulder_y DECIMAL(6,5) NOT NULL COMMENT '기준 자세 촬영 동안의 오른쪽 어깨 y 좌표 평균. MediaPipe 정규화 좌표 — 화면 세로 길이에 대한 비율',
  CONSTRAINT pk_baseline_posture PRIMARY KEY (user_account_id),
  CONSTRAINT ux_baseline_posture_calibration UNIQUE (calibration_uuid),  -- UK-04
  CONSTRAINT fk_baseline_posture_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-04
  CONSTRAINT ck_baseline_posture_calibration_uuid CHECK (CHAR_LENGTH(calibration_uuid) = 36),  -- 허용값: UUID
  CONSTRAINT ck_baseline_posture_calibration_sec CHECK (calibration_sec > 0),  -- 허용값: 0 초과
  CONSTRAINT ck_baseline_posture_sample_count CHECK (sample_count >= 1),  -- 허용값: 1 이상
  CONSTRAINT ck_baseline_posture_nose_x CHECK (nose_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_nose_y CHECK (nose_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_left_eye_x CHECK (left_eye_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_left_eye_y CHECK (left_eye_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_right_eye_x CHECK (right_eye_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_right_eye_y CHECK (right_eye_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_left_ear_x CHECK (left_ear_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_left_ear_y CHECK (left_ear_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_right_ear_x CHECK (right_ear_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_right_ear_y CHECK (right_ear_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_mouth_left_x CHECK (mouth_left_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_mouth_left_y CHECK (mouth_left_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_mouth_right_x CHECK (mouth_right_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_mouth_right_y CHECK (mouth_right_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_left_shoulder_x CHECK (left_shoulder_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_left_shoulder_y CHECK (left_shoulder_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_right_shoulder_x CHECK (right_shoulder_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_right_shoulder_y CHECK (right_shoulder_y BETWEEN 0 AND 1)  -- 허용값: 0 ~ 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-30 기준 자세 — 사용자당 1행. 관절 좌표 18개(9개 부위 × x·y), 다시 촬영하면 덮어씀';

-- ---------------------------------------------------------------------
-- T-33 monitor_session — 측정 세션 (근거 E-09)
-- ---------------------------------------------------------------------
CREATE TABLE monitor_session (
  monitor_session_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '세션 식별자 (클라이언트 식별자가 36자이므로 대리키)',
  client_session_uuid VARCHAR(36) NOT NULL COMMENT '클라이언트가 발급한 세션 식별자. 재전송 중복 저장 방지',
  user_account_id BIGINT NOT NULL COMMENT '측정한 사용자 (D-19). 이 사용자의 현재 기준 자세로 판정한다',
  calibration_uuid VARCHAR(36) NOT NULL COMMENT '측정 시작 시점에 적용한 기준 자세의 보정 식별자 (baseline_posture.calibration_uuid 복사). FK 아님 — 같은 값을 가진 세션끼리만 같은 기준',
  threshold_policy_id BIGINT NOT NULL COMMENT '시작 시점에 적용한 판정 정책',
  alert_enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '교정 알림 제공 여부. 거짓이어도 이벤트는 기록',
  started_at DATETIME(3) NOT NULL COMMENT '측정 시작 시각',
  ended_at DATETIME(3) NULL COMMENT '측정 종료 시각. NULL: 측정 중',
  end_reason VARCHAR(16) NULL COMMENT '종료 사유. NULL: 측정 중',
  good_sec DECIMAL(9,1) NULL COMMENT '바른 자세로 판정된 시간 (원자료, D-22). NULL: 측정 중',
  CONSTRAINT pk_monitor_session PRIMARY KEY (monitor_session_id),
  CONSTRAINT ux_monitor_session_client_uuid UNIQUE (client_session_uuid),  -- UK-05
  CONSTRAINT fk_monitor_session_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-07
  CONSTRAINT fk_monitor_session_threshold_policy FOREIGN KEY (threshold_policy_id) REFERENCES threshold_policy (threshold_policy_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-10
  CONSTRAINT ck_monitor_session_client_session_uuid CHECK (CHAR_LENGTH(client_session_uuid) = 36),  -- 허용값: UUID
  CONSTRAINT ck_monitor_session_calibration_uuid CHECK (CHAR_LENGTH(calibration_uuid) = 36),  -- 허용값: UUID
  CONSTRAINT ck_monitor_session_end_reason CHECK (end_reason IN ('USER_STOP', 'DISCONNECTED', 'ERROR')),  -- 허용값: USER_STOP / DISCONNECTED / ERROR
  CONSTRAINT ck_monitor_session_good_sec CHECK (good_sec >= 0),  -- 허용값: 0 이상
  CONSTRAINT ck_monitor_session_end CHECK ((ended_at IS NULL AND end_reason IS NULL AND good_sec IS NULL) OR (ended_at IS NOT NULL AND end_reason IS NOT NULL AND good_sec IS NOT NULL)),  -- BR-35 종료 시각·종료 사유·바른 자세 시간은 함께 채워진다 (NULL = 측정 중)
  CONSTRAINT ck_monitor_session_period CHECK (ended_at >= started_at)  -- 종료 시각은 시작 시각 이후
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-33 측정 세션 — 측정 1회와 적용 조건·결과 요약';

-- ---------------------------------------------------------------------
-- T-34 excluded_interval — 세션 제외 구간 (근거 E-10)
-- ---------------------------------------------------------------------
CREATE TABLE excluded_interval (
  monitor_session_id BIGINT NOT NULL COMMENT '소속 세션',
  started_at DATETIME(3) NOT NULL COMMENT '제외 시작 시각',
  ended_at DATETIME(3) NULL COMMENT '제외 종료 시각. NULL: 진행 중',
  exclusion_reason VARCHAR(12) NOT NULL COMMENT '제외 사유. 우선순위로 하나만 부여',
  CONSTRAINT pk_excluded_interval PRIMARY KEY (monitor_session_id, started_at),
  CONSTRAINT fk_excluded_interval_monitor_session FOREIGN KEY (monitor_session_id) REFERENCES monitor_session (monitor_session_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-12
  CONSTRAINT ck_excluded_interval_ended_at CHECK (ended_at >= started_at),  -- 허용값: started_at 이후
  CONSTRAINT ck_excluded_interval_exclusion_reason CHECK (exclusion_reason IN ('PAUSE', 'MISSING', 'ABSENCE', 'UNMEASURABLE'))  -- 허용값: PAUSE / MISSING / ABSENCE / UNMEASURABLE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-34 세션 제외 구간 — 일시정지·자리 비움·판정 불가 구간';

-- ---------------------------------------------------------------------
-- T-35 feature_archive — 특징값 적재 기록 (근거 E-13)
-- ---------------------------------------------------------------------
CREATE TABLE feature_archive (
  feature_archive_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '적재 기록 식별자',
  monitor_session_id BIGINT NOT NULL COMMENT '소속 세션',
  file_uri VARCHAR(500) COLLATE utf8mb4_bin NOT NULL COMMENT 'HDFS 파일 위치. 파일 하나는 한 세션의 특징값만 담음. 특징값 계산 방식은 파일 경로·메타 정보에 남긴다',
  range_start_at DATETIME(3) NOT NULL COMMENT '파일에 담긴 첫 특징값 시각',
  range_end_at DATETIME(3) NOT NULL COMMENT '파일에 담긴 마지막 특징값 시각',
  row_count INT NOT NULL COMMENT '파일 행 수',
  archived_at DATETIME(3) NOT NULL COMMENT '적재 시각',
  deleted_at DATETIME(3) NULL COMMENT '삭제 처리로 파일을 지운 시각. NULL: 파일 보존 중. 값이 찬 행은 삭제 배치가 세션과 함께 지움 (재시도 지점)',
  CONSTRAINT pk_feature_archive PRIMARY KEY (feature_archive_id),
  CONSTRAINT ux_feature_archive_file_uri UNIQUE (file_uri),  -- UK-06
  CONSTRAINT fk_feature_archive_monitor_session FOREIGN KEY (monitor_session_id) REFERENCES monitor_session (monitor_session_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-13 — RESTRICT + 삭제 배치
  CONSTRAINT ck_feature_archive_range_end_at CHECK (range_end_at >= range_start_at),  -- 허용값: range_start_at 이후
  CONSTRAINT ck_feature_archive_row_count CHECK (row_count >= 0)  -- 허용값: 0 이상
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-35 특징값 적재 기록 — HDFS 특징값 파일 위치·시각 범위';

-- ---------------------------------------------------------------------
-- T-37 collapse_event — 붕괴 이벤트 (근거 E-14)
-- ---------------------------------------------------------------------
CREATE TABLE collapse_event (
  monitor_session_id BIGINT NOT NULL COMMENT '소속 세션',
  event_seq INT NOT NULL COMMENT '세션 내 순번',
  started_at DATETIME(3) NOT NULL COMMENT '임계를 넘은 시각 = 붕괴 시작 (D-20)',
  confirmed_at DATETIME(3) NOT NULL COMMENT '지속 조건 충족으로 확정된 시각',
  ended_at DATETIME(3) NULL COMMENT '이벤트 종료 시각. NULL: 진행 중',
  end_reason VARCHAR(16) NULL COMMENT '종료 사유. NULL: 진행 중',
  recovered_at DATETIME(3) NULL COMMENT '회복 시각. NULL: 회복으로 끝나지 않음',
  CONSTRAINT pk_collapse_event PRIMARY KEY (monitor_session_id, event_seq),
  CONSTRAINT fk_collapse_event_monitor_session FOREIGN KEY (monitor_session_id) REFERENCES monitor_session (monitor_session_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-14
  CONSTRAINT ck_collapse_event_event_seq CHECK (event_seq >= 1),  -- 허용값: 1 이상
  CONSTRAINT ck_collapse_event_confirmed_at CHECK (confirmed_at >= started_at),  -- 허용값: started_at 이후
  CONSTRAINT ck_collapse_event_ended_at CHECK (ended_at >= confirmed_at),  -- 허용값: confirmed_at 이후
  CONSTRAINT ck_collapse_event_end_reason CHECK (end_reason IN ('RECOVERED', 'SESSION_END', 'EXCLUDED')),  -- 허용값: RECOVERED / SESSION_END / EXCLUDED
  CONSTRAINT ck_collapse_event_end CHECK ((ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND end_reason IS NOT NULL)),  -- BR-12 종료 시각과 종료 사유는 함께 채워진다 (NULL = 진행 중)
  CONSTRAINT ck_collapse_event_recovered CHECK ((recovered_at IS NULL AND (end_reason IS NULL OR end_reason <> 'RECOVERED')) OR (recovered_at IS NOT NULL AND end_reason = 'RECOVERED'))  -- BR-12 회복 시각은 회복으로 끝난 이벤트에만 있다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-37 붕괴 이벤트 — 붕괴 한 건의 시작·확정·종료·회복';

-- ---------------------------------------------------------------------
-- T-38 correction_alert — 교정 알림 (근거 E-15)
-- ---------------------------------------------------------------------
CREATE TABLE correction_alert (
  correction_alert_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '알림 시도 식별자 (자연키 3컬럼이므로 대리키)',
  monitor_session_id BIGINT NOT NULL COMMENT '대상 이벤트의 세션',
  event_seq INT NOT NULL COMMENT '대상 이벤트의 세션 내 순번',
  attempt_seq INT NOT NULL COMMENT '이벤트 내 알림 시도 순번',
  attempted_at DATETIME(3) NOT NULL COMMENT '알림 시도 시각',
  delivered BOOLEAN NOT NULL COMMENT '실제로 표시됐는지',
  suppress_reason VARCHAR(16) NULL COMMENT '억제 사유. NULL: 표시됨',
  CONSTRAINT pk_correction_alert PRIMARY KEY (correction_alert_id),
  CONSTRAINT ux_correction_alert_attempt UNIQUE (monitor_session_id, event_seq, attempt_seq),  -- UK-07
  CONSTRAINT fk_correction_alert_collapse_event FOREIGN KEY (monitor_session_id, event_seq) REFERENCES collapse_event (monitor_session_id, event_seq) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-16
  CONSTRAINT ck_correction_alert_attempt_seq CHECK (attempt_seq >= 1),  -- 허용값: 1 이상
  CONSTRAINT ck_correction_alert_suppress_reason CHECK (suppress_reason IN ('ALERT_OFF', 'RATE_LIMIT')),  -- 허용값: ALERT_OFF / RATE_LIMIT
  CONSTRAINT ck_correction_alert_suppress CHECK ((delivered = TRUE AND suppress_reason IS NULL) OR (delivered = FALSE AND suppress_reason IS NOT NULL))  -- BR-14 표시되지 않은 시도만 억제 사유를 가진다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-38 교정 알림 — 알림 시도와 발송·억제 결과';

-- ---------------------------------------------------------------------
-- T-39 daily_stat — 일별 통계 (근거 E-16)
-- ---------------------------------------------------------------------
CREATE TABLE daily_stat (
  user_account_id BIGINT NOT NULL COMMENT '대상 사용자',
  stat_date DATE NOT NULL COMMENT '집계 날짜 (STAT_TIMEZONE = Asia/Seoul, 세션 시작 날짜 귀속)',
  valid_sec DECIMAL(9,1) NOT NULL COMMENT '유효 측정 시간 합 (분모)',
  good_sec DECIMAL(9,1) NOT NULL COMMENT '바른 자세 시간 합 (분자)',
  session_count INT NOT NULL COMMENT '세션 수',
  event_count INT NOT NULL COMMENT '붕괴 이벤트 수',
  alerted_event_count INT NOT NULL COMMENT '알림이 실제 표시된 이벤트 수',
  computed_at DATETIME(3) NOT NULL COMMENT '집계 시각 (재계산 추적)',
  CONSTRAINT pk_daily_stat PRIMARY KEY (user_account_id, stat_date),
  CONSTRAINT fk_daily_stat_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-17
  CONSTRAINT ck_daily_stat_valid_sec CHECK (valid_sec >= 0),  -- 허용값: 0 이상
  CONSTRAINT ck_daily_stat_good_sec CHECK (good_sec >= 0),  -- 허용값: 0 이상
  CONSTRAINT ck_daily_stat_session_count CHECK (session_count >= 0),  -- 허용값: 0 이상
  CONSTRAINT ck_daily_stat_event_count CHECK (event_count >= 0),  -- 허용값: 0 이상
  CONSTRAINT ck_daily_stat_alerted_event_count CHECK (alerted_event_count >= 0),  -- 허용값: 0 이상
  CONSTRAINT ck_daily_stat_subset CHECK (good_sec <= valid_sec AND alerted_event_count <= event_count)  -- BR-17·BR-22 분자는 분모를 넘지 않는다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-39 일별 통계 — 사용자·일자별 분자·분모 집계 (마트)';

-- ---------------------------------------------------------------------
-- T-40 deletion_request — 삭제 요청 (근거 E-31)
-- ---------------------------------------------------------------------
CREATE TABLE deletion_request (
  user_account_id BIGINT NOT NULL COMMENT '요청 사용자',
  requested_at DATETIME(3) NOT NULL COMMENT '요청 시각',
  request_scope VARCHAR(16) NOT NULL COMMENT '삭제 범위',
  request_status VARCHAR(12) NOT NULL DEFAULT 'REQUESTED' COMMENT '처리 상태. DONE은 실제 삭제 완료 후에만',
  account_closed_at DATETIME(3) NULL COMMENT '계정 폐쇄 시각. 탈퇴 유예 기간(WITHDRAWAL_GRACE_DAY)은 이 시각부터 센다. NULL: 기록만 삭제하는 범위이거나 폐쇄 전',
  data_deleted_at DATETIME(3) NULL COMMENT '자료 삭제 완료 시각 (HDFS 포함). NULL: 미완료',
  failure_reason VARCHAR(200) NULL COMMENT '실패 사유. NULL: 실패하지 않음',
  CONSTRAINT pk_deletion_request PRIMARY KEY (user_account_id, requested_at),
  CONSTRAINT fk_deletion_request_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-18 — RESTRICT + 삭제 배치
  CONSTRAINT ck_deletion_request_request_scope CHECK (request_scope IN ('ACCOUNT_ALL', 'RECORDS_ONLY')),  -- 허용값: ACCOUNT_ALL / RECORDS_ONLY
  CONSTRAINT ck_deletion_request_request_status CHECK (request_status IN ('REQUESTED', 'PROCESSING', 'FAILED', 'DONE')),  -- 허용값: REQUESTED / PROCESSING / FAILED / DONE
  CONSTRAINT ck_deletion_request_done CHECK (request_status <> 'DONE' OR data_deleted_at IS NOT NULL),  -- BR-66 완료(DONE)는 자료 삭제 완료 시각이 있을 때만
  CONSTRAINT ck_deletion_request_scope CHECK (request_scope = 'ACCOUNT_ALL' OR account_closed_at IS NULL)  -- D-39 기록 삭제는 계정을 폐쇄하지 않는다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-40 삭제 요청 — 탈퇴·기록 삭제 요청과 처리 상태';

-- ---------------------------------------------------------------------
-- T-48 SPRING_SESSION — 로그인 세션 (근거 건의안 0001 #5 — E-ID는 DB-02 반영 때 부여)
-- ---------------------------------------------------------------------
CREATE TABLE SPRING_SESSION (
  PRIMARY_ID CHAR(36) NOT NULL,
  SESSION_ID CHAR(36) NOT NULL,
  CREATION_TIME BIGINT NOT NULL,
  LAST_ACCESS_TIME BIGINT NOT NULL,
  MAX_INACTIVE_INTERVAL INT NOT NULL,
  EXPIRY_TIME BIGINT NOT NULL,
  PRINCIPAL_NAME VARCHAR(100),
  CONSTRAINT SPRING_SESSION_PK PRIMARY KEY (PRIMARY_ID),
  UNIQUE KEY SPRING_SESSION_IX1 (SESSION_ID)  -- UK-13
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- T-49 SPRING_SESSION_ATTRIBUTES — 로그인 세션 속성 (근거 건의안 0001 #5 — E-ID는 DB-02 반영 때 부여)
-- ---------------------------------------------------------------------
CREATE TABLE SPRING_SESSION_ATTRIBUTES (
  SESSION_PRIMARY_ID CHAR(36) NOT NULL,
  ATTRIBUTE_NAME VARCHAR(200) NOT NULL,
  ATTRIBUTE_BYTES BLOB NOT NULL,
  CONSTRAINT SPRING_SESSION_ATTRIBUTES_PK PRIMARY KEY (SESSION_PRIMARY_ID, ATTRIBUTE_NAME),
  CONSTRAINT SPRING_SESSION_ATTRIBUTES_FK FOREIGN KEY (SESSION_PRIMARY_ID) REFERENCES SPRING_SESSION (PRIMARY_ID) ON DELETE CASCADE  -- FK-25
) ENGINE=InnoDB;

-- 끝: 테이블 12개, 컬럼 103개, UK 8개, FK 11개, CHECK 59개
