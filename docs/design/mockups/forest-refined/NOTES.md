# PoseGood Forest Refined

## 디자인 방향

- 기존 Forest 초록 탐색 영역, 흰 카드, PoseGood 마크를 유지했다. 시작과 인증에는 앉은 모습, 준비에는 카메라와 기준 자세, 빈 기록에는 기존 기록 일러스트를 배치했다.
- 화면마다 제목, 현재 상태, 다음 행동 순으로 읽히게 정리했다. 인증은 같은 자리에서 끝내고, 첫 설정은 카메라 연결부터 자세 등록까지 세 단계로 보여준다.
- 측정 상태는 카메라 위의 큰 문구와 아이콘으로 전달한다. 기록에서는 비율과 시간대, 개별 측정이 한 화면에 이어진다.

키워드 **Forest · 단계별 안내 · 부스 가독성**

## 디자인 토큰

| 분류 | 적용값 | 역할 |
| --- | --- | --- |
| 브랜드 | `#416b56`, `#315340` | Forest 사이드바·인증 소개, 선택 메뉴 |
| 밝은 면 | `#f6f7f9`, `#ffffff`, `#f1f3f5`, `#dce2e7` | 페이지, 카드, 보조 면, 경계 |
| 텍스트 | `#202b33`, `#566670` | 제목·본문, 보조 설명 |
| 행동·유지 | `#18794e` / `#11633e`, `#238653` / `#e8f5ee` | 주요 버튼과 hover, 유지·정상 표시 |
| 흐트러짐 | `#8e3540` / `#f9e7e7`, `#e5484d` | 알림 문구·배경, 기록 그래프 |
| 측정 불가 | `#48555f` / `#edf0f3`, `#242e33` | 중립 상태 문구·배경, 가시성 부족 카메라 면 |
| 타이포그래피 | Pretendard · 400 / 650 / 700, 본문 15px, 입력 16px | 제목·입력·숫자 위계를 공통으로 적용 |
| 주요 크기 | 웰컴 제목 최대 57px, 화면 제목 27–38px, 측정 상태 22–33px | 첫인상, 화면 식별, 부스 상태 가독성 |
| 모서리 | 버튼·입력 11px, 카드·대화상자 18px, 카메라 20px | 버튼·입력·카드의 shadcn/ui 패턴에 Forest 형상 적용 |
| 간격 | 카드 24px, 본문 좌우 28px, 필드 사이 14px, 조작 높이 44px | 화면 간 밀도 통일, 키보드 초점과 모바일 터치 공간 확보 |
| 배치 | 사이드바 192px, 보조 열 280px, 카메라 4:3 | 데스크톱 기본 구조와 카메라 비율 유지 |

## 현재 앱 대비 핵심 UX 개선

| 개선 | 시안의 처리 | 현재 코드 근거 |
| --- | --- | --- |
| 1. 첫 방문에서 시작 경로가 보임 | 시작과 로그인을 분리하고 카메라 → 기준 자세 → 측정·기록 순서를 첫 화면에 안내한다. | `frontend/src/app/LocalServiceApp.tsx:88` 기본 로그인 진입, `frontend/src/pages/LoginPage.tsx:25` 인증 화면 안의 소개 |
| 2. 현재 가입 단계와 인증 결과가 입력 옆에 남음 | 약관·계정·자세 등록의 진행 단계를 고정 표시한다. 이메일 옆 인증 버튼으로 6자리 코드를 확인하고, 선택 동의에 따라 나이·직업을 보여준다. | `frontend/src/app/LocalServiceApp.tsx:626` 약관 동의, `frontend/src/app/LocalServiceApp.tsx:672` 이메일 인증 진입, `frontend/src/features/auth/MailAccessPage.tsx:76` 메일 화면, `frontend/src/features/profile/ProfileFields.tsx:34` 선택 필드 |
| 3. 인증 입력 오류와 계정 오류에서 다음 행동을 찾기 쉬움 | 형식 오류는 필드 아래에 표시하고 제출 시 첫 오류로 초점을 이동한다. 로그인 실패는 비밀번호 아래에 표시하고 처리 중에는 중복 제출을 막는다. 비밀번호 찾기는 비밀번호 라벨 옆, Discord는 별도 버튼에 둔다. | `frontend/src/components/InlineForm.tsx:21` 입력 오류 처리, `frontend/src/app/LocalServiceApp.tsx:346` 서버 로그인, `frontend/src/app/LocalServiceApp.tsx:723` 로그인 보조 행동과 하단 오류 |
| 4. 카메라와 측정 상태에 다음 행동이 바로 붙음 | 첫 설정에서 권한·구도·등록을 안내하고 준비 3초와 기록 3초를 나눠 보여준다. 측정 중에는 영상 위 고정 위치에 큰 상태 문구, 아이콘, 다음 행동을 모았다. 기준 미등록, 권한 거부, 서버 연결 끊김, 측정 불가를 각각 설명한다. | `frontend/src/pages/SetupPage.tsx:315` 준비 단계, `frontend/src/features/camera/usePostureRegistration.ts:17` 구도 확인 후 자동 등록, `frontend/src/features/camera/errors.ts:9` 권한 오류, `frontend/src/features/session/live/LiveSessionPage.tsx:383` 영상 오버레이 상태 |
| 5. 오늘 요약과 개별 측정을 한눈에 훑을 수 있음 | 유지율 링과 시간대 그래프를 나란히 두고 시간·알림·측정 수를 숫자로 정렬한다. 시간대 그래프에 기존 75% 기준 범례를 넣고 최근 측정은 목록에서 펼친다. | `frontend/src/features/history/DayRecord.tsx:63` 요약 링, `frontend/src/features/history/DayRecord.tsx:91` 시간대와 목록, `frontend/src/features/history/DayRecord.tsx:125` KST 타임라인, `frontend/src/components/RateRing.tsx:4` 색 표시 기준 |

