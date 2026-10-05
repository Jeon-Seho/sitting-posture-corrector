-- =====================================================================
-- 006_add_auth_epoch_user_account.sql — user_account.auth_epoch 추가
-- 근거: CR-03, DB 건의안 0001 #6
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

ALTER TABLE user_account
  ADD COLUMN auth_epoch BIGINT NOT NULL DEFAULT 0 COMMENT '비밀번호 변경·탈퇴 때 올려 다른 기기의 기존 로그인을 끊음',
  ADD CONSTRAINT ck_user_account_auth_epoch CHECK (auth_epoch >= 0);  -- 허용값: 0 이상
