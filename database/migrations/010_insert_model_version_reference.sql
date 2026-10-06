-- =====================================================================
-- 010_insert_model_version_reference.sql — model_version 행 REFERENCE-RULE-1 추가
-- 근거: CR-03, DB 건의안 0001 #10
-- 대상: schema_V1_0.sql로 만든 DB → V1.1. migrations/ 번호순으로 적용한다.
-- 이미 적용한 파일은 고치지 않는다. 변경은 새 번호 파일로 추가한다 (작업규칙 4.7).
-- =====================================================================

SET NAMES utf8mb4;
USE posture_service;

-- 서버(백엔드)가 실제로 쓰는 판정 규칙을 모델 버전으로 등록한다.
-- 특징값 계산(feature_version)과 점수 계산은 RULE-PROTO-1과 같다 — 저장소 결정 0013. 이름이 다른 같은 규칙이다.
-- 새 DB는 seed_03에 같은 행이 있다. 이미 있으면 넣지 않는다.
-- 모델 버전 행은 수정하지 않는다. 바뀌면 새 행을 추가한다 (DB-03 5장).
INSERT INTO model_version
  (model_version_code, model_type, feature_version, window_length_sec, window_stride_sec, artifact_uri, released_at, description)
SELECT 'REFERENCE-RULE-1', 'RULE', 'FEAT-PROTO-1', NULL, NULL, NULL, '2026-10-05 00:00:00.000',
       '서버 규칙 기반 판정 (reference-feature-rule-v1). 점수 계산은 RULE-PROTO-1(pose.ts referenceScore)과 같다 (결정 0013)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM model_version WHERE model_version_code = 'REFERENCE-RULE-1');
