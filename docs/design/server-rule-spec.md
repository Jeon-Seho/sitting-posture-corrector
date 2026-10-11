# 서버로 옮길 앱 판정 규칙 (reference-rules-v0.2)

> 작성: 2026-10-11 · FE · 대상: 서버 판정 구현 담당(DevOps·ML)
> 기준 코드: `lee_app1` — [`model/prototype/pose.ts`](../../model/prototype/pose.ts), [`serverFeatures.ts`](../../model/prototype/serverFeatures.ts),
> [`calibration.ts`](../../model/prototype/calibration.ts), [`frontend/src/lib/returnSettle.ts`](../../frontend/src/lib/returnSettle.ts),
> [`server/controller.ts`](../../frontend/src/features/session/server/controller.ts) `ingest()`
> 시험 데이터: [`contracts/examples/frames/reference-rule-cases.json`](../../contracts/examples/frames/reference-rule-cases.json)
> 관련: [계획 0023](../plans/active/0023-frontend-server-only.md) 1단계, [FE 회신: v4 회의](v4-meeting-fe-reply.md), [세션 내보내기 명세](../research/session-export.md), [판정 불가 처리](unmeasurable-handling.md)

앱은 판정을 그만두고(2026-10-11 결정) 관절 좌표만 보낸다. 이 문서는 **지금 앱이 실제로 하는 판정**을 서버가 같은 결과로 다시 만들 수 있게 적은 것이다.
값은 실험으로 정한 임시값이며 의학적 기준이 아니다. 자세 유형(머리/좌우 기울임)은 이번 결정으로 없애므로 적지 않는다.

## 0. 같은 결과인지 확인하는 방법

- 시험 데이터의 `frame_cases`·`sequence_cases`·`calibration_case`를 서버 구현에 넣고 `expected`와 비교한다.
- 실수는 **절대 오차 1e-9 이내**로 비교한다. 같은 크기의 변화도 연산 때문에 마지막 자리가 다르다(예: `head_drop` 0.7159090909090908, `head_rise` …0915).
- 경계 비교(`> 0.15`, `>= 0.65`)는 **아래 식과 같은 연산 순서**로 계산한다. 순서가 다르면 경계 사례 `head_turn_float_boundary`의 결과가 바뀐다.
- 시험 데이터는 앱 코드로 만들었다. 앱 시험(`referenceRuleCases.test.ts`)이 매번 코드와 파일이 같은지 확인한다.

## 1. 입력

프레임 하나는 `t_ms`와 관절 9개 `[x, y, visibility]`다. 사람이 안 잡히면 `p: null`이다.

| 순서 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| 관절 | 코 | 왼눈 | 오른눈 | 왼귀 | 오른귀 | 입 왼쪽 | 입 오른쪽 | 왼어깨 | 오른어깨 |
| MediaPipe 번호 | 0 | 2 | 5 | 7 | 8 | 9 | 10 | 11 | 12 |

- x, y는 영상 크기에 대한 0~1 비율이다. y는 아래로 갈수록 커진다.
- 영상은 좌우 반전하지 않는다. 관절 이름의 좌우는 사용자 몸 기준이라 사용자 왼어깨가 화면 오른쪽(큰 x)에 있다.
- 판정에는 **코·왼어깨·오른어깨·왼귀·오른귀**만 쓴다. 나머지는 분석용이다.
- 영상 크기 `width`·`height`(px)가 필요하다. 시험 데이터는 640×480이다.
- 앱은 표시용으로만 좌표를 부드럽게 만들고, 판정에는 MediaPipe 원본 좌표를 쓴다.

## 2. 프레임 특징값 (`features`)

코 N, 왼어깨 L, 오른어깨 R 중 하나라도 아래에 해당하면 **판정 불가**(특징값 없음)다.

| 조건 | 값 |
|---|---|
| 좌표나 visibility가 유한수가 아님 | |
| visibility | `< 0.65` 또는 `> 1` |
| 가장자리 | x 또는 y가 `< 0.02` 또는 `> 0.98` |
| 어깨 폭 `span = hypot((L.x − R.x)·W, (L.y − R.y)·H)` | `span < W · 0.1` |

