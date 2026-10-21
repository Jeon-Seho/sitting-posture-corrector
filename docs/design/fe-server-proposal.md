# FE 제안서: 서버 판정 이전과 연동

> 작성자: klaod-tech(FE) · 작성: 2026-10-11 · 최신화: 2026-10-22(문서 정리: 앱이 보내고 받는 것의 상세를 [연동 명세](api-ws-spec.md)으로 옮기고, 데스크톱 구조를 [배포](fe-deploy.md)에서 8.4로 옮김. 7.2에 바뀐 곳 기록) · FE · 대상: DevOps/BE(홍규), DB(유진), ML(지성), 화면(lellon0403)
> **이 문서의 역할:** FE의 **전제·결정 요약, 남은 질문, 할 일, 지금 앱 상태**. 앱이 언제 무엇을 보내고 받는지는 [연동 명세](api-ws-spec.md), 필드·본문은 [BE API 명세](api-spec.md), 결정의 근거는 ADR([0021](../decisions/0021-app-sends-information-server-judges.md)·[0024](../decisions/0024-session-ends-on-lost-connection.md)·[0025](../decisions/0025-app-always-measures-on-server.md)·[0026](../decisions/0026-baseline-average-by-app-b1.md)), 실행 계획은 [계획 0023](../plans/active/0023-frontend-server-only.md), 명령은 [FE 작업 명령과 검사](fe-commands-and-checks.md), 배포는 [배포](fe-deploy.md)다.
> 지금 FE 브랜치: `feature/frontend-features-and-integrationV3`(서버 전용, 10/21). 서버 코드 기준은 이 브랜치에 받은 BE 브랜치 `d87d497`(10/21).

## 1. 남은 질문과 요청

남은 질문은 없다(10/22). 공개 배포의 HTTPS는 도메인 + Cloudflare 이름 있는 터널로 정했다([배포](fe-deploy.md), 10/19~20). 10/16~19의 BE 확인 기록은 git 이력(`dc2c5d4` 이 문서 1장)에 있다.
최대 측정 시간은 아직 정하지 않았다(지금 기본 5,000초). 앱은 `closed(limit_reached)`만 처리하므로 값이 정해져도 바꿀 것이 없다.

BE가 진행 중인 것(합의대로, 확인만):

| # | 내용 | 시점 |
|---|---|---|
| B-1 | ~~`/v2/realtime`과 `closed(limit_reached)`~~ 10/17 구현됨. 남은 것: `POST /v2/records`·S2(앱이 부르지 않음)를 v1과 함께 정리, BE 동의 문서(`contracts/consent-documents.v2.md`) `POSE_COORDINATES`의 「측정 중에는 기준 대비 특징 변화량」을 v2(좌표 프레임 전송)에 맞춘 문구로 | v1 정리 때(앱 v2 전환 뒤) |
| B-2 | R1b `GET /v2/records/{id}`(없으면 S4로 대신), T1 `GET /v2/stats/daily` | 연동 명세 4장 R1·R1b·T1 |
| B-3 | **로그인·가입 `/v2/auth` 연결(F12)과 함께 W1 `GET /v2/workspace`도 붙여 주기.** S1은 `policy`가 계정에 저장된 판정 기준과 같아야 받는다(다르면 409 `CONFLICT`). 그 값은 W1 `rules`에서 온다. 로그인이 끝나면 `setServerAuth({ userId, csrfToken })`(`features/platform/serverAuth.ts`)를 불러 앱의 B1·B2·S1이 계정 정보를 쓰게 한다(10/21) | F12와 같이 |

서버·모델 내부의 정할 것(0.5초 구간 점수 합치기, 자세 유형을 낼지, 짧은 끊김을 같은 사건으로 이어 볼 시간 `EVENT_BREAK_SEC`)은 BE·ML·DevOps가 정한다. 앱은 서버가 보낸 결과를 그대로 보이므로 어느 쪽이든 영향이 없다.
일별 집계는 **매일 00:00**에 돈다(10/14 확정, 아키텍처 v5.2의 J2).

## 2. 전제와 현재 구조

1. **판정은 서버가 한다.** 점수·상태·유형·판정 가능 여부·고개 돌림·복귀 대기는 서버(추론·판정)가 만든다.
   측정 앱은 판정하지 않고 판정 결과를 라벨로 붙이지 않는다. 서버 없이 쓰는 로컬 모드는 10/21 지웠다(ADR 0021·0025).
   학습용 정답 라벨은 **학습용 수집 화면**(다른 담당)에서 참여자에게 준 과제와 참여자의 자기 보고로 정해진다(ML 답 10/14). 필요한 라벨 열과 형식은 ML이 수집 화면 담당에게 요청한다.
   예외: 사용자 위치를 판별할 수 없는 순간(어깨선이 안 보이는 등)은 앱이 "판정 불가"로 표시해 보낸다([연동 명세](api-ws-spec.md) 5.2).
2. **앱은 입출구 서버 하나와만 통신한다**(아키텍처 v5, 10/11). 입출구 서버(`auth`·`api`·`ws`)는 BE가 만든다. FE는 앱 쪽 연결과 API 명세를 함께 쓴다.
3. **좌표 수집 동의는 가입의 필수 조건이다.** 로컬 모드가 없어 동의 없이는 측정할 수 없다. 실제 서비스에서는 학습용 데이터를 받지 않는다([동의 제안서](consent-proposal.md)).
4. **통계는 전부 백엔드가 계산한다.** 측정 결과·기록·대시보드의 숫자(유효 측정 시간, 바른 자세 비율, 이탈 수, 간격, 회복 시간 등)는 서버가 계산해 보내고, 앱은 받아서 표시만 한다.
   - **오늘 측정은 방금 끝난 세션의 결과로만 보인다(10/13 결정).** 예: 12시에 3시간, 6시에 2시간을 측정했으면 6시 측정이 끝났을 때 결과 화면에는 그 2시간만 반영한다. 앞서 한 측정과 합치지 않는다.
   - **기록 화면: 목록에는 오늘 끝난 세션도 하나씩 보이고, 합산·그래프 같은 통계는 어제까지만 그린다(10/14 결정, DevOps 검토 C5).** 그날 합산은 24시(KST)가 지난 뒤 일별 집계가 만든 값을 쓴다(일별 집계는 매일 00:00, 10/14 확정).
   - **5분 미만 세션(10/14 정정).** 5분(`STAT_MIN_SESSION_SEC`) 미만 세션도 저장하고 기록 목록·일별 통계에 넣는다. "붕괴까지 걸린 시간" 최소·최대에서만 뺀다(DB V2.3, 10/14 정정). 처음에 "저장하지 않는다"로 적은 것은 회의 내용을 잘못 이해한 것이다.

