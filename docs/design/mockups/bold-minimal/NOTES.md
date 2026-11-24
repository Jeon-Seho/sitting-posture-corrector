# PoseGood · Bold Minimal

## 디자인 방향

- **먼 거리에서도 읽히는 첫인상**. 흰 바탕에 큰 한글 제목, 기존 기본 테마의 선명한 초록, 앉은 자세를 단순화한 브랜드 도형을 놓았다.
- **한 화면에 한 가지 행동**. 웰컴의 시작 버튼에서 약관 → 계정 정보 → 선택 자세 등록으로 이어진다. 첫 설정에서는 권한 → 구도 → 기준 자세 등록의 현재 위치를 같은 자리에 보여준다.
- **상태는 말로 먼저**. 측정의 큰 제목과 다음 행동을 카메라 옆에 두고, 자세 흐트러짐에는 경고색을, 측정 불가와 연결 상태에는 회색을 쓴다.

## 토큰

| 역할 | 값 | 적용 |
| --- | --- | --- |
| 배경·본문 | `#FFFFFF` · `#171B18` · 보조 `#555E58` | 흰 바탕, 제목·설명 대비 |
| 구분선·보조 표면 | `#DDE4DE` · `#F5F7F5` | 카드·단계 경계, 시연 전환 바 |
| 강조 | `#18794E` · 눌림 `#11633E` · 연한 면 `#E8F5EE` | 주요 버튼, 포커스 링, 현재 단계와 정상 상태 |
| 경고 | 글자 `#A12B36` · 면 `#FFF1F1` | 입력 오류와 확정 자세 흐트러짐 |
| 중립 | 글자 `#535B57` · 면 `#EEF0EE` | 측정 불가, 연결 중, 연결 끊김, 기준 미등록 |
| 카메라 | `#191E1C` · 윤곽 `#B8D4C3` | 실제 영상 대신 윤곽·관절 점 |
| 글꼴 | Pretendard · 맑은 고딕 대체 | 웰컴 제목 최대 100px, 첫 설정 제목 최대 62px, 측정 상태 최대 52px, 본문 16~18px, 입력 16px |
| 모서리 | 버튼·입력 11px · 카드 18px · 카메라 20px · 웰컴 그래픽 26px | 입력과 버튼 높이 기본 44px, 주요 행동 54px |
| 간격 | 4·8·12·16·24·32px 중심 | 카드 내부 24px, 첫 설정 열 간격 24px, 모바일 페이지 좌우 18px |

## 현재 앱 대비 UX 개선

