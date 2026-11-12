-- =====================================================================
-- 017_create_social_identity_password_reset_token.sql — 명세서 V2.6 → V2.7
-- 소셜 로그인 연결과 비밀번호 재설정 링크 토큰을 저장한다(계획 0088, docs/design/social-login-password-reset-handoff.md).
--   T-52 social_identity와 UK-18(제공자, 제공자 사용자 ID)·UK-19(계정, 제공자), FK-29(계정, CASCADE), CHECK 1개를 더한다.
--   T-53 password_reset_token과 UK-20(토큰 해시), FK-30(계정, CASCADE), CHECK 2개를 더한다.
-- 기존 테이블은 바꾸지 않는다. user_account도 그대로다 — 소셜 전용 계정은 password_hash에 고정값 '!no-password'를 넣는다
--   (BCrypt 형식이 아니라 어떤 비밀번호와도 맞지 않는다. database/README.md 9장).
-- 기존 행은 그대로다. 두 기능은 API에서 기본 꺼짐이고, 이 파일을 적용한 뒤에 켠다(켠 기능의 표가 없으면 API가 시작하지 않는다).
-- 보조 인덱스는 두지 않는다(7장 — 인덱스는 다른 파일). password_reset_token의 사용자별 조회는 FK-30 자동 인덱스를,
--   social_identity의 FK-29는 UK-19(user_account_id가 앞)를 쓴다.
-- 되돌리기: 먼저 API의 Discord 로그인·비밀번호 재설정을 끈다. 그다음
--   DROP TABLE password_reset_token;
--   DROP TABLE social_identity;
--   소셜로 가입한 계정('!no-password')은 남고, 비밀번호 재설정 없이는 로그인할 수 없다.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE social_identity (
  social_identity_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '소셜 연결 식별자',
  user_account_id BIGINT NOT NULL COMMENT '연결된 계정. 계정 최종 삭제 때 함께 지운다',
  provider VARCHAR(20) NOT NULL COMMENT '제공자 (DISCORD·KAKAO·GOOGLE·GITHUB). 지금 동작은 DISCORD만',
  provider_subject VARCHAR(64) NOT NULL COMMENT '제공자의 바뀌지 않는 사용자 ID (Discord id·Kakao id·Google sub·GitHub id). 이메일·이름·제공자 토큰은 저장하지 않는다',
  linked_at DATETIME(3) NOT NULL COMMENT '연결 시각',
  CONSTRAINT pk_social_identity PRIMARY KEY (social_identity_id),
  CONSTRAINT ux_social_identity_subject UNIQUE (provider, provider_subject),  -- UK-18: 제공자 사용자 하나는 계정 하나에만
  CONSTRAINT ux_social_identity_account UNIQUE (user_account_id, provider),  -- UK-19: 계정 하나는 제공자마다 연결 하나
  CONSTRAINT fk_social_identity_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-29
  CONSTRAINT ck_social_identity_provider CHECK (provider IN ('DISCORD', 'KAKAO', 'GOOGLE', 'GITHUB'))  -- 허용값: DISCORD / KAKAO / GOOGLE / GITHUB
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-52 소셜 로그인 연결 — 계정과 소셜 제공자 사용자 ID';

CREATE TABLE password_reset_token (
  password_reset_token_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '재설정 토큰 식별자',
  user_account_id BIGINT NOT NULL COMMENT '토큰 주인. 계정 최종 삭제 때 함께 지운다',
  token_hash CHAR(64) NOT NULL COMMENT '링크 토큰의 SHA-256(16진수 소문자 64자). 원문은 저장하지 않는다 — 메일의 링크에만 있다',
  issued_at DATETIME(3) NOT NULL COMMENT '발급 시각',
  expires_at DATETIME(3) NOT NULL COMMENT '만료 시각 (발급 + 30분, posegood.auth.password-reset.lifetime)',
  consumed_at DATETIME(3) NULL COMMENT '사용·무효 시각 (재설정 완료, 새 발급, 비밀번호 변경·탈퇴). NULL: 아직 쓸 수 있음',
  CONSTRAINT pk_password_reset_token PRIMARY KEY (password_reset_token_id),
  CONSTRAINT ux_password_reset_token_hash UNIQUE (token_hash),  -- UK-20
  CONSTRAINT fk_password_reset_token_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-30
  CONSTRAINT ck_password_reset_token_hash CHECK (CHAR_LENGTH(token_hash) = 64),  -- 허용값: SHA-256 16진수 64자
  CONSTRAINT ck_password_reset_token_expires CHECK (expires_at > issued_at)  -- 허용값: 발급 이후
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-53 비밀번호 재설정 토큰 — 일회용 메일 링크 토큰 해시와 사용 상태';
