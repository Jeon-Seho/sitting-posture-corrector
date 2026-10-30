# 자동 정상 후보 수집 v1

이 문서는 **고정 0.5% 선별의 과거 v1 파일** 의미를 보존한다. 선택 가능한 0.5%·3%·6%와
행별 선별 기준을 사용하는 현재 내보내기는 [자동 수집 v2](auto-normal-posture-collection.v2.md)를 따른다.
v1의 `maximumDeviation: 0.005`를 새 기본값으로 재해석하지 않는다.

`/dev` 실제 카메라 측정의 등록 기준과 매우 가까운 원본 관측을 초기 실험 자료로 내보내는 별도 계약이다.
정상 자료 파일은 [수동 30초 수집](normal-posture-collection.v1.md), 좌표 없는 진단 결과는
[개발자 진단 export](developer-lab-export.v1.md)와 구분한다. 일반 서비스·서버 계약을 대체하지 않는다.

## 선별과 수명

- 실제 웹캠 측정에서 기준 등록이 끝난 뒤 자동 수집이 기본 켜진다. 별도 카메라나 모델 실행을 만들지 않는다.
- 현재 유효 관측의 `deviation ≤ 0.005`일 때 최대 10Hz로 새 행을 추가한다. 조건 진입 순간 한 번만 저장하지 않는다.
- 거리는 어깨 중심·현재 3D 어깨폭으로 정규화한 13점의 기준 대비 거리다. 얼굴 9점·귀 2점·어깨 2점의
  각 평균 점 거리를 구해 세 그룹을 같은 비중으로 평균한다. 표시값은 이 거리×100이며 **0.5% 이하**다.
- LSTM 예측 오차·개인 정상 범위 점수·영상 픽셀 거리·확률은 선별값이 아니다. 0.5%는 사용자가 요청한 초기 실험값이다.
- 등록 전·등록 중·합성 데모·저품질·기준 밖·관측/판정 시각 불일치·중복/역전 시각은 저장하지 않는다.
  원본 관측과 등록 기준으로 재계산한 거리가 판정의 거리와 같은지도 확인한다.
- 기준 밖·품질 실패·250ms 초과 실제 간격·중복/역전·일시정지·탭 숨김·측정 종료는 연속 구간을 끊는다.
  기준/측정/참여자 변경에도 구간을 분리하고 새 기준 출처를 남긴다. 떨어진 행을 보간하거나 하나의 연속 창으로 붙이지 않는다.
- 최대 6,000행에 도달하면 수집을 멈추고 기존 자료를 유지한다. 다운로드가 자동 삭제를 뜻하지 않는다.
  사용자가 비우기를 실행하면 해당 메모리 자료를 삭제한다. 화면의 최근 행 목록은 최대 20행이다.
- 참여자 코드는 자동 수집을 멈춘 상태에서만 바꾸며 이미 저장한 행의 코드는 바꾸지 않는다.

좌표는 브라우저 메모리에 보관한다. 자동 업로드·localStorage/IndexedDB·영상/음성 기록은 없다.
명시적으로 요청한 별도 JSON 다운로드에만 원본 좌표와 기준을 넣으며 새로고침/탭 종료로 미저장 자료는 사라진다.
자동 자료로 개인 프로파일을 fitting하거나 기준을 따라 움직이게 만들지 않는다.

## 파일 `normal-posture-auto-collection-v1`

| 필드 | 의미 |
| --- | --- |
| `schema_version` | `normal-posture-auto-collection-v1` |
| `id`, `createdAt` | 메모리 수집기의 무작위 ID와 생성 ISO 시각 |
| `source`, `domainValidated` | `webcam`, `false` |
| `label` | `normal_auto_assumed` |
| `displayLabel` | `정상자세(자동)` |
| `labelSource`, `review` | `auto_rule`, `not_reviewed` |
| `purpose` | `early_experiment_only` |
| `selection.metric` | `balanced_face_ears_shoulders_distance` |
| `selection.maximumDeviation`, `selection.inclusive` | `0.005`, `true` |
| `selection.maximumHz`, `selection.interpolation` | `10`, `false` |
| `timing` | 아래 세 가지 시각의 의미, `unit:ms`, `maximumGapMs:250` |
| `references[]` | 기준별 ID·측정 ID·참여자 코드·기록 시각·기준 39차원 좌표 |
| `rows[]` | 실제 선별한 각 관측 행. 아래 표 참조 |

