-- =====================================================================
-- 015_alter_baseline_posture_registration.sql — 명세서 V2.4 → V2.5
-- 기준 자세 등록 시각을 서버 시각으로 바꾸고, 재전송은 등록 식별자로 구분한다(ADR 0028).
--   client_registration_uuid(앱이 등록마다 발급하는 UUID)와 UK-16(사용자, 등록 식별자), CHECK를 더하고
--   UK-14(사용자, 등록 시각)를 지운다. registered_at은 설명만 바뀐다(서버가 등록을 받은 시각).
-- 기존 행은 그대로다. 기존 행의 등록 식별자는 UUID()로 채운다(그 행들은 이미 저장돼 재전송될 일이 없다).
-- UK-14는 FK-04(사용자)의 인덱스를 겸하므로, UK-16을 먼저 만든 뒤 지운다(UK-16도 user_account_id로 시작한다).
-- 되돌리기: UK-14를 다시 만들고(같은 사용자·같은 등록 시각 행이 있으면 실패) UK-16·CHECK·컬럼을 지운다.
--   ALTER TABLE baseline_posture ADD CONSTRAINT ux_baseline_posture_registered UNIQUE (user_account_id, registered_at);
--   ALTER TABLE baseline_posture DROP INDEX ux_baseline_posture_registration,
--     DROP CHECK ck_baseline_posture_client_registration_uuid, DROP COLUMN client_registration_uuid,
--     MODIFY registered_at DATETIME(3) NOT NULL COMMENT '보정을 끝낸 시각. FE가 정한 값을 그대로 저장 — 재전송해도 같은 값이라 (사용자, 등록 시각) 유일 제약이 중복 저장을 막는다. 현재 기준 판단에는 쓰지 않는다 (기기 시계 차이)';
-- =====================================================================
SET NAMES utf8mb4;

-- 1) 컬럼을 NULL 허용으로 먼저 더하고 기존 행을 채운다
ALTER TABLE baseline_posture
  ADD COLUMN client_registration_uuid VARCHAR(36) NULL AFTER user_account_id;

UPDATE baseline_posture SET client_registration_uuid = UUID() WHERE client_registration_uuid IS NULL;

-- 2) NOT NULL·설명, 새 UK·CHECK, registered_at 설명
ALTER TABLE baseline_posture
  MODIFY client_registration_uuid VARCHAR(36) NOT NULL COMMENT '등록 식별자(UUID). 앱이 등록마다 한 번 발급하고 재전송에도 같은 값을 보낸다 — (사용자, 등록 식별자) 유일 제약(UK-16)이 중복 저장을 막는다. 서버가 계산한 등록(WebSocket)은 서버가 발급',
  MODIFY registered_at DATETIME(3) NOT NULL COMMENT '등록 시각. 서버가 등록을 받은 시각(KST)이다. 현재 기준 판단에는 쓰지 않는다 — 현재 기준은 baseline_posture_id가 가장 큰 행',
  ADD CONSTRAINT ux_baseline_posture_registration UNIQUE (user_account_id, client_registration_uuid),  -- UK-16
  ADD CONSTRAINT ck_baseline_posture_client_registration_uuid CHECK (CHAR_LENGTH(client_registration_uuid) = 36);  -- 허용값: UUID

-- 3) UK-14 삭제 (FK-04는 이제 UK-16의 인덱스를 쓴다)
ALTER TABLE baseline_posture DROP INDEX ux_baseline_posture_registered;
