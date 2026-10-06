# 상대좌표 LSTM 실험 앱과 합성 학습

- 분야: 머신러닝
- 작업: GP-0124

## 요청과 완료 기준

독립 브랜치, 합성 학습, 카메라 추론과 위치 이동 검증. 실제 사용자 성능 미검증.

## 범위와 결정

- 브랜치: `experiment/relative-pose-lstm`, 독립 체크아웃 `C:/GoodPose/relative-pose-lab`.
- 기존 특징도 어깨 중심·너비로 정규화되어 있다. 절대좌표 제거를 새 개선 실적으로 주장하지 않는다.
  이 실험은 기존 `features`를 재사용하며 순수 평행 이동/균일 크기 변화에 불변인지 검증한다.
- 코·양쪽 어깨에서 머리 높이, 좌우 치우침, 어깨 기울기의 개인 기준 변화량 3개와
  시간 보정한 변화량 차이 3개를 사용한다. 턱·정수리·팔꿈치 추적과 스트레칭 확정은 포함하지 않는다.
- 목표10Hz, 30프레임, 입력6/은닉16의 2층 LSTM(dropout0.15) + 3클래스 선형 출력.
  정상/움직임/이탈 후보를 구분한다. 실제 관측 간격에 따라 창의 실제 길이가 달라질 수 있다.
- 최근 관찰 구간이 채워진 뒤 모델 출력 0.7 이상 이탈 후보가 추가 1/1.5/3초 유지되면 감점한다.
  기본 추가 확인은 1.5초이며 이는 연구 확정값이나 기존 서비스 시간 정책의 변경이 아니다.
- 이탈 확정 중 초당2점 감점, 정상 중 초당1점 회복, 움직임·확인 중·측정 불가에는 점수를 유지한다.
  이 점수는 실험용 UX 값이다. 모델 softmax 값은 실제 정확도로 표시하지 않는다.
- 품질 미달, 시각 역전, 350ms 넘는 관측 간격은 시간 창을 초기화한다.
  프레임 도착이 1초 멈추면 측정 불가로 표시한다. 기준 재등록/카메라 재연결도 창을 초기화한다.
- Electron 앱은 별도 이름/사용자 저장 경로/EXE를 사용한다. 기존 계정·기록·서버 판정에는 연결하지 않는다.
- 사용자 요청의 팝업 디자인/Windows 알림은 이번 실험 앱 범위에서 제외한다.

## 합성 학습과 재현

`model/analysis/train_relative_lab.py`가 seed122로 합성 시계열을 생성하고 실제 PyTorch LSTM을 학습한다.
합성 identity 0~19 학습6,000개, 20~24 검증1,500개, 25~29 시험1,500개로 생성 전에 분리한다.
이 identity는 실제 사람을 의미하지 않는다. 표준화는 학습 자료만, 모델 선택은 검증 손실만 사용한다.
코/양쪽 어깨의 제작 스켈레톤에 크기·위치·머리 높이·잡음·변화 축·속도·복귀 펄스·이탈 시작 시점을 다양하게 만든다.
정상 작은 변동/움직이는 신호/지속적 상대 변화라는 생성 패턴이므로 현실 행동 분리도를 증명하지 않는다.
합성 seed 집단 분리를 실제 참여자 분할 평가라고 부르지 않는다.

