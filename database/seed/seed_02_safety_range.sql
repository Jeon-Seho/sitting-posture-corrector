-- =====================================================================
-- seed_02_safety_range.sql — 절대 안전 범위 (T-28 safety_range)
-- 명세서 V2.0 / 적용 순서 2
--
-- 현재 행 없음 — 값의 근거가 아직 없다.
--   파라미터 SAFETY_RANGE_<특징값>의 결정 주체는 모델 + PI, 결정 시점은 측면 검증 이후다 (DB-01 4장).
--   프로토타입 코드의 headGap 0.22 / offset 0.20 / tilt 0.13은 기준 대비 변화 임계라 절대 범위로 쓰지 않는다.
-- 영향: 행이 없는 특징값은 기준 자세 등록 시 안전 범위 검사(BR-04)를 할 수 없다.
--   백엔드는 범위 행이 없으면 검사를 건너뛰고, 그 사실을 로그로 남긴다.
-- 값이 정해지면 아래 형식으로 채운다 (상·하한 중 하나는 필수 — ck_safety_range_bound).
--   INSERT INTO safety_range (feature_code, lower_bound, upper_bound, basis) VALUES
--     ('HEAD_GAP', <하한 또는 NULL>, <상한 또는 NULL>, '<근거 — 측면 검증 결과 등>');
-- =====================================================================
SET NAMES utf8mb4;
USE posture_service;
