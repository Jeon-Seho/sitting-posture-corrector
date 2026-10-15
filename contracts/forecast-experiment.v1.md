# 로컬 예측 실험 출력 v1

`model/prototype/forecast.ts`가 만들고 별도 `#forecast`와 `/dev` 화면이 소비하는 연구용 출력이다.
기존 서비스 상태·서버·CEP·수집 라벨 계약을 대체하지 않는다.

| 필드 | 의미 |
| --- | --- |
| schema_version | `forecast-experiment-v1` |
| timeMs | 현재 단조 증가 관측 시각(ms) |
| state / ruleState | 예측 조합 / 거리·시간 대조군 상태 |
| deviation | 기준 대표 좌표와의 그룹 평균 거리; 없으면 null |
| error | 0.3초 전에 만든 예측과 현재 관측의 거리; 미준비/미대응이면 null |
| errorLimit | 대응 예측 오차가 20개 이상이면 등록 오차 q99와 하한0.02 중 큰 값; 부족하면 하한0.02; 기준 미등록이면 null |
| durationMs | 유효한 현재 연속 이탈 시간 |
| progress | 기준 등록의 경과 시간 8초와 유효 표본 65개 중 낮은 완료 비율, 0–1 |
| returnedExcursions | 지속 후보 판정 전에 기준으로 복귀한 짧은 구간 수 |
| modelId | 실제 LSTM id 또는 명시적으로 선택한 위치 유지/등속 비교 방법 |
| domainValidated | 항상 false; 현재 입력·모델 호환 성능 미검증 |

상태: `needs_reference`, `registering`, `warming`, `near_reference`, `deviation_pending`,
`unexpected_motion_candidate`, `persistent_deviation_candidate`, `recovery_pending`, `unmeasurable`.
예측 오차가 높다고 일시적이라고 확정하지 않는다. 복귀·지속 관찰이 필요하다.
측정 불가일 때 거리·오차는 null, 연속 누적은0이다.

MediaPipe Pose Heavy 원래0–12의 image/world 입력이 필요하다.
13점 모두 image 화면 내부·visibility≥0.5·유한 world 좌표를 요구한다. 필수 점 부족은 측정 불가다.
world 어깨 중심·현재3D어깨폭으로 정규화하며 Panoptic 순서에 근사 재배열한다.
MediaPipe 눈/입 위치와 Panoptic 점 정의, world/camera 축은 동일함이 검증되지 않았다.

기존 기본 경로(`#forecast`)의 실험 설정:8초/65표본 이상 기준,30개 약10Hz 입력,300ms horizon,관측 대응±50ms,
등록 후 추적 샘플 간격95–170ms,원관측 누락250ms 초과이면 연속성 초기화.
`/dev` 기준 등록에 한해서만 유효 표본 사이 최대 1000ms 지연을 허용하고 짧은 누락 표본을 추가하지 않는다.
긴 간격·유효하지 않은 입력은 새 기준 등록을 요구한다. 이 값은 개발용 촬영 경험 설정이다.
대응 예측 오차가 20개 미만이어도 8초와 유효 표본 65개를 채우면 등록을 끝내며,
오차 한계는 개인 추정치라고 주장하지 않고 최소값 0.02를 사용한다.
기존 `#forecast` 화면은 현재 입력 자체가500ms 끊기면 UI를 측정 불가로 바꾸고 예측 큐·시간 누적을 초기화한다.
`/dev`의 원시 관측·예측 입력 간격은 아래 관측 시간축 확장을 따른다.
거리 시작0.12/복귀0.08,이탈3초+낮은오차1초,최대대기5초,회복3초는 연구 설정이다.

브라우저 가중치 `forecast-weights-v1`는 39입력·48hidden·30steps·horizon3의 실제 state_dict,
학습 mean/scale,source hash를 제공한다. 잘못된 버전·shape·NaN·scale≤0은 거부한다.
가중치·실제 자료는 Git에 추가하지 않는다.

