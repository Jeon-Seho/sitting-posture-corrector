-- =====================================================================
-- 007_create_client_record.sql — T-50 client_record (앱 기록 원문) 추가
-- 근거: CR-03, DB 건의안 0001 #8
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- ---------------------------------------------------------------------
-- T-50 client_record — 앱 기록 원문 (근거 건의안 0001 #8)
-- ---------------------------------------------------------------------
CREATE TABLE client_record (
  user_account_id BIGINT NOT NULL COMMENT '기록 소유자',
  client_record_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '앱이 만든 기록 식별자',
  record_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '같은 식별자 재전송 시 내용 일치 확인용 SHA-256',
  payload JSON NOT NULL COMMENT '기록 원문(요약·사건·적용 설정). 영상·좌표 없음',
  created_at DATETIME(3) NOT NULL COMMENT '저장 시각',
  CONSTRAINT pk_client_record PRIMARY KEY (user_account_id, client_record_id),
  CONSTRAINT fk_client_record_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT  -- FK-26
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-50 앱 기록 원문 — 앱이 측정 종료 때 만든 기록 원문(JSON). 임시 — 세션·이벤트로 기록 화면을 다시 만들 수 있게 되면 없앤다';
