-- =====================================================================
-- seed_01_feature_def.sql — 특징값 정의 (T-27 feature_def)
-- 명세서 V0.3 / 적용 순서 1
--
-- 근거: model/prototype/pose.ts의 Features = { headGap, offset, tilt, quality }
--   quality는 검출 품질 지표라 자세 특징값에서 뺀다.
--   세 값 모두 어깨 너비로 나눈 무차원값이다 → unit NULL, scale_invariant TRUE.
-- 확정 상태: 프로토타입 기준 3개. REQ SFR-014 목록(목 전방 이동·어깨 기울기·상체 기울기·좌우 균형)이
--   확정되면 행을 추가한다. 이름과 SFR-014 항목의 대응은 모델 담당 확인 필요.
-- 코드는 바꾸지 않는다 (DB-04 D-36). 계산 방식이 바뀌면 새 코드를 추가한다.
-- =====================================================================
USE posture_service;

INSERT INTO feature_def (feature_code, feature_name, unit, scale_invariant, distance_proxy) VALUES
  ('HEAD_GAP',       '머리-어깨 간격',  NULL, TRUE, FALSE),   -- pose.ts headGap (SFR-014 목 전방 이동에 대응 — 확인 필요)
  ('LATERAL_OFFSET', '좌우 치우침',     NULL, TRUE, FALSE),   -- pose.ts offset  (SFR-014 좌우 균형에 대응 — 확인 필요)
  ('SHOULDER_TILT',  '어깨 기울기',     NULL, TRUE, FALSE);   -- pose.ts tilt
