-- =====================================================================
-- 018_move_password_hash_to_local_credential.sql — 명세서 V2.7 → V2.8 (1/2, 2/2는 019 이메일 인증 토큰)
-- 비밀번호를 계정 표에서 떼어 로그인 수단 표로 옮긴다(계획 0096, docs/plans/active/0096-account-email-link-and-verification.md).
--   T-54 local_credential과 FK-31(계정, CASCADE)을 더하고, user_account.password_hash를 옮긴 뒤 지운다.
--   local_credential 행이 있으면 비밀번호가 있는 계정이다. 소셜 전용 계정의 고정값 '!no-password'는 옮기지 않는다(행 없음 = 비밀번호 없음).
--   PK(user_account_id)가 FK-31의 인덱스를 겸하므로 보조 인덱스는 없다.
--
-- 적용 전 확인 — 아래 결과가 0이어야 한다. 0이 아니면 BCrypt도 고정값도 아닌 값이 있다는 뜻이고, 그 행은 옮겨지지 않으므로 먼저 확인한다.
--   SELECT COUNT(*) FROM user_account WHERE password_hash NOT LIKE '$2%' AND password_hash <> '!no-password';
--   (옮길 행 수도 적어 둔다) SELECT COUNT(*) FROM user_account WHERE password_hash LIKE '$2%';
-- 적용 후 확인 — local_credential 행 수가 위에서 적어 둔 옮길 행 수와 같고, user_account에 password_hash 컬럼이 없다.
--   SELECT COUNT(*) FROM local_credential;
--   SHOW COLUMNS FROM user_account LIKE 'password_hash';   -- 0행
--
-- 적용 순서: 이 파일을 적용하면 V2.7용 API는 user_account.password_hash를 찾지 못해 로그인·가입·비밀번호 변경이 실패한다.
--   018·019 적용과 V2.8용 API 배포를 같은 점검 시간에 한다(018 → 019 → 새 API).
-- MySQL DDL은 자동 커밋이다. INSERT 뒤 DROP COLUMN이 실패하면 표와 행은 남고 컬럼도 남는다 — 이때는 원인을 고친 뒤
--   DROP COLUMN만 다시 실행한다(INSERT를 다시 실행하면 PK 중복으로 실패한다).
--
-- 되돌리기: 먼저 API를 V2.7용으로 되돌린다. 그다음 (Workbench 안전 업데이트 모드라 UPDATE에 기본 키 조건을 둔다)
--   ALTER TABLE user_account ADD COLUMN password_hash VARCHAR(100) NULL COMMENT '비밀번호 단방향 해시. 평문 저장·응답 노출 금지' AFTER login_email;
--   UPDATE user_account u JOIN local_credential c ON c.user_account_id = u.user_account_id
--     SET u.password_hash = c.password_hash WHERE u.user_account_id > 0;
--   UPDATE user_account SET password_hash = '!no-password' WHERE user_account_id > 0 AND password_hash IS NULL;
--   ALTER TABLE user_account MODIFY password_hash VARCHAR(100) NOT NULL COMMENT '비밀번호 단방향 해시. 평문 저장·응답 노출 금지';
--   DROP TABLE local_credential;
--   비밀번호 없는 계정은 다시 '!no-password'가 된다. 데이터는 잃지 않는다.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE local_credential (
  user_account_id BIGINT NOT NULL COMMENT '계정. 계정 하나에 하나. 행이 없으면 비밀번호 없는 계정(소셜 전용). 계정 최종 삭제 때 함께 지운다',
  password_hash VARCHAR(100) NOT NULL COMMENT '비밀번호 단방향 해시(BCrypt). 평문 저장·응답 노출 금지',
  CONSTRAINT pk_local_credential PRIMARY KEY (user_account_id),
  CONSTRAINT fk_local_credential_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT  -- FK-31
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-54 비밀번호 로그인 수단 — 계정의 비밀번호 해시';

INSERT INTO local_credential (user_account_id, password_hash)
  SELECT user_account_id, password_hash FROM user_account WHERE password_hash LIKE '$2%';

ALTER TABLE user_account DROP COLUMN password_hash;
