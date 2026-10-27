# 이메일 인증·비밀번호 재설정 연결 인계

2026-10-26 사용자 요청에 따른 **후속 BE/DB 설계안**이다. 현재 운영 API 계약으로 확정하거나 구현 완료한 명세가 아니다. 이번 작업은 프론트 페이지·연결부와 밝은 앱 패키징까지다.

## 1. 현재 확인한 저장 방식

- `backend/api/.../account/SecurityConfiguration.java`: `BCryptPasswordEncoder(12)`.
- `AccountService.register/changePassword`: `passwords.encode(...)` 후 `password_hash` 컬럼에 저장.
- `AccountAuthenticationProvider`: `passwords.matches(...)`로 대조. 원문 조회/복원 경로는 없다.
- 가입/변경 서버 규칙은 최소12자·최대UTF-8 72바이트. 복호화 가능한 암호문으로 바꾸지 않는다.
- 현재 프론트 가입·로그인은 로컬 미리보기다. 비밀번호를 저장하지 않고 서버 인증도 하지 않는다. 해당 계정에 서버 비밀번호 재설정을 적용했다고 표시하면 안 된다.

## 2. 프론트에 준비된 진입점

| 진입 | 화면 |
| --- | --- |
| 로그인 → 비밀번호 재설정 | 이메일 입력 → 메일 요청 → 안내/재요청 |
| `/#password-reset?token=<opaque-token>` | 새 비밀번호/재입력 → 재설정 요청 |
| 이미 받은 인증 코드 입력 | 이메일 링크를 앱에서 열기 어려울 때 코드 붙여넣기 |
| 회원가입 계정 정보 → 이메일 인증 안내 | 인증 메일 요청/토큰 확인 |
| `/#verify-email?token=<opaque-token>` | 이메일 확인 요청 |

구현 파일은 `frontend/src/features/auth/MailAccessPage.tsx`와 `mailApi.ts`다. token은 React 메모리에만 보관하고 진입 시 `history.replaceState`로 URL에서 제거한다. 로그·localStorage·sessionStorage에 저장하지 않는다. 성공 뒤 token/새 비밀번호를 지우고 자동 로그인하지 않는다.

현재는 `VITE_ACCOUNT_MAIL_API_ENABLED`가 없으므로 **기본 비활성**이다. 준비중 안내와 오류를 표시하며 메일 발송/저장 성공을 흉내 내지 않는다. 로컬 가입·로그인 동작도 서버 인증으로 가장하지 않는다.

## 3. 제안 API 연결부

프론트는 같은 출처 `/api/v2`를 사용한다. 개발 Vite 프록시가 `/api`를 API에 전달한다. 배포 웹은 reverse proxy가 필요하다. 아래 경로는 구현/합의 전이다.

| 메서드/경로 (`/api/v2` 뒤) | 본문 | 제안 응답 |
| --- | --- | --- |
| GET `/auth/csrf` | 없음 | 기존 `{header_name,token}` |
| POST `/auth/password-reset/requests` | `{email}` | 202; 가입 여부와 무관하게 같은 안내 |
| POST `/auth/password-reset/confirm` | `{token,new_password}` | 204; 새 비밀번호 반영·기존 모든 로그인 철회 |
| POST `/auth/email-verification/requests` | `{email}` | 202; 발송 정책에 따른 일반 안내 |
| POST `/auth/email-verification/confirm` | `{token}` | 204; 서버에 확인 상태 저장 |

변경 요청은 기존 `X-CSRF-TOKEN`과 동일 출처 쿠키를 사용한다. 400/410은 무효·만료·사용된 링크로 통합 안내, 429는 재시도 제한, 5xx/네트워크 실패는 일반 실패 안내다. 입력·서버 상세 오류를 화면에 그대로 출력하지 않는다. 응답 캐시 금지.

활성화는 BE 구현/회귀 검증 후 `VITE_ACCOUNT_MAIL_API_ENABLED=true`로 **빌드 시** 설정한다. SMTP 비밀은 VITE 변수나 EXE/renderer에 넣지 않는다. `app://posegood` 패키지는 현재 정적 파일만 제공하므로 플래그만 켜면 연결되지 않는다. Electron에 임의 CORS 우회/보안 해제를 넣지 말고 아래 배포 경계를 먼저 구현한다.

## 4. 백엔드 담당 작업

