# Discord 로그인·비밀번호 재설정 인계 (DB·DevOps)

2026-11-11. BE·FE 코드는 브랜치 `feature/repo-discord-login-password-reset`에 들어 있다. **두 기능 모두 기본 꺼짐**이다.
아래 표(제안 V2.7)를 DB 담당이 적용하고, DevOps가 환경변수를 넣은 뒤에 켠다. 표가 없는 상태에서 기능을 켜면 API가 시작하지 않는다
(`SchemaVerifier`가 켠 기능의 표만 확인함). 이 문서는 [이메일 인계](email-account-handoff.md)의 비밀번호 재설정 부분을 대신한다.
이메일 인증(가입 전 소유 확인)은 이번 범위가 아니다.

## 1. 정한 것

- **비밀번호를 메일로 보내지 않는다. 임시 비밀번호도 만들지 않는다.** 30분짜리 일회용 링크(`#password-reset?token=`)만 보낸다.
  DB에는 토큰의 SHA-256만 저장한다. 재설정을 마치면 그 사용자의 모든 로그인(refresh 토큰)을 끊고, 자동으로 로그인시키지 않는다.
- 재설정 요청은 가입 여부와 관계없이 **같은 응답(202)을 바로** 준다. 계정 확인과 메일 발송은 응답 뒤에 해서, 응답 시간으로도 가입 여부가 드러나지 않는다.
  출처(IP)별로 15분에 5번, 계정별로 60초에 한 번까지만 받는다.
- Discord 로그인은 OAuth 인가 코드 + PKCE(S256)이고, 범위는 `identify email`만 쓴다. Discord 쪽 토큰·이름·이메일은 저장하지 않는다.
  저장하는 값은 Discord 사용자 ID 하나다.
- **Discord 이메일이 기존 계정과 같아도 자동으로 묶지 않는다.** 사용자가 비밀번호로 로그인한 뒤 설정에서 직접 연결한다.
  이메일만으로 묶으면, 제공자 쪽 이메일을 가로챈 사람이 기존 계정에 들어올 수 있기 때문이다.
- Discord로 처음 오는 사용자는 약관·프로필 화면을 거쳐 가입한다. 이메일은 Discord가 확인(verified)한 주소만 쓴다.
  확인된 이메일이 없으면 가입하지 않는다. 이렇게 가입한 계정은 비밀번호가 없다(`password_hash = '!no-password'`, BCrypt 형식이 아니어서 어떤 비밀번호와도 맞지 않음).
  비밀번호는 재설정 메일로 정할 수 있다.
- 주소에는 토큰을 싣지 않는다. 콜백이 refresh 쿠키를 주고 앱은 평소처럼 `POST /auth/refresh`를 부른다. 대기 상태(state·PKCE·가입 대기)는 서버 메모리에 두고, 브라우저에는 무작위 ID만 HttpOnly 쿠키로 준다.
  API가 한 인스턴스로 도는 동안만 맞는 방식이다(ADR 0020). 여러 인스턴스로 늘리면 공유 저장소로 옮겨야 한다.

## 2. DB 담당(유진) — 제안 V2.7

`user_account`는 바꾸지 않는다(`password_hash` NOT NULL 그대로, 소셜 전용 계정은 위의 고정값을 쓴다).
아래 SQL은 **제안**이고, 마이그레이션 번호·주석 형식·ERD·`schema_V2_7.sql`·README·롤백 문서는 DB 절차에 맞춰 확정한다.

