# FE 제안서: 서버 판정 이전과 연동

> 작성자: klaod-tech(FE) · 작성: 2026-10-11
> **대상:** 팀 전원 — 팀장(Jeon-Seho), DB·BE(김유진, GitHub `sunshine-yj`), DevOps(홍규, `ghdrb1246`), ML(지성, `jisung`), 화면(`lellon0403`). FE는 `klaod-tech`다.
> **이 문서의 역할:** FE가 해야 할 일(0장), 다른 파트에 요청·질문(1장), 지금 FE·서버·DB·배포 구조(2장), FE가 정한 앱 동작(3장). 앱이 언제 무엇을 보내고 받는지와 API 상세는 [연동 명세](api-ws-spec.md), 기능별 동작은 [FE 기능 명세](fe-feature-spec.md), 필드 규칙은 [BE API 명세](../api-spec.md), 결정의 근거는 ADR([0021](../../decisions/0021-app-sends-information-server-judges.md)·[0024](../../decisions/0024-session-ends-on-lost-connection.md)·[0027](../../decisions/0027-today-records-from-collected-server-results.md)·[0029](../../decisions/0029-midnight-cut-and-server-time.md))이다.
> **코드 읽는 법:** A·W·B·S·R·T·C + 숫자(예: S1, B2)는 서버 API([연동 명세](api-ws-spec.md) 3장). 할 일 N은 FE가 할 일(0장), 요구 N은 다른 파트에 요청(1장). BE-2·BE-13~BE-20은 남은 BE 요청(1장), F14는 데스크톱 앱 웹 주소(할 일 1). D-nn·T-nn은 BE·DevOps 작업 번호, J1·J2·J3은 서버의 Spark 배치다.

## 0. 해야 할 일

