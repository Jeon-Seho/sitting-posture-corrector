-- =====================================================================
-- 자세교정 서비스 스키마 — schema_V0_3.sql
-- 명세서: DB 명세서 V0.3 (DRAFT) / DB-03 V0.3 / DB-04 V0.1
--   파일 번호는 명세서 버전과 같다 (작업규칙 1.7). 명세서가 V1.0으로 확정되면 schema_V1_0.sql로 다시 만든다.
-- DBMS: MySQL 8.0.16 이상 (CHECK 제약 강제, 함수 기반 유니크 키 사용)
-- 생성: 2026-10-02 (명세서 원천에서 자동 생성 — 손으로 고치지 말고 명세서를 고친 뒤 다시 생성)
--
-- 범위: 17개 테이블. 보류 항목은 결정 후 migrations/로 추가한다.
--   제외 — T-36 collapse_type, T-41 user_consent, collapse_event.collapse_type_code, UK-08, FK-15, FK-19
-- 인덱스: 보조 인덱스 없음. DB-05(쿼리 목록 → 인덱스) 후 migrations/에 별도 파일로 둔다.
--   InnoDB는 FK 컬럼에 쓸 인덱스가 없으면 자동으로 만든다 — DB-05 인덱스 시트에서 함께 정리한다.
-- 시각: 모든 DATETIME(3)은 UTC로 저장한다 (CONVENTIONS).
-- 삭제 동작: DB-04 1-1절. 「RESTRICT + 삭제·보관 배치」는 RESTRICT로 두고 배치가 순서대로 지운다.
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

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
  CONSTRAINT ux_threshold_policy_values UNIQUE (threshold, hold_seconds, recover_seconds, realert_seconds, notify_max_per_hour),  -- UK-03
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
  login_email VARCHAR(254) NULL COMMENT '로그인 계정. NULL: 탈퇴 처리가 끝난 계정 (ACTIVE 계정은 필수)',
  password_hash VARCHAR(100) NULL COMMENT '비밀번호 단방향 해시. 평문 저장·응답 노출 금지. NULL: 탈퇴 처리가 끝난 계정 (ACTIVE 계정은 필수)',
  display_name VARCHAR(30) NULL COMMENT '표시 이름. 나이·직업은 사용 목적이 정해질 때까지 받지 않음. NULL: 탈퇴 처리가 끝난 계정 (ACTIVE 계정은 필수)',
  account_status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' COMMENT '계정 상태. 탈퇴 요청 접수 시 CLOSED. ACTIVE이면 로그인 계정·비밀번호 해시·표시 이름이 모두 있어야 함',
  joined_at DATETIME(3) NOT NULL COMMENT '가입 시각 (UTC)',
  threshold_policy_id BIGINT NOT NULL COMMENT '다음 측정부터 적용할 판정 정책 (사용자 설정 병합)',
  sound_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT '소리 알림 사용 (사용자 설정 병합). 저장 여부 미결',
  CONSTRAINT pk_user_account PRIMARY KEY (user_account_id),
  CONSTRAINT ux_user_account_login_email UNIQUE (login_email),  -- UK-01
  CONSTRAINT fk_user_account_threshold_policy FOREIGN KEY (threshold_policy_id) REFERENCES threshold_policy (threshold_policy_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-01
  CONSTRAINT ck_user_account_account_status CHECK (account_status IN ('ACTIVE', 'CLOSED')),  -- 허용값: ACTIVE / CLOSED
  CONSTRAINT ck_user_account_identity CHECK (account_status = 'CLOSED' OR (login_email IS NOT NULL AND password_hash IS NOT NULL AND display_name IS NOT NULL))  -- D-34 활성 계정은 식별 컬럼 3개 필수
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-25 사용자 계정 — 로그인 계정과 다음 측정에 적용할 설정';

-- ---------------------------------------------------------------------
-- T-26 capture_device — 측정 장치 (근거 E-03)
-- ---------------------------------------------------------------------
CREATE TABLE capture_device (
  capture_device_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '장치 식별자 (브라우저 식별값이 30자를 넘으므로 대리키)',
  user_account_id BIGINT NOT NULL COMMENT '장치 소유 사용자',
  browser_device_key VARCHAR(128) COLLATE utf8mb4_bin NOT NULL COMMENT '브라우저가 부여한 카메라 장치 식별값',
  device_label VARCHAR(100) NOT NULL COMMENT '장치 표시명',
  registered_at DATETIME(3) NOT NULL COMMENT '등록 시각',
  CONSTRAINT pk_capture_device PRIMARY KEY (capture_device_id),
  CONSTRAINT ux_capture_device_user_key UNIQUE (user_account_id, browser_device_key),  -- UK-02
  CONSTRAINT ux_capture_device_id_user UNIQUE (capture_device_id, user_account_id),  -- UK-09
  CONSTRAINT fk_capture_device_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT  -- FK-02
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-26 측정 장치 — 사용자가 측정에 쓰는 카메라';

-- ---------------------------------------------------------------------
-- T-27 feature_def — 특징값 정의 (근거 E-06)
-- ---------------------------------------------------------------------
CREATE TABLE feature_def (
  feature_code VARCHAR(30) NOT NULL COMMENT '특징값 코드',
  feature_name VARCHAR(50) NOT NULL COMMENT '표시명',
  unit VARCHAR(20) NULL COMMENT '단위. NULL: 어깨 너비로 나눈 무차원값',
  scale_invariant BOOLEAN NOT NULL COMMENT '카메라 거리에 무관한 값인지',
  distance_proxy BOOLEAN NOT NULL COMMENT '거리 대리 지표(어깨 너비)인지',
  CONSTRAINT pk_feature_def PRIMARY KEY (feature_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-27 특징값 정의 — 특징값 목록과 성질 (마스터)';

-- ---------------------------------------------------------------------
-- T-28 safety_range — 절대 안전 범위 (근거 E-07)
-- ---------------------------------------------------------------------
CREATE TABLE safety_range (
  feature_code VARCHAR(30) NOT NULL COMMENT '대상 특징값 (부모 식별자 공유)',
  lower_bound DECIMAL(9,6) NULL COMMENT '허용 하한. NULL: 하한 없음 (상·하한 중 하나는 필수)',
  upper_bound DECIMAL(9,6) NULL COMMENT '허용 상한. NULL: 상한 없음',
  basis VARCHAR(200) NOT NULL COMMENT '범위의 근거',
  CONSTRAINT pk_safety_range PRIMARY KEY (feature_code),
  CONSTRAINT fk_safety_range_feature_def FOREIGN KEY (feature_code) REFERENCES feature_def (feature_code) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-03
  CONSTRAINT ck_safety_range_bound CHECK ((lower_bound IS NOT NULL OR upper_bound IS NOT NULL) AND (lower_bound IS NULL OR upper_bound IS NULL OR lower_bound <= upper_bound))  -- BR-04 상·하한 중 하나는 필수, 하한 ≤ 상한
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-28 절대 안전 범위 — 기준 자세 등록 허용 상·하한 (마스터)';

-- ---------------------------------------------------------------------
-- T-30 baseline_posture — 기준 자세 (근거 E-04)
-- ---------------------------------------------------------------------
CREATE TABLE baseline_posture (
  baseline_posture_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '기준 자세 식별자 (보정 식별자가 36자이므로 대리키)',
  user_account_id BIGINT NOT NULL COMMENT '기준 자세 소유 사용자. 활성 행(비활성 전환 시각 없음)은 사용자당 하나',
  calibration_uuid VARCHAR(36) NOT NULL COMMENT '클라이언트가 발급한 보정 식별자',
  feature_version VARCHAR(30) NOT NULL COMMENT '특징값 계산 방식 버전',
  calibration_sec DECIMAL(4,1) NOT NULL COMMENT '보정에 쓴 시간 (CALIBRATION_SEC 값)',
  sample_count INT NOT NULL COMMENT '보정에 쓴 표본 수',
  normalization_scale DECIMAL(8,3) NULL COMMENT '보정 시점 어깨 너비 = 정규화 상수. NULL: 클라이언트가 아직 제공하지 않음',
  target_center_x DECIMAL(4,3) NOT NULL COMMENT '등록 시 측정 대상의 화면 내 가로 위치',
  target_center_y DECIMAL(4,3) NOT NULL COMMENT '등록 시 측정 대상의 화면 내 세로 위치',
  target_area_ratio DECIMAL(4,3) NOT NULL COMMENT '등록 시 검출 영역이 화면에서 차지하는 비율',
  registered_at DATETIME(3) NOT NULL COMMENT '등록(보정 완료) 시각',
  deactivated_at DATETIME(3) NULL COMMENT '비활성 전환 시각. NULL: 현재 활성 기준',
  CONSTRAINT pk_baseline_posture PRIMARY KEY (baseline_posture_id),
  CONSTRAINT ux_baseline_posture_calibration UNIQUE (calibration_uuid),  -- UK-04
  CONSTRAINT ux_baseline_posture_id_user UNIQUE (baseline_posture_id, user_account_id),  -- UK-10
  UNIQUE KEY ux_baseline_posture_active ((IF(deactivated_at IS NULL, user_account_id, NULL))),  -- UK-11 활성 기준 자세는 사용자당 하나 (BR-03)
  CONSTRAINT fk_baseline_posture_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-04
  CONSTRAINT ck_baseline_posture_calibration_uuid CHECK (CHAR_LENGTH(calibration_uuid) = 36),  -- 허용값: UUID
  CONSTRAINT ck_baseline_posture_calibration_sec CHECK (calibration_sec > 0),  -- 허용값: 0 초과
  CONSTRAINT ck_baseline_posture_sample_count CHECK (sample_count >= 1),  -- 허용값: 1 이상
  CONSTRAINT ck_baseline_posture_normalization_scale CHECK (normalization_scale > 0),  -- 허용값: 0 초과
  CONSTRAINT ck_baseline_posture_target_center_x CHECK (target_center_x BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_target_center_y CHECK (target_center_y BETWEEN 0 AND 1),  -- 허용값: 0 ~ 1
  CONSTRAINT ck_baseline_posture_target_area_ratio CHECK (target_area_ratio BETWEEN 0 AND 1)  -- 허용값: 0 ~ 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-30 기준 자세 — 사용자별 기준 자세. 비활성 전환 시각이 없는 행이 활성';

-- ---------------------------------------------------------------------
-- T-31 baseline_feature — 기준 자세 특징값 (근거 E-05)
-- ---------------------------------------------------------------------
CREATE TABLE baseline_feature (
  baseline_posture_id BIGINT NOT NULL COMMENT '소속 기준 자세',
  feature_code VARCHAR(30) NOT NULL COMMENT '특징값',
  mean_value DECIMAL(9,6) NOT NULL COMMENT '보정 표본의 평균',
  std_value DECIMAL(9,6) NULL COMMENT '보정 표본의 표준편차. NULL: 산출하지 않음',
  CONSTRAINT pk_baseline_feature PRIMARY KEY (baseline_posture_id, feature_code),
  CONSTRAINT fk_baseline_feature_baseline_posture FOREIGN KEY (baseline_posture_id) REFERENCES baseline_posture (baseline_posture_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-05
  CONSTRAINT fk_baseline_feature_feature_def FOREIGN KEY (feature_code) REFERENCES feature_def (feature_code) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-06
  CONSTRAINT ck_baseline_feature_std_value CHECK (std_value >= 0)  -- 허용값: 0 이상
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-31 기준 자세 특징값 — 기준 자세의 특징값별 대표값·변동폭';

-- ---------------------------------------------------------------------
-- T-32 model_version — 모델 버전 (근거 E-27)
-- ---------------------------------------------------------------------
CREATE TABLE model_version (
  model_version_code VARCHAR(30) NOT NULL COMMENT '모델 버전 코드',
  model_type VARCHAR(10) NOT NULL COMMENT '모델 유형. LSTM 연결 전에는 규칙 기반이 판정',
  feature_version VARCHAR(30) NOT NULL COMMENT '입력 특징값 계산 방식 버전',
  window_length_sec DECIMAL(5,2) NULL COMMENT '모델 입력 구간 길이. NULL: 규칙 기반',
  window_stride_sec DECIMAL(5,2) NULL COMMENT '판정 대표 구간 길이. NULL: 규칙 기반',
  artifact_uri VARCHAR(500) NULL COMMENT '모델 파일 위치. NULL: 규칙 기반(코드 내장)',
  released_at DATETIME(3) NOT NULL COMMENT '배포 가능 상태가 된 시각',
  description VARCHAR(200) NULL COMMENT '변경 요지. NULL: 작성 전',
  CONSTRAINT pk_model_version PRIMARY KEY (model_version_code),
  CONSTRAINT ck_model_version_model_type CHECK (model_type IN ('LSTM', 'RULE')),  -- 허용값: LSTM / RULE
  CONSTRAINT ck_model_version_window_length_sec CHECK (window_length_sec > 0),  -- 허용값: 0 초과
  CONSTRAINT ck_model_version_window_stride_sec CHECK (window_stride_sec > 0),  -- 허용값: 0 초과
  CONSTRAINT ck_model_version_type_attr CHECK ((model_type = 'RULE' AND window_length_sec IS NULL AND window_stride_sec IS NULL AND artifact_uri IS NULL) OR (model_type = 'LSTM' AND window_length_sec IS NOT NULL AND window_stride_sec IS NOT NULL AND artifact_uri IS NOT NULL))  -- D-25 학습 전용 속성 3개는 LSTM에만 있다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-32 모델 버전 — 판정에 쓰는 모델(학습·규칙)의 버전';

-- ---------------------------------------------------------------------
-- T-33 monitor_session — 측정 세션 (근거 E-09)
-- ---------------------------------------------------------------------
CREATE TABLE monitor_session (
  monitor_session_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '세션 식별자 (클라이언트 식별자가 36자이므로 대리키)',
  client_session_uuid VARCHAR(36) NOT NULL COMMENT '클라이언트가 발급한 세션 식별자. 재전송 중복 저장 방지',
  user_account_id BIGINT NOT NULL COMMENT '측정한 사용자 (D-19). 장치·기준 자세의 사용자와 같아야 함 — 복합 FK에 함께 참여',
  capture_device_id BIGINT NOT NULL COMMENT '사용한 측정 장치 (사용자 식별자와 함께 참조)',
  baseline_posture_id BIGINT NOT NULL COMMENT '판정 기준 자세 (사용자 식별자와 함께 참조)',
  threshold_policy_id BIGINT NOT NULL COMMENT '시작 시점에 적용한 판정 정책',
  model_version_code VARCHAR(30) NOT NULL COMMENT '판정에 사용한 모델 버전',
  alert_enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '교정 알림 제공 여부. 거짓이어도 이벤트는 기록',
  frame_width INT NOT NULL COMMENT '영상 가로 해상도. 특징값이 픽셀 비율로 계산됨',
  frame_height INT NOT NULL COMMENT '영상 세로 해상도',
  started_at DATETIME(3) NOT NULL COMMENT '측정 시작 시각',
  ended_at DATETIME(3) NULL COMMENT '측정 종료 시각. NULL: 측정 중',
  end_reason VARCHAR(16) NULL COMMENT '종료 사유. NULL: 측정 중',
  good_sec DECIMAL(9,1) NULL COMMENT '바른 자세로 판정된 시간 (원자료, D-22). NULL: 측정 중',
  CONSTRAINT pk_monitor_session PRIMARY KEY (monitor_session_id),
  CONSTRAINT ux_monitor_session_client_uuid UNIQUE (client_session_uuid),  -- UK-05
  CONSTRAINT fk_monitor_session_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-07
  CONSTRAINT fk_monitor_session_capture_device FOREIGN KEY (capture_device_id, user_account_id) REFERENCES capture_device (capture_device_id, user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-08
  CONSTRAINT fk_monitor_session_baseline_posture FOREIGN KEY (baseline_posture_id, user_account_id) REFERENCES baseline_posture (baseline_posture_id, user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-09
  CONSTRAINT fk_monitor_session_threshold_policy FOREIGN KEY (threshold_policy_id) REFERENCES threshold_policy (threshold_policy_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-10
  CONSTRAINT fk_monitor_session_model_version FOREIGN KEY (model_version_code) REFERENCES model_version (model_version_code) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-11
  CONSTRAINT ck_monitor_session_client_session_uuid CHECK (CHAR_LENGTH(client_session_uuid) = 36),  -- 허용값: UUID
  CONSTRAINT ck_monitor_session_frame_width CHECK (frame_width >= 1),  -- 허용값: 1 이상
  CONSTRAINT ck_monitor_session_frame_height CHECK (frame_height >= 1),  -- 허용값: 1 이상
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
  CONSTRAINT ck_excluded_interval_exclusion_reason CHECK (exclusion_reason IN ('PAUSE', 'ABSENCE', 'UNMEASURABLE'))  -- 허용값: PAUSE / ABSENCE / UNMEASURABLE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-34 세션 제외 구간 — 일시정지·자리 비움·판정 불가 구간';

-- ---------------------------------------------------------------------
-- T-35 feature_archive — 특징값 적재 기록 (근거 E-13)
-- ---------------------------------------------------------------------
CREATE TABLE feature_archive (
  feature_archive_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '적재 기록 식별자',
  monitor_session_id BIGINT NOT NULL COMMENT '소속 세션',
  file_uri VARCHAR(500) COLLATE utf8mb4_bin NOT NULL COMMENT 'HDFS 파일 위치. 파일 하나는 한 세션의 특징값만 담음',
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
  stat_date DATE NOT NULL COMMENT '집계 날짜 (STAT_TIMEZONE 기준, 세션 시작 날짜 귀속)',
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
  account_closed_at DATETIME(3) NULL COMMENT '계정 폐쇄 시각. NULL: 기록만 삭제하는 범위이거나 폐쇄 전',
  data_deleted_at DATETIME(3) NULL COMMENT '자료 삭제 완료 시각 (HDFS 포함). NULL: 미완료',
  failure_reason VARCHAR(200) NULL COMMENT '실패 사유. NULL: 실패하지 않음',
  CONSTRAINT pk_deletion_request PRIMARY KEY (user_account_id, requested_at),
  CONSTRAINT fk_deletion_request_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-18 — RESTRICT + 보관 배치
  CONSTRAINT ck_deletion_request_request_scope CHECK (request_scope IN ('ACCOUNT_ALL', 'RECORDS_ONLY')),  -- 허용값: ACCOUNT_ALL / RECORDS_ONLY
  CONSTRAINT ck_deletion_request_request_status CHECK (request_status IN ('REQUESTED', 'PROCESSING', 'FAILED', 'DONE')),  -- 허용값: REQUESTED / PROCESSING / FAILED / DONE
  CONSTRAINT ck_deletion_request_done CHECK (request_status <> 'DONE' OR data_deleted_at IS NOT NULL),  -- BR-66 완료(DONE)는 자료 삭제 완료 시각이 있을 때만
  CONSTRAINT ck_deletion_request_scope CHECK (request_scope = 'ACCOUNT_ALL' OR account_closed_at IS NULL)  -- D-39 기록 삭제는 계정을 폐쇄하지 않는다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-40 삭제 요청 — 탈퇴·기록 삭제 요청과 처리 상태';

-- ---------------------------------------------------------------------
-- T-42 deployment — 배포 기록 (근거 E-32)
-- ---------------------------------------------------------------------
CREATE TABLE deployment (
  component VARCHAR(16) NOT NULL COMMENT '배포한 구성 요소',
  deployed_at DATETIME(3) NOT NULL COMMENT '배포 시각',
  image_tag VARCHAR(100) NOT NULL COMMENT '배포 이미지 태그',
  model_version_code VARCHAR(30) NULL COMMENT '적용 모델 버전. NULL: 추론 서비스가 아닌 배포',
  deploy_result VARCHAR(12) NOT NULL COMMENT '배포 결과',
  note VARCHAR(200) NULL COMMENT '비고. NULL: 없음',
  CONSTRAINT pk_deployment PRIMARY KEY (component, deployed_at),
  CONSTRAINT fk_deployment_model_version FOREIGN KEY (model_version_code) REFERENCES model_version (model_version_code) ON DELETE RESTRICT ON UPDATE RESTRICT,  -- FK-20
  CONSTRAINT ck_deployment_component CHECK (component IN ('API', 'INFERENCE', 'FRONTEND')),  -- 허용값: API / INFERENCE / FRONTEND
  CONSTRAINT ck_deployment_deploy_result CHECK (deploy_result IN ('SUCCESS', 'FAILED', 'ROLLED_BACK'))  -- 허용값: SUCCESS / FAILED / ROLLED_BACK
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-42 배포 기록 — 구성 요소별 배포 이미지와 적용 모델';

-- ---------------------------------------------------------------------
-- T-43 error_log — 오류 기록 (근거 E-33)
-- ---------------------------------------------------------------------
CREATE TABLE error_log (
  error_log_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '오류 기록 식별자 (자연키 없음)',
  component VARCHAR(16) NOT NULL COMMENT '발생 구성 요소',
  occurred_at DATETIME(3) NOT NULL COMMENT '발생 시각',
  error_code VARCHAR(30) NOT NULL COMMENT '오류 코드',
  message VARCHAR(500) NULL COMMENT '오류 메시지. NULL: 코드로 충분',
  monitor_session_id BIGINT NULL COMMENT '관련 세션. NULL: 세션과 무관',
  CONSTRAINT pk_error_log PRIMARY KEY (error_log_id),
  CONSTRAINT fk_error_log_monitor_session FOREIGN KEY (monitor_session_id) REFERENCES monitor_session (monitor_session_id) ON DELETE SET NULL ON UPDATE RESTRICT,  -- FK-21
  CONSTRAINT ck_error_log_component CHECK (component IN ('API', 'INFERENCE', 'FRONTEND', 'BATCH'))  -- 허용값: API / INFERENCE / FRONTEND / BATCH
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-43 오류 기록 — 운영 중 오류';

-- 끝: 테이블 17개, 컬럼 122개, UK 11개, FK 19개, CHECK 55개
