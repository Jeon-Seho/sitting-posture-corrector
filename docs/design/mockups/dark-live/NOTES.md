# PoseGood 다크 라이브 시안

## 디자인 방향

- 부스에서 멀리 봐도 자세 상태와 점수가 읽히도록 카메라와 판정 카드의 역할을 나눴다.
- 차콜 바탕과 밝은 민트를 시작부터 로그인, 측정, 기록까지 이어 썼다. 흐트러짐은 로즈, 측정 불가는 중립 회색, 서버 연결 상태는 블루로 구분했다.
- 상태가 바뀔 때 제목과 점수를 짧게 전환한다. 오늘 화면에서는 바른 자세 비율, 유효 측정 시간, 알림 횟수에서 시간대와 세션 상세로 내려간다.

## 디자인 토큰

| 역할 | 값 | 적용 |
| --- | --- | --- |
| 바탕과 면 | `#0C1015`, `#10151B`, `#151C24`, `#1B2530` | 배경, 탐색·입력, 카드, 선택·호버 면 |
| 글자 | `#F1F5F8`, `#A6B5C2` | 제목·본문, 보조 정보 |
| 상태와 행동 | `#8CF0BF` 민트, `#FFABB3` 로즈, `#B5C2D0` 회색, `#A9C8FF` 블루 | 정상·주요 행동, 흐트러짐·오류, 측정 불가, 서버 연결 |
| 테두리와 초점 | `#2D3A46` 일반, `#576877` Input, `#B5F7DB` Focus | 면 구분, 입력 경계, 2px 키보드 초점 링 |
| 글꼴 | Pretendard, 16px 기본, 13px 보조 | 수치에 고정폭 숫자 적용. 1360px에서 실시간 상태 약 58px, 점수 약 95px |
| 모서리 | 10 / 16 / 20px | 입력·버튼 / 카드 / 카메라 |
| 간격과 조작 높이 | 16px 카드 간격, 24px 기본 카드 안쪽, 44px 기본 입력·버튼 | 좁은 화면에서는 카드 간격 12px, 기본 안쪽 15px |
| 모션 | 180ms 조작 반응, 280ms 판정 제목·점수 | 모션 감소 설정에서는 전환·애니메이션을 제거하고 3초 카운트다운 숫자를 유지 |

Input, Button, Dialog, Tabs, Card는 shadcn/ui의 위계와 상태 패턴을 따라 구성했다. 카메라는 CSS 실루엣과 예시 관절 가이드로 표현했다.

## 현재 앱 대비 UX 개선

| 개선 | 현재 구현 근거 | 시안 |
| --- | --- | --- |
| 1. 첫 진입에서 사용 방법을 예고 | `frontend/src/app/LocalServiceApp.tsx:88`, `frontend/src/pages/LoginPage.tsx:28` | 시작 화면에서 측정 미리보기와 카메라 → 기준 등록 → 측정·기록을 확인한 뒤 시작하기 또는 로그인으로 이동한다. |
| 2. 계정 정보에 인증을 배치 | `frontend/src/app/LocalServiceApp.tsx:628`, `frontend/src/app/LocalServiceApp.tsx:656`, `frontend/src/app/LocalServiceApp.tsx:672`, `frontend/src/features/auth/MailAccessPage.tsx:89` | 3단계 가입과 항목별 동의는 유지한다. 이메일 옆에서 코드 발급과 검증을 진행하고, 계정 정보와 오류를 같은 화면에서 볼 수 있다. |
| 3. 카메라 준비와 기준 등록 상태를 안내 | `frontend/src/pages/SetupPage.tsx:219`, `frontend/src/pages/SetupPage.tsx:234`, `frontend/src/pages/SetupPage.tsx:315`, `frontend/src/features/camera/errors.ts:9` | 구도 확인, 등록 전 3초, 등록 중 3초를 단계 제목과 카메라 영역에서 함께 표시한다. 권한 거부는 재연결 안내를, 기준 미등록은 등록 상태를 표시한다. |
| 4. 멀리서도 판정과 점수를 함께 읽도록 배치 | `frontend/src/features/session/live/LiveSessionPage.tsx:379`, `frontend/src/features/session/live/LiveSessionPage.tsx:442`, `frontend/src/features/session/live/LiveSessionPage.tsx:459` | 고정 위치의 큰 상태 문구와 점수, 바로 아래 유지 시간·유지율·알림을 읽는 순서대로 배치한다. 측정 불가에는 중립색과 대시를, 서버 연결 상태에는 블루와 상태별 문구를 쓴다. |
| 5. 오늘 집계와 세션을 빠르게 대조 | `frontend/src/features/history/DayRecord.tsx:60`, `frontend/src/features/history/DayRecord.tsx:90`, `frontend/src/features/history/DayRecord.tsx:124`, `frontend/src/features/history/RecordHistoryItem.tsx:51` | 비율·유효 시간·알림을 상단에 배치한다. 아래에서 24시간 타임라인과 최근 측정의 세션 번호를 맞춰 보고 행을 펼쳐 세부 값을 확인한다. |

