# FE 계획: 서버 3초 묶음 판정(`observation` 4.0)에 앱 맞추기

> 작성자: klaod-tech(FE) · 작성: 2026-10-30 · 다시 세움: 2026-11-01(BE PR #91 반영) · 상태: **계획**(코드 수정 전)
> 관련: BE PR #91 `feature/repo-server-frame-batch-inference`(김유진, 10/31 열림)의 [계획 0084](../plans/active/0084-server-3s-frame-batch-inference.md)·[ADR 0047](../decisions/0047-posture-from-deviation-probability.md)·[API 명세](api-spec.md) 9·11장(develop에 없으면 PR #91에서 읽는다), [연동 명세](api-ws-spec.md) 5장, [FE 제안서](fe-server-proposal.md) 1.0·BE-5 ②·BE-8, [ADR 0021](../decisions/0021-app-sends-information-server-judges.md)(판정은 서버), [ADR 0029](../decisions/0029-midnight-cut-and-server-time.md)(자정 넘김)

## 0. 요약 (11/1 다시 세운 것)

- BE가 PR #91을 올렸다. 서버가 좌표 추론 결과를 약 3초 모아 프레임마다 판정하고, 앱에 보내는 `observation`을 **4.0**으로 바꾼다. 지금 앱은 4.0을 **버린다**. 그래서 측정 화면에 점수가 안 나온다.
- **바꾼 계획:** 앱은 `observation`에서 **쓰는 필드만** 검사한다(`valid`·`collapse_probability`·`invalid_reason`). 그러면 3.0과 4.0을 **둘 다** 받는다.
  - 10/30 계획은 「BE·FE 두 PR을 같은 날 넣는다」였다. 이제는 **FE를 먼저** 넣고, 서버는 준비되는 날 바꾸면 된다.
  - 옛 서버를 따로 지원하려는 것이 아니다. 앱이 원래 정한 「쓰는 모양만 확인」(`messages.ts` 머리 주석)으로 돌아가는 것이다.
- **1단계(이번 PR):** 4.0을 받아도 지금 화면이 그대로 동작하게만 한다. 고칠 것은 `messages.ts`, `modelVersion`, 가짜 서버, 시험, 문서다.
- **2단계(따로):** `posture: 'bad'`를 쓰는 「무너지기 시작」 화면 알림이다. 새 기능이라 화면 담당과 정한 뒤에 한다.
- **3단계(BE 보류):** `decision`·`alert`의 `deviation_type`을 뺀다. 학습 모델로 바꿀 때 BE가 다시 공지한다.

## 1. BE가 바꾼 것 (PR #91, 10/31 기준)

| # | 변경 | 앱에 주는 영향 |
| --- | --- | --- |
| 1 | 앱 → 서버 메시지(`hello`·`features`·`end`, `posture.frames.v1`)는 **그대로** | 없음 |
| 2 | 서버는 구간을 받으면 바로 추론에 넘긴다. **판정 엔진이 결과를 약 3초(서버 시계) 모아** 프레임마다 판정한다(10/31 흐름 변경, 계획 0084 19~20번) | 판정 결과가 최대 약 3초 늦게 온다(4장) |
| 3 | `ack`는 추론에 넘긴 뒤 **바로** 온다. `observation`·`decision`·`alert`·`progress`는 묶음 처리 뒤에 온다 | `ack`는 「저장됨」이 아니라 「받음」이다. 앱은 `ack`를 표시에만 쓴다 |
| 4 | `observation` **4.0**: `valid`·`posture`(새로)·`collapse_probability`·`invalid_reason`만 있다. `sequence`·`start_ms`·`end_ms`·`phase`·`valid_ms`·`deviation_type`·`model_version`은 빠진다 | 2장 |
| 5 | `observation`은 묶음마다 1개이고, 묶음의 **마지막 판정 가능 프레임** 값이다 | 점수가 약 3초마다 바뀐다 |
| 6 | `posture`: `collapse_probability ≥ threshold`(기본 0.7)이면 `bad`, 아니면 `good`, `valid:false`면 `null`이다(ADR 0047, BE 채택 10/30). 3초 확정은 지금처럼 `decision`·`alert`다 | 2단계에서 쓴다 |
| 7 | `valid_ms`는 판별 가능한 프레임 시간만 더한다 | BE-5 ②가 닫힌다. 앱은 바꿀 것 없음 |
| 8 | 추론 결과가 `result-timeout`(기본 2초) 안에 안 오면 그 구간은 누락이고 서버가 `stalled`를 보낸다 | 「분석이 잠시 멈췄어요」가 예전보다 자주 뜰 수 있다(5장) |
| 9 | 자정 넘김 전에 묶음을 비운다. 묶음은 두 세션에 걸치지 않는다 | `session_rollover` 처리는 그대로다. 다만 10/31 자정 확인은 PR #91 **전** 서버였다(5장) |
| 10 | 추론 전송은 `http`(기본) 또는 `kafka`(`POSEGOOD_INFERENCE_TRANSPORT`) | 앱이 받는 메시지는 같다 |

**바뀌지 않는 것:** `ready`·`decision`·`alert`·`closed`·`session_rollover` 형식, REST API, DB. `decision`·`alert`의 `deviation_type`은 학습 모델로 바꿀 때까지 그대로 온다(ADR 0047 5절 보류).

## 2. 앱 영향 (develop `3d2fdfd` 코드로 확인)

앱이 `observation`에서 읽는 것은 `valid`·`collapse_probability`·`invalid_reason` 세 개뿐이다.
- `LiveSessionPage.tsx`: 29·45·46·204행
- `useLiveSession.ts`: 165행
- `useSessionPersistence.ts`: 240행의 `model_version`(기록 꼬리표)

| 위치 | 지금 | 4.0이 오면 | 1단계에서 할 일 |
| --- | --- | --- | --- |
| `features/session/live/messages.ts` `LiveObservation`·`validObservation` | `sequence`·`start_ms`·`end_ms`·`deviation_type`도 검사 | 메시지를 **버린다**. 점수가 안 나오고 계속 「자세를 확인할 수 없어요」 | 쓰는 세 필드만 검사한다. 타입은 4.0 기준이고 `posture`는 선택. 3.0도 통과 |
| `features/session/useSessionPersistence.ts:240` | `model_version ?? 'unmeasured'`를 기록에 저장 | 모든 기록이 `'unmeasured'` | 쓰지 않는다 |
| `features/storage/types.ts:38`·`validation.ts:150` | `server.modelVersion` 필수 | 위와 연결 | 선택 필드로 바꾼다. 예전 기록도 그대로 읽힌다 |
| `lib/comparison.ts:106·133` | 모델 버전이 다르거나 없으면 경고 | 의미 없는 경고 | 모델 버전 경고를 지운다 |
| `scripts/fake-server.mjs` | 3.0 `observation`을 바로 보냄 | 로컬 개발에서 4.0을 볼 수 없다 | 4.0과 약 3초 묶음을 흉내 낸다 |
| 시험(`LiveSession.test.ts`, `comparison.test.ts`, `serverRecords.test.ts` 등) | 3.0 예시, `modelVersion` 필수 | 실패하거나 의미 없음 | 4.0 예시를 쓰고 3.0도 통과하는지 시험한다 |
| 측정 화면(`LiveSessionPage.tsx`) | `valid`·`invalid_reason`·`collapse_probability`로 표시 | 이름이 같아 그대로 동작 | 확인만 한다 |

- `head_turn` 안내(`LiveSessionPage.tsx:204`)는 그대로 둔다. 다만 이제 묶음의 마지막 판정 가능 프레임 기준이다. 화면 확인 때 너무 자주 뜨거나 너무 늦게 뜨는지 본다.
- 앱에는 `ack` 뒤 판정을 기다리는 타이머가 없다(`ready` 5초·종료 10초뿐). 3초 지연 때문에 측정이 실패하지 않는다.
- FE에 남은 자세 판별 코드는 없다(10/30 확인).

## 3. 정한 것

| # | 내용 | 정한 것 | 이유 |
| --- | --- | --- | --- |
| 1 | `observation` 검사 | **쓰는 세 필드만**(`valid` boolean, `collapse_probability` 숫자, `invalid_reason` 문자열 또는 null). 3.0·4.0 모두 받는다(11/1) | 앱의 원래 규칙(형식 확인은 쓰는 모양만, 10/21 결정)이다. 배포 순서 위험이 없어진다(7장) |
| 2 | 기록의 `modelVersion` | 선택 필드로 바꾸고 새로 쓰지 않는다. 모델 버전 경고는 지운다 | 판정 결과가 아니라 꼬리표다. BE가 뺀 이유(계획 0084 7번)와 같다. 예전 기록은 그대로 읽는다 |
| 3 | 측정 화면 경고 단계 | **2단계로 미룬다.** ① `posture === 'bad'`이면 측정 화면 알림 시작, ② 서버 `decision`이면 지금처럼 강한 경고 + 알림 | ①은 지금 앱에 없는 새 기능이다. 문구·모양·깜빡임(7장)을 화면 담당(lellon0403)과 정해야 한다. 1단계는 동작 유지만 한다 |
| 4 | 측정 시작 직후 첫 `observation` 전 표시 | 1단계 화면 확인 뒤 정한다 | 최대 약 3초 동안 서버 값이 없어 「자세를 확인할 수 없어요」가 잠깐 뜰 수 있다. 「판정 준비 중」 같은 문구가 필요하면 화면 담당과 정한다 |
| 5 | 알림 최대 3초 지연 | 팀장 회신을 기다린다. FE 의견: 받아들일 만하다 | BE가 팀장·FE 확인을 요청했다(계획 0084 18번) |

## 4. 3초 묶음이 화면에 주는 영향

판정 기준 시각은 그대로 앱 시계(`t_ms`)다. 늦어지는 것은 **결과를 보내는 시각**이다. 서버가 결과를 약 3초 모았다가 한 번에 판정하고, 그때 결과를 몰아서 보낸다.

| 항목 | 늦어지나 | 내용 |
| --- | --- | --- |
| 강한 경고·알림(`decision`·`alert`) | 예, 0~3초 | 3초 이어짐 확정은 `t_ms` 기준 그대로다. 결과만 다음 묶음 처리 때 온다 |
| 바로 앉았을 때 경고가 꺼지는 것 | 예, 0~3초 | 회복도 `decision`이다 |
| 점수 | 약 3초마다 한 번 바뀜 | 지금은 부드럽게 바뀐다 |
| 측정 시작 직후 | 첫 0~3초 서버 값 없음 | 3장 4번 |
| `head_turn` 안내 | 예, 0~3초 | 서버가 판정하기 때문이다 |
| 어깨가 안 보일 때 「확인할 수 없어요」 | **아니요** | 앱이 바로 표시한다(`placeable`) |
| 쉬기·자리 비움 | **아니요** | 서버가 3초를 기다리지 않는다 |
| 측정 종료·연결 끊김·자정 | 최대 2초 | 남은 결과를 `result-timeout`까지 기다린 뒤 판정한다. 앱의 종료 대기(10초) 안이다 |
| 기록 숫자(유지율·시간) | **아니요** | 판정은 `t_ms` 기준이다. `valid_ms`는 더 정확해진다 |

줄이는 방법은 서버 설정 `POSEGOOD_REALTIME_BATCH_WINDOW`(기본 `3s`)다. 대가는 추론 호출 수다(동시 50명 어림값: `3s` 약 17번/초, `1s` 약 50번/초, `0s` 프레임마다 약 500번/초).

## 5. 확인할 것

- **자정 넘김 다시 확인:** 10/31 자정 확인(로컬, 통과)은 PR #91 **전** 서버였다. #91은 넘김 전에 묶음을 비우고 남은 결과를 기다린다(1장 9번). 그래서 #91 서버와 FE 1단계 브랜치를 함께 띄워 넘김 시험을 한 번 더 한다.
  - 실제 자정 실행이 어렵다. 로컬 rollover 확인 스크립트(10/31)를 쓰거나, 서버 단위 시험(`RealtimeHandlerV2Test` 자정 뒤 `t_ms` 이동)으로 대신할지 BE와 정한다.
  - 11/2(월) 정식 서버 자정 확인은 그때 서버가 #91 전인지 후인지를 기록한다.
- **`stalled` 빈도:** 결과가 2초 안에 안 오면 누락과 `stalled`다. 특히 `kafka` 전송에서 그렇다. 로컬(`http`)에서 측정 화면에 「분석이 잠시 멈췄어요」가 자주 뜨는지 본다.
- **`invalid_reason` 값:** 계약에는 `unmeasurable`·`head_turn`·`settling`이 있다. 앱은 모르는 값을 「얼굴과 어깨가 보이지 않아요」로 보인다. 그대로 둔다.

## 6. 범위

- **1단계에서 바꿈:** 2장의 앱 코드·시험, 가짜 서버, 문서(연동 명세 5.1·5.3, FE 제안서 1.0 표·BE-5 ②·BE-8)
- **안 바꿈:** 앱이 보내는 메시지, `decision`·`alert`·`session_rollover` 처리, REST, 계약 파일(PR #91이 이미 4.0으로 바꿈)
- **2단계:** `posture` 기반 「무너지기 시작」 알림(3장 3번), 첫 3초 문구(3장 4번)
- **제외:** `decision`·`alert`의 `deviation_type` 삭제(BE 보류), 짧은 가림 유지 규칙(ML 요청, BE 검토 중 — 받으면 `observation` 판정 불가 표시가 바뀔 수 있음), Kafka 경로

## 7. 위험

- **배포 순서:** 1단계를 넣은 앱은 3.0·4.0을 모두 받는다. 그래서 **FE를 먼저** 넣고 포크(운영)에 올려 두면, 서버를 언제 바꿔도 화면이 깨지지 않는다.
  - 반대로 FE 1단계 전에 서버를 먼저 바꾸면 운영 측정 화면에서 점수가 사라진다. BE·DevOps에 「FE 1단계 배포 뒤 서버 반영」을 부탁한다.
- **`posture` 값 이름:** `good`·`bad`는 BE가 정했다(ADR 0047). ML 확인에 따라 바뀔 수 있다. 1단계는 `posture`를 쓰지 않아 영향이 없다. 2단계 전에 다시 확인한다.
- **① 깜빡임(2단계):** `posture`는 묶음의 마지막 프레임 하나의 값이다. 기준선 근처에서는 3초마다 켜졌다 꺼질 수 있다.

## 8. 작업 단계

1단계 (FE, PR 하나)
- [ ] 브랜치: 최신 develop에서 만든다. PR #91 브랜치는 10/31 develop을 합쳐 두어서 로컬 시험에 그대로 쓴다
- [ ] `messages.ts` 쓰는 필드만 검사(3.0·4.0), 타입 4.0
- [ ] `modelVersion` 선택 필드, 기록에 안 씀, 모델 버전 경고 삭제
- [ ] 시험: 4.0·3.0 `observation` 모두 받음, 4.0에서 점수·판정 불가·`head_turn` 표시, 예전 기록(`modelVersion` 있음·없음) 읽기
- [ ] 가짜 서버 4.0·약 3초 묶음
- [ ] 로컬 실제 서버 확인: PR #91 브랜치 jar + FE 브랜치 → 첫 3초, 점수 갱신, 경고·회복, 종료, `head_turn`, `stalled` 빈도, 자정 넘김(5장)
- [ ] 문서: 연동 명세 5.1·5.3, FE 제안서 1.0 표·BE-5 ②·BE-8 닫기
- [ ] `npm run check`, 바꾼 파일 lint
- [ ] 병합·배포: FE PR → 포크 최신화(운영) → BE PR #91 병합 → 서버 재배포(DevOps) → 운영에서 측정 한 번

2단계 (FE + 화면)
- [ ] 화면 담당과 ① 알림 문구·모양·깜빡임 대책, 첫 3초 문구
- [ ] 구현·시험

## 9. 물어볼 것

| # | 질문 | 누구 |
| --- | --- | --- |
| 1 | 「FE 1단계 배포 뒤 서버 반영」 순서로 해도 되나 | 김유진(BE), 홍규(DevOps) |
| 2 | 알림 최대 3초 지연을 받아들이나 | 팀장 |
| 3 | 2단계 ① 알림·첫 3초 문구를 같이 정할 시점 | lellon0403 |
| 4 | PR #91 기준 자정 넘김을 무엇으로 확인할지(로컬 스크립트 / 단위 시험), 11/2 정식 서버 확인 때 서버 버전 | 김유진, 팀장 |

## 10. 진행 기록

- 2026-10-30: BE 공지를 받아 develop `760b322` 코드와 대조했다. 공지에 없는 가짜 서버를 더했다. 기록 `modelVersion`과 측정 화면 경고 두 단계를 정했다.
- 2026-11-01: BE PR #91(10/31 흐름 변경·Kafka 전송, 계획 0064 → 0084, ADR 0045 → 0047)을 반영해 다시 세웠다.
  - `observation`은 쓰는 필드만 검사해 3.0·4.0을 모두 받기로 했다. 그래서 「같은 날 배포」 대신 FE를 먼저 넣는다.
  - 「무너지기 시작」 알림은 2단계로 나눴다.
  - PR #91의 자정 넘김 변경(묶음 비우기·결과 대기)으로 넘김을 다시 확인할 것과 `stalled` 빈도를 더했다.