판정 가능하면 (px 단위를 어깨 폭으로 나눈다):

```
cx = (L.x + R.x) / 2
cy = (L.y + R.y) / 2
head_x = (왼귀.x + 오른귀.x) / 2        # 두 귀 x가 유한수일 때. 아니면 N.x
head_gap         = (cy − N.y) · H / span
lateral_offset   = (head_x − cx) · W / span
shoulder_tilt    = (L.y − R.y) · H / span
quality          = min(N.vis, L.vis, R.vis)
head_turn_offset = (N.x − head_x) · W / span
```

- 귀는 **visibility를 보지 않는다.** MediaPipe는 가려진 귀도 위치를 추정해 준다(사례 `ears_low_visibility_still_used`).
- 특징값이 있어도 `quality`가 0.65 미만이면 판정에 쓰지 않는다(5장).

## 3. 기준 자세 (보정)

| 규칙 | 값 |
|---|---|
| 연속 시간 | 첫 프레임부터 3000ms 이상 |
| 최소 표본 | 판정 가능한 프레임 15개 이상 |
| 끊김 | 판정 불가 프레임이 하나라도 나오거나 프레임 간격이 1000ms를 넘으면 처음부터 다시 |
| 기준값 | **프레임마다 계산한 특징값 5개의 평균**(`head_turn_offset` 포함) |

**정해야 할 것 — 기준값 계산 방식.** v4 회의 회신은 "앱이 좌표 9개의 x·y 평균 18개를 보낸다"였다.
서버가 그 평균 좌표로 특징값을 다시 계산하면 앱(특징값의 평균)과 값이 조금 다르다. `calibration_case`에서는
`head_gap` 0.75395 vs 0.75376, `shoulder_tilt` 0.00402 vs 0.00377이다(어깨 기울기 허용 폭 0.03 대비 약 0.8%).
또 평균 18개에는 visibility가 없어서 기준의 `quality`를 알 수 없다. FE 제안: 서버가 보정 프레임 원본(`phase: "calibration"`)으로
앱과 같은 방식(특징값 평균)을 계산하거나, 앱이 특징값 평균 5개와 `quality`를 함께 보낸다. 평균 좌표 18개는 저장용으로만 둔다.

## 4. 고개 돌림

```
head_turned = |current.head_turn_offset − baseline.head_turn_offset| > 0.15
```

- 현재·기준 특징값이 모두 유효(5장 조건)할 때만 검사한다.
- 고개 돌림 프레임은 **판정하지 않는다**(`head_turn`). 판정 불가(`unmeasurable`)와 구분한다. 복귀 대기 시간이 다르다(6장).
- 0.15 이하는 그대로 판정한다(살짝 돌린 고개, 사례 `slight_head_turn`).

## 5. 변화량과 점수

현재·기준이 모두 유효해야 한다: 특징값 4개(`head_gap`·`lateral_offset`·`shoulder_tilt`·`quality`)가 유한수이고 `0.65 ≤ quality ≤ 1`.

```
d_head  = current.head_gap       − baseline.head_gap
d_side  = current.lateral_offset − baseline.lateral_offset
d_tilt  = current.shoulder_tilt  − baseline.shoulder_tilt
score   = min(1, max(|d_head| / 0.22, |d_side| / 0.2, |d_tilt| / 0.03) · 0.7)
```

- `score ≥ threshold`(기본 0.7, 사용자 0.5~0.95)이면 붕괴 후보다. 세 변화 중 하나가 허용 폭만큼이면 0.7이 된다.
- 이 식은 DevOps `inference-service/app/realtime.py`의 `score_feature_deltas`와 같다.
- `pose.ts`의 `classify()`는 예전 식(`amount / 2`)이고 앱 시험에서만 쓴다. 서버 기준이 아니다.

## 6. 복귀 대기 (`ReturnSettle`)

판정 불가나 고개 돌림 뒤에는 사용자가 자세를 다시 잡는 중이라 잠시 판정하지 않는다.

