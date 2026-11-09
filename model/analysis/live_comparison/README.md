# 웹캠 자세 비교 실험

개인 기준 대비 **기존 서버의 규칙 점수**, 기존 25배 증강 분류기, 합성 세로 이동 보정 후 재학습한 **2단계 분류기**를 같은 웹캠 관측으로 비교하는 로컬 연구 도구다. 서비스의 알림·API는 바꾸지 않는다. 이 화면의 기준/이탈 표시는 창 점수와 실험 임계값을 비교한 결과이며, 서버의 3초 사건·알림 재현이 아니다.

## 준비와 실행

- Python 가상환경에 루트 `requirements-dev.txt`와 `model/analysis/requirements-trees.txt`를 준비한다.
- `frontend/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs`와 `frontend/public/mediapipe/`의 Heavy·WASM 자산이 필요하다. 없으면 저장소의 프론트 준비 절차(`python tools/dev.py setup-frontend`)를 실행한다.
- 기존 `model.analysis.replay_pilot.two_stage`가 만든 **신뢰할 수 있는** 비공개 결과 폴더가 필요하다. 이 폴더의 `report.json`과 세 `all-data-*.joblib`은 서로 일치해야 한다. `joblib`은 임의 코드를 실행할 수 있으므로 출처를 확인하지 않은 파일을 사용하지 않는다.

저장소 루트에서 Windows PowerShell 예시:

```powershell
.\.venv\Scripts\python.exe -m model.analysis.live_comparison.server `
  --artifacts-dir "<저장소 밖의 two-stage 결과 폴더>"
```

같은 PC의 Chrome 또는 Edge에서 `http://127.0.0.1:8765/`를 연다. 카메라를 시작하고 얼굴과 양 어깨를 화면에 둔 뒤 **기준 자세 등록**을 누른다. 3초 이상·20개 이상 유효 표본을 모으면 등록이 완료되고, 이후 충분한 관측이 모이면 점수가 표시된다. 종료 버튼은 카메라를 끄고 해당 비교 세션을 지운다. 서버 종료는 실행한 터미널에서 Ctrl+C다. 다른 포트가 필요하면 `--port 8766`을 전달한다.

학습 파일을 다시 만들려면 먼저 [25배 증강 실험](../replay_pilot/AUGMENT_50K.md)과 [2단계 실험](../replay_pilot/TWO_STAGE.md)의 명령을 순서대로 실행한다. 결과·원본·카탈로그·참여자별 보고서는 Git 밖의 접근 제한 위치에 둔다. 실험 기록의 전체 자료 후보는 별도의 독립 평가를 받지 않았다.

### macOS에서 실행

Git에는 가중치가 없으므로 Windows의 `two-stage` 결과 폴더에서 다음 네 파일을 같은 폴더에 모아 맥북의 저장소 **밖**으로 별도 전송한다. 모델은 접근 제한이 가능한 위치에 보관한다.

```text
report.json
all-data-posture.joblib
all-data-synthetic-vertical-corrector.joblib
all-data-posture-after-correction.joblib
```

Python 3.12와 Node.js 24 이상이 준비된 맥북에서 저장소 루트의 터미널을 열고 다음을 실행한다. 마지막 경로는 네 파일을 옮긴 폴더로 바꾼다. 고정 의존성은 Windows에서 이번에 학습한 scikit-learn 1.6.1과 일치한다.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -r model/analysis/requirements-training.txt
npm --prefix frontend ci
npm --prefix frontend run assets
python -m model.analysis.live_comparison.server --artifacts-dir "$HOME/posture-private/two-stage"
```

Chrome 또는 Edge에서 `http://127.0.0.1:8765/`를 열고 사이트의 카메라 권한을 허용한다. 첫 실행에서 Pose 모델과 WASM 자산을 내려받을 수 있다.

## 비교 조건

- 640×480 카메라 프레임과 기존 앱의 MediaPipe Pose Heavy 모델을 사용한다. 이 해상도를 제공하지 않으면 비교를 시작하지 않는다. 등록은 v8 파일럿의 9점 평균과 품질 조건을 재사용한다.
- 기준 등록 뒤 최근 1초의 6개 개인 기준 대비 특징의 중앙값으로 두 모델과 규칙을 함께 평가한다. 관측 간격이 500ms를 넘거나 프레임이 유효하지 않으면 창을 끊는다. 최소 5개 표본과 800ms가 확보되어야 하고 500ms 간격으로 갱신한다.
- 규칙 점수는 실제 추론 서비스의 `score_feature_deltas`를 호출하고 실험 비교 기준 0.70을 사용한다. 모델은 재학습 보고서의 `all_data_candidate.threshold`를 사용한다. 서로 다른 두 점수는 보정된 확률이 아니며 점수 크기만으로 성능을 비교할 수 없다.
- 측정 불가·고개 회전·관측 공백은 정상으로 처리하지 않는다. 구도가 바뀌면 사용자가 기준을 다시 등록해야 한다. 모델의 보정값은 합성 2D 세로 이동을 기준으로 학습한 값으로, 실제 의자 이동량이나 의학적 판단이 아니다.
- 영상은 브라우저 안에서만 Pose로 처리하고, 필요한 9개 2D 점은 같은 기기의 `127.0.0.1` 서버에 전송해 휘발성 세션 메모리에만 보관한다. 원본 영상·좌표·점수는 디스크에 저장하거나 외부로 전송하지 않는다. 서버에는 인증이 없으므로 반드시 loopback에만 바인딩한다.

이 화면은 모델 연결 확인과 동작 관찰용이다. 기존 자료는 이름별 임시 그룹 및 수행 검증 전 안내 라벨을 사용했고 일상 작업·실제 알림 지연과 오알림은 독립 평가하지 않았다.
