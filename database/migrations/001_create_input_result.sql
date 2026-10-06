-- =====================================================================
-- 001_create_input_result.sql — T-44 input_result (입력 처리 결과) 추가
-- 근거: CR-03, DB 건의안 0001 #1
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- ---------------------------------------------------------------------
-- T-44 input_result — 입력 처리 결과 (근거 건의안 0001 #1)
-- ---------------------------------------------------------------------
CREATE TABLE input_result (
  monitor_session_id BIGINT NOT NULL COMMENT '소속 세션',
  input_seq BIGINT NOT NULL COMMENT '세션 내 입력 순번',
  input_kind VARCHAR(16) NOT NULL COMMENT '입력 종류. FEATURE: 특징값 요청, OBSERVATION: 추론 결과',
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '요청 내용의 SHA-256. 같은 순번에 다른 내용이 오면 거부',
  observation JSON NOT NULL COMMENT '추론 결과(점수·유효 여부). 영상·랜드마크·원본 변화량은 넣지 않음',
  process_status VARCHAR(16) NOT NULL COMMENT '처리 상태',
  rejection_status INT NOT NULL DEFAULT 0 COMMENT '거부 시 HTTP 상태 코드. 0: 거부되지 않음',
  CONSTRAINT pk_input_result PRIMARY KEY (monitor_session_id, input_seq),
  CONSTRAINT fk_input_result_monitor_session FOREIGN KEY (monitor_session_id) REFERENCES monitor_session (monitor_session_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-22
  CONSTRAINT ck_input_result_input_seq CHECK (input_seq >= 0),  -- 허용값: 0 이상
  CONSTRAINT ck_input_result_input_kind CHECK (input_kind IN ('FEATURE', 'OBSERVATION')),  -- 허용값: FEATURE / OBSERVATION
  CONSTRAINT ck_input_result_process_status CHECK (process_status IN ('PENDING', 'CONFIRMED', 'REJECTED')),  -- 허용값: PENDING / CONFIRMED / REJECTED
  CONSTRAINT ck_input_result_rejection_status CHECK (rejection_status >= 0)  -- 허용값: 0 이상
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-44 입력 처리 결과 — 측정 중 입력을 순번별로 기록. 같은 요청 재전송 시 저장된 결과를 돌려줘 중복 집계를 막음. 보관: 세션 종료 후 5년';