1. **메일 요청:** 이메일 정규화·형식 검사, 주소/요청 출처별 제한, 요청 생성, 발송 작업 큐. 존재/미존재 계정의 HTTP 상태·응답·처리 시간을 구별하기 어렵게 한다. 계정 잠금은 하지 않는다.
2. **토큰:** 암호학적 난수32바이트 이상, 목적(VERIFY/RESET) 분리, 원문은 이메일에만 포함. DB에는 SHA-256 등 토큰 해시만 저장. 예시 만료는15분이며 제품값은 BE와 확정한다.
3. **재발급:** 주소·목적별 재발송 간격과 IP별 제한을 서버에서 적용. 프론트60초 표시는 UX일 뿐 보호 수단이 아니다. 새 토큰 발급 시 기존 것을 무효화한다.
4. **이메일 확인:** 유효 token을 원자적으로 한 번 소비하고 검증한 이메일/시각을 서버에 기록한다. 가입 전 인증은 짧은 수명의 pending verification과 서버 세션을 묶고, 최종 가입에서 같은 정규화 이메일인지 확인/소비한다. 프론트 boolean을 신뢰하지 않는다.
5. **가입:** `/auth/register`의 기존 동의·서버 입력 검사/이메일 UNIQUE를 유지하면서 소유 확인을 강제한다. 프론트의 확인만 추가하고 미인증 가입 경로를 열어두지 않는다. 기존 계정의 확인 상태는 근거 없이 소급 생성하지 않는다. 기존 로그인 계약을 바꾸는 배포는 별도 버전/전환 정책을 합의한다.
6. **재설정:** token 해시·목적·만료·소비 여부·계정 ACTIVE 상태를 검사하고 잠금/트랜잭션으로 소비한다. BCrypt 저장, 모든 `SPRING_SESSION` 제거, 기존 `LoginsRemoved`로 열린 실시간 연결 철회를 같은 작업에 연결한다. 재사용/동시 요청 중 하나만 성공해야 한다. 일반 비밀번호 변경·탈퇴 시 남은 reset token도 무효화한다.
7. **알림/오류:** 완료 메일은 새 비밀번호나 토큰 없이 전송. SMTP 미설정/실패를 발송 완료로 가장하지 않는다. 비밀번호·원문 token·메일 링크·이메일 주소를 서버/프록시 로그에 남기지 않는다.

## 5. DB 담당 제안

아래는 테이블 제안이며 이번 작업에서 마이그레이션을 적용하거나 스키마를 변경하지 않았다. 현행 KST DATETIME 규칙과 계정 삭제 정책을 따른다.

- 계정의 `email_verified_at DATETIME(3) NULL` 또는 별도 이메일 소유 확인 테이블. 기존 행은NULL로 유지.
- `account_email_challenge`: ID, 목적, 정규화 이메일, nullable user ID(FK), `token_hash` UNIQUE, 발급/만료/소비 시각, pending verification 소비 정보. 원문 token/비밀번호 금지.
- 조회 인덱스: token hash, 이메일+목적, 만료 시각. 보존기간 이후 만료/소비 token 정리 작업.
- 원자적 소비 예: `UPDATE ... SET consumed_at=? WHERE token_hash=? AND purpose=? AND consumed_at IS NULL AND expires_at>?`. 영향 행1개일 때만 변경 진행. 비밀번호 변경/세션 삭제와 같은 DB 트랜잭션으로 처리.
- 재발급/제한은 다중 프로세스에서도 일관되도록 DB/공유 저장소로 처리. 이메일 중복은 사전 확인 후에도 최종 UNIQUE에서 막는다.
- migration/롤백 문서에 인증 기능 비활성 순서와 기존 계정 호환을 명시한다. 자동 앱 시작 시 DDL 실행 금지.

## 6. SMTP·웹·앱 배포 준비

발송 서비스는 미정이다. BE 환경변수 후보: `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`, `MAIL_PUBLIC_BASE_URL`, STARTTLS/연결·읽기 제한. 예시값/비밀값은 저장소에 추가하지 않는다. 운영에서는 발신 도메인 SPF/DKIM/DMARC와 HTTPS 링크를 준비한다.

링크 기준 URL은 서버의 허용된 설정값을 사용하고 요청 Host 헤더로 만들지 않는다. token을 fragment에 두면 웹 서버 query/access 로그로 전송되지 않는다. 로딩되는 인증 페이지에는 제3자 분석/추적 스크립트를 넣지 않는다.

Electron 후속 연결: 기본 브라우저의 HTTPS 메일 링크 → 웹 페이지에서 완료 또는 검증된 딥링크/일회용 교환 코드로 앱 복귀. 일반 웹 쿠키를 앱에 그대로 복사하거나 URL에 로그인 세션/장기 토큰을 싣지 않는다. 현재 앱은 붙여넣기 UI만 준비됐으며 `app://`와 서버의 계정 쿠키/CSRF 연결은 후속이다. 승인된 서버 주소만 허용하는 main/preload 경계를 설계해야 한다.

## 7. 인수 검증

BE/DB: 원문 미저장, 잘못된 token·다른 목적·만료·재사용·동시 소비·발급 간격·미존재/CLOSED 계정·메일 실패·전체 세션 철회·CSRF·최종 이메일 중복·비밀번호 변경 후 기존 token 무효·기존계정 migration을 실제 MySQL로 확인한다.

FE: 입력 누락/이메일 형식/비밀번호12자·72바이트/재입력 불일치, 준비중·요청중·만료·429·서버 실패·성공, 링크 진입/URL 정리/취소 정리/좁은 화면을 확인한다. mock 요청 검증과 실제 메일 도착 검증을 구분한다.

근거: [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Spring 이메일 지원](https://docs.spring.io/spring-boot/reference/io/email.html). SMTP/DB/운영 메일 도착 검증은 후속 구현 담당의 작업이다.
