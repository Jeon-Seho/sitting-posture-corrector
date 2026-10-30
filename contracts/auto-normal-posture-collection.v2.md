# 자동 정상 후보 수집 v2

`/dev`의 원본 정상 후보 수집 계약이다. [v1](auto-normal-posture-collection.v1.md)은 고정 0.5%를 뜻하므로
그 의미를 바꾸지 않고 새 `schema_version`을 사용한다. 일반 서비스·서버 계약을 대체하지 않는다.
[수동 30초 수집](normal-posture-collection.v1.md), [좌표 없는 세션 진단](developer-lab-export.v1.md)과 분리한다.

## 선별과 구간

- 기본 선별 거리는 **6% (`0.06`)**이며 사용자가 **0.5% (`0.005`) / 3% (`0.03`) / 6%**를 선택한다.
  6%는 실제 정면 관찰에서 약 1.8~5.2%가 나온 상황을 참고한 개발 실험 설정이며 정확도 검증 결과가 아니다.
- 거리의 정의는 v1과 같다. 현재 3D 어깨 중심·폭으로 정규화한 13점에 대해 얼굴·귀·어깨 그룹별 평균
  점 거리를 구하고 세 그룹을 같은 비중으로 평균한다. 픽셀 오차·정상 확률·LSTM 오차·개인 정상 점수가 아니다.
- `deviation ≤ row.maximumDeviation`인 새 실제 프레임을 최대 10Hz로 한 행씩 저장한다. 행에 실제 적용한
  선별 기준을 기록하며, 선택 변경은 기존 행이나 기준에 소급하지 않는다.
- 측정 중에도 선별 기준을 바꿀 수 있다. 변경 이후 저장되는 첫 행은 **새 segment**다. 기준을 원래 값으로
  되돌려도 떨어진 구간을 이어 붙이지 않는다. 선별값 변경만으로 등록 기준을 재작성하지 않는다.
- 등록 전·합성·낮은 품질·무효 world/image 좌표·중복/역전 시각·기준과 읽기 시각/거리 불일치는 제외한다.
  유효한 원본 관측의 이미지·world·정규화 좌표만 저장하며 표시 평활화·예측·보간 좌표는 넣지 않는다.
- 2026-10-15부터 고정 영상 보완이 적용된 실행은 몸 전체 점수가 >1이거나 해당 측정이 불가하면 제외한다.
  상대 정규화 거리만 작다는 이유로 뒤로 물러나거나 몸이 크게 이동한 프레임을 정상 후보에 넣지 않는다.
- 250ms 초과 관측 간격, 저장된 인접 행의 250ms 초과 간격, 기준 밖, 품질 실패, 중단은 연속 구간을 끊는다.
  실행·참여자·등록 기준·추출 모델 ID 변경도 분리한다. 속도 제한으로 생략한 프레임만으로 품질 실패를 만들지는 않는다.
- 최대 6,000행에서 자동 정지하며 기존 자료는 유지한다. 명시적 비우기 전에는 가장 오래된 행도 지우지 않는다.
  익명 참여자 코드 변경은 자동 수집을 멈춘 상태에서만 가능하고 과거 행의 코드는 보존한다.

원본 좌표는 현재 탭 메모리에만 보관하고 명시적 JSON 다운로드에만 포함한다. 자동 영구 저장·업로드·
정상 프로파일 fitting·기준 갱신은 없다. 새로고침/탭 종료 시 미저장 자료는 사라진다. 실제 데이터·참여자
코드·기준·가중치는 Git에 추가하지 않는다.

## 파일 `normal-posture-auto-collection-v2`

| 필드 | 의미 |
| --- | --- |
| `schema_version` | `normal-posture-auto-collection-v2` |
| `id`, `createdAt` | 메모리 수집기의 무작위 ID, 생성 ISO 시각 |
| `source`, `domainValidated` | `webcam`, `false` |
| `label`, `displayLabel` | `normal_auto_assumed`, `정상자세(자동)` |
| `labelSource`, `review`, `purpose` | `auto_rule`, `not_reviewed`, `early_experiment_only` |
| `selection.metric` | `balanced_face_ears_shoulders_distance` |
| `selection.thresholdSource` | `row.maximumDeviation`; 각 행의 기준이 권위 있는 선별 출처 |
| `selection.configuredMaximumDeviation` | 다운로드 시 선택 값. 과거 행의 선별 기준을 뜻하지 않음 |
| `selection.allowedMaximumDeviations` | `[0.005, 0.03, 0.06]` |
| `selection.inclusive`, `maximumHz`, `interpolation` | `true`, `10`, `false` |
| `timing` | `unit:ms`, `maximumGapMs:250`, 아래 세 가지 시각의 정의 |
| `references[]` | v1과 같은 등록 기준 출처. 아래 설명 참조 |
| `rows[]` | v1 행 구조에 필수 `maximumDeviation` 추가 |
| `diagnostics` | 좌표 없는 제외 사유·연속 구간·후보 창 집계 |

