# FE 제안서: 서버 판정 이전과 연동

> 작성자: klaod-tech(FE) · 작성: 2026-10-11
> **대상:** 팀 전원 — 팀장(Jeon-Seho), DB·BE(김유진, GitHub `sunshine-yj`), DevOps(홍규, `ghdrb1246`), ML(지성, `jisung`), 화면(`lellon0403`). FE는 `klaod-tech`다.
> **이 문서의 역할:** 다른 파트에 요청·질문(0장), FE가 해야 할 일(1장), 지금 FE·서버·DB·배포 구조(2장), FE가 정한 앱 동작(3장). 앱이 언제 무엇을 보내고 받는지와 API 상세는 [연동 명세](api-ws-spec.md), 기능별 동작은 [FE 기능 명세](fe-feature-spec.md), 필드 규칙은 [BE API 명세](../api-spec.md), 결정의 근거는 ADR([0021](../../decisions/0021-app-sends-information-server-judges.md)·[0024](../../decisions/0024-session-ends-on-lost-connection.md)·[0027](../../decisions/0027-today-records-from-collected-server-results.md)·[0029](../../decisions/0029-midnight-cut-and-server-time.md))이다.
> **코드 읽는 법:** A·W·B·S·R·T·C + 숫자(예: S1, B2)는 서버 API([연동 명세](api-ws-spec.md) 3장). 요구 N은 다른 파트에 요청(0장), 할 일 N은 FE가 할 일(1장). BE-2·BE-13~BE-22는 남은 BE 요청(0장), F14는 데스크톱 앱이 웹 주소를 여는 것([ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md) 결정 8). D-nn·T-nn은 BE·DevOps 작업 번호, J1·J2·J3은 서버의 Spark 배치다.

## 0. 남은 질문과 요청

