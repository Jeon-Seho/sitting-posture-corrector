# 실시간 측정 재설계 전 프론트 정리

기준: 2026-11-03, `origin/develop 096cc3c`(PR #95로 #91·#92를 되돌린 상태, 코드는 `3d2fdfd`와 같다).
`feature/fe-3sec-batch-observation4`에서 #91 서버에 맞춰 해 본 작업 중 다음 설계에 필요한 것만 남긴다.
그 브랜치의 화면 코드는 커밋하지 않았고, 아래 핵심 코드가 기록의 전부다.

## 무슨 일이 있었나

- 10/29: 앱이 프레임을 보내고 서버가 점수·판정·3초 확정을 모두 하는 구조로 운영 연결까지 검증했다(브라우저 10항목, 통합 시험 80/0/2).
- #91: 서버가 추론 결과를 서버 시계 3초마다 모아 판정하고 보냈다. 판정 자체는 `t_ms` 기준으로 정확했지만 전송이 3초 주기에 묶였다.
- 로컬 실제 서버 + 합성 카메라로 잰 값(기본 묶음 3초):

| 항목 | 값 |
| --- | --- |
| 점수가 바뀌는 간격 | 약 3.25초 |
| 고개 숙임 → 경고 확정 | 약 4.5초 |
| 바로 앉음 → 경고 꺼짐 | 약 5.9초(회복 3초 + 묶음 대기 최대 3초) |

- 원인: **점수 전달**과 **지속 판정(3초 확정·회복)**은 원래 따로 돌던 두 일인데, 3초 묶음 과정에서 한 주기로 합쳐졌다.
  WS를 쓰는 이유(즉시 반응)가 사라져 #95로 되돌렸다.

## 다음 구조에서 지킬 것

계획 0084 「최신 방향」과 같다. 앱은 판정하지 않는다(ADR 0021).

1. 추론 결과가 오면 점수(`posture` good/bad 포함)를 **그 자리에서** 앱에 보낸다.
2. 같은 결과를 지속 판정에 넣고, 확정·회복·리마인더가 나오면 **그 자리에서** `decision`을 보낸다.
3. 판정 시간은 촬영 시각 `t_ms`로 센다. 서버 도착 시각은 순서를 기다리는 데에만 쓴다.

### 3초를 세는 방법

「0~3초, 0.1~3.1초 …」 창을 매번 다시 보지 않는다. develop의 [Timeline.java](../../backend/api/src/main/java/org/posegood/api/engine/Timeline.java)·[DecisionRules.java](../../backend/api/src/main/java/org/posegood/api/engine/DecisionRules.java)처럼
세션마다 누적값 몇 개만 두면 프레임마다 같은 결과를 더하기 한 번으로 얻는다.

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
- 누적은 촬영 순서대로 넣는다. 세션별로 한 줄로 처리하면 된다(Kafka면 키를 `session_id`로).
  순서가 뒤집힐 수 있는 구조라면 순번으로 짧게 기다리는 버퍼가 필요하다(#91의 `PendingIntervals`, 최대 2초).
- 부하는 3초 계산이 아니라 프레임마다의 추론 호출·DB 쓰기·메시지 수에서 생긴다.
  추론은 여러 세션을 0.1~0.2초씩 모아 부를 수 있지만, 판정과 전송은 결과가 오는 즉시 한다. DB에는 사건만 쓴다.

### 앱이 받는 `observation`

BE에는 아직 요청하지 않았다(실시간 판정을 다시 만들 때 팀이 같이 정한다). 지금 develop은 3.0(`posture` 없음)이다.
#91의 4.0은 `posture`를 더하면서 `sequence`·`start_ms`·`end_ms`·`phase`·`valid_ms`·`deviation_type`·`model_version`을 뺐는데,
필드를 줄인 것은 3초 묶음을 전제로 한 결정이라 즉시 전송에는 맞지 않는다.

| 필드 | 정할 것 | 이유 |
| --- | --- | --- |
| `posture` | 추가(`good`·`bad`, 판정 불가 `null`) | 기준(0.7)은 서버가 적용, 앱은 점수 구간을 두지 않음 |
| `sequence` | 필수 유지 | 늦게 온 결과 버리기, 보낸 프레임과 맞춰 지연 재기, 빠진 결과 알기 |
| `end_ms`(`t_ms`) | 유지 | 게이지·지연 분석. 3초 판정은 서버가 `t_ms`로 셈(`sequence`는 프레임 간격이 일정하지 않아 시간을 못 셈) |
| `valid` | 그 프레임 기준 | 2초 bad 뒤 판정 불가면 바로 `valid: false`. 4.0의 「묶음에 하나라도 있으면 true」면 이때 `bad`로 남음 |
| `collapse_probability` | 판정 불가면 `null` | 0이면 화면 100점과 같은 값 |
| `model_version`·`deviation_type` | 빼도 됨 | 앱이 쓰지 않음. 안내 문구는 「자세가 무너졌습니다. 바로 잡아주세요」 하나 |

앱은 메시지를 받는 곳 한 군데에서 판정 불가를 먼저 걸러, 판정 불가 상태에는 점수 필드가 없는 모양으로 바꾼다.
화면은 그 아래에서 `posture`(good·bad)만 나눈다. 화면 곳곳에서 `valid`를 확인하는 방식은 하나만 빠뜨려도 100점이 보인다.

```ts
type Reading =
  | { kind: 'unmeasurable'; reason: InvalidReason; sequence: number }
  | { kind: 'measured'; posture: 'good' | 'bad'; score: number; sequence: number }

function toReading(o: LiveObservation): Reading {
  if (!o.valid || o.posture === null) return { kind: 'unmeasurable', reason: o.invalid_reason, sequence: o.sequence }
  return { kind: 'measured', posture: o.posture, score: Math.round(100 * (1 - o.collapse_probability)), sequence: o.sequence }
}
// 이미 받은 것보다 sequence가 작은 결과는 버린다
```

### 같이 정할 것

- **bad 사이에 good 한 프레임이 끼면?** 지금 규칙은 holdMs를 바로 0으로 돌린다. 점수 30 근처에서는 확정이 안 날 수 있다.
  짧은 끊김을 봐줄지는 ML·BE와 정한다(계획 0084: 별도 결정 전까지 적용하지 않음).
- **점수 메시지에 서버 holdMs(또는 남은 시간)를 싣기:** 앱의 3초 게이지가 표시용 타이머가 아니라 서버가 센 값을 보여 준다.

## 프레임 단위 판정 때 주의할 것

#91에서 측정 한 번 뒤 다음 측정이 시작되지 않았다. 프레임마다 판정하면 바른 자세 시간에 ms 끝자리가 생기는데(38.35초),
서버는 `good_sec`를 0.1초 내림으로 저장해서(38.3초) 앱이 「서버에 저장됨」을 확인하지 못했다.
프레임 단위 판정으로 다시 가면 [serverRecords.ts](../../frontend/src/features/storage/serverRecords.ts)의 비교를 같이 고친다.

```ts
const storedTenths = (seconds: number) => Math.floor(seconds * 10 + 1e-6) / 10
// reconcileResults: remote.valid >= local.valid && remote.good + 1e-9 >= storedTenths(local.good)
```

## 측정 화면 UI(참고)

서버가 `posture`와 `decision`을 보낸다는 전제다. 화면은 새로 만들 예정이라 상태 구분과 이유만 남긴다.

| 상태 | 조건 | 위 표시 | 아래 안내 상자 | 점수 링 |
| --- | --- | --- | --- | --- |
| 첫 판정 전 | 사람이 잡힘 + 결과 아직 없음 | 「자세를 똑바로 해주세요」 회색 | 없음 | 비어 있음 |
| 바른 자세 | `posture: good` | 「바른 자세예요」 초록 | 없음 | 기본색 |
| 주의 | `posture: bad` + 확정 전 | 「자세가 흐트러지고 있어요」 노랑 | 노랑 상자 + 3초 게이지 | 노랑 |
| 확정 경고 | collapse_confirmed | 「자세가 흐트러졌어요」 빨강 + 테두리·소리·토스트 | 「자세를 살짝 고쳐볼까요?」 | 빨강 |
| 판정 불가 | 어깨가 안 보임 / `valid: false` | 「자세를 확인할 수 없어요」 회색 | 회색 상자 | 비어 있음 |

- 첫 결과 전에 「확인할 수 없어요」가 뜨면 카메라 문제처럼 보여서 문구를 나눴다.
- 주의 상자는 판정 불가 상자와 같은 자리에 띄운다. 소리·토스트·빨간 테두리는 확정 때만.
- 점수 링은 그 순간의 `posture`를 따른다. 점수 30 미만 = 확률 0.7 이상 = `bad`라 앱이 점수 구간을 따로 두지 않는다.
  바로 앉아 점수가 오르는 동안(회복 확정 전)에는 링이 빨강이 아니다.
- 게이지는 주의 상태가 시작될 때 요소가 새로 붙어 CSS 애니메이션(`holdSeconds`초, linear)으로 한 번 차오른다. 별도 타이머는 없다.
  서버가 holdMs를 보내 주면 그 값으로 바꾼다.