FE가 정한 것(앱 쪽 동작):

| 항목 | 결정 |
|---|---|
| 민감도 | 화면 3단계(느긋하게 0.80 · 보통 0.70 · 꼼꼼하게 0.60)와 세밀 조정(0.5~0.95). 기본은 0.7이고 LSTM으로 바뀌어도 그대로 쓴다. DB에는 threshold 값 하나로 저장한다. 단계 칸은 필요 없다 |
| 소리 | 저장하지 않는다. 측정마다 꺼진 채 시작하고 측정 화면에서 켠다(브라우저는 사용자 동작 없이 소리를 켤 수 없다). 「자세 알림」 켜기·끄기만 서버에 저장한다(V2.3 `sound_alert_enabled`) |
| 영상 크기 | 640×480 고정(팀 결정, DB V2.3 `CAPTURE_RESOLUTION`). 앱은 640×480을 요청한다. 고정이라 **서버에 해상도를 보내지 않는다**(10/15, 좌표 구간의 `width`·`height` 삭제). 다른 크기면 시작하지 않는 처리는 두지 않고(10/19), 측정 화면 위에 실제 카메라 크기를 작게 표시한다(예정, F13) |
| 배포 (10/19) | 공개 배포는 **HTTPS**. 화면은 Vercel `app.<도메인>`, 서버는 Cloudflare 이름 있는 터널 `api.<도메인>`(DevOps). 데스크톱 앱도 PC 파일(`app://posegood`)이 아니라 `https://app.<도메인>`을 연다 — 화면 수정이 서버 배포 없이 반영된다. 자세한 구상은 [배포](fe-deploy.md) |
| 자세 등록 (10/20 전체 회의) | 앱이 관절 9개 3초 평균을 내서 B1로 보낸다. 이 PC에는 저장하지 않는다([ADR 0026](../decisions/0026-baseline-average-by-app-b1.md)) |
| 측정 (10/21) | 「측정 시작」은 항상 서버 측정이고 앱은 판정하지 않는다. 서버 결과는 형식만 확인한다([ADR 0025](../decisions/0025-app-always-measures-on-server.md)) |
| 네트워크 끊김 | 세션을 끝내고 화면을 막는 팝업을 띄운다. 재연결·재전송하지 않는다([ADR 0024](../decisions/0024-session-ends-on-lost-connection.md)) |
| 카메라 (10/16, [계획 0053](../plans/active/0053-multiple-cameras.md)) | 측정하기 카메라 화면 위에서 메인 카메라를 고른다(설정과 같은 선택). **기준 자세는 카메라와 상관없이 하나**(팀 논의: 카메라마다 등록은 비효율, ML 학습 자료도 사람마다 기준 하나). 쓰던 카메라가 빠지면 측정 종료·저장 |
| 앱이 닫힌 측정 (10/16 → 10/21) | 이어하기는 없다. 10/21부터 앱이 닫히면 연결이 끊기고 서버가 마지막 구간까지 저장한다(앱이 따로 저장하지 않음, ADR 0025) |
| 측정 중 작은 창·쉬기 (10/20) | 측정 중 다른 탭(기록·달력·설정)이나 다른 사이트로 가면 카메라 작은 창(PiP)이 뜬다. 버튼은 최소화(영상만 숨김, 측정 계속)·확대(측정 화면으로)·X. **X는 측정 종료·저장**이다(창을 닫는 것은 그만하겠다는 뜻, 서버도 바로 정리됨). **일시정지(휴식이든 앱이 스스로 멈춘 것이든)가 10분 이어지면 자동으로 종료·저장**한다 — 쉬기를 걸어 두고 잊으면 측정도 안 하는데 서버가 연결·판정 상태를 계속 붙잡고 있게 되기 때문(일시정지 중에도 0.5초마다 빈 휴식 구간이 간다). **이 10분은 서버가 자기 시계로 판단해 종료하고 앱에 알린다(BE 담당). 앱에는 타이머를 두지 않고 서버가 보낸 종료를 처리한다.** 서버가 끝냈을 때 보낼 신호(`decision(session_ended)`·`closed` 사유)는 BE와 정한다. 사용자가 X를 누른 것은 판정 불가(UNMEASURABLE)가 아니라 본인 의사라 종료로 처리한다 |
| 탈퇴 | 되돌릴 수 없다(BE 10/15, A8 없어짐). 확인창 문구·탈퇴 계정 로그인 안내는 [연동 명세](api-ws-spec.md) 2장 |

```
앱 ──HTTP /api/v2──▶ 입출구 서버 (BE `backend/api`) ──▶ MySQL(계정·설정·세션 행·기록)
앱 ──WebSocket /api/v2/realtime──▶ 같은 서버: 좌표 → 특징 계산(FrameFeatures) → 추론 POST /v2/infer → 판정
   ▲                                   │
   └──── push: observation·decision·alert·ack·progress·stalled·closed ─┘
```

