# FE 제안서: 서버 판정 이전과 연동

> 작성자: klaod-tech(FE) · 작성: 2026-10-11
> **대상:** 팀 전원 — 팀장(Jeon-Seho), DB·BE(김유진, GitHub `sunshine-yj`), DevOps(홍규, `ghdrb1246`), ML(지성, `jisung`), 화면(`lellon0403`). FE는 `klaod-tech`다.
> **이 문서의 역할:** 다른 파트에 요청·질문(0장), FE가 해야 할 일(1장), 지금 FE·서버·DB·배포 구조(2장), FE가 정한 앱 동작(3장). 앱이 언제 무엇을 보내고 받는지와 API 상세는 [연동 명세](api-ws-spec.md), 기능별 동작은 [FE 기능 명세](fe-feature-spec.md), 필드 규칙은 [BE API 명세](../api-spec.md), 결정의 근거는 ADR([0021](../../decisions/0021-app-sends-information-server-judges.md)·[0024](../../decisions/0024-session-ends-on-lost-connection.md)·[0027](../../decisions/0027-today-records-from-collected-server-results.md)·[0029](../../decisions/0029-midnight-cut-and-server-time.md))이다.
> **코드 읽는 법:** A·W·B·S·R·T·C + 숫자(예: S1, B2)는 서버 API([연동 명세](api-ws-spec.md) 3장). 요구 N은 다른 파트에 요청(0장), 할 일 N은 FE가 할 일(1장). BE-2·BE-13~BE-27은 남은 BE 요청(0장), F14는 데스크톱 앱이 웹 주소를 여는 것([ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md) 결정 8). D-nn·T-nn은 BE·DevOps 작업 번호, J1·J2·J3은 서버의 Spark 배치다.

## 0. 남은 질문과 요청

