# Discord 로그인·연결과 비밀번호 재설정

- 상태: in_progress (BE·FE 구현 완료·기본 꺼짐, DB 표 적용 대기)
- 담당: FE 우진(구현 BE·FE), DB 유진(표 V2.7), DevOps/BE 홍규(환경변수·배포)
- 시작일: 2026-11-11
- 관련: [인계](../../design/social-login-password-reset-handoff.md), [쉬운 설명](../../design/social-login-eli5.md), [계약](../../../contracts/accounts.v2.md), ADR 0031(로그인 토큰), [이메일 인계](../../design/email-account-handoff.md)

## 문제와 완료 기준

1. 소셜 로그인: Discord로 로그인·가입하고, 기존 계정에 Discord를 연결·해제할 수 있다. 화면에는 Discord·카카오·Google·GitHub 둥근 버튼을 두고 Discord부터 동작시킨다.
2. 비밀번호 찾기: 비밀번호를 돌려주지 않는다. 일회용 재설정 링크로 사용자가 새 비밀번호를 정하게 한다.

완료 기준: DB 표 적용 → 환경변수 설정 → 기능 켬 → `-Pmysql-integration`, 실제 Discord 앱, 실제 메일 도착 확인.

## 범위와 제외

- BE: `account/` Discord·재설정 경로, `SchemaVerifier`는 켠 기능의 표만 확인. 기본 꺼짐.
- FE: 로그인 화면 Discord 버튼, Discord 가입(약관 → 프로필, 비밀번호 없음), 프로필 설정의 연결·해제, 재설정 화면 서버 연결.
- 제외: DB 마이그레이션 적용(DB 담당), 이메일 인증, 데스크톱 앱 Discord, 카카오·Google·GitHub 어댑터(버튼·경로·DB 목록만 준비).

## 작업 단계

- [x] BE 구현과 단위 시험(`SocialLoginServiceTest`, `PasswordResetServiceTest`)
- [x] FE 구현과 단위 시험(`socialLogin.test.ts`)
- [x] 계약·인계·상태 문서
- [x] DB 표 V2.7 파일 작성(유진): `database/migrations/017_create_social_identity_password_reset_token.sql`, `schema_V2_7.sql`, 무결성 검사. DB CI·실제 DB 적용은 아직
- [ ] 환경변수·Discord Portal Redirect·SMTP(홍규)
- [x] MySQL 통합 시험에 비밀번호 재설정 경로 추가(`PasswordResetMySqlIntegrationTest`, 11/16)
- [ ] MySQL 통합 시험에 Discord(`social_identity`) 경로 추가, 실제 Discord·메일 확인

## 결정과 진행 기록

- 2026-11-11: 제공자는 Discord 먼저(사용자 결정). 같은 이메일은 자동 연결하지 않는다. 대기 상태는 서버 메모리(한 인스턴스 전제).
- 2026-11-11: 임시 비밀번호 대신 일회용 링크로 정했다. 임시 비밀번호도 평문으로 메일함에 남기 때문이다.
- 2026-11-11(사용자 결정): 제공자는 Discord·카카오·Google·GitHub를 화면에 둔다. 준비 중인 것은 흐리게 두고 누르면 안내한다. BE는 공통 경로 `/{provider}`와 제공자별 어댑터(`SocialProviderClient`)로 만든다. DB CHECK에는 네 제공자를 한 번에 넣는다.
- 2026-11-11(DB): V2.7을 migration 017과 `schema_V2_7.sql`로 확정했다. 번호는 T-52·T-53, UK-18~20, FK-29·30. 인계 SQL과 달리 보조 인덱스 `ix_password_reset_token_user_issued`는 넣지 않았다 — DB 규칙상 인덱스는 다른 파일에 두고, 사용자별 조회는 FK-30 자동 인덱스로 충분하다(사용자별 행이 적음). 그 밖의 컬럼·제약은 인계 SQL과 같다.
- 2026-11-11: 로그인 화면의 안내 문구는 폼 아래 빈 자리에 띄워서 로그인 칸이 밀리지 않게 했다. 패키징 앱은 배포된 웹을 열기 때문에, 배포 전 확인은 `npm run desktop`(로컬 코드)으로 한다.

## 검증 결과와 남은 한계

결과는 PR 본문과 이 절에 기록한다.

- 2026-11-16 비밀번호 재설정 MySQL 통합 시험(`backend/api/.../it/PasswordResetMySqlIntegrationTest.java`): 기능을 켠 API + 로컬 MySQL 8(V2.7 `schema_V2_7.sql`로 만든 임시 DB). SMTP 대신 보낸 메일을 담는 시험용 발송기를 쓴다.
  `backend/gradlew -p backend :api:build -Pmysql-integration` → BUILD SUCCESSFUL, api 시험 120개 통과(건너뜀·실패 0, 그중 통합 15개 = 기존 13 + 새 2), 새 파일 Checkstyle 경고 0.
  확인한 것: 메일 링크의 토큰과 DB SHA-256 일치·원문 미저장, 수명 30분·발급 시각 KST, 메일에 비밀번호 없음, 없는 주소·60초 안 재요청은 같은 202에 메일·토큰 없음, 출처 한도 6번째 429,
  비밀번호 규칙 위반 400(토큰 남음), 완료 204·토큰 소비·refresh 토큰 모두 철회·기존 refresh 401, 같은 링크 재사용 410, 옛 비밀번호 401·새 비밀번호 200,
  비밀번호 직접 변경 뒤 남은 링크 410, DB에 넣은 KST 만료 시각(1분 전 410, 5분 남음 204)과 발급하지 않은 토큰 410.
- 2026-11-16 실제 SMTP 로컬 확인: `tools/dev.py dev-server`(임시 V2.7 DB)에 Gmail SMTP(`smtp.gmail.com:587` STARTTLS, 프로젝트 전용 Gmail 계정 + 앱 비밀번호)를 환경변수로 넣어 실행.
  재설정 요청 → 메일이 그 Gmail 받은편지함에 도착(제목·본문·30분 안내 정상) → 링크로 새 비밀번호 저장. DB에서 확인: 새 발급 때 이전 토큰 무효, 쓴 토큰 소비, refresh 토큰 모두 철회, 옛 비밀번호 로그인 401.
  보낸 주소와 받은 주소가 같은 계정이어서 다른 메일함의 스팸 분류는 보지 못했다.
  로컬 주의: `dev-server`는 프론트 포트를 임의로 고르므로 `POSEGOOD_APP_URL`의 포트(5173)와 다르면 메일 링크가 열리지 않는다(포트를 바꿔 열거나 5173에 Vite를 하나 더 띄움). 실행은 `.venv` Python으로 한다(시스템 Python에는 `pymysql`이 없을 수 있음).
- 아직 확인하지 않은 것: 운영 DB의 017 적용, 운영 SMTP 설정·다른 메일함 도착과 스팸 분류, Cloudflare → gateway 뒤의 출처 제한, Discord 경로의 MySQL 시험, 실제 Discord 앱.
