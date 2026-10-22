# 작은 카메라 창(자동 PiP) 고치기, 그다음 시험 전용 로컬 로그인 지우기

- 작성자: klaod-tech(FE)
- 상태: planned (2026-10-22 작성. 순서: 1 PiP → 2 로그인)
- 담당: FE(klaod-tech)
- 시작일: 2026-10-22
- 관련: [FE 제안서](../../design/fe-server-proposal.md) 7.2(다음 할 일)·8.3(작은 카메라 창), [ADR 0025](../../decisions/0025-app-always-measures-on-server.md)(항상 서버로 측정),
  [계획 0023](0023-frontend-server-only.md)(F12 옮김), [배포](../../design/fe-deploy.md)(`app.posegood.site`, Cloudflare 터널)

## 문제와 완료 기준

### 1. 작은 카메라 창이 저절로 열리지 않는다 (먼저)

측정 중 다른 탭이나 다른 사이트로 가면 카메라 작은 창(Chrome 문서 PiP)이 저절로 떠야 한다(10/20 결정, 수동 버튼 없음).
10/20 시험에서 처리기는 등록되지만(콘솔 `[PoseGood] automatic picture-in-picture handler registered`) 탭을 바꿔도 Chrome이 부르지 않았다.
같은 PC에서 Chrome 공식 시험 페이지(카메라+마이크, https)는 열렸다. 코드는 `features/camera/useCameraWindow.ts`(`mediaSession.setActionHandler('enterpictureinpicture')`, `setCameraActive(true)`).

같이 확인할 것: 탭이 보이지 않으면 브라우저가 타이머를 늦춘다. 프레임 반복이 `setTimeout`이라 다른 사이트에 있는 동안 측정이 「영상 멈춤」(`away`)으로 일시정지될 수 있다.

완료 기준:
- Chrome에서 측정 중 다른 탭·다른 사이트로 가면 작은 창이 저절로 열린다. 확인 주소는 실제로 쓸 `https://app.posegood.site`(Cloudflare 터널 뒤 서버)와 개발 주소 둘 다다.
- 작은 창이 떠 있는 동안 측정이 「영상 멈춤」 없이 이어진다. 서버 `progress`의 `away_ms`가 늘지 않는다.
- 원인과 고친 내용, 안 되는 조건(브라우저·설정)이 아래 기록에 있다.

### 2. 시험 전용 로컬 로그인을 지우고 서버 로그인만 남긴다 (1 다음)

10/22 F12(`f27dd24`, ghdrb1246)를 V3로 옮기며 앱은 항상 서버 계정을 쓴다(스위치 없음). 하지만 예전 화면 시험(`app/ServiceApp.test.tsx`, 41개 중 로그인을 거치는 것 대부분)이 이 기기 로그인을 전제로 짜여 있다.
그래서 그 시험 파일만 계정 클라이언트를 `null`로 바꾸고, `LocalServiceApp`에는 `accounts`가 `null`일 때의 로컬 로그인·가입 경로가 남아 있다. 실제 앱에서는 들어갈 수 없는 시험 전용 코드다.

완료 기준:
- `LocalServiceApp`에 로컬 로그인·가입 경로가 없다: `accounts` prop의 `null`, `storedAccount`·`keepSignup`의 이 기기 계정 저장(`KEYS.account`), `validPassword`·`PASSWORD_GUIDANCE`(서버 규칙 `validServerPassword`만 남김).
- `ServiceApp.test.tsx`가 가짜 계정 서버(가짜 `AccountClient`, `LocalServiceApp.accounts.test.tsx`와 같은 방식)로 로그인한다. `vi.mock('../features/auth/accountClient')`의 `null` 대체가 없다.
- 이 기기에 남아 있던 예전 계정 자료(`KEYS.account`)를 어떻게 할지 정하고 처리한다(읽지 않음 또는 지움).
- `check-frontend` 통과, 시험 수 기록.

## 범위와 제외

