-- =====================================================================
-- seed_04_threshold_policy.sql — 기본 판정 정책 (T-29 threshold_policy)
-- 명세서 V0.3 / 적용 순서 4
--
-- 가입한 사용자는 판정 정책을 반드시 가리킨다 (user_account.threshold_policy_id NOT NULL).
-- 백엔드는 가입 시 policy_name으로 기본 정책을 찾는다 (UK-12).
--
-- ※ 임시값이다. 값이 확정되지 않았다.
-- | 컬럼                | 값   | 근거                                   | 결정 주체 (DB-01 4장) |
-- |---------------------|------|----------------------------------------|----------------------|
-- | threshold           | 0.500| 임시 — 확률 중간값. 화면 자세 점수 50점(FE 범위 5~50점의 끝) | 모델 (ROC 분석) |
-- | hold_seconds        | 3.0  | REQ 10장 #4 초기값 3초 (후보 3~5초)     | 모델 + PM |
-- | recover_seconds     | 2.0  | 임시 — FE 설정 범위 1~10초, 0.5 단위 안 | 모델 + PM |
-- | realert_seconds     | 30   | 임시 — FE 설정 범위 15~180초, 5 단위 안 | PM + FE |
-- | notify_max_per_hour | 12   | 임시 — 근거 없음 (QUR-002가 상한만 요구)| PM |
--
-- 값이 확정되면 이 행을 고치지 않는다. 판정 정책은 한 번 기록하면 바꾸지 않는다 (BR-65).
--   이미 세션이 이 행을 가리키고 있을 수 있기 때문이다.
--   확정값은 이름 'DEFAULT'로 새 행을 추가하고, 백엔드의 기본 정책 이름 설정을 바꾼다.
--   이 임시 정책 행은 과거 세션의 판정 근거로 남는다.
-- =====================================================================
SET NAMES utf8mb4;
USE posture_service;

INSERT INTO threshold_policy
  (threshold, hold_seconds, recover_seconds, realert_seconds, notify_max_per_hour, policy_name, created_by, created_at)
VALUES
  (0.500, 3.0, 2.0, 30, 12, 'DEFAULT_TEMP', 'SYSTEM', '2026-10-02 00:00:00.000');
