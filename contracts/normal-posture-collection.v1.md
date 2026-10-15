# 정상 자세 수집 및 개인 정상 범위 v1

상태: `/dev` 연구 구현. 일반 서비스·진단 내보내기와 별도이다. 실제 성능 검증 전이며
`normal_assumed`는 사용자가 목표 자세 구간을 확인했다는 뜻이다. 의학적 정상 판정이 아니다.
수동 `30초 측정하기` 흐름의 계약이다. 자동 규칙 라벨 자료는
[자동 수집 별도 계약](auto-normal-posture-collection.v1.md)을 사용한다.

## 수집 생명주기

명시적 시작 → 카메라 연결 → 3초 준비 → 유효 관측 30초 → 구간 확인 → 용도별 적용/내보내기.
준비·가림·추적 실패·250ms 초과 관측 누락을 유효 시간에서 제외한다. 최대 벽시계 2분,
저장 최대 10Hz(실제 관측 시각 그대로), 최대 1,200프레임/600누락 사건이다. 보간하지 않는다.
탭 숨김·시각 역전·카메라 끊김·직접 종료·화면 이동은 수집을 중단한다. 유효 30초 및 최소
100표본을 채우지 못한 구간은 모델 적용/내보내기를 할 수 없다. 완료 후 추가 관측은 흡수하지 않는다.

브라우저 메모리만 사용한다. 영상/음성 저장, 자동 업로드, localStorage/IndexedDB 기록은 없다.
확인 뒤 사용자가 내려받는 파일에만 원본 좌표가 포함된다. 기존 개발 진단 export에는 추가하지 않는다.
실제 자료와 개인 범위 파일은 Git에 추가하지 않는다. 새로고침/탭 종료로 미저장 자료는 사라진다.

## 수집 파일 `normal-posture-collection-v1`

| 필드 | 의미 |
| --- | --- |
| `schema_version` | `normal-posture-collection-v1` |
| `id` | 수집별 무작위 ID. 참여자 코드와 구분 |
| `source` | `webcam`. 합성 데모에서 수집하지 않음 |
| `label`, `review` | `normal_assumed`, `user_confirmed_normal` |
| `labelDisplay`, `collectionMethod` | 2026-10-14 추가 메타데이터: `정상자세(수동)`, `manual_30s`. 이전 파일에는 없을 수 있음 |
| `metadata.participantCode` | 영문·숫자·`_`·`-` 2~48자 익명 코드. 같은 참여자는 같은 코드 유지 |
| `metadata.sessionCode` | 같은 규격의 촬영 회차 코드 |
| `metadata.purpose` | `personal_calibration` 또는 `training_normal` |
| `metadata.poseModelId`, `frames[].poseModelId` | 선택 필드. 실제 좌표를 추출한 MediaPipe 모델·버전 ID. 2026-10-14 이전 자료에서 없으면 모델 불명이며 Heavy로 추정하지 않음 |
| `createdAt` | 명시 수집 시작 시각의 ISO 문자열 |
| `featureVersion` | `mediapipe-shoulder-normalized-centroids-v1` |
| `validMs` | 연속성 조건을 만족하는 저장 관측 간격 합계 |
| `timing` | 단위 ms, 명시 수집 시작 기준, 준비 3,000ms, 최대간격 250ms, `interpolation:false` |
| `frames[]` | `timeMs`, 원래 `videoTimeMs`, `segment`, `width`, `height`, `image`, `world`, `values` |
| `gaps[]` | 상대 `timeMs`, `reason:quality/gap/hidden/interrupted` |
| `profile` | 해당 구간에서 맞춘 아래 통계적 개인 범위. 학습용 파일에서는 참고 산출물 |

`image`/`world`는 원래 MediaPipe 0~12 얼굴/어깨 13점의 `{x,y,z,visibility?}`이다.
`values`는 `liveForecastPoints`와 동일한 39D: `[0,6,5,4,1,2,3,10,9,7,8,11,12]` 순서의
world xyz를 현재 양어깨 중심으로 옮기고 3D 어깨폭으로 나눈 값이다. 표시 평활화는 반영하지 않는다.
개인 식별 이름·계정·기기 ID·영상·음성은 포함하지 않는다. 좌표도 연구 자료이므로 사용자가 관리하는
외부 위치에 보관하며 삭제는 다운로드 파일과 탭 메모리를 각각 관리한다.

