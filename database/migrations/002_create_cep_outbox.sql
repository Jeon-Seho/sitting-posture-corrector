-- =====================================================================
-- 002_create_cep_outbox.sql — T-45 cep_outbox (CEP 전달 대기) 추가
-- 근거: CR-03, DB 건의안 0001 #2
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- ---------------------------------------------------------------------
-- T-45 cep_outbox — CEP 전달 대기 (근거 건의안 0001 #2)
-- ---------------------------------------------------------------------
CREATE TABLE cep_outbox (
  monitor_session_id BIGINT NOT NULL COMMENT '전달할 입력의 세션',
  input_seq BIGINT NOT NULL COMMENT '전달할 입력의 순번',
  completed BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'CEP가 받았는지',
  CONSTRAINT pk_cep_outbox PRIMARY KEY (monitor_session_id, input_seq),
  CONSTRAINT fk_cep_outbox_input_result FOREIGN KEY (monitor_session_id, input_seq) REFERENCES input_result (monitor_session_id, input_seq) ON DELETE CASCADE ON UPDATE RESTRICT  -- FK-23
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-45 CEP 전달 대기 — CEP에 아직 전달되지 않은 입력 표시. CEP 재시작 시 여기서 다시 보냄. 보관: 세션 종료 후 5년';
