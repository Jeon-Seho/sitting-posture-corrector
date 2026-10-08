# 본인 자세의 첫 학습 실험

사용자는 소량의 본인 예시를 수학적으로 증강해 동작 실험을 하는 것을 선택했다.
`model/analysis/train_personal.py`는 **같은 사람의 서로 다른 촬영 간 확인**을 위한 별도 오프라인 도구다.
다른 참여자에 대한 연구는 기존 [참여자 분할 도구](dataset-preparation.md)와 [프로토콜](protocol.md)을 그대로 따른다.

## 입력과 실행

Python 3.9+ 표준 라이브러리만 사용한다. 모델 설치나 서비스 추론 변경은 없다.
설정과 원본 CSV, 출력은 `database/temp/`, `.cache/`, `runs/` 등 Git 제외 경로 또는 외부 위치에 둔다.
출력은 새 디렉터리여야 하며 기존 결과를 덮어쓰지 않는다.

```sh
.venv/bin/python model/analysis/train_personal.py \
  --config database/temp/personal-experiment-2026-10-02.config.json \
  --output database/temp/personal-experiment-2026-10-02-run-01
```

`schema_version=posture-personal-experiment-v1`, `purpose=same_person_feasibility`가 필수다.
입력은 한 명의 v2 촬영이며 검토된 `manual_label`만 정답으로 사용한다. v1을 자동 변환하거나 규칙 예측/과제 지시를 정답으로 바꾸지 않는다.
촬영 경로·SHA-256·capture/calibration ID·자세·회차를 `captures`에 먼저 명시한다.
`roles_by_repetition`은 촬영 전체의 `train`, `validation`, `holdout`을 배정한다. 개인 실험의 holdout은 시험 참여자와 다르다.
역할마다 모든 자세의 유효 창이 필요하며 같은 파일·해시·촬영을 두 역할에 넣을 수 없다.
사람·카메라 시점·추출기·특징 버전·회차가 설정과 다르면 거부한다.

현재 첫 실험의 탐색 설정은 1회차 학습, 2회차 검증, 3회차 확인용이다.
관측 창 3초, stride 3.3초, 최대 관측 간격 250ms, 최소 15행을 명시했다.
설정값은 이번 소규모 실험용이며 제품 임계값·검증된 연구 표준이 아니다.
실제 관측 시각을 사용하며 보간·프레임 복제·시각 정렬로 오류를 숨기지 않는다.
저품질·미검토·미지정·자리 비움·중단·누락 경계 양쪽을 연결하지 않는다. 창끼리 원 관측을 공유하지 않는다.
CSV의 이전 개인 기준을 유지하며 확인용 이탈 자료로 기준을 다시 계산하지 않는다. 기준 등록 영상/프레임이 없어 유도 과정은 검증하지 못한다.

## 특징과 증강

입력 특징은 `delta_head_gap`, `delta_offset`, `delta_tilt` 세 개로 고정한다.
각 실제 시간 창의 평균·모표준편차·최소제곱 시간 기울기(초당)를 계산해 수치 9개로 만든다.
규칙 점수·예측·과제·회차·라벨·파일 ID를 모델 특징으로 사용하지 않는다.

증강은 원본 학습 창에만 적용한다. 각 클래스의 원 관측에서 클래스 평균을 뺀 pooled SD `s_j`를 계산한다.
변형은 `x'_tj = a_j x_tj + b_j + e_tj`이며, 각 창/특징의 `a_j ~ N(1, scale_sd)`는 0.8–1.2로 제한한다.
`b_j ~ N(0, offset_sd × s_j)`는 창 전체의 작은 이동, `e_tj ~ N(0, jitter_sd × s_j)`는 관측별 작은 잡음이다.
첫 실행은 원본당 20개, `scale_sd=0.03`, `offset_sd=0.02`, `jitter_sd=0.03`, seed 42를 사용한다.
왼쪽/오른쪽을 뒤집거나 시간축을 바꾸지 않는다. 의미를 보존한다는 탐색 가정이며 증명된 인체 모델이 아니다.
원본 창과 합성 창 수를 따로 기록한다. 합성 창은 새로운 사람·독립 촬영 표본을 늘리지 않는다.

스케일러는 **원본 학습 창만**으로 맞춘다. 학습 데이터 클래스별 총 기여도를 같게 한 multinomial logistic regression(softmax)을 full-batch gradient descent와 L2로 학습한다.
optimizer 설정도 명시하며 첫 실행은 400회·학습률 0.05·L2 0.01이다.
원본 모델과 증강 모델을 같은 스케일러·optimizer로 학습한다.
검증 Macro-F1이 높은 모델을 선택하고 동률이면 원본을 선택한 뒤 확인용 촬영을 한 번 평가한다.
확인용 자료는 스케일러·증강 통계·모델 선택에 쓰지 않는다.
이는 [scikit-learn 공식 누수 방지 원칙](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage)을 따른다.
작은 변형의 근거 범주는 [시계열 증강 조사 논문](https://arxiv.org/abs/2002.12478)이며 이번 자세 자료에서의 유효성은 별도로 검증해야 한다.

## 결과와 한계

`report.md`/`report.json`에 원본·증강 검증 성능, 선택된 모델의 확인용 accuracy·Macro-F1·balanced accuracy·클래스 recall·혼동행렬을 기록한다.
`models.json`은 스케일러와 두 후보의 가중치이며 서비스 자동 연동이나 보정된 확률이 아니다.
`manifest.json`은 완료 상태·설정/원본/코드/출력 hash·촬영 분리·원 관측 창 ID·제외 진단을 기록하고 마지막에 게시한다.
POSIX 출력 디렉터리 0700, 파일 0600을 사용한다. Windows ACL은 별도 관리한다.
실제 자료와 가중치는 Git에 추가하지 않는다. 원본 파일은 읽기만 하며 실행 중 내용이 바뀌면 결과 게시를 거부한다.

한 사람·같은 카메라·같은 개인 기준·짧은 안내 촬영의 결과다. 자기 보고 라벨은 전문가 프레임 검수가 아니다.
LSTM의 우월성, 실제 작업 중 자세 정확도, 다른 날/다른 사람 성능, 알림 시간당 오탐·감지 지연·의료 효과는 평가하지 않는다.
관측 창을 독립 참여자처럼 세어 신뢰구간을 만들지 않는다. 후속 확인에는 같은 사람의 별도 촬영일 자료가 필요하다.

`tests/test_personal_training.py`는 명시적인 합성 자료로 실제 학습, 촬영 분리, holdout/검증 fitting 누수,
품질·시각·기준 경계, 변형 재현, 원본 hash·출력 보관을 검사한다. 루트 `make check`/CI Python discovery에 포함된다.