서버 쪽(BE 10/17, `FrameFeatures` 안): 입출구 서버가 연결마다 로그인과 세션 주인을 확인하고(`hello` → `ready`), 좌표 구간으로 특징을 계산해 추론·판정하고, 결과를 같은 연결로 보낸다(BE 명세 11장).
나중에 Kafka 경로(`posture.features.v1` → 추론 → `posture.inference.v1` → 판정 → `posture.episodes.v1`·`posture.alerts.v1`, BE 계획 0031)로 옮겨도 앱 쪽 계약(WebSocket v2)은 바뀌지 않는다.
재연결은 없다(ADR 0024). 연결이 끊기면 서버가 마지막으로 받은 구간 끝에서 세션을 끝낸다(BE 명세 11.3).
로그인은 측정 연결을 열 때 확인하므로 측정은 끝까지 간다. 로그인은 30분이 지나면 버려지므로(BE 의도, 10/19) 긴 측정 뒤 HTTP가 401이면 로그인 화면으로 보낸다.

## 3·4. 앱이 보내는 것과 받는 것 (요약)

상세는 [연동 명세](api-ws-spec.md)으로 옮겼다(10/22). 여기에는 요약만 둔다.

- **보내는 것:** 0.5초마다 좌표 구간 1개(관절 9개, 프레임을 평균 내지 않음, 판정 불가 프레임은 `valid:false`) — 연동 명세 5.1. 쉬기 `rest`, 카메라 영상 멈춤 `away`, 종료 `end`(사용자 종료·작은 창 X·카메라 빠짐·영상 크기 변경) — 5.2. 자세 등록은 앱이 낸 평균을 B1로 — 5.4.
- **받는 것:** 화면은 서버 메시지로만 바뀐다. 점수 = 100 × (1 − `collapse_probability`), 「자세가 흐트러졌어요」는 서버 확정 사건, 숫자는 서버 요약 — 5.3(메시지별 동작과 화면 상태 표).
- **끝나는 경우:** 사용자·작은 창·카메라 빠짐·영상 크기 변경은 앱이 `end`, 앱을 닫거나 연결이 끊기면 서버가 저장, 쉬기 10분은 서버가 끝냄(BE) — 5.2·6.3.

## 5. 서버 부담 (동시 50명, 하루 8시간 추정)

| 항목 | 특징값 전송(예전) | 좌표 전송(지금) |
|---|---|---|
| 메시지 | 0.5초에 1건, 수백 바이트 | 0.5초에 1건, 약 2KB |
| Kafka 유입량 | 수십 KB/s | 약 200KB/s |
| 서버 계산 | 0.5초당 점수 1번 | 초당 약 800프레임(계산은 가볍다) |
| 저장 | MySQL에 결과만 | HDFS에 좌표 약 5GB/일 추가 |

메시지 수가 같아서 처리량은 거의 같다(10/01 측정 기준 약 40~50명, DevOps 재측정 예정).
실제 부담은 구현·운영이다: 좌표 처리 단계, 세션별 상태, 3초 규칙과 자동 재개, HDFS 적재·동의 철회 삭제, 서버 장애 시 화면 판정 정지.

## 6. 넘겨준 판정 규칙과 시험 데이터

판정 규칙(판정 가능 검사, 특징값, 고개 돌림, 점수, 복귀 대기, 보정, 판정 불가 시간 처리)은 10/11에 BE에 넘겼고 서버가 구현한다(D-34·D-35·D-23).
이 문서에서는 계산 방법을 뺐다. 원문은 이 파일의 git 이력 `d69b22c`(BE 회신 S2·S3 반영본)에 있다.

- [합성 시험 데이터](../../contracts/examples/frames/reference-rule-cases.json): 좌표 → 기대 결과(프레임 17·시간 순서 4·보정 1). 서버 구현이 같은 결과를 내는지 확인용이다.
- 앱 판정 코드로 만든 자료다. 앱 판정과 그 시험(`referenceRuleCases.test.ts`)은 10/21 지웠다(ADR 0025). 자료 파일은 서버가 같은 결과를 내는지 확인용으로 남긴다. 다시 만들어야 하면 develop의 앱 코드로 만든다.
- 규칙을 바꾸자는 제안은 BE·ML이 정한다. 시험 데이터를 다시 만드는 것도 이제 서버 쪽 몫이다. 두 귀가 모두 있어야 판정한다는 규칙(`one_ear_missing`)과 float64 계산도 ML 결정에 따라 바뀔 수 있다.

## 7. FE가 할 일

