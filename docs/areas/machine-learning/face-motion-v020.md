# 얼굴 중심 0.2.0 추적과 다중 과제 시간 모델

- 분야: 머신러닝
- 작업: GP-0125

## 요청과 완료 기준

0.1.0 실전 실패를 반영: 얼굴 회전, 화면 이동, 어깨 누락, 손 들기 관측과 학습/검증/시험 분리. 실제 사람 정확도 미확정.

## 진행 기록

- 분리 브랜치 `experiment/face-pose-v0.2.0`, 기반 `test_0.1.0`의 `f3d3ba6`.
- [문헌·서지·BibTeX](../../research/face-motion-literature.md)에 논문 8편과 공식 자료,
  적용/미적용 범위 및 공개 데이터의 미확보 상태를 기록했다.

## 관측과 판정

- MediaPipe Face Landmarker와 기존 Pose Landmarker를 이용한다. 얼굴 신원 인증은 하지 않는다.
- 얼굴만 보여도 회전과 얼굴 중심을 추적한다. 얼굴 크기 변화만으로 거북목을 확정하지 않는다.
- rotation matrix의 COLUMN_MAJOR 배열을 해석하고 기준에 대한 `R_base^T R_current`의
  첫 두 열을 사용한다. yaw/pitch/roll은 판정 보류용 보조 각도이며 의료 측정값이 아니다.
- 위치 이동의 절대 화면 좌표는 자세 특징에서 제외하고 별도 중심 속도로 입력한다.
  머리/어깨 관계는 어깨 폭으로 정규화한다. 얼굴 투영과 시점 오차까지 자동 해결한 것은 아니다.
- 어깨/손목은 화면 경계, visibility 0.75, 얼굴과 같은 몸의 코 위치를 확인한다.
  Web API는 관절별 presence를 노출하지 않아 task-wide minPosePresenceConfidence 0.65를
  사용한다. presence가 명시된 외부 입력에는 해당 값도 0.75 기준으로 검사한다.
  미검출은 mask와 0 특징을 넣는다. 누락/역전/350ms 초과 공백은 창과 이탈 시간을 초기화한다.
- 40프레임(명목 10Hz) 특징 26개를 세 층 시간 convolution(dilation 1/2/4, kernel 3,
  채널 24)으로 처리하고 마지막 10개 출력을 평균한다. 자세 4개와 행동 5개를 별도 분류한다.
  posture: neutral/forward/slouch/tilt, activity: still/head_turn/translation/arm_raise/neck_motion.
- 시계열 classifier와 점수 정책은 분리한다. 지속 변화 기본 3초(2/3/5초 선택),
  확률 출력 0.8 이상과 관측 근거가 함께 있어야 감점한다. 출력값은 의료 확률이 아니다.
- yaw 변화 0.32rad 초과, 몸 자세 근거 없는 얼굴 단독 구간, 불확실한 출력은 감점을 보류한다.
  이는 실험용 임계값이며 실제 사람에서 민감도와 오알림률을 최적화한 값이 아니다.
- 양손이 실제로 관측되고 머리보다 올라간 상태가 2초 유지되며 움직임/정상 자세 출력이
  각 0.75 이상일 때 보너스 2점, 재보너스 간격 60초. 어깨 상승만으로 보너스를 주지 않는다.
  상태명은 스트레칭 **후보**이며, 동작의 의도나 건강 효과를 판별한 것이 아니다.

## 학습과 재현

```powershell
python -m pip install -r model/analysis/requirements-relative-lab.txt --index-url https://download.pytorch.org/whl/cpu
python -m pip install numpy==2.5.3
python model/analysis/train_face_motion.py --epochs 400 --min-epochs 100 --takes 8
npm --prefix frontend ci
npm --prefix frontend run test -- src/features/face-lab/model.test.ts --maxWorkers=2
npm --prefix frontend run face:pack
```

- 학습 6,400 / 검증 1,600 / 시험 1,600 제작 시퀀스. seed 202, 제작 그룹 40/10/10을
  나눈 후 생성한다. 이 그룹은 60명의 실제 사람이 아니라 서로 다른 생성 seed다.
- 회전/이동/양손 들기/목 움직임을 정상 및 각 이탈과 조합한다. 한 손 제스처, 잡음,
  어깨 전체/부분 누락과 손목 누락을 섞었다. 작은 회전 시점 편차도 포함했다.
  얼굴 단독 neutral은 관측한 머리의 기준 범위로 학습하며 몸이 정상이라는 확정은 아니다.
  관측 불가한 forward/slouch와 손 들기 라벨은
  cross entropy의 ignore_index로 학습/평가에서 제외한다.
- 스케일러는 학습 자료에만 fitting. AdamW lr 0.002, weight decay 0.002, dropout 0.15,
  gradient clip 1, validation-loss scheduler 및 patience 35로 early stop.