기준: develop `97ac99a`(PR #114까지)와 `feat/ws-kafka-pipeline` `ffdd37e`, 2026-11-11 코드로 확인(요구 2는 11/12 `eb825bb`). FE가 다른 파트에 요청·확인해야 하는 것(0장)과 FE가 할 일(1장)만 남긴다. 끝난 것은 지우고(경위는 git 기록, 옛 판 `b03fd15`), 다른 파트 안의 일(아키텍처 문서, 좌표 보관 결정, 운영 배포 규칙, BE 내부 시험)은 적지 않는다. 항목마다 **한줄요약 · 발단**(어떻게 나온 이야기인가) **· 원인**(왜 문제인가) **· 요구사항/변경사항**(무엇을 어떻게, 어디를) 순서로 적는다.

다른 파트(BE·DevOps·ML·PM)에 요청하거나 함께 정할 것이다. FE 몫이 있으면 요구 안에 적었다. 순위는 1 Kafka 모드 관련, 2 BE·DevOps가 정할 것, 3 휴대폰 기록이고, 같은 순위 안에서는 먼저 할 것부터 적는다.

| 순위 | 묶음 | # | 요구 | 누가 | 언제 |
|---|---|---|---|---|---|
| 1 | Kafka 모드(D-57)와 관련된 것 | 1 | Kafka 경로 서버 상태를 쿠버네티스가 알게 하기 (BE-14~17) | BE·DevOps·PM | kafka 모드를 운영에 켜기 전 / 쿠버네티스로 옮길 때 |
|  |  | 2 | kafka 모드도 KST 00:00에 끊김 없이 세션 넘기기 (BE-18) | PM·DevOps·BE | kafka 모드를 운영에 켜기 전 |
|  |  | 3 | Kafka 전환 때 판정 순서 확인 | BE·DevOps·PM | Kafka 전환 시험 |
|  |  | 4 | 실시간 `ack` 메시지 빼기 (BE-19) | BE·PM·DevOps·FE | 급하지 않음. kafka 모드 병합(D-57) 때 함께 |
|  |  | 5 | `features` 메시지에서 묶음 단계(`items[]`·`frames[]`) 빼기 (BE-20) | FE·BE·DevOps | 급하지 않음. 요구 4와 같은 계약 판에 |
| 2 | BE·DevOps가 정할 것 | 6 | 짧은 끊김 봐주기(`hold_ms`) 규칙 정하기 | BE·ML·FE | 정할 것 |
|  |  | 7 | 운영 서버 자정 넘김 켜기 | DevOps | 이 FE 배포 뒤 |
|  |  | 8 | 열린 채 남는 세션 닫기 | BE | 정할 것 |
|  |  | 9 | 쉬기 자동 종료 (BE-13) | BE | 정할 것 |
|  |  | 10 | API 경로에서 버전(`/v2`) 빼기 | DevOps·BE·FE | 팀원 확인 뒤 한 번에 |
|  |  | 11 | 안 쓰는 API 정리: C1 삭제, W1 응답에서 `records` 빼기 (BE-21) | BE | 급하지 않음 |
|  |  | 12 | 측정 시간 1분 미만인 세션 거르기 (BE-22) | BE·FE | 정할 것 |
| 3 | 휴대폰 기록 | 13 | T1 일별 통계 API (BE-2) | BE | 휴대폰 기록을 만들 때 |

### 1순위: Kafka 모드(D-57)와 관련된 것

D-57을 병합하거나 kafka 모드를 운영에 켜기 전에 정하거나 고칠 것.

#### 요구 1. Kafka 경로 서버 상태를 쿠버네티스가 알게 하기 (BE-14~17)

- **한줄요약:** 「살아 있다면서 Kafka 일은 안 하는」 서버를 쿠버네티스가 재시작할 수 있게 각 서버 health를 고친다.
- **발단:** D-57 통신 시험 보고서를 검수하며 Kafka 경로 장애 때 앱 대응을 kafka 브랜치 코드와 맞춰 봤다. 장애 대부분은 정해져 있다: 서비스·Kafka가 죽으면 쿠버네티스가 다시 띄우고(BE 답), 기록은 Kafka가 들고 있다가 처리되며 Hadoop에도 남는다. 그보다 큰 장애는 FE가 대비하지 않는다(11/11 결정). 시작 때 Kafka가 죽어 있으면 앱이 오류 화면(500 그림)으로 막는다([FE 예외 처리 방안](fe-exception-handling-plan.md) 2.4). 그런데 **프로세스는 살아 있어 health 200인데 Kafka 일은 안 하는 상태**가 있었다.
- **원인:** health가 자기 Kafka 스레드를 보지 않거나, 반대로 남의 상태까지 본다. 앱은 이걸 「추론 재시작 중」과 구별할 수 없어(둘 다 `observation`만 안 옴) 서버에서만 확인할 수 있다.
  - **A** io-api 결과 구독 스레드가 예외로 끝나도 다시 시작하지 않음(`KafkaResults.run`) → 모든 측정에 결과·`closed`가 안 가는데 health 200
  - **B** 추론 Kafka 입력 스레드가 죽어도 상태에 `running: true`(`realtime.py` `status()`)
  - **C** 판정 결과 형식이 안 맞으면 io-api가 메시지를 전부 건너뜀(로그 경고만, lag 0)
  - **D** 처리 서비스 `@KafkaListener`가 멈춰도 Spring 기본 health에 안 나옴(**BE 확인 필요**)
  - **E** io-api `stalled` 타이머가 예외로 조용히 멈춤(가능성 낮음)
  - **F** 추론 `/health`가 Kafka·Redis까지 봐서, liveness로 쓰면 Kafka가 잠깐 죽을 때 추론도 계속 재시작됨
  - **G** io-api 결과 구독 그룹 이름이 `io-ws-${HOSTNAME}`이라 쿠버네티스 파드마다 그룹이 새로 생김
- **요구사항/변경사항:**
  - **BE-14** 각 서버 liveness에 **자기** Kafka 스레드·리스너가 도는지 넣는다(A·B·D·E). 쿠버네티스는 liveness가 실패해야 재시작한다. 「쿠버네티스가 다시 띄우니 FE는 대비하지 않는다」의 전제 조건이다. kafka 모드를 운영에 켜기 전.
  - **BE-15** 다른 서버(Kafka·Redis·DB) 상태는 liveness에서 뺀다(F). 넣으면 멀쩡한 서버가 무한 재시작되고, io-api면 측정 중인 모든 WS가 끊긴다. 저장소의 같은 원칙: `infra/compose/bigdata.yaml` 처리 서비스(D-11) 「liveness만 본다 — 외부 DB 일시 장애가 번지지 않게」. 쿠버네티스로 옮길 때.
  - **BE-16** 건너뛴 메시지 수와 DLQ(`posture.dlq`) 증가를 내놓고 알림을 받는다(C). 재시작으로 안 고쳐지는 배포 문제라 사람이 봐야 한다. kafka 모드를 운영에 켜기 전.
  - **BE-17** 결과 구독 그룹 이름을 고정값(`posegood.realtime.kafka.group-id`)으로 준다(G). 쿠버네티스로 옮길 때.
  - 위치: io-api `KafkaResults.java`·`RealtimeHandlerV2.java`(`timer`·`checkStalled`)·`HealthController.java`·`RealtimePipelineConfiguration.java`, 추론 `realtime.py`·`main.py` `/health`, 처리 서비스 `RealtimeInferenceConsumer.java`·`EpisodesStoreConsumer.java`, `infra/compose/bigdata.yaml`, 쿠버네티스 매니페스트. FE는 할 일 없음.

#### 요구 2. kafka 모드도 KST 00:00에 끊김 없이 세션 넘기기 (BE-18)

- **한줄요약:** kafka 모드도 local처럼 00:00에 `session_rollover`로 세션만 바꾸고 사용자의 측정은 끊지 않는다. 지금 코드는 local 전용이라 막아 둔 조건만 풀면 안 되고, 종료·시작을 Kafka 경로로 보내게 고쳐야 한다.
- **발단:** BE 11/11 S4 공지를 받고 kafka 브랜치 WS 코드를 ADR과 대조했다. [ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)에는 「Kafka 모드도 같은 규칙」이라고 되어 있는데, `RealtimeHandlerV2` 생성자가 `midnightRollover && pipeline.local()`이라 **설정을 켜도 kafka 모드에서는 자정 넘김이 꺼진다**(주석 「가이드 11장 #3」). 11/12 `feat/ws-kafka-pipeline` `eb825bb`로 다시 확인.
- **원인:**
  - **끊지 않으면** 자정을 넘긴 측정 하나가 통째로 시작한 날에 들어간다(서버 기록에는 날짜 나누기가 없다). 예: 23:00~01:00 측정이면 00:10 J2는 진행 중이라 어제 통계에서 빼고, R1로 확인된 뒤에는 120분이 모두 어제가 되어 앱 오늘 화면의 60분이 사라지고, 다음 날 J2의 7일 다시 계산이 어제에 120분을 넣는다.
  - **조건만 풀면 안 되는 이유:** 자정 넘김(`SessionService.rollover`)은 io-api 안의 판정 엔진으로 이전 세션을 끝내고 저장한다. kafka 모드에서 이 엔진은 판정하지 않아 비어 있으므로(계획 0031 11번):
    1. 이전 세션이 0초로 저장된다(`engine.end(engine.summary().totalMs())`). kafka 모드에서 종료 값(`ended_at`·`good_sec`)은 처리 서비스만 쓴다(`EpisodeStoreService` C-1).
    2. Kafka에 이전 세션의 `session_ended`가 가지 않는다. 처리 서비스가 열린 사건·제외 구간을 닫지 않고 `ended_at`도 쓰지 않는다.
    3. 새 세션의 `session_started`가 Kafka에 가지 않는다. 처리 서비스 판정기가 사용자 정책 대신 서버 기본값으로 판정한다([FE 예외 처리 방안](fe-exception-handling-plan.md) 6장 2번).
    4. `session_rollover`의 이전 세션 요약(`ended.summary`)이 빈 값이다.
- **요구사항/변경사항:** kafka 모드를 운영에 켜기 전에 BE·DevOps가 고친다(D-57). 이미 있는 부품을 잇는 일이다.
  1. 자정 감지는 그대로 쓴다: 자정을 넘는 구간이 오거나 00:00:30(`cutMs`, `midnight()`).
  2. 이전 세션: io-api 엔진으로 끝내지 않고 `pipeline.finish(이전 세션, end_ms = 자정 위치)`로 `session_ended`를 보낸다. 저장은 평소 종료처럼 처리 서비스가 한다.
  3. 새 세션: local과 같이 행을 만들고(`insertFollowing`, 정책·기준 자세는 이전 것) `pipeline.open`으로 `session_started`를 보낸다.
  4. `session_rollover`는 저장 완료를 기다리지 않고 바로 보낸다. `ended.ended_at`은 이전 세션 시작 + 자정 위치로 알 수 있고, `ended.summary`는 그 연결이 받은 마지막 `progress`(D-57 ⑧ `SessionResults`)를 쓴다. 마지막 몇 구간이 빠진 값일 수 있지만, 앱은 이전 세션을 대기 기록으로 두고 R1로 확정하므로 맞게 고쳐진다.
  5. 새 세션의 구간은 새 세션 ID로 Kafka에 들어가 이전 세션과 섞이지 않는다(파티션 키 = 세션 ID).
  6. 끝나면 ADR 0029의 BE 줄 「Kafka 모드도 같은 규칙」을 확인했다고 고친다.
  - **사용자:** 자정을 몰라도 된다. 화면은 측정을 그대로 이어 가고 「자정이 지나 새 측정으로 이어졌어요」만 짧게 띄운다(`LiveSession.rollOver`, local에서 이미 이렇게 동작). **앱 일은 없다.**
  - **쓰지 않는 안:** 자정에 끝내기(`closed(day_changed)`)는 사용자가 자정에 측정을 다시 시작해야 해 쓰지 않는다. 새 세션을 못 만들 때의 대비로만 남는다(local도 같음). 끊지 않기는 위 「원인」대로 오늘 기록이 사라진다.

#### 요구 3. Kafka 전환 때 판정 순서 확인

- **한줄요약:** kafka 모드에서 추론이 한 세션의 결과 순서를 바꾸지 않는지 전환 시험에서 확인한다.
- **발단:** local은 API 한 곳이 차례대로 처리해 순서가 지켜지지만, kafka는 판정이 처리 서비스로 옮겨 간다.
- **원인:** kafka 판정기는 이미 반영한 `sequence`는 버리고, 번호가 건너뛰면 `missing_sequence`로 끊는다([kafka-spec.md](../kafka-spec.md) 3.3, `V1SessionJudge`). 늦게 온 결과를 기다려 주던 버퍼(#91 `PendingIntervals`)는 #91과 함께 빠졌다. 순서가 바뀌면 판정이 끊긴다.
- **요구사항/변경사항:** 전환 시험(계획 0031)에서 순서를 확인하고, 바뀌면 버퍼를 다시 넣는다. 판정은 결과가 오는 즉시, 시간은 촬영 시각으로 센다(3초 묶음으로 되돌리지 않음).

#### 요구 4. 실시간 `ack` 메시지 빼기 (BE-19)

- **한줄요약:** 앱도 서버 운영도 쓰지 않는 `ack`를 빼고, 통합 시험은 `observation` 개수로 확인한다.
- **발단:** 11/11 「`ack`가 정확히 무슨 역할이냐」는 질문을 받고 경위를 확인했다.
- **원인:** `ack`는 원래 재전송 창이었다(10/6 `client.ts`: `ack` 안 된 구간을 재연결 때 다시 보냄). ADR 0024로 재전송을 없앤 뒤(10/21 `client.ts` 삭제) 앱은 받기만 하고 버린다(`case 'ack': return`). 그런데 서버는 지금도 구간마다(초당 약 10개) 보낸다. local은 구간마다 `observation`·`ack`·`progress` 3개라, 보내는 메시지의 약 3분의 1이 버려지는 `ack`다. 지금 `ack`를 쓰는 곳은 DevOps 통합 시험(`ws_realtime_smoke.py`)뿐이고, 서버의 `stalled` 판단은 메시지가 아니라 서버 안의 시각(`ackedAt`)을 쓴다.
- **요구사항/변경사항:** 순서대로 한다. kafka 모드 병합(D-57) 때 함께, 급하지 않음.
  1. DevOps: 통합 시험의 「구간 ack」 확인을 「보낸 구간 수 = 받은 `observation` 수」로 바꾼다(kafka는 lag 0·DLQ +0 확인 유지).
  2. BE·PM: `RealtimeHandlerV2.measure`의 `send(…V2.Ack…)` 두 곳과 `RealtimeMessages.V2.Ack`, 서버 시험을 지운다. **`Channel.ackedAt`은 남긴다**(구간을 넘긴 시각, `checkStalled`가 씀. 이름은 `acceptedAt` 등으로).
  3. FE: 계약 `realtime-ws.v2.schema.json`의 `ack`(설명 「The app only shows it」도 틀림)·`examples-v2/ws-ack.json`, 앱 `messages.ts`·`LiveSession.ts`, 연동 명세를 정리한다.

  앱은 `ack`를 무시하므로 서버가 먼저 바뀌어도 운영 화면에 영향이 없다. 시험 연결에만 `ack`를 켜는 안(`hello` 선택 칸)은 `hello` 형식을 바꿔야 해서 고르지 않았다.

#### 요구 5. `features` 메시지에서 묶음 단계(`items[]`·`frames[]`) 빼기 (BE-20)

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
  - ① 계약은 1~30개인데 서버는 정확히 1개가 아니면 `closed(bad_message)`(`RealtimeHandlerV2.interval()`). **계약과 서버가 다르다.**
  - ② 서버는 1장을 상대로 반복문과 평균을 그대로 돈다(`FrameFeatures.interval`·`average`, `FrameInterval` `@Size(max = 30)`).
- **요구사항/변경사항:** 형식은 BE와 정한다. FE 안:

  ```json
  { "type": "features", "sequence": 42, "start_ms": 21000, "end_ms": 21100, "phase": "running",
    "t_ms": 21012, "p": [[0.51234, 0.40211, 0.99], …9개] }
  ```

  프레임 없는 구간(쉬기·자리 비움·빈 구간)은 `t_ms`·`p`를 빼고, 앱이 사람 위치를 판별하지 못한 프레임은 `"p": null`만 보낸다. 지금 함께 붙이는 `valid: false`는 **뺀다**: 서버는 이 칸을 형식만 검사하고 판정에는 `p`가 null인지만 쓴다(`FrameInterval.Frame`, `FrameFeatures.interval`). 사람이 없는 프레임과 위치를 못 잡은 프레임을 서버가 구분하지 않으므로 `p: null` 하나로 같은 뜻이다. 판정 결과의 `valid`는 서버가 돌려주는 `observation.valid`로, 이 칸과 다르다. 판 번호는 `hello`에서 한 번 정한다. 요구 4와 같은 계약 판에, kafka 병합 뒤에 순서대로 한다.
  1. FE(지금 해도 됨): 계약 `features.items`를 `maxItems 1`로 서버와 맞춘다. 프레임의 `valid`는 서버에서 선택 칸이라 앱이 먼저 빼도 된다(`frames.ts` `push`).
  2. BE: 서버가 옛·새 형식을 다 받게 하고(`hello` 판 번호로), 특징 계산을 프레임 1장 기준으로 바꾼다.
  3. DevOps: 통합 시험을 새 형식으로.
  4. FE: 앱(`frames.ts` `FrameBatch`, `LiveSession.ts` `send`)을 새 형식으로 배포.
  5. BE: 옛 형식 받기를 지운다.

  kafka `posture.features.v1`과 추론 `POST /v2/infer`는 바뀌지 않는다(서버가 계산한 특징 변화량을 보냄).

### 2순위: BE·DevOps가 정할 것

서버 규칙·설정이라 BE·DevOps가 정하고 FE는 의견을 낸 것.

#### 요구 6. 짧은 끊김 봐주기(`hold_ms`) 규칙 정하기

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

#### 요구 7. 운영 서버 자정 넘김 켜기

- **한줄요약:** 운영 서버에서 `POSEGOOD_MIDNIGHT_ROLLOVER=true`로 켠다.
- **발단:** BE가 자정 넘김(`session_rollover`, ADR 0029 B안)을 구현했다(PR #77). 앱 처리도 운영 화면에 있다(PR #88). 설정 기본값만 꺼져 있다.
- **원인:** J2는 00:10에 그때 끝난 어제 세션만 센다. 꺼져 있으면 자정을 넘긴 측정이 어제 통계에도, 앱의 오늘 화면에도 제대로 안 보인다([ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md) 11/02 FE 확인).
- **요구사항/변경사항:** 운영 설정만 바꾼다([application.properties](../../../backend/api/src/main/resources/application.properties)). 켜기 전에 BE가 실제 MySQL에서 자정 넘김(`INSERT … SELECT`)을 시험한다.

#### 요구 8. 열린 채 남는 세션 닫기

- **한줄요약:** `ended_at`이 빈 채로 남는 세션 행을 서버가 닫는 규칙을 BE가 만든다. 앱이 닫을 길은 없다(S3 지움, D-88). 서버는 「사용자가 포기했는지」를 직접 알 수 없지만, 앱의 약속 덕분에 **시간으로** 판단할 수 있다.
- **발단:** 10/22 질문(S1 뒤 WS가 안 열린 세션)을 서버 코드로 다시 보니 이 세션이 닫히지 않는다. 11/12 S4 404 처리를 정하면서 측정 중 서버가 재시작된 세션도 같은 문제인 것을 확인했다.
- **원인:** 서버는 메모리에서만 6시간 뒤 뺀다([LiveSessions.java](../../../backend/api/src/main/java/org/posegood/api/session/LiveSessions.java) `evict`). DB 행은 `ended_at` NULL로 남아 J1·J2·기록 목록에 영향을 준다. 두 경우가 있다.

  | 경우 | 측정 데이터 | 앱 화면(FE, 끝남) | 서버가 닫는 법(안) |
  |---|---|---|---|
  | ① S1 뒤 측정이 시작되지 않음(WS가 안 열림·`hello` 전 끊김·앱이 `ready`를 5초 기다리다 포기) | 없음(좌표를 한 장도 못 보냄) | 「지금은 측정을 시작할 수 없어요」([FE 예외 처리 모음](fe-exception-log.md) 4번) | 0초로 닫거나 지운다. 요구 12(1분 미만 거르기)가 있으면 기록·통계에는 어차피 안 나온다 |
  | ② 측정 중 서버 재시작(local) | 있음(사건·제외 구간 일부) | 끝난 뒤 S4 404 → 「서버에서 이번 측정을 찾지 못했어요」, 이 기기에는 남기지 않음([FE 예외 처리 모음](fe-exception-log.md) 5번) | 마지막으로 저장된 구간 끝에서 닫는다. 그러면 R1에 기록으로 나온다 |

- **서버가 판단할 수 있는 근거:**
  - 서버가 아는 것: 세션을 만든 시각(S1), 그 세션으로 `hello`나 측정 구간이 한 번이라도 왔는지, 지금 메모리에 그 세션이 있는지. 모르는 것: 실패한 이유(사용자 네트워크인지 등). 이유는 몰라도 된다.
  - 앱의 약속([연동 명세](api-ws-spec.md) 1.1 「앱의 시간 규칙」): 앱은 `ready`를 **5초**까지만 기다리고, 실패한 세션은 **다시 쓰지 않는다**. 다시 할 때는 새 `session_id`로 S1부터 한다. WS는 연결 뒤 10초 안에 `hello`를 보낸다([연동 명세](api-ws-spec.md) WS 상세).
  - 그래서 S1 뒤 충분히 긴 시간(안: 1분)이 지나도록 `hello`가 한 번도 오지 않은 세션은 앱이 이미 버린 것이고, 앱이 그 세션으로 돌아올 일이 없다. 닫아도 안전하다.

  | 서버가 보는 상태 | 판단 |
  |---|---|
  | S1 뒤 얼마 안 됐고 WS가 아직 안 옴 | 아직 연결 중일 수 있다. 기다린다 |
  | S1 뒤 1분이 지나도록 `hello`가 없음 | ① 앱이 포기한 세션. 0초로 닫는다 |
  | `ended_at`이 비었는데 메모리에 없음(서버 재시작 뒤) | ② 측정 중 끊긴 세션. 마지막으로 저장된 구간 끝에서 닫는다 |

- **요구사항/변경사항:** BE가 「열린 채 남는 세션을 닫는 규칙」을 만들기로 했다(아키텍처 v5.4). FE 안:
  1. 주기적으로(예: 1분마다) S1 뒤 1분이 지나도록 `hello`가 없는 세션을 0초로 닫는다(①).
  2. 서버 시작 때와 주기적으로, `ended_at`이 비었는데 메모리에 없는 세션을 마지막으로 저장된 구간 끝에서 닫는다(②).
  3. 닫은 세션 수를 경우별로 로그·지표로 남긴다. 측정이 시작되지 않은 세션이 얼마나 생기는지 운영에서 볼 수 있게 한다. 앱은 연결이 안 된 상태라 실패를 서버에 알릴 수 없다.
  4. 규칙이 나오면 FE가 확인한다([연동 명세](api-ws-spec.md) 4장 S4 「남는 틈」, [FE 예외 처리 방안](fe-exception-handling-plan.md) 3장).

#### 요구 9. 쉬기 자동 종료 (BE-13)

- **한줄요약:** 쉬기가 30분 이어지면 서버가 측정을 끝내고 저장한다.
- **발단:** 10/20 계획은 「일시정지가 10분 이어지면 끝내고 저장」인데 서버·앱 모두 구현이 없다.
- **원인:** 쉬기를 누르고 자리를 떠나면 측정이 끝없이 열려 있다. 앱은 시간을 세지 않는다([ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)). 서버에는 판정 불가·자리 비움 30분(`unmeasurable_timeout`)만 있다.
- **요구사항/변경사항:** **FE 의견:** `unmeasurable_timeout`과 같은 방식으로 서버가 쉬기(`rest`) 시간을 세어 30분이면 끝내고 새 사유(안: `closed(rest_timeout)`)를 보낸다. local 엔진과 kafka 결과 구독(`KafkaResults`의 측정불가 세기) 모두. 앱은 새 사유 문구만 더한다(`LiveSession.ts` `CLOSED`).

#### 요구 10. API 경로에서 버전(`/v2`) 빼기

- **한줄요약:** 서버 API에서 버전 표시를 아예 없앤다. 모든 경로의 `/v2`(예: `/api/v2/auth/login`)를 빼 `/api/auth/login`으로 바꾸고, 앱에도 버전 개념을 남기지 않는다.
- **발단:** DevOps 요청. Notion 문서를 고치면서 경로마다 붙은 `/v2` 때문에 API를 찾기 힘들다는 의견이 나왔다.
- **원인:** `/v2`는 옛 v1 API와 함께 운영하려고 붙인 구분이다. v1이 모두 없어져 지금은 구분하는 것이 없고 경로만 길어진다. 속도·서버 부담에는 차이가 없다.
- **요구사항/변경사항:** 한쪽만 바꾸면 로그인·측정이 끊기므로 팀원 확인을 받고 순서대로 한 번에 한다.
  1. DevOps/BE: 서버가 옛 경로(`/api/v2/…`)와 새 경로(`/api/…`)를 **둘 다** 받게 한다(예: gateway에서 `/api/v2/`를 `/api/`로 넘김). BE 코드 약 20개 파일(`@RequestMapping("/v2…")`).
  2. FE: 버전을 지우고 배포한다. 앱 코드의 `/v2`는 `features/platform/serverConfig.ts` 한곳에 모아 두었다(REST·계정·메일·WS 주소가 모두 `API_ROOT`를 씀). `API_VERSION`을 지우고 `API_ROOT`를 `'/api'`(gateway가 떼는 공통 앞부분)로 둔다. 개발용 가짜 서버(`frontend/scripts/fake-server.mjs`)의 「`/v2`도 받기」 줄과 시험 코드 9개 파일의 `/api/v2/…` 확인도 지운다. 그 뒤 앱 어디에도 `/v2`가 남지 않는다.
  3. FE: Cloudflare 요청 제한 규칙 `/api/v2/auth/*`를 새 경로로 바꾼다(할 일 4와 함께).
  4. DevOps/BE: 점검 도구(`tools/platform`), 계약(`contracts`), 인프라 설정, 문서의 경로를 바꾼다.
  5. DevOps/BE: 옛 경로를 지운다. 화면을 앱 안에 가진 옛 데스크톱 설치판은 옛 경로로 요청하므로, 새 데스크톱 앱(F14, [ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md) 결정 8)이 퍼진 뒤에 지운다.

#### 요구 11. 안 쓰는 API 정리: C1 삭제, W1 응답에서 `records` 빼기 (BE-21)

- **한줄요약:** 앱이 부르지 않는 C1(선택 정보 동의·철회)을 지우고, W1이 앱이 버리는 기록 목록을 매번 만들지 않게 `records` 칸을 뺀다.
- **발단:** 11/12 계획 0062(안 쓰는 API 정리)의 남은 항목을 오늘 코드로 다시 확인했다. 0062가 「화면이 있어 연결만 남음」으로 둔 것 가운데 C1만 아직 앱이 부르지 않고, W1의 `records`는 「FE가 W1을 붙이기 전에 함께 정한다」로 미뤄 둔 채 W1이 연결됐다.
- **원인:**
  - **C1:** 서버 주소(`PUT /consents/optional-profile`)는 있는데 부르는 화면이 없고 만들 계획도 없다. 쓰지 않는 경로가 남아 있으면 시험·문서·보안 점검 대상만 늘어난다.
  - **W1 `records`:** 처음에는 설정 화면 하나에 필요한 것을 한 번에 주려고 기록까지 넣었다. 그 뒤 기록 전용 R1(`GET /records`)이 생겨 기록은 R1이 맡는다. 그런데 W1은 지금도 부를 때마다 R1과 같은 함수(`RecordHistory.list`)로 그 사용자의 끝난 세션 전체와 알림·사건·집계 제외 구간 전체를 읽어 요약을 다시 계산한다. 앱은 이 칸을 읽지 않고 버린다. 앱은 W1을 로그인 뒤, 측정하기·설정·프로필 화면을 열 때, 판정 기준을 바꿀 때마다 부르므로 기록이 쌓일수록 쓸모없는 일이 커진다.
- **요구사항/변경사항:**
  1. BE: C1 경로와 처리(`WorkspaceController` `/consents/optional-profile`, 서비스·시험)를 지운다. 가입 때 선택 정보 동의(`OPTIONAL_PROFILE`)와 W1의 `consents.optional_profile`은 그대로 둔다.
  2. BE: `WorkspaceService.get`에서 `result.set("records", …)`를 지우고, BE API 명세 W1 응답·서버 시험을 고친다. API 이름은 「설정 조회」.
  3. FE: 할 일 없음. 앱은 C1을 부르지 않고 W1의 `records`를 읽지 않으며, 칸이 없어도 형식 검사가 통과한다. 서버를 먼저 바꿔도 운영 화면에 영향이 없다. 연동 명세·FE 기능 명세는 11/12에 미리 고쳤다.
  4. H1(`GET /health`)은 남긴다. 앱은 부르지 않지만 컨테이너 healthcheck, gateway, 배포 확인과 평소 상태 확인에 쓴다(요구 1의 liveness도 이 주소).
  - 결과: 가입 뒤 선택 정보 동의를 앱에서 철회하는 기능은 없다. 나이·직업은 프로필 수정(W2)에서 비울 수 있다.

#### 요구 12. 측정 시간 1분 미만인 세션 거르기 (BE-22)

- **한줄요약:** 실제 측정 시간(`valid_ms`)이 1분이 안 되는 세션은 서버가 기록·통계에서 거른다. 기준과 거르는 방법은 BE가 정한다.
- **발단:** 11/12 「판정 불가가 30분 이어지면 서버가 끝낸다」(`unmeasurable_timeout`)를 코드로 확인하다 나왔다. 카메라를 잘못 둔 채 측정을 켜 두면 판정을 한 번도 못 한 세션이 그대로 저장된다.
- **원인:**
  - 서버는 S1 때 세션 행을 만들고 측정 중에도 사건·제외 구간을 쓴다. 판정 불가(`valid: false`)·쉬기·자리 비움 시간은 제외 시간(`UNMEASURABLE`·`PAUSE`·`ABSENCE`)이라 바른 자세 비율에는 들어가지 않지만, 세션 자체는 끝난 기록으로 남는다.
  - 그래서 측정 시간이 0이거나 몇 초뿐인 세션이 기록 목록·달력에 「측정 0분」으로 보이고 그날 측정 횟수만 늘린다. 실수로 켰다 끈 측정도 같다.
  - 측정 시간이 1분 이상이면 판정 못 한 시간이 섞여 있어도 남긴다. 통계는 측정 시간만으로 계산하고(하루 비율 = 바른 자세 시간 합 ÷ 측정 시간 합), 판정 불가 구간은 이어지던 자세를 끊어 사건·유지 시간을 부풀리지 않는다.
- **요구사항/변경사항:**
  1. BE: 끝난 세션의 측정 시간이 1분 미만이면 R1 기록, S4의 DB 값, J2 `daily_stat`(T1)에서 뺀다. 지울지, 표시만 해 둘지(예: 종료 사유·상태), 기준을 1분으로 할지는 BE가 정한다. local 엔진과 kafka 처리 서비스 모두 같은 규칙.
  2. BE: 앱이 그 세션이 걸러졌다는 것을 알 수 있게 한다. 앱은 R1에서 같은 세션을 찾아야 대기 기록을 지우므로, 걸러진 세션은 영영 확인되지 않아 끝없이 기다린다([FE 예외 처리 방안](fe-exception-handling-plan.md) 0장). 안: `closed`·S4에 걸러졌다는 표시를 주거나, 앱도 같은 기준을 쓴다.
  3. FE: BE가 정한 기준을 앱에도 똑같이 쓴다. 측정 시간이 기준 미만이면 대기 기록을 남기지 않고(`useSessionPersistence` `buildRecord`, 지금은 `total_ms`가 0일 때만 거름) 결과 화면에 「1분 미만 측정은 기록에 남지 않아요」를 띄운다.

### 3순위: 휴대폰 기록

[휴대폰 계획](fe-mobile-records-plan.md)을 진행할 때 함께 할 것.

#### 요구 13. T1 일별 통계 API (BE-2)

- **한줄요약:** J2가 채운 `daily_stat`을 돌려주는 T1 API를 휴대폰 기록을 만들 때 만든다.
- **발단:** J2가 매일 00:10에 `daily_stat`을 채우지만, 이를 읽어 주는 API(컨트롤러)가 없다. 형식만 확정됐다.
- **원인:** 지금 앱은 기록·달력·기간 통계를 R1 기록으로 직접 계산한다(`recordsSource.ts`). 기록이 많아지면(휴대폰, [휴대폰 계획](fe-mobile-records-plan.md)) 매번 계산하기 어렵다.
- **요구사항/변경사항:** BE가 T1 `GET /stats/daily`를 만든다. 00:00~00:10에 어제가 아직 비어 있는 문제는 T1을 붙일 때 정한다([연동 명세](api-ws-spec.md) 「T1 데이터가 생기는 시각」).

## 1. 해야 할 일

FE(klaod-tech)가 직접 하는 일이다.

| # | 할 일 | 언제 |
|---|---|---|
| 1 | 탈퇴 때 이 기기 결과 지우기와 문의 안내 | 문의처가 정해지면 |
| 2 | 발표용 예시 기록·합성 시연 지우기 | 급하지 않음 |
| 3 | 시험 전용 로컬 로그인 지우기 | 할 일 2와 함께 |
| 4 | Cloudflare 요청 제한 좁히기 | 시연 전 |
| 5 | 정식 공개 때 검색 노출 막기 지우기 | 정식 공개 |

#### 할 일 1. 탈퇴 때 이 기기 결과 지우기와 문의 안내

- **한줄요약:** 탈퇴하면 이 기기에 남은 서버 확인 전 결과를 지우고, 탈퇴한 계정으로 들어오려 하면 문의처를 안내한다.
- **발단:** 서버 탈퇴(A7)는 지금 로그아웃만 한다([ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)). 탈퇴 철회 API는 없다: 옛 계정 API(v1)에 있던 철회(`POST /auth/withdrawal/cancel`)는 BE가 아키텍처 v5.2로 바꾸며 지웠고, 지금은 탈퇴한 계정 로그인이 403 `ACCOUNT_CLOSED`, 같은 이메일 재가입이 30일 동안 409다. 서버의 30일은 최종 삭제(Spark J3)까지의 유예일 뿐 복구 기간이 아니다.
- **원인:** 되살릴 방법이 없으니 이 기기에 그 계정의 결과를 남길 이유가 없다(남기면 개인정보만 남는다). 탈퇴를 되돌리고 싶은 사람은 앱 안에서 할 수 있는 것이 없어 사람에게 연락해야 한다.
- **요구사항/변경사항:**
  1. 탈퇴 성공 뒤 그 계정의 대기 기록 저장소(`features/storage/serverRecords.ts`, 키 `posegood.account.v3.{user_id}.pending-results`)를 지운다. 계정 화면 탈퇴 흐름에 넣는다.
  2. 탈퇴 확인 창과 로그인 403 `ACCOUNT_CLOSED` 안내(`accountClient.ts`)에 문의처를 넣는다. 예: 「탈퇴한 계정이에요. 되돌릴 수 없고 탈퇴 30일 뒤 삭제돼요. 도움이 필요하면 example@gmail.com으로 연락해 주세요.」 **문의처(이메일)는 정하기 전**이라 지금은 예시 `example@gmail.com`을 쓴다. 오류 화면의 「계속되면 알려 주세요」 문의처([frontend README](../../../frontend/README.md) 「오류 안내 페이지」)와 같은 주소로 한다.

#### 할 일 2. 발표용 예시 기록·합성 시연 지우기

- **한줄요약:** 서버 측정만 남았으니 발표용 예시 기록과 그 설정을 지운다.
- **발단:** 서버 연결 전 발표용으로 넣은 예시 기록이 아직 있다(11/11 develop 확인).
- **원인:** 기록은 이제 R1에서만 온다. 예시 기록 토글이 남아 있으면 실제 기록과 섞여 보일 수 있고, 쓰지 않는 코드가 기록 화면 로직을 복잡하게 만든다.
- **요구사항/변경사항:** `data/exampleRecords.ts`, 설정의 예시 기록 토글(`LocalServiceApp.tsx` `saveDemoPreference`, `KEYS.demo`), 합성 시연 `mode: 'demo'`, `features/testing/legacySyntheticRecord.ts`를 지운다. 자동 시험용 가짜 카메라는 남긴다. [frontend README](../../../frontend/README.md) 7번 줄도 고친다.

#### 할 일 3. 시험 전용 로컬 로그인 지우기

- **한줄요약:** 옛 화면 시험만 쓰는 「이 기기 로그인」 경로를 지운다.
- **발단:** 로그인은 항상 서버 계정인데, `ServiceApp.test.tsx`만 계정 클라이언트를 「없음」으로 바꿔 이 기기 로그인으로 돈다([계획 0054](../../plans/active/0054-pip-fix-and-server-only-login.md) 2단계).
- **원인:** 시험 때문에 실제 앱에는 없는 로그인 경로(`LocalServiceApp`의 계정 없음 분기, `KEYS.account`)가 코드에 남아 있다.
- **요구사항/변경사항:** `ServiceApp.test.tsx`를 가짜 계정 서버(`frontend/scripts/fake-server.mjs` 방식)로 바꾸고, `LocalServiceApp.tsx`의 이 기기 계정 읽기·쓰기와 `KEYS.account`를 지운다(`useProfileForm.ts`의 지우기 목록 포함).

#### 할 일 4. Cloudflare 요청 제한 좁히기

- **한줄요약:** 로그인·가입에만 요청 제한을 걸고, 평소 값과 시연 날 값을 정한다.
- **발단:** DevOps 질문(9.6.3 Q3).
- **원인:** `/api/v2/auth/*` 제한(같은 IP 10초 20번)에 로그인 유지(A8 refresh)도 걸린다. 학교 공인 IP 하나 뒤에서 여러 명이 쓰면 막힐 수 있다.
- **요구사항/변경사항:** klaod-tech의 Cloudflare 규칙 `auth-rate-limit`만 바꾼다. ① 대상을 `/api/v2/auth/login`·`/api/v2/auth/register`로 좁힘 ② 평소 값을 넉넉하게 ③ 시연 날 값을 따로. 서버·gateway는 할 일 없음.

#### 할 일 5. 정식 공개 때 검색 노출 막기 지우기

- **한줄요약:** 정식 공개 때 검색 차단 두 줄을 지운다.
- **발단:** 실제 연동 전까지 검색 결과에 안 나오게 넣었다(10/20, `72ab5ec`).
- **원인:** 접속이 아니라 검색 노출만 막는 설정이라, 공개하면 지워야 검색에 나온다.
- **요구사항/변경사항:** [robots.txt](../../../frontend/public/robots.txt)의 `Disallow: /`와 [vercel.json](../../../frontend/vercel.json)의 `X-Robots-Tag`를 지우고 포크를 최신화해 배포한다.

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

- **지금 안 하는 이유:** 서버가 00:00에 끊어야(local은 요구 7, kafka는 요구 2) 지울 수 있다. 그 전에 지우면 자정을 넘긴 측정의 오늘 화면이 틀어진다.
- **한줄요약:** 서버가 자정에 끊게 되면 앱의 날짜 나누기를 지운다.
- **발단:** 서버가 자정에 세션을 끊지 않아, 자정을 넘긴 측정(예: 22:50~02:00)을 앱이 날짜별로 나눠 보관한다(10/26 lellon0403 `ad7cd42`, [dailyMeasurement.ts](../../../frontend/src/features/storage/dailyMeasurement.ts), [ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)). 02:00은 끊는 시각이 아니라 팀 회의 예시다.
- **원인:** 서버가 자정에 끊으면 측정 하나가 하루 안에 있어 나눌 필요가 없다.
- **요구사항/변경사항:** 요구 7 뒤(kafka 모드는 요구 2 뒤)에 따로 계획을 세워 지운다(인계서 5번). 기록·달력 화면이 함께 바뀌어 화면 담당과 같이 한다.

**요청이 정해지면 FE가 할 몫:** 요구 4의 3단계(계약·앱에서 `ack` 정리), 요구 5의 1·4단계(계약 `maxItems 1`, 앱 새 형식), 요구 9의 앱 문구(`closed(rest_timeout)`), 요구 12의 3번(앱도 같은 기준으로 짧은 측정 거르기). [FE 예외 처리 방안](fe-exception-handling-plan.md) 4·5장의 FE 제안도 정해지면 여기에 옮긴다.

## 2. 지금 구조

기준: develop `97ac99a`(2026-11-11). kafka 경로는 `feat/ws-kafka-pipeline`에만 있고 운영은 local 경로다. 경위·지난 진행 기록은 git 기록에 있다(이 문서 2026-11-10 판 `b03fd15`).

```
브라우저 / 데스크톱 앱(Electron, 웹 주소를 엶)
  ├─ https://app.posegood.site                 Vercel: 화면 파일만 (포크 develop)
  └─ https://api.posegood.site/api/v2/…        Cloudflare 터널 → gateway(nginx) → io-api
     wss://api.posegood.site/api/v2/realtime   같은 경로 (측정 WebSocket)

io-api(backend/api) ─ MySQL(계정·설정·기준 자세·세션·사건·기록)
   │  local(운영): 좌표 → 특징 계산 → 추론(POST /v2/infer) → 판정 → MySQL → 앱
   │  kafka(브랜치): 좌표 → 특징 → Kafka → 추론 → 판정·저장(처리 서비스) → Kafka → io-api → 앱
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
| 서버 확인 전 측정 결과 | localStorage 계정별 키 `posegood.account.v3.{user_id}.pending-results` | R1에서 확인되면 |
| 데스크톱 설정(시작 프로그램·알림 팝업·자동 카메라) | `userData/desktop-settings.json` | — |

기준 자세·판정 기준·기록은 이 기기에 두지 않고 서버에서 받는다.

**연결 설정** (`features/platform/serverConfig.ts`)

| 변수 | 뜻 |
|---|---|
| `VITE_API_BASE_URL` | API 주소. 운영 `https://api.posegood.site`(Vercel Production에 설정). 비우면 같은 출처 `/api`. WS 주소도 여기서 만든다(`https:`면 `wss:`) |
| `POSEGOOD_API_URL` | 개발 서버의 `/api` 중계 대상. 기본 `http://127.0.0.1:8090` |
| `POSEGOOD_APP_URL` | 데스크톱 앱이 열 웹 주소. 기본 `https://app.posegood.site/` |

**데스크톱 앱** (`frontend/electron/`, 시각 규칙 [DESIGN.md](../../../DESIGN.md))

| 파일 | 역할 |
|---|---|
| `main.cjs` | 창 생성, 단일 실행, 외부 주소 차단(`sameAddress`), 시작 프로그램 등록, 설정 파일. 설치용은 웹 주소를 열고 10초 안에 못 열면 앱에 든 연결 실패 화면(`public/offline.html`), 10초마다 다시 시도. 측정 중 닫기는 「측정 중이에요. 정말 닫을까요?」(`will-prevent-unload`) |
| `preload.cjs` | 페이지에 `window.posegoodDesktop`(시작 정보, 시작 프로그램, 자동 카메라, 알림 팝업, 작은 카메라 창)만 노출 |
| `camera-window.cjs` | 작은 카메라 창: 앱 창이 가려지거나 최소화되면 오른쪽 아래에 저절로 보이고, 앞으로 오면 숨는다. 버튼은 접기·앱으로 돌아가기·X(측정 중이면 종료·저장) |
| `popup-preload.cjs` | 앱 밖 알림 팝업(`app://posegood/alert-popup.html`, 서버 없이도 뜸)에 문구·닫기·앱 열기만 노출. 앱 창이 가려졌을 때만 뜨고 8초 뒤 숨는다 |
| `launch-dev.mjs` | 개발 실행: 개발 서버 → 창 → 종료 때 서버 정리 |

보안: IPC는 앱 창이 연 화면 주소에서 온 요청만 받는다. `nodeIntegration` 끔, `contextIsolation`·`sandbox` 켬. 실행 명령은 [frontend README](../../../frontend/README.md).

### 2.2 서버 구조

| 서버 | 코드 | 하는 일 |
|---|---|---|
| **io-api** (입출구 서버) | `backend/api` | 로그인(JWT access 30분·refresh 14일, [ADR 0031](../../decisions/0031-jwt-access-refresh-login.md)), REST(A·C·W·B·S·R), 측정 WebSocket `/realtime`. 앱이 통신하는 곳은 여기 하나다 |
| 추론 | `backend/inference` | local: io-api가 `POST /v2/infer`로 부른다. kafka: `posture.features.v1`을 읽어 결과를 낸다. 점수는 지금 규칙 점수(`reference-feature-rule-v1`) |
| 처리 서비스 | `backend/processing` | kafka 경로에서 판정(`V1SessionJudge`)과 저장. local에는 쓰이지 않는다 |
| gateway | `infra/nginx`, compose `gateway` | 터널로 들어온 요청 중 `/api/`·`/api/v2/realtime`·`/health`만 io-api로. `X-Forwarded-Proto https` 고정. 화면 파일은 내지 않는다 |
| web(8088) | compose `web` | 서버 PC 안 시험용 화면+API(SSH 포워딩) |

**측정 한 번 (local, 운영)**

1. 앱이 S1으로 세션을 만들고 WS `hello`(access 토큰) → `ready`.
2. 앱이 프레임마다 `features`를 보낸다. io-api가 좌표에서 기준 자세 대비 특징 변화량을 계산 → 추론 → 판정 엔진(3초 확정·회복·60초 재알림, 시간은 앱이 찍은 구간 시각으로) → MySQL.
3. 구간마다 `observation`·(`decision`·`alert`)·`ack`·`progress`를 같은 연결로 보낸다.
4. `end` → `decision(session_ended)` → `closed(ended)`. 연결이 끊기면 마지막으로 받은 구간 끝에서 서버가 끝내 저장한다. 재연결은 없다([ADR 0024](../../decisions/0024-session-ends-on-lost-connection.md)).
5. 판정 불가·자리 비움이 30분 이어지면 서버가 끝낸다(`unmeasurable_timeout`). 자정 넘김(`session_rollover`)은 구현돼 있지만 운영 설정은 꺼져 있다(요구 7).

**kafka 경로 (D-57, 브랜치)**: 앱 쪽 계약은 같다. 판정·저장이 처리 서비스로 옮겨 가고, `closed`는 DB 저장이 끝난 뒤 온다(D-67). 다른 점과 남은 일은 [FE 예외 처리 방안](fe-exception-handling-plan.md)과 요구 1~5.

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
| `daily_stat` | 일별 통계(Spark J2가 씀) | 아직 안 씀(T1 없음, 요구 13) |
| `social_identity`, `password_reset_token` | 소셜 로그인 연결, 비밀번호 재설정 토큰(V2.7, PR #113·#114) | 계정 찾기(작업 중) |

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
