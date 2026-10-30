-- =====================================================================
-- 013_alter_feature_archive.sql — 명세서 V2.3 → V2.4 (1/2)
-- feature_archive를 세션 폴더 1행 기준으로 맞춘다(「DB-V2.4-변경사항」 3장·4.2절, 결정 2·4·8).
--   row_count와 CHECK ck_feature_archive_row_count를 지우고, 폴더 기준으로 설명을 바꾼다.
-- 기존 행은 그대로다. row_count 값은 사라진다 — 쓰는 코드·요구사항이 없다(결정 4). J1 구현 전이라 보통 행이 없다.
-- CHECK를 컬럼보다 먼저 지운다(CHECK가 쓰는 컬럼은 바로 지울 수 없다). 한 문장이라 중간에 멈추지 않는다.
-- 되돌리기: 컬럼·CHECK·설명을 V2.3으로 돌린다. 지운 row_count 값은 되살릴 수 없어 기존 행은 0이 된다.
--   ALTER TABLE feature_archive
--     ADD COLUMN row_count INT NOT NULL COMMENT '파일 행 수' AFTER range_end_at,
--     ADD CONSTRAINT ck_feature_archive_row_count CHECK (row_count >= 0),
--     MODIFY file_uri VARCHAR(500) COLLATE utf8mb4_bin NOT NULL COMMENT 'HDFS 파일 위치. 파일 하나는 한 세션의 특징값만 담음. 특징값 계산 방식은 파일 경로·메타 정보에 남긴다',
--     MODIFY range_start_at DATETIME(3) NOT NULL COMMENT '파일에 담긴 첫 특징값 시각',
--     MODIFY range_end_at DATETIME(3) NOT NULL COMMENT '파일에 담긴 마지막 특징값 시각',
--     MODIFY deleted_at DATETIME(3) NULL COMMENT '삭제 처리로 파일을 지운 시각. NULL: 파일 보존 중. 값이 찬 행은 삭제 배치가 세션과 함께 지움 (재시도 지점)',
--     COMMENT = 'T-35 특징값 적재 기록 — HDFS 특징값 파일 위치·시각 범위';
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE feature_archive
  DROP CHECK ck_feature_archive_row_count,
  DROP COLUMN row_count,
  MODIFY file_uri VARCHAR(500) COLLATE utf8mb4_bin NOT NULL COMMENT 'HDFS 세션 폴더 경로 /data/users/{user_account_id}/{세션 시작일(KST)}/{client_session_uuid}/. 세션 하나 = 폴더 하나(파일 3개) = 1행. Spark J1이 기록한다',
  MODIFY range_start_at DATETIME(3) NOT NULL COMMENT '세션 폴더에 담긴 첫 좌표 프레임 시각',
  MODIFY range_end_at DATETIME(3) NOT NULL COMMENT '세션 폴더에 담긴 마지막 좌표 프레임 시각',
  MODIFY deleted_at DATETIME(3) NULL COMMENT '세션 폴더를 지운 시각. NULL: 폴더 보존 중. 값이 찬 행은 Spark J3가 세션과 함께 지운다 (재시도 지점)',
  COMMENT = 'T-35 특징값 적재 기록 — HDFS 세션 폴더 위치·시각 범위 (세션 폴더 1행, Spark J1이 기록)';