| # | 개선 | 현재 코드 근거 |
| --- | --- | --- |
| 1 | 첫 방문자가 가입 양식을 만나기 전에 서비스의 역할, 카메라 → 기준 등록 → 알림 흐름, 시작과 로그인을 한눈에 확인한다. | [`LoginPage.tsx:24`](../../../../frontend/src/pages/LoginPage.tsx#L24), [`LocalServiceApp.tsx:709`](../../../../frontend/src/app/LocalServiceApp.tsx#L709) |
| 2 | 회원가입의 진행 단계와 남은 필수 동의를 표시한다. 별도 메일 화면을 열던 코드 요청·확인을 이메일 옆으로 옮기고 형식 오류를 필드 아래에 표시한다. 로그인은 이메일, Discord, 비밀번호 찾기의 경로를 글자로 구분한다. | [`ConsentList.tsx:16`](../../../../frontend/src/features/auth/ConsentList.tsx#L16), [`LocalServiceApp.tsx:626`](../../../../frontend/src/app/LocalServiceApp.tsx#L626), [`LocalServiceApp.tsx:672`](../../../../frontend/src/app/LocalServiceApp.tsx#L672), [`MailAccessPage.tsx:44`](../../../../frontend/src/features/auth/MailAccessPage.tsx#L44), [`LocalServiceApp.tsx:724`](../../../../frontend/src/app/LocalServiceApp.tsx#L724) |
| 3 | 카메라 권한·구도·등록을 상단에 고정된 위치에 보여주고, 현재 단계의 안내와 카메라 예시를 함께 바꾼다. 준비 대기 3초와 기준 자세 수집 3초의 숫자·문구가 각각 달라진다. | [`SetupPage.tsx:112`](../../../../frontend/src/pages/SetupPage.tsx#L112), [`SetupPage.tsx:219`](../../../../frontend/src/pages/SetupPage.tsx#L219), [`SetupPage.tsx:234`](../../../../frontend/src/pages/SetupPage.tsx#L234), [`SetupPage.tsx:315`](../../../../frontend/src/pages/SetupPage.tsx#L315), [`usePostureRegistration.ts:5`](../../../../frontend/src/features/camera/usePostureRegistration.ts#L5) |
| 4 | 카메라 위의 작은 상태 표시를 카메라 옆의 큰 제목으로 끌어올린다. 측정 불가에는 점수 대신 대시와 재인식 안내를, 연결 끊김과 기준 미등록에는 재준비로 가는 동작을 표시한다. | [`LiveSessionPage.tsx:116`](../../../../frontend/src/features/session/live/LiveSessionPage.tsx#L116), [`LiveSessionPage.tsx:383`](../../../../frontend/src/features/session/live/LiveSessionPage.tsx#L383), [`LiveSessionPage.tsx:442`](../../../../frontend/src/features/session/live/LiveSessionPage.tsx#L442), [`errors.ts:7`](../../../../frontend/src/features/camera/errors.ts#L7) |
| 5 | 오늘 비율과 24시간 그래프를 나란히 배치하고, 최근 측정은 시작·종료 시각, 유지율, 알림 횟수를 닫힌 상태에서도 보여준다. 390px에서는 요약·그래프·목록 순으로 읽는다. | [`DayRecord.tsx:60`](../../../../frontend/src/features/history/DayRecord.tsx#L60), [`DayRecord.tsx:91`](../../../../frontend/src/features/history/DayRecord.tsx#L91), [`DayRecord.tsx:125`](../../../../frontend/src/features/history/DayRecord.tsx#L125), [`RecordHistoryItem.tsx:33`](../../../../frontend/src/features/history/RecordHistoryItem.tsx#L33) |

## 제안 표시

1. **첫 방문 전용 웰컴**. 로그인·가입 양식에 앞서 서비스 흐름을 소개하는 진입 화면이다. 첫 방문의 판별·재방문 동작은 시안 선정 후 결정한다.
2. **계정 정보 안에서 이메일 인증**. 6자리 코드라는 기존 기능을 계정 정보 안에 배치한다. 인증 기능이 활성화된 경로를 그렸으며 실제 적용 시 기능 플래그, 만료, 재요청, 주소 변경 시 인증 무효화를 유지한다. [계정 계약 60행](../../../../contracts/accounts.md#L60)

시연 화면 전환 바, 고정 계정·이메일 코드, 카메라 상태 조작과 합성 기록은 검토용으로 제공한다. 앱 안의 탐색은 현재 코드의 **측정하기 · 오늘 · 기록(날짜별) · 설정**과 하단 계정 메뉴를 사용한다. 760px 이하에서는 좁은 본문 폭을 확보하기 위해 같은 항목을 본문 위에 가로로 배치한다. 달력·설정·계정은 메뉴의 위치와 진입만 보여주는 간단한 대화상자로 연결했다. [현재 메뉴](../../../../frontend/src/app/navigation.ts#L23) · [계정 메뉴](../../../../frontend/src/app/AppSidebar.tsx#L74)

## 실제 적용 범위

| 화면 | 변경 후보 | 난이도 |
| --- | --- | --- |
| 웰컴 | `frontend/src/app/LocalServiceApp.tsx`, 신규 `frontend/src/pages/WelcomePage.tsx`, `frontend/src/styles/login.css` · 첫 방문과 로그인 복귀 경로 정의 | 중 |
| 가입·로그인 | `frontend/src/pages/LoginPage.tsx`, `frontend/src/app/LocalServiceApp.tsx`, `frontend/src/features/auth/ConsentList.tsx`, `frontend/src/features/auth/MailAccessPage.tsx`, `frontend/src/styles/auth.css` · 인증 기능 플래그, 재요청, 주소 변경, 키보드 초점과 오류 복구 검증 | 상 |
| 첫 설정 | `frontend/src/pages/SetupPage.tsx`, `frontend/src/components/PreparationSteps.tsx`, `frontend/src/components/PoseGuide.tsx`, `frontend/src/features/auth/SignupPostureStep.tsx` · 카메라 품질과 등록 상태를 단계에 연결하고 자동 시작·건너뛰기 유지 | 중 |
| 측정 | `frontend/src/features/session/live/LiveSessionPage.tsx`, `frontend/src/styles/session.css` · 서버 판정 상태, 점수, 알림과 카메라 복구의 레이아웃 재배치 | 중 |
| 오늘 기록 | `frontend/src/features/history/DayRecord.tsx`, `frontend/src/features/history/RecordHistoryItem.tsx`, `frontend/src/styles/history.css` · 서버 집계와 한국 시간대를 유지하며 요약·타임라인 재배치 | 중 |
| 공통 탐색·토큰 | `frontend/src/app/AppSidebar.tsx`, `frontend/src/styles/layout.css`, `frontend/src/styles/typography.css`, `frontend/src/styles/responsive.css` · 기존 테마 및 데스크톱·좁은 창 공존 확인 | 중 |

## 시연 방법과 범위

[`index.html`](index.html)을 브라우저로 연다. 로그인 예시는 화면에서 펼칠 수 있고 가입 인증 코드는 `123456`이다. 첫 설정에서는 카메라를 켠 뒤 **얼굴·어깨 인식 시연**을 누르면 등록 준비와 수집이 차례로 진행된다. 측정 화면 하단에서 정상·흐트러짐·측정 불가·연결 중·연결 끊김·기준 미등록을 선택할 수 있다.

카메라·메일·Discord·서버 측정은 합성 동작으로 표현했다. 실제 부스 모니터에서의 가독성, 장치 권한, 이메일·OAuth·API 연동은 별도 검증 대상이다.

## 검증

- Chrome Headless와 Node CDP로 시나리오 10개를 확인했다. 1360×860, 1180×760, 390×844 각각에서 6개 화면 전환과 가로 넘침을 검사했다. 키보드 탭 전환·대화상자 초점 복귀, 인증 오류·로딩, 선택 프로필과 가입 중 자세 등록, 두 번의 3초 진행과 취소, 측정 상태 전환, 기록 상세를 확인했다.
- Node로 인라인 스크립트 구문을 검사하고 Python으로 자산과 문서의 링크, 후행 공백을 확인했다.
- 검증 환경에서는 Pretendard CDN 글꼴이 로드되지 않아 맑은 고딕으로 렌더링한 배치를 확인했다.
