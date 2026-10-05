-- =====================================================================
-- seed_03_model_version.sql — 모델 버전 (T-32 model_version)
-- 명세서 V1.1 / 적용 순서 4 (README 1장)
--
-- 세션은 판정에 쓴 모델 버전을 반드시 참조한다 (BR-28, FK-11). 행이 없으면 세션을 만들 수 없다.
-- LSTM 연결 전에는 규칙 기반이 실제 판정을 맡으므로 규칙 기반 행을 넣는다 (DB-02 E-27, REQ 10장 #1).
--   RULE-PROTO-1     — 프로토타입 규칙 (model/prototype/pose.ts referenceScore)
--   REFERENCE-RULE-1 — 서버 규칙 (reference-feature-rule-v1). 점수 계산은 RULE-PROTO-1과 같다 (결정 0013, DB 건의안 0001 #10)
--   이미 만든 DB에는 REFERENCE-RULE-1을 migrations/010으로 넣는다.
-- 작업규칙 1.1의 시드 목록(seed_03_posture_state_code, seed_05_capture_protocol)은
--   CR-01 개정안에 따라 이 파일로 바뀐다 — CR-01 승인 대기.
-- feature_version 'FEAT-PROTO-1'은 baseline_posture.feature_version에도 같은 값을 쓴다.
-- 버전 행은 수정하지 않는다. 모델이 바뀌면 새 행을 추가한다 (DB-03 5장).
-- =====================================================================
SET NAMES utf8mb4;
USE posture_service;

INSERT INTO model_version
  (model_version_code, model_type, feature_version, window_length_sec, window_stride_sec, artifact_uri, released_at, description)
VALUES
  ('RULE-PROTO-1', 'RULE', 'FEAT-PROTO-1', NULL, NULL, NULL, '2026-10-02 00:00:00.000',
   '프로토타입 규칙 기반 판정 (model/prototype/pose.ts referenceScore). LSTM 연결 전 기본 판정'),
  ('REFERENCE-RULE-1', 'RULE', 'FEAT-PROTO-1', NULL, NULL, NULL, '2026-10-05 00:00:00.000',
   '서버 규칙 기반 판정 (reference-feature-rule-v1). 점수 계산은 RULE-PROTO-1(pose.ts referenceScore)과 같다 (결정 0013)');
