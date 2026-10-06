-- =====================================================================
-- 003_create_confirmed_snapshot.sql — T-46 confirmed_snapshot (확정 요약) 추가
-- 근거: CR-03, DB 건의안 0001 #3
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- ---------------------------------------------------------------------
-- T-46 confirmed_snapshot — 확정 요약 (근거 건의안 0001 #3)
-- ---------------------------------------------------------------------
CREATE TABLE confirmed_snapshot (
  monitor_session_id BIGINT NOT NULL COMMENT '소속 세션',
  snapshot_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '요약의 SHA-256',
  payload JSON NOT NULL COMMENT '확인된 세션 요약(통계·사건 수). 원 관측은 넣지 않음',
  CONSTRAINT pk_confirmed_snapshot PRIMARY KEY (monitor_session_id, snapshot_fingerprint),
  CONSTRAINT fk_confirmed_snapshot_monitor_session FOREIGN KEY (monitor_session_id) REFERENCES monitor_session (monitor_session_id) ON DELETE CASCADE ON UPDATE RESTRICT  -- FK-24
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-46 확정 요약 — 확인 응답을 보낸 시점의 세션 요약. 응답 유실 시 확정 범위 증명. 보관: 세션 종료 후 5년';
