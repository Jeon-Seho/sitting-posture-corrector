-- =====================================================================
-- 009_add_profile_user_account.sql — user_account.age, occupation 추가
-- 근거: CR-03, DB 건의안 0001 #11
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- 선택 입력(NULL 허용). 탈퇴 처리 때 식별 컬럼과 함께 NULL로 비운다.
-- display_name 설명에서 "나이·직업은 받지 않음"을 뺀다 (타입·NULL 허용은 그대로).
ALTER TABLE user_account
  ADD COLUMN age INT NULL COMMENT '가입 시 입력한 나이. 선택. NULL: 입력 안 함 또는 탈퇴 처리 완료',
  ADD COLUMN occupation VARCHAR(80) NULL COMMENT '가입 시 입력한 직업(자유 입력). 선택. NULL: 입력 안 함 또는 탈퇴 처리 완료',
  MODIFY COLUMN display_name VARCHAR(30) NULL COMMENT '표시 이름. NULL: 탈퇴 처리가 끝난 계정 (ACTIVE 계정은 필수)',
  ADD CONSTRAINT ck_user_account_age CHECK (age BETWEEN 1 AND 120);  -- 허용값: 1 ~ 120