`/dev`의 마지막 위치 유지·등속 비교 방법은 가중치 없이 같은 등록·품질·시간 정책을 실행한다.
LSTM은 실제 가중치가 필요하며 누락 시 합성 가중치로 대체하지 않는다. 출력 구조와 `modelId` 의미는 유지한다.

수동 export `forecast-experiment-export-v1`는 모델 provenance·설정·최대3000개 진단 출력만 포함한다.
영상·원본 관절·기준 좌표·참여자 식별자는 포함하지 않는다. 자동 저장/전송은 없다.


## `/dev` 관측 시간축 확장 (2026-10-14)

기존 v1 기본 경로(`#forecast`)는 유지한다. `/dev`만 `evaluationMode: "observed-v2"`를
명시하며 아래 선택 필드를 사용한다. 필드가 없는 과거 자료에 새 시간 의미를 적용하지 않는다.

- `predictionTimeMs`: 현재 `error`를 계산한 정확한 100ms 시점. 미준비이면 null.
- `predictionInputMaxGapMs`: 예측 입력만 연결할 수 있는 유효 양끝점의 최대 간격. ADR 0030 적용 실행은 500이다.
  없는 과거 출력에 이 값을 소급하지 않는다. 원시 관측의 규칙·수집 허용 간격은 계속 250ms다.
- `normalProfileId`, `normalScore`: 확인한 정상 구간에서 맞춘 개인 범위가 있을 때만 존재한다.
  점수는 9개 특징의 `|현재−학습한 정상 중심| / 학습 허용 폭` 중 최댓값이다. 1이 경계이며 확률이 아니다.
- `deviation`은 계속 실제 3D 그룹 평균 거리다. 정상 범위 점수와 단위를 섞지 않는다.

원시 유효 관측마다 거리·시간과 정상 범위를 갱신한다. 95ms 샘플 제거를 하지 않으며
관측 간격 **250ms 초과** 또는 유효하지 않은 관측은 규칙·알림·정상 수집의 연속성을 끊는다.
해당 구간은 `unmeasurable`이며 정상/이탈 시간에 더하지 않는다.

ADR 0030 적용 실행에서는 **예측 입력만** 100ms 시간축으로 만들 때 이미 도착한 두 유효 관측 사이
**최대 500ms** 지연까지 선형 보간한다. 아직 도착하지 않은 끝점을 앞값으로 채우지 않는다.
실제 품질 실패·탭 숨김·시각 역전·500ms 초과 누락은 예측 창도 초기화한다. 감시 타이머의 지연 통지는
새 관측이 아니므로 원시 시각을 옮기거나 예측을 새로 생성하지 않으며 표시와 규칙 누적만 중단한다.
500ms 이내에는 다음 유효 원시 관측을 기다렸다가 입력 창을 이어갈 수 있다.

250ms보다 긴 지연을 메운 격자는 입력 전용이며 잔차 평가 정답으로 쓰지 않는다. 지연 전 예측 큐와
잔차를 비워 300ms 예측 목표를 누락 구간의 보간값과 비교하지 않는다. 보간한 좌표는 정상 자료·
자동 라벨·기준 등록의 실제 표본 수에 넣지 않는다. 이 500ms 설정은 개발용 지연 대응이며 정확도 개선의 증거가 아니다.

`state`는 예측 조합, `ruleState`는 관측 기반 판단이다. `state=warming`이어도 유효한
`ruleState`와 거리·시간은 표시·알림·통계에 사용할 수 있다. 측정 불가와 등록 전은 공통 차단한다.
`/dev` 기본 알림은 `rule`이다. 개인 범위 적용 시 1배 진입·2/3배 복귀와 기존 3초 지속/복귀를 쓴다.
개인 범위가 없으면 기존 0.12/0.08 거리 규칙이다. LSTM 비교 경로는 계속 별도 선택할 수 있다.

