# PoseGood · 따뜻한 첫 시작

## 디자인 방향

- 따뜻한 크림 바탕, 코랄 주요 버튼, 세이지 완료 표시를 사용했다. 기존 살구 테마 일러스트와 로고를 재사용했다.
- 이용 동의 → 이메일 확인 → 계정 만들기 순으로 한 화면에 한 가지 일만 보여 준다. 카메라 준비도 권한, 위치, 등록을 순서대로 안내한다.
- 인증과 등록이 끝나면 짧은 성공 문구와 체크를 표시한다. 측정에서는 부스 모니터에서 읽기 쉬운 제목과 기호를 먼저 보여 준다.

키워드 **크림 · 코랄 · 세이지 · 단계별 안내 · 완료 피드백**

## 디자인 토큰

| 종류 | 값 | 쓰임 |
| --- | --- | --- |
| 바탕·카드 | 크림 `#FBF6EE` · 아이보리 `#FFFCF7` · 입력 `#FFFFFF` | 화면 바탕, 정보 카드, 입력 면 |
| 글자·경계 | 본문 `#302C28` · 보조 `#695F56` · 카드 선 `#E9DED1` · 입력 선 `#B7A99B` | 글자 위계와 입력 경계 |
| 주요 행동 | 코랄 `#A84434` · 호버 `#883426` · 옅은 코랄 `#F8DED0` | 주요 버튼, 현재 단계, 아이콘 배경 |
| 정상·완료 | 세이지 글자 `#386047` · 바탕 `#E2EBDC` · 그래프 `#83A58B` | 기준에 가까움, 완료, 유지 시간 |
| 흐트러짐·입력 오류 | 자두색 글자 `#873E55` · 바탕 `#F7E5EB` | 지속 이탈 알림, 필드 오류 |
| 측정 불가·연결 중·끊김 | 회색 `#EDEAED` · 청회색 `#E4EDF0` · 베이지 `#F0E8DF` | 상태마다 제목과 기호를 함께 표시 |
| 초점 · 카메라 | 초점 `#8B4529` 3px · 카메라 `#242B29` | 키보드 위치 표시, 어두운 4:3 자리표시 |
| 글자 | Pretendard 400/650/750 · 본문 16px · 도움말 14px · 인증 제목 29~42px · 측정 상태 25~43px | 일반 안내, 양식, 부스 화면의 상태 |
| 모서리 | 입력·버튼 12px · 카드 22px · 큰 화면 34px · 상태 칩 999px | shadcn/ui 위계에 따뜻한 형태 적용 |
| 간격·크기 | 필드 6px · 제어 간 12~16px · 카드 안 16~24px · 주요 제어 최소 46px | 입력 밀도, 터치·키보드 이동 |
| 모션 | 전환 160ms · 체크 380ms · 카운트 표시 320ms | 시스템의 움직임 줄이기 설정을 존중 |

## 현재 앱 대비 UX 개선

