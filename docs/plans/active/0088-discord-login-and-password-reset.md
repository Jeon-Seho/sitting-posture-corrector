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
- [ ] MySQL 통합 시험에 두 표 경로 추가, 실제 Discord·메일 확인

## 결정과 진행 기록

- 2026-11-11: 제공자는 Discord 먼저(사용자 결정). 같은 이메일은 자동 연결하지 않는다. 대기 상태는 서버 메모리(한 인스턴스 전제).
- 2026-11-11: 임시 비밀번호 대신 일회용 링크로 정했다. 임시 비밀번호도 평문으로 메일함에 남기 때문이다.
- 2026-11-11(사용자 결정): 제공자는 Discord·카카오·Google·GitHub를 화면에 둔다. 준비 중인 것은 흐리게 두고 누르면 안내한다. BE는 공통 경로 `/{provider}`와 제공자별 어댑터(`SocialProviderClient`)로 만든다. DB CHECK에는 네 제공자를 한 번에 넣는다.
- 2026-11-11(DB): V2.7을 migration 017과 `schema_V2_7.sql`로 확정했다. 번호는 T-52·T-53, UK-18~20, FK-29·30. 인계 SQL과 달리 보조 인덱스 `ix_password_reset_token_user_issued`는 넣지 않았다 — DB 규칙상 인덱스는 다른 파일에 두고, 사용자별 조회는 FK-30 자동 인덱스로 충분하다(사용자별 행이 적음). 그 밖의 컬럼·제약은 인계 SQL과 같다.
- 2026-11-11: 로그인 화면의 안내 문구는 폼 아래 빈 자리에 띄워서 로그인 칸이 밀리지 않게 했다. 패키징 앱은 배포된 웹을 열기 때문에, 배포 전 확인은 `npm run desktop`(로컬 코드)으로 한다.

## 검증 결과와 남은 한계

결과는 PR 본문과 이 절에 기록한다. MySQL·실제 Discord·SMTP는 아직 확인하지 않았다.