최대1,000epoch, AdamW(lr0.003, weight_decay0.001), gradient clipping1.0,
검증 손실 기반 학습률 감소/최적 모델 저장, 최소100epoch 이후 patience40 조기 종료를 사용한다.
클래스 가중치와 표준화는 학습 자료에서만 계산한다. 시험 자료는 최적 모델 선택 뒤 한 번 평가한다.

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m pip install -r model/analysis/requirements-relative-lab.txt --index-url https://download.pytorch.org/whl/cpu
npm ci --prefix frontend
node frontend/node_modules/electron/install.js
.venv/Scripts/python.exe model/analysis/train_relative_lab.py --epochs 1000 --batch-size 256
npm --prefix frontend run lab:pack
```

생성 가중치는 Git 제외 `frontend/public/lab-model.json`, 학습 보고서는 `artifacts/relative-lab/report.json`에 있다.
EXE에 현재 가중치를 포함하되 가중치·EXE를 커밋하지 않는다. 학습 후 EXE를 다시 빌드해야 적용된다.
학습 실행기 `상대좌표_모델학습.bat`은 학습 후 패키징하며, `상대좌표_실험앱.bat`은 EXE가 있으면 열고
없으면 개발 앱을 실행한다. 개발 서버는 별도 포트5185다.

첫 연결 확인 이력: 1층 LSTM/학습720개/100epoch/시험180개. 이후 사용자 요청에 따라 위 규모로 확장했다.
현재 실행은 최대1,000epoch 설정에서 127epoch에 조기 종료, 검증 기준87epoch 모델 선택.
검증 cross entropy0.000129776, 시험 cross entropy0.000129141,
시험 confusion matrix 대각500/500/500, 오류율0%, Macro-F1 1.0.
이는 합성 생성 패턴의 통합 검증 결과이며 실제 사용자 성능이 아니다.
학습/모델 hash와 실행 버전은 생성 보고서에 기록한다.
`artifacts/relative-lab/history.json`은 에포크별 학습/검증 손실·검증 정확도·학습률,
`split-tensors.pt`는 분리한 학습 입력/라벨이다. 선택적 matplotlib 설치 후
`model/analysis/plot_relative_lab.py`로 학습 곡선을 PNG/SVG로 출력한다.

## 공개 데이터 검토

사용자는 공개 자료 또는 제작한 스켈레톤 자료 사용을 허용했다.
[CMU 공식 자료](https://mocap.cs.cmu.edu/)는 자유로운 사용을 안내하며 앉기·스트레칭 동작이 있다.
[NTU RGB+D 공식 자료](https://rose1.ntu.edu.sg/dataset/actionRecognition/)는 25관절의 스켈레톤과 행동 라벨을 제공한다.
현재 모델의 MediaPipe 코/어깨 특징 및 정상/지속 이탈 라벨과 직접 일치하지 않으므로 자동으로 섞지 않았다.
이번 실행에는 공개 자료0개, 제작 시퀀스9,000개만 사용했다.
공개 자료 도입 시 좌표계/관절 대응/촬영 시점/라이선스와 별도 자세 라벨 검토를 먼저 수행한다.

## 실제 자료로 이어가는 경계

실험 화면의 선택적 저장은 사용자가 직접 검토한 최근 관찰 구간의 특징/라벨/시각을 메모리에 모아 내려받는다.
영상 저장/업로드와 자동 자기학습은 없다. 현재 학습기는 이 파일을 자동으로 사용하지 않는다.
앱은 익명 참여자 코드·capture ID·검토 여부를 파일에 포함한다. 기준 재등록 전 내려받아야 한다.
`--manifest`로 실자료를 입력할 수 있으며 참여자 중복/파일 hash 변경/미검토 라벨/
시각 누락·역전/겹치는 관측 창/클래스 누락은 학습 전에 거부한다.
실제 수집 전 동의/삭제/보존과 라벨 검토를 확정해야 한다. 수집 동의 확인을 manifest에 명시한다.
겹치는 창과 같은 참여자를 학습/시험 양쪽에 넣지 않는다. 기존 모델 판정을 정답으로 재사용하지 않는다.
실카메라 오알림, 고개 돌림, 주저앉음, 거리·원근 변화, 스트레칭 보상은 미검증이다.

실자료 manifest의 구조 예시(실제 파일·hash·코드는 Git 밖에 둔다):

```json
{
  "version": 1,
  "consentConfirmed": true,
  "featureVersion": "relative-delta-velocity-v1",
  "participantsBySplit": {"train": ["P01"], "validation": ["P02"], "test": ["P03"]},
  "captures": [{"path": "P01-reviewed.json", "participantCode": "P01", "sha256": "실제 파일의 SHA256"}]
}
```

모든 분할에 세 클래스의 검토 자료가 필요하다. 예시 captures는 구조 설명이며 완전한 학습 자료가 아니다.
`train_relative_lab.py --manifest <Git밖의_manifest.json> --epochs 1000`로 학습하고 EXE를 재빌드한다.

## 검증 계획

- 프론트 테스트: 상대좌표 평행 이동/스케일 불변, 실제 머리 이동 보존, 품질/누락 창 중단,
  Python 수출 모델과 JS LSTM logits 1e-5 이내 일치.
- Python 기본 테스트: 합성 시퀀스 형태/유한값/seed 재현성. 추가 CI job에서 실제 학습 후 JS parity와 실험 빌드.
- `npm run check`에 실험 빌드를 포함해 기본 프론트 게이트와 CI에 연결한다.
- EXE 합성 버튼/모델·카메라 런타임 파일 로딩은 실제 데스크톱 smoke로 확인하고 실카메라 자세 검증과 구분한다.

## 진행 기록

- 작업 카드의 이력과 함께 최신 결정·수정·검증 결과를 기록한다.

## 검증과 남은 사항

- Python 전체168개 중164개 통과, Windows에서 기존 Linux/POSIX 배포 잠금 테스트3개가 실패, 1개 skip.
  `python tools/dev.py check`는 이 단계에서 중단되었고 전체 통과가 아니다.
- 프론트281개 통과, TypeScript와 실험 프로덕션 빌드 통과.
- Windows portable EXE 빌드 및 `node frontend/scripts/smoke-relative-lab.mjs` 통과:
  모델JSON/MediaPipe wasm/task 모두200, 세 합성 입력의 세 상태 일치,
  secure context 및 가상 카메라640px 연결 확인, UI 오류0.
- 학습 곡선과 Chrome 실제 렌더링 UI 이미지를 `artifacts/relative-lab/`에 남겼다.
  숨겨진 Electron 창의 CDP screenshot/Browser.close가 응답하지 않아 테스트에서 제외하고,
  별도 headless Chrome으로 UI를 시각 확인했다. EXE 기능 검증과 실카메라 검증을 구분한다.
- 관리판 MD 연결 검사 및 저장소 검사 통과. 현재 card는 실카메라 검수 대기 review.