기준: develop `ed72615`(kafka #134·계정 #127 병합 뒤), BE 브랜치 `refactor/repo-remove-api-version-paths` `08d4204`(DevOps #135 병합 뒤), 2026-11-19 코드로 확인. FE가 다른 파트에 요청·확인해야 하는 것(0장)과 FE가 할 일(1장)만 남긴다. 끝난 것은 지우고(경위는 git 기록, 옛 판 `b03fd15`), 다른 파트 안의 일(아키텍처 문서, 좌표 보관 결정, 운영 배포 규칙, BE 내부 시험)은 적지 않는다. 항목마다 **한줄요약 · 발단**(어떻게 나온 이야기인가) **· 원인**(왜 문제인가) **· 요구사항/변경사항**(무엇을 어떻게, 어디를) 순서로 적는다.

다른 파트(BE·DevOps·ML·PM)에 요청하거나 함께 정할 것이다. FE 몫이 있으면 요구 안에 적었다. 표와 아래 절은 **「언제」가 급한 것부터** 적고, 번호도 그 순서다(11/17 다시 매김, 절 제목 괄호가 처음 번호). 닫은 요구: 서버 health(옛 1)는 서버가 스스로 챙길 일이라 뺐고, kafka 모드 자정 넘김(옛 2)은 DevOps가 된다고 했고, 열린 채 남는 세션 닫기(옛 8)는 앱이 시작 실패를 오류 화면(500)으로 처리하고 측정 중에는 서버가 계속 저장해 남는 경우가 드물어 요청하지 않기로 했다(11/16). 한 계정 한 측정(옛 13)은 PR #127로 적용돼 닫았다(11/17).

| # | 요구 | 누가 | 지금 상태(11/18) | 언제 |
|---|---|---|---|---|
| 1 | 탈퇴를 비밀번호 없이 확인만으로 받기 (BE-25) | BE·FE | 서버 develop 병합(BE #131, 11/17), 앱 PR(11/17). 운영 배포 남음 | 운영 서버 먼저, 앱은 그 뒤 |
| 2 | Kafka 전환 때 판정 순서 확인 | DevOps·BE | 11/16 시험은 서버가 local 모드여서 확인 못 함 | kafka 모드로 다시 하는 통신 시험 |
| 3 | API 경로에서 버전(`/v2`) 빼기 | DevOps·BE·FE | 운영 서버는 11/18 버전 없는 판으로 바뀜(gateway에 옛 `/api/v2` 임시 별칭, 운영 앱 그대로 동작). 남은 것: 브랜치 develop 병합 → Vercel 배포 → 별칭·Discord 옛 주소 삭제 | 11/19 통신 시험 뒤 병합 순서 합의(FE 할 일 7) |
| 4 | 실시간 `ack` 메시지 빼기 (BE-19) | 팀장·DevOps·FE | 정함, 구현 전. D-57 병합(#134)에는 들어가지 않았다 | 급하지 않음 |
| 5 | `features` 메시지에서 묶음 단계(`items[]`·`frames[]`) 빼기 (BE-20) | FE·BE·DevOps | 1단계(계약 `items` 최대 1·프레임 `valid` 빼기) 끝(11/13) | 나머지는 요구 4와 같은 계약 판에 |
| 6 | 판정기가 세션 정책을 놓치면 사용자 설정으로 판정하기 (BE-24) | DevOps·BE | develop의 kafka 코드(#134)는 서버 기본 정책으로 판정한다(로그만 남김) | kafka 모드를 운영에 켜기 전 |
| 7 | 운영 서버 자정 넘김 켜기 | DevOps | 운영 설정 꺼짐. 앱 처리는 운영에 있다 | 켜도 됨(BE 실제 MySQL 시험 뒤) |
| 8 | 짧은 끊김 봐주기(`hold_ms`) 규칙 정하기 | BE·ML·FE | 정하지 않음 | 정할 것 |
| 9 | 쉬기 자동 종료 (BE-13) | BE | 아직 없다 | 정할 것 |
| 10 | 측정 시간 1분 미만인 세션 거르기 (BE-22) | BE·FE | 구현 전 | 정할 것 |
| 11 | 안 쓰는 API 정리: C1 삭제, W1 응답에서 `records` 빼기 (BE-21) | BE | C1 끝(develop #121), W1 `records` 남음 | 급하지 않음 |
| 12 | T1 일별 통계 API (BE-2) | BE | 구현 전(형식만 확정) | 기록이 많아져 R1 계산이 느려질 때 |
| 13 | 메시지 안 버전 필드(`schema_version`) 빼기 (BE-26) | BE·FE | 주소·파일 이름·저장 키의 버전은 빠졌고(요구 3, 할 일 8) 메시지 필드만 남음 | `/v2` 배포 뒤, 요구 4·5와 같은 계약 판에 |
| 14 | 기존 계정의 자세 알림이 꺼져 있는지 확인·켜기 (D-96, BE-27) | DB·BE | 운영 DB 기본값은 11/17 DevOps가 1로 고침. 남은 것: 값이 0인 옛 계정 켜기. 앱은 늘 「켜짐」으로 보이는데 꺼진 계정은 소리·팝업·토스트가 안 온다 | 통신 시험(11/19) 전 |

**kafka 코드 확인(D-57 `feat/ws-kafka-pipeline`, 11/18 develop 병합 #134):** 요구 4는 반영되지 않았다(`ack` 전송). 요구 5 1단계(계약 `items` 최대 1)는 들어가 있다. 병합으로 develop에 들어온 것은 S4가 받은 마지막 결과로 답하기·종료 뒤 `stalled` 3초(D-57 ⑧, FE 요청 반영), 좌표 구간을 적재 전용 토픽으로 보내 J1이 HDFS에 저장하기(D-92)가 있고, develop을 받아 S4 답하는 순서(local 끝난 결과 → DB → 메모리)도 합쳐졌다. 처리 서비스는 구간마다 관측 → 사건 → 진행 순서로 보낸다(`JudgeRegistry`, 요구 2와 관련). ⑧의 FE 확인(D-87)은 앱 쪽이 이미 처리한다([예외 처리 방안](fe-exception-handling-plan.md) 2.1의 4·5번).

### 요구 1. 탈퇴를 비밀번호 없이 확인만으로 받기 (BE-25) (옛 16)

- **한줄요약:** 탈퇴(A7)를 비밀번호 확인 없이 로그인 상태만으로 받는다. 실수는 앱의 확인 창(「정말 삭제하시겠습니까?」)으로 막는다.
- **발단:** 11/16 운영 확인. 탈퇴 버튼이 동의 체크만으로는 켜지지 않았고(현재 비밀번호 필요), 보다 보니 Discord로 가입한 계정은 탈퇴할 수 없다는 것이 드러났다.
- **원인:**
  - A7 `DELETE /auth/account`는 본문 `{password}`가 필수이고(`AccountContracts.Withdrawal(NotNull String password)`), 비밀번호가 틀리면 400 `INVALID_PASSWORD`다(`AccountService.withdraw` → `requireCurrent`).
  - Discord 가입 계정은 비밀번호가 없다(`!no-password`). 그래서 탈퇴가 **항상 실패**한다. 비밀번호를 만들 재설정 메일도 운영에서 꺼져 있다. 앱 안에서 탈퇴할 길이 없는데, 개인정보 동의를 받는 서비스라 탈퇴 길은 늘 있어야 한다.
- **요구사항/변경사항:**
  1. **BE:** A7이 비밀번호 없이 탈퇴를 받는다.
     - `AuthController.withdraw`: 본문을 `RequestBody(required = false)`로 둬서 없어도 받는다.
     - `AccountService.withdraw`: `requireCurrent` 확인을 뺀다. 계정 닫기·로그인 철회·실시간 연결 닫기(`requireActive` → `accounts.close` → `removeLogins` → `LoginsRemoved`·`AccountClosed`)는 그대로 둔다.
     - **옛 앱 호환:** 한동안 본문에 `password`가 와도 무시하고 받는다. 그래야 서버를 먼저 바꿔도 지금 운영 앱의 탈퇴가 깨지지 않는다.
     - 시험(`MySqlIntegrationTest` 탈퇴), BE 명세 A7, 계약 `accounts.md` A7 줄을 고친다.
  2. **FE:** 프로필 설정의 탈퇴 칸에서 동의 체크박스와 비밀번호 조건을 뺀다. 「서버 계정 탈퇴」 버튼을 누르면 확인 창(`features/dialog/ConfirmDialog.tsx`)을 띄운다. 「정말 삭제하시겠습니까? 탈퇴는 되돌릴 수 없고 30일 뒤 계정과 기록이 삭제돼요.」 → 「탈퇴」 / 「취소」. 확인하면 본문 없이 A7을 보낸다. 비밀번호 변경 칸은 그대로 둔다. 기능 명세 「회원탈퇴」와 연동 명세 A7도 고친다.
  3. **순서:** 서버(1)를 먼저 배포하고 앱(2)을 배포한다. 서버가 두 방식을 다 받으니 그 사이에도 탈퇴가 깨지지 않는다.
- **알고 정한 것:** 비밀번호 확인이 빠지면, 로그인된 채 자리를 비운 기기에서 다른 사람이 확인 창만 눌러 탈퇴시킬 수 있다. 확인 창은 실수만 막는다. 서비스 규모와 Discord 계정의 탈퇴 길을 생각해 받아들인다(11/16 FE 결정).
- **진행(11/17):** FE 2번을 `docs/fe-docs-sync`에서 했다(`ServerAccountPage.tsx`, 시험 `ServerAccountPage.test.tsx`, 기능 명세·연동 명세). Discord 계정 안내 문구에서 「탈퇴에는 비밀번호가 필요」도 뺐다. 앱 수정은 `fix/fe-withdrawal-no-password`로 옮겨 서버보다 늦게 넣었다. 서버 1번은 김유진이 BE #131(`6002aa1`, 11/17 develop 병합)로 했다: A7이 본문을 읽지 않고 비밀번호를 확인하지 않으며, 옛 앱의 `{password}`는 무시하고 204. **남은 것은 운영 배포 순서뿐**이다: 운영 서버를 먼저 올리고 앱(Vercel)을 올린다.
- **함께 풀리는 것:** Discord 가입 계정의 탈퇴. 비밀번호 변경은 여전히 비밀번호가 있는 계정만 된다. Discord 계정이 비밀번호를 만드는 길은 재설정 메일이 켜진 뒤의 일이다.

### 요구 2. Kafka 전환 때 판정 순서 확인 (옛 3)

- **한줄요약:** kafka 모드에서 추론이 한 세션의 결과 순서를 바꾸지 않는지 전환 시험에서 확인한다.
- **발단:** local은 API 한 곳이 차례대로 처리해 순서가 지켜지지만, kafka는 판정이 처리 서비스로 옮겨 간다.
- **원인:** kafka 판정기는 이미 반영한 `sequence`는 버리고, 번호가 건너뛰면 `missing_sequence`로 끊는다([kafka-spec.md](../kafka-spec.md) 3.3, `SessionJudge`). 늦게 온 결과를 기다려 주던 버퍼(#91 `PendingIntervals`)는 #91과 함께 빠졌다. 순서가 바뀌면 판정이 끊긴다.
- **요구사항/변경사항:** 전환 시험(계획 0031)에서 순서를 확인하고, 바뀌면 버퍼를 다시 넣는다. 판정은 결과가 오는 즉시, 시간은 촬영 시각으로 센다(3초 묶음으로 되돌리지 않음).
- **진행(11/17):** 11/16 FE 포함 통신 시험은 서버가 local 모드로 진행돼 kafka 경로를 확인하지 못했다. kafka 모드로 다시 시험한다(시작 전 `POSEGOOD_REALTIME_PIPELINE=kafka`, 끝난 뒤 `features`·`inference`·`episodes`·`stored` 토픽 오프셋이 늘었는지 확인).

### 요구 3. API 경로에서 버전(`/v2`) 빼기 (옛 10)

- **한줄요약:** 모든 주소의 `/v2`를 뺀다(`/api/v2/auth/login` → `/api/auth/login`, 측정 WebSocket `/api/realtime`, 추론 `POST /infer`). **운영 서버는 11/18 바뀌었고(옛 주소는 임시 별칭), develop 병합과 웹 배포가 남았다.**
- **발단:** DevOps 요청. Notion 문서를 고치면서 경로마다 붙은 `/v2` 때문에 API를 찾기 힘들다는 의견이 나왔다.
- **원인:** `/v2`는 옛 v1 API와 함께 운영하려고 붙인 구분이다. v1이 모두 없어져 지금은 구분하는 것이 없고 경로만 길어진다.
- **진행(11/18):** 김유진이 BE 브랜치 `refactor/repo-remove-api-version-paths`(`eae3317`)에서 서버·추론·nginx·점검 도구·계약·문서와 **앱 코드**(`API_ROOT` = `'/api'`, `API_VERSION` 삭제, 가짜 서버·시험 주소)를 한 번에 고쳤다. PR #125는 병합 없이 닫혔고(11/17), 같은 브랜치에서 이어 develop `ed72615`(#134 kafka 포함)을 받았다. [ADR 0049](../../decisions/0049-no-version-in-names.md)·[계획 0097](../../plans/active/0097-kafka-processing-remove-versions.md)로 Kafka 토픽(`posture.features` 등)·처리 서비스·계약 파일 이름(`realtime-ws.schema.json`, `accounts.md`, 예시 `examples-ws/`)의 버전도 뺐다. FE는 같은 브랜치 위에서 이 문서·ADR의 주소와 브라우저 저장 키 이름(할 일 8)을 정리했다. 메시지 안 버전 필드는 요구 13으로 따로 한다.
- **서버 반영(11/18, D-94):** DevOps가 운영 서버를 버전 없는 판으로 바꿨다(운영 모드는 local 그대로). 운영 앱은 아직 `/api/v2/…`를 부르므로 **gateway에 임시 별칭**을 두었다(`/api/v2/realtime` → `/realtime`, `/api/v2/…` → `/…`, `infra/nginx/gateway.conf`, #135). 옛 Discord 콜백도 별칭으로 이어져 Discord 로그인이 유지된다. 그래서 **서버와 웹을 같은 때 바꿀 필요가 없어졌다.**
  - FE 확인: 로그인 유지 쿠키는 경로가 `/`(`posegood.auth.refresh-cookie-path`)라 주소가 `/api/v2/auth/…` → `/api/auth/…`로 바뀌어도 그대로 실려, 배포 때 다시 로그인할 일이 없다.
- **요구사항/변경사항 — 남은 순서:**
  1. FE: `docs/fe-remove-v2-sync`(이 문서·ADR·저장 키, 할 일 8)를 BE 브랜치로 보낸다. DevOps 별칭(#135)은 11/19 같은 브랜치에 들어갔다.
  2. DB/BE: 브랜치를 develop에 병합 → FE: 포크를 올려 Vercel 배포(할 일 7).
  3. FE 배포 확인 뒤 DevOps: gateway 별칭 삭제, 서버 `.env` `POSEGOOD_DISCORD_REDIRECT_URI`와 Discord Portal Redirect를 `…/api/auth/social/discord/callback`으로 **함께** 바꾼다. 그 전까지 둘 다 옛 주소 그대로.
- **알고 정한 것:** 화면을 앱 안에 가진 옛 데스크톱 설치판은 옛 주소로 요청하므로 배포 뒤 로그인·측정이 안 된다. 받아 주지 않고 새 설치판(웹 주소를 여는 판, F14)을 다시 깔라고 안내한다(11/16 BE 결정).

### 요구 4. 실시간 `ack` 메시지 빼기 (BE-19)

- **한줄요약:** 앱도 서버 운영도 쓰지 않는 `ack`를 빼고, 통합 시험은 `observation` 개수로 확인한다.
- **발단:** 11/11 「`ack`가 정확히 무슨 역할이냐」는 질문을 받고 경위를 확인했다.
- **원인:** `ack`는 원래 재전송 창이었다(10/6 `client.ts`: `ack` 안 된 구간을 재연결 때 다시 보냄). ADR 0024로 재전송을 없앤 뒤(10/21 `client.ts` 삭제) 앱은 받기만 하고 버린다(`case 'ack': return`). 그런데 서버는 지금도 구간마다(초당 약 10개) 보낸다. local은 구간마다 `observation`·`ack`·`progress` 3개라, 보내는 메시지의 약 3분의 1이 버려지는 `ack`다. 지금 `ack`를 쓰는 곳은 DevOps 통합 시험(`ws_realtime_smoke.py`)뿐이고, 서버의 `stalled` 판단은 메시지가 아니라 서버 안의 시각(`ackedAt`)을 쓴다.
- **요구사항/변경사항:** 순서대로 한다. 급하지 않음(D-57 병합 #134에는 들어가지 않았다).
  1. DevOps: 통합 시험의 「구간 ack」 확인을 「보낸 구간 수 = 받은 `observation` 수」로 바꾼다(kafka는 lag 0·DLQ +0 확인 유지).
  2. 팀장(Jeon-Seho): `RealtimeHandler.measure`의 `send(…V2.Ack…)` 두 곳과 `RealtimeMessages.V2.Ack`, 서버 시험을 지운다. **`Channel.ackedAt`은 남긴다**(구간을 넘긴 시각, `checkStalled`가 씀. 이름은 `acceptedAt` 등으로).
  3. FE: 계약 `realtime-ws.schema.json`의 `ack`(설명 「The app only shows it」도 틀림)·`examples-ws/ws-ack.json`, 앱 `messages.ts`·`LiveSession.ts`, 연동 명세를 정리한다.

  앱은 `ack`를 무시하므로 서버가 먼저 바뀌어도 운영 화면에 영향이 없다. 시험 연결에만 `ack`를 켜는 안(`hello` 선택 칸)은 `hello` 형식을 바꿔야 해서 고르지 않았다.

### 요구 5. `features` 메시지에서 묶음 단계(`items[]`·`frames[]`) 빼기 (BE-20)

- **한줄요약:** 항상 1개만 담기는 두 배열 단계를 빼고 메시지를 한 단계로 편다.
- **발단:** 11/11 WS 프레임 처리를 보다가 메시지가 6단계로 깊은데 그중 두 단계가 옛 묶음의 껍데기인 것을 확인했다.

  ```
  features
  └ items[]       (계약 1~30개)  ← ① 재전송 창 때 밀린 구간을 함께 보내던 것 → 지금 항상 1개
    └ 구간 {schema_version, feature_version, sequence, start_ms, end_ms, phase}
      └ frames[]  (계약 0~30개)  ← ② 0.5초 구간 안 여러 프레임을 서버가 평균 내던 것 → 지금 1장
        └ 프레임 {t_ms, p, valid?} → p[9] → [x, y, visibility]
  ```
- **원인:** 재전송 삭제(ADR 0024)와 「프레임마다 구간 1개」(10/27)로 묶을 일이 없어졌는데 구조만 남았다.
  - ① 계약은 1~30개인데 서버는 정확히 1개가 아니면 `closed(bad_message)`(`RealtimeHandler.interval()`). **계약과 서버가 다르다.**
  - ② 서버는 1장을 상대로 반복문과 평균을 그대로 돈다(`FrameFeatures.interval`·`average`, `FrameInterval` `Size(max = 30)`).
- **요구사항/변경사항:** 형식은 BE와 정한다. FE 안:

  ```json
  { "type": "features", "sequence": 42, "start_ms": 21000, "end_ms": 21100, "phase": "running",
    "t_ms": 21012, "p": [[0.51234, 0.40211, 0.99], …9개] }
  ```

  프레임 없는 구간(쉬기·자리 비움·빈 구간)은 `t_ms`·`p`를 빼고, 앱이 사람 위치를 판별하지 못한 프레임은 `"p": null`만 보낸다. 지금 함께 붙이는 `valid: false`는 **뺀다**: 서버는 이 칸을 형식만 검사하고 판정에는 `p`가 null인지만 쓴다(`FrameInterval.Frame`, `FrameFeatures.interval`). 사람이 없는 프레임과 위치를 못 잡은 프레임을 서버가 구분하지 않으므로 `p: null` 하나로 같은 뜻이다. 판정 결과의 `valid`는 서버가 돌려주는 `observation.valid`로, 이 칸과 다르다. 판 번호는 `hello`에서 한 번 정한다. 요구 4와 같은 계약 판에, kafka 병합 뒤에 순서대로 한다.
  1. FE(**11/13 함**): 계약 `features.items`를 `maxItems 1`로 서버와 맞추고(`contracts/realtime/realtime-ws.schema.json`), 옛 규칙이던 계약 예시의 「좌표 + `valid: false`」 프레임을 `{ t_ms, p: null }`로 고쳤다(`examples-ws/ws-features.json`, `frames/example-running.json`). 앱도 프레임 `valid: false`를 보내지 않는다(`frames.ts` `push`). **BE·ML 참고:** develop의 `KafkaPipeline`(#134)이 프레임 `valid`를 Kafka 좌표 메시지에 그대로 싣는데, 이제 늘 비어 있다. 좌표 보관·학습에서 「위치를 못 잡음」과 「사람 없음」을 구분해 쓰고 있었다면 알려 달라. 서버는 아직 `valid`를 선택 칸으로 받으므로, 지우는 것은 2·5단계 때 한다.
  2. BE: 서버가 옛·새 형식을 다 받게 하고(`hello` 판 번호로), 특징 계산을 프레임 1장 기준으로 바꾼다.
  3. DevOps: 통합 시험을 새 형식으로.
  4. FE: 앱(`frames.ts` `FrameBatch`, `LiveSession.ts` `send`)을 새 형식으로 배포.
  5. BE: 옛 형식 받기를 지운다.

  kafka `posture.features`과 추론 `POST /infer`는 바뀌지 않는다(서버가 계산한 특징 변화량을 보냄).

### 요구 6. 판정기가 세션 정책을 놓치면 사용자 설정으로 판정하기 (BE-24) (옛 15)

- **한줄요약:** kafka 모드 판정기가 그 세션의 정책(`session_started`)을 받지 못한 채 관측을 받으면, 서버 기본값이 아니라 그 사용자가 정한 판정 기준으로 판정한다.
- **발단:** D-57 통신 시험 준비(11/16)로 kafka 판정기 코드를 확인했다. 시험 F2(설정에서 확정 5초·재알림 30초로 바꾸고 측정)가 바로 이 경우에 걸린다. [FE 예외 처리 방안](fe-exception-handling-plan.md) 6장 2번으로 적어 두었던 것을 요구로 올린다.
- **원인:** 처리 서비스의 `JudgeRegistry`(11/16 `feat/ws-kafka-pipeline` `1067dab`에서 확인, 11/18 develop #134에서도 같음):
  - 관측(`observation`)이 `session_started`보다 먼저 오면 「session_started 없이 관측을 받음 — 기본 정책으로 판정」(info 로그만)으로 **서버 기본 정책**(확정 3초·재알림 60초·기준 0.7)의 판정기를 만든다.
  - 그 뒤에 `session_started`가 와도 「이미 관측을 받은 세션」이라 **무시**한다. 그 세션은 끝까지 기본 정책으로 판정된다.
  - Redis에서 판정 상태를 복원하지 못하면(「복원할 수 없어 버림」) 다음 관측부터 같은 일이 생긴다.
  - 사용자는 설정(W1·W2)에서 정한 확정·재알림 시간과 다르게 알림을 받는다. 앱은 서버가 판정한 대로 보여 주므로(ADR 0021) 앱에서는 알 수도 고칠 수도 없다. local 모드는 S1의 `policy`로 판정해 이 문제가 없다.
- **요구사항/변경사항:** kafka 모드를 운영에 켜기 전에 DevOps·BE가 정한다. FE 안:
  1. 판정기를 정책 없이 만들어야 할 때(시작 메시지 없음, 상태 복원 실패) 기본값 대신 DB에서 그 세션의 정책을 읽는다(`monitor_session.threshold_policy_id` → `threshold_policy`, S1 때 서버가 저장한 값).
  2. 그래도 못 읽으면 기본 정책으로 판정하되 warn 로그와 횟수를 남겨, 운영에서 얼마나 생기는지 보이게 한다.
  3. kafka 모드 통신 시험 F2에서 확정·재알림이 설정값대로 나오는지 확인한다(정상 경로). 시작 메시지를 놓친 경우는 서버 시험으로 확인한다.
  - **앱 일은 없다.**

### 요구 7. 운영 서버 자정 넘김 켜기

- **한줄요약:** 운영 서버에서 `POSEGOOD_MIDNIGHT_ROLLOVER=true`로 켠다.
- **발단:** BE가 자정 넘김(`session_rollover`, ADR 0029 B안)을 구현했다(PR #77). 앱 처리도 운영 화면에 있다(PR #88). 설정 기본값만 꺼져 있다.
- **원인:** J2는 00:10에 그때 끝난 어제 세션만 센다. 꺼져 있으면 자정을 넘긴 측정이 어제 통계에도, 앱의 오늘 화면에도 제대로 안 보인다([ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md) 11/02 FE 확인).
- **요구사항/변경사항:** 운영 설정만 바꾼다([application.properties](../../../backend/api/src/main/resources/application.properties)). 켜기 전에 BE가 실제 MySQL에서 자정 넘김(`INSERT … SELECT`)을 시험한다.

### 요구 8. 짧은 끊김 봐주기(`hold_ms`) 규칙 정하기 (옛 6)

- **한줄요약:** good 한 프레임에 3초 세기가 처음부터 다시 시작되는 규칙을 고칠지 서버 규칙으로 정한다.
- **발단:** 결과가 프레임마다 오면서, 점수 30 근처에서 주의 표시가 깜빡이고 확정이 늦어지는 것이 보였다.
- **원인:** 지금 규칙은 bad 사이에 good 한 프레임만 끼어도 `hold_ms`를 바로 0으로 돌린다. 프레임 단위라 경계값에서 오르내림이 그대로 드러난다.
- **요구사항/변경사항:** 3초 판별 시간은 그대로 두고 아래 안 중에서 고른다(계획 0084: 결정 전까지 적용하지 않음). 서버 규칙으로 정해야 `posture`·`hold_ms`·확정이 한 규칙을 따른다. **FE 의견:** 짧은 good 봐주기 + 기준 두 개를 같이 쓰고, 회복(`recovery_ms`)에도 거꾸로 적용한다.

  | 안 | 동작 | 장단점 |
  |---|---|---|
  | 짧은 good 봐주기 | good이 0.5초 미만이면 `hold_ms`를 멈춘 채 둠. 0.5초 넘게 이어지면 그때 0 | 깜빡임에 강함. 확정이 그만큼 늦어질 수 있음 |
  | 기준 두 개(히스테리시스) | bad는 확률 0.7 이상, good으로 돌아가는 건 0.6 미만일 때만 | 경계값 오르내림을 직접 막음. 점수 화면과 판정 기준이 달라 보일 수 있음 |
  | 3초 중 비율 | 최근 3초 중 bad가 80% 이상이면 확정 | 직관적. 최근 3초 프레임을 들고 있어야 함 |
  | 판정 불가는 멈춤 | 판정 불가는 `hold_ms`를 멈춤, 길게(예: 1초) 이어지면 끊음 | ADR 0021 판정 불가 규칙과 같이 정해야 함 |

### 요구 9. 쉬기 자동 종료 (BE-13)

- **한줄요약:** 쉬기가 30분 이어지면 서버가 측정을 끝내고 저장한다.
- **발단:** 10/20 계획은 「일시정지가 10분 이어지면 끝내고 저장」인데 서버·앱 모두 구현이 없다.
- **원인:** 쉬기를 누르고 자리를 떠나면 측정이 끝없이 열려 있다. 앱은 시간을 세지 않는다([ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)). 서버에는 판정 불가·자리 비움 30분(`unmeasurable_timeout`)만 있다.
- **요구사항/변경사항:** **FE 의견:** `unmeasurable_timeout`과 같은 방식으로 서버가 쉬기(`rest`) 시간을 세어 30분이면 끝내고 새 사유(안: `closed(rest_timeout)`)를 보낸다. local 엔진과 kafka 결과 구독(`KafkaResults`의 측정불가 세기) 모두. 앱은 새 사유 문구만 더한다(`LiveSession.ts` `CLOSED`).

### 요구 10. 측정 시간 1분 미만인 세션 거르기 (BE-22) (옛 12)

- **한줄요약:** 실제 측정 시간(`valid_ms`)이 1분이 안 되는 세션은 서버가 기록·통계에서 거른다. 기준과 거르는 방법은 BE가 정한다.
- **발단:** 11/12 「판정 불가가 30분 이어지면 서버가 끝낸다」(`unmeasurable_timeout`)를 코드로 확인하다 나왔다. 카메라를 잘못 둔 채 측정을 켜 두면 판정을 한 번도 못 한 세션이 그대로 저장된다.
- **원인:**
  - 서버는 S1 때 세션 행을 만들고 측정 중에도 사건·제외 구간을 쓴다. 판정 불가(`valid: false`)·쉬기·자리 비움 시간은 제외 시간(`UNMEASURABLE`·`PAUSE`·`ABSENCE`)이라 바른 자세 비율에는 들어가지 않지만, 세션 자체는 끝난 기록으로 남는다.
  - 그래서 측정 시간이 0이거나 몇 초뿐인 세션이 기록 목록·달력에 「측정 0분」으로 보이고 그날 측정 횟수만 늘린다. 실수로 켰다 끈 측정도 같다.
  - 측정 시간이 1분 이상이면 판정 못 한 시간이 섞여 있어도 남긴다. 통계는 측정 시간만으로 계산하고(하루 비율 = 바른 자세 시간 합 ÷ 측정 시간 합), 판정 불가 구간은 이어지던 자세를 끊어 사건·유지 시간을 부풀리지 않는다.
- **요구사항/변경사항:**
  1. BE: 끝난 세션의 측정 시간이 1분 미만이면 R1 기록, S4의 DB 값, J2 `daily_stat`(T1)에서 뺀다. 지울지, 표시만 해 둘지(예: 종료 사유·상태), 기준을 1분으로 할지는 BE가 정한다. local 엔진과 kafka 처리 서비스 모두 같은 규칙.
  2. BE: 앱이 그 세션이 걸러졌다는 것을 알 수 있게 한다. 앱은 서버 확인 없이 끝난 측정을 R1에서 찾고 없으면 S4로 묻는데, S4가 걸러진 세션에 404를 주면 앱은 「서버 문제로 지난 측정이 기록에 남지 않았어요」라고 잘못 알린다([FE 예외 처리 방안](fe-exception-handling-plan.md) 0장). 안: `closed`·S4에 걸러졌다는 표시를 주거나, 앱도 같은 기준을 쓴다.
  3. FE: BE가 정한 기준을 앱에도 똑같이 쓴다. 측정 시간이 기준 미만이면 저장 확인을 하지 않고(`useSessionPersistence` `finish`, 지금은 `total_ms`가 0일 때만 거름) 결과 화면에 「1분 미만 측정은 기록에 남지 않아요」를 띄운다.

### 요구 11. 안 쓰는 API 정리: C1 삭제, W1 응답에서 `records` 빼기 (BE-21)

- **한줄요약:** 앱이 부르지 않는 C1(선택 정보 동의·철회)을 지우고, W1이 앱이 버리는 기록 목록을 매번 만들지 않게 `records` 칸을 뺀다.
- **발단:** 11/12 계획 0062(안 쓰는 API 정리)의 남은 항목을 오늘 코드로 다시 확인했다. 0062가 「화면이 있어 연결만 남음」으로 둔 것 가운데 C1만 아직 앱이 부르지 않고, W1의 `records`는 「FE가 W1을 붙이기 전에 함께 정한다」로 미뤄 둔 채 W1이 연결됐다.
- **원인:**
  - **C1:** 서버 주소(`PUT /consents/optional-profile`)는 있는데 부르는 화면이 없고 만들 계획도 없다. 쓰지 않는 경로가 남아 있으면 시험·문서·보안 점검 대상만 늘어난다.
  - **W1 `records`:** 처음에는 설정 화면 하나에 필요한 것을 한 번에 주려고 기록까지 넣었다. 그 뒤 기록 전용 R1(`GET /records`)이 생겨 기록은 R1이 맡는다. 그런데 W1은 지금도 부를 때마다 R1과 같은 함수(`RecordHistory.list`)로 그 사용자의 끝난 세션 전체와 알림·사건·집계 제외 구간 전체를 읽어 요약을 다시 계산한다. 앱은 이 칸을 읽지 않고 버린다. 앱은 W1을 로그인 뒤, 측정하기·설정·프로필 화면을 열 때, 판정 기준을 바꿀 때마다 부르므로 기록이 쌓일수록 쓸모없는 일이 커진다.
- **요구사항/변경사항:**
  1. BE: C1 경로와 처리(`WorkspaceController` `/consents/optional-profile`, 서비스·시험)를 지운다. 가입 때 선택 정보 동의(`OPTIONAL_PROFILE`)와 W1의 `consents.optional_profile`은 그대로 둔다.
  2. BE: `WorkspaceService.get`에서 `result.set("records", …)`를 지우고, BE API 명세 W1 응답·서버 시험을 고친다. API 이름은 「설정 조회」.
  3. FE: 할 일 없음. 앱은 C1을 부르지 않고 W1의 `records`를 읽지 않으며, 칸이 없어도 형식 검사가 통과한다. 서버를 먼저 바꿔도 운영 화면에 영향이 없다. 연동 명세·FE 기능 명세는 11/12에 미리 고쳤다.
  4. H1(`GET /health`)은 남긴다. 앱은 부르지 않지만 컨테이너 healthcheck, gateway, 배포 확인과 평소 상태 확인에 쓴다.
  - 결과: 가입 뒤 선택 정보 동의를 앱에서 철회하는 기능은 없다. 나이·직업은 프로필 수정(W2)에서 비울 수 있다.
- **진행(11/13 확인):** 1번은 11/12 develop #121로 끝났다(김유진, S3·R3도 함께 지움, [계획 0062](../../plans/active/0062-remove-unused-apis.md) 2단계). 2번(W1 `records` 빼기)은 남았다(`WorkspaceService` 67줄).

### 요구 12. T1 일별 통계 API (BE-2) (옛 14)

- **한줄요약:** J2가 채운 `daily_stat`을 돌려주는 T1 API를 기록이 많아져 R1로 계산하기 어려워질 때 만든다.
- **발단:** J2가 매일 00:10에 `daily_stat`을 채우지만, 이를 읽어 주는 API(컨트롤러)가 없다. 형식만 확정됐다.
- **원인:** 지금 앱은 기록·달력·기간 통계를 R1 기록으로 직접 계산한다(`recordsSource.ts`). 기록이 많아지면 매번 계산하기 어렵다.
- **요구사항/변경사항:** BE가 T1 `GET /stats/daily`를 만든다. 00:00~00:10에 어제가 아직 비어 있는 문제는 T1을 붙일 때 정한다([연동 명세](api-ws-spec.md) 「T1 데이터가 생기는 시각」).
- **참고:** 휴대폰 기록 보기는 하지 않기로 했다(11/13, [지운 문서 기록](../../removed-docs.md) 15장). T1은 웹·데스크톱 기록이 많아질 때 쓴다.

### 요구 13. 메시지 안 버전 필드(`schema_version`) 빼기 (BE-26)

- **한줄요약:** 앱과 io-api가 주고받는 메시지에서 `schema_version`을 뺀다. [ADR 0049](../../decisions/0049-no-version-in-names.md) 결정 4의 남은 단계다.
- **발단:** 11/18 `/v2` 경로 삭제(요구 3)를 정리하면서 FE가 앱에 남은 버전 이름을 찾아 저장 키는 바꿨다(할 일 8). 주소·계약 파일 이름·Kafka 토픽은 버전이 빠졌지만, 메시지 안 필드는 남아 있다(ADR 0049 「결과」).
- **원인:** 지금 형식을 하나만 쓰므로 이 값이 구분하는 것은 없다. 그런데 양쪽이 값을 **검사**해서, 한쪽만 빼면 다른 쪽이 메시지를 거절한다.

  | 메시지 | 방향 | 값 | 지금 검사 |
  |---|---|---|---|
  | WS `hello` | 앱 → io-api | `"2.0"` | 서버 `RealtimeHandler.hello`: 2.0이 아니거나 칸이 다르면 거절(`HELLO_MEASURE`) |
  | WS `features` 구간 | 앱 → io-api | `"3.0"` | 서버 `FrameInterval` `@Pattern("3\.0")` |
  | WS `observation` | io-api → 앱 | `"4.0"` | 앱 `messages.ts` 선택 칸, 검사 안 함 |
  | B1·B2 기준 자세 | io-api → 앱 | `"2.0"` | 앱 `baseline/client.ts`: 2.0이 아니면 버림 |
  | S4·R1 `SessionView`·사건 | io-api → 앱 | `"1.0"` | 앱 `session/server/validation.ts`: 칸 목록이 정확히 같아야(`exact`) 하고 1.0이어야 함 |

- **요구사항/변경사항:** ADR 0049 결정 4의 순서(받는 쪽 → 보내는 쪽 → 계약)대로 한다.
  1. **받는 쪽 먼저:** FE는 `baseline/client.ts`·`validation.ts`가 `schema_version`이 있어도 없어도 받게 한다(값 검사 삭제, `exact` 목록에서 선택 칸으로). BE는 `hello`·`features`에서 같은 일을 한다. 둘 다 지금 판과 호환되므로 따로 배포해도 된다.
  2. **보내는 쪽:** 1이 운영에 나간 뒤 FE는 `hello`·구간에서, BE는 `observation`·B1·B2·S4·R1·W1 응답에서 필드를 뺀다.
  3. **계약:** `realtime-ws.schema.json`·`accounts.md`·예시·시험에서 필드를 지우고, 연동 명세 예시를 고친다.
  - io-api 안쪽(추론 `InferenceRequest`·Kafka 메시지)의 `schema_version`은 BE·DevOps가 같은 순서로 정한다. 동의 문서 버전(`service-v2`), DB 버전, 모델·특징 버전, 저장된 파일 형식(개발자 실험 JSON 등)은 ADR 0049의 예외라 그대로 둔다.
  - 요구 4(`ack` 빼기)·5(`features` 묶음 단계)도 실시간 계약을 바꾸므로 한 계약 판에 같이 하면 시험이 한 번으로 끝난다.

### 요구 14. 기존 계정의 자세 알림이 꺼져 있는지 확인·켜기 (D-96, BE-27)

- **한줄요약:** 운영 DB에서 `user_account.sound_alert_enabled`가 0인 계정을 1로 켜고, 기본값이 참(1)인지 확인한다. 앱에는 알림 끄기 화면이 없다.
- **발단:** 11/18 DevOps 공유(D-94 문서 5장, D-96): 「서버 DB 기본값이 0이면 새 계정은 알림 꺼짐으로 시작한다(앱은 늘 켜짐 표시)」. 11/19 통신 시험 전 시험 계정 값을 본다고 했다.
- **원인(11/18 FE 코드 확인):**
  - 앱은 서버의 `preferences.alerts_on`(W1)을 **읽기만 하고 화면에 쓰지 않는다.** 설정 「자세 알림」은 서버 계정에서 늘 「켜짐」 표시(`SettingsPage.tsx`), 측정 화면 `alertsOn`도 늘 참이다(기능 명세 「앱은 이 값을 바꾸지 않는다」).
  - 서버는 S1 때 계정 값을 세션 `alert_enabled`로 복사하고, 거짓이면 WS `alert`를 보내지 않는다(`RealtimeHandler`). 앱의 소리·앱 밖 알림창·토스트는 `alert`로만 울린다(`useLiveSession` `onAlert`). 빨간 테두리·「자세를 살짝 고쳐볼까요?」는 `decision`으로 나와 그대로 보인다.
  - 그래서 값이 0인 계정은 **「켜짐」으로 보이는데 소리·팝업이 안 오는** 상태가 된다.
  - 스키마는 V2.6부터 기본값 참(`schema_V2_8.sql`, 2026-10-27 FE 화면 기본값에 맞춤)이다. 그런데 운영 DB는 migration 016의 기본값 줄이 들어가기 전에 적용돼 기본값이 거짓으로 남아 있었고, 11/17 DevOps가 1로 고쳤다(그 뒤 알림이 울림). 그 전에 만든 계정은 값이 0일 수 있다.
- **요구사항/변경사항:**
  1. DB·BE: 값이 0인 활성 계정을 1로 바꾸고 몇 개였는지 알려 달라. 11/17 운영 DB에서 바꾼 기본값도 migration 기록으로 남긴다.
  2. 앱에 알림 끄기를 다시 넣을 계획은 없다. 넣게 되면 그때 W2 `preferences.alerts_on`으로 저장하고 W1 값을 화면에 보인다(FE).

## 1. 해야 할 일

FE(klaod-tech)가 직접 하는 일이다. 할 일 2(발표용 예시 기록·합성 시연 지우기)는 하지 않기로 해 뺐고, 할 일 6(Discord 로그인 버튼 켜기)은 11/16 Vercel 빌드 변수를 켜 끝났다. 만든 사람의 기능이라 필요 없어지면 그쪽에서 정한다. 번호는 다른 문서가 가리키므로 다시 매기지 않는다.

| # | 할 일 | 언제 |
|---|---|---|
| 1 | 탈퇴한 계정 문의 안내 | 문의처가 정해지면 |
| 3 | 시험 전용 로컬 로그인 지우기 | 급하지 않음 |
| 4 | Cloudflare 요청 제한 좁히기 | 시연 전 |
| 5 | 정식 공개 때 검색 노출 막기 지우기 | 정식 공개 |
| 7 | API 주소 `/v2` 삭제 배포 대응 | BE 브랜치 develop 병합 뒤 |
| 8 | 브라우저 저장 키에서 버전 빼기 | 코드 끝, 할 일 7과 같이 배포(서버와 무관) |

#### 할 일 1. 탈퇴한 계정 문의 안내

- **한줄요약:** 탈퇴한 계정으로 들어오려 하면 문의처를 안내한다. (11/13: 이 기기에 측정 결과를 두지 않게 되어 「탈퇴 때 이 기기 결과 지우기」는 할 일이 없어졌다.)
- **발단:** 서버 탈퇴(A7)는 지금 로그아웃만 한다([ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)). 탈퇴 철회 API는 없다: 옛 계정 API(v1)에 있던 철회(`POST /auth/withdrawal/cancel`)는 BE가 아키텍처 v5.2로 바꾸며 지웠고, 지금은 탈퇴한 계정 로그인이 403 `ACCOUNT_CLOSED`, 같은 이메일 재가입이 30일 동안 409다. 서버의 30일은 최종 삭제(Spark J3)까지의 유예일 뿐 복구 기간이 아니다.
- **원인:** 탈퇴를 되돌리고 싶은 사람은 앱 안에서 할 수 있는 것이 없어 사람에게 연락해야 한다.
- **요구사항/변경사항:**
  1. 탈퇴 확인 창과 로그인 403 `ACCOUNT_CLOSED` 안내(`accountClient.ts`)에 문의처를 넣는다. 예: 「탈퇴한 계정이에요. 되돌릴 수 없고 탈퇴 30일 뒤 삭제돼요. 도움이 필요하면 examplegmail.com으로 연락해 주세요.」 **문의처(이메일)는 정하기 전**이라 지금은 예시 `examplegmail.com`을 쓴다. 오류 화면의 「계속되면 알려 주세요」 문의처([frontend README](../../../frontend/README.md) 「오류 안내 페이지」)와 같은 주소로 한다.

#### 할 일 3. 시험 전용 로컬 로그인 지우기

- **한줄요약:** 옛 화면 시험만 쓰는 「이 기기 로그인」 경로를 지운다.
- **발단:** 로그인은 항상 서버 계정인데, `ServiceApp.test.tsx`만 계정 클라이언트를 「없음」으로 바꿔 이 기기 로그인으로 돈다([계획 0054](../../plans/active/0054-pip-fix-and-server-only-login.md) 2단계).
- **원인:** 시험 때문에 실제 앱에는 없는 로그인 경로(`LocalServiceApp`의 계정 없음 분기, `KEYS.account`)가 코드에 남아 있다.
- **요구사항/변경사항:** `ServiceApp.test.tsx`를 가짜 계정 서버(`frontend/scripts/fake-server.mjs` 방식)로 바꾸고, `LocalServiceApp.tsx`의 이 기기 계정 읽기·쓰기와 `KEYS.account`를 지운다(`useProfileForm.ts`의 지우기 목록 포함).

#### 할 일 4. Cloudflare 요청 제한 좁히기

- **한줄요약:** 로그인·가입에만 요청 제한을 걸고, 평소 값과 시연 날 값을 정한다.
- **발단:** DevOps 질문(9.6.3 Q3).
- **원인:** `/api/v2/auth/*` 제한(같은 IP 10초 20번)에 로그인 유지(A8 refresh)도 걸린다. 학교 공인 IP 하나 뒤에서 여러 명이 쓰면 막힐 수 있다.
- **요구사항/변경사항:** klaod-tech의 Cloudflare 규칙 `auth-rate-limit`만 바꾼다. ① 대상을 `/api/auth/login`·`/api/auth/register`로 좁힘(`/v2` 삭제 배포 전까지는 옛 `/api/v2/auth/…`도 함께, 할 일 7) ② 평소 값을 넉넉하게 ③ 시연 날 값을 따로. 서버·gateway는 할 일 없음.

#### 할 일 5. 정식 공개 때 검색 노출 막기 지우기

- **한줄요약:** 정식 공개 때 검색 차단 두 줄을 지운다.
- **발단:** 실제 연동 전까지 검색 결과에 안 나오게 넣었다(10/20, `72ab5ec`).
- **원인:** 접속이 아니라 검색 노출만 막는 설정이라, 공개하면 지워야 검색에 나온다.
- **요구사항/변경사항:** [robots.txt](../../../frontend/public/robots.txt)의 `Disallow: /`와 [vercel.json](../../../frontend/vercel.json)의 `X-Robots-Tag`를 지우고 포크를 최신화해 배포한다.

#### 할 일 7. API 주소 `/v2` 삭제 배포 대응

- **한줄요약:** BE 브랜치가 develop에 들어가면 포크를 올려 Vercel을 배포하고, 새 주소로 부르는지 확인한 뒤 DevOps에 별칭 삭제를 알린다.
- **발단:** 11/16 BE 공지(develop 병합 안내, 배포 때 바꿀 설정)와 11/18 DevOps 공유(서버 반영·전환 기간 별칭, D-94).
- **원인:** Vercel은 **포크 develop에 push될 때** 배포한다. 운영 서버는 11/18부터 새 주소와 옛 주소(gateway 별칭)를 둘 다 받으므로, 옛 앱·새 앱 어느 쪽이 나가도 끊기지 않는다. 별칭을 지우는 것은 FE 배포를 확인한 뒤다. 앱 코드 수정은 BE 브랜치에 이미 있어 FE가 고칠 코드는 없다(저장 키는 할 일 8).
- **요구사항/변경사항:**
  1. **배포 전(미리):** Cloudflare `auth-rate-limit`에 새 경로를 더한다. 별칭이 남은 동안은 옛 경로도 실제로 쓰이므로 둘 다 둔다. 할 일 4와 같이 하면 대상은 `/api/auth/login`·`/api/auth/register`·`/api/v2/auth/login`·`/api/v2/auth/register` 네 개다.
  2. **BE 브랜치가 develop에 들어가면:** 포크 develop을 push해 Vercel을 배포한다. Vercel 환경 변수는 바꾸지 않는다. 확인(DevOps 요청):
     - 브라우저 개발자 도구 네트워크 탭에서 REST가 `/api/…`(버전 없음), WebSocket이 `/api/realtime`인지
     - 웹 로그인 → 측정 시작·종료 → 기록, Discord 로그인, 로그인을 빠르게 여러 번 눌러 요청 제한
     - 데스크톱 앱(F14)도 같은 확인. 새 설치판 exe는 웹 주소를 열어 Vercel 배포를 따라가므로 `frontend/electron/`을 바꿀 때만 같은 판으로 다시 만든다(`npm run desktop:portable` → `release/PoseGood.exe`).
  3. **확인 뒤:** DevOps에 알려 별칭 삭제·Discord Redirect 변경(요구 3의 3번)을 하게 한다. 그 뒤 Cloudflare 규칙에서 옛 경로 `/api/v2/auth/…`를 빼고, 옛 데스크톱 설치판(화면을 앱 안에 가진 판) 사용자에게 새 설치판을 다시 깔라고 안내한다 — 별칭이 지워지면 옛 판은 로그인·측정이 안 된다.
  4. **문제가 생기면:** 별칭이 남아 있는 동안은 **웹만** Vercel에서 이전 Production 배포로 되돌리면 된다. 별칭을 지운 뒤라면 서버·웹을 둘 다 되돌린다.

#### 할 일 8. 브라우저 저장 키에서 버전 빼기

- **한줄요약:** 브라우저 저장 키 `posegood.v2.*`를 `posegood.*`로 바꾸고, 옛 키에 있던 값은 앱을 켤 때 한 번 옮긴다. **코드는 11/18 함**(`docs/fe-remove-v2-sync`, BE `/v2` 삭제 브랜치 위).
- **발단:** 요구 3을 정리하며 앱에 남은 `v2`를 모두 찾았다. 주소의 `/v2`는 BE 브랜치가 지웠고, 저장 키는 [ADR 0049](../../decisions/0049-no-version-in-names.md) 「결과」가 「옮겨 담는 코드 없이 바꾸지 않는다」고 남겨 둔 일이다.
- **원인:** 이름만 바꾸면 사용자가 이 기기에 둔 값(메인 카메라, 추적 속도, 옛 로컬 자료)을 못 찾는다.
- **바꾼 것:** 기록은 [ADR 0049](../../decisions/0049-no-version-in-names.md) 결과(11/18 FE)와 git에 있다. 옛 키 값은 `storage/renamedKeys.ts` `moveRenamedKeys`가 앱을 켤 때 한 번 옮긴다. **남은 것은 할 일 7과 같이 배포하는 것뿐이다.**
- **남긴 것(바꾸지 않음):** `posegood.appearance.v1`(테마. 데스크톱 시작·연결 실패 화면과 정적 404가 같은 키를 읽어 `electron/`과 함께 바꿔야 함 — 새 데스크톱 설치판을 낼 때 같이 정한다), `posegood.account.v3.{user}.pending-results`(옛 앱이 남긴 키를 **지우는** 코드라 옛 이름 그대로여야 함), 동의 문서 버전 `service-v2`와 개발자 실험 파일 형식(ADR 0049 예외).
- **알고 정한 것:** 배포 직후 옛 판 탭이 열려 있으면 그 탭은 옛 키에 계속 쓴다. 그 뒤 새 판이 켜지면 새 키에 이미 값이 있어, 옛 탭이 쓴 값은 옮기지 않고 지운다. 서버 계정은 판정 기준·기록을 서버(W1·R1)에 두므로 잃는 것은 이 기기 화면 설정 정도다.

### 요구가 끝나면 FE가 할 일

0장 요구는 서버 쪽이 먼저 바뀌어야 하지만, 상당수는 그 뒤에 앱도 고쳐야 끝난다. 요구 본문의 「FE:」 몫을 여기 모은다. 서버가 바뀌었다는 소식이 오면 이 표에서 찾는다.

| 요구 | FE가 할 일 | 언제 |
|---|---|---|
| 1 탈퇴 | 프로필 설정 탈퇴 칸에서 동의 체크박스·비밀번호 조건을 빼고 확인 창(「정말 삭제하시겠습니까?」, `ConfirmDialog`)을 띄운 뒤 본문 없이 A7. 기능 명세 「회원탈퇴」·연동 명세 A7. **코드는 11/17 함, 배포만 남음** | 서버 배포 뒤 바로 |
| 3 `/v2` 빼기 | 할 일 7(앱 코드는 BE 브랜치에 이미 있음) | BE 브랜치 develop 병합 뒤 |
| 4 `ack` 빼기 | 계약 `realtime-ws.schema.json`의 `ack`·`examples-ws/ws-ack.json`, 앱 `messages.ts`·`LiveSession.ts`, 연동 명세 정리 | 서버가 뺀 뒤(앱은 지금도 무시해 급하지 않음) |
| 5 `features` 묶음 단계 | 앱 새 형식(`frames.ts` `FrameBatch`, `LiveSession.ts` `send`) 배포(1단계는 11/13 함) | 계약 판이 정해진 뒤 |
| 7 운영 자정 넘김 | 아래 「지금 하지 않는 것」 두 가지: 자정 점검 시나리오(`midnight.mjs`·README), 앱 날짜 나누기(`dailyMeasurement.ts` `recordsByDay`, 지금은 예시 기록에만 쓰임) 정리 | 운영에서 켠 뒤 |
| 9 쉬기 자동 종료 | 새 종료 사유(안: `closed(rest_timeout)`) 처리와 문구 | 서버 사유가 정해진 뒤 |
| 10 1분 미만 세션 | 같은 기준으로 저장 확인을 하지 않고(`useSessionPersistence` `finish`) 결과 화면에 「1분 미만 측정은 기록에 남지 않아요」 | 기준이 정해진 뒤 |
| 12 T1 일별 통계 | 기간 화면을 어제까지 T1, 오늘은 R1로(같은 날짜를 겹쳐 더하지 않음, [연동 명세](api-ws-spec.md) 4.5) | T1이 생긴 뒤 |
| 13 `schema_version` 빼기 | ① 받기: `baseline/client.ts`·`session/server/validation.ts`가 필드 없이도 받게 ② 보내기: `LiveSession.ts` `hello`·`frames.ts` `FRAME_SCHEMA_VERSION` 삭제 ③ 연동 명세 예시 | ①은 언제든(지금 판과 호환), ②는 서버 ① 배포 뒤 |

앱 일이 없는 요구: 2(판정 순서 확인), 6(판정기 정책), 8(끊김 봐주기 — 앱은 서버 `hold_ms`를 그대로 그림), 11(W1 `records` 빼기), 14(알림 값 켜기). [FE 예외 처리 방안](fe-exception-handling-plan.md) 4·5장의 FE 제안도 정해지면 여기에 옮긴다.

### 지금 하지 않는 것

| 항목 | 언제 |
|---|---|
| 자정 점검 시나리오 다시 정하기 | 서버가 자정에 끊은 뒤 |
| 앱 날짜 나누기 정리 | 서버가 자정에 끊은 뒤 |

#### 자정 점검 시나리오 다시 정하기

- **지금 안 하는 이유:** 자정 넘김을 운영에 켠 뒤(요구 7)에 바꾼다. 그 전에는 지금 점검이 실제 동작과 맞다.
- **한줄요약:** 자정 점검을 「세션이 둘로 나뉨」 흐름으로 바꾼다.
- **발단:** 팀장 10/30 인계서 4번.
- **원인:** 지금 점검은 「자정에도 같은 세션 유지」 전제라, 요구 7로 자정 넘김을 켜면 실제 동작과 다르다.
- **요구사항/변경사항:** 요구 7 뒤에 [midnight.mjs](../../../tools/browser/midnight.mjs)와 [frontend README](../../../frontend/README.md) 자정 측정 절을 함께 고친다.

#### 앱 날짜 나누기 정리

- **지금 안 하는 이유:** 서버가 00:00에 끊어야(local은 요구 7, kafka 모드는 DevOps가 된다고 함) 지울 수 있다. 그 전에 지우면 자정을 넘긴 측정의 오늘 화면이 틀어진다.
- **한줄요약:** 서버가 자정에 끊게 되면 앱의 날짜 나누기를 지운다.
- **발단:** 서버가 자정에 세션을 끊지 않아, 자정을 넘긴 측정(예: 22:50~02:00)을 앱이 날짜별로 나눠 보관한다(10/26 lellon0403 `ad7cd42`, [dailyMeasurement.ts](../../../frontend/src/features/storage/dailyMeasurement.ts), [ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)). 02:00은 끊는 시각이 아니라 팀 회의 예시다.
- **원인:** 서버가 자정에 끊으면 측정 하나가 하루 안에 있어 나눌 필요가 없다.
- **요구사항/변경사항:** 요구 7 뒤에 따로 계획을 세워 지운다(인계서 5번). 기록·달력 화면이 함께 바뀌어 화면 담당과 같이 한다.


## 2. 지금 구조

기준: BE 브랜치 `refactor/repo-remove-api-version-paths` `08d4204`(develop `ed72615` + `/v2` 삭제, 2026-11-18, 11/19 DevOps #135 병합 `08d4204`). 주소는 `/v2`를 뺀 판으로 적는다. 운영 서버는 11/18 이 판으로 바뀌었고, 운영 앱(develop)이 Vercel에 새로 나갈 때까지 gateway가 옛 `/api/v2/…`도 별칭으로 받는다(요구 3). kafka 경로는 develop에 들어왔지만(#134) 운영은 local 경로다(`POSEGOOD_REALTIME_PIPELINE=local`). 경위·지난 진행 기록은 git 기록에 있다(이 문서 2026-11-10 판 `b03fd15`).

```
브라우저 / 데스크톱 앱(Electron, 웹 주소를 엶)
  ├─ https://app.posegood.site                 Vercel: 화면 파일만 (포크 develop)
  └─ https://api.posegood.site/api/…           Cloudflare 터널 → gateway(nginx) → io-api
     wss://api.posegood.site/api/realtime      같은 경로 (측정 WebSocket)

io-api(backend/api) ─ MySQL(계정·설정·기준 자세·세션·사건·기록)
   │  local(운영): 좌표 → 특징 계산 → 추론(POST /infer) → 판정 → MySQL → 앱
   │  kafka(설정으로 켬): 좌표 → 특징 → Kafka → 추론 → 판정·저장(처리 서비스) → Kafka → io-api → 앱
Spark J1·J2·J3(cron) ─ MySQL·HDFS
```

### 2.1 FE 구조

**앱 두 가지**

| 앱 | 화면 출처 | 비고 |
|---|---|---|
| 웹 | `https://app.posegood.site`(Vercel, 포크 develop) | 다른 탭에 가도 측정이 이어진다(프레임 타이머 Worker, `features/camera/frameTimer.ts`). 작은 카메라 창은 없다([ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md)) |
| 데스크톱(Electron, `frontend/electron/`) | 설치용은 웹 주소를 연다(F14, [ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md) 결정 8). 개발 실행은 로컬 개발 서버 | 작은 카메라 창, 앱 밖 알림 팝업, 시작 프로그램, 측정 중 닫기 확인 |

**앱이 하는 일과 안 하는 일**

- 하지 않는다: 자세 판정, 점수·상태·사건 계산, 시간 세기(3초 확정·자정·날짜). 모두 서버 값을 그대로 보인다([ADR 0021](../../decisions/0021-app-sends-information-server-judges.md)·[0029](../../decisions/0029-midnight-cut-and-server-time.md)).
- 한다: 카메라에서 관절 9개를 뽑아 프레임마다 보낸다. 사용자 위치를 알 수 없는 프레임은 좌표 없이 「판정 불가」 신호만 보낸다. 자세 등록 3초 평균을 내서 B1로 보낸다. 쉬기·카메라 끊김·종료를 알린다.
- 메시지·API 규칙은 [연동 명세](api-ws-spec.md), 기능별 동작은 [FE 기능 명세](fe-feature-spec.md).

**화면과 코드 위치** (사이드바: 측정하기·기록·달력·설정. 화면 모양은 lellon0403, 서버 연결·로직은 klaod-tech)

| 화면 | 코드 |
|---|---|
| 앱 조립·로그인 상태·화면 이동 | `app/ServiceApp.tsx`, `LocalServiceApp.tsx`, `ServiceScreens.tsx`, `AppSidebar.tsx`, `navigation.ts` |
| 로그인·가입·계정 | `pages/LoginPage.tsx`, `features/auth/`(`accountClient.ts` 요청·토큰 갱신, `consents.ts` 동의), `features/profile/` |
| 측정하기 준비·자세 등록 | `pages/SetupPage.tsx`, `features/camera/`, `features/baseline/`(B1·B2) |
| 측정 중·결과 | `features/session/live/`(`LiveSession.ts` 연결·메시지, `LiveSessionPage.tsx` 화면, `messages.ts` 형식 검사), `features/session/realtime/frames.ts`(구간 만들기), `features/session/useSessionPersistence.ts`(결과 보관·R1 확인) |
| 기록·달력 | `features/history/`(`recordsSource.ts`가 R1 기록으로 일별 합계를 계산), `features/storage/serverRecords.ts`(R1) |
| 설정 | `pages/SettingsPage.tsx`, `features/storage/serverWorkspace.ts`(W1·W2) |
| 오류 화면 | `pages/ErrorPage.tsx`, `features/connection/pageError.ts` |
| 요청 공통 | `features/platform/api.ts`(재시도·토큰), `serverConfig.ts`(주소), `serverAuth.ts`, `serverClock.ts`(서버 날짜) |
| 개발자 도구·학습용 수집 | `pages/DeveloperToolsPage.tsx`, `pages/CollectionPage.tsx`(jisung) |

**이 기기에 두는 것**

| 무엇 | 어디 | 언제 지움 |
|---|---|---|
| access 토큰 | 메모리만 | 로그아웃·새로 고침 |
| refresh 토큰 | HttpOnly 쿠키 `posegood_refresh`(서버가 심음) | 로그아웃·비밀번호 변경·탈퇴 때 서버가 철회 |
| 데스크톱 설정(시작 프로그램·알림 팝업·자동 카메라) | `userData/desktop-settings.json` | — |

기준 자세·판정 기준·기록(측정 결과 포함)은 이 기기에 두지 않고 서버에서 받는다. 서버 확인 없이 끝난 측정의 세션 ID만 앱이 켜진 동안 메모리에 둔다(11/13).

**연결 설정** (`features/platform/serverConfig.ts`)

| 변수 | 뜻 |
|---|---|
| `VITE_API_BASE_URL` | API 주소. 운영 `https://api.posegood.site`(Vercel Production에 설정). 비우면 같은 출처 `/api`. WS 주소도 여기서 만든다(`https:`면 `wss:`) |
| `POSEGOOD_API_URL` | 개발 서버의 `/api` 중계 대상. 기본 `http://127.0.0.1:8090` |
| `POSEGOOD_APP_URL` | 데스크톱 앱이 열 웹 주소. 기본 `https://app.posegood.site/` |
| `VITE_DISCORD_LOGIN_ENABLED` | `true`면 웹에 Discord 로그인·연결(A11~A17)을 켠다. 데스크톱 앱은 늘 숨김. 운영 웹 켜짐(11/16) |
| `VITE_PASSWORD_RESET_ENABLED` | `true`면 비밀번호 찾기(A9·A20·A10)를 서버로 보낸다. 운영 서버 메일이 켜진 뒤 켠다 |
| `VITE_EMAIL_VERIFICATION_ENABLED` | `true`면 가입 때 이메일 6자리 코드 인증(A18·A19)을 한다. 서버 `POSEGOOD_EMAIL_VERIFICATION_ENABLED`와 함께 켜고, 운영 서버 메일이 켜진 뒤 켠다. `VITE_ACCOUNT_MAIL_API_ENABLED=true`는 재설정과 인증을 함께 켠다 |

**데스크톱 앱** (`frontend/electron/`, 시각 규칙 [DESIGN.md](../../../DESIGN.md))

| 파일 | 역할 |
|---|---|
| `main.cjs` | 창 생성, 단일 실행, 외부 주소 차단(`sameAddress`), 시작 프로그램 등록, 설정 파일. 설치용은 웹 주소를 열고 10초 안에 못 열면 앱에 든 연결 실패 화면(`public/offline.html`), 「다시 시도」를 누르거나 인터넷이 다시 연결되면 한 번 다시 연다(주기적으로 다시 열지 않음). 측정 중 닫기는 「측정 중이에요. 정말 닫을까요?」(`will-prevent-unload`) |
| `preload.cjs` | 페이지에 `window.posegoodDesktop`(시작 정보, 시작 프로그램, 자동 카메라, 알림 팝업, 작은 카메라 창)만 노출 |
| `camera-window.cjs` | 작은 카메라 창: 앱 창이 가려지거나 최소화되면 오른쪽 아래에 저절로 보이고, 앞으로 오면 숨는다. 버튼은 접기·앱으로 돌아가기·X(측정 중이면 종료·저장) |
| `popup-preload.cjs` | 앱 밖 알림 팝업(`app://posegood/alert-popup.html`, 서버 없이도 뜸)에 문구·닫기·앱 열기만 노출. 앱 창이 가려졌을 때만 뜨고 8초 뒤 숨는다 |
| `launch-dev.mjs` | 개발 실행: 개발 서버 → 창 → 종료 때 서버 정리 |

보안: IPC는 앱 창이 연 화면 주소에서 온 요청만 받는다. `nodeIntegration` 끔, `contextIsolation`·`sandbox` 켬. 실행 명령은 [frontend README](../../../frontend/README.md).

### 2.2 서버 구조

| 서버 | 코드 | 하는 일 |
|---|---|---|
| **io-api** (입출구 서버) | `backend/api` | 로그인(JWT access 30분·refresh 14일, [ADR 0031](../../decisions/0031-jwt-access-refresh-login.md)), REST(A·C·W·B·S·R), 측정 WebSocket `/realtime`. 앱이 통신하는 곳은 여기 하나다 |
| 추론 | `backend/inference` | local: io-api가 `POST /infer`로 부른다. kafka: `posture.features`을 읽어 결과를 낸다. 점수는 지금 규칙 점수(`reference-feature-rule-v1`) |
| 처리 서비스 | `backend/processing` | kafka 경로에서 판정(`SessionJudge`)과 저장. local에는 쓰이지 않는다 |
| gateway | `infra/nginx`, compose `gateway` | 터널로 들어온 요청 중 `/api/`·`/api/realtime`·`/health`만 io-api로. `X-Forwarded-Proto https` 고정. 화면 파일은 내지 않는다 |
| web(8088) | compose `web` | 서버 PC 안 시험용 화면+API(SSH 포워딩) |

**측정 한 번 (local, 운영)**

1. 앱이 S1으로 세션을 만들고 WS `hello`(access 토큰) → `ready`.
2. 앱이 프레임마다 `features`를 보낸다. io-api가 좌표에서 기준 자세 대비 특징 변화량을 계산 → 추론 → 판정 엔진(3초 확정·회복·60초 재알림, 시간은 앱이 찍은 구간 시각으로) → MySQL.
3. 구간마다 `observation`·(`decision`·`alert`)·`ack`·`progress`를 같은 연결로 보낸다.
4. `end` → `decision(session_ended)` → `closed(ended)`. 연결이 끊기면 마지막으로 받은 구간 끝에서 서버가 끝내 저장한다. 재연결은 없다([ADR 0024](../../decisions/0024-session-ends-on-lost-connection.md)).
5. 판정 불가·자리 비움이 30분 이어지면 서버가 끝낸다(`unmeasurable_timeout`). 자정 넘김(`session_rollover`)은 구현돼 있지만 운영 설정은 꺼져 있다(요구 7).

**kafka 경로 (D-57, 브랜치)**: 앱 쪽 계약은 같다. 판정·저장이 처리 서비스로 옮겨 가고, `closed`는 DB 저장이 끝난 뒤 온다(D-67). 다른 점과 남은 일은 [FE 예외 처리 방안](fe-exception-handling-plan.md)과 요구 4·4·5.

**서버 설정값** (운영, DevOps)

| 변수 | 값 |
|---|---|
| `POSEGOOD_CORS_ALLOWED_ORIGINS`, `POSEGOOD_REALTIME_ALLOWED_ORIGINS` | `https://app.posegood.site`(끝 `/` 없이) |
| `POSEGOOD_COOKIE_SECURE` | `true` |
| `POSEGOOD_JWT_SECRET` | 32바이트 이상 비밀값 파일(없으면 재시작마다 모두 로그아웃) |
| `POSEGOOD_MIDNIGHT_ROLLOVER` | 기본 `false`(요구 7) |
| `POSEGOOD_UNMEASURABLE_TIMEOUT` | 기본 30분 |

서버 상세는 [BE API 명세](../api-spec.md)·[백엔드 상태](../../backend-status.md)·저장소 `infra/README.md`.

### 2.3 DB·데이터 구조

**MySQL** (V2.7, [DB 안내](../../../database/README.md)). 앱이 직접 닿는 표만 적는다.

| 표 | 무엇 | 앱에서 보이는 곳 |
|---|---|---|
| `user_account` | 계정, 프로필, 자세 알림 켜기(`sound_alert_enabled`) | 가입·프로필·설정(W1·W2) |
| `user_consent` | 동의 항목 | 가입 |
| `refresh_token` | 로그인 유지 토큰 해시 | A8 |
| `threshold_policy` | 판정 기준(민감도·확정·회복·재알림) | 설정(W1·W2), S1 `policy` |
| `baseline_posture` | 기준 자세(관절 좌표 평균, 등록마다 새 행) | 자세 등록(B1·B2) |
| `monitor_session` | 측정 세션(시작·종료 시각, 정책·기준 자세) | 기록(R1) |
| `collapse_event`, `correction_alert`, `excluded_interval` | 사건, 알림, 집계 제외 구간 | 기록 상세 |
| `daily_stat` | 일별 통계(Spark J2가 씀) | 아직 안 씀(T1 없음, 요구 12) |
| `social_identity`, `password_reset_token` | 소셜 로그인 연결, 비밀번호 재설정 토큰(V2.7) | Discord 로그인·연결(A11~A17), 비밀번호 찾기(A9·A10) |

**Spark 배치** ([bigdata/README.md](../../../bigdata/README.md), 서버 PC cron)

| 잡 | 시각 | 하는 일 |
|---|---|---|
| J1 | 매시 20분 | 측정 원문을 HDFS에 쌓는다. 좌표는 없고 특징 변화량만 있다 |
| J2 | 매일 00:10 | 어제~7일 전 끝난 세션 → 사용자별 `daily_stat`. 자정에 끊긴 세션이 저장될 시간을 두려고 00:00에서 미뤘다 |
| J3 | 매일 04:00 | 탈퇴 30일 지난 계정 최종 삭제 |

### 2.4 배포·운영

| 항목 | 지금 |
|---|---|
| 도메인·DNS | `posegood.site`(klaod-tech 개인 계정, 가비아), DNS는 Cloudflare 무료. `app.`은 DNS only(Vercel), `api.`는 프록시(터널) |
| 화면 | Vercel 프로젝트는 klaod-tech 포크(`klaod-tech/sitting-posture-corrector`) develop을 배포한다. 원래 저장소 develop에 합쳐도 포크를 올려야 운영에 나간다: `git fetch origin && git push fork origin/develop:develop`. 빌드는 `frontend`·`model`이 바뀌었을 때만(`frontend/vercel.json`) |
| 서버 | Cloudflare 이름 있는 터널 `posegood-api` → compose `cloudflared` → `http://gateway:80`. 연결 토큰은 klaod-tech가 서버 비밀값 파일에 직접 넣는다(저장소·채팅에 올리지 않음) |
| Cloudflare 보안 | 요청 제한 `auth-rate-limit`(`/api/v2/auth/*`, 같은 IP 10초 20번 → 10초 차단, 할 일 4에서 좁힘). Bot Fight Mode 끔(API 요청에 사람 확인이 끼면 깨짐) |
| 검색 노출 | 막아 둠(`robots.txt`, `X-Robots-Tag`) — 정식 공개 때 지움(할 일 5) |
| 주의 | Vercel 기본 주소(`*.vercel.app`)나 `app://`에서는 `api.`와 다른 사이트라 refresh 쿠키가 실리지 않아 로그인 유지가 안 된다. 실제 서버는 `app.posegood.site`에서만 쓴다 |
| 확인할 것 | Vercel 무료 요금제는 비상업용만. 도메인 갱신 가격은 첫해(3,300원)와 다르다(10/19 구입, 1년) |

## 3. FE가 정한 앱 동작

| 항목 | 결정 |
|---|---|
| 판정 | 앱은 판정하지 않는다. 점수 = 100 × (1 − `collapse_probability`)로 표시만 한다. 앱이 정하는 것은 「사용자 위치를 알 수 없음(판정 불가)」 하나다([ADR 0021](../../decisions/0021-app-sends-information-server-judges.md)) |
| 오늘 기록 | 결과 화면은 방금 끝난 세션만. 목록·합산·달력·잔디는 R1 기록을 앱이 집계한다([ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)) |
| 날짜·시각 | 서버 시각을 따르고 앱은 시간을 세지 않는다. 측정은 KST 00:00에 서버가 끊는다([ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)) |
| 민감도 | 화면 3단계(느긋하게 0.80·보통 0.70·꼼꼼하게 0.60)와 세밀 조정(0.5~0.95). DB에는 값 하나 |
| 소리 | 저장하지 않는다. 측정마다 꺼진 채 시작(브라우저는 사용자 동작 없이 소리를 켤 수 없음). 「자세 알림」 켜기만 서버에 저장 |
| 영상 크기 | 640×480을 요청하고 서버에 보내지 않는다. 4:3이 아니게 열리면 4:3 필수로 다시 열어 잘라 받고, 4:3이 아니면 카메라를 쓰지 않는다([ADR 0048](../../decisions/0048-camera-picture-is-four-by-three.md)). 측정 중 크기가 바뀌면 종료·저장 |
| 카메라 | 측정하기에서 메인 카메라를 고른다. 기준 자세는 카메라와 상관없이 하나. 쓰던 카메라가 빠지면 종료·저장 |
| 자세 등록 | 앱이 관절 9개 3초 평균을 B1로 보낸다. 이 기기에 저장하지 않는다 |
| 끊김 | 재연결·재전송 없음. 끊기면 측정을 끝내고 서버가 끊긴 곳까지 저장([ADR 0024](../../decisions/0024-session-ends-on-lost-connection.md)) |
| 측정 종료 | 결과가 올 때까지 「저장하고 있어요」 창으로 막고, 5초 안에 없으면 결과 화면에서 알린다([FE 예외 처리 방안](fe-exception-handling-plan.md)) |
| 모델명·버전 | 화면에 보이지 않는다(API 필드는 그대로) |
| 5분 미만 세션 | 저장하고 기록·통계에 넣는다. 「붕괴까지 걸린 시간」 최소·최대에서만 뺀다(DB V2.3) |
| 탈퇴 | 되돌릴 수 없다. 30일 뒤 최종 삭제(J3). 문구는 [연동 명세](api-ws-spec.md) 2장 |

## 4. 판정 규칙과 시험 데이터

판정 규칙(판정 가능 검사, 특징값, 고개 돌림, 점수, 복귀 대기, 판정 불가 시간)은 서버가 구현하고 BE·ML이 정한다. 원문은 이 파일의 git 기록 `d69b22c`.

- [합성 시험 데이터](../../../contracts/examples/frames/reference-rule-cases.json): 좌표 → 기대 결과(프레임 17·시간 순서 4·보정 1). 서버가 같은 결과를 내는지 확인용이다. 다시 만드는 것은 서버 쪽 몫이다.