- 범위(1): `features/camera/useCameraWindow.ts`, `CameraWindow.tsx`, 측정 프레임 반복(`features/camera/frameLoop.ts`)의 숨은 탭 동작, `frontend/electron`은 확인만.
- 범위(2): `app/LocalServiceApp.tsx`, `app/ServiceApp.test.tsx`, `features/auth/password.ts`, `features/storage/`(`KEYS.account`·`LocalAccount`·`validAccount`), `features/profile/useProfileForm.ts`(탈퇴 때 지우는 키).
- 제외: 비밀번호 변경(A6)·탈퇴(A7)·선택 동의(C1)·W1·W2 연결, `AUTH_CHANGED` 처리(FE 제안서 7.2 7번 — 따로 한다). 서버 쪽(CORS·쿠키 `Secure`·WS 허용 출처)은 BE·DevOps.
- 지키는 것: 시험은 합성 자료만. 실제 계정·비밀번호를 저장소에 넣지 않는다.

## 작업 단계

### 1단계 — 자동 PiP

- [ ] 조건 비교(Chrome, 같은 PC): ① 카메라만 vs 카메라+마이크 캡처 ② `http://127.0.0.1` vs `https://app.posegood.site`(터널) ③ 사이트 설정의 「자동 PIP」 허용 여부 ④ 탭을 바꾸기 전에 사용자 조작이 있었는지. 결과마다 콘솔의 `[PoseGood]` 진단 줄을 기록한다.
- [ ] Chrome 공식 시험 페이지와 우리 앱의 차이를 하나씩 맞춰 보며 원인을 좁힌다(마이크가 필요하면 마이크 없이 되는 방법이 있는지, 없으면 사용자 안내로).
- [ ] 고친다. 저절로 열 수 없는 조건이면 그 조건을 안내한다(수동 버튼은 두지 않기로 한 10/20 결정은 유지하되, 바꿔야 하면 사용자에게 다시 묻는다).
- [ ] 숨은 탭 타이머: 다른 사이트에 있는 동안 프레임 반복이 늦어져 `away`가 되는지 Chrome에서 직접 본다. 그렇다면 대안(작은 창의 `requestVideoFrameCallback`, Worker 타이머 등)을 비교해 고른다. 데스크톱 앱은 `backgroundThrottling: false`로 확인만.
- [ ] 시험: 처리기 등록·열기 실패 안내는 단위 시험, 실제 자동 열림은 수동 확인 기록.

### 2단계 — 서버 로그인만

- [ ] `ServiceApp.test.tsx`에 가짜 계정 서버를 넣는다: `login`·`register`·`me`·`logout`을 합성 응답으로, 로그인 도우미(`login()`)는 비동기(`await act(async …)`)로.
- [ ] 로그인을 거치는 시험을 하나씩 옮기고, 가입 시험의 비밀번호를 서버 규칙(12자 이상)에 맞춘다.
- [ ] `LocalServiceApp`에서 `accounts === null` 경로와 이 기기 계정 저장을 지운다. `accounts`는 시험에서 가짜를 넣을 수 있게 prop으로 두되 `null`은 받지 않는다.
- [ ] `KEYS.account` 처리: 앱이 더 읽지 않으면 저장 검증·탈퇴 정리 목록에서도 뺀다(`features/storage/`, `useProfileForm.ts`).
- [ ] `password.ts`의 로컬 규칙(`validPassword`) 삭제, 화면 문구는 서버 규칙 하나로.
- [ ] 문서: frontend/README 「로그인과 회원가입」, FE 제안서 8.1·7.2, 계획 0023 F12 항목.

### 공통

- [ ] `python tools/dev.py check-frontend`, `check-repo`. 결과를 아래에 기록.

## 결정과 진행 기록

- 2026-10-22: 로그인은 스위치 없이 항상 서버 계정(klaod-tech: 로컬로 돌릴 이유가 없다). 시험 전용 로컬 로그인은 PiP를 고친 뒤 지운다(이 계획).

## 검증 결과와 남은 한계

아직 없음.
