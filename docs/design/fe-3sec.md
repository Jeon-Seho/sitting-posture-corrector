# FE 계획: BE PR #91(서버 3초 묶음 판정·`observation` 4.0)과 합치기

> 작성자: klaod-tech(FE) · 작성: 2026-10-30 · 다시 세움: 2026-11-01(BE PR #91 반영, 합병 계획으로) · 상태: **1단계 코드 끝**(11/1 `8c7b53d`, 이 브랜치에 푸시), 로컬 실제 서버 확인(5.3) 남음. #91은 11/1 develop 머지(`ed3b206`)
> 관련: BE PR #91 `feature/repo-server-frame-batch-inference`(김유진, 10/31 열림)의 [계획 0084](../plans/active/0084-server-3s-frame-batch-inference.md)·[ADR 0047](../decisions/0047-posture-from-deviation-probability.md)·[API 명세](api-spec.md) 9·11장, [연동 명세](api-ws-spec.md) 5장, [FE 제안서](fe-server-proposal.md) 1.0·BE-5 ②·BE-8·**BE-14(이 일의 요청·질문)**, [ADR 0021](../decisions/0021-app-sends-information-server-judges.md)(판정은 서버), [ADR 0029](../decisions/0029-midnight-cut-and-server-time.md)(자정 넘김)

## 0. 요약

- BE PR #91은 서버가 추론 결과를 약 3초 모아 프레임마다 판정하고, 앱에 보내는 `observation`을 **4.0**으로 바꾼다.
- develop의 앱은 4.0을 **버린다**(측정 화면에 점수가 안 나옴, 이 브랜치에서 고침). 그래서 #91이 develop에 들어오면 FE가 그 develop에 맞춰 대응하고 합친다.
- **FE 대응(1단계)**
  - `observation`은 쓰는 필드만 검사한다. 그러면 3.0과 4.0을 모두 받는다.
  - `modelVersion`을 기록에 쓰지 않는다.
  - `posture: 'bad'`가 오면 확정 전 주의 문구를 띄운다.
  - 가짜 서버·시험·문서를 함께 고친다.
- **합병 순서:** #91 develop 머지 → FE 브랜치를 새 develop에 맞춤 → FE 1단계 → 로컬 실제 서버 확인 → FE PR·머지 → 포크(운영 화면) → 운영 서버 재배포(DevOps). 자세한 것은 5장.
- 요청·질문(재배포 순서, `settling`, 자정 확인, `stalled`, 알림 지연)은 [FE 제안서 BE-14](fe-server-proposal.md)에 둔다.

## 1. BE가 바꾼 것 (PR #91, 10/31 기준)

| # | 변경 | 앱에 주는 영향 |
| --- | --- | --- |
| 1 | 앱 → 서버 메시지(`hello`·`features`·`end`, `posture.frames.v1`)는 **그대로** | 없음 |
| 2 | 서버는 구간을 받으면 바로 추론에 넘긴다. **판정 엔진이 결과를 약 3초(서버 시계) 모아** 프레임마다 판정한다(계획 0084 19~20번) | 판정 결과가 최대 약 3초 늦게 온다(4장) |
| 3 | `ack`는 추론에 넘긴 뒤 **바로** 온다. `observation`·`decision`·`alert`·`progress`는 묶음 처리 뒤에 온다 | `ack`는 「받음」이다. 앱은 `ack`를 표시에만 쓴다 |
| 4 | `observation` **4.0**: `valid`·`posture`(새로)·`collapse_probability`·`invalid_reason`만 있다. `sequence`·`start_ms`·`end_ms`·`phase`·`valid_ms`·`deviation_type`·`model_version`은 빠진다 | 2장 |
| 5 | `observation`은 묶음마다 1개이고, 묶음의 **마지막 판정 가능 프레임** 값이다 | 점수가 약 3초마다 바뀐다 |
| 6 | `posture`: `collapse_probability ≥ threshold`(기본 0.7)이면 `bad`, 아니면 `good`, `valid:false`면 `null`(ADR 0047). **그 순간의 판정**이라 3초 확정 **전**에 온다. 3초 카운트는 BE가 `t_ms`로 하고 확정은 지금처럼 `decision`·`alert`로 온다 | 주의 단계(3장 3번). 앱은 3초를 세지 않는다 |
| 7 | `valid_ms`는 판별 가능한 프레임 시간만 더한다 | BE-5 ②가 닫힌다. 앱은 바꿀 것 없음 |
| 8 | 추론 결과가 `result-timeout`(기본 2초) 안에 안 오면 그 구간은 누락이고 서버가 `stalled`를 보낸다 | 「분석이 잠시 멈췄어요」가 예전보다 자주 뜰 수 있다(6장) |
| 9 | 자정 넘김 전에 묶음을 비운다. 묶음은 두 세션에 걸치지 않는다 | `session_rollover` 처리는 그대로다. 10/31 자정 확인은 #91 **전** 서버였다(6장) |
| 10 | 추론 전송 `http`(기본)·`kafka`(`POSEGOOD_INFERENCE_TRANSPORT`). 서버 compose: io-api와 inference 이미지를 **같이** 새로 빌드해야 하고(`/v3/infer`), inference는 Kafka `healthy`가 필요하다 | 앱이 받는 메시지는 같다. 재배포는 DevOps(5장) |

**바뀌지 않는 것:** `ready`·`decision`·`alert`·`closed`·`session_rollover` 형식, REST API, DB. `decision`·`alert`의 `deviation_type`은 학습 모델로 바꿀 때까지 그대로 온다(ADR 0047 5절 보류).

## 2. 앱 영향 (develop `3d2fdfd` 코드로 확인)

앱이 `observation`에서 읽는 것은 `valid`·`collapse_probability`·`invalid_reason` 세 개뿐이다.
- `LiveSessionPage.tsx`: 29·45·46·204행
- `useLiveSession.ts`: 165행
- `useSessionPersistence.ts`: 240행의 `model_version`(기록 꼬리표)

| 위치 | 지금 | 4.0이 오면 | 할 일 |
| --- | --- | --- | --- |
| `features/session/live/messages.ts` `LiveObservation`·`validObservation` | `sequence`·`start_ms`·`end_ms`·`deviation_type`도 검사 | 메시지를 **버린다**. 점수가 안 나오고 계속 「자세를 확인할 수 없어요」 | 쓰는 세 필드만 검사한다. 타입은 4.0 기준이고 `posture`는 선택. 3.0도 통과 |
| `features/session/useSessionPersistence.ts:240` | `model_version ?? 'unmeasured'`를 기록에 저장 | 모든 기록이 `'unmeasured'` | 쓰지 않는다 |
| `features/storage/types.ts:38`·`validation.ts:150` | `server.modelVersion` 필수 | 위와 연결 | 선택 필드로 바꾼다. 값이 있으면 지금처럼 검사하고 예전 기록도 그대로 읽힌다 |
| `lib/comparison.ts:106·133` | 모델 버전이 다르거나 없으면 경고 | 의미 없는 경고 | 모델 버전 집계·경고를 지운다(쓰는 곳은 시험뿐) |
| `features/session/live/LiveSessionPage.tsx`·`styles/session.css` | 확정 전에는 문구·색이 「바른 자세예요」 그대로 | — | `posture` 주의 단계(3장 3번) |
| `scripts/fake-server.mjs` | 3.0 `observation`을 바로 보냄 | 로컬 개발에서 4.0을 볼 수 없다 | 4.0(`posture` 포함)과 약 3초 묶음을 흉내 낸다. `ack`는 바로 |
| 시험(`LiveSession.test.ts`, `comparison.test.ts`, `serverRecords.test.ts` 등) | 3.0 예시, `modelVersion` 필수 | 실패하거나 의미 없음 | 4.0 예시, 3.0도 통과, 주의 단계 |

- `head_turn` 안내(`LiveSessionPage.tsx:204`)는 그대로 둔다. 이제 묶음의 마지막 판정 가능 프레임 기준이라 화면 확인 때 너무 자주·늦게 뜨는지 본다.
- 앱에는 `ack` 뒤 판정을 기다리는 타이머가 없다(`ready` 5초·종료 10초뿐). 3초 지연 때문에 측정이 실패하지 않는다.
- FE에 남은 자세 판별 코드는 없다(10/30 확인).

## 3. 정한 것

| # | 내용 | 정한 것 | 이유 |
| --- | --- | --- | --- |
| 1 | `observation` 검사 | **쓰는 세 필드만**(`valid` boolean, `collapse_probability` 숫자, `invalid_reason` 문자열 또는 null). 결과적으로 3.0도 통과한다(11/1). 타입·시험 예시는 4.0 하나로 두고 3.0용 분기·변환은 넣지 않는다. 3.0 통과 시험은 **전환 기간용**이며 운영 서버가 4.0이 되면 지운다 | 앱의 원래 규칙(형식 확인은 쓰는 모양만, 10/21 결정)이다. 포크와 운영 서버 반영 순서가 어긋나도 화면이 깨지지 않는다 |
| 2 | 기록의 `modelVersion` | 선택 필드로 바꾸고 새로 쓰지 않는다. 모델 버전 경고는 지운다 | 판정 결과가 아니라 꼬리표다. BE가 뺀 이유(계획 0084 7번)와 같다 |
| 3 | 측정 화면 경고 단계 | `posture === 'good'` → 「바른 자세예요」(초록). `posture === 'bad'`이고 확정 전 → **「자세가 흐트러지고 있어요」**(새 주의 색, 소리·토스트·팝업 없음). `decision` 확정(`alerting`) → 「자세가 흐트러졌어요」(빨강) + 소리·토스트·팝업(지금 그대로). 문구·색은 PR에서 화면 담당(lellon0403) 리뷰(11/1) | 지금은 확정 전에 점수만 내려간다. 판정은 서버 `posture`를 그대로 쓰고 앱은 점수로 재지 않는다(ADR 0021). 3.0 서버는 `posture`가 없어 이 단계가 안 나타날 뿐이다. 모르는 값이면 주의를 띄우지 않는다 |
| 3-1 | 점수 | **그대로 둔다(11/1).** 점수 = `100 × (1 − collapse_probability)`(`lib/postureScore.ts`) | 판정이 아니라 표시용 변환이다. 경고는 `posture`·`decision`으로 정한다. 값은 규칙 점수라 보정된 확률이 아니다(ML 재설계 224행) |
| 4 | 첫 `observation` 전 표시 | 로컬 확인 뒤 정한다 | 최대 약 3초 동안 서버 값이 없어 「자세를 확인할 수 없어요」가 잠깐 뜰 수 있다. 필요하면 화면 담당과 문구를 정한다(2단계) |

## 4. 3초 묶음이 화면에 주는 영향

판정 기준 시각은 그대로 앱 시계(`t_ms`)다. 늦어지는 것은 **결과를 보내는 시각**이다.

| 항목 | 늦어지나 | 내용 |
| --- | --- | --- |
| 주의 「자세가 흐트러지고 있어요」(`posture: 'bad'`) | 예, 0~3초 | 나빠진 프레임이 든 묶음이 처리될 때 온다. 확정보다는 먼저다 |
| 강한 경고·알림(`decision`·`alert`) | 예, 0~3초 | 3초 이어짐 확정은 `t_ms` 기준 그대로다. 결과만 다음 묶음 처리 때 온다 |
| 바로 앉았을 때 경고가 꺼지는 것 | 예, 0~3초 | 회복도 `decision`이다 |
| 점수 | 약 3초마다 한 번 바뀜 | 지금은 부드럽게 바뀐다 |
| 측정 시작 직후 | 첫 0~3초 서버 값 없음 | 3장 4번 |
| `head_turn` 안내 | 예, 0~3초 | 서버가 판정하기 때문이다 |
| 어깨가 안 보일 때 「확인할 수 없어요」 | **아니요** | 앱이 바로 표시한다(`placeable`) |
| 쉬기·자리 비움 | **아니요** | 서버가 3초를 기다리지 않는다 |
| 측정 종료·연결 끊김·자정 | 최대 2초 | 남은 결과를 `result-timeout`까지 기다린 뒤 판정한다. 앱의 종료 대기(10초) 안이다 |
| 기록 숫자(유지율·시간) | **아니요** | 판정은 `t_ms` 기준이다. `valid_ms`는 더 정확해진다 |

줄이는 방법은 서버 설정 `POSEGOOD_REALTIME_BATCH_WINDOW`(기본 `3s`)다. 대가는 추론 호출 수다(동시 50명 어림값: `3s` 약 17번/초, `1s` 약 50번/초, `0s` 약 500번/초).

## 5. 합병 계획

### 5.1 필요한 것

| # | 필요한 것 | 상태 |
| --- | --- | --- |
| 1 | #91이 develop에 머지됨 | 끝(11/1 `ed3b206`) |
| 2 | 이 브랜치(`docs/fe-3sec-replan`)를 새 develop에 맞춤. `fe-3sec.md`는 #91도 계획 번호 3줄(0064 → 0084)을 고쳐 충돌이 난다 — 번호는 이미 반영했으니 **FE 쪽 내용을 고른다** | 끝(11/1 `430c75e`) |
| 3 | 1단계 코드·시험(2장 표) | 끝(11/1) |
| 4 | 로컬 실제 서버 확인: #91이 들어간 develop으로 API·추론 서버(`tools/dev.py dev-server`와 같은 구성) + 이 브랜치 앱(`browser-smoke` 합성 카메라, `'normal'`·`'deviation'` 섞기) | 남음 — Docker Desktop이 꺼져 있어 못 함(11/1). 서버 jar 빌드·Kafka 라이브러리 설치는 끝 |
| 5 | 문서: 연동 명세 5.1·5.3, FE 제안서 1.0 표·BE-5 ②·BE-8 닫기, ADR 0021 4절 8번·ADR 0005 이력, BE-14 결과 | 끝(11/1, BE-14 결과는 확인 뒤) |
| 6 | `npm run check`(typecheck·lint·전체 시험·build) 통과 | 끝(11/1) — 시험 933개 중 932 통과, 실패 1개는 develop에도 있는 로케일 문제(`recordTimezone.test.tsx`) |

### 5.2 순서

1. #91 develop 머지(BE).
2. 이 브랜치를 develop에 맞추고(5.1 #2) 1단계 코드·가짜 서버·시험.
3. 로컬 실제 서버 확인(5.3).
4. 문서 반영 → `npm run check`.
5. FE PR → 리뷰(팀장, 주의 문구·색은 lellon0403) → 머지.
6. 포크 최신화(운영 화면). 이때부터 운영 앱은 3.0·4.0을 모두 받는다.
7. 운영 서버 재배포(DevOps): io-api·inference를 같이 새로 빌드. **6번 뒤에.** 반대면 운영 측정 화면에 점수가 안 나온다.
8. 운영에서 측정 한 번.

- develop 머지는 운영에 자동 반영되지 않는다. 자동 배포(`deploy.yml`)는 `main`·`release`만이고, 학교 서버는 DevOps가 이미지를 새로 빌드해야 바뀐다.
- 1~5 사이에는 develop으로 띄운 로컬 서버에서 측정 화면 점수가 안 나온다. 그래서 FE를 빨리 뒤따라 넣는다.

### 5.3 완료 기준 (로컬 실제 서버 확인)

- 측정 화면에 점수가 나오고 약 3초마다 바뀐다.
- `'deviation'` 프레임을 이어 보내면 **주의 → 확정(소리) → 회복** 순서로 바뀌고, 주의 단계에서는 소리·팝업이 없다.
- 첫 3초 표시, 주의 깜빡임, `head_turn` 표시를 기록한다(2단계 판단 자료).
- `stalled`가 얼마나 자주 뜨는지 기록한다.
- 종료 뒤 R1에 기록이 있고 `modelVersion` 없이도 기록·달력이 정상이다. 예전 기록(`modelVersion` 있음)도 그대로 보인다.
- 지금 서버(3.0)와도 그대로 동작한다(시험으로 확인).

## 6. 확인할 것

- **자정 넘김:** 10/31 확인(로컬, 통과)은 #91 **전** 서버였다. #91은 넘김 전에 묶음을 비우고 남은 결과를 기다린다. 무엇으로 다시 확인할지는 BE-14에서 정한다. 11/2(월) 정식 서버 확인 때 서버가 #91 전인지 후인지 기록한다.
- **`stalled` 빈도:** 결과가 2초 안에 안 오면 누락과 `stalled`다. 5.3에서 본다.
- **`invalid_reason` 값:** 계약에는 `unmeasurable`·`head_turn`·`settling`이 있다. 앱은 모르는 값을 「얼굴과 어깨가 보이지 않아요」로 보인다. 그대로 둔다.
- **`posture` 값 이름:** `good`·`bad`는 BE가 정했다(ADR 0047). ML 확인에 따라 바뀌면 3장 3번 조건만 맞춘다.
- **주의 깜빡임:** `posture`는 묶음의 마지막 프레임 하나의 값이라 기준선 근처에서 3초마다 켜졌다 꺼질 수 있다. 5.3에서 보고 거슬리면 2단계에서 정한다.

## 7. 범위

- **1단계(이번 합병):** 2장의 앱 코드·시험, `posture` 주의 단계, 가짜 서버, 문서
- **안 바꿈:** 앱이 보내는 메시지, 점수 계산, `decision`·`alert`·`session_rollover` 처리, REST, 계약 파일(#91이 이미 4.0으로 바꿈)
- **2단계(필요할 때만):** 첫 3초 문구, 주의 깜빡임 대책 — 5.3 결과를 보고 화면 담당과
- **제외:** `decision`·`alert`의 `deviation_type` 삭제(BE 보류), 짧은 가림 유지 규칙(ML 요청, BE 검토 중), Kafka 경로

## 8. 작업 단계

- [x] #91 develop 머지 확인 → 이 브랜치를 develop에 맞춤(`fe-3sec.md`는 FE 쪽, 11/1)
- [x] `messages.ts` 쓰는 필드만 검사(3.0·4.0), 타입 4.0
- [x] `modelVersion` 선택 필드, 기록에 안 씀, 모델 버전 경고 삭제
- [x] `posture` 주의 단계: `headline()`·`tone`, `.pill` 주의 색
- [x] 가짜 서버 4.0(`posture` 포함)·약 3초 묶음
- [x] 시험: 4.0·3.0 모두 받음, 점수·판정 불가·`head_turn`, 주의 → 확정 순서의 문구·색과 소리, 예전 기록 읽기
- [ ] 로컬 실제 서버 확인(5.3)
- [x] 문서: 연동 명세 5.1·5.3, FE 제안서 1.0 표·BE-5 ②·BE-8·BE-14, ADR 0021·0005
- [x] `npm run check`
- [ ] FE PR·머지 → 포크 → 운영 서버 재배포(DevOps) → 운영 측정 한 번
- [ ] 운영 서버가 4.0이 된 뒤 전환 기간용 3.0 통과 시험 삭제

## 9. 진행 기록

- 2026-10-30: BE 공지를 받아 develop `760b322` 코드와 대조했다. 공지에 없는 가짜 서버를 더했다. 기록 `modelVersion`과 측정 화면 경고 두 단계를 정했다.
- 2026-11-01: BE PR #91(10/31 흐름 변경·Kafka 전송, 계획 0064 → 0084, ADR 0045 → 0047)을 반영해 합병 계획으로 다시 세웠다.
  - `observation`은 쓰는 필드만 검사해 3.0·4.0을 모두 받는다. 「같은 날 배포」는 필요 없다. #91이 들어간 develop에 맞춰 FE를 하고, 운영 서버 재배포만 포크 반영 뒤로 한다.
  - 점수 계산은 표시용 변환이라 그대로 둔다. `posture: 'bad'`는 3초 확정 **전** 순간 판정이라 주의 문구를 1단계에 넣는다(3초 카운트·확정은 BE `decision`).
  - BE·DevOps에 할 요청·질문은 FE 제안서 BE-14로 옮겼다.
- 2026-11-01: #91이 develop에 머지됐다(`ed3b206`). 이 브랜치에 develop을 합쳤다(`fe-3sec.md` 충돌은 FE 쪽).
- 2026-11-01: 1단계 코드. BE 계약 예시(`ws-observation*.json`)로 지금 앱이 4.0을 버리는 것을 시험으로 재현한 뒤 고쳤다(`messages.test.ts`). `modelVersion` 선택 필드·모델 버전 경고 삭제, `posture` 주의 단계(`.pill.caution`, `--warn` 토큰), 가짜 서버 4.0·3초 묶음(`FAKE_BATCH_MS`, 기본 3000 — 실행해 `ack` 바로·`observation`·`progress` 묶음마다 확인). 연동 명세 5.1·5.3, 제안서 BE-5 ②·BE-8 반영. typecheck·lint(바꾼 파일 경고 0)·build 통과. 로컬 실제 서버 확인(5.3)은 Docker가 꺼져 있어 남았다.
- 2026-11-01: 1단계를 `docs/fe-3sec-replan`에 푸시했다(`8c7b53d`, PR 없음). ADR 0021 4절에 8번(측정 화면 상태는 서버 값 그대로 — 주의 단계, 쓰는 필드만 검사, `modelVersion` 안 씀)을, ADR 0005 이력에 4.0에서도 점수 식이 같다는 것을 적었다. 남은 것: 5.3(Docker 필요) → FE PR(말할 때) → 포크 → 운영 재배포.
