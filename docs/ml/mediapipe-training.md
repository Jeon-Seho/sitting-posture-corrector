# 수집한 MediaPipe 자료로 LSTM 학습하기

상태: 2026-10-14 구현, 2026-10-15 선별·재검토 차단 보완. `/dev`의 수집 JSON을 검사하고 **실제 PyTorch 회귀 학습**을 실행하는 로컬 연구 경로다.
합성 연결 검증과 [실제 개인 예측 비교](measurements/forecast-evaluation-2026-10-15.md)를 구분하며,
사용자의 자세 정확도나 교정 효과를 확인한 결과가 아니다. 최신 설계는 [현재 ML 계획](current-plan.md)을 따른다.

현재 자동 후보는 상대 거리 선택에 종합 0.5배 이내·실측 룰 범위 안·실측 1초 연속을 추가한다.
이전 선별 자료가 포함된 export 또는 사용자가 재검토를 요청한 자료의 `reviewGate`가 있으면 manifest 생성·학습 준비에서 거부한다.
파일과 원래 행은 보존하며 자동 승인하거나 학습에 섞지 않는다. [선별·보존 결정](../decisions/0035-posture-and-clean-normal-selection.md).

## 무엇을 학습하는가

- 입력: 같은 MediaPipe 추출기의 어깨 중심·어깨폭 정규화 13점 xyz, 39차원 × 30개 시각.
- 출력: 입력 끝에서 명목상 300ms 뒤의 39차원 좌표. 정상/비정상 분류 확률이 아니다.
- 구조: hidden 48 단층 LSTM + 선형 출력. 마지막 위치에 등속 이동 예측과 학습 보정값을 더한다.
- 정상 라벨은 수집 구간의 출처다. 회귀 정답은 실제 미래 관측 좌표에서 만들므로 프레임별 이탈 라벨이 필요하지 않다.
- 개인 정상 범위는 확인한 수동 30초 자료로 별도 계산한다. LSTM 학습과 정상 범위 적용은 다른 작업이다.

정상 구간만 학습한 LSTM의 예측 오차만으로 스트레칭 의도나 지속적 붕괴를 검증했다고 볼 수 없다.
`/dev`에서는 현재 좌표와 개인 기준의 거리·지속시간 판정을 유지하고 LSTM을 보조 비교한다.

## 환경과 파일 준비

저장소 루트에서 실행한다. 최초 전체 개발 환경은 `make setup`으로 준비한다.
검사·준비 명령은 Python 표준 라이브러리만 필요하며, 학습에는 선택 의존성이 필요하다.

```sh
python -m pip install -r model/analysis/requirements-lstm.txt
```

이미 저장소의 가상 환경을 만들었다면 아래 명령의 `python` 대신 `.venv/bin/python`을 사용한다.
학습은 재현 가능한 CPU 경로다. 웹캠 MediaPipe GPU 추론과 별도이며 PyTorch GPU 학습을 자동 활성화하지 않는다.

지원하는 입력은 수동 `normal-posture-collection-v1`, 자동 `normal-posture-auto-collection-v1/v2`이다.
자동 v1은 0.5%, v2는 각 행의 0.5%·3%·6% 선별값을 검증한다. 자동 자료는 `automatic_weak`,
사용자가 확인한 수동 자료는 `manual_confirmed`로 구분해 사용 창 수를 기록한다.
자동 라벨을 의료적 정상 정답이나 독립 평가 라벨로 바꾸지 않는다.

수집 JSON과 분할 manifest, 모델은 `~/posture-private` 같은 **저장소 밖**에 보관한다.
저장소 안에서는 무시되는 `data/`, `runs/`만 허용하며 `frontend/public` 등 추적할 수 있는 경로는 거부한다.
브라우저 자동 업로드·영상 저장·학습 모델 자동 설치는 없다.

## 한 사람 pilot 파일 목록 자동 만들기

처음에는 내려받은 JSON 경로만 지정하면 된다. 예를 들어 파일을 `~/posture-private/normal-auto.json`에 보관했다면:

```sh
python -m model.analysis.mediapipe_lstm manifest --mode pilot \
  --output "$HOME/posture-private/manifest.json" \
  "$HOME/posture-private/normal-auto.json"
```

입력 JSON에서 실제 추출기 ID와 익명 참여자 코드를 읽고 파일 해시를 계산한다. 다른 회차의 파일은
마지막에 경로를 더 나열할 수 있다. 한 사람의 자료만 허용하며 새 manifest만 만든다.
알 수 없거나 서로 다른 추출기, 여러 참여자, 겹치는 수집 자료, 유효 연속 창이 없는 자료는 거부한다.
이 명령은 시험 참여자를 자동 학습 목록에 넣지 않는다. 평가용으로 따로 둔 파일은 pilot 입력에 지정하지 않는다.
여러 참여자의 독립 평가에는 아래처럼 역할을 직접 배정해야 한다.

## 참여자 분할 manifest 직접 작성

