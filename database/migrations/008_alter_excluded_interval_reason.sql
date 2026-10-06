-- =====================================================================
-- 008_alter_excluded_interval_reason.sql — excluded_interval.exclusion_reason에 MISSING 추가
-- 근거: CR-03, DB 건의안 0001 #9
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- 제외 사유 우선순위 (BR-52): 일시정지 → 누락 → 자리 비움 → 판정 불가
ALTER TABLE excluded_interval DROP CHECK ck_excluded_interval_exclusion_reason;
ALTER TABLE excluded_interval ADD CONSTRAINT ck_excluded_interval_exclusion_reason CHECK (exclusion_reason IN ('PAUSE', 'MISSING', 'ABSENCE', 'UNMEASURABLE'));  -- 허용값: PAUSE / MISSING / ABSENCE / UNMEASURABLE