| `rows[]` 필드 | 의미 |
| --- | --- |
| `row` | 버퍼에서 1부터 증가하는 행 번호 |
| `timeMs` | 원본 카메라 단조 관측 시각, `camera_observation_clock` |
| `observationTimeMs` | 실행 시작 기준 시각, `measurement_run_clock` |
| `videoTimeMs` | 원본 video 시각, `video_clock` |
| `segment` | 연속 선별 구간. 같은 값만으로 학습 가능성을 보증하지 않음 |
| `runId`, `referenceId`, `participantCode` | 실행 ID, 등록 기준 ID, 익명 참여자 코드 |
| `deviation` | 원본 관측과 등록 기준에서 다시 확인한 거리 |
| `maximumDeviation` | **이 행 수집에 적용한** `0.005`, `0.03`, `0.06` 중 하나 |
| `label`, `displayLabel`, `labelSource`, `review` | 파일 수준과 같은 자동 약라벨 출처 |
| `width`, `height` | 원본 영상 크기 |
| `poseModelId` | 선택 필드. 실제 MediaPipe 모델·버전 ID. 누락은 미확인이며 Heavy로 추정하지 않음 |
| `imagePosturePolicy`, `imagePostureScore` | 선택 필드 쌍. 실제 `image-posture-anchor-v1`/`image-posture-anchor-v2`가 적용된 행의 정책과 몸 전체 점수. 없는 과거 행에 적용을 추정하지 않음 |
| `selectionPolicy`, `postureScore`, `stableForMs` | 새 선별의 선택 필드 묶음. `auto-normal-clean-v1`·종합 점수 0~0.5·동일 기준에서 연속 조건 충족 실측 ms(1000 이상). 확인 전 프레임을 소급 저장하지 않음 |
| `image`, `world` | 원래 MediaPipe 0~12의 13점 `{x,y,z,visibility?}` |
| `values` | world xyz를 어깨 중심·폭으로 정규화한 39차원. 순서 `[0,6,5,4,1,2,3,10,9,7,8,11,12]` |

`references[]`는 `id`, `runId`, `participantCode`, `observationTimeMs`, `values`와 선택 `poseModelId`를
포함한다. 시각은 해당 기준으로 첫 행을 수집한 시각이고 좌표는 그 실행의 고정 등록 기준이다. 선별 기준만
변경하면 같은 reference를 사용할 수 있지만 segment는 분리한다. 내보내기는 메모리 자료의 복사본이다.

## 좌표 없는 수집 진단과 연속 창 수

`diagnostics.received`는 수집기에 전달된 프레임 수다. 세션 연결·등록 단계에서 수집기에 전달되지 않은
프레임이나 훅이 차단한 숨김 탭의 프레임은 포함하지 않는다. `excluded`에는 첫 제외 사유 하나만 누적한다.

| `excluded` 키 | 의미 |
| --- | --- |
| `outside` | 현재 선별 거리/종합 점수 초과 또는 이탈·복귀 상태로 정상 선별 제외 |
| `stability` | 새 선별에서 정상 후보 연속 1초 확인 전의 제외 프레임 |
| `quality` | 측정 불가 상태 또는 원본 좌표 품질 실패 |
| `registration` | 기준 등록을 마치지 않은 상태 |
| `timing` | 중복·역전·비유한 시각 또는 관측/판정 시각 불일치 |
| `provenance` | 등록 기준·추출기 정보 또는 재계산 거리 불일치 |
| `rate` | 유효하지만 마지막 저장에서 100ms 미만인 속도 제한 생략 |
| `synthetic` | 합성 입력 |
| `paused`, `full` | 수집 꺼짐 또는 6,000행 한도 |