```
hold_until = −∞
프레임마다 (시간 순서대로):
  판정 가능          → judged = (t ≥ hold_until)
  판정 불가          → hold_until = max(hold_until, t + 3000); judged = false
  고개 돌림          → hold_until = max(hold_until, t + 1000); judged = false
```

- 보류는 **늘어나기만 한다**. 판정 불가 보류 중 고개를 돌려도 짧아지지 않는다(사례 `turn_inside_unmeasurable_hold`).
- 보류 중 프레임은 바른 자세도 붕괴도 아니다.

## 7. 구간 만들기 (지금 앱 동작)

지금 앱은 **이웃한 두 프레임 사이 `[이전 t, 현재 t)`를 구간 하나**로 보낸다(약 60ms). 0.5초 묶음은 아직 구현되지 않았다.

| 규칙 | 값 |
|---|---|
| 첫 프레임 | 다음 구간의 시작점으로만 쓴다 |
| 구간 품질 | 두 끝 프레임이 모두 `judged`면 `good`, 아니면 `poor` |
| 구간 점수 | `good`이면 **현재(끝) 프레임**의 변화량·점수 |
| 프레임 간격 > 1000ms | 구간을 보내지 않고 측정을 멈춘다. 사용자가 직접 재개한다 |
| 카메라 입력 없음 > 1500ms | 측정을 멈춘다(화면 쪽 감시). 직접 재개 |
| 일시정지 | `phase: "rest"`, `poor`, 특징값 없음으로 보낸다 |

## 8. 서버로 옮기면서 새로 정해야 하는 것

앱에도 없거나 v4에서 바뀌는 부분이다. 시험 데이터에 기대값이 없다.

| # | 항목 | 지금 상태 |
|---|---|---|
| 1 | 기준값 계산 방식 | 3장 |
| 2 | 0.5초 묶음 | v4 결정은 "0.5초에 1건, 프레임 그대로". 서버가 프레임을 받으면 7장 규칙을 프레임 단위로 그대로 쓸 수 있다. 0.5초 구간 하나로 줄이려면 [판정 불가 처리](unmeasurable-handling.md) 2장의 "판정 가능 프레임 절반 이상이면 평균"(임시)을 정해야 한다 |
| 3 | 판정 불가 3초 연속 → 측정 멈춤, 0.5초 연속 판정 가능 → 자동 재개 | **앱에도 구현되지 않았다**(2026-10-08 결정). 고개 돌림·복귀 대기 구간은 3초에 세지 않는다 |
| 4 | 3초 미만 판정 불가 동안 시계 멈춤 | 앱에도 구현되지 않았다. 지금 앱은 판정 불가 구간을 `poor`로 보내고 판정은 서버 엔진이 한다 |
| 5 | 판정하지 않은 이유 | 화면 안내에 `invalid_reason`(`unmeasurable`·`head_turn`·`settling`)이 필요하다([제안서](devops-integration-proposal.md) Q6) |
| 6 | 카메라 끊김 | 앱이 `phase: "away"`로 알린다. 기준(1000ms/1500ms) 중 무엇을 쓸지 맞춘다 |

## 9. 시험 데이터 구조

| 키 | 내용 |
|---|---|
| `constants` | 이 문서의 값 |
| `baseline` | 기준 자세 좌표 한 장과 그 특징값. `frame_cases`는 이 기준과 비교한다 |
| `frame_cases[]` | 좌표 한 장 → `features`, `observed`(`measurable`·`unmeasurable`·`head_turn`), `deltas`, `score` |
| `sequence_cases[]` | 시간 순서 프레임(이름은 `frame_cases` 참조) → 프레임별 `judged`, 구간(`good`/`poor`, 점수), `paused_at_ms` |
| `calibration_case` | 보정 16장 → 앱 기준값과 평균 좌표로 계산한 값(3장 비교용) |

다시 만들기: `frontend`에서 `UPDATE_RULE_CASES=1 npx vitest run referenceRuleCases`. 앱 규칙을 바꾸면 이 파일도 다시 만든다.