데스크톱에서는 현재 앱의 측정하기·오늘·기록·설정과 하단 계정 메뉴를 유지했다. 830px 이하에서 탐색을 본문 위로 옮겨 카메라와 기록에 가로폭을 확보한다. 날짜별 기록·설정·계정은 탐색 맥락을 확인할 수 있는 제한된 대화상자로 표시한다.

## 화면에 제안으로 표시한 항목

1. **로그인 전 시작 화면**. 비로그인 기본 진입점을 제안한다. 이용 흐름을 미리 본 뒤 회원가입이나 로그인으로 들어간다.
2. **계정 정보에서 이메일 인증**. 기존 인증 절차를 같은 화면에 넣는 UI 제안이다. 메일 기능이 활성화된 환경에서만 노출하는 것을 전제로 한다. 운영 발송·재요청·만료 규칙은 기존 계약을 따른다.

상단 화면 전환, 카메라 구도·권한 조작, 실시간 상태 버튼, 합성 계정·코드는 시안 검토용이다. 이 시안의 측정은 합성 예시를 사용하며 측정 종료 후 오늘 화면으로 바로 연결한다. 실제 앱의 종료 결과는 [LiveSessionPage](../../../../frontend/src/features/session/live/LiveSessionPage.tsx#L312)에서 먼저 표시된다.

## 실제 프론트엔드 적용 범위

| 파일 | 변경 내용 | 난이도 |
| --- | --- | --- |
| `src/app/ServiceApp.tsx`, `src/app/LocalServiceApp.tsx`, `src/pages/WelcomePage.tsx` (신규) | 비로그인 시작 화면과 기존 이메일·소셜 콜백 경로 연결 | 중 |
| `src/pages/LoginPage.tsx`, `src/app/LocalServiceApp.tsx`, `src/features/auth/MailAccessPage.tsx`, `src/features/auth/ConsentList.tsx` | 가입 폼 안에 기존 이메일 인증 UI를 배치하고 오류·재요청·초점 복귀를 연결 | 상 |
| `src/pages/SetupPage.tsx`, `src/components/PreparationSteps.tsx`, `src/components/PoseGuide.tsx`, `src/features/auth/SignupPostureStep.tsx` | 기존 권한 및 등록 상태를 카운트다운과 하나의 단계 안내로 표시 | 중 |
| `src/features/session/live/LiveSessionPage.tsx`, `src/styles/session.css`, `src/styles/typography.css` | 서버 판정·점수 표시 우선순위 변경, 유지 시간 표시, 전환 애니메이션과 모션 감소 적용 | 중 |
| `src/features/history/LocalHistory.tsx`, `src/features/history/DayRecord.tsx`, `src/features/history/RecordHistoryItem.tsx`, `src/styles/records.css` | 오늘의 집계 카드와 타임라인·세션 목록 재배치 | 중 |
| `src/app/AppSidebar.tsx`, `src/styles/appearance.css`, `src/styles/auth.css`, `src/styles/layout.css`, `src/styles/responsive.css` | 다크 색상과 공통 조작 토큰, 좁은 화면 탐색 적용 | 중 |

표의 경로는 `frontend/` 기준이다.

## 검증 범위

- 인라인 JavaScript를 `node --check --input-type=commonjs`로 검사했다.
- Chrome CDP로 로컬 `index.html`을 열어 8개 검증을 통과했다. 탭과 키보드 초점, 필수·선택 동의, 가입 오류·이메일 코드, 카메라 거부·3초 등록, 측정 상태·종료·기록 상세, 로그인·재설정·Discord 합성 흐름, 화면 너비·자산, 모션 감소를 점검했다. 실행 중 JavaScript 오류는 없었다.
- 1360×860, 1180×760, 390×844에서 여섯 화면의 가로 넘침을 확인했다. 1360px 및 390px에서 측정과 오늘 기록의 캡처를 확인했다.
- 부스 모니터의 3m 가독성, 스크린 리더, 실제 계정·메일·OAuth·카메라·판정 서버·알림 소리는 검증 범위 밖이다. 실제 앱의 타입 검사와 빌드는 실행하지 않았다.
