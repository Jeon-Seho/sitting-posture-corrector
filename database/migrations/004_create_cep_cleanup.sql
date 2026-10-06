-- =====================================================================
-- 004_create_cep_cleanup.sql — T-47 cep_cleanup (CEP 정리 재시도) 추가
-- 근거: CR-03, DB 건의안 0001 #4
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- ---------------------------------------------------------------------
-- T-47 cep_cleanup — CEP 정리 재시도 (근거 건의안 0001 #4)
-- ---------------------------------------------------------------------
CREATE TABLE cep_cleanup (
  client_session_uuid VARCHAR(36) NOT NULL COMMENT '지워진 세션의 클라이언트 식별자. 세션 행이 지워진 뒤에도 남아야 하므로 FK 없음',
  created_at DATETIME(3) NOT NULL COMMENT '정리 요청 시각',
  attempted_at DATETIME(3) NULL COMMENT '마지막 재시도 시각. NULL: 아직 시도 안 함',
  CONSTRAINT pk_cep_cleanup PRIMARY KEY (client_session_uuid),
  CONSTRAINT ck_cep_cleanup_client_session_uuid CHECK (CHAR_LENGTH(client_session_uuid) = 36)  -- 허용값: UUID
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-47 CEP 정리 재시도 — 세션·계정 삭제 후 CEP 쪽 정리 재시도 목록. 정리가 끝나면 지우고, 끝나지 않은 행은 생성 후 5년 뒤 지움';