개인 범위는 세션 시작에 복사하고 합성 데모에는 적용하지 않는다. 매번 8초·실제 관측 65개 이상으로
현재 기준을 등록하고 그 후보가 고정된 개인 정상 범위 안에 있는지 검증한다. 정상 중심과 허용 폭은 새 등록으로 바꾸지 않는다.
검증은 사용자가 확인한 개인 범위와의 비교이며 의학적 정상성 판정이 아니다.
정상 자료 계약은 [별도 수집 규격](normal-posture-collection.v1.md)을 따른다.

### 관측 정책별 숫자 진단 (2026-10-15, 선택 필드)

`evaluationMode: observed-v2`에서 아래 선택 필드를 제공한다. 기존 필드의 의미와 과거 자료는 유지한다.

| 필드 | 의미 |
| --- | --- |
| `ruleDurationMs` | 관측 룰의 연속 이탈 시간. 등록 전·측정 불가·복귀 확인 중에는 0 |
| `ruleReturnedExcursions` | 관측 룰에서 지속 이탈 후보가 되기 전에 복귀한 구간의 누적 횟수. 의도·스트레칭 라벨이 아님 |
| `ruleRecoveryMs` | 관측 룰의 복귀 확인 경과 시간. 해당 상태가 아니면 0 |
| `predictionRecoveryMs` | 예측 조합 정책의 복귀 확인 경과 시간. 해당 상태가 아니면 0 |

기존 `durationMs`, `returnedExcursions`는 예측 조합 정책의 수치다. `/dev`의 룰 선택 시에는 위 룰 수치를 표시한다.
과거 룰 자료의 복귀 횟수가 없으면 예측 조합 횟수로 대신하지 않는다. 실제 알림 발생과 지속 이탈 상태는 별개다.
이 확장은 진단만 추가하며 판정 임계값·정규화·예측 입력을 바꾸지 않는다.

### 고정 영상 보완 경로 (2026-10-15, 선택 필드)

`imagePostureGuard:true`를 명시한 관측 모드에만 적용한다. `/dev`의 새 카메라/합성 실행에서 사용하며,
기존 출력·39차원 예측 입력·개인 `normalScore`와 `deviation`은 유지한다. [ADR 0034](../docs/decisions/0034-fixed-image-posture-anchor.md).

- `postureScore`: 종합 이탈 경계 배수 또는 null. `max(상대 점수, imagePosture.score)`이며 경계 1은 정상 확률이 아니다.
  상대 점수는 개인 범위가 있으면 `normalScore`, 없으면 `deviation/0.12`다.
- `imagePosture`: 아래 숫자만 포함한다. 등록 당시 원본 위치·어깨폭과 원본 관절은 넣지 않는다.

| imagePosture 필드 | 의미 |
| --- | --- |
| `policy` | `image-posture-anchor-v1` 또는 `image-posture-anchor-v2`. 실제 적용 정책이며 과거 자료의 정책을 바꾸지 않음 |
| `status` | `registering`, `ready`, `unmeasurable`, `needs_reference` |
| `score` | 공통 이동/이동 허용폭, 어깨폭 축소/축소 허용폭의 최댓값. 측정 불가·등록 중 null |
| `translation`, `translationLimit` | 공통 이동과 허용폭. 등록 당시 영상 어깨폭 단위 |
| `shrink`, `shrinkLimit` | 등록 어깨폭에 대한 영상 축소 비율과 허용 비율 |
| `strongest` | 큰 기여의 `position` 또는 `scale`, 변화 없음/측정 불가 시 null |