기준: develop `97ac99a`(PR #114까지)와 `feat/ws-kafka-pipeline` `ffdd37e`, 2026-11-11 코드로 확인. FE가 할 일(0장)과 FE가 다른 파트에 요청·확인해야 하는 것(1장)만 남긴다. 끝난 것은 지우고(경위는 git 기록, 옛 판 `b03fd15`), 다른 파트 안의 일(아키텍처 문서, 좌표 보관 결정, 운영 배포 규칙, BE 내부 시험)은 적지 않는다.

순위는 두 장에 걸쳐 다섯 단계다: 1순위 Kafka 모드 관련(1장), 2순위 FE가 할 것(0장), 3순위 BE·DevOps가 정할 것(1장), 4순위 휴대폰 기록(1장), 5순위 배포 직전(0장). 같은 순위 안에서는 먼저 할 것부터 적는다. 항목마다 **한줄요약 · 발단**(어떻게 나온 이야기인가) **· 원인**(왜 문제인가) **· 요구사항/변경사항**(무엇을 어떻게, 어디를) 순서로 적는다.

FE(klaod-tech)가 직접 하는 일이다. 다른 파트와 함께 하는 것은 「함께」 칸에 적었다.

| 순위 | 묶음 | # | 할 일 | 함께 | 언제 |
|---|---|---|---|---|---|
| 2 | FE가 할 것 | 1 | 데스크톱 앱(F14) 배포 | - | 지금 |
|  |  | 2 | 서버 탈퇴 때 이 기기 결과도 지우기 | - | 정할 것 |
|  |  | 3 | 발표용 예시 기록·합성 시연 지우기 | - | 급하지 않음 |
|  |  | 4 | 시험 전용 로컬 로그인 지우기 | - | 할 일 3과 함께 |
|  |  | 5 | 측정 화면에 실제 카메라 크기 표시 (F13) | 화면(lellon0403) | 정할 것 |
|  |  | 6 | 자정 점검 시나리오 다시 정하기 | - | 요구 7 뒤 |
|  |  | 7 | 앱 날짜 나누기 정리 | 화면(lellon0403) | 요구 7 뒤 |
| 5 | 배포 직전 | 8 | Cloudflare 요청 제한 좁히기 | - | 시연 전 |
|  |  | 9 | 정식 공개 때 검색 노출 막기 지우기 | - | 정식 공개 |

### 2순위: FE가 할 것

FE가 직접 고치거나 배포할 것. 할 일 6·7은 운영 자정 넘김(요구 7) 뒤.

#### 할 일 1. 데스크톱 앱(F14) 배포

- **한줄요약:** 웹 주소를 여는 설치용 앱을 새로 빌드해 배포한다.
- **발단:** 설치용 앱이 `https://app.posegood.site`를 열어 자동 로그인되게 하는 코드가 develop에 들어갔다(PR #106·#107). 운영 웹(포크 `faff869`)도 최신이다.
- **원인:** 지금 배포본은 `app://posegood`에서 열려 refresh 쿠키가 실리지 않아 로그인 유지가 안 된다.
- **요구사항/변경사항:** 패키징 점검 스크립트(`smoke-desktop.mjs`·`smoke-packaged-ui.mjs`·`smoke-developer-page.mjs`)가 아직 `app://posegood/`를 찾으므로 고친 뒤, 앱을 빌드·배포한다. 실제 계정으로 로그인 → 앱 종료 → 다시 켜기를 확인한다.

#### 할 일 2. 서버 탈퇴 때 이 기기 결과도 지우기

- **한줄요약:** 탈퇴하면 이 기기에 남은 서버 확인 전 결과도 지운다.
- **발단:** 서버 탈퇴(A7)는 지금 로그아웃만 한다([ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)).
- **원인:** 탈퇴한 계정의 측정 결과가 기기에 남는다.
- **요구사항/변경사항:** 탈퇴 성공 뒤 그 계정의 대기 기록 저장소(`features/storage/serverRecords.ts`)를 지운다. 계정 화면 탈퇴 흐름에 넣는다.

#### 할 일 3. 발표용 예시 기록·합성 시연 지우기

- **한줄요약:** 서버 측정만 남았으니 발표용 예시 기록과 그 설정을 지운다.
- **발단:** 서버 연결 전 발표용으로 넣은 예시 기록이 아직 있다(11/11 develop 확인).
- **원인:** 기록은 이제 R1에서만 온다. 예시 기록 토글이 남아 있으면 실제 기록과 섞여 보일 수 있고, 쓰지 않는 코드가 기록 화면 로직을 복잡하게 만든다.
- **요구사항/변경사항:** `data/exampleRecords.ts`, 설정의 예시 기록 토글(`LocalServiceApp.tsx` `saveDemoPreference`, `KEYS.demo`), 합성 시연 `mode: 'demo'`, `features/testing/legacySyntheticRecord.ts`를 지운다. 자동 시험용 가짜 카메라는 남긴다. [frontend README](../../../frontend/README.md) 7번 줄도 고친다.

#### 할 일 4. 시험 전용 로컬 로그인 지우기

- **한줄요약:** 옛 화면 시험만 쓰는 「이 기기 로그인」 경로를 지운다.
- **발단:** 로그인은 항상 서버 계정인데, `ServiceApp.test.tsx`만 계정 클라이언트를 「없음」으로 바꿔 이 기기 로그인으로 돈다([계획 0054](../../plans/active/0054-pip-fix-and-server-only-login.md) 2단계).
- **원인:** 시험 때문에 실제 앱에는 없는 로그인 경로(`LocalServiceApp`의 계정 없음 분기, `KEYS.account`)가 코드에 남아 있다.
- **요구사항/변경사항:** `ServiceApp.test.tsx`를 가짜 계정 서버(`frontend/scripts/fake-server.mjs` 방식)로 바꾸고, `LocalServiceApp.tsx`의 이 기기 계정 읽기·쓰기와 `KEYS.account`를 지운다(`useProfileForm.ts`의 지우기 목록 포함).

#### 할 일 5. 측정 화면에 실제 카메라 크기 표시 (F13)

- **한줄요약:** 측정 화면 위에 실제 카메라 크기(예: 640×480)를 작게 보인다.
- **발단:** 영상 크기를 640×480으로 고정하기로 했고(팀 결정, DB V2.3), 다른 크기여도 시작은 막지 않기로 했다(10/19).
- **원인:** 다른 크기로 측정되면 사용자도 팀도 알 방법이 없다. 앱은 크기가 바뀌는 것만 감지해 종료한다(`useLiveSession.ts`).
- **요구사항/변경사항:** 표시 위치·모양을 화면 담당(lellon0403)과 정한 뒤, `video.videoWidth`·`videoHeight`를 측정 화면에 보인다. 서버에는 보내지 않는다.

#### 할 일 6. 자정 점검 시나리오 다시 정하기

- **한줄요약:** 자정 점검을 「세션이 둘로 나뉨」 흐름으로 바꾼다.
- **발단:** 팀장 10/30 인계서 4번.
- **원인:** 지금 점검은 「자정에도 같은 세션 유지」 전제라, 요구 7로 자정 넘김을 켜면 실제 동작과 다르다.
- **요구사항/변경사항:** 요구 7 뒤에 [midnight.mjs](../../../tools/browser/midnight.mjs)와 [frontend README](../../../frontend/README.md) 자정 측정 절을 함께 고친다.

#### 할 일 7. 앱 날짜 나누기 정리

- **한줄요약:** 서버가 자정에 끊게 되면 앱의 날짜 나누기를 지운다.
- **발단:** 자정을 넘긴 측정을 앱이 날짜별로 나눠 보관한다([dailyMeasurement.ts](../../../frontend/src/features/storage/dailyMeasurement.ts), [ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)).
- **원인:** 서버가 자정에 끊으면 측정 하나가 하루 안에 있어 나눌 필요가 없다.
- **요구사항/변경사항:** 요구 7 뒤(kafka 모드는 요구 2 뒤)에 따로 계획을 세워 지운다(인계서 5번). 기록·달력 화면이 함께 바뀌어 화면 담당과 같이 한다.

### 5순위: 배포 직전

정식 공개·시연 직전에 Cloudflare·Vercel 설정으로 할 것. 둘 다 klaod-tech 계정의 설정이다.

#### 할 일 8. Cloudflare 요청 제한 좁히기

- **한줄요약:** 로그인·가입에만 요청 제한을 걸고, 평소 값과 시연 날 값을 정한다.
- **발단:** DevOps 질문(9.6.3 Q3).
- **원인:** `/api/v2/auth/*` 제한(같은 IP 10초 20번)에 로그인 유지(A8 refresh)도 걸린다. 학교 공인 IP 하나 뒤에서 여러 명이 쓰면 막힐 수 있다.
- **요구사항/변경사항:** klaod-tech의 Cloudflare 규칙 `auth-rate-limit`만 바꾼다. ① 대상을 `/api/v2/auth/login`·`/api/v2/auth/register`로 좁힘 ② 평소 값을 넉넉하게 ③ 시연 날 값을 따로. 서버·gateway는 할 일 없음.

#### 할 일 9. 정식 공개 때 검색 노출 막기 지우기

- **한줄요약:** 정식 공개 때 검색 차단 두 줄을 지운다.
- **발단:** 실제 연동 전까지 검색 결과에 안 나오게 넣었다(10/20, `72ab5ec`).
- **원인:** 접속이 아니라 검색 노출만 막는 설정이라, 공개하면 지워야 검색에 나온다.
- **요구사항/변경사항:** [robots.txt](../../../frontend/public/robots.txt)의 `Disallow: /`와 [vercel.json](../../../frontend/vercel.json)의 `X-Robots-Tag`를 지우고 포크를 최신화해 배포한다.

**요청이 정해지면 FE가 할 몫:** 요구 4의 3단계(계약·앱에서 `ack` 정리), 요구 5의 1·4단계(계약 `maxItems 1`, 앱 새 형식), 요구 9의 앱 문구(`closed(rest_timeout)`). [측정 종료 계획](fe-measure-end-plan.md) 4·5장의 FE 제안도 정해지면 여기에 옮긴다.

## 1. 남은 질문과 요청

다른 파트(BE·DevOps·ML·PM)에 요청하거나 함께 정할 것이다. FE 몫이 있으면 요구 안에 적었다.

| 순위 | 묶음 | # | 요구 | 누가 | 언제 |
|---|---|---|---|---|---|
| 1 | Kafka 모드(D-57)와 관련된 것 | 1 | Kafka 경로 서버 상태를 쿠버네티스가 알게 하기 (BE-14~17) | BE·DevOps·PM | kafka 모드를 운영에 켜기 전 / 쿠버네티스로 옮길 때 |
|  |  | 2 | kafka 모드도 KST 00:00에 측정 끊기 (BE-18) | PM·DevOps·BE | kafka 모드를 운영에 켜기 전 |
|  |  | 3 | Kafka 전환 때 판정 순서 확인 | BE·DevOps·PM | Kafka 전환 시험 |
|  |  | 4 | 실시간 `ack` 메시지 빼기 (BE-19) | BE·PM·DevOps·FE | 급하지 않음. kafka 모드 병합(D-57) 때 함께 |
|  |  | 5 | `features` 메시지에서 묶음 단계(`items[]`·`frames[]`) 빼기 (BE-20) | FE·BE·DevOps | 급하지 않음. 요구 4와 같은 계약 판에 |
| 3 | BE·DevOps가 정할 것 | 6 | 짧은 끊김 봐주기(`hold_ms`) 규칙 정하기 | BE·ML·FE | 정할 것 |
|  |  | 7 | 운영 서버 자정 넘김 켜기 | DevOps | 이 FE 배포 뒤 |
|  |  | 8 | S1 뒤 WS가 안 열린 세션 닫기 | BE·FE | 정할 것 |
|  |  | 9 | 쉬기 자동 종료 (BE-13) | BE | 정할 것 |
| 4 | 휴대폰 기록 | 10 | T1 일별 통계 API (BE-2) | BE | 휴대폰 기록을 만들 때 |

### 1순위: Kafka 모드(D-57)와 관련된 것

D-57을 병합하거나 kafka 모드를 운영에 켜기 전에 정하거나 고칠 것.

#### 요구 1. Kafka 경로 서버 상태를 쿠버네티스가 알게 하기 (BE-14~17)

- **한줄요약:** 「살아 있다면서 Kafka 일은 안 하는」 서버를 쿠버네티스가 재시작할 수 있게 각 서버 health를 고친다.
- **발단:** D-57 통신 시험 보고서를 검수하며 Kafka 경로 장애 때 앱 대응을 kafka 브랜치 코드와 맞춰 봤다. 장애 대부분은 정해져 있다: 서비스·Kafka가 죽으면 쿠버네티스가 다시 띄우고(BE 답), 기록은 Kafka가 들고 있다가 처리되며 Hadoop에도 남는다. 그보다 큰 장애는 FE가 대비하지 않는다(11/11 결정). 시작 때 Kafka가 죽어 있으면 앱이 오류 화면(500 그림)으로 막는다([측정 종료 계획](fe-measure-end-plan.md) 2.4). 그런데 **프로세스는 살아 있어 health 200인데 Kafka 일은 안 하는 상태**가 있었다.
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

#### 요구 2. kafka 모드도 KST 00:00에 측정 끊기 (BE-18)

- **한줄요약:** kafka 모드는 지금 자정에 끊지 않으니, 먼저 「자정에 끝내기」(`closed(day_changed)`)를 넣는다.
- **발단:** BE 11/11 S4 공지를 받고 kafka 브랜치 WS 코드를 ADR과 대조했다. [ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)에는 「Kafka 모드도 같은 규칙」이라고 되어 있는데, 코드는 `RealtimeHandlerV2` 생성자가 `midnightRollover && pipeline.local()`이라 **설정을 켜도 kafka 모드에서는 무시**된다.
- **원인:** kafka는 판정이 처리 서비스에 있어서, 자정에 이전 세션 요약을 즉시 꺼내 `session_rollover`에 실을 수 없다(FE가 코드로 추정). 끊지 않으면 22:50~02:00 측정이 이렇게 된다:
  - 00:10 J2: 아직 진행 중이라 어제 통계에서 빠짐
  - R1 확인 뒤: 서버 기록에는 날짜 나누기가 없어 **190분 전부 어제**, 앱 오늘 화면의 120분이 사라짐
  - 다음 날 00:10: 7일 다시 계산이 어제에 190분을 넣음
- **요구사항/변경사항:** 두 방식 모두 00:00에 끊고, J2는 그 뒤 00:10에 돈다([bigdata/README.md](../../../bigdata/README.md)). 고른 안으로 ADR 0029의 BE 줄을 고친다. kafka 모드를 운영에 켜기 전에 D-57 회의에서 고른다.

  | 안 | 서버 일 | 앱 일 | 사용자 |
  |---|---|---|---|
  | **자정에 끝내기 (FE 추천, 먼저)**: 00:00에 서버가 `end`를 대신 부르고 사유 `day_changed`. kafka 종료 경로(저장 뒤 `closed`)를 그대로 탐 | 작음. 자정 감지(`cutMs`, 00:00:30 `midnight()`)를 kafka에서도 켬 | **없음.** 「자정이 지나 측정을 마쳤어요…」 문구와 처리가 있음 | 자정에 한 번 다시 시작 |
  | kafka 자정 넘김 (나중에): 이전 세션 결과가 다 올 때까지 기다렸다 `session_rollover` | 큼 | 없음 | 끊김 없이 날짜만 나뉨 |
  | 끊지 않음 (비추천): ADR 0029를 고침 | 없음 | 서버 기록도 날짜를 나눠야 함 | 오늘 기록이 사라짐 |

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

  프레임 없는 구간(쉬기·자리 비움·빈 구간)은 `t_ms`·`p`를 빼고, 판정 불가는 지금처럼 `valid: false`. 판 번호는 `hello`에서 한 번 정한다. 요구 4와 같은 계약 판에, kafka 병합 뒤에 순서대로 한다.
  1. FE(지금 해도 됨): 계약 `features.items`를 `maxItems 1`로 서버와 맞춘다.
  2. BE: 서버가 옛·새 형식을 다 받게 하고(`hello` 판 번호로), 특징 계산을 프레임 1장 기준으로 바꾼다.
  3. DevOps: 통합 시험을 새 형식으로.
  4. FE: 앱(`frames.ts` `FrameBatch`, `LiveSession.ts` `send`)을 새 형식으로 배포.
  5. BE: 옛 형식 받기를 지운다.

  kafka `posture.features.v1`과 추론 `POST /v2/infer`는 바뀌지 않는다(서버가 계산한 특징 변화량을 보냄).

### 3순위: BE·DevOps가 정할 것

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

#### 요구 8. S1 뒤 WS가 안 열린 세션 닫기

- **한줄요약:** S1은 됐는데 측정 연결이 안 열린 세션을 누가 닫을지 BE와 정한다.
- **발단:** 10/22 질문을 서버 코드로 다시 보니 이 세션이 닫히지 않는다.
- **원인:** 서버는 메모리에서만 6시간 뒤 뺀다([LiveSessions.java](../../../backend/api/src/main/java/org/posegood/api/session/LiveSessions.java) `evict`). DB 행은 `ended_at` NULL로 남아 J1·J2·기록 목록에 영향을 준다.
- **요구사항/변경사항:** 앱이 이때만 S3를 부를지(`LiveSession.start`의 연결 실패), 서버가 정리하면서 행도 닫을지 정한다. BE 상태 문서 4장 미결과 같은 질문([연동 명세](api-ws-spec.md) 4장 S3·S4 「남는 틈」).

#### 요구 9. 쉬기 자동 종료 (BE-13)

- **한줄요약:** 쉬기가 30분 이어지면 서버가 측정을 끝내고 저장한다.
- **발단:** 10/20 계획은 「일시정지가 10분 이어지면 끝내고 저장」인데 서버·앱 모두 구현이 없다.
- **원인:** 쉬기를 누르고 자리를 떠나면 측정이 끝없이 열려 있다. 앱은 시간을 세지 않는다([ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)). 서버에는 판정 불가·자리 비움 30분(`unmeasurable_timeout`)만 있다.
- **요구사항/변경사항:** **FE 의견:** `unmeasurable_timeout`과 같은 방식으로 서버가 쉬기(`rest`) 시간을 세어 30분이면 끝내고 새 사유(안: `closed(rest_timeout)`)를 보낸다. local 엔진과 kafka 결과 구독(`KafkaResults`의 측정불가 세기) 모두. 앱은 새 사유 문구만 더한다(`LiveSession.ts` `CLOSED`).

### 4순위: 휴대폰 기록

[휴대폰 계획](fe-mobile-records-plan.md)을 진행할 때 함께 할 것.

#### 요구 10. T1 일별 통계 API (BE-2)

- **한줄요약:** J2가 채운 `daily_stat`을 돌려주는 T1 API를 휴대폰 기록을 만들 때 만든다.
- **발단:** J2가 매일 00:10에 `daily_stat`을 채우지만, 이를 읽어 주는 API(컨트롤러)가 없다. 형식만 확정됐다.
- **원인:** 지금 앱은 기록·달력·기간 통계를 R1 기록으로 직접 계산한다(`recordsSource.ts`). 기록이 많아지면(휴대폰, [휴대폰 계획](fe-mobile-records-plan.md)) 매번 계산하기 어렵다.
- **요구사항/변경사항:** BE가 T1 `GET /v2/stats/daily`를 만든다. 00:00~00:10에 어제가 아직 비어 있는 문제는 T1을 붙일 때 정한다([연동 명세](api-ws-spec.md) 「T1 데이터가 생기는 시각」).

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
| 데스크톱(Electron, `frontend/electron/`) | 설치용은 웹 주소를 연다(F14, PR #106·#107 — 새 설치 파일 배포 전, 할 일 1). 개발 실행은 로컬 개발 서버 | 작은 카메라 창, 앱 밖 알림 팝업, 시작 프로그램, 측정 중 닫기 확인 |

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
| **io-api** (입출구 서버) | `backend/api` | 로그인(JWT access 30분·refresh 14일, [ADR 0031](../../decisions/0031-jwt-access-refresh-login.md)), REST(A·C·W·B·S·R), 측정 WebSocket `/v2/realtime`. 앱이 통신하는 곳은 여기 하나다 |
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

**kafka 경로 (D-57, 브랜치)**: 앱 쪽 계약은 같다. 판정·저장이 처리 서비스로 옮겨 가고, `closed`는 DB 저장이 끝난 뒤 온다(D-67). 다른 점과 남은 일은 [측정 종료 계획](fe-measure-end-plan.md)과 요구 1~5.

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
| `daily_stat` | 일별 통계(Spark J2가 씀) | 아직 안 씀(T1 없음, 요구 10) |
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
| Cloudflare 보안 | 요청 제한 `auth-rate-limit`(`/api/v2/auth/*`, 같은 IP 10초 20번 → 10초 차단, 할 일 8에서 좁힘). Bot Fight Mode 끔(API 요청에 사람 확인이 끼면 깨짐) |
| 검색 노출 | 막아 둠(`robots.txt`, `X-Robots-Tag`) — 정식 공개 때 지움(할 일 9) |
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
| 영상 크기 | 640×480을 요청하고 서버에 보내지 않는다. 다른 크기여도 시작은 막지 않고, 측정 중 크기가 바뀌면 종료·저장 |
| 카메라 | 측정하기에서 메인 카메라를 고른다. 기준 자세는 카메라와 상관없이 하나. 쓰던 카메라가 빠지면 종료·저장 |
| 자세 등록 | 앱이 관절 9개 3초 평균을 B1로 보낸다. 이 기기에 저장하지 않는다 |
| 끊김 | 재연결·재전송 없음. 끊기면 측정을 끝내고 서버가 끊긴 곳까지 저장([ADR 0024](../../decisions/0024-session-ends-on-lost-connection.md)) |
| 측정 종료 | 결과가 올 때까지 「저장하고 있어요」 창으로 막고, 5초 안에 없으면 결과 화면에서 알린다([측정 종료 계획](fe-measure-end-plan.md)) |
| 모델명·버전 | 화면에 보이지 않는다(API 필드는 그대로) |
| 5분 미만 세션 | 저장하고 기록·통계에 넣는다. 「붕괴까지 걸린 시간」 최소·최대에서만 뺀다(DB V2.3) |
| 탈퇴 | 되돌릴 수 없다. 30일 뒤 최종 삭제(J3). 문구는 [연동 명세](api-ws-spec.md) 2장 |

## 4. 판정 규칙과 시험 데이터

판정 규칙(판정 가능 검사, 특징값, 고개 돌림, 점수, 복귀 대기, 판정 불가 시간)은 서버가 구현하고 BE·ML이 정한다. 원문은 이 파일의 git 기록 `d69b22c`.

- [합성 시험 데이터](../../../contracts/examples/frames/reference-rule-cases.json): 좌표 → 기대 결과(프레임 17·시간 순서 4·보정 1). 서버가 같은 결과를 내는지 확인용이다. 다시 만드는 것은 서버 쪽 몫이다.
