# FE 기능 명세

> 작성자: klaod-tech(FE) · 작성: 2026-11-09 · 기준: develop `ea027c2` · 상태: 초안(기능 표 전체, 상세는 회원가입만)
> **이 문서의 역할:** 앱에 어떤 기능이 있고 지금 어디까지 구현됐는지 한곳에서 본다. API별 요청·응답과 앱이 언제 무엇을 보내고 받는지는 [연동 명세](api-ws-spec.md), 필드 규칙의 기준은 [BE API 명세](api-spec.md), 남은 일과 요청은 [FE 제안서](fe-server-proposal.md) 1장이 기준이다.
> **범위:** 웹과 데스크톱(Electron) 앱. 휴대폰 앱은 이 명세를 끝낸 뒤 구현하므로 여기 넣지 않는다. `/dev`는 학습 데이터 수집용 개발 도구라 서비스 기능에서 뺀다([개발자 화면 안내](../../frontend/src/features/developer/README.md)).

## 1. 읽는 법

- **시작·종료 상태:** 기능을 시작할 수 있는 상태와 끝난 뒤의 상태다.

| 상태 | 뜻 |
|---|---|
| `UNAUTHENTICATED` | 로그인하지 않음 |
| `AUTHENTICATED` | 로그인함, 측정 중이 아님 |
| `MEASURING` | 측정 중(좌표를 서버로 보내고 있음) |
| `PAUSED` | 측정 중 쉬기 또는 자리 비움 |

- **구현 상태:** `구현됨`, `일부`(앱이나 서버 한쪽 또는 일부만 있음), `구현 전`
- **API:** 번호는 [연동 명세](api-ws-spec.md) 3장 표와 같고, 상세는 7장이다. `WS`는 `/v2/realtime`이다.
- **우선순위:** 작성자 제안 값이며, 팀 확인 전이다.

## 2. 기능 표