| `rows[]` 필드 | 의미 |
| --- | --- |
| `row` | 현재 버퍼에서 1부터 증가하는 행 번호 |
| `timeMs` | 원본 카메라 관측의 단조 시각, `camera_observation_clock` |
| `observationTimeMs` | 이번 측정 실행 기준 시각, `measurement_run_clock` |
| `videoTimeMs` | 원본 video 시각, `video_clock` |
| `segment` | 이어진 선별 구간 ID. 같은 값이 연속 학습 창의 필요조건이며 단독 충분조건은 아님 |
| `runId`, `referenceId` | 실제 측정 ID와 참조하는 등록 기준 ID |
| `participantCode` | 영문·숫자·`_`·`-` 2~48자의 익명 코드. 실제 동일 참여자는 같은 코드 유지 |
| `deviation` | 이 행의 실제 기준 거리. 단위는 어깨폭이며 0.005 이하 |
| `label`, `displayLabel`, `labelSource`, `review` | 위 파일 수준의 자동 라벨 출처를 각 행에도 유지 |
| `width`, `height` | 해당 관측의 영상 크기 |
| `poseModelId` | 선택 필드. 실제 좌표 추출기의 모델·버전 ID. 누락은 모델 불명이며 Heavy로 추정하지 않음 |
| `image`, `world` | 원래 MediaPipe 0~12의 13점 `{x,y,z,visibility?}` |
| `values` | 어깨 정규화 39차원 값. `[0,6,5,4,1,2,3,10,9,7,8,11,12]` 순서의 world xyz |

`references[]`의 필드는 `id`, `runId`, `participantCode`, `observationTimeMs`, `values`와 선택 `poseModelId`다.
`observationTimeMs`는 해당 기준으로 첫 행을 수집한 시각이고 `values`는 이번 실행에 고정한 등록 기준이다.
기준 변경·새 실행·참여자 변경은 새로운 참조를 사용한다. 내려받은 행/기준은 메모리 원본의 복사본이다.
좌표 추출기 ID 변경(모델 불명으로의 변경 포함)도 별도 참조·세그먼트로 나눈다. 같은 좌표값이라도
Lite/Full/Heavy 자료를 같은 기준의 연속 시퀀스로 묶지 않는다. 기존 v1 자료의 선택 필드 누락은 허용한다.
화면 평활화 좌표·미래 예측값·보간 생성 좌표는 수집 파일에 넣지 않는다.

## 라벨의 연구상 의미

`정상자세(자동)`은 **규칙이 붙인 미검토 약라벨**이다. 사용자가 확인한 정상, 의학적 정상,
독립 정답 또는 모델 정확도 결과가 아니다. 0.5% 부근만 남기므로 자연스러운 정상 변동을 충분히 대표하지 못한다.
원본 시각·측정/기준/참여자·세그먼트 경계를 유지하여 품질 확인 뒤 초기 학습 후보로만 사용한다.

이 약라벨을 평가 정답으로 사용해 같은 거리 규칙이나 이를 학습한 모델의 정확도를 계산하지 않는다.
수동 촬영 자료와 출처를 분리하고, 참여자 분할을 먼저 만든 뒤 시계열 창을 생성한다. 시험 참여자의 이탈 자료로
fitting/튜닝하지 않는다. 실제 좌표·참여자 코드·기준·모델 파일은 Git에 추가하지 않는다.

근거는 [ADR 0029](../docs/decisions/0029-automatic-normal-labels-and-forecast-display.md)다.
검증은 합성 `autoNormalCollection.test.ts`와 훅/개발 화면 회귀에서 수행하며 기존 프론트 게이트에 포함한다.
