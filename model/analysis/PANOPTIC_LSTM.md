# Panoptic 좌표 LSTM 연구 실험

개인 기준 등록 없이 공개 좌표 시계열로 0.3초 뒤 좌표를 예측한다.
자세 분류·정상 확률·서비스 알림 모델이 아니다.

## 실행

프로젝트 가상환경에서 `requirements-dev.txt`를 설치한 후 저장소 루트에서 실행한다.
현재 고정 버전은 CPU PyTorch 2.7.1, NumPy는 `requirements-training.txt`를 따른다.

```powershell
.venv/Scripts/python.exe -m model.analysis.panoptic_lstm --data data/external/panoptic/171204_pose1 --output runs/panoptic/new-run --epochs 25
.venv/Scripts/python.exe -m model.analysis.panoptic_lstm --synthetic-smoke --output runs/panoptic/new-synthetic-run --epochs 2
.venv/Scripts/python.exe -m unittest discover -s tests -p test_panoptic_lstm.py -v
```

실제 입력 TAR의 사전 검토 SHA-256이 다르면 실행을 거부한다.
CLI 실제 입력·출력은 Git 제외 `data/` 또는 `runs/` 아래로 제한하며 기존 완료 결과를 덮어쓰지 않는다.
합성 smoke는 명시적인 생성 시계열만 사용한다. CI의 unittest discovery가 합성 경계 테스트를 실행한다.

## 입력과 목표

얼굴70 중 코 1점·눈 6점·입 2점과 몸19 중 귀 2점·어깨 2점: 총 13점×xyz=39차원.
이것은 **Panoptic 포인트 정의**이며 MediaPipe 13점을 재현한 것이 아니다.
현재 어깨 중심을 빼고 현재 어깨 너비로 나눈다. 얼굴·어깨 회전을 평탄화하지 않는다.
몸 전체 이동의 예측 과제가 아니며 어깨 상대 형상을 예측한다.

현재 실험의 품질 설정은 선택한 모든 점의 score≥0.15, 얼굴 재투영오차≤5,
얼굴 최소 2카메라 관측이며 유효 어깨 너비가 필요하다. 서비스 품질 기준으로 확정하지 않는다.
몸·얼굴 프레임/track ID를 조인하고 얼굴 -1 및 미대응·저품질 관측은 제외한다.
프레임 누락과 시각 간격 25–45ms 밖은 연속 구간을 끊고 보간하지 않는다.
29.97fps 원자료를 3프레임마다 취하여 약 10Hz로 만든 후 30시점 입력(약 3초),
3시점 뒤 출력(약 0.3초), 창 stride 3을 사용한다. 모델은 등속 예측에 LSTM 보정량을 더한다.
한 층 LSTM hidden 48, linear 39, 18,999 파라미터, Adam lr=0.001,
batch 128, gradient clip=1.0, seed 42, CPU threads 4.

## 분할과 보고

현재 실제 참여자 대응은 미검증이므로 **원본 시퀀스 전부를 학습 전용으로 배정**한다.
검증/시험 집합을 만들지 않으며 서로 다른 track을 서로 다른 참여자라고 주장하지 않는다.
학습 자료로 scaler를 fit하며 같은 학습 창의 결과는 fitting 진단만으로 보고한다.
프레임 무작위 분할은 하지 않는다. 참여자 일반화 성능은 검증된 참여자 manifest로
분할한 별도 후속 실험이 필요하다. 모델 설정은 서비스 입력 계약에 연결하지 않는다.

`report.json`은 학습 history·비교 방법의 학습 오차·환경·데이터 hash·제외 수를 저장한다.
`test_metrics`와 `posture_accuracy`는 null이다.
`research-lstm.pt`에는 state_dict·학습 scaler·포인트/창 설정이 있다.
불신한 가중치는 로드하지 않으며 재로딩 검증에는 `weights_only=True`를 사용한다.

[실제 실행 기록](../../docs/ml/jisung/2026-10-13-desktop-panoptic-lstm-training.md).