`interruptions`는 관측 시간 단절·저장 간격 초과 또는 수집 중 품질/명시적 끊김의 횟수이며 제외 프레임 수와
합산하지 않는다. 선택·실행·참여자 변경으로 새 segment를 만드는 횟수 전체를 뜻하지 않는다.
`longestSegmentMs`는 연속 저장 구간의 첫 행과 마지막 행 사이 시간이다. 단일 행의 길이는 0이다.

`candidateWindows`는 **시간 조건을 충족하는 학습 후보 창** 수다. 같은 구간의 첫 저장 행을 100ms 격자의
시작으로 두고 입력 30시점(0~2900ms), 마지막 입력의 300ms 뒤 정답(3200ms)을 필요로 한다.
따라서 첫 후보는 **33개 격자 시점·3.2초 span**에서 생기며 이후 100ms stride로 하나씩 늘어난다.
구간 길이가 `span`일 때 후보 수는 `max(0, floor((span - 3200) / 100) + 1)`이다. 분리된 구간은 따로 계산한다.

`window`에는 `inputSteps:30`, `gridMs:100`, `horizonMs:300`, `spanMs:3200`, `strideMs:100`을 기록하고
`windowMeaning`은 `candidate_resampled_windows_not_training_completion`이다. 이 통계는 원본에 보간 좌표를
저장한다는 뜻이 아니다. 학습 변환 단계에서 유효한 양끝 관측·250ms 이하 간격만 선형 보간하며
segment/run/reference/participant/poseModelId/threshold 경계를 넘지 않는다. 추출 모델 불명·손상 좌표·분할
위반 등은 학습 변환기에서 다시 거부해야 한다. 후보 수는 실제 학습 완료 수나 독립 평가 표본 수가 아니다.

## 연구상의 의미

### 2026-10-15 추가 선별과 재검토 차단

새 실행은 영상 정책 v2, 종합 점수 ≤0.5, `ruleState=near_reference`와 기존 거리 조건을 1초 연속 요구한다.
누락·등록/선택값 변경·이탈/복귀 상태는 확인 시간을 끊는다. [ADR 0035](../docs/decisions/0035-posture-and-clean-normal-selection.md).
`selection.cleanGate` 확장은 `{policy:"auto-normal-clean-v1", maximumPostureScore:0.5, minimumStableMs:1000,
requiredRuleState:"near_reference", imagePosturePolicy:"image-posture-anchor-v2"}`다. 이 확장이 있으면 학습 준비기는 각 행의 새 정책·점수·연속 확인 출처를 검사한다.
과거 파일에 이 필드를 추가해 새 선별을 통과한 것으로 주장하지 않는다. 기존 `maximumDeviation`·정규화·시각·라벨 의미는 유지한다.

새 선별 출처가 없는 보존 행이 포함된 내보내기에는 `reviewGate:{status:"requires_review",reason:"legacy_selection",affectedRows:N}`와
`trainingAllowed:false`를 추가한다. 사용자 요청으로 별도 보존·표시한 자료에는 구체적인 사유/해시/표시일 등 리뷰 메타데이터를 더할 수 있다.
학습 준비·manifest 생성은 `reviewGate`가 있으면 창 생성/학습 전에 거부한다. 알 수 없는 리뷰 상태도 허용으로 추정하지 않는다.
표시를 지우거나 오래된 라벨을 자동 승인하는 기능은 없다. 파일은 원래 행을 유지한 채 보존하고 별도 수동 검토가 필요하다.

`정상자세(자동)`은 미검토 규칙 약라벨이다. 6%로 넓혀도 임상적 정상·자기 보고 확인·독립 평가 정답이 되지
않는다. 선택 편향을 기록하고 수동 자료와 분리한다. 자동 자료의 룰을 정답으로 사용해 그 룰이나 모델의
정확도를 평가하지 않는다. 참여자 분할을 먼저 정하고 시험 참여자의 이탈 자료로 학습·튜닝하지 않는다.

## 적용 종합 경계 출처

선택 행 필드 `postureEntryRatio`, `postureRecoveryRatio`는 해당 실측 룰의 진입/복귀 경계다. 새 실행은 0.7·0.7*2/3이며 없는 이전 행을 소급 변경하지 않는다. 자동 후보의 종합0.5배·실측 룰 범위 안·1초 조건과 `maximumDeviation` 의미는 유지한다.
