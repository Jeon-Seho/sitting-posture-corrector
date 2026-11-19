# ADR 0050: 같은 이메일의 Discord는 자동으로 연결하지 않고, 메일 인증은 서버가 보내며 켜야 동작한다

- 상태: accepted
- 날짜: 2026-11-18
- 작성: klaod-tech(FE)
- 근거: 우진(lellon0403) PR #127(11/18 develop 병합), [계획 0089](../plans/completed/0089-email-recovery-social-link.md), [계획 0088](../plans/active/0088-discord-login-and-password-reset.md)
- 관련: [ADR 0031](0031-jwt-access-refresh-login.md)(access·refresh 토큰 로그인), [계정 계약](../../contracts/accounts.md), [이메일 인계](../design/email-account-handoff.md), [FE 기능 명세](../design/fe/fe-feature-spec.md) 회원가입·Discord 로그인·비밀번호 찾기, [연동 명세](../design/fe/api-ws-spec.md) A9~A24

## 배경

- Discord 로그인(A11~A17)은 Discord가 확인한 이메일을 준다. 그 이메일로 이미 가입한 계정이 있을 때, 이전에는 `link-required`로 안내만 하고 앱 안에서 연결할 길이 없었다.
- 가입은 이메일 주소가 실제로 그 사람 것인지 확인하지 않았다. 비밀번호 찾기는 메일 링크로 들어오면 바로 새 비밀번호를 받았고, 기존 비밀번호를 다시 써도 막지 않았다.
- 메일 발송(SMTP)과 Discord 앱 설정은 운영 서버 비밀값이 있어야 한다. 앱이 서버보다 먼저 켜지면 사용자는 오지 않는 메일을 기다린다.

## 결정

1. **같은 이메일이어도 Discord를 기존 계정에 자동으로 연결하지 않는다.** 이메일이 같다는 것만으로는 그 Discord 사용자가 기존 계정 주인이라는 증거가 되지 않는다. 연결은 세 단계를 거친다.
   1. 서버가 `#social-link`로 돌려보내고, 앱은 「Discord 계정을 연결할까요?」 화면을 연다(A21).
   2. 기존 계정 비밀번호로 본인임을 확인한다(A22). 이 단계에서는 연결하지 않는다.
   3. 「연결 승인하고 로그인」을 눌러야 연결하고 로그인한다(A23). 「로그인으로 돌아가기」는 아무것도 연결하지 않는다(A24).
2. **메일은 서버가 보낸다.** 앱은 발송·확인을 요청만 하고 코드·링크 토큰을 저장하지 않는다. 링크로 들어오면 주소창에서 토큰을 바로 지운다.
   - 가입 인증: 6자리 코드, 15분, 5번까지(A18·A19). 서버도 가입(A2) 때 인증 쿠키와 이메일을 다시 맞춰 봐서 앱을 거치지 않는 가입을 막는다.
   - 비밀번호 찾기: 링크가 유효한지 먼저 확인하고(A20, 소비하지 않음) 새 비밀번호를 두 번 받는다. 기존 비밀번호와 같으면 400 `PASSWORD_REUSED`.
3. **서버와 앱 둘 다 켜야 동작한다(기본 꺼짐).** 서버 `POSEGOOD_EMAIL_VERIFICATION_ENABLED`·`POSEGOOD_PASSWORD_RESET_ENABLED`와 앱 `VITE_EMAIL_VERIFICATION_ENABLED`·`VITE_PASSWORD_RESET_ENABLED`·`VITE_DISCORD_LOGIN_ENABLED`. 꺼진 기능은 성공한 척하지 않고 아직 쓸 수 없다고 안내한다.

## 이유

- 자동 연결은 편하지만, 이메일만 같으면 남의 계정에 로그인하는 길이 된다. 비밀번호 확인과 최종 승인을 나누면 사용자가 무엇을 연결하는지 보고 정할 수 있다.
- 토큰을 앱에 두지 않으면 주소창·브라우저 기록·저장소로 새지 않는다.
- 운영 메일 설정이 늦어져도 앱 배포를 막지 않으려면 기능마다 따로 켤 수 있어야 한다.

## 결과

- 가입 인증 대기·Discord 연결 대기는 서버 메모리(API 한 대)에 있다. 서버가 다시 켜지면 410이 오고 처음부터 다시 한다. API를 여러 대로 늘리면 공유 저장소로 옮겨야 한다.
- 데스크톱 앱에서는 Discord 버튼을 숨긴다. 외부 브라우저에서 돌아오는 길은 아직 없다.
- 실제 SMTP 수신과 운영 Discord OAuth로 끝까지 확인한 적은 없다(계획 0089). 운영에서 켜는 것은 DevOps 설정 몫이다.
- 오류 문구와 화면은 [FE 기능 명세](../design/fe/fe-feature-spec.md)와 [FE 예외 기록](../design/fe/fe-exception-log.md)에 있다.
