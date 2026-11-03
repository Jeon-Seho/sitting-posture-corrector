# 실시간 측정 다시 만들기 — 프론트 정리

기준: 2026-11-03. develop `096cc3c`(PR #95로 #91·#92를 되돌린 상태, 코드는 10/29 검증 때 `3d2fdfd`와 같다),
BE `feature/repo-realtime-observation4` `45c5c19`(`observation` 4.0, PR 전), FE `feature/fe-3sec-batch-observation4`.
경위, 3초를 세는 방법, BE에 요청해 반영된 4.0 형식, FE 구현과 남은 것을 적는다.

## 무슨 일이 있었나

- 10/29: 앱이 프레임을 보내고 서버가 점수·판정·3초 확정을 모두 하는 구조로 운영 연결까지 검증했다(브라우저 10항목, 통합 시험 80/0/2).
- #91(11/1 develop): 서버가 추론 결과를 서버 시계 3초마다 모아 판정하고 보냈다. 판정 자체는 `t_ms` 기준으로 정확했지만 전송이 3초 주기에 묶였다.
- 로컬 실제 서버 + 합성 카메라로 잰 값(기본 묶음 3초):

| 항목 | 값 |
| --- | --- |
| 점수가 바뀌는 간격 | 약 3.25초 |
| 고개 숙임 → 경고 확정 | 약 4.5초 |
| 바로 앉음 → 경고 꺼짐 | 약 5.9초(회복 3초 + 묶음 대기 최대 3초) |

- 원인: **점수 전달**과 **지속 판정(3초 확정·회복)**은 원래 따로 돌던 두 일인데, 3초 묶음 과정에서 한 주기로 합쳐졌다.
  WS를 쓰는 이유(즉시 반응)가 사라져 11/2 #95로 되돌렸다.
- 11/3: BE가 묶음 없이 구간마다 보내는 `observation` 4.0을 다시 만들었고(계획 0084 1단계), FE 요청(`sequence`·`hold_ms`·판정 불가 점수 `null`)을 같은 날 반영했다(계획 0084 27·28).

## 지킬 것

계획 0084 「최신 방향」과 같다. 앱은 판정하지 않는다(ADR 0021).

1. 추론 결과가 오면 점수(`posture` good/bad 포함)를 **그 자리에서** 앱에 보낸다.
2. 같은 결과를 지속 판정에 넣고, 확정·회복·리마인더가 나오면 **그 자리에서** `decision`을 보낸다.
3. 판정 시간은 촬영 시각 `t_ms`로 센다. 서버 도착 시각은 순서를 기다리는 데에만 쓴다.

BE 4.0 브랜치는 세 가지를 모두 지킨다. 순서는 구간마다 `observation` → (`decision` → `alert`) → `ack` → `progress`다.

### 3초를 세는 방법

「0~3초, 0.1~3.1초 …」 창을 매번 다시 보지 않는다. [Timeline.java](../../backend/api/src/main/java/org/posegood/api/engine/Timeline.java)·[DecisionRules.java](../../backend/api/src/main/java/org/posegood/api/engine/DecisionRules.java)처럼
세션마다 누적값 몇 개만 두면 프레임마다 같은 결과를 더하기 한 번으로 얻는다. BE 4.0도 이 방식 그대로다.

```
세션 상태: holdMs(나쁨 연속), recoveryMs(좋음 연속), active(경고 중), lastAlertMs

프레임 길이 d = 다음 프레임 t_ms − 이 프레임 t_ms (0.5초 넘는 부분은 빈틈으로 빼고 연속을 끊음)

bad  → holdMs += d, recoveryMs = 0
       !active && holdMs ≥ 3000 → COLLAPSE_CONFIRMED(한 번만), active = true
       active && 마지막 알림 뒤 reminderMs → REMINDER
good → holdMs = 0
       active: recoveryMs += d, recoveryMs ≥ 3000 → RECOVERY_CONFIRMED, active = false
판정 불가·쉬기·자리 비움·빈틈 → 제외 시간, holdMs = recoveryMs = 0
```

- 확정 시각은 holdMs가 3초를 넘은 프레임의 `t_ms`, 시작 시각은 첫 bad 프레임의 `t_ms`.
- 누적은 촬영 순서대로 넣는다. 지금은 서버가 한 세션의 메시지를 차례대로 처리해 순서가 지켜진다.
  추론을 비동기(Kafka)로 바꾸면 순번으로 짧게 기다리는 버퍼가 필요하다(#91의 `PendingIntervals`, 최대 2초). 키는 `session_id`.
- 부하는 3초 계산이 아니라 프레임마다의 추론 호출·DB 쓰기·메시지 수에서 생긴다.
  추론은 여러 세션을 0.1~0.2초씩 모아 부를 수 있지만, 판정과 전송은 결과가 오는 즉시 한다. DB에는 사건만 쓴다.

## `observation` 4.0 (BE `45c5c19`)

```json
{ "schema_version": "4.0", "sequence": 42, "valid": true, "posture": "bad", "collapse_probability": 0.82, "hold_ms": 1500, "invalid_reason": null }
{ "schema_version": "4.0", "sequence": 43, "valid": false, "posture": null, "collapse_probability": null, "hold_ms": 0, "invalid_reason": "unmeasurable" }
```

| 필드 | 뜻 | FE가 요청한 이유 |
| --- | --- | --- |
| `sequence` | 앱이 보낸 구간 순번(연결 기준, 자정 넘김 뒤에도 `ack`처럼) | 늦게 온 결과 버리기, 보낸 프레임과 맞춰 지연 재기, 빠진 결과 알기 |
| `valid` | 그 구간을 판정할 수 있었나 | 2초 bad 뒤 판정 불가면 바로 `valid: false`(#91의 「묶음에 하나라도 있으면 true」면 `bad`로 남음) |
| `posture` | `good`·`bad`, 3초 판정과 같은 기준(`DecisionRules.candidate`). 판정 불가면 `null` | 기준(0.7)은 서버가 적용, 앱은 점수 구간을 두지 않음 |
| `collapse_probability` | 화면 점수 = 100 × (1 − 값). 판정 불가면 `null` | 0이면 화면 100점과 같은 값이라 `valid` 검사를 하나만 빠뜨려도 100점이 보임 |
| `hold_ms` | 이 구간 끝까지 bad가 이어진 시간(`Timeline.holdMs`). good·판정 불가·쉬기·자리 비움·빈틈이면 0, 확정 뒤에도 bad면 계속 늚 | 붕괴 게이지를 서버가 센 값으로 그림. 앱이 세면 빈틈·끊김에서 서버와 어긋남 |
| `invalid_reason` | `valid`면 `null`, 아니면 `unmeasurable`·`head_turn`·`settling`(아직 안 보냄) | 판정 불가 문구 고르기 |

뺀 것: `start_ms`·`end_ms`·`phase`(`progress.paused_reason`)·`valid_ms`(`summary`)·`deviation_type`(`decision`에 있음)·`model_version`.
안내 문구는 「자세가 무너졌습니다. 바로 잡아주세요」 하나라 `deviation_type`이 필요 없다. 필드를 빼는 변경이라 FE와 함께 배포한다.

## FE 구현 (`feature/fe-3sec-batch-observation4`)

- [messages.ts](../../frontend/src/features/session/live/messages.ts): 판정 가능하면 점수는 숫자, 판정 불가면 `null`(3.0은 0). `sequence`·`posture`·`hold_ms`는 선택이라 운영 3.0도 읽는다. 운영 4.0 뒤 3.0 시험을 지운다.
- [LiveSession.ts](../../frontend/src/features/session/live/LiveSession.ts): 화면에 있는 결과보다 `sequence`가 작거나 같으면 버린다.
- [LiveSessionPage.tsx](../../frontend/src/features/session/live/LiveSessionPage.tsx): 아래 화면 상태. 붕괴 게이지(`holdProgress`)는 `hold_ms ÷ 정책 hold 시간`, 3.0이면 숨김.
- [serverRecords.ts](../../frontend/src/features/storage/serverRecords.ts): 서버가 `good_sec`를 0.1초 내림으로 저장하므로 같은 기준으로 비교한다. 프레임마다 판정하면 바른 자세 시간에 ms 끝자리가 생겨(38.35초 → 38.3초) #91 때 다음 측정이 막혔다.
- [fake-server.mjs](../../frontend/scripts/fake-server.mjs): 4.0을 구간마다 BE와 같은 순서로(`progress`만 약 1초마다).
- [realtime-observation.mjs](../../tools/browser/realtime-observation.mjs): 합성 카메라 실시간 시험 — 구간마다 점수, `sequence` 증가, 판정 불가 점수 `null`, 확정 때 `hold_ms` ≥ 3000, 두 번째 측정.

### 측정 화면 상태

| 상태 | 조건 | 위 표시 | 아래 안내 상자 | 점수 링 |
| --- | --- | --- | --- | --- |
| 첫 판정 전 | 사람이 잡힘 + 결과 아직 없음 | 「자세를 똑바로 해주세요」 회색 | 없음 | 비어 있음 |
| 바른 자세 | `posture: good` | 「바른 자세예요」 초록 | 없음 | 기본색 |
| 주의 | `posture: bad` + 확정 전 | 「자세가 흐트러지고 있어요」 노랑 | 노랑 상자 + 붕괴 게이지(`hold_ms`) | 노랑 |
| 확정 경고 | collapse_confirmed | 「자세가 흐트러졌어요」 빨강 + 테두리·소리·토스트 | 「자세를 살짝 고쳐볼까요?」 | 빨강 |
| 판정 불가 | 어깨가 안 보임 / `valid: false` | 「자세를 확인할 수 없어요」 회색 | 회색 상자 | 비어 있음 |

- 첫 결과 전에 「확인할 수 없어요」가 뜨면 카메라 문제처럼 보여서 문구를 나눴다.
- 주의 상자는 판정 불가 상자와 같은 자리에 띄운다. 소리·토스트·빨간 테두리는 확정 때만.
- 점수 링은 그 순간의 `posture`를 따른다. 바로 앉아 점수가 오르는 동안(회복 확정 전)에는 링이 빨강이 아니다.
- 10/21 서버 전용 측정으로 바꿀 때 앱 판정 엔진과 함께 지운 붕괴 게이지(`holdProgress`, `MeasureParts.tsx`)를 서버 값으로 되살렸다. 회복 게이지(「바르게 앉으면 3초 뒤 알림이 사라져요」)는 4.0에 `recovery_ms`가 없어 없다.

## 남은 것

- [ ] 실제 BE 4.0 브랜치와 로컬에서 함께 실행 — 점수 간격, 경고 확정·해제 지연, 게이지, 두 번째 측정(0.1초 내림 비교)
- [ ] 배포 순서: FE PR을 develop에 먼저, 그 뒤 BE PR. 운영 서버 재배포는 FE가 포크(Vercel)에 올라간 뒤
- [ ] **bad 사이에 good 한 프레임이 끼면?** 지금 규칙은 holdMs를 바로 0으로 돌린다. 4.0은 초당 20~30번 오므로 점수 30 근처에서 주의 표시가 깜빡이고 확정이 늦어질 수 있다.
  짧은 끊김을 봐줄지는 ML·BE와 정한다(계획 0084: 별도 결정 전까지 적용하지 않음). 서버에서 정하면 `posture`·`hold_ms`·확정이 한 규칙을 따른다. 3초 판별 시간은 그대로 두고 고를 수 있는 안:

  | 안 | 동작 | 장단점 |
  | --- | --- | --- |
  | 짧은 good 봐주기 | good이 0.5초 미만이면 holdMs를 0으로 돌리지 않고 멈춘 채 둠. 0.5초 넘게 이어지면 그때 0 | 깜빡임에 강함. 확정이 그만큼 늦어질 수 있음 |
  | 기준 두 개(히스테리시스) | bad는 확률 0.7 이상, good으로 돌아가는 건 0.6 미만일 때만. 그 사이는 앞 상태 유지 | 경계값에서 오르내리는 것을 직접 막음. 점수 화면과 판정 기준이 달라 보일 수 있음 |
  | 3초 중 비율 | 최근 3초 중 bad가 80% 이상이면 확정 | 직관적. 최근 3초 프레임을 들고 있어야 함 |
  | 판정 불가는 멈춤 | 판정 불가는 holdMs를 0으로 돌리지 않고 멈춤(고개 잠깐 돌림). 길게(예: 1초) 이어지면 그때 끊음 | 지금 「판정 불가 = 연속 끊김」 규칙을 바꾸는 것이라 ADR 0021 판정 불가 규칙과 같이 정함 |

  FE 의견: 앞의 두 안(짧은 good 봐주기 + 기준 두 개)을 같이 쓰는 것이 가장 단순하다. 회복(recoveryMs)에도 같은 규칙을 거꾸로 적용한다.
- [ ] (선택) 회복 게이지를 넣으려면 `recovery_ms`를 `hold_ms`처럼 요청
- [ ] Kafka 경로로 옮길 때 순서 보장(`session_id` 키, 순번 버퍼)과 `sequence` 유지
