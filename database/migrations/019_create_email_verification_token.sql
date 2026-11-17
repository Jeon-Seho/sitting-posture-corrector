-- =====================================================================
-- 019_create_email_verification_token.sql — 명세서 V2.7 → V2.8 (2/2, 1/2는 018 비밀번호 표 분리)
-- 이메일 가입 전에 메일함 주인인지 확인하는 일회용 링크 토큰을 저장한다(계획 0096, docs/plans/active/0096-account-email-link-and-verification.md).
--   T-55 email_verification_token과 UK-21(토큰 해시), CHECK 2개를 더한다.
--   가입 전이라 계정이 없으므로 주인은 이메일로 둔다(FK 없음). 원문 토큰은 메일 링크에만 있고 DB에는 SHA-256만 둔다.
--   계정 최종 삭제 때 CASCADE로 지워지지 않는다. 대신 API가 만료된 지 하루가 지난 행을 매일 지운다(password_reset_token과 같음).
-- 기존 테이블·행은 바꾸지 않는다. 이메일 인증은 API에서 기본 꺼짐이고, 이 파일을 적용한 뒤에 켠다.
-- 보조 인덱스는 두지 않는다(7장 — 인덱스는 다른 파일). 이메일로 찾는 조회(재발송 간격, 이전 토큰 무효화)용
--   (login_email, issued_at) 인덱스는 DB-05 인덱스 시트에서 정한다. 그 전에는 행이 적어(매일 정리) 표 전체를 읽어도 된다.
-- 되돌리기: 먼저 API의 이메일 인증을 끈다. 그다음
--   DROP TABLE email_verification_token;
--   아직 쓰지 않은 인증 링크는 모두 무효가 된다. 계정과 다른 표는 영향 없다.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE email_verification_token (
  email_verification_token_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '인증 토큰 식별자',
  login_email VARCHAR(254) NOT NULL COMMENT '인증할 이메일(정규화: 앞뒤 공백 제거·소문자). 가입 전이라 계정 FK가 없다',
  token_hash CHAR(64) NOT NULL COMMENT '링크 토큰의 SHA-256(16진수 소문자 64자). 원문은 저장하지 않는다 — 메일의 링크에만 있다',
  issued_at DATETIME(3) NOT NULL COMMENT '발급 시각',
  expires_at DATETIME(3) NOT NULL COMMENT '만료 시각 (발급 + 설정값)',
  consumed_at DATETIME(3) NULL COMMENT '사용·무효 시각 (가입 완료, 새 발급). NULL: 아직 쓸 수 있음',
  CONSTRAINT pk_email_verification_token PRIMARY KEY (email_verification_token_id),
  CONSTRAINT ux_email_verification_token_hash UNIQUE (token_hash),  -- UK-21
  CONSTRAINT ck_email_verification_token_hash CHECK (CHAR_LENGTH(token_hash) = 64),  -- 허용값: SHA-256 16진수 64자
  CONSTRAINT ck_email_verification_token_expires CHECK (expires_at > issued_at)  -- 허용값: 발급 이후
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-55 이메일 인증 토큰 — 가입 전 메일함 소유 확인용 일회용 링크 토큰 해시와 사용 상태';