끝난 것(10/13): 회원가입 동의 화면(F6 앞부분), 등록 전 구도 확인(F7, 팀원), 팀 API 브랜치 확인(F8, BE `api-spec.html`), develop PR(F10, #42), 동의 제안서(F12 문서)는 표에서 뺐다.

| # | 할 일 | 막힌 것 |
|---|---|---|
| F1 | **S1 `policy` (10/21 결정):** W1이 붙기 전에는 앱 기본 판정 기준(`DEFAULT_RULES`를 ms로)을 보낸다. 서버 계정 값과 다르면 409가 나므로, 실제 서버 시험(로그인·W1 연결 뒤) 때 W1 `rules`로 바꾸고 맞춘다(B-3). 좌표 구간 전송(연동 명세 5.1): WebSocket v2 `features`에 0.5초마다 구간 1개. 지금 코드는 v1(특징 변화량)을 보낸다. 준비된 `FrameBatcher`를 붙인다. `hello` 2.0(`purpose`) → `ready`(5초) 뒤에만 보내고, 메시지의 `session_id` 검사를 뺀다(v2는 `hello`·`ready`만 ID를 담음). WS 주소는 페이지 주소로 만든다(`https:`면 `wss:`) | **10/21 V3에서 함(`features/session/live/`)**, 실제 서버 시험은 로그인·W1 뒤 |
| F2 | 자세 등록 서버 연결(연동 명세 5.4): 앱이 낸 관절 9개 평균을 B1로 저장, B2 조회, `closed(no_baseline)` 안내(10/20 전체 회의로 WS 등록 대신 B1). **10/21 V3에서 B1·B2 연결**, 실제 서버 시험은 로그인(F12, BE) 뒤 | F12(시험) |
| F3 | `rest`·`away`·`end` 전송(연동 명세 5.2). `end` 뒤 10초 대기, S4 대비책(6.1·6.3). `stalled`는 안내만(다시 보내지 않음), `limit_reached`·`bad_message`는 종료 화면. 카메라가 빠지거나 영상 크기가 바뀌면 `end`(7.0) | **10/21 V3에서 함**(F1과 함께) |
| F4 | 화면을 서버 결과로만 구동(연동 명세 5.3). **10/21 측정 화면은 함.** 통계 숫자도 서버 값. 관측 3.0 `invalid_reason`, `progress.paused_reason`. `excluded_started/ended`는 받기만 한다(지금 검증은 사건 종류 5개만 받아 거절함). `alert`는 앱이 거르지 않는다(D-54) | — (BE 구현됨 10/17) |
| F5 | 로컬 판정 제거(계획 0023 2단계 나머지): 앱 점수·상태 계산, 고개 돌림·복귀 대기 코드. **10/21 측정 쪽은 지웠다**(사용자 결정: 「측정 시작」은 항상 서버 측정, 로컬 측정 화면·판정 엔진·이어하기 삭제). 남은 것: 학습 데이터 수집 화면이 쓰는 특징 다리, 기록 화면의 앱 통계 계산(서버 기록 R1·T1로 바꿀 때) | 기록 화면(3단계) |
| F6 | 측정 화면의 "좌표 전송 안 함" 문구 수정 | — |
| F9 | 서버 PC 왕복 시험(T-13) 일정 | 입출구 서버 |
| F11 | 판정 불가 표시(연동 명세 5.2): 측정이 안 되는 모든 경우에 `valid:false`를 붙이고 합성 시험 데이터에 사례를 더한다 | — |
| F12 | 계정 서버 연결(**BE 담당**, 10/14): 로컬 로그인·가입을 A1~A7·W1로 바꾸고(`consentPayload()`), 비밀번호 12자 검사를 켠다. 우리는 가입·동의 화면과 `consentPayload()`를 넘기고 질문에 답한다. BE 코드의 A7(탈퇴)은 본문에 `{password}`를 받으므로 탈퇴 확인창에 비밀번호 칸이 필요하다(연동 명세 2장) | BE 입출구 서버 |
| F13 | (예정) 카메라 해상도 표시: 측정 화면 위에 실제 카메라 크기(예: 640×480)를 작게 보인다. 위치는 UI를 보며 정한다. 다른 크기면 시작하지 않는 처리는 두지 않는다(10/19) | 위치 결정 |
| F14 | 데스크톱 앱이 `https://app.<도메인>`(Vercel)에서 화면을 연다([배포](fe-deploy.md) 4장 5단계): `sameAddress` 검사·알림 팝업 주소·`app://` 파일 제공 정리, 열 수 없으면 「서버에 연결할 수 없어요」 | 도메인·Vercel |
| F15 | v2 전환 때 필요 없어지거나 겹치는 코드 정리(7.1) | F1~F4 |

담당: 기록·달력 화면은 lellon0403이 맡는다(10/14, develop #43~#45에서 오늘 탭·달력 탭으로 개편). 기록 화면의 표시 규칙(오늘 세션 목록, 통계는 어제까지)은 그쪽을 따른다. 측정하기 화면과 자세 데이터 수집(학습용) 화면도 다른 담당자가 맡는다. 우리 쪽은 서버로 보내는 처리(F1~F3), 판정 불가 처리(F11), 회원가입·동의 화면을 한다. 계정 서버 연결(F12)은 BE가 맡는다(10/14, BE 계획 0027과 같은 일).

### 7.0 v2를 다시 할 때 정할 것 (10/19 → 10/21 결정)

10/21 사용자 결정으로 셋 다 권장안대로 했다([ADR 0025](../decisions/0025-app-always-measures-on-server.md)): 서버 결과는 형식만 검사(되감김 멈춤·2초 넘은 관측 숨기기 없음), 서버 측정 중 쓰던 카메라가 빠지면 `end`로 종료·저장, 측정 중 영상 크기가 바뀌어도 종료·저장. 그대로 둔 것: 순번 중복 막기, 좌표를 계약 범위(-1~2)로 자르기, `ready` 5초·`end` 뒤 10초 대기.

### 7.1 v2 전환 때 정리할 것 (10/19, BE `a0d99a3` 기준)

서버(`/v2/realtime`, S1)가 받지 않거나 서버가 대신 하게 되어 앱에 남길 필요가 없는 것이다. 우리 몫만 적고, 다른 담당의 화면에 걸친 것은 아래에 따로 둔다.

| # | 지금 앱 | v2에서 | 처리 |
|---|---|---|---|
| 1 | 측정 시작에 `setup`(카메라 key·이름, 화면 크기, 기준 자세 평균·표준편차·중심·면적)을 보냄 — DB V1.1 때 형식(`server/setup.ts`, `ServerSetup`) | S1은 `policy`·`baseline_id`만 받고 모르는 필드는 400 | **10/21 지웠다** |
| 2 | 구간마다 `baseline_id`·`measurement_quality`·특징 변화량(`FrameRequest`, 입력 v2)을 보내려고 앱이 특징을 계산(`serverFeatures`) | 좌표 구간만 받고 서버가 기준 자세로 특징을 계산(`FrameFeatures` 안) | **10/21:** `FrameBatch`로 바꿨다. 판정 불가는 어깨가 유예 뒤에도 안 보이는 프레임에 `valid:false`(F11) |
| 3 | HTTP 측정 경로(`server/client.ts` `/api/v1/sessions/…/features`, `VITE_REALTIME_URL`이 없을 때) | `/v1/sessions` 없음, S2도 전환 뒤 삭제 | **10/21 지웠다.** WS만 쓰고 S1·S4는 `/api/v2`(`features/platform/api.ts`) |
| 4 | 확인받지 못한 요청을 보관·재시도(`server/queue.ts`, 체크포인트의 `pending`·`nextSequence`·기준 특징·화면 크기) | 재전송 없음, 순번이 겹치면 `closed(bad_message)` | **10/21 지웠다**(이어하기 draft도) |
| 5 | WS 재연결·미확인 구간 재전송·30개 묶음·`last_event_id`·알림 거르기(`realtime/client.ts`) | 재연결 없음, 메시지당 구간 1개, 알림은 서버가 거름 | **10/21 다시 썼다**(`live/LiveSession.ts`) |
| 6 | 측정 중 앱이 닫히면 다음 로그인 때 앱이 그때까지를 기록으로 저장(10/16), 개발 서버 측정은 이어하기를 물음 | 서버가 끊김을 보고 마지막 구간 끝에서 끝내고 저장(BE 명세 11.3) | **10/21:** 이어하기·앱 저장을 지웠다. 기록 화면이 서버 기록(R1)을 읽기 전까지는 서버가 확인한 요약을 이 기기에도 R1과 같은 형식으로 남긴다(R1로 바꿀 때 지움) |
| 7 | 자세 등록 결과(평균 특징)를 이 PC에 저장(`camera/savedBaseline.ts`) | 앱이 낸 관절 평균을 B1로 저장, B2로 조회(10/20) | **10/21 지웠다**(`features/baseline/`). 3·2·1 촬영 화면은 남겼다. 로컬 판정·수집 화면용으로 서버 좌표에서 특징을 계산해 넘기는 다리는 F5 때 지운다 |
| 8 | 개발자 옵션 내보내기 둘: 입력 v2 특징(`kafkaExport.ts`, 예전 `posture.features.v1` 형식), 좌표(`poseDebugExport.ts`) | 앱이 보내는 것은 좌표 구간(`posture.frames.v1`) 하나 | **10/21 둘 다 지웠다**(로컬 측정 화면과 함께). 좌표가 필요하면 보내는 형식(`posture.frames.v1`) 그대로 ML과 정한다 |
| 9 | `platform/ports.ts`(아키텍처 v4 초안 연결점, 아무도 가져다 쓰지 않음) | — | **10/21 지웠다** |

다른 담당 화면에 걸친 겹침(알리기만): 앱 판정(10/21 지움)과 측정하기 화면, 기록 통계의 앱 계산(`lib/stats`·`lib/comparison`, 서버 R1·T1과 겹침)은 lellon0403, 로컬 로그인·기록(`LocalServiceApp`)은 F12(BE)다.

참고: 앱의 옛 판정 구현(고개 돌림 제외·귀 기준 치우침·복귀 대기)은 `lee_app1`의 `676ae89`에 있다. 회의 안건 원문과 BE 문서는 저장소 밖(DevOps)에 있다.

### 7.2 다음 할 일 (10/21 기준, V3 `f88ffe3`)

10/21에 한 것: F2 자세 등록(B1·B2), F1+F3 측정(S1 → `/v2/realtime`), 로컬 판정·이어하기·v1 서버 코드 삭제. 시험 213개·`check-repo` 통과, 실제 서버 시험은 아직.

| 순서 | 할 일 | 막힌 것 |
|---|---|---|
| 1 | **더미 데이터 삭제**(2단계): 발표용 예시 기록 `data/exampleRecords.ts`와 설정의 토글(`KEYS.demo`, `saveDemoPreference`), 합성 시연 `mode: 'demo'`, `testing/legacySyntheticRecord.ts`. 자동 시험용 가짜 카메라는 남긴다 | — |
| 2 | **기록 화면을 서버로**(3단계): `recordsSource.ts`에서 W1 `records`·R1·T1. 지금은 측정 결과를 이 기기에도 R1 형식으로 남긴다(`useSessionPersistence.ts` `finish`), R1로 바꾸면 그 복사를 지운다. 기록·달력은 lellon0403 담당(10/14)이라 함께 | BE 로그인(F12) |
| 3 | `check-browser` 시나리오를 서버 전용으로 다시 쓰기([계획 0030](../plans/active/0030-make-check-failures.md) G6): 가짜 S1·`/v2/realtime`·B1·B2 | — |
| 4 | 실제 서버 시험: DevOps 8088 환경(`ssh -L 8088:127.0.0.1:8088`)에서 로그인 → 등록 → 측정 → 종료 → 기록. 그 환경의 화면은 BE 브랜치의 `frontend/`로 빌드되므로 V3 화면으로 빌드해야 한다(DevOps와 정하기) | F12·W1 |
| 5 | S1 `policy`를 W1 `rules`로(B-3) | W1 |
| 6 | 남은 앱 계산: 수집 화면용 기준 특징 다리(`useCamera` `baselineFeatures`), 기록 화면의 앱 통계(`lib/stats`·`lib/comparison`, T1로) | 2 |

**10/22 문서 정리 (내일 확인용, 무엇이 어디로 갔나)** — 지운 것은 [지운 문서 기록](../removed-docs.md) 6장.

| 전 | 후 |
|---|---|
| 이 문서 3장(보내는 것)·3.2(쉬기·자리 비움·종료 표, DB 규칙)·3.3(등록)·4장·4.1(화면 상태) | [연동 명세](api-ws-spec.md) 5.1·5.2·5.4·5.3. 여기에는 3장 요약만 |
| 이 문서 1장의 10/16~19 BE 확인 기록, 7.0 미정 3개의 설명 | 지움(결정 결과만 남김, git `dc2c5d4`) |
| 이 문서 4.1의 로컬 화면 상태 7개(`suspect`·`recovering`·최근 30분 흐름) | 지움. V3 화면 상태는 연동 명세 5.3 표 |
| 이 문서 6장 `referenceRuleCases.test.ts` 설명 | 10/21 시험이 지워진 것에 맞춰 고침 |
| 연동 명세 0.1~0.6(10/13~15 검토 답변·BE 명세 대조, 약 120줄) | 지움. 지금 유효한 결정만 0장 표로 |
| 연동 명세 0.7(탈퇴) | 연동 명세 2장 끝 |
| 연동 명세 4장 REST 요청·응답 본문 | BE 명세가 기준이라 빼고 앱이 지킬 것만 4장에 |
| 연동 명세 5.3 자세 등록·6.2·6.4 | 5.4·6.3으로 번호 바뀜 |
| `fe-domain-idea.md`(배포 구상) | 이름 `fe-deploy.md`(배포). 6장(데스크톱 앱 구조)은 이 문서 8.4로 |
| `server-persistence-and-auth.md`, `data-platform-boundary.md`(10/01~06, 예전 v1 백엔드 기준) | 지움. 지금 서버 구조는 [아키텍처 v5.2 스택별 역할](architecture_v5.2_stack_roles.md)·[변경 안내](architecture_v5.2_change_notes.md) |
| 코드: 쉬는 중 카메라 영상이 멈추면 `rest` 유지 | DB V2.3 우선순위(`ABSENCE` 먼저)대로 `away`로 바꿈(`LiveSession.away`, 시험 1개 추가) |

알릴 것: BE — 로그인 뒤 `setServerAuth({ userId, csrfToken })`(`features/platform/serverAuth.ts`)와 W1(B-3). lellon0403 — 측정하기의 로컬 판정이 없어졌고 측정 화면은 `features/session/live/`, 기록 상세는 서버 결과 형식(`server.view`)을 그대로 쓴다.
V3를 develop에 합치는 것은 `api.posegood.site` 터널이 붙은 뒤에 한다(Vercel 배포본이 서버 없이는 측정할 수 없게 되므로).

## 8. 지금 앱 (FE 참고)

10/19 연동 명세 7장(FE 참고)과 데스크톱 앱 화면 설계(`docs/design/desktop-app.md`, lellon0403)를 여기로 합쳤다. 데스크톱 창·시작 프로그램·알림 팝업은 8.4, 실행 명령은 [FE 작업 명령과 검사](fe-commands-and-checks.md)에 있다. 시각 규칙은 [DESIGN.md](../../DESIGN.md), 결정은 [ADR 0017](../decisions/0017-desktop-app-shell-and-redesign.md).

### 8.1 서버에 붙은 것과 남은 것 (10/21 V3)

「—」은 이미 서버로 바뀐 것, 「붙일 때」 칸이 있는 것은 아직 이 기기에서 도는 것이다.

| 항목 | 지금 | 붙일 때 |
|---|---|---|
| 로그인 | 입력값을 확인하지 않고 이 기기에 가입한 프로필로 들어간다 | A1·A3·A4 |
| 가입 | 프로필·이메일·동의 선택을 이 기기에 저장. 비밀번호는 저장하지 않고 최소 길이를 보류 | A2(`features/auth/consents.ts`의 `consentPayload()`), 12자 검사 켜기(`features/auth/password.ts`, 72바이트 검사는 이미 함). 이름 30자·나이 14~120은 이미 서버와 같다(`validProfileInput`) |
| 기준 자세 | **10/21 바꿈:** 서버에 하나(앱이 관절 평균을 내서 B1, 조회 B2, `features/baseline/`), 어느 카메라든 같은 것 | — |
| 실시간 | **10/21 바꿈:** `/v2/realtime` 좌표 구간(`features/session/live/LiveSession.ts`, `realtime/frames.ts`) | — |
| 기록(오늘 탭)·달력의 고른 날 | 이 PC 기록. `features/history/recordsSource.ts` `sessionsOn`, `DayRecord.tsx`, `LocalHistory.tsx`, `RecordCalendarPage.tsx`(화면 담당 lellon0403, 10/14) | R1(전체를 받아 날짜로 거름), R1b |
| 달력: 날짜별 합계(월 달력·잔디·최근 7일·30일) | 이 PC 기록. `recordsSource.ts` `dailyStats`, `ActivityHeatmap.tsx`, `RecordCalendar.tsx` | T1(≤ 92일, 어제까지). 잔디는 1년(53주)이라 92일씩 5번, 달력은 달마다 요청. 오늘 칸은 R1의 오늘 세션으로 채운다. 알림 총수(재알림 포함)는 T1 행에 없어 `alerted_event_count`로 보인다. 기간 통계는 날짜를 고르지 않았을 때의 오른쪽 칸(`PeriodCard`)에 붙일 예정 |
| 알림 | **10/21 바꿈:** v2 `alert`를 그대로 소리·토스트·데스크톱 팝업으로 | — |
| 판정 불가 표시 | **10/21 바꿈:** 어깨가 2초 유예 뒤에도 안 보이는 프레임에 `valid:false`(`features/camera/shoulderGrace.ts`, `LiveSession.ingest`) | — |
| 앱 판정 | **10/21 V3에서 지웠다**(판정 엔진·복귀 대기·카메라 샘플·로컬 측정 화면). 점수는 서버 공식 100×(1−collapse_probability)로 표시만(`postureScore`). develop과 Vercel 배포본은 아직 예전 로컬 판정 | — |
| 기록 통계 계산 | 앱이 기록으로 계산한다(`lib/stats`·`lib/comparison`·`recordsSource.ts`, 오늘 포함). 5분 미만 세션 규칙은 없다 | 서버 값(T1, 어제까지. 5분 미만은 「붕괴까지 걸린 시간」 최소·최대에서만 뺌 — 서버 계산). 화면 담당 lellon0403 |
| 탈퇴 | 이 브라우저의 자료를 바로 지운다(`WithdrawalDialog.tsx`) | A7: 비밀번호 칸, 「되돌릴 수 없고 30일 뒤 완전히 삭제, 그 전에는 같은 이메일로 다시 가입할 수 없음」. 탈퇴 계정 로그인(403 `ACCOUNT_CLOSED`)에 연락처 안내(2장 탈퇴). 지금 로컬에서는 바로 지워지므로 30일 문구를 미리 넣지 않는다 |

### 8.2 연결 설정 (`features/platform/serverConfig.ts`)

| 변수 | 뜻 |
|---|---|
| `VITE_API_BASE_URL=https://…` | API 주소 앞부분. 화면을 다른 곳(Vercel)에서 낼 때 운영은 `https://api.posegood.site`. 없으면 같은 출처 `/api`(10/19, [배포](fe-deploy.md)) |
| `POSEGOOD_API_URL` (개발 서버) | `/api` 중계 대상. 기본 `http://127.0.0.1:8090` |

예전 계정 모드 스위치 `VITE_SERVER_ACCOUNTS`는 2026-10-13, 실시간 스위치 `VITE_REALTIME_URL`·`VITE_REALTIME_FRAMES`와 개발자 옵션의 「서버 판정 사용」은 2026-10-21 지웠다(앱은 항상 서버로 측정, WS 주소는 API 주소나 페이지 주소에서 만든다).

### 8.3 화면과 코드 위치

사이드바 탭은 측정하기·기록·달력·설정 4개다(`app/AppSidebar.tsx`, `app/navigation.ts`의 `tabOf`·`resolvePage`, 조립 `app/ServiceScreens.tsx`). 화면 담당: 측정하기·기록·달력은 lellon0403(10/14).

| 탭 | 화면 | 코드 | 보여 주는 것 |
|---|---|---|---|
| 측정하기 | 준비 | `pages/SetupPage.tsx`, `features/camera/CameraPicker.tsx` | 카메라 → 얼굴·어깨 → 등록한 자세가 없으면 3·2·1 뒤 3초 등록 후 자동 측정, 있으면 2.5초 머물 때 자동 시작(`features/camera/useAutoStart.ts`) 또는 「측정 시작」. 카메라 화면 위 메인 카메라 선택(10/16). 자세 등록 탭은 10/13 여기로 합침 |
| 측정하기 | 측정 중·결과 (10/21 V3) | `features/session/live/LiveSessionPage.tsx`, `useLiveSession.ts`, `LiveSession.ts` | 서버가 준 값만: 상태 알약, 교정 카드, 잠시 쉬기/종료/소리 독, 점수 링, 이번 측정 요약, 결과(바른 자세 비율, 이탈·알림·집계 제외, 서버 사건 표). 예전 로컬 측정 화면(`SessionLive`·`SessionResult`·`MeasureParts`, 최근 30분 흐름)은 지웠다 |
| 기록 | 오늘 | `features/history/LocalHistory.tsx` | 오늘 측정 목록과 요약(10/13 기록·달력 분리) |
| 달력 | 고른 날·날짜별 합계 | `features/history/RecordCalendarPage.tsx`, `RecordCalendar.tsx`, `ActivityHeatmap.tsx`, `DayRecord.tsx` | 월 달력, 잔디, 고른 날의 기록 |
| 설정 | 설정 | `pages/SettingsPage.tsx` | 알림(3단계 선택 + 세밀 조정), 기준 자세 다시 등록(측정하기에서 등록), 컴퓨터를 켤 때, 계정, 개발자 옵션 |
| 설정 | 프로필 / 자세 데이터 수집 | `features/profile/*`, `pages/CollectionPage.tsx` | 프로필 수정, 학습용 수집(다른 담당) |
| — | 로그인 | `pages/LoginPage.tsx` | 왼쪽 소개, 오른쪽 입력 |
| — | 작은 카메라 창(카메라가 켜진 채 다른 탭, 또는 다른 사이트) | `features/camera/CameraWindow.tsx`, `useCameraWindow.ts`, 측정 종료 연결 `features/session/sessionControl.ts` | 10/20 유튜브 PiP처럼 영상만. 띠(마우스를 올리거나 키보드로 들어가면 보임)에 「● 카메라 사용 중」(끌어서·방향키로 옮기기)과 최소화(영상만 숨김, 측정은 계속)·확대(측정 화면으로, 다른 사이트에서 눌렀으면 앱 탭을 앞으로)·X(측정 중이면 종료·저장, 아니면 창만 닫음). 앱 밖(다른 사이트 위)은 Chrome 문서 PiP이고, **다른 탭으로 가면 저절로 열리게 한다**(사용자 결정 10/20, 수동 버튼은 두지 않음). Chrome의 화상회의용 자동 PiP(`enterpictureinpicture` 처리기 + 카메라 캡처 + 자동 PiP 설정)를 쓴다. **10/20 시험: 아직 안 열린다.** 처리기는 등록되지만(콘솔 `[PoseGood] … handler registered`) 탭을 바꿔도 Chrome이 부르지 않았다. 같은 PC에서 Chrome 공식 시험 페이지(카메라+마이크, https)는 열렸다. 후보: 카메라만 캡처(공식 페이지는 마이크도), `http://127.0.0.1` 주소. 다음에 카메라만/카메라+마이크·http/https를 비교해 고친다(진단 기록은 `useCameraWindow.ts`의 `console.info`). Chrome 앱 밖 창의 위쪽 검정 띠(사이트 주소·탭으로 돌아가기·닫기)는 브라우저 보안 표시라 바꿀 수 없다 — 모양을 마음대로 하려면 데스크톱 앱에서 우리 창으로 만든다. 띠의 점·문구는 측정 상태를 보인다(`sessionControl`의 상태 알림): 초록 「바른 자세예요」, **빨강 「자세가 흐트러졌어요」(앱 알림이 확정된 순간, 테두리도 빨강, 띠가 숨겨져 있어도 보임)**, 회색 「자세를 확인할 수 없어요」·「쉬는 중」, 측정 중이 아니면 「카메라 사용 중」. **확인할 것:** 브라우저는 보이지 않는 탭의 타이머를 늦추므로(프레임 반복이 `setTimeout`) 다른 사이트에 있는 동안 측정이 「영상 멈춤」으로 일시정지될 수 있다 — Chrome에서 직접 시험 필요. 데스크톱 앱은 창 설정 `backgroundThrottling: false`로 피할 수 있다 |

디자인 시안(캔버스 7장: 측정 중·알림·기준 등록·결과·기록·설정·작은 창)은 claude.ai 아티팩트로 공유했다(lellon0403). 시안의 숫자는 화면 예시 값이며 측정 결과가 아니다.

### 8.4 데스크톱 앱 구조 (`frontend/electron/`)

10/19 데스크톱 앱 화면 설계(`docs/design/desktop-app.md`, lellon0403)에서 배포 문서로 옮겼다가, 10/22 배포와 상관없어 여기로 옮겼다. [배포](fe-deploy.md) 4장 5단계(F14)에서 바꿀 곳이 여기 있다.

| 파일 | 역할 |
|---|---|
| `main.cjs` | 창 생성, 외부 주소 차단(`sameAddress`), 단일 실행, 시작 프로그램 등록, 데스크톱 설정 파일(`userData/desktop-settings.json`), 패키징된 앱의 `app://posegood` 파일 제공 |
| `preload.cjs` | 페이지에 `window.posegoodDesktop`(launch 정보, 시작 프로그램, 자동 카메라, 알림 팝업 설정·표시, 종료)만 노출 |
| `popup-preload.cjs` | 알림 팝업 창에 `window.posegoodPopup`(문구 받기, 닫기, 앱 열기)만 노출 |
| `launch-dev.mjs` | 바탕화면 바로가기용: 개발 서버(5174) → 창 → 종료 시 서버 정리 |

- **보안:** IPC는 앱 자신의 주소에서 온 요청만 받는다. `nodeIntegration` 끔, `contextIsolation`·`sandbox` 켬. 화면을 `https://app.<도메인>`에서 열면 이 「앱 자신의 주소」가 바뀐다(F14).
- **창:** 기본 1360×860, 최소 1180×760. 제목 표시줄은 숨기고(`titleBarStyle: 'hidden'`) Windows는 `titleBarOverlay`로 창 버튼만 크림색(`#fbf5ee`) 위에 그린다. 메뉴는 `removeMenu()`로 없앤다. 개발 실행에서는 F12/Ctrl+Shift+I, Ctrl+R을 유지한다. 페이지는 `data-desktop`과 `--titlebar-h`로 여백을 맞추고 `features/desktop/TitleBar.tsx`가 끌기 영역을 그린다.
- **아이콘:** `frontend/public/branding/posegood-icon.svg`가 정본이고 PNG·ICO는 같은 SVG에서 내보낸다. 로그인·사이드바의 `BrandMark`, 브라우저 탭, Electron 창이 같은 아이콘을 쓴다. Windows 패키징은 `win.icon`으로 ICO를 넣고 `signExecutable: false`로 서명만 생략한다(`signAndEditExecutable: false`는 아이콘 편집까지 막아 쓰지 않는다). 빠른 실행기는 `copy-desktop.mjs`의 `/win32icon`으로 같은 ICO를 넣는다. 아이콘을 바꾸면 `npm run desktop:pack`으로 다시 만든다.

#### 시작 프로그램 (설정 → 컴퓨터를 켤 때)

1. `자동으로 PoseGood 열기`: `app.setLoginItemSettings({ openAtLogin, args: ['--launched-at-login'] })`. 패키징 전에는 비활성(개발 실행은 개발 서버가 필요하다).
2. `열릴 때 카메라 바로 켜기`: 데스크톱 설정 파일에 저장. 시작 프로그램 인자로 열렸고 켜져 있으면 `features/desktop/useLaunchAutomation.ts`가 로그인 후 측정하기에서 카메라를 한 번 연결한다. 등록한 자세가 있으면 2.5초 머물 때 측정이 저절로 시작된다(`useAutoStart.ts`, 10/13).
3. 남은 것: 트레이/작은 항상-위 창. (설치 파일 패키징과 패키징된 앱의 `dist` 읽기, 저장된 기준 자세 불러오기는 이미 됐다.)

#### 자세 알림 팝업 (10/06 요청, 10/14 모양 변경)

알림(붕괴 확정·재알림)이 울릴 때 앱 창이 가려졌거나 최소화돼 있으면 화면 오른쪽 아래에 작은 팝업(`public/alert-popup.html`)을 띄운다. 앱 창이 포커스를 갖고 보이면 앱 안 토스트·소리만 쓴다(main이 `in-app`으로 건너뜀).

- 항상 위에 뜨지만 포커스를 가져가지 않고(`showInactive`) 8초 뒤 숨는다. 앱 안 스낵바와 같은 짙은 갈색 작은 알약이고, 의자 아이콘을 두른 링이 남은 시간을 보여 준다. 알약을 누르면(또는 Enter) 앱을 열고, X·Esc로 닫고, 좌우로 70px 넘게 밀면 그 방향으로 밀려나며 닫힌다.
- 문구는 `features/desktop/alertPopup.ts`에 있다(예전 측정 화면의 방향별 문구에서 왔다). 재알림은 "아직 자세가 돌아오지 않았어요."를 앞에 붙인다.
- 설정 `알림 → 다른 창을 볼 때 팝업`(기본 켜짐)은 데스크톱 설정 파일의 `alertPopup`에 저장한다. 교정 알림을 끄면 팝업도 없다. `개발자 옵션 → 알림 모양 확인 → 앱 밖 알림창`은 앱을 보고 있거나 팝업이 꺼져 있어도 띄운다.
- 앱 창을 닫으면 숨은 팝업 창도 정리해 앱이 종료된다. 일반 브라우저 탭에는 팝업이 없다.
- 검증(lellon0403): 패키징 EXE를 숨긴 창·독립 프로필로 실행해 `showAlert`→`popup`, 문구·표시, 설정 끔→`off`를 확인했다. 실제 측정 중 다른 창을 볼 때의 확인은 따로 한다.
- 팝업 주소는 패키징 때 `app://posegood/alert-popup.html`이라, 화면을 `app.<도메인>`에서 열 때 같이 바꾼다(F14).
