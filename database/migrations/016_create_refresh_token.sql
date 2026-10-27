-- =====================================================================
-- 016_create_refresh_token.sql — 명세서 V2.5 → V2.6
-- 로그인을 JWT access 토큰(30분, 저장 안 함) + 로그인 유지 토큰(refresh, 14일)으로 바꾼다(ADR 0031).
--   T-51 refresh_token과 UK-17(토큰 해시), FK-28(사용자, CASCADE), CHECK 4개를 더한다.
--   함께: user_account.sound_alert_enabled 기본값을 거짓 → 참(FE 화면 기본값). 기존 사용자의 값은 그대로다.
--   함께: baseline_posture.client_registration_uuid 설명만 바꾼다(WebSocket 등록 삭제, 값·제약 그대로).
-- 기존 행은 그대로다. SPRING_SESSION·SPRING_SESSION_ATTRIBUTES는 API가 더 쓰지 않지만 지우지 않는다.
--   남아 있는 로그인 세션은 의미가 없어지므로 적용 뒤 모든 사용자는 다시 로그인한다.
-- 되돌리기: DROP TABLE refresh_token;
--   ALTER TABLE user_account MODIFY sound_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT '알림 켜기·끄기 (API preferences.alerts_on). 측정 시작 때 monitor_session.alert_enabled로 복사한다. 기본값(DB 거짓 / FE 켜짐)과 컬럼 이름 변경 여부는 미정';
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE refresh_token (
  refresh_token_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '로그인 유지 토큰 식별자',
  user_account_id BIGINT NOT NULL COMMENT '토큰 주인. 계정 최종 삭제 때 함께 지운다',
  token_hash CHAR(64) NOT NULL COMMENT '토큰 원문의 SHA-256(16진수 소문자 64자). 원문은 저장하지 않는다 — 앱의 HttpOnly 쿠키에만 있다',
  issued_at DATETIME(3) NOT NULL COMMENT '발급 시각',
  expires_at DATETIME(3) NOT NULL COMMENT '만료 시각 (발급 + 14일, posegood.auth.refresh-lifetime)',
  rotated_at DATETIME(3) NULL COMMENT '새 토큰으로 바꾼 시각. NULL: 아직 쓰지 않음. 바꾼 뒤 유예(30초) 안의 재사용은 허용하고, 그 뒤 재사용은 탈취로 보고 그 사용자의 토큰을 모두 철회한다',
  revoked_at DATETIME(3) NULL COMMENT '철회 시각 (로그아웃·비밀번호 변경·탈퇴·재사용 감지). NULL: 철회 안 됨',
  CONSTRAINT pk_refresh_token PRIMARY KEY (refresh_token_id),
  CONSTRAINT ux_refresh_token_token_hash UNIQUE (token_hash),  -- UK-17
  CONSTRAINT fk_refresh_token_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,  -- FK-28
  CONSTRAINT ck_refresh_token_token_hash CHECK (CHAR_LENGTH(token_hash) = 64),  -- 허용값: SHA-256 16진수 64자
  CONSTRAINT ck_refresh_token_expires_at CHECK (expires_at > issued_at),  -- 허용값: 발급 이후
  CONSTRAINT ck_refresh_token_rotated_at CHECK (rotated_at >= issued_at),  -- 허용값: 발급 이후
  CONSTRAINT ck_refresh_token_revoked_at CHECK (revoked_at >= issued_at)  -- 허용값: 발급 이후
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-51 로그인 유지 토큰 — refresh 토큰 해시와 교체·철회 상태';

-- 알림 기본값: 새 계정은 알림 켜짐으로 시작한다. 기존 행은 바꾸지 않는다
ALTER TABLE user_account MODIFY sound_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE COMMENT '알림 켜기·끄기 (API preferences.alerts_on). 측정 시작 때 monitor_session.alert_enabled로 복사한다. 기본값 참(켜짐) — FE 화면 기본값에 맞춤(2026-10-27). 컬럼 이름 변경 여부는 미정';

-- 등록 식별자 설명: WebSocket 등록(서버 발급)을 지웠다
ALTER TABLE baseline_posture MODIFY client_registration_uuid VARCHAR(36) NOT NULL COMMENT '등록 식별자(UUID). 앱이 등록마다 한 번 발급하고 재전송에도 같은 값을 보낸다 — (사용자, 등록 식별자) 유일 제약(UK-16)이 중복 저장을 막는다. 등록은 B1뿐(WebSocket 등록은 V2.6에서 삭제)';
