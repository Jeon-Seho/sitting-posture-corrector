# ADR 0043: 자세 판정 모델은 좋음/나쁨 이진으로 출력한다

- 상태: 제안 (BE 2026-10-30. 이진 출력은 BE 결정, 1~3절의 세부는 ML(HJisung) 확인 전. 학습 모델은 아직 없고 서비스는 [ADR 0020](0020-single-api-decision-engine.md) 3절 규칙 점수를 쓴다)
- 번호: 0032~0042는 ML의 미병합 브랜치 `codex/repo-jwt-kafka-checkpoint`(`639353a`, 10/27 WIP)에서 쓰고 있어 0043으로 둔다.
- 관련: [ADR 0020](0020-single-api-decision-engine.md)(판정 엔진·특징·점수), [ADR 0021](0021-app-sends-information-server-judges.md)(판정 불가 신호), [계획 0064](../plans/active/0064-server-3s-frame-batch-inference.md)(프레임마다 판정, `observation` 4.0), [연구 프로토콜](../research/protocol.md), [수집 v2](../research/guided-collection-v2.md), ML 브랜치의 ADR 0038·`docs/ml/rebuild-plan.md`(같은 브랜치)

## 배경

- 저장소에는 학습 모델의 출력 정의가 없다. [backlog](../plans/backlog.md) 9행과 [계획서 검토](../references/current-proposal-review.md) 57~58행은 「이진 자세 모델 통합 전 검토」만 적었다.
- 서로 다른 안이 남아 있다: 기업연계 계획서 7쪽은 LSTM 3상태(정상/붕괴/판정 불가, [검토](../references/current-proposal-review.md) 55행), [제품 범위](../product-spec.md) 33행은 후보 라벨 4종(기준/전방·구부정/좌측/우측), 실시간 계약은 이탈 종류(`deviation_type`)를 낸다.
- ML 재설계(ML 브랜치 ADR 0038, `rebuild-plan.md` G2·G4)는 B0 규칙 → B1 로지스틱 회귀 → M2 LSTM(보류) 순이고 M2 시작안은 「이진 출력」, 라벨 후보는 `reference`(기준 유지)·`deviation`(변화)이다. `unmeasurable/away/rest`는 학습 클래스에 넣지 않는다.
- 계획 0064로 서버가 3초씩 묶은 프레임을 추론 서버에 넘기고 프레임마다 판정한다. 앱에 보내는 `observation` 4.0은 `posture`(`good`·`bad`·`null`)와 나쁨 확률만 담는다.

## 결정

모델(규칙이든 학습이든)의 출력은 **프레임마다 나쁨일 확률 하나**다. 좋음/나쁨은 서버가 세션 정책 `threshold`로 나눈다. 이탈 종류는 모델 출력에 없다.

### 1. 판정 불가는 모델 클래스가 아니다

- 판정 불가는 모델 **앞**의 품질 검사에서 거른다: 앱의 `valid:false` 신호(ADR 0021 6절), 판정 가능 검사·고개 돌림(ADR 0020 3절, 계획 0064에서 추론 서버로 옮김), `rest`·`away` 구간.
- 걸린 프레임은 모델에 넣지 않고 `invalid_reason`(`unmeasurable`·`head_turn`)으로 보내며 판정 시간(`valid_ms`)에서 뺀다.
- 근거: 루트 불변 기준 「낮은 측정 품질은 `unmeasurable`이다. 정상 상태나 유효한 자세 이탈로 대체하지 않는다」, ML `rebuild-plan.md` G2(측정 불가를 학습 클래스에 넣지 않음). 기업연계 계획서의 3상태와는 다르다.

### 2. 수집 라벨을 좋음/나쁨으로 합치는 규칙

[수집 v2](../research/guided-collection-v2.md)의 검토된 자기 보고 `manual_label` 기준(제안):

| `manual_label` | 이진 정답 |
| --- | --- |
| `upright`(기준 자세) | 좋음 (`reference`) |
| `lean_left`·`lean_right`·`trunk_forward` | 나쁨 (`deviation`) |
| `head_forward`(탐색용) | 나쁨 후보. 정면 2D에서 구별되는지 ML이 확인한 뒤 넣는다 |
| `unlabeled`·`transition`, `presence_label` `away` | 학습에서 뺀다 |

- `pose_training_eligible = 1`(accepted·seated·구체적 자세)인 행만 쓴다. 과제 안내(`requested_posture`)·규칙 점수·서버 판정을 정답으로 바꾸지 않는다([연구 프로토콜](../research/protocol.md)).
- 「좋음/나쁨」은 서비스 표시 이름이다. 정답의 뜻은 「등록 기준 유지 / 기준에서 벗어남」이며 의학적 정상·바른 자세 판정이 아니다(ML `rebuild-plan.md` 147~148행).

### 3. `threshold`는 학습 모델에 맞춰 다시 정한다

- 지금 0.7은 규칙 점수(ADR 0020 3절)의 값이다. 규칙 점수는 보정된 확률이 아니다.
- 학습 모델을 붙일 때 ML이 학습·검증 참여자 자료만으로 다시 맞춘다. 시험 참여자 자료로 튜닝하지 않는다.
- 값은 계정 정책(`threshold`)에 두고 비교는 API 판정 엔진(`engine/DecisionRules.java`)만 한다. 추론 서버는 확률만 낸다.
- 다시 맞추기 전까지 규칙 모델과 0.7을 그대로 쓴다.

## 결과

- 실시간 `observation` 4.0: `deviation_type`을 뺀다(계획 0064 9번). `decision`·`alert`의 `deviation_type`은 이진 모델로 바꿀 때 **삭제한다**(B안, 10/30 BE). 모델을 바꾸는 시점이 정해지지 않아 **보류**하며, 그때까지는 지금 규칙 모델의 종류를 그대로 보낸다. 함께 바꿀 곳은 [계획 0064](../plans/active/0064-server-3s-frame-batch-inference.md) 「남은 질문」에 적었다.
- 추론 응답(v3, 계획 0064에서 구현): 프레임마다 `{t_ms, valid, collapse_probability, deviation_type, invalid_reason}`. `deviation_type`은 사건용으로 남겼고 이진 모델로 바꿀 때 뺀다(보류).
- DB 변경 없음: 이탈 종류는 이미 저장하지 않는다(T-36 `collapse_type` 보류).
- 바꿀 문서(이 ADR이 채택되면): [제품 범위](../product-spec.md) 33행, [ADR 0020](0020-single-api-decision-engine.md) 3절 「유형」, [계약 안내](../../contracts/README.md)의 `deviation_type`, [backlog](../plans/backlog.md) 9행.

## 남은 질문 (ML 확인)

- `posture` 값 이름: 서비스 이름 `good`·`bad`를 쓸지, ML 라벨과 같게 `reference`·`deviation`으로 할지.
- 2절 표, 특히 `head_forward`를 넣을지.
- 학습 모델의 입력(특징 3개 / 관절 9개 좌표)과 시간 창. 계획 0064는 추론 서버가 프레임 배열을 받으므로 둘 다 가능하다.

## 이력

- 2026-10-30: BE 제안. 이진 출력·판정 불가 분리·라벨 합치기·`threshold` 재조정.