```sql
CREATE TABLE social_identity (
  social_identity_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '소셜 연결 식별자',
  user_account_id BIGINT NOT NULL COMMENT '연결된 계정. 계정 최종 삭제 때 함께 지운다',
  provider VARCHAR(20) NOT NULL COMMENT '제공자: DISCORD·KAKAO·GOOGLE·GITHUB (지금 동작은 DISCORD만)',
  provider_subject VARCHAR(64) NOT NULL COMMENT '제공자의 바뀌지 않는 사용자 ID(Discord id·Kakao id·Google sub·GitHub id). 이메일·이름·토큰은 저장하지 않는다',
  linked_at DATETIME(3) NOT NULL COMMENT '연결 시각(KST)',
  CONSTRAINT pk_social_identity PRIMARY KEY (social_identity_id),
  CONSTRAINT ux_social_identity_subject UNIQUE (provider, provider_subject),   -- 한 Discord 사용자는 한 계정에만
  CONSTRAINT ux_social_identity_account UNIQUE (user_account_id, provider),    -- 한 계정은 제공자마다 하나
  CONSTRAINT fk_social_identity_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_social_identity_provider CHECK (provider IN ('DISCORD','KAKAO','GOOGLE','GITHUB'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='계정 ↔ 소셜 제공자 사용자 연결';

CREATE TABLE password_reset_token (
  password_reset_token_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '재설정 토큰 식별자',
  user_account_id BIGINT NOT NULL COMMENT '토큰 주인. 계정 최종 삭제 때 함께 지운다',
  token_hash CHAR(64) NOT NULL COMMENT '링크 토큰의 SHA-256(16진수 소문자). 원문은 메일에만 있다',
  issued_at DATETIME(3) NOT NULL COMMENT '발급 시각',
  expires_at DATETIME(3) NOT NULL COMMENT '만료 시각(발급 + 30분, posegood.auth.password-reset.lifetime)',
  consumed_at DATETIME(3) NULL COMMENT '사용·무효 시각. 재설정 완료, 새 발급, 비밀번호 변경·탈퇴 때 채운다. NULL: 아직 쓸 수 있음',
  CONSTRAINT pk_password_reset_token PRIMARY KEY (password_reset_token_id),
  CONSTRAINT ux_password_reset_token_hash UNIQUE (token_hash),
  CONSTRAINT fk_password_reset_token_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_password_reset_token_hash CHECK (CHAR_LENGTH(token_hash) = 64),
  CONSTRAINT ck_password_reset_token_expires CHECK (expires_at > issued_at),
  INDEX ix_password_reset_token_user_issued (user_account_id, issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='비밀번호 재설정 일회용 링크 토큰 해시';
-- 되돌리기: DROP TABLE password_reset_token; DROP TABLE social_identity;  (먼저 두 기능을 끈다)
```

API가 쓰는 SQL은 `SocialIdentityRepository`·`PasswordResetRepository`에 있다. 원자적 소비는
`UPDATE ... SET consumed_at=? WHERE password_reset_token_id=? AND consumed_at IS NULL AND expires_at>?`이고, 영향 행이 1일 때만 진행한다.
만료된 지 하루가 지난 행은 API가 매일 04:40 KST에 지운다. 탈퇴 최종 삭제(Spark J3)는 FK CASCADE로 함께 지워진다. J3가 다른 방식으로 지운다면 확인이 필요하다.

## 3. DevOps(홍규) — 환경변수

| 변수 | 값 |
| --- | --- |
| `POSEGOOD_APP_URL` | 앱 주소. 예: `https://app.<도메인>/`(로컬 `http://127.0.0.1:5173/`). 콜백 뒤 돌아갈 곳이자 재설정 링크의 기준 |
| `POSEGOOD_DISCORD_CLIENT_ID` / `POSEGOOD_DISCORD_CLIENT_SECRET` | Discord Developer Portal → OAuth2. 비밀값은 secret으로 둔다. ID가 비어 있으면 꺼짐 |
| `POSEGOOD_DISCORD_REDIRECT_URI` | 브라우저 기준 콜백 주소. 예: `https://<API 출처>/api/v2/auth/social/discord/callback`(nginx가 `/api`를 뗀다). Portal의 Redirects에 똑같이 등록 |
| `POSEGOOD_PASSWORD_RESET_ENABLED` | `true`로 켠다(표 적용 후) |
| `POSEGOOD_MAIL_HOST`·`_PORT`(587)·`_USERNAME`·`_PASSWORD`·`POSEGOOD_MAIL_FROM` | SMTP(STARTTLS 필수). 발신 도메인 SPF/DKIM/DMARC 준비 |
| `POSEGOOD_TRUST_FORWARDED_FOR` | nginx 뒤에서 `true`(nginx가 `X-Forwarded-For`를 한 값으로 덮어씀). 아니면 모든 요청이 nginx 주소 하나로 세어진다 |
| `POSEGOOD_COOKIE_SECURE` | HTTPS에서 `true`(기존 그대로) |

프론트 빌드 변수: `VITE_DISCORD_LOGIN_ENABLED=true`, `VITE_PASSWORD_RESET_ENABLED=true`. 프론트와 API의 출처가 다르면(Vercel)
`POSEGOOD_CORS_ALLOWED_ORIGINS`에 앱 출처가 이미 있어야 한다(시작 요청이 쿠키를 받음).

## 4. 남은 한계

- 데스크톱 앱(`app://`)에서는 Discord 버튼을 숨긴다. 브라우저 콜백을 앱으로 돌려받는 경로(시스템 브라우저 + 딥링크 또는 일회용 교환 코드)가 아직 없다.
- 비밀번호 없는 Discord 계정은 비밀번호 변경·탈퇴 화면을 쓰려면 먼저 재설정 메일로 비밀번호를 정해야 한다. Discord 재인증으로 탈퇴하는 경로는 후속이다.
- 실제 Discord 앱·SMTP·MySQL에서는 아직 확인하지 않았다. 표 적용 후 `-Pmysql-integration`과 실제 메일 도착을 확인한다.
