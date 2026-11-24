# 같은 이메일 계정 연결과 가입 이메일 인증

- 상태: in_progress (DB 단계 저장소 반영 2026-11-17 — migration 018·019, `schema_V2_8.sql`. 운영 적용 전. BE 1단계 구현 2026-11-17(브랜치 `feature/backend-local-credential`), 2026-11-19 `refactor/repo-remove-api-version-paths` 기준 브랜치 `feature/backend-local-credential-on-remove-paths`로 옮김(develop 반영 전). BE 2단계 시작 2026-11-23(브랜치 `feature/repo-email-verification-code-db` — 019 코드 방식, 인증 대기 DB). PR #144(BE 1·2단계 한 PR) 리뷰 반영 2026-11-23, **develop 병합 2026-11-24**(`1f643937`). 운영 DB 018·019 적용 2026-11-24. ADR 0050 고침 2026-11-24. 남은 것: ERD PNG 2장(유진 직접), 실제 메일 도착 확인(진행 중))
- 담당: DB 유진(V2.8 — migration 018·019), BE·FE 미정, DevOps 홍규(환경변수·적용 순서)
- 시작일: 2026-11-17
- 관련: [계획 0088](0088-discord-login-and-password-reset.md), [Discord·재설정 인계](../../design/social-login-password-reset-handoff.md), [이메일 인계](../../design/email-account-handoff.md), [계정 계약](../../../contracts/accounts.md), [DB 안내](../../../database/README.md), [ADR 0050](../../decisions/0050-account-email-and-discord-link.md)(같은 이메일 승인 연결·Discord 전용 계정에 비밀번호 붙이지 않음·인증 대기 DB, 2026-11-24 고침)

## 문제와 완료 기준

> **2026-11-17 처음 설계(자동 연결, Discord 전용 계정에 비밀번호 붙이기, 인증 링크)는 2026-11-18·11-23 결정으로 바뀌었다(아래 「결정과 진행 기록」).** 이 절과 「흐름」은 바뀐 결정대로 고쳐 썼다(2026-11-23).

0088까지는 이메일 가입에 메일함 주인 확인이 없어 남의 이메일로 가입할 수 있었고, 같은 이메일의 이메일 계정과 Discord 계정을 묶는 길이 없었다(11/11 결정). 이를 다음처럼 바꾼다.

1. **이메일 계정이 있는 사람이 같은 이메일의 Discord로 들어오면** 자동으로 묶지 않고, 기존 계정의 비밀번호를 확인하고 연결을 승인한 뒤에 Discord를 연결하고 로그인시킨다(#127, 11/18 결정 2).
2. **Discord로만 가입한 계정에는 비밀번호를 붙이지 않는다.** 같은 이메일로 이메일 가입을 하면 409 `ACCOUNT_EXISTS`다. 소셜 로그인은 비밀번호 없이 쓰는 것이 장점이므로, 비밀번호가 필요했던 탈퇴를 비밀번호 없이 받는다(BE-25, 11/18 결정 3).
3. **이메일 가입 전에 메일함 소유를 6자리 코드로 확인한다.** 인증 대기는 서버 메모리가 아니라 DB `email_verification_token`에 두어 서버 재시작·배포에도 이어진다(11/18 결정 1, 11/23 결정).
4. 비밀번호를 `user_account.password_hash`에서 `local_credential`로 옮긴다(비밀번호 없는 계정 = 행 없음).

완료 기준: V2.8 DB(V2.7 + migration 018·019)에서 `-Pmysql-integration`으로 아래를 확인한다.
- 이메일 인증을 켜면 같은 브라우저에서 코드를 확인한 이메일로만 가입할 수 있다. 인증 대기는 서버를 다시 시작해도 남고, 가입이 실패하면 인증 소비도 되돌아간다.
- 코드 확인은 요청마다 5회까지이고, 같은 이메일로 새 코드를 받으면 이전 코드와 확인 증명은 쓸 수 없다.
- 같은 이메일의 Discord 로그인은 기존 계정 비밀번호 확인과 승인 전에는 연결·로그인하지 않는다.
- 비밀번호 있음/없음 판단, 연결 해제의 마지막 로그인 수단 검사, 비밀번호 변경·재설정·탈퇴가 `local_credential` 기준으로 동작한다. 소셜 전용 계정은 비밀번호 변경·재설정으로 비밀번호를 새로 만들 수 없고, 비밀번호 없이 탈퇴한다.
- 탈퇴 최종 삭제(J3)가 새 표가 있어도 계정 행을 지운다. 인증 대기 행은 계정과 묶이지 않아 매일 정리로 지운다.

## 범위와 제외

- **DB:** 운영 DB는 이미 V2.7(017 적용)이다. 017은 고치지 않고 migration 018(비밀번호 표 분리)·019(이메일 인증 토큰)와 `schema_V2_8.sql`(명세서 V2.8)로 올린다. 아래 「표 변경」.
- **BE:** 비밀번호 읽기·쓰기를 `local_credential`로 옮기기(1단계), 이메일 인증 대기를 DB로 옮기기(2단계). 경로·가입 흐름·Discord 승인 연결은 #127 그대로.
- **FE:** 바꿀 것 없음 — 가입 코드 화면과 Discord 연결 승인 화면은 #127 그대로 쓴다. 문구만 확인(재시작해도 코드가 남음).
- **문서:** ADR(같은 이메일 승인 연결 — 번호 0049는 「이름에 버전 없음」에 쓰였으므로 새 번호), 0088 인계 1절, 계정 계약, DB 안내, 이메일 인계, 문서 지도.
- **제외:** 이메일 주소 변경 기능, 카카오·Google·GitHub 어댑터, 데스크톱 앱 Discord, 이메일 인증 도입 전 계정의 소급 인증(아래 결정 4).

## 표 변경 (V2.7 → V2.8, migration 018·019)

확정본은 [018](../../../database/migrations/018_move_password_hash_to_local_credential.sql)·[019](../../../database/migrations/019_create_email_verification_token.sql)와 `database/schema/schema_V2_8.sql`이다(아래 SQL과 설명 문구가 조금 다르다. 적용 전·후 확인 SQL과 되돌리기는 018·019 머리말).
018은 `local_credential`과 데이터 옮기기, 019는 `email_verification_token`이다(한 파일 한 목적, DB 안내 7장).

`user_account`는 이름·칼럼을 그대로 두고 `password_hash` 칼럼만 `local_credential`로 옮긴다. `login_email`은 NOT NULL 그대로다(소셜 가입도 확인된 이메일을 항상 받는다).
`social_identity`·`password_reset_token`은 바꾸지 않는다.

```sql
-- T-54 local_credential — 이메일·비밀번호 로그인 수단. 행이 있으면 비밀번호가 있는 계정이다('!no-password' 고정값 대신).
CREATE TABLE local_credential (
  user_account_id BIGINT NOT NULL COMMENT '계정. 계정 하나에 하나. 계정 최종 삭제 때 함께 지운다',
  password_hash VARCHAR(100) NOT NULL COMMENT '비밀번호 단방향 해시(BCrypt). 평문 저장·응답 노출 금지',
  CONSTRAINT pk_local_credential PRIMARY KEY (user_account_id),
  CONSTRAINT fk_local_credential_user_account FOREIGN KEY (user_account_id) REFERENCES user_account (user_account_id) ON DELETE CASCADE ON UPDATE RESTRICT  -- FK-31
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-54 비밀번호 로그인 수단';

-- T-55 email_verification_token — 가입 전 메일함 소유 확인용 6자리 코드의 대기 상태(2026-11-23 링크 → 코드 방식으로 고침).
-- 계정이 아직 없어 이메일로 주인을 둔다(FK 없음).
CREATE TABLE email_verification_token (
  email_verification_token_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '인증 요청 식별자',
  login_email VARCHAR(254) NOT NULL COMMENT '인증할 이메일(정규화: 앞뒤 공백 제거·소문자)',
  token_hash CHAR(64) NOT NULL COMMENT '요청 번호의 SHA-256. 원문은 브라우저의 HttpOnly 쿠키에만 있다',
  code_hash CHAR(64) NOT NULL COMMENT '「요청 번호:6자리 코드」의 SHA-256. 코드 원문은 메일에만 있다',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '코드 확인 시도 횟수(API 한도 5회)',
  issued_at DATETIME(3) NOT NULL COMMENT '발급 시각 (같은 이메일 재발송 간격의 기준)',
  expires_at DATETIME(3) NOT NULL COMMENT '만료 시각 (발급 + 설정값)',
  verified_at DATETIME(3) NULL COMMENT '코드 확인 시각. NULL: 아직 확인 전',
  consumed_at DATETIME(3) NULL COMMENT '사용·무효 시각 (가입 완료, 같은 이메일 새 요청). NULL: 아직 쓸 수 있음',
  CONSTRAINT pk_email_verification_token PRIMARY KEY (email_verification_token_id),
  CONSTRAINT ux_email_verification_token_hash UNIQUE (token_hash),  -- UK-21
  CONSTRAINT ck_email_verification_token_hash CHECK (CHAR_LENGTH(token_hash) = 64),
  CONSTRAINT ck_email_verification_token_code_hash CHECK (CHAR_LENGTH(code_hash) = 64),
  CONSTRAINT ck_email_verification_token_expires CHECK (expires_at > issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='T-55 이메일 인증 토큰';
```

**V2.7 → V2.8 데이터 옮기기 (018):** Discord로 가입한 계정에는 `'!no-password'`가 들어 있으므로 BCrypt 형식(`$2`로 시작)만 옮긴다.
옮긴 뒤 `local_credential` 행 수가 옮기기 전 `password_hash LIKE '$2%'` 행 수와 같은지 확인하고 칼럼을 지운다.

```sql
INSERT INTO local_credential (user_account_id, password_hash)
  SELECT user_account_id, password_hash FROM user_account WHERE password_hash LIKE '$2%';
ALTER TABLE user_account DROP COLUMN password_hash;
```

**되돌리기:** `login_email`이 NOT NULL 그대로라 되돌릴 수 있다. `user_account.password_hash`를 다시 더하고 `local_credential`에서 복사한 뒤, 행이 없는 계정은 `'!no-password'`로 채우고 NOT NULL로 바꾼다. 그다음 두 표를 지운다(먼저 새 API를 이전 버전으로 되돌린다).

**영향:** `local_credential`은 기능 플래그와 관계없이 API가 항상 쓰므로, 새 API는 V2.8 DB에서만 시작한다.
반대로 018을 적용하면 지금 운영 API(V2.7용)는 `user_account.password_hash`가 없어 로그인·가입·비밀번호 변경이 깨진다.
지금 API의 시작 검사(`SchemaVerifier`)는 이 칼럼을 보지 않아 **시작은 하고 요청에서 SQL 오류가 난다**(2026-11-17 코드 확인).
그래서 **018·019 적용과 새 API 배포를 같은 점검 시간에 한다**(018 → 019 → 새 API 순서). 점검 시간을 못 잡으면 018에서 칼럼을 지우지 않고 남겨 두었다가 새 API 배포 뒤 다음 migration(020)에서 지우는 2단계도 가능하다(그러면 018을 고쳐야 하므로 운영 적용 전에 정한다). 다만 그 사이 옛 API가 쓴 비밀번호 변경을 다시 옮겨야 한다. J3는 계정 행을 지우면 CASCADE로 함께 지워지므로 바꾸지 않는다.
`email_verification_token`은 FK가 없어 계정 삭제 때 함께 지워지지 않는다. 대신 매일 정리(만료 뒤 하루 지난 행 삭제)로 지워지므로 이메일이 남는 기간은 최대 하루 남짓이다.

## 흐름

경로와 화면은 #127 그대로이고, 2단계에서 바뀌는 것은 인증 대기를 저장하는 곳뿐이다(2026-11-23).

**이메일 가입(코드 인증 먼저, `posegood.auth.email-verification.enabled=true`일 때):**
1. 약관 동의 뒤 이메일을 입력한다 → `POST /auth/email-verification/requests {email}`.
   - 출처(IP)별 15분 5회, 같은 이메일은 60초에 한 번. 넘으면 429 `RATE_LIMITED`.
   - 서버는 6자리 코드를 만들고, **메일을 보내기 전에** 요청을 저장한다: 같은 이메일을 DB 이름 잠금(`GET_LOCK`)으로 줄 세우고 READ COMMITTED 트랜잭션에서 「60초 간격 확인 → 그 이메일의 남은 요청에 `consumed_at`(이전 코드·확인 증명 무효) → 새 행(요청 번호·「요청 번호:코드」의 SHA-256)」을 한 뒤 커밋하고 잠금을 푼다. 그래서 메일이 느려도 같은 이메일의 동시 요청은 429다.
   - 그다음 메일로 보낸다(15분). 발송이 실패하면 방금 저장한 요청에 `consumed_at`을 채우고 503 `MAIL_UNAVAILABLE`이다(실패한 시도도 60초 간격에 들어감).
   - 응답은 202이고, 요청 번호는 HttpOnly 쿠키 `posegood_email_verification`(15분)로만 준다.
   - 계정 상태(없음·있음·Discord 전용·탈퇴 유예)와 관계없이 같은 메일을 보낸다. 이미 가입한 이메일인지는 메일함 주인이 코드를 확인하고 가입할 때(4번 409)에만 알 수 있다.
2. 사용자가 메일의 코드를 가입하던 브라우저에 입력한다 → `POST /auth/email-verification/confirm {token: 코드}` + 같은 쿠키.
   - 먼저 시도를 하나 센다: `UPDATE … SET attempt_count=attempt_count+1 WHERE … AND attempt_count<5 AND verified_at IS NULL AND consumed_at IS NULL AND expires_at>?`. 영향 행이 0이면(없음·만료·이미 확인·무효·5회 초과) 410.
   - 코드 해시를 상수 시간으로 비교하고, 맞으면 `verified_at`을 채운다(204). 틀리면 410 `EMAIL_VERIFICATION_REQUIRED`.
3. 계정 정보(비밀번호·프로필·동의)를 입력한다.
4. `POST /auth/register` + 같은 쿠키. 서버는 쿠키의 요청이 확인한 이메일과 가입 이메일이 같은지 보고, 한 트랜잭션에서:
   - `UPDATE … SET consumed_at=? WHERE … AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at>?`의 영향 행이 1일 때만 `user_account` + `local_credential` + `user_consent`를 만든다. 0이면 410.
   - 같은 이메일의 계정이 이미 있으면(비밀번호 계정·Discord 전용 계정·탈퇴 유예 모두, UK-01) 409 `ACCOUNT_EXISTS`이고 소비도 되돌린다. Discord 전용 계정에 비밀번호를 붙이지 않는다.
   - 성공하면 로그인 응답을 주고 쿠키를 지운다.
5. 만료된 지 하루가 지난 행은 매일 04:45(KST)에 지운다.

기능이 꺼져 있으면(기본) 인증 경로는 404이고 가입은 인증 없이 된다(표를 읽지 않음).

**Discord 로그인(같은 이메일 승인 연결, #127):** `social_identity`로 찾은 계정이 없고 Discord가 확인한 이메일과 같은 계정이 있으면:
- 탈퇴 유예(CLOSED) → `closed`.
- ACTIVE → 연결 대기를 만들고 `link-required`(대기는 서버 메모리, 쿠키로 브라우저에 묶음). 자동으로 연결하지 않는다.
  1. `GET /auth/social/pending-link` → 제공자·이메일·확인 여부.
  2. `POST /auth/social/pending-link/verify {password}` → 기존 계정 비밀번호 확인(대기당 5회).
  3. `POST /auth/social/pending-link/confirm` → 확인 뒤 비밀번호가 바뀌지 않았으면 `social_identity`를 넣고 로그인. 다른 계정에 이미 연결된 Discord면 409 `SOCIAL_IN_USE`.
  4. `DELETE /auth/social/pending-link` → 연결하지 않고 대기 삭제.
- 같은 이메일 계정이 없으면 Discord 가입(`signup`).

**Discord 전용 계정:** 비밀번호 로그인은 401 `INVALID_CREDENTIALS`, 비밀번호 변경은 400, 재설정 요청은 202지만 메일을 보내지 않는다. 탈퇴는 비밀번호 없이 받는다(BE-25).

## 작업 단계

- [x] ADR(같은 이메일 승인 연결과 Discord 전용 계정에 비밀번호를 붙이지 않는 이유, 11/11 결정 갱신)과 0088 인계 1절 정정 — 2026-11-24 새 번호 대신 [ADR 0050](../../decisions/0050-account-email-and-discord-link.md)을 고침(아래 결정 기록)
- [x] DB(2026-11-17, 브랜치 `feature/db-account-credential-email-verification`): migration 018·019, `schema_V2_8.sql`(명세서 V2.8), ERD V2.8(원본·PNG), `database/README.md`(운영 V2.7 반영, 기준 스키마 V2.6 → V2.7, `schema_V2_6.sql`·017 삭제, 개수·되돌리기), DB CI(`BASE_SCHEMA`·`EXPECT_TABLES`), `integrity_check.py`(V2.8 기준 195개), 0088 인계의 017 안내
- [x] DB 운영 적용: 018 → 019(2026-11-24, 사용자 확인)
- [ ] 명세서 V2.8 원문 반영
- [x] API가 V2.8에 맞춰진 뒤 `schema_V2_7.sql`을 읽는 곳을 V2.8로: `DisposableDatabase`·`infra/mysql/initdb/10-posegood-schema.sh`·`tools/test_mysql.py`·`consents.test.ts`·`SchemaVerifier`/`ServiceSchemaVerifier` 메시지 (2026-11-17, BE 1단계와 같은 브랜치)
- [x] BE 1단계(동작 유지, 2026-11-17 브랜치 `feature/backend-local-credential`): `AccountRepository`(조회 LEFT JOIN, 가입 때 INSERT, 비밀번호 변경은 있는 행만 UPDATE), `AccountService.NO_PASSWORD`·`hasPassword` 제거, `SocialLoginService.unlink`, `PasswordResetService`(소셜 전용 계정은 재설정 대상 아님), `SchemaVerifier`(`local_credential` 항상 확인), `JdbcReportTestFixtures`
- [ ] BE 2단계(11/18 결정 반영): #127의 메모리 인증 대기를 `email_verification_token`으로 옮기기, 매일 정리(API `@Scheduled`, 만료 뒤 하루), `register` 토큰 소비. 같은 이메일 연결은 #127의 승인 연결 유지, Discord 전용 계정에 비밀번호 붙이기는 하지 않음
  - [x] 2026-11-23 6자리 코드 유지로 정하고 019를 운영 적용 전에 고침(020 대신, `code_hash`·`attempt_count`·`verified_at`). `schema_V2_8.sql`·ERD 원본·`integrity_check.py`·DB 안내
  - [x] 2026-11-23 `EmailVerificationRepository`·`EmailVerificationService`(조건부 UPDATE, 서비스 잠금 삭제, 가입 소비와 계정 생성 한 트랜잭션, 매일 04:45 정리), `SchemaVerifier`, 단위·MySQL 통합 시험, 계약·인계·개발 상태
  - [x] 리뷰·develop 반영: PR #144(BE 1단계 위에 쌓음) 2026-11-24 develop 병합(`1f643937`)
  - [ ] ERD PNG 2장 다시 내보내기(11/23에 원본 `.drawio`만 고침 — 유진이 직접)
  - [x] 2026-11-23 「문제와 완료 기준」·「범위」·「표 변경」의 019·「흐름」을 11/18·11/23 결정대로 고쳐 씀
- [x] FE: 바꿀 것 없음(#127 가입 코드 화면·연결 승인 화면 그대로, 11/23 확인)
- [x] 계약 `accounts.md`: 경로는 #127 그대로, 인증 대기 저장 위치·가입 실패 때 소비 되돌림 문구(2026-11-23)
- [ ] 검증: BE 단위 시험, `-Pmysql-integration`(가입·연결·탈퇴·J3 삭제), `python tools/dev.py check`, 실제 메일 도착 — 앞의 셋은 아래 검증 결과(11/23), 실제 메일 도착은 운영 적용 뒤 확인 중(2026-11-24)

## 결정과 진행 기록

- 2026-11-17(사용자 결정, DB 유진):
  1. 같은 이메일이면 Discord 계정과 이메일 계정을 하나로 묶는다(양방향). 11/11 「자동으로 묶지 않음」을 바꾼다.
  2. 표는 기존 이름을 따르고 칼럼은 그대로 둔다. 새로 더하는 표만 더한다. 새 표는 계정에 `ON DELETE CASCADE`로 묶는다.
  3. 이메일 인증을 넣고, 인증 토큰은 서버 메모리가 아니라 DB 표에 둔다(재시작·여러 인스턴스에도 링크 유지).
  4. **이메일 인증 도입 전에 가입한 계정은 따로 처리하지 않는다**(`email_verified_at` 칼럼 없음). 감수하는 위험: 그 계정 중 남의 이메일로 미리 만든 계정이 있으면, 진짜 주인이 Discord로 들어올 때 그 계정에 자동 연결된다. → 11/18 결정 2(비밀번호 확인 뒤 승인 연결)로 자동 연결이 없어져 이 위험도 없어졌다.
- 2026-11-17(사용자 확인): 운영 DB는 이미 V2.7(017 적용)이다. 017을 고치지 않고 018·V2.8로 올린다. 저장소 문서(DB 안내, 0088 인계)의 「운영 V2.6」·「017 적용 대기」 표기는 낡았으므로 이 작업에서 고친다.
- 2026-11-17: `login_email`은 NOT NULL을 유지한다. Discord 가입은 Discord가 확인한 이메일만 받으므로(`DiscordClient`) 이메일 없는 계정이 생기지 않는다.
- 2026-11-17: 가입 전 인증으로 한다. 가입 후 인증은 `account_status`에 인증 전 상태값이 필요하고 로그인·J3·처리 서비스가 그 상태를 모두 다뤄야 한다.
- 2026-11-17(사용자 결정): 이메일 인증 토큰은 `password_reset_token`과 합치지 않고 따로 둔다. 재설정 토큰은 계정 FK가 NOT NULL인데 인증은 계정이 생기기 전이라 주인이 이메일이다. 합치면 운영 중인 V2.7 표를 바꿔야 하고(계정 NULL 허용·이메일·용도 칼럼), 모든 쿼리에 용도 조건이 빠지면 인증 링크가 재설정 링크로 쓰일 수 있으며, 무효화·삭제 기준(계정 vs 이메일, CASCADE vs 매일 정리)도 다르다.
- 2026-11-17: DB 단계를 저장소에 반영했다. 마이그레이션은 한 파일 한 목적 규칙으로 018(비밀번호 표 분리)·019(인증 토큰)로 나눴다. `email_verification_token`의 보조 인덱스는 019에 넣지 않았다(인덱스는 다른 파일 — DB 안내 7장).
- 2026-11-17: BE 1단계를 브랜치 `feature/backend-local-credential`에 구현했다. 동작은 그대로이고 저장 위치만 바뀐다.
  - 계정 조회는 `local_credential`을 LEFT JOIN한다. 행이 없으면 `Account.hash()`가 `null`이고 `Account.hasPassword()`가 거짓이다(`AccountService.NO_PASSWORD`·정적 `hasPassword` 삭제). 로그인 검증·연결 해제의 마지막 로그인 수단 검사·Discord 상태 응답이 이것을 쓴다.
  - 가입은 `user_account` 다음에 같은 트랜잭션에서 `local_credential`을 넣고, Discord 가입은 넣지 않는다.
  - 비밀번호 변경(`AccountRepository.changePassword`)은 있는 행만 UPDATE하고, 바꾼 행이 1이 아니면 예외를 던져 호출한 쪽 트랜잭션을 되돌린다. Discord 전용 계정은 행이 없어서, 표 이름만 바꾼 UPDATE였다면 재설정이 0행으로 끝나는데도 토큰은 사용 처리되고 로그인은 끊겨 성공(204)처럼 보였을 것이다. (처음 구현은 `INSERT … ON DUPLICATE KEY UPDATE`로 행을 넣었으나 아래 사용자 결정으로 바꿨다.)
  - 현재 비밀번호 확인(`requireCurrent`)은 해시가 `null`이면 BCrypt 비교 없이 틀림으로 처리한다(이전에도 `'!no-password'`라 틀림).
  - `SchemaVerifier`는 V2.8 기준이다: `local_credential.password_hash`와 V2.7 표 두 개를 기능을 켰는지와 관계없이 확인하고, V2.7 DB면 018·019를, V2.6 이하면 `schema_V2_8.sql`로 다시 만들라고 알린다. `email_verification_token`은 2단계에서 더한다.
  - 처리 서비스 `ServiceSchemaVerifier`는 V2.8(`local_credential`·`email_verification_token`)까지 판을 알아보고 V2.7이면 「migration 018·019를 적용」으로 알린다. `JdbcReportTestFixtures`의 시험 계정은 `password_hash` 없이 넣는다(그래서 처리 서비스 시험용 API도 V2.8 DB가 필요하다).
  - J3·`SocialLoginService`의 흐름은 바꾸지 않았다(J3는 CASCADE로 충분).
- 2026-11-17(사용자 결정): **소셜 로그인 계정에는 비밀번호 변경·재설정을 제공하지 않는다.** 우리 서비스 계정(이메일 가입)을 만들지 않는 한 소셜 계정에 비밀번호가 필요할 이유가 없다. 소셜 전용 계정에 비밀번호를 붙이는 길은 같은 이메일로 이메일 가입하는 것(위 2번, BE 2단계)뿐이다. → 11/18 결정 3으로 이 길도 두지 않는다(같은 이메일 가입은 409).
  - `PUT /auth/password`: 현재 비밀번호 확인이 해시 `null`에서 틀림이라 그대로 400 `INVALID_PASSWORD`.
  - 재설정 요청: 소셜 전용 계정이면 토큰·메일 없이 끝난다(응답은 그대로 202라 가입 여부·계정 종류가 드러나지 않음). 재설정 완료: 소셜 전용 계정이면 410 `RESET_TOKEN_INVALID`(V2.7 API가 보낸 링크가 남아 있을 수 있음). 토큰은 소비하지 않는다.
  - 0088 때의 「비밀번호는 나중에 재설정 메일로 정할 수 있다」 안내(FE 가입·설정 화면, 계약, 인계 문서)를 고쳤다.
  - **탈퇴가 막힌다:** 탈퇴(`DELETE /auth/account`)는 현재 비밀번호를 요구하므로 소셜 전용 계정은 지금 탈퇴할 수 없다. 전에는 재설정 메일로 비밀번호를 먼저 정하는 길이 있었다. 소셜 전용 계정의 탈퇴 본인 확인 방식(예: Discord 재인증)을 정해야 한다(남은 질문). → 2026-11-17 BE-25(#131·#132)로 탈퇴가 비밀번호를 확인하지 않게 되어 해결됐다.
- 2026-11-18(사용자 결정, PR #127과 이 계획의 세 차이):
  1. 인증 대기는 **DB 표**(`email_verification_token`)에 둔다(이 계획 결정 3 유지). #127은 서버 메모리라 BE 2단계에서 옮긴다. 만료된 행은 API가 매일 지운다(Spark J3에 넣지 않음 — 토큰 표 셋을 API가 같은 방식으로 지움).
  2. 같은 이메일의 Discord·이메일 계정은 **기존 계정 비밀번호 확인과 승인 뒤 연결**한다(#127 방식). 위 결정 1의 자동·양방향 연결을 대체한다.
  3. **Discord 전용 계정에 비밀번호를 붙이지 않는다**(위 흐름 「기존 계정에 이메일 로그인 추가」 빠짐). 비밀번호가 필요했던 이유인 탈퇴를 바꾼다 — 소셜 로그인의 장점은 비밀번호 없이 쓰는 것이다. 탈퇴는 이미 BE-25로 비밀번호 없이 받는다.
- 2026-11-23(사용자 결정, 팀 공지 「이메일 인증 토큰: DB로 통일하고 가입 인증은 6자리 코드로」): **가입 인증은 6자리 코드를 유지하고 DB에 둔다. 비밀번호 재설정은 링크·DB 그대로.** 두 인증 토큰의 저장 방식을 DB로 통일하되 표는 용도별로 따로 둔다(11/17 결정).
  - 코드를 고른 이유: 가입 화면에서 이어서 입력해 흐름이 끊기지 않음(링크는 다른 탭·기기에서 열림), 데스크톱 앱에 맞음, #127 FE·BE가 이미 코드 흐름이라 FE 변경 없음, 링크를 미리 여는 메일 보안 검사기에 토큰이 소비되지 않음.
  - 019는 운영에 적용하기 전이라 020을 따로 두지 않고 019를 고쳤다(칼럼 6 → 9개, CHECK 2 → 3개). `token_hash`는 링크 토큰 대신 요청 번호(HttpOnly 쿠키)의 해시, `code_hash`는 「요청 번호:코드」의 해시(코드는 경우의 수가 100만이라 요청 번호와 묶음 — 요청 번호 원문은 DB에 없다), 시도 5회는 `attempt_count`, 확인은 `verified_at`. 링크 방식 019를 적용한 개발 DB는 표를 지우고 다시 적용한다.
  - 수명 15분·같은 이메일 60초·출처별 15분 5회·시도 5회는 #127 값 그대로. 출처별 제한(`RequestLimiter`)은 잃어도 되는 값이라 메모리에 둔다.
  - 메모리 방식의 서비스 전체 `synchronized`(그 안에서 SMTP 발송 — 메일이 늦으면 다른 사람의 확인·가입도 멈춤)를 없앴다. 시도 세기·확인·가입 소비가 모두 조건부 UPDATE다. (처음에는 메일 발송이 성공한 뒤에 저장했으나 PR #144 리뷰로 바꿨다 — 아래 2026-11-23 리뷰 반영.)
  - 메모리 상한 1만 건과 503 `EMAIL_BUSY`는 없앴다(표는 매일 정리, 요청은 출처·이메일별로 제한).
- 2026-11-23(PR #144 HJisung 리뷰 반영 — 둘 다 로컬에서 먼저 재현하고 고침):
  1. **같은 이메일 60초 제한이 동시 요청에 듣지 않음:** 「최근 발급 확인 → 메일 발송 → 저장」이라 발송하는 1~수 초 동안 들어온 같은 이메일 요청이 모두 확인을 통과했다(메일 1초 지연, 동시 2건 → 202 둘·메일 2통). 메모리 방식은 잠금 안에서 발송 전에 기록해 이런 일이 없었다 — 잠금을 없애며 생긴 회귀다. → 새 요청을 **발송 전에 저장**(`EmailVerificationRepository.reserve`). 같은 이메일은 MySQL `GET_LOCK('posegood_ev_' + 이메일 해시 48자)`으로 줄 세우고, 잠금·커밋·해제를 같은 연결에서 하려고 그 메서드가 자기 연결로 트랜잭션을 연다(바깥 트랜잭션 안에서 부르면 예외). 잠금은 커밋 뒤에 풀어 다음 요청이 새 행을 보고 429를 받는다. DB 잠금이라 API가 여러 대여도 맞다. 발송 실패는 그 행을 `revoke`(재발송 간격에는 남음 — 메모리 방식과 같음). 메일 발송 전에 이전 코드가 무효가 되므로, 발송이 실패하면 이전 코드도 쓸 수 없다(60초 뒤 다시 요청).
  2. **빈 표의 동시 첫 요청 교착:** REPEATABLE READ(MySQL 기본)에서 이메일 칼럼에 인덱스가 없는 `UPDATE … WHERE login_email=?`가 표 전체에 next-key 잠금을 잡아, 빈 표에서는 두 트랜잭션의 supremum 간격 잠금과 INSERT 의도 잠금이 서로 기다렸다(임시 DB에서 같은 이메일·다른 이메일 모두 5/5 교착, 행이 있으면 차례로 처리, READ COMMITTED는 0). 인덱스로는 풀리지 않는다(다른 새 이메일이 같은 간격). → 새 요청 저장과 매일 정리를 READ COMMITTED로. 시도·확인·가입 소비는 PK로 한 행만 바꿔 그대로 둔다.
  3. 사소한 것: `ServiceSchemaVerifier`가 `code_hash` 없는 옛 링크 방식 019를 「V2.8(옛 링크 방식 019)」로 알리고 다시 적용하라고 안내. 문서의 옛 브랜치 표기(`feature/backend-local-credential`, 「develop 반영 전」)를 PR #144로. ERD PNG는 남은 일.
  - 보조 인덱스 `(login_email, issued_at)`: 리뷰 의견(행이 적어 지금은 없어도 됨, DB-05에서 정해도 됨)대로 넣지 않는다.
- 2026-11-24: PR #144가 develop에 병합됐고(`1f643937`), 운영 DB에 018 → 019를 적용했다(사용자 확인).
  ADR은 새 번호로 쓰지 않고 [ADR 0050](../../decisions/0050-account-email-and-discord-link.md)(klaod-tech, 11/18)을 고쳤다. 0050이 이미 같은 이메일 승인 연결(#127)을 결정으로 담고 있어, 새 ADR을 쓰면 같은 결정이 두 곳에 나뉜다.
  고친 것: 결정 4(Discord 전용 계정에 비밀번호를 붙이지 않음 — 11/18 결정 3)와 그 이유, 가입 인증 대기를 서버 메모리에서 DB `email_verification_token`으로(11/23 결정), 결과의 「인증 대기는 서버 메모리」 줄(Discord 연결 대기만 메모리에 남음).
  0088 인계 1절의 「비밀번호를 붙이는 길은 같은 이메일로 이메일 가입하는 것뿐」을 11/18 결정 3으로 정정했다.
- 2026-11-19: BE 1단계를 `refactor/repo-remove-api-version-paths`(develop `ed72615` + 주소 버전 삭제, #127 포함) 기준 새 브랜치 `feature/backend-local-credential-on-remove-paths`로 옮겼다. #127 코드와 맞춘 것:
  - #127의 `PasswordResetService.validate`(링크 확인)도 비밀번호 없는 계정이면 410 — 완료와 같게(결정 3).
  - #127의 재설정 비밀번호 재사용 거절(`applyResetPassword`)·연결 해제 검사를 `account.hasPassword()`로. 연결 해제 오류 문구에서 「재설정 메일로 비밀번호를 정하라」를 뺌.
  - 탈퇴 MySQL 시험(BE-25)의 비밀번호 없는 계정 만들기를 `password_hash` 고정값 대신 `local_credential` 행 삭제로. 새 시험의 탈퇴 주소에서 `/v2`·본문 뺌.
  - 이메일 인계·계약의 「소셜 계정은 재설정 메일로 비밀번호를 정할 수 있다」를 고침.

**남은 질문**
- ~~소셜 전용 계정의 탈퇴 본인 확인 방식~~ → 해결(BE-25, 탈퇴는 로그인 상태만 확인).
- ~~인증 대기를 표로 옮길 때 6자리 코드(#127)를 유지할지, 메일 링크로 바꿀지~~ → 2026-11-23 코드 유지, 019를 고침.
- 소셜 전용 계정이 재설정을 요청하면 「이 계정은 Discord로 로그인합니다」 안내 메일을 보낼지(지금은 아무 메일도 없음. 응답은 같으므로 보내도 가입 여부가 드러나지 않음).
- `email_verification_token`의 `(login_email, issued_at)` 보조 인덱스를 따로 migration(020~)으로 더할지, DB-05 인덱스 시트에서 정할지(DB 담당). 지금은 넣지 않았다. 재발송 간격 확인과 이전 토큰 무효화가 이메일로 찾는데 FK가 없어 자동 인덱스가 없다. 행은 매일 정리되어 적다.
- ~~인증 토큰 수명과 재발송 간격~~ → 2026-11-23 #127 값(15분·60초) 유지.
- `register` 요청 변경을 계약 버전 변경으로 볼지(지금 FE만 쓰는 경로).
- ~~자동 연결이 일어났을 때 알림 메일~~ → 11/18 결정 2(승인 연결)로 해당 없음.
- ~~기존 Discord 계정에 비밀번호만 붙일 때의 안내 문구~~ → 11/18 결정 3(붙이지 않음)으로 해당 없음.

## 검증 결과와 남은 한계

**DB (2026-11-17, 로컬 Windows MySQL 8.0.31, 임시 DB로 만든 뒤 지움)** — 자세한 내용은 [DB 안내](../../../database/README.md) 8장.
- `schema_V2_8.sql` + 시드 → 테이블 18개, `schema_V2_7.sql` + 시드 + 018·019와 구조·설명·마스터 데이터 446줄 일치(git 이력의 V2.6 + 017·018·019도 일치). 표·컬럼·UK·FK·CHECK 18·124·12·17·60. 바꾼 DB CI 설정 그대로 로컬에서 비교 통과.
- 018: 데이터가 든 V2.7 DB에서 BCrypt 행만 옮기고 `'!no-password'` 행은 옮기지 않음. 되돌리기를 `--safe-updates`로 실행해 V2.7 정의와 같아짐.
- `integrity_check.py` V2.8 기준 195개 모두 통과(V2.8로 만든 DB, V2.7 + 018·019로 만든 DB 둘 다, 같은 DB 재실행도 통과).

**BE 1단계 (2026-11-17, 브랜치 `feature/backend-local-credential`, 로컬 Windows MySQL 8.0.31 일회용 DB)**
- 소셜 계정 비밀번호 막기 반영 후 다시 실행한 결과다.
- `python tools/dev.py check-backend`(기본 시험·Checkstyle·빌드): 성공. api 120개 중 106 통과·실패 0·건너뜀 14(MySQL 통합), processing 62개 통과. 바꾼 줄에 줄바꿈 외 Checkstyle 경고 없음.
- `backend/gradlew -p backend :api:test :processing:test -Pmysql-integration --rerun-tasks`: api 120개(`MySqlIntegrationTest` 14개 포함)·processing 62개 모두 통과, 실패 0, 건너뜀 0. 통합 시험은 `schema_V2_8.sql`로 DB를 만든다.
  - 새 시험 `passwordlessAccountNeverGainsAPasswordAndCredentialsGoWithTheAccount`(소셜 계정 비밀번호 막기 반영): Discord 가입 경로(`registerSocial`)로 만든 계정은 `local_credential` 0행·로그인 401 → 저장소의 비밀번호 바꾸기는 예외로 끝나고 같은 트랜잭션의 다른 변경도 되돌아가며 행은 여전히 0 → 탈퇴 접수·J3의 마지막 두 단계(삭제 요청·계정 삭제)로 `social_identity`가 함께 지워짐. 이메일 가입 계정은 행 1개로 시작하고 탈퇴·최종 삭제로 `local_credential`이 함께 지워짐.
  - 단위 시험 `PasswordResetServiceTest.socialOnlyAccountGetsNoLinkAndAnOldLinkIsInvalid`: 소셜 전용 계정의 재설정 요청은 토큰·메일 없음, 남은 링크 완료는 410이고 토큰을 소비하지 않음.
  - 기존 `accountSettingsAndLoginRemoval`에 비밀번호 변경 뒤 `local_credential` 1행 확인을 더했다.
- FE `consents.test.ts`(V2.8 스키마 읽기): 2개 통과.

**BE 1단계 옮김 (2026-11-19, 브랜치 `feature/backend-local-credential-on-remove-paths`, 로컬 Windows MySQL 8.0.31 일회용 DB)**
- `backend/gradlew -p backend :api:test :processing:test -Pmysql-integration --rerun-tasks`: api 158개 중 157 통과·실패 1, processing 67개 통과, 건너뜀 0. `MySqlIntegrationTest` 15개 중 14 통과(`passwordlessAccountNeverGainsAPasswordAndCredentialsGoWithTheAccount`, V2.8로 고친 `withdrawalNeedsNoPasswordAndIgnoresAnOldAppBody` 포함).
  - 실패 `baselinesOwnershipLossAndInferenceFailure`(두 번째 세션 409)는 기준 브랜치에서도 같다(#127 측정 한 기기 제한과 기존 시험이 어긋남, 계획 0097·`api-spec.md` 11/18 기록). 이 변경 밖.
- 단위 시험 `PasswordResetServiceTest.socialOnlyAccountGetsNoLinkAndAnOldLinkIsInvalid`에 링크 확인(`validate`) 410을 더함.
- `python tools/dev.py check-backend`: 성공. 바꾼 줄에 줄바꿈 외 Checkstyle 경고 없음. FE `consents.test.ts`·프로필 시험 8개 통과.

**BE 2단계 — 인증 대기 DB (2026-11-23, 브랜치 `feature/repo-email-verification-code-db`, 로컬 Windows MySQL 8.0.31 임시·일회용 DB)**
- DB CI 순서(임시 DB 이름): `schema_V2_8.sql` + 시드 → 표·컬럼·UK·FK·CHECK 18·127·12·17·61, `integrity_check.py` 205개 모두 통과, `schema_V2_7.sql` + 시드 + 018·019와 451줄 일치.
- `backend/gradlew -p backend :api:checkstyleMain :api:checkstyleTest :api:test --tests 'org.posegood.api.account.*'`: 계정 시험 50개 통과(`EmailVerificationServiceTest` 12개 — 해시만 저장, 재시작 뒤에도 이어짐, 시도 5회, 확인한 코드 재확인 거부, 가입 실패 때 되돌림, 매일 정리, 기능 꺼짐). 바꾼 파일에 줄바꿈 외 Checkstyle 경고 없음.
- `backend/gradlew -p backend :api:test -Pmysql-integration --rerun-tasks`: api 168개 중 167 통과·실패 1·건너뜀 0. `AccountMailIntegrationTest` 3개 통과 — 새 시험 `codeStateLivesInTheTableAndFailedRegistrationKeepsTheProof`(틀린 코드 뒤 `attempt_count` 1·코드 원문 아님, 같은 이메일 가입 409 `ACCOUNT_EXISTS` 때 실제 MySQL 트랜잭션에서 `consumed_at`이 되돌아감).
  - 실패 `baselinesOwnershipLossAndInferenceFailure`(두 번째 세션 409)는 이 변경을 치운 기준 커밋에서도 같다(위 11/19 기록). 이 변경 밖.
- `python tools/dev.py check-backend`(기본 시험·Checkstyle·빌드): 성공. api 168개 중 148 통과·실패 0·건너뜀 20(MySQL 통합), processing 67개 통과.
- 「흐름」 고쳐 쓴 뒤 다시 실행(같은 날): DB CI 순서 같은 결과(205개, 451줄), `:api:test :processing:test -Pmysql-integration --rerun-tasks` → api 168개 중 167 통과(같은 기존 실패 1), processing 67개 통과.
- develop `d4a10ffb`(#141·#142·#143)를 합친 뒤(같은 날): `build :api:test :processing:test -Pmysql-integration --rerun-tasks` → api 175개·processing 69개 **모두 통과**(#143의 시험 정리로 `baselinesOwnershipLossAndInferenceFailure`도 통과). Python 248 통과, FE 1,050 통과·1 실패(`recordTimezone`의 「오전」/「AM」 — 로컬 Node 날짜 형식, 이 변경 밖), FE 빌드 통과, DB CI 순서 같은 결과. 병합 충돌은 `database/README.md` 한 줄(아키텍처 링크 v5.5)과 `docs/backend-status.md`(#143 문서 재구성) — develop 구조에 이 브랜치의 줄을 옮겨 넣음. `python tools/dev.py check`(FE 포함 전체)는 실행하지 않았다(FE 변경 없음).
- PR #144 리뷰 반영 뒤(같은 날): `build :api:test :processing:test -Pmysql-integration --rerun-tasks` → api 178개·processing 70개 모두 통과. 새 시험: 단위 `concurrentRequestsForTheSameEmailSendOneMail`·`smtpFailureIsReportedAsUnavailableAndTheRequestIsRevoked`, MySQL `concurrentRequestsForTheSameEmailSendOneMail`(같은 이메일 3건 동시·메일 1초 → 202 1·429 2·메일 1통·`IS_USED_LOCK` 비어 있음), `concurrentFirstRequestsOnAnEmptyTableNeverDeadlock`(빈 표에 서로 다른 이메일 8건 동시 → 모두 202), 처리 서비스 `linkStyleMigration019IsNotV28`. 재현용 임시 스크립트(저장소 밖)로 RR 5/5 교착·RC 0 확인.

**남은 한계**
- 원격 DB CI는 PR에서 확인한다. ~~운영 DB에는 아직 적용하지 않았다.~~ → 2026-11-24 운영 DB에 018·019를 적용했다(사용자 확인).
- ~~BE 1·2단계(PR #144)는 develop 반영 전이다.~~ → 2026-11-24 develop 병합. 이 API는 V2.7 DB에서 시작하지 않으므로 V2.7로 남은 개발용 Compose 볼륨은 018·019를 적용해야 한다(새 볼륨은 V2.8로 만들어짐).
- 실제 SMTP로 가입 코드 메일이 도착하는지는 운영 적용 뒤 확인 중이다(2026-11-24).
- V2.7 DB에서 이 API가 시작하지 않는 것은 코드로만 확인했다(실제 V2.7 DB로 띄워 보지 않음).
- 소셜 전용 계정의 재설정 거절은 단위 시험으로, 저장소의 0행 예외는 MySQL로 확인했다. 재설정 메일·토큰을 거친 전체 흐름은 MySQL로 돌리지 않았다(재설정 기능 기본 꺼짐).
- ~~소셜 전용 계정은 지금 탈퇴할 수 없다~~ → BE-25로 비밀번호 없이 탈퇴한다(11/19 브랜치의 MySQL 시험 `withdrawalNeedsNoPasswordAndIgnoresAnOldAppBody`가 `local_credential` 행 없는 계정으로 확인).
- BE 2단계는 인증 대기 DB 전환까지 했다(2026-11-23, 위 검증 기록). 같은 이메일 연결은 #127의 승인 연결 그대로라 따로 구현할 것이 없다. ~~ADR은 작성 전이다.~~ → 2026-11-24 ADR 0050을 고침.