같은 사람은 촬영 회차와 파일이 달라도 같은 익명 참여자 코드를 쓴다.
수집 JSON에 기록한 코드와 manifest의 코드가 일치해야 한다.
프레임을 무작위 분할하지 않고 참여자를 먼저 train·validation·test에 배정한다.

한 사람으로 경로를 확인하는 pilot 예시다. 아래 SHA-256 자리에는 실제 파일 해시를 넣는다.
`path`는 manifest 폴더 기준 상대 경로나 외부 절대 경로이며 파일 이름은 실제 내려받은 이름으로 바꾼다.

```json
{
  "schema_version": "mediapipe-lstm-manifest-v1",
  "poseModelId": "mediapipe-pose-full-f16-v1/tasks-vision-1.0.1",
  "participants": {"train": ["P01"], "validation": [], "test": []},
  "files": [{"path": "normal-auto.json", "sha256": "실제 파일의 SHA-256 64자리"}]
}
```

해시는 다음처럼 확인한다. 파일을 수정하거나 새로 내려받으면 내용을 확인하고 해시를 갱신한다.

```sh
python -c 'import hashlib,pathlib; p=pathlib.Path.home()/"posture-private/normal-auto.json"; print(hashlib.sha256(p.read_bytes()).hexdigest())'
```

`poseModelId`는 수집에 쓴 Lite/Full/Heavy 모델과 SDK 버전의 정확한 ID다. 서로 다른 추출기를 섞지 않는다.
지원 ID는 [모델 목록](../../frontend/model-variants.json)과 일치하도록 검사한다.
ID가 없는 옛 자료를 Heavy나 Full로 추정하지 않으며 이 학습 경로에서는 다시 수집하도록 거부한다.

독립 참여자 평가에서는 예를 들어 `train:["P01"]`, `validation:["P02"]`, `test:["P03"]`처럼
세 역할을 겹치지 않게 지정하고 각 참여자의 파일을 `files`에 해시와 함께 나열한다.
이는 최소 실행 구조이며 3명으로 일반화 성능이 충분히 검증된다는 뜻은 아니다.
모든 지정 참여자는 유효한 연속 창을 제공해야 한다. 동일 파일/수집 ID 중복도 거부한다.

수동 자료는 `review:user_confirmed_normal`이고 유효 30초·최소 100관측을 만족해야 한다.
여러 참여자 학습/평가에는 `purpose:training_normal` 자료만 허용한다.
`personal_calibration` 자료는 명시적인 train-only pilot에서만 허용하며 시험 참여자의 보정 자료를 전역 학습에 섞지 않는다.

## 검사와 학습

한 사람의 연결 확인:

```sh
python -m model.analysis.mediapipe_lstm validate \
  --manifest "$HOME/posture-private/manifest.json" --mode pilot

python -m model.analysis.mediapipe_lstm train \
  --manifest "$HOME/posture-private/manifest.json" --mode pilot \
  --output "$HOME/posture-private/run-01" --epochs 25
```

`prepare`는 `validate`와 같은 전체 준비 검사를 수행하는 별칭이며 둘 다 학습/가중치 생성을 하지 않는다.
`--mode participant_holdout`은 train·validation·test가 모두 필요하다. pilot은 validation/test 목록을
비워야 하며 원래 시험 참여자를 자동으로 train으로 옮기지 않는다.
학습 창이 없으면 연속 구간 부족 이유를 출력하고 중단한다. 파일 행 수만 많아도 학습을 허용하지 않는다.

선택 옵션: `--seed 42`, `--batch-size 64`, `--threads 2`, `--maximum-windows 20000`.
창 한도를 올리면 메모리 사용량도 늘어난다. 출력은 새 폴더 또는 빈 폴더만 허용하고 기존 결과를 덮어쓰지 않는다.

## 시간 창과 실제 미래 정답

1. 원본 좌표와 저장된 39차원 값의 일치, 품질, 단조 증가하는 관측/영상 시각을 검사한다.
2. 참여자·파일·세션·등록 기준·segment·추출기·선별값 경계를 넘지 않는다. 관측 또는 영상 간격이 250ms를
   초과하면 별도 구간이다. 수동 품질 누락 사건도 segment가 나뉘어 있어야 한다.
3. 각 구간의 첫 실제 관측에 맞춘 100ms 격자로 입력을 만든다. 유효한 두 실제 관측 사이에서만 보간하고
   미래 외삽이나 누락 구간 연결은 하지 않는다. 표시용 평활화는 사용하지 않는다.
4. 30개 입력은 0~2,900ms, 명목 목표는 3,200ms다. 목표 정답은 이 목표 시각의 **±50ms 이내 가장 가까운 실제 관측**이다.
   같은 거리면 이른 관측을 택한다. 목표 좌표는 보간하지 않는다.
5. 입력 보간에 사용한 마지막 원본 관측이 정답 관측보다 반드시 먼저여야 한다.
   정답이 허용 시간 안에 없거나 이 인과 조건을 만족하지 않으면 창을 버린다.