| 도메인 | 기능 | 우선순위 | 시작 상태 | 종료 상태 | 기능 설명 | API | 구현 상태 |
|---|---|---|---|---|---|---|---|
| auth | 회원가입 | 상 | `UNAUTHENTICATED` | `AUTHENTICATED` | 약관 동의, 계정 정보 입력으로 계정을 만들고 바로 로그인한다. 자세 등록은 선택이다 | A2 | 구현됨 |
| auth | 로그인 | 상 | `UNAUTHENTICATED` | `AUTHENTICATED` | 이메일과 비밀번호로 로그인한다 | A3 | 구현됨 |
| auth | 로그인 유지 | 상 | `AUTHENTICATED` | `AUTHENTICATED` | access 토큰을 만료 전에 자동으로 갱신하고, 앱을 다시 열어도 로그인을 유지한다 | A8, A4 | 일부(설치용 데스크톱 앱은 유지 안 됨) |
| auth | 로그아웃 | 하 | `AUTHENTICATED` | `UNAUTHENTICATED` | 로그인을 끝내고 카메라를 끈다 | A5 | 구현됨 |
| auth | 비밀번호 찾기 | 하 | `UNAUTHENTICATED` | `UNAUTHENTICATED` | 메일로 비밀번호를 재설정한다. 화면만 있고 서버 API와 메일 발송이 없다 | 미정 | 구현 전 |
| user | 프로필 수정 | 하 | `AUTHENTICATED` | `AUTHENTICATED` | 이름과, 동의한 경우 나이·직업을 고친다 | W1, W2 | 구현됨 |
| user | 비밀번호 변경 | 중 | `AUTHENTICATED` | `UNAUTHENTICATED` | 비밀번호를 바꾼다. 모든 로그인이 끊겨 로그인 화면으로 간다 | A6 | 구현됨 |
| user | 선택 정보 동의 철회 | 하 | `AUTHENTICATED` | `AUTHENTICATED` | 선택 정보 동의를 켜고 끈다. 철회하면 나이·직업을 비운다. 서버 API는 있고 앱이 부르지 않는다 | C1 | 구현 전 |
| user | 회원탈퇴 | 하 | `AUTHENTICATED` | `UNAUTHENTICATED` | 탈퇴를 접수한다. 되돌릴 수 없고, 서버 자료는 30일 뒤 Spark J3가 지운다. 이 기기의 서버 확인 전 결과 삭제는 아직 없다 | A7 | 일부 |
| setting | 판정 기준 설정 | 중 | `AUTHENTICATED` | `AUTHENTICATED` | 붕괴 기준 점수, 확정·회복 시간, 재알림 주기를 바꾼다. 바꾸면 W2로 서버에 저장하고, 로그인 뒤·측정하기와 설정 화면을 열 때 W1으로 받는다. 판정 값은 기기에 남기지 않는다(11/10). 측정 시작 때 이 값을 S1 `policy`로 보낸다 | W1, W2, S1 | 구현됨 |
| setting | 알림 설정 | 중 | `AUTHENTICATED` | `AUTHENTICATED` | 소리는 측정 화면에서 끄고, 데스크톱 알림창은 설정에서 끈다. 설정의 「교정 알림 사용」 스위치는 안내 문구만 띄운다 | 없음 | 일부 |
| baseline | 카메라 준비 | 상 | `AUTHENTICATED` | `AUTHENTICATED` | 권한을 확인하고 카메라를 고른다. 권한 거부와 장치 없음을 안내한다 | 없음 | 구현됨 |
| baseline | 기준 자세 등록 | 상 | `AUTHENTICATED` | `AUTHENTICATED` | 앱이 낸 관절 9개의 3초 평균을 서버에 등록한다 | B1, B2 | 구현됨 |
| measure | 측정 시작 | 상 | `AUTHENTICATED` | `MEASURING` | 세션을 만들고 실시간 연결을 연다 | S1, WS | 구현됨 |
| measure | 쉬기·재개 | 중 | `MEASURING` | `PAUSED` | 측정을 잠시 멈추고 다시 이어 간다. 쉰 시간은 유효 시간에서 뺀다 | WS | 구현됨 |
| measure | 측정 종료 | 상 | `MEASURING` | `AUTHENTICATED` | 측정을 끝내고 서버가 확정한 결과를 보여 준다 | WS, S4 | 구현됨 |
| measure | 실시간 판정 수신 | 상 | `MEASURING` | `MEASURING` | 좌표를 보내고 판정 결과를 같은 연결로 받는다. 서버 안쪽 Kafka 전환(계획 0031) 뒤에도 앱의 연결과 메시지 형식은 그대로다 | WS | 구현됨 |
| measure | 측정 중 상태 표시 | 상 | `MEASURING` | `MEASURING` | 점수, 주의 단계, 붕괴 3초 게이지, 회복 3초 게이지를 서버 값으로 그린다 | WS | 구현됨 |
| measure | 자세 경고 알림 | 상 | `MEASURING` | `MEASURING` | 붕괴가 확정되면 소리와 화면으로 알리고, 데스크톱은 우측 하단 알림창을 띄운다 | WS | 구현됨 |
| measure | 판정 불가 처리 | 상 | `MEASURING` | `MEASURING` | 어깨가 보이지 않는 프레임은 좌표 없이 신호만 보내고 바로 안내한다. 30분 이어지면 서버가 끝낸다 | WS | 구현됨 |
| measure | 자리 비움 처리 | 중 | `MEASURING` | `PAUSED` | 카메라 영상이 1초 넘게 멈추면 측정을 멈추고, 영상이 돌아오면 재개할 수 있다 | WS | 구현됨 |
| measure | 연결 끊김 처리 | 상 | `MEASURING` | `AUTHENTICATED` | 끊기면 그 측정을 끝낸다. 재연결하지 않고, 서버가 마지막 구간까지 저장한다 | WS | 구현됨 |
| measure | 자정 넘김 처리 | 중 | `MEASURING` | `MEASURING` | KST 자정에 서버가 새 세션으로 넘기면 앱이 이어 간다. 운영 서버 설정은 아직 꺼져 있다 | WS | 일부 |
| measure | 쉬기 자동 종료 | 하 | `PAUSED` | `AUTHENTICATED` | 쉬기가 10분 이어지면 측정을 끝낸다. 누가 할지 정해지지 않았다(BE-13) | 미정 | 구현 전 |
| record | 측정 결과 보관 | 상 | `AUTHENTICATED` | `AUTHENTICATED` | 서버 확인 전 결과를 이 기기에 남겼다가, 서버 기록에서 확인되면 지운다 | R1 | 구현됨 |
| record | 기록 조회 | 상 | `AUTHENTICATED` | `AUTHENTICATED` | 서버 기록을 받아 목록과 달력에 보여 준다. 서버의 기록 하나 조회(R1b)는 없다 | R1 | 일부 |
| record | 기간 통계 | 중 | `AUTHENTICATED` | `AUTHENTICATED` | 일별·기간 통계를 보여 준다. 지금은 앱이 기록으로 계산하고, 서버 통계(T1)는 없다 | T1 | 일부 |
| record | 기록 삭제 | 하 | `AUTHENTICATED` | `AUTHENTICATED` | 측정 기록을 지운다. 서버 API는 있고 앱 화면이 없다 | R3 | 구현 전 |
| ui | 화면 구성과 이동 | 상 | `AUTHENTICATED` | `AUTHENTICATED` | 홈, 측정하기, 기록, 달력, 프로필, 설정 화면과 이동 | 없음 | 구현됨 |
| ui | 테마 | 하 | `AUTHENTICATED` | `AUTHENTICATED` | 화면 테마를 고른다 | 없음 | 구현됨 |
| desktop | 작은 카메라 창 | 중 | `MEASURING` | `MEASURING` | 항상 위에 뜨는 작은 창으로 카메라를 보여 준다. 웹에는 없다 | 없음 | 구현됨 |
| desktop | 컴퓨터 시작 시 실행 | 하 | `AUTHENTICATED` | `AUTHENTICATED` | 컴퓨터를 켤 때 앱을 자동으로 실행한다 | 없음 | 구현됨 |