새 경로는 종합 점수 >1에서 이탈, ≤2/3에서 복귀한다. 시간 정책과 원시 품질/누락 경계는 유지한다.
위 1배는 초기 경로의 이력이다. [ADR 0036](../docs/decisions/0036-composite-entry-point-seven.md) 적용 새 실행에는
선택 필드 `postureEntryRatio:0.7`, `postureRecoveryRatio:0.7*2/3`가 있고 해당 진입 배수 초과·복귀 배수 이하를 쓴다.
필드가 없는 이전 종합 출력은 1·2/3 경계를 유지한다. `postureScore`는 등록 허용폭 단위이며 새 경계로 재정규화하지 않는다.
영상 v2는 [ADR 0035](../docs/decisions/0035-posture-and-clean-normal-selection.md)의 하한(공통 이동 0.18 등록 어깨폭·축소 0.12)을 사용한다.
v1 하한은 0.45/0.20이다. 실제 적용 허용폭은 `translationLimit`·`shrinkLimit`를 읽으며 새 기준을 이전 결과에 소급하지 않는다.
영상 크기/좌표가 유효하지 않거나 종횡비가 달라지면 상대 자세만으로 정상 판정을 계속하지 않는다.
카메라 자체 이동과 몸 이동의 의미는 구분하지 못하므로 고정 카메라 실험에 한정한다. 실제 후방 각도·눕기 정답 라벨이 아니다.

## `/dev` 미래 좌표 표시 어댑터

진단 출력 `ForecastReading`과 별도로 `ForecastExperiment.predictionDisplay`가 화면용
`ForecastDisplay`의 방어 복사본을 반환한다. 기본 예측·룰 상태 또는 진단 export 필드를 대체하지 않는다.

| 필드 | 의미 |
| --- | --- |
| `predictor` | `lstm`, `hold_last`, `constant_velocity` 중 실제 선택 방식 |
| `modelId` | 실제 가중치 모델 ID 또는 비교 방법 ID |
| `inputAtMs` | 예측 입력 창 마지막 100ms 격자의 관측 시각 |
| `targetAtMs` | `inputAtMs + 300`. 미래 예측의 목표 시각 |
| `inputValues` | 해당 입력 창 마지막 시점의 어깨 정규화 39차원 좌표 |
| `values` | 같은 30시점 입력 창에 실제 predict 함수를 실행한 39차원 출력 |

13점은 얼굴 9점(코·눈 6점·입 2점), 귀 2점, 양어깨 2점이다. 출력 순서는 기존
`liveForecastPoints`와 같다. 어깨만 예측하는 모델이 아니며 규칙 거리로 예측 화살표를 만들지 않는다.
`ForecastReading.predictionTimeMs`는 과거 예측의 잔차 대응 시각이므로 위 미래 `targetAtMs`와 구분한다.
표시 좌표는 메모리에만 두고 기존 진단 내보내기의 좌표 제외 목록을 유지한다.

도식은 정면 `(-x, y)`·측면 `(-z, y)`이며 입력과 예측에 같은 축척을 적용한다. 정면 좌우 반전은
한 번만 적용하고 측면 오른쪽은 카메라 방향이다. 카메라 픽셀 투영·실측 깊이·실제 미래 얼굴 위치가 아니다.
기준 영상 가이드의 화살표는 `기준 → 현재`, 미래 도식의 화살표는 `입력 끝 → 0.3초 뒤`다.
실제 Panoptic 가중치와 MediaPipe 입력의 좌표 의미·축 호환성은 계속 미검증이다.

관측 실패·시간 단절·초기화·종료·영상 크기 변경·현재 추적 부재·목표 시각 만료에는 예측을 숨긴다.
표시 중단과 예측 입력 창 초기화는 구분한다. 짧은 처리 지연으로 표시를 숨겨도 위 조건에서 입력 창은 유지할 수 있다.
세션 어댑터는 카메라의 실제 추론 시작 시각과 세션 시작을 같은 `performance.now()` 축에서 빼고
현재 경과 시각도 확인한다. 첫 결과 수신 지연을 관측 시각 전체에 더하지 않으며 이미 지난 목표를 미래처럼 표시하지 않는다.
코어의 미준비·품질 판정이나 알림 경로를 표시용 좌표로 덮어쓰지 않는다.
설계 근거는 [ADR 0029](../docs/decisions/0029-automatic-normal-labels-and-forecast-display.md)와
[ADR 0030](../docs/decisions/0030-predictor-cadence-recovery.md)을 따른다.

