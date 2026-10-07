# 데스크톱 앱 화면 설계

결정: [ADR 0017](../decisions/0017-desktop-app-shell-and-redesign.md). 시각 규칙: [DESIGN.md](../../DESIGN.md).
백엔드 연결 지점: [frontend-platform-seams.md](frontend-platform-seams.md).

## 실행

```sh
cd frontend
npm run desktop      # 개발 서버(5174)를 띄우고 Electron 창을 연다. 창을 닫으면 서버도 끈다.
npm run desktop:dev  # 이미 켜 둔 개발 서버(5173)에 창만 붙인다.
npm run dev          # 브라우저로 같은 화면을 연다.
```

`frontend/electron/`

앱 아이콘은 현재 화면의 강조색 라운드 사각형 바탕과 크림색 사람 두 덩어리로 단순화한
`frontend/public/branding/posegood-icon.svg`가 정본이다. 바깥은 투명하고 PNG·ICO는 같은 SVG에서 내보낸다.
로그인·사이드바는 `BrandMark`를 공유하고, 브라우저 탭과 Electron 창도 같은 아이콘을 읽는다.
Windows 패키징은 `win.icon`으로 ICO를 넣고 `signExecutable: false`로 서명만 생략한다.
`signAndEditExecutable: false`는 아이콘 리소스 편집까지 막으므로 사용하지 않는다.
빠른 실행기는 `copy-desktop.mjs`의 `/win32icon` 옵션으로 같은 ICO를 포함한다.
아이콘 변경 후 `npm run desktop:pack`으로 실행 파일을 다시 만든다.

| 파일 | 역할 |
|---|---|
| `main.cjs` | 창 생성, 외부 주소 차단, 단일 실행, 시작 프로그램 등록, 데스크톱 설정 파일(`userData/desktop-settings.json`) |
| `preload.cjs` | 페이지에 `window.posegoodDesktop`(launch 정보 읽기, 시작 프로그램, 자동 카메라)만 노출 |
| `launch-dev.mjs` | 바탕화면 바로가기용: 개발 서버 → 창 → 종료 시 서버 정리 |

IPC는 앱 자신의 로컬 주소에서 온 요청만 받는다. `nodeIntegration` 끔, `contextIsolation`·`sandbox` 켬.

창 형태: 기본 1360×860, 최소 1180×760. 제목 표시줄은 숨기고(`titleBarStyle: 'hidden'`) Windows는 `titleBarOverlay`로
창 버튼만 크림색(`#fbf5ee`) 위에 그린다. 메뉴는 `removeMenu()`로 없애 Alt를 눌러도 나타나지 않는다.
개발 실행에서는 F12/Ctrl+Shift+I(개발자 도구), Ctrl+R(새로고침)을 유지한다. 페이지는 `data-desktop`과 `--titlebar-h`로 여백을 맞추고
`features/desktop/TitleBar.tsx`가 끌기 영역을 그린다.

앱 화면 자동 점검: `POSEGOOD_DEBUG_PORT=9333 npm run desktop`으로 실행하면 개발 실행에서만 127.0.0.1 CDP 포트가 열린다.
패키징된 앱에서는 열리지 않는다.

## 화면과 코드 위치

| 탭 | 화면 | 코드 | 보여 주는 것 |
|---|---|---|---|
| 측정하기 | 준비(카메라 → 얼굴·어깨 → 5초 기준) | `pages/SetupPage.tsx` | 큰 카메라와 점선 가이드, 3단계 진행, 앉는 팁, 측정 시작 |
| 측정하기 | 측정 중 | `features/session/SessionLive.tsx`, `MeasureParts.tsx` | 상태 알약, 교정 카드, 잠시 쉬기/종료/소리 독, 점수 링, 이번 측정 요약, 최근 30분 흐름 |
| 측정하기 | 결과 | `features/session/SessionResult.tsx` | 바른 자세 비율 링, 한 문장 요약, 알림·회복·확인 못 한 시간, 자세히 보기(기존 통계·사건 표) |
| 측정하기 | 서버 판정(개발) | `features/session/server/ServerSessionPage.tsx` | 같은 레이아웃, 서버가 준 값만 표시 |
| 기록 | 기간별 기록 | `features/history/LocalHistory.tsx` | 평균 바른 자세·측정 시간·알림, 날짜별 막대, 자주 흐트러진 방향, 기록 목록, 처음/최근 비교 |
| 설정 | 설정 | `pages/SettingsPage.tsx` | 알림(3단계 선택 + 세밀 조정), 기준 다시 등록, 컴퓨터를 켤 때, 계정, 개발자 옵션 |
| 설정 | 프로필 / 자세 데이터 수집 | `features/profile/*`, `pages/CollectionPage.tsx` | 기존 화면을 새 색으로 표시 |
| — | 로그인 | `pages/LoginPage.tsx` | 왼쪽 소개, 오른쪽 입력 |

사이드바와 탭 연결: `app/AppSidebar.tsx`, `app/navigation.ts`(`tabOf`, `resolvePage`), 조립: `app/ServiceScreens.tsx`.

## 측정 상태와 문구

`features/session/liveView.ts`가 엔진 상태를 아래로 바꾸고, 화면은 이것만 본다.

| 상태 | 뜻 | 알약 문구 | 카메라 위 카드 |
|---|---|---|---|
| `normal` | 기준과 비슷 | 바른 자세예요 | 없음 |
| `suspect` | 변화가 이어지는 중(지속 시간 채우는 중) | 자세가 조금 달라졌어요 | 진행 막대 + "N초 넘게 이어지면 알려드릴게요" |
| `bad` | 알림 확정 | 몸이 한쪽으로 기울었어요 등 | 교정 안내 + 복귀 진행 막대, 카메라 테두리 로즈 |
| `recovering` | 바른 자세로 돌아오는 중 | 좋아요, 돌아오고 있어요 | 복귀 진행 막대 |
| `unmeasurable` | 측정 품질 부족 | 자세를 확인할 수 없어요 | "이 시간은 기록에서 빠져요" |
| `paused` | 사용자가 쉬는 중 | 쉬는 중 | 없음 |
| `analysisPaused` | (예정) 서버 판정이 5초간 없음 | 분석이 잠시 멈췄어요 | 측정 불가와 같은 회갈색 |

최근 30분 흐름은 화면 표시용으로 5초마다 상태를 샘플링한다. 저장 기록은 엔진 합계를 그대로 쓴다.

## 시작 프로그램 연결

설정 → `컴퓨터를 켤 때`.

1. `자동으로 PoseGood 열기`: `app.setLoginItemSettings({ openAtLogin, args: ['--launched-at-login'] })`.
   패키징 전에는 비활성(개발 실행은 개발 서버가 필요하다).
2. `열릴 때 카메라 바로 켜기`: 데스크톱 설정 파일에 저장. 시작 프로그램 인자로 열렸고 켜져 있으면
   `features/desktop/useLaunchAutomation.ts`가 로그인 후 측정하기 화면에서 카메라를 한 번 연결한다.
3. 다음 단계(미구현): 설치 파일 패키징 → 패키징된 앱이 `dist/`를 직접 읽도록 `main.cjs` 로딩 경로 추가 →
   저장된 기준 불러오기(플랫폼 `BaselinePort.latest`) → 클릭 없이 측정 시작 → 트레이/작은 항상-위 창.

## 시안

디자인 시안(캔버스 7장: 측정 중·알림·기준 등록·결과·기록·설정·작은 창)은 claude.ai 아티팩트로 공유했다.
시안의 숫자는 화면 예시 값이며 측정 결과가 아니다.