| 개선 | 현재 코드와 시안의 차이 |
| --- | --- |
| 1. 시작할 일을 찾기 쉽다 | 지금 앱은 서비스 진입 시 로그인 커버를 보여 준다. 시안은 첫 화면에서 서비스 소개와 3단계 사용법을 보여 주고, 신규 방문자와 기존 사용자의 행동을 나란히 둔다. [ServiceApp.tsx:20](../../../../frontend/src/app/ServiceApp.tsx#L20) · [LocalServiceApp.tsx:709](../../../../frontend/src/app/LocalServiceApp.tsx#L709) · [LoginPage.tsx:28](../../../../frontend/src/pages/LoginPage.tsx#L28) |
| 2. 가입 중 현재 위치와 남은 일이 보인다 | 기존 약관과 프로필 흐름에서 이메일 인증은 계정 정보 폼의 별도 버튼 또는 가입 요청 중 분기로 열린다. 시안은 동의 완료 수와 세 구간 진행 표시를 두고 이메일 요청·코드·확인을 두 번째 구간에 배치한다. 필수 5개와 선택 1개, 선택 동의에 따라 나타나는 나이·직업은 기존 규칙을 반영했다. [LocalServiceApp.tsx:402](../../../../frontend/src/app/LocalServiceApp.tsx#L402) · [LocalServiceApp.tsx:626](../../../../frontend/src/app/LocalServiceApp.tsx#L626) · [LocalServiceApp.tsx:665](../../../../frontend/src/app/LocalServiceApp.tsx#L665) · [consents.ts:103](../../../../frontend/src/features/auth/consents.ts#L103) · [ProfileFields.tsx:41](../../../../frontend/src/features/profile/ProfileFields.tsx#L41) |
| 3. 오류가 난 곳에서 바로 다시 시도할 수 있다 | 기존 인라인 검증과 요청 중 비활성화를 살리고, 가입의 바이트 제한·코드 오류를 해당 입력 아래에 둔다. 로그인 실패는 제출 버튼 앞에 띄우고 비밀번호로 초점을 돌려준다. Discord를 이름이 보이는 별도 버튼으로 올리고 비밀번호 찾기를 입력 가까이에 배치했다. [InlineForm.tsx:21](../../../../frontend/src/components/InlineForm.tsx#L21) · [LocalServiceApp.tsx:346](../../../../frontend/src/app/LocalServiceApp.tsx#L346) · [LocalServiceApp.tsx:718](../../../../frontend/src/app/LocalServiceApp.tsx#L718) · [MailAccessPage.tsx:76](../../../../frontend/src/features/auth/MailAccessPage.tsx#L76) · [SocialLoginButtons.tsx:25](../../../../frontend/src/features/auth/SocialLoginButtons.tsx#L25) |
| 4. 카메라 준비와 등록 완료를 따라가기 쉽다 | 기존 준비 단계와 4:3 가이드를 살리고, 진행 카드의 제목·버튼은 현재 작업 한 가지에 집중시킨다. 카메라 거부와 끊김에 서로 다른 설명을 준다. 등록 시작 전 3초, 자세 기억 3초, 저장, 완료 체크를 차례로 보여 준다. [SetupPage.tsx:200](../../../../frontend/src/pages/SetupPage.tsx#L200) · [SetupPage.tsx:315](../../../../frontend/src/pages/SetupPage.tsx#L315) · [PoseGuide.tsx:11](../../../../frontend/src/components/PoseGuide.tsx#L11) · [errors.ts:7](../../../../frontend/src/features/camera/errors.ts#L7) · [usePostureRegistration.ts:5](../../../../frontend/src/features/camera/usePostureRegistration.ts#L5) · [landmarkCapture.ts:24](../../../../frontend/src/features/baseline/landmarkCapture.ts#L24) |
| 5. 측정 상태와 오늘 기록을 빠르게 읽을 수 있다 | 현재 앱의 상태·점수·알림을 큰 상태 제목과 기호 아래에 재배치했다. 측정 불가는 회색과 빈 점수로 구분한다. 오늘 기록은 비율·시간·알림을 먼저 보여 주고, 시간대와 최근 세션을 이어서 읽게 한다. [LiveSessionPage.tsx:116](../../../../frontend/src/features/session/live/LiveSessionPage.tsx#L116) · [LiveSessionPage.tsx:442](../../../../frontend/src/features/session/live/LiveSessionPage.tsx#L442) · [DayRecord.tsx:61](../../../../frontend/src/features/history/DayRecord.tsx#L61) · [DayRecord.tsx:124](../../../../frontend/src/features/history/DayRecord.tsx#L124) · [ComboChart.tsx:106](../../../../frontend/src/components/ComboChart.tsx#L106) |

## 화면에 표시한 제안

| 표시 | 제안 내용 |
| --- | --- |
| 첫 방문 화면 | 서비스 진입에 웰컴을 추가하고 가입과 로그인을 분기한다. |
| 독립 단계 | 이메일 인증을 활성화한 가입에서는 코드 확인을 독립 단계로 배치한다. 이메일 변경 시 기존 확인을 무효화한다. |
| 완료 확인 | 가입 성공과 선택 사항인 기준 자세 등록을 나눠 보여 준다. |
| 표시 전환 | 로그인 필드에 비밀번호 보기·숨기기 토글을 넣는다. |
| 단계별 안내 | 권한 → 위치 → 등록을 진행 카드 하나에서 보여 주고 등록·저장 완료를 체크로 알려 준다. |
| 복구 동선 | 연결 끊김으로 종료된 세션의 측정 화면에서 인터넷 확인 뒤 측정 준비로 돌아가게 한다. 현재 전역 연결 끊김 대화상자의 종료 정책과 함께 검토할 항목이다. [ConnectionLostDialog.tsx:50](../../../../frontend/src/features/connection/ConnectionLostDialog.tsx#L50) |
| 시간대 막대 | 오늘의 세션 시간 띠를 3시간 구간별 누적 막대로 바꾼다. 현재 시안은 구간 경계를 넘지 않는 합성 데이터로 구성했다. 실제 적용 전에 자정을 포함한 구간 경계와 유효 시간 배분 기준을 정한다. |

## 실제 프론트 적용 범위

| 난이도 | 대상 | 작업 |
| --- | --- | --- |
| 상 | `frontend/src/app/ServiceApp.tsx`, `frontend/src/app/LocalServiceApp.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/features/auth/MailAccessPage.tsx`, `frontend/src/features/auth/ConsentList.tsx`, `frontend/src/features/auth/SignupPostureStep.tsx` | 웰컴 진입과 가입 진행을 연결한다. 메일 옵션이 꺼진 서버, Discord 확인 이메일·기존 계정 연결, 재설정 링크 진입을 기존 인증 경로와 함께 검증한다. |
| 중 | `frontend/src/components/InlineForm.tsx`, `frontend/src/features/auth/SocialLoginButtons.tsx`, `frontend/src/styles/login.css`, `frontend/src/styles/auth.css` | 입력 상태, 오류 초점, 비밀번호 표시, 진행 표시에 기존 계정 양식과 접근성 규칙을 적용한다. |
| 중 | `frontend/src/pages/SetupPage.tsx`, `frontend/src/components/PreparationSteps.tsx`, `frontend/src/components/PoseGuide.tsx`, `frontend/src/features/camera/usePostureRegistration.ts`, `frontend/src/features/session/live/LiveSessionPage.tsx`, `frontend/src/features/connection/ConnectionLostDialog.tsx` | 단계별 카드와 완료 피드백, 연결 상태와 지표를 적용한다. 실제 카메라 자동 진행과 세션 종료·저장 정책을 검증한다. |
| 상 | `frontend/src/features/history/DayRecord.tsx`, `frontend/src/features/history/RecordHistoryItem.tsx`, `frontend/src/components/ComboChart.tsx` | 시간대별 집계의 입력과 기준을 먼저 합의하고, 차트의 키보드·상세 표시를 구현한다. |
| 하 | `frontend/src/app/AppSidebar.tsx`, `frontend/src/styles/components.css`, `frontend/src/styles/appearance.css`, `frontend/src/styles/responsive.css` | 테마와 사이드바 간격을 맞춘다. 데스크톱은 현재 코드의 **측정하기 · 오늘 · 기록 · 설정**과 아래 계정 메뉴를 유지했다. 390px에서는 읽을 너비를 확보하도록 탐색을 본문 위로 이동했다. [navigation.ts:24](../../../../frontend/src/app/navigation.ts#L24) |

## 시연 범위

- 파일을 Chrome에서 직접 열 수 있다. 상단 여섯 탭과 화면 안의 버튼으로 이동하고, 탭 바에서는 좌우 방향키와 Home/End를 사용할 수 있다.
- 이메일, Discord, 계정, 카메라, 서버는 시뮬레이션이다. 시연 데이터는 탭 메모리에서만 쓰고, 페이지를 새로 열면 초기화된다. 가입·로그인에는 가상 값을 사용한다. 이메일 코드는 `123456`, 재설정 예시 코드는 `posegood-reset`이다.
- 상태 전환 컨트롤은 시연 전용이다. 사이드바의 과거 기록 달력·설정·프로필은 위치만 보여 준다. 오늘 기록은 KST 기준 합성 세션 3개로 구성했다.

## 검증

- Chrome에서 HTML을 직접 열어 1360×860, 1180×760, 390×844의 여섯 화면과 390px의 인증·로그인 오류 상태에 가로 넘침이 없는지 확인했다.
- Chrome 자동 확인 66개를 통과했다. 입력 오류, 키보드 탭·대화상자, 인증·재설정·Discord 시연, 권한 거부·연결 끊김·3초 등록, 측정 상태·기록 상세, Pretendard 로드와 로컬 자산을 확인했다.
- 실제 부스 모니터와 보조 기술, 메일 발송, Discord OAuth, 실카메라 권한, 실시간 서버·기록 연동은 미검증이다.