## `/dev` 예측 입력 준비 상태

`predictionStatus`는 좌표 없이 현재 입력 준비를 설명하는 메모리 전용 스냅샷이다. 진단 export에 넣지 않는다.

| 필드 | 의미 |
| --- | --- |
| `collectedSteps` / `requiredSteps` | 현재 입력 창의 준비 개수 / 필요한 30개 |
| `resetCount` / `lastResetReason` | 창 초기화 횟수 / 마지막 이유(`quality`, `gap`, `time`, `reset`) |
| `lastGapMs` | 최근 원시 관측 간격 또는 다음 관측을 기다린 시간. 미관측이면 null |
| `bridgedGapCount` | 유효 양끝점 사이 250ms 초과·500ms 이하 지연을 예측 입력으로 연결한 횟수 |

화면은 이 값과 카메라 처리 FPS를 함께 표시한다. 입력 부족, 30개 준비 후 새 유효 출력 대기,
관측 실패를 구분하며, 오래된 출력이 사라진 상태를 무조건 “3초를 모으는 중”으로 설명하지 않는다.

## 정상 등록 검증 및 MediaPipe 가중치 v2 (2026-10-14)

개인 정상 프로파일은 학습한 중심을 고정한다. 새 기준 등록의 8초·65개 유효 관측 중앙값을 동일 추출기 프로파일과
비교하여 점수 ≤1이면 등록한다. 범위 밖 후보는 기준으로 채택하지 않고 `needs_reference`로 돌아간다. 추출기 미상·불일치는
`unmeasurable`이다. 프로파일이 없으면 기존 등록 가정으로 실험하되 정상 검증 없음으로 표시한다.
개인 범위 판정의 이탈 진입은 **점수 >1**, 복귀는 ≤2/3이다. 기본 거리 규칙은 기존 ≥0.12/≤0.08을 유지한다.
`deviation`은 등록 기준과의 기하 거리로 유지하며 `normalScore`는 학습 중심 대비 점수다. 서로 같은 값이 아니다.

`forecast-weights-v2`는 `data_domain: mediapipe`, 정확한 `pose_model_id`,
`feature_definition: mediapipe-world13-shoulder-normalized-xyz-v1`,
`config.point_definition: MediaPipe-13-world-shoulder-normalized-v1`을 요구한다. 30×39 입력, hidden48, horizon3,
mean/scale/가중치 배열 형태와 계산식은 v1과 같다. 실제 프레임의 추출기 ID가 학습 ID와 일치해야 실행하며
기존 `#forecast`는 v1만 받는다. v2의 13점 순서는 현재 MediaPipe 수집 코드와 정확히 같고, v1 Panoptic 대응은 계속 근사다.

`training`에는 mode(pilot/participant_holdout), evaluation_scope(training_fit_only/participant_holdout_forecast_only),
participant_generalization_evaluated, labels_used(manual_confirmed_windows/automatic_weak_windows),
split_window_counts와 split_participant_counts(train/validation/test)를 포함한다. 숫자는 음이 아닌 정수이며 train>0,
학습 라벨 창 수의 합은 train 창 수와 같다. pilot는 validation/test=0과 generalization=false만 허용하며,
holdout는 세 분할 모두 양수와 generalization=true를 요구한다. 이는 파일 내부 일관성 검사로, 성능 진실성 인증은 아니다.
모든 모드에서 domain_validated=false다. [학습 절차·평가 한계](../docs/ml/mediapipe-training.md).

새 `/dev` 영상 보완 경로의 진입은 >0.7배 연속 3초다. 알림 전에는 진입 이하 관측이 시간을 끊고,
확정 후에만 약0.467배 복귀 경계를 사용한다. 복귀 확인 중 초과하면 복귀 시간도 재시작한다.
[ADR 0036](../docs/decisions/0036-composite-entry-point-seven.md). 기존 무옵션 정책에는 적용하지 않는다.
