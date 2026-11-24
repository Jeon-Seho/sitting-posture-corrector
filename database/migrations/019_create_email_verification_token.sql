-- =====================================================================
-- 019_create_email_verification_token.sql — 명세서 V2.7 → V2.8 (2/2, 1/2는 018 비밀번호 표 분리)
-- 이메일 가입 전에 메일함 주인인지 확인하는 6자리 인증 코드의 대기 상태를 저장한다(계획 0096, docs/plans/active/0096-account-email-link-and-verification.md).
--   T-55 email_verification_token과 UK-21(요청 번호 해시), CHECK 3개를 더한다.
--   흐름: 인증 요청 → 메일로 6자리 코드, 브라우저에는 무작위 요청 번호(HttpOnly 쿠키) → 같은 브라우저에서 코드 확인(verified_at)
--   → 가입 성공 때 한 번 소비(consumed_at). 요청 번호와 코드의 원문은 저장하지 않고 SHA-256만 둔다.
--   코드는 경우의 수가 100만이라 요청마다 틀린 시도를 attempt_count로 세어 API가 5회에서 막는다.
--   가입 전이라 계정이 없으므로 주인은 이메일로 둔다(FK 없음). 계정 최종 삭제 때 CASCADE로 지워지지 않는다.
--   대신 API가 만료된 지 하루가 지난 행을 매일 지운다(password_reset_token과 같음).
-- 2026-11-23: 운영 적용 전에 링크 토큰 기준(칼럼 6개)에서 코드 기준(칼럼 9개)으로 고쳤다 — code_hash·attempt_count·verified_at 추가,
--   token_hash는 링크 토큰 대신 요청 번호의 해시. 가입 인증은 코드, 비밀번호 재설정은 링크로 정했다(계획 0096 결정 기록).
-- 기존 테이블·행은 바꾸지 않는다. 이메일 인증은 API에서 기본 꺼짐이고, 이 파일을 적용한 뒤에 켠다.
-- 보조 인덱스는 두지 않는다(7장 — 인덱스는 다른 파일). 이메일로 찾는 조회(재발송 간격, 이전 요청 무효화)용
--   (login_email, issued_at) 인덱스는 DB-05 인덱스 시트에서 정한다. 그 전에는 행이 적어(매일 정리) 표 전체를 읽어도 된다.
-- 되돌리기: 먼저 API의 이메일 인증을 끈다. 그다음
--   DROP TABLE email_verification_token;
--   진행 중인 인증은 모두 무효가 된다(사용자는 코드를 다시 받는다). 계정과 다른 표는 영향 없다.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE email_verification_token (
  email_verification_token_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '인증 요청 식별자',
  login_email VARCHAR(254) NOT NULL COMMENT '인증할 이메일(정규화: 앞뒤 공백 제거·소문자). 가입 전이라 계정 FK가 없다',
  token_hash CHAR(64) NOT NULL COMMENT '요청 번호의 SHA-256(16진수 소문자 64자). 원문은 브라우저의 HttpOnly 쿠키에만 있다',
  code_hash CHAR(64) NOT NULL COMMENT '「요청 번호:6자리 코드」의 SHA-256(16진수 소문자 64자). 코드 원문은 메일에만 있다',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '코드 확인 시도 횟수. API가 정한 한도(5회)에 닿으면 그 요청은 더 확인하지 않는다',
  issued_at DATETIME(3) NOT NULL COMMENT '발급 시각 (같은 이메일 재발송 간격의 기준)',
  expires_at DATETIME(3) NOT NULL COMMENT '만료 시각 (발급 + 설정값). 코드 확인 뒤에도 이 시각까지 가입해야 한다',
  verified_at DATETIME(3) NULL COMMENT '코드 확인 시각. NULL: 아직 확인 전',
  consumed_at DATETIME(3) NULL COMMENT '사용·무효 시각 (가입 완료, 같은 이메일 새 요청). NULL: 아직 쓸 수 있음',
  CONSTRAINT pk_email_verification_token PRIMARY KEY (email_verification_token_id),
  CONSTRAINT ux_email_verification_token_hash UNIQUE (token_hash),  -- UK-21
  CONSTRAINT ck_email_verification_token_hash CHECK (CHAR_LENGTH(token_hash) = 64),  -- 허용값: SHA-256 16진수 64자
  CONSTRAINT ck_email_verification_token_code_hash CHECK (CHAR_LENGTH(code_hash) = 64),  -- 허용값: SHA-256 16진수 64자
  CONSTRAINT ck_email_verification_token_expires CHECK (expires_at > issued_at)  -- 허용값: 발급 이후
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-55 이메일 인증 토큰 — 가입 전 메일함 소유 확인용 6자리 코드의 요청 번호·코드 해시와 확인·사용 상태';
