# MultiPosture 외부 자료 실험

이 도구는 Pose Heavy 얼굴·어깨 13포인트를 사용하는 오프라인 연구용 CPU 모델이다.
원본의 몸통 5개 라벨은 개인 기준 이탈 정답과 다르다. 앱의 정상/이탈·알림 계약에는 연결하지 않는다.
실제 학습 집계는 [desktop 기록](../../docs/ml/jisung/2026-10-13-desktop-multiposture-training.md)을 참고한다.

## 자료와 실행

[배포처](https://zenodo.org/records/14230872): Carneros Prado 외, MultiPosture, DOI 10.5281/zenodo.14230872,
CC BY 4.0. 배포처와 저자를 표시하고 [라이선스 조건](https://creativecommons.org/licenses/by/4.0/)을 따른다.
라이선스·배포 MD5를 확인한 뒤 저장하며, 원본과 가중치는 ignored `data/`·`runs/`에 둔다.

프로젝트 가상환경에서 실행한다. Windows는 아래 `python`을 `.venv/Scripts/python.exe`로 바꾼다.

```sh
python -m pip install -r model/analysis/requirements-training.txt
python -m model.analysis.multiposture download
python -m model.analysis.multiposture train --input data/external/multiposture-v1/data.csv --output runs/multiposture/my-new-run
```

기존 run 폴더는 덮어쓰지 않는다. source 메타데이터와 원본 SHA-256, seed, 분할, 라이브러리 버전,
소스 해시, 검증/시험 confusion matrix가 기록된다. `.joblib`은 직접 생성한 신뢰하는 파일만 읽는다.
내보낸 모델은 시험 참여자를 제외한 학습+검증 참여자만으로 학습한다.

## 특징·선택·평가

- 입력: 원래 MediaPipe 순서 0~12의 xyz. 손목·골반·하체·참여자 ID는 모델 특징에 넣지 않는다.
- 어깨 중앙을 빼고 3D 어깨 너비로 나눈 11개 얼굴점의 xyz(33차원) + 어깨 방향(3차원).
  어깨 수평 회전 보정은 하지 않는다. 회전으로 생긴 변화를 지우지 않는다.
- 비교군: 코·어깨 3특징 또는 전체 36특징 × 로지스틱 회귀/랜덤 포레스트. 같은 분할·고정 설정.
- 참여자 seed 42 분할: 실제 13명 기준 학습 8명·검증 2명·시험 3명.
  검증 Macro-F1으로 선택을 동결하고 시험을 평가한다. 시험 결과로 후보/임계값을 바꾸지 않는다.
- 시간 정보가 없으므로 행 순서로 시퀀스·속도·지속시간을 만들지 않는다.
- 소수 시험 참여자·같은 참여자의 상관된 프레임이므로 프레임 수를 독립 표본 수로 해석하지 않는다.
- 실행 환경 CPU 단일 행 분류 지연만 측정한다. 카메라·MediaPipe·전송·알림 지연은 포함하지 않는다.

## 개인 기준 비교 연구 진입점

분류기와 별도로 학습+검증 참여자의 TUP 내 변동을 이용한 축별 척도·축소 공분산을 저장한다.
이는 외부 upright 자료의 분산이며 사용자의 자연스러운 정상 변동을 검증한 것이 아니다.
얼굴·어깨의 어깨 중심 상대 형상 변화 거리를 계산할 수 있지만 정상 확률·알림 임계값은 만들지 않는다.
눈 6개가 거리를 지배하지 않도록 코/눈/귀/입/어깨 그룹을 균등 가중한다.

연구 입력 파일의 형식:

```text
schema_version: pose13-research-input-v1
coordinate_space: mediapipe_world
baseline_frames: 품질이 확인된 기준 등록 프레임 15개 이상 (선택)
frame: 현재 프레임
각 프레임: quality=measurable, worldLandmarks=[원래 0~12 순서의 {x,y,z} 13개]
```

```sh
python -m model.analysis.multiposture predict --model runs/multiposture/my-new-run/research-model.joblib --input data/my-research-input.json --output runs/multiposture/my-research-prediction.json
```

좌표 누락·비유한 값·어깨 붕괴·낮은 품질은 `unmeasurable`이다. image 좌표를 world 대신 사용하지 않는다.
기준 미등록이면 개인 변화량은 null이다. 출력의 `service_label`과 `alert`는 항상 null이다.
품질 표시는 소비자가 실제 관찰 품질을 검사해 전달해야 하며 임의로 measurable로 지정하면 안 된다.

현재 앱의 기준 JSON에는 `worldLandmarks`가 있지만 위 명시적 품질 표시가 없으므로 자동 변환하지 않는다.
기준 JSON을 실제 연구 입력으로 바꾸는 품질·좌표계 어댑터와 카메라 검증은 후속 작업이다.
외부 골반 정규화 xyz와 실제 MediaPipe world의 동일성도 아직 검증하지 않았다.
따라서 이 진입점은 `domain_validated=false`인 실험용이다.

현재−기준 좌표(A), 어깨 중심 상대 변화(B), 어깨 중심 이동과 너비 비율(C의 추가 성분)을
**world 좌표에서** 따로 반환한다. 영상 절대 좌표 A를 학습·검증한 결과가 아니며,
현재 너비로 정규화한 형상 거리에는 전체 어깨 이동이나 너비 변화가 직접 누적되지 않는다.
반환한 추가 성분을 알림 정책에 합치는 방법은 자체 데이터로 검증해야 한다.

## 검증

합성 자료만 사용하는 테스트는 `python tools/dev.py test` 및 `make check`/CI에 포함된다.
`make setup`은 requirements-dev에서 고정 학습 의존성을 설치한다. 다운로드는 CI에서 실행하지 않는다.
합성 테스트는 참여자 누수, 시험 변형의 모델 불변성, 낮은 품질, 좌표계 혼용, 불완전 기준,
형상의 이동/크기 불변성·회전 보존, 실제 자료/가중치 출력 경로를 확인한다.
