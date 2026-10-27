# 데스크톱 앱의 작은 카메라 창

- 상태: superseded (2026-10-27) — klaod-tech가 요청해 lellon0403이 만든 작은 창(develop PR #64 `ad7cd42`, [계획 0057](0057-native-camera-window-and-design-review.md))으로 바꿨다. V3의 `features/desktop/DesktopCameraWindow`·`useDesktopCameraWindow`와 `main.cjs`의 같은 기능은 10/27 develop을 V3에 합치며 지웠다. 아래는 기록으로 남긴다
- 담당: FE(klaod-tech)
- 시작일: 2026-10-26
- 관련 요구사항/ADR: [ADR 0028](../../decisions/0028-no-web-camera-window-desktop-only.md)(웹에는 작은 창 없음, 데스크톱만), [ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md) 「남은 결정」의 작은 항상-위 창, [FE 제안서](../../design/fe-server-proposal.md) 8.3·8.4, [계획 0054](0054-pip-fix-and-server-only-login.md) 1단계(시험 기록)

## 문제와 완료 기준

측정 중 다른 프로그램을 볼 때 자세를 볼 곳이 없다. 웹은 브라우저 제한으로 작은 창을 두지 않기로 했고(ADR 0028), 데스크톱 앱에서는 창을 직접 만들 수 있다.

완료 기준:
- 데스크톱 앱에서 카메라가 켜진 채 PoseGood 창이 포커스를 잃거나 최소화되면 화면 오른쪽 아래에 작은 카메라 창이 저절로 보인다. PoseGood 창이 다시 앞으로 오면 숨는다. 클릭·묻는 안내가 없다.
- 작은 창은 항상 위, 포커스를 가져가지 않고, 작업 표시줄에 따로 나오지 않는다. 끌어서 옮길 수 있다.
- 띠: 측정 상태 점·문구(초록 「바른 자세예요」, 빨강 「자세가 흐트러졌어요」 + 빨간 테두리, 회색 「자세를 확인할 수 없어요」·「쉬는 중」, 측정 중이 아니면 「카메라 사용 중」), 최소화(영상만 숨김, 측정 계속), 확대(PoseGood 창을 앞으로 + 측정 화면), X(측정 중이면 종료·저장, 아니면 이번 카메라 동안 작은 창 끔).
- 카메라를 끄면 작은 창이 닫힌다. PoseGood 창을 닫으면 작은 창도 닫혀 앱이 끝난다.
- 웹(일반 브라우저)에는 아무것도 생기지 않는다. 웹에서는 「작은 카메라 창은 데스크톱 앱에서 쓸 수 있어요」를 알린다.
- `check-frontend` 통과, 데스크톱 개발 실행·패키징 실행으로 수동 확인 기록.

## 범위와 제외

- 범위: `frontend/electron/main.cjs`(창 열기 허락·보이기/숨기기·앱 앞으로), `preload.cjs`(`focusApp`·작은 창 지원 표시), `features/desktop/`(작은 창 화면·훅, `bridge.ts` 타입), 붙이는 곳 `app/ServiceScreens.tsx`, 웹 안내 문구.
- 다시 쓰는 것: 지운 웹 작은 창의 띠·상태 표시 코드(`409de69^`의 `CameraWindow.tsx`·`useCameraWindow.ts` `CAMERA_WINDOW_STYLE`), `features/session/sessionControl.ts`.
- 제외: 트레이 아이콘, 작은 창 켜고 끄는 설정(필요하면 다음), 패키징된 앱이 `https://app.posegood.site`를 여는 것(F14, 배포 4장 5단계), 서버·계약 변경.
- 지키는 것: 새 `getUserMedia` 없음(같은 스트림), 영상 저장·전송 없음, IPC는 앱 자신의 주소에서 온 요청만, 작은 창은 다른 주소로 이동·새 창 열기 불가.

## 설계

1. **창 만들기:** 카메라가 켜지면 화면이 `window.open('about:blank', 'posegood-camera-window', …)`를 부른다. main의 `setWindowOpenHandler`가 이 이름·주소만 허락하고 테두리 없는 항상-위 창 옵션(`frame: false`, `alwaysOnTop`, `skipTaskbar`, `show: false`, `focusable`은 끌기 위해 켬)으로 만든다. 그 밖의 새 창은 지금처럼 막는다.
2. **같은 스트림:** 같은 출처의 자식 창이라 화면이 React portal로 그리고 `video.srcObject`에 지금 스트림을 그대로 넣는다(예전 문서 PiP와 같은 방식).
3. **보이기·숨기기(main):** `did-create-window`로 작은 창을 잡아 두고, 메인 창 `blur`·`minimize`면 `showInactive()`, `focus`·`restore`면 `hide()`. 작은 창 자신을 눌러 메인 창이 포커스를 잃은 경우는 계속 보인다.
4. **위치:** 메인 창이 있는 화면의 작업 영역 오른쪽 아래, 자세 알림 팝업 자리(높이 76 + 여백) 위. 사용자가 옮기면 그 자리를 유지한다(앱 실행 동안).
5. **확대:** 화면이 `posegoodDesktop.focusApp()`(새 IPC)을 불러 main이 메인 창을 복원·앞으로 가져오고, 화면은 측정하기로 간다.
6. **웹 안내:** 측정하기 준비 화면에 한 줄(데스크톱 앱이 아닐 때만). 문구 안: 「작은 카메라 창은 데스크톱 앱에서 쓸 수 있어요. 웹에서는 다른 탭에 가도 측정이 이어져요.」

## 작업 단계

- [x] 문서: ADR 0028, 이 계획, 계획 0054 기록, FE 제안서 8.3·8.4·7.2, 문서 목록
- [x] main·preload: 창 열기 허락(`allowCameraWindow`), 보이기/숨기기(`syncCameraWindow`), `focusApp`, 최소화 때 띠 높이로(`setCameraWindowCompact`), 메인 창 닫힘 정리
- [x] 화면: `features/desktop/useDesktopCameraWindow.ts`·`DesktopCameraWindow.tsx`, `ServiceScreens` 연결, `bridge.ts` 타입
- [x] 웹 안내 문구: 측정하기 준비 화면 「이렇게 앉으면 좋아요」 카드에 한 줄(데스크톱 앱이 아닐 때만)
- [x] 시험: `DesktopCameraWindow.test.tsx` 5개 — 카메라 켜짐/꺼짐에 따른 열기·닫기, 브라우저·옛 셸에서 안 열림, 측정 상태 표시와 X 종료, 측정 아닐 때 X는 다음 카메라까지 닫음, 최소화·확대
- [x] `check-frontend` 통과, 데스크톱 개발 실행(`npm run desktop`) 짧은 수동 확인
- [x] 낡은 문서·시험 정리: `frontend/README.md`, `docs/architecture.md`, `docs/code-structure.md`, `research/guided-collection-v2.md`, 연동 명세 5.2 표, `tools/browser/camera-preview.mjs`(웹 작은 창·PiP 항목 → 「작은 창 없음」 확인)
- [ ] 서버를 붙인 뒤 다시 확인: 측정 중 작은 창 상태 점·문구, X = 측정 종료·저장, 자세 알림 팝업과 겹침, 긴 측정에서 숨은 동안 추적
- [ ] 패키징(`npm run desktop:pack`) 실행 파일로 확인

## 결정과 진행 기록

- 2026-10-26: 웹 작은 창을 지우고 데스크톱에서만 만들기로 함(ADR 0028). 방식은 `window.open` + `setWindowOpenHandler`(같은 스트림을 portal로), 보이기·숨기기는 main이 메인 창 포커스로 정함.

- 2026-10-26: 작은 창의 띠는 늘 보이게 했다. 데스크톱 창에서 끄는 영역(`-webkit-app-region: drag`)은 마우스 이벤트를 가져가 「마우스를 올리면 나타나는 띠」를 안정적으로 잡을 수 없다. 띠 전체가 끄는 손잡이이고 버튼만 누를 수 있다.
- 2026-10-26: 측정 중이 아닐 때의 X는 그 카메라가 꺼질 때까지 작은 창을 닫는다(다음에 카메라를 켜면 다시 연다). 측정 중 X로 측정이 끝나면 측정 종료 처리가 카메라를 끄므로 작은 창도 닫힌다.

## 검증 결과와 남은 한계

- 2026-10-26: `npm run check`(= `check-frontend`) 통과 — 시험 230개(새 시험 5개), 타입 검사, 빌드(같은 날 저녁 서버 시각 작업 뒤 238개). `node --check electron/main.cjs`·`preload.cjs`·`tools/browser/camera-preview.mjs` 통과. `check-repo` 통과.
- 2026-10-26 수동(데스크톱 개발 실행, 화면만 보는 가짜 계정 서버): 로그인 → 측정하기에서 카메라 켬 → 다른 창으로 가면 오른쪽 아래 작은 창이 보이고, PoseGood 창으로 돌아오면 숨는 것을 짧게 확인했다(klaod-tech).
- 남은 한계: 가짜 서버에는 측정이 없어 측정 중 상태 표시·X 종료는 단위 시험으로만 확인했다. 서버를 붙인 뒤 확인한다. 패키징 실행 파일 확인과 `check-browser`(G1·G6로 이미 실패)는 하지 않았다.