`personal_calibration`은 해당 참여자 개인 범위 적용용이다. `training_normal`은 향후 전역 학습 후보로만
내보내며 현재 개인 범위에 자동 적용하지 않는다. 시험 참여자의 평가 자료를 fitting/튜닝에 사용하지 않는다.
분할은 참여자 단위로 먼저 결정하고 그 후 시간 창을 생성한다. 세션·가림·누락·역할 경계를 잇지 않는다.

## 개인 범위 `normal-posture-profile-v1`

| 필드 | 의미 |
| --- | --- |
| `schema_version` | `normal-posture-profile-v1` |
| `id`, `featureVersion`, `domainValidated` | 수집 ID, 같은 특징 버전, 항상 `false` |
| `baseline` | 확인한 구간의 39축별 중앙값 |
| `center` | 9개 특징 축별 중앙값 |
| `tolerance` | 각 특징의 허용 폭 9개 |
| `provenance` | 수집 ID/익명 참여자/세션/용도/생성일시, 표본 수/유효 시간, `review:user_confirmed_normal`, `source:webcam` |
| `fitting` | `quantile:0.95`, `spreadMultiplier:1.5`, 적용 `floors` |

특징은 정규화 좌표의 얼굴 9점 중심 xyz, 귀 2점 중심 xyz, 양어깨 방향 xyz의 9축이다.
각 허용 폭은 `max(개발 floor, 95% 분위 절대 중앙편차 × 1.5)`이다. 개발 floor는 얼굴/귀
6축 0.12, 어깨 방향 3축 0.10(어깨폭 기준)이다. 실제 정확도나 의학적 허용각에서 나온 값이 아니다.

점수는 `max(abs(현재 특징 − 학습한 center) / tolerance)`이다. 1 초과는 범위 밖,
2/3 이하는 복귀 진입 기준이다. 확률·정확도·건강 점수가 아니다. 시간 판정과 관측 품질은
별도 [예측 실험 계약](forecast-experiment.v1.md)을 따른다. 낮은 품질은 `unmeasurable`이다.

매번 측정을 시작할 때 8초 기준 등록은 유지한다. 알려진 동일 추출기의 등록 후보를 학습한
`center`와 `tolerance`에 비교해 점수 1 이하만 통과시킨다. 크게 벗어나면 등록을 거부하고,
프로파일 미상·손상·추출기 불일치·관측 부족을 통과로 처리하지 않는다. 프로파일이 없는 경우는
학습 검증이 없는 기존 거리 룰 기준 등록으로 구분한다.
학습한 중심과 허용 폭은 등록 이후 측정에서도 고정한다. 새 등록 후보나 `baseline`으로 학습
중심을 덮어쓰지 않는다. 사용 중 이탈 자료를 자동 학습하거나 기준이 따라 움직이게 만들지 않는다.
개인 파일 불러오기는 100KB 이하, 엄격한 버전/차원/유한값/메타데이터 검증을 거치며
`personal_calibration`만 현재 개인 범위로 적용한다. 파일이 같은 참여자의 것인지 사용자가 확인해야 한다.

`provenance.poseModelId`는 선택 메타데이터이며 수집 파일과 같은 실제 추출기 ID를 보존한다.
모델 ID가 없는 이전 v1 파일은 계속 읽을 수 있지만 추출기 호환성이 확인된 것으로 취급하지 않는다.
동일한 알려진 ID만 호환 판정하며 Lite/Full/Heavy 또는 버전 변경은 같다고 가정하지 않는다.
수동 수집 도중 모델 ID가 바뀌거나 알려진 ID가 사라지면 수집을 중단해 한 프로파일에 섞지 않는다.
같은 모델의 CPU/GPU 실행 방식은 모델 ID를 바꾸지 않는다. 실행 방식 비교는 성능 진단에 별도로 남긴다.

## 검증

명시적 합성 자료만 사용하는 `normalCollection.test.ts`, `useNormalCollection.test.tsx`,
`DeveloperNormalCollection.test.tsx`가 수집/품질/시간/확인/용도/내보내기/프로파일 검증을 수행한다.
`normalReferenceValidation.test.ts`는 등록 후보·학습 중심 고정·동일 추출기·score=1 경계를 합성 자료로 검증한다.
`make check-frontend`와 전체 `make check`의 기존 프론트 게이트에 포함된다.
설계 근거와 검증 전 상수는 [정상 구간 모델 결정](../docs/decisions/0028-normal-only-developer-model.md), 중심 고정과 등록 검증 변경은 [ADR 0032](../docs/decisions/0032-normal-reference-and-mediapipe-training.md)를 참조한다.
