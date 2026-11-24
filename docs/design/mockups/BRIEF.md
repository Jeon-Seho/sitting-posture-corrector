# 프론트 재디자인 HTML 시안 브리프

학교 부스 발표용으로 PoseGood(바른자세 도우미) 프론트의 **보이는 경험**을 다시 디자인한다.
이 단계는 실제 앱 코드를 고치지 않고 **정적 HTML 시안**만 만든다. 사용자가 시안 하나(또는 조합)를 고르면
그 결과로 디자인 문서를 만들고 나서 `frontend/`에 적용한다.

## 목표

- 부스 방문자가 처음 보고 바로 "써보고 싶다"고 느끼는 첫인상
- 처음 쓰는 사람의 흐름: 시작 → 회원가입/로그인 → 카메라·기준 자세 등록 → 첫 측정까지 막힘 없이
- 회원가입·로그인 사용감: 입력 검증, 오류 문구, 진행 표시, 로딩·비활성 상태, 키보드 이동
- 측정 화면은 멀리서도 상태가 읽혀야 한다(부스 모니터에서 시연)

## 반드시 지킬 것

1. 먼저 현재 코드를 읽고 실제 기능·흐름·문구를 파악한다. 시안은 **있는 기능을 더 잘 보여주는 것**이 기본이다.
   새 기능을 넣으면 화면에 `제안` 표시를 붙이고 노트에 적는다.
   - 진입·라우팅: `frontend/src/app/` (ServiceApp, LocalServiceApp)
   - 로그인·회원가입·이메일 인증·비밀번호 재설정·Discord 로그인·동의: `frontend/src/pages/LoginPage.tsx`, `frontend/src/features/auth/`, `contracts/accounts.md`, `contracts/consent-documents.md`
   - 첫 설정·카메라·기준 자세: `frontend/src/pages/SetupPage.tsx`, `frontend/src/features/baseline/`, `frontend/src/features/camera/`, `frontend/src/components/PreparationSteps.tsx`, `PoseGuide.tsx`
   - 측정: `frontend/src/features/session/live/` (LiveSessionPage 등)
   - 기록·달력: `frontend/src/features/history/`, `frontend/src/components/RateRing.tsx`, `ComboChart.tsx`
   - 현재 디자인 규칙과 자산: `DESIGN.md`, `frontend/src/styles/`, `frontend/public/branding/`, `frontend/public/illustrations/`, `frontend/public/icons/`
2. 한국어 UI. 글꼴은 Pretendard(CDN `https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css` 허용).
3. **파일 하나짜리 HTML**: CSS·JS는 파일 안에 넣는다. 프레임워크·빌드 없음. 외부 요청은 글꼴 CDN만 쓴다.
   기존 자산은 상대 경로로 참조해도 된다(예: `../../../../frontend/public/branding/posegood-icon.svg`).
4. 컴포넌트는 shadcn/ui 패턴을 따른다: Input·Button·Dialog·Tabs·Card의 구조, focus ring, hover/disabled/loading/error 상태.
5. 기본 캔버스는 데스크톱 앱 1360×860(최소 1180×760). 좁은 창(390px)에서도 깨지지 않는지 한 번 확인한다.
6. 서비스 성격: 비의료 서비스다. 진단·치료·교정 효과를 말하지 않는다. 점수·신뢰도를 의학적 확률처럼 표현하지 않는다.
   **측정 불가(unmeasurable)는 중립색**이며 정상이나 흐트러짐처럼 보이면 안 된다. 기준 미등록·카메라 거부·연결 끊김도 구분한다.
7. 실제 사람 사진·영상을 쓰지 않는다. 카메라 영역은 어두운 면 + 단순 실루엣/관절 점선 같은 자리표시로 그린다.
8. 자기 폴더(`docs/design/mockups/<시안이름>/`) 밖의 파일을 만들거나 고치지 않는다. git 명령(commit·checkout·stash 등), npm install, 앱 실행을 하지 않는다.

## 시안 하나에 들어갈 화면

화면 위(또는 옆)에 **화면 전환 바**를 두고 아래 6개 화면을 오갈 수 있게 한다.

| # | 화면 | 꼭 보여줄 것 |
| --- | --- | --- |
| 1 | 시작(웰컴) | 서비스 한 줄 소개, 어떻게 동작하는지 3단계 정도, 시작하기·로그인 |
| 2 | 회원가입 | 실제 필드와 단계(이메일 인증 코드, 필수/선택 동의 포함), 진행 표시, 인라인 검증·오류 예시 |
| 3 | 로그인 | 이메일·비밀번호, Discord 로그인, 비밀번호 찾기, 오류·로딩 상태 |
| 4 | 첫 설정 | 카메라 권한 안내 → 카메라 위치 맞추기 → 기준 자세 3초 등록(카운트다운 애니메이션) |
| 5 | 측정 | 카메라 자리표시 + 상태(정상·흐트러짐 알림·측정 불가·연결 중)를 버튼으로 바꿔 볼 수 있게. 점수·유지 시간·알림 |
| 6 | 오늘 기록 | 바른 자세 비율, 알림 횟수, 시간대 그래프, 최근 측정 목록 |

앱 안의 탐색 구조(사이드바: 측정하기·기록·달력·설정, 아래 계정 메뉴)는 바꿔도 되지만 바꾸면 이유를 노트에 쓴다.

## 산출물

`docs/design/mockups/<시안이름>/` 아래에:

- `index.html` — 위 6개 화면이 모두 들어간 시안
- `NOTES.md` — ① 디자인 방향과 키워드, ② 색·글자·모서리·간격 토큰 표, ③ 현재 앱 대비 UX 개선점(근거: 현재 코드 `파일:줄`),
  ④ `제안` 표시한 새 기능 목록, ⑤ 실제 `frontend/` 적용 시 바뀌는 파일과 난이도(상·중·하)