## 제안과 시안 범위

- **제안 · 로그인 전 웰컴 화면.** 현행 인증 소개의 문구와 자산을 사용해 시작하기와 로그인으로 연결한다. 웰컴 탭에서 화면 전환 바에 `제안`을 표시했다.
- 사이트 진입 전환 및 상태 버튼, 권한 대화상자, 코드 `246810`, 예시 계정 `demo@example.com` / `PoseGoodDemo26`, 고정 KST 날짜는 발표용이다. 이메일 인증은 서버 옵션이 활성화된 상황을 가정한다. 비밀번호 찾기는 메일 요청까지, Discord는 설정 안내까지 체험할 수 있다.
- 좌측 탐색은 현재 코드의 **측정하기 · 오늘 · 기록 · 설정**과 하단 계정 메뉴를 유지했다. 390px에서는 브랜드·계정 아래의 가로 탐색으로 접어 본문 너비를 확보했다. 기간별 기록·설정·프로필은 여섯 화면 밖이라 시안에서 비활성으로 표시한다. `frontend/src/app/navigation.ts:24`, `frontend/src/app/AppSidebar.tsx:28`
- 첫 설정에서 얼굴·어깨 확인, 카운트다운, 저장은 합성 타이머로 재현한다. 시안에서 권한을 허용해도 장치를 켜지 않는다. 측정 종료 후 오늘 기록에는 미리 준비한 예시 기록이 표시된다.

## 실제 프론트 적용 범위

| 변경 후보 | 바뀌는 내용 | 난이도 |
| --- | --- | --- |
| `frontend/src/app/LocalServiceApp.tsx`, `frontend/src/pages/LoginPage.tsx`, 신규 웰컴 화면 | 비로그인 첫 방문·재방문 진입 규칙, 가입·로그인 연결, 테마 자산 재사용 | 중 |
| `frontend/src/features/auth/ConsentList.tsx`, `frontend/src/features/auth/MailAccessPage.tsx`, `frontend/src/features/auth/SignupPostureStep.tsx`, `frontend/src/components/InlineForm.tsx`, `frontend/src/app/LocalServiceApp.tsx` | 단계 표시와 모달 인증 배치, 모달 초점 복원과 오류 연결, 서버 기능 플래그별 흐름 | 상 |
| `frontend/src/pages/SetupPage.tsx`, `frontend/src/components/PreparationSteps.tsx`, `frontend/src/components/PoseGuide.tsx` | 준비 화면의 상태·행동 배치, 기존 권한·등록 타이머와 취소 연결 | 중 |
| `frontend/src/features/session/live/LiveSessionPage.tsx`, `frontend/src/styles/session.css` | 상태 배너·조작 배치, 연결·일시 중지·측정 불가의 표시 우선순위, 서버 요약의 유지 시간 표시 | 중 |
| `frontend/src/features/history/DayRecord.tsx`, `frontend/src/features/history/RecordHistoryItem.tsx`, `frontend/src/styles/records.css` | 요약과 시간대 배치, 범례, 펼침형 최근 측정 목록 | 하 |
| `frontend/src/styles/forest.css`, `frontend/src/styles/responsive.css`, `frontend/src/styles/login.css`, `frontend/src/app/AppSidebar.tsx` | 초점·면·여백 토큰, 좁은 창 탐색과 카드 배치 | 중 |

## 확인 범위

- 로컬 `index.html` 파일을 열어 체험한다. 헤드리스 Chrome과 CDP로 1360×860, 1180×760, 390×844의 여섯 화면 배치 18건과 단계 전환·예외 상태·키보드 동작 등 11건을 확인했다.
- 실제 메일 발송·Discord OAuth·계정 생성·카메라 권한·서버 판정·기록 저장, 실제 부스 모니터의 시청 거리와 보조기기 낭독은 이번 시안 검증 범위 밖이다.