따라서 화면의 33격자/3.2초 기준 연속 후보 수와 최종 학습 창 수가 다를 수 있다.
`report.json`은 후보 수, 목표 누락으로 제외한 수, 실제 목표 간격 범위와 최대 시간 오차를 나누어 기록한다.
실제 정답 간격은 입력 끝에서 250~350ms이며 **정확히 300ms 뒤 실측 평가**라고 부르지 않는다.
이는 격자 입력 끝 기준이다. 입력 보간에 필요한 마지막 원본 관측이 더 늦을 수 있으므로,
그 관측을 확보한 뒤 실제 정답까지 남은 `effective_horizon_min_ms/max_ms`도 별도로 보고한다.
예를 들어 격자 끝 2,900ms·마지막 입력 원본 3,050ms·정답 3,150ms이면 각각 250ms와 100ms다.
등속 비교군은 같은 정답의 실제 시간 간격을 사용하고 LSTM은 명목 300ms 구조를 유지한다. 이 차이도 평가 한계에 기록한다.

## 분할과 출력 해석

scaler 평균·표준편차는 train의 입력 창만 사용한다. 각 축 scale 최솟값은 개발 상수 0.02다.
모델 선택은 validation MSE만 사용하고 test는 최종 선택 후 한 번 평가한다.
pilot은 마지막 epoch를 사용하고 validation/test 성능이나 새 사람 일반화를 보고하지 않는다.

| 산출물 | 내용 |
| --- | --- |
| `model.json` | 브라우저용 `forecast-weights-v2` 가중치·특징·추출기·집계 학습 출처. 참여자 코드/원본 경로 없음 |
| `research-lstm.pt` | CPU 연구 checkpoint. `model.json.source_sha256`는 이 파일의 정확한 SHA-256 |
| `report.json` | 파일 해시·분할별 창/참여자 수·라벨별 train 창 수·실제 목표 시각 집계·환경·학습 이력·비교군 오차 |
| `explicit-synthetic-parity.json` | 실제 참여자 창을 복사하지 않은 고정 합성 입력과 PyTorch 출력. 브라우저 수치 동등성 검사용 |

평가는 LSTM·마지막 위치 유지·등속 이동을 같은 실제 목표에 비교한다. 수치는 좌표 MAE와
얼굴/귀/어깨 균형 거리이며 단위는 어깨폭이다. `% 정확도`나 정상/비정상 F1이 아니다.
시험 참여자 평가를 했더라도 정상 자동 선별 구간의 좁은 분포라는 한계가 남는다.
모든 모델은 `domain_validated:false`, `posture_accuracy:null`(보고서)을 유지한다.
`participant_generalization_evaluated:true`는 분리한 참여자의 **미래 좌표 오차를 계산했다**는 뜻이지 높은 성능이나 자세 판정 검증을 뜻하지 않는다.

## 개발 화면에 연결

새로운 30초로 이미 학습한 모델을 비교하려면 수동 수집의 **예측 모델 평가용 · 학습 제외**를 선택한다.
[평가 전용 수집 v1](../../contracts/forecast-evaluation-collection.v1.md)은 정상 라벨과 개인 범위를 만들지 않으며,
위 manifest/학습 명령은 해당 파일을 거부한다. 고정된 모델·scaler로만 미래 관측 오차를 계산하고,
같은 사람의 새 촬영 비교를 참여자 분리 성능으로 해석하지 않는다. 평가 자료로 다시 학습하거나 모델을 선택하면
그 자료는 더 이상 독립적인 최종 비교 자료가 아니다.

`/dev` → 실험 설정 → 학습 모델 불러오기에서 `model.json`을 선택한다.
수집 당시의 MediaPipe 모델과 현재 카메라 모델이 정확히 같아야 예측을 사용한다.
불일치·모델 손상·관측 불가 상태는 예측 준비 완료로 표시하지 않는다. 거리·시간 판정과 분리해서 확인한다.
파일은 브라우저 메모리에서 읽으며 공개 정적 가중치 파일을 자동 덮어쓰지 않는다.

## 재현 가능한 합성 검증

```sh
python -m unittest tests.test_mediapipe_lstm tests.test_mediapipe_lstm_training -v
python -m model.analysis.mediapipe_smoke --output /tmp/posture-mediapipe-synthetic-run
```

출력 폴더는 아직 존재하지 않는 경로를 선택한다. smoke는 명시적 합성 참여자 3명의 자료를 생성하고
각 역할 28개 창으로 2 epoch를 실제 학습한다. 실제 영상이나 사용자 좌표는 사용하지 않는다.
합성 manifest는 `explicitSynthetic:true`로 표시되고 모델 ID도 `explicit-synthetic-mediapipe-lstm-`으로 시작한다.
자료 검증 테스트는 표준 라이브러리만으로 실행할 수 있고, 학습 테스트는 PyTorch 환경에서 실제 fitting을 실행한다.
`make setup`의 기존 연구 의존성과 `make test`의 unittest discovery로 전체 `make check` 및 CI에 연결되어 있다.

관련 계약: [수동 수집](../../contracts/normal-posture-collection.v1.md),
[자동 수집 v2](../../contracts/auto-normal-posture-collection.v2.md),
[예측 실험](../../contracts/forecast-experiment.v1.md).
