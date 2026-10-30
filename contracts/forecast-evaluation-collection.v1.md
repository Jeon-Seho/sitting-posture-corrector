# 고정 예측 모델 평가용 수집 v1

`/dev`에서 이미 학습된 예측 모델을 새로운 촬영으로 비교하기 위한 별도 원본 수집이다.
정상 학습 후보와 개인 기준 등록 자료로 재해석하지 않는다. 일반 서비스 계약은 변경하지 않는다.

## 수집과 용도

`예측 모델 평가용 · 학습 제외` 선택 → 준비 3초 → 유효 관측 30초 → 평가 용도 확인 → 별도 JSON 내보내기.
가림·낮은 품질·시각 역전·250ms 초과 누락·최대 2분·최대 1,200표본 제한은
[수동 수집 v1](normal-posture-collection.v1.md)과 같다. 탭 메모리에만 보관하고 명시적으로 내려받는다.

평가 확인은 정상 자세 정답을 붙이는 행위가 아니다. 개인 정상 범위를 fitting하거나 현재 범위를 변경하지 않는다.
이 자료를 학습 목록, scaler 추정, 하이퍼파라미터 선택, 기준 갱신에 넣지 않는다.

## 파일

| 필드 | 의미 |
| --- | --- |
| `schema_version` | `forecast-evaluation-collection-v1` |
| `id`, `createdAt`, `source` | 수집별 ID, 명시적 수집 시작 시각, `webcam` |
| `dataRole`, `trainingAllowed` | `evaluation_only`, `false` |
| `metadata.purpose` | `forecast_evaluation` |
| `metadata.participantCode`, `metadata.sessionCode` | 같은 사람의 익명 코드와 별도 평가 회차 |
| `metadata.poseModelId` | 실제 추출기 ID. 평가 모델과 정확히 일치해야 함 |
| `review` | `user_confirmed_evaluation` |
| `collectionMethod` | `manual_30s` |
| `featureVersion`, `validMs`, `timing`, `frames`, `gaps` | 수동 v1과 같은 특징·원본 13점·실측 시간·누락 구조 |

`label`, `labelDisplay`, `profile`은 넣지 않는다. 학습용 `collection_frames`와 pilot manifest 생성은
평가 스키마를 거부한다. 별도 `evaluation_frames`에서 용도·품질·시간·좌표 재계산을 검사한다.
파일을 잘못 입력했을 때 학습이 진행되는 일을 막는 용도 구분이며, 파일 내용을 악의적으로 재작성하는 행위를 방지하는 보안 장치는 아니다.

## 비교 원칙

- 평가 전 모델·체크포인트·학습 파일 목록을 고정하고 평가 후 해시가 같은지 확인한다.
- 평가 파일의 hash·수집 ID·촬영 회차가 기존 학습 자료와 다른지 검사한다.
- 두 방식 모두 동일한 과거 30개 입력과 동일한 실제 미래 관측을 사용한다.
- 입력은 100ms 격자, 명목 목표는 300ms 뒤, 정답은 ±50ms 내 실제 관측이다.
- 누락·회차 경계를 연결하지 않는다. 입력 보간에 사용한 마지막 실제 관측은 정답보다 먼저여야 한다.
- 격자 끝 기준 실제 목표 간격과 입력 관측 확보 뒤 남은 유효 예측 시간을 함께 보고한다.
- 좌표 오차는 어깨폭 단위다. 작은 값이 낫고 자세 판정 정확도·확률이 아니다.
- 같은 사람의 새 촬영은 별도 회차 비교다. 참여자 분리 일반화 평가로 보고하지 않는다.
- 중첩 시간 창을 독립적인 참여자나 독립 시행 수로 세지 않는다.

실제 원본·평가 파일 목록·모델은 저장소 밖 또는 허용된 Git 제외 경로에 둔다.
합성 수집·입력 거부 검증을 프론트와 Python의 기존 테스트 탐색에 연결한다.