- 최종 실행은 실제 140 epoch, best 105. 초기 검증 loss 2.998673 → best 0.029322.
  시험 loss 0.049325. 관측 가능 자세 1,199개에서 오류율 1.0008%, Macro-F1 0.992500.
  관측 가능 행동 1,540개에서 오류율 0.7792%, Macro-F1 0.992521.
  이 결과는 제작 자료에서만 측정했고 0.1.0 대비 실제 오차 감소 결과가 아니다.
- 로컬 비추적 파일 `artifacts/face-lab/report.json`, `history.json`, `split-tensors.pt`와
  `frontend/public/face-model.json`에 집계·학습 기록·모델을 저장한다.
  model SHA-256: `d2670280195303af2ec3b3c664baa56d41198b988249a98740639597cf83cb5c`.
- 최초 실행은 100 epoch/best 50이었다. 얼굴 단독 neutral의 감독 범위와 작은 시점 편차를
  수정하여 최종 실행을 다시 수행했다. 두 실행은 라벨·생성 분포가 달라 직접 오차율 비교를 하지 않는다.
  `plot_face_motion.py`로 loss 곡선·혼동행렬 PNG/SVG를 생성할 수 있다(별도 matplotlib 필요).
- MediaPipe face task: 공식 float16/1, SHA-256
  `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
  자체 모델과 사전학습 추적기 가중치는 Git에 커밋하지 않는다.

## 자연스러운 사용 자료와 여러 사람 학습

별도 동작 수행을 필수로 요구하지 않는다. 사용 중 오판이 보일 때만 라벨을 확인하고
최근 4초의 파생 특징을 남길 수 있다. 익명 코드와 로컬 JSON 다운로드를 사용하며,
영상 저장·자동 전송·자동 self-training은 하지 않는다. 모델의 오판을 정답으로 다시
학습하는 문제를 피하기 위해 검토된 라벨만 사용한다.

```powershell
python model/analysis/prepare_face_manifest.py --consent --train C:/private/train.json --validation C:/private/validation.json --test C:/private/test.json --output artifacts/face-lab/private-manifest.json
python model/analysis/train_face_motion.py --manifest artifacts/face-lab/private-manifest.json
```

위 경로는 사용법 예시이며 실제 자료가 존재한다는 뜻이 아니다. 최소한 세 분할의
참여자가 달라야 하고 각 분할에서 평가 가능한 자세 4종/행동 5종이 필요하다.
manifest 검증은 동의, 참여자/촬영 소유권, SHA, 검토 라벨, 40×26 형식, 시각과
중복 창을 확인한다. 같은 참여자의 자료를 여러 분할로 보내는 것을 금지한다.
처음에는 소규모 참여자로 준비를 검증하고, 이후 다른 사람에 대한 오알림/시간,
누락률, 클래스 recall, 감지 지연, FPS/p95 추론 시간을 보고한다.

## 검증과 남은 사항

- 두 head의 PyTorch↔JavaScript 출력 9개 probe는 1e-5 이내 일치.
- 회전·이동·어깨 누락·지속 시간·보너스·시간 공백·Web API 관측 관련 14개 모델 테스트 통과.
  전체 프론트 297개 통과/1개 skip(이 체크아웃에 없는 이전 LSTM 가중치 parity), 38개 파일.
  TypeScript, 일반 서비스/이전 실험/얼굴 실험 빌드 통과.
- 전체 Python 173개 중 169개 통과, 기존 Windows 배포 파일 잠금/POSIX 오류 3개,
  skip 1개. `python tools/dev.py check`는 이 단계에서 중단되어 전체 통과가 아니다.
- 브라우저 공개 사진 fixture의 얼굴 추적·기준 등록 및 화면 이동 전후 점수100 유지 확인.
  최초 실행에는 목 움직임 후보가 남았고 최종 실행은 이동 후 머무름/기준 범위로 출력했다.
  정지 사진의 화면 이동이므로 실제 좌우 회전·스트레칭 정확도를 입증하지는 않는다.
  추적 55–77ms/프레임은 해당 실행의 표시값이며 p95 성능 측정값이 아니다.
- module worker에서 MediaPipe의 `ModuleFactory not set` 오류를 발견했다. 별도 classic
  worker 번들로 수정해 UI를 막지 않고 정상 초기화했다.
- Web 관절별 presence 미제공을 발견해 task-wide presence와 관절 visibility로 수정했다.
  Windows 빌드 파일 잠금을 Vite가 감시하다 종료되는 문제는 release/dist 실험 경로를
  감시에서 제외하여 해결했다.
- 최종 portable EXE와 `smoke-face-lab.mjs` 통과: 모델/얼굴 task/pose task/wasm 모두200,
  secure context, 다섯 제작 동작 재생, 가상 카메라640px와 worker ready, UI 오류0.
  `smoke-face-browser.mjs`는 공개 fixture 기반이며 실제 사용자의 카메라 테스트가 아니다.
- 실제 사용자/실제 스트레칭 학습 자료는 아직 없으며 사용자 카메라 검수는 남았다.
  face-only에 대한 자세 확정과 실제 개선율을 보고하지 않는다.