## 3. 기능 상세

### 회원가입

**선행조건**

- 로그인하지 않은 상태다.
- 가입에 필요한 정보가 유효해야 한다.
  - 이메일: 형식에 맞고 254자 이하
  - 비밀번호: 12자 이상, UTF-8 72바이트 이하
  - 이름: 1~30자
  - 나이(선택): 14~120. 선택 정보에 동의한 경우만
  - 직업(선택): 1~80자. 선택 정보에 동의한 경우만

**트리거**

- 로그인 화면에서 회원가입을 시작하고, 계정 정보 단계에서 「다음」을 누른다.

**동작**

1. 약관에 동의한다. 필수 5개(서비스 이용약관, 회원가입 정보, 카메라 관절 좌표, 측정 기록, 만 14세 이상)와 선택 1개(나이·직업)다.
2. 계정 정보를 입력하면 앱이 형식을 검사하고 서버에 가입을 요청한다(A2).
3. 서버는 계정과 동의를 함께 저장하고 기본 판정 기준(3초, 3초, 60초, 0.7)을 연결한다.
4. 가입이 성공하면 바로 로그인 상태가 된다.
5. 자세 등록 단계로 간다. 등록하면 측정하기로, 건너뛰면 홈으로 간다.

**예외 / 제한사항**

| 상황 | 서버 응답 | 앱 안내 |
|---|---|---|
| 이메일·비밀번호·이름 형식이 틀림 | 요청하지 않음 | 항목별 안내 문구 |
| 이미 쓰는 이메일, 또는 탈퇴 후 30일이 지나지 않은 이메일 | 409 `ACCOUNT_EXISTS` | 「가입할 수 없는 이메일이에요. 이미 가입했거나 탈퇴 후 30일이 지나지 않았어요.」 |
| 필수 동의 누락 | 400 `CONSENT_REQUIRED` | 「필수 약관 동의를 다시 확인해 주세요.」 |
| 그 밖의 입력 오류 | 400 | 「입력 값을 확인해 주세요. 비밀번호는 12자 이상, 이름은 30자 이하, 나이는 14~120이에요.」 |
| 서버가 바쁨 | 503 | 「계정 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.」 |

**비고**

- 아이디와 닉네임이 없다. 이메일로 로그인하고, 이름은 중복을 검사하지 않는다.
- 자세 등록을 건너뛰어도 가입은 끝난 상태다. 측정하기에서 등록한 자세가 없으면 그때 등록한다.
- 코드: [LocalServiceApp.tsx](../../frontend/src/app/LocalServiceApp.tsx) `register`, [SignupPostureStep.tsx](../../frontend/src/features/auth/SignupPostureStep.tsx), [consents.ts](../../frontend/src/features/auth/consents.ts). 서버 규칙은 [API 명세 A2](api-spec.md#a2).
