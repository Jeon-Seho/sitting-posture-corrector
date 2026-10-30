# Mac 실제 LSTM 학습과 `/dev` 룰 비교 연결

- 환경: Mac arm64, 2026-10-13, `feature/repo-jisung-local-forecast`, 기준 commit `64cbcd5` + 개발자 화면 작업 변경
- 요청: 학습된 모델을 룰과 함께 연결하고 실제 측정 방식을 설명
- 상태: 공개 좌표 실제 CPU 학습·브라우저 export·추론 동등성·합성 비교 완료. 실제 웹캠 정확도 미검증.
- 전 단계: [Windows 학습 기록](2026-10-13-desktop-panoptic-lstm-training.md), [기존 웹캠 실험](2026-10-13-desktop-live-forecast-experiment.md)

## 없었던 모델과 현재 연결

카메라에서 관측점을 만드는 MediaPipe Pose 모델은 이미 있었다. 이전 환경에서 학습한
**자세 변화 예측용 LSTM 가중치**가 Git 제외 자료여서 이 Mac 체크아웃에는 없었다.
실제 공개 자료로 다시 학습했고 `/dev`가 로컬 가중치를 발견하면 LSTM을 기본 선택한다.
사용자가 명시적으로 고른 단순 예측과 이미 실행 중인 실험은 자동으로 변경하지 않는다.
설정에서 실제 모델 JSON을 수동으로 불러오면 LSTM을 선택한다.

## 실제 학습 자료와 결과

[공식 Panoptic 도구](https://github.com/CMU-Perceptual-Computing-Lab/panoptic-toolbox)의 CMU 경로에서
`171204_pose1` 몸·얼굴 좌표만 다운로드했다. 새 패키지는 설치하지 않았으며 기존
PyTorch 2.7.1, NumPy 1.26.4, Python 3.12.14 환경을 사용했다.

| 파일 | bytes | SHA-256 |
| --- | ---: | --- |
| hdPose3d_stage1_coco19.tar | 41,850,880 | `290333b2f2c770b26d49175ac3f05434b7e53380f6c274db68f5919732c3e1e0` |
| hdFace3d.tar | 191,621,120 | `04cead2585d58c37c91855db5c201135a903357d9967d079561923968c1b5afd` |

기존 학습 코드의 검토 hash와 모두 일치했다. 공개 좌표·출처 기록은 무시된
`data/external/panoptic/171204_pose1/`에 보관한다. 영상은 다운로드하지 않았다.
몸 레코드 26,603개 중 미대응 1,311개·저품질 116개를 제외해 유효 관측 25,176개,
연속 창 2,465개로 학습했다. Panoptic의 얼굴9+귀2+어깨2이며 MediaPipe 13점과 정의가 다르다.

30시점×39차원 입력, hidden48 LSTM 1층+linear39, 18,999개 파라미터,
Adam lr0.001, batch128, seed42, CPU threads4, **25epoch**를 사용했다.
학습 MSE는 0.789041 → 0.353409, 학습·마지막 학습 집합 예측은 4.760초였다.
파싱·다운로드·cold import 시간은 이 학습 시간에 포함하지 않는다.

아래는 **학습에 쓴 동일 창의 fitting 진단**이다. 13점 평균 거리이며 브라우저의
얼굴·귀·어깨 그룹별 동일 가중치 거리와 집계 방식이 다르다.

| 예측 방식 | 좌표 MAE | 평균 점 거리 / 어깨폭 |
| --- | ---: | ---: |
| LSTM | 0.022213 | 0.045511 |
| 마지막 위치 유지 | 0.021552 | 0.044814 |
| 등속 예측 | 0.031386 | 0.064127 |

LSTM 오차가 단순 위치 유지보다 약 1.55% 높다. 개선된 모델이라고 주장하지 않는다.
참여자 대응이 확인되지 않아 원본 시퀀스 전체를 **학습 전용**으로 배정했고 검증/시험으로
재사용하지 않았다. `test_metrics`·`posture_accuracy`는 null, 일반화 평가는 false다.

## 모델 산출물과 검증

- 원본: `runs/panoptic/2026-10-13-mac-dev-lstm-v1/research-lstm.pt`
- 실제 학습 보고서: 같은 폴더 `report.json`
- 브라우저: `frontend/public/research-model/forecast.json`, 391,009bytes
- 모델 ID: `panoptic-lstm-v1`
- 체크포인트 SHA-256: `c8f86019340450bf7ea50b02822962c6a258d167ecfaf142e09dde17e9121687`

모두 Git 제외를 확인했다. 가중치는 현재 로컬 연구 화면에서만 연결하며 일반 서비스로 승격하지 않았다.
Python↔브라우저 최대 절대 차이는 `2.0452312643470805e-7`, 허용치 `1e-5` 통과다.
실제 가중치로 기존 합성 10개 사례도 실행했다. 짧게 움직였다 복귀한 사례는 지속 후보가 없고,
지속 변화에는 후보가 생긴다. 장시간 의도적인 동작도 후보가 될 수 있으며 사람의 자세 정답을 검증한 것은 아니다.
보고서는 `runs/panoptic/2026-10-13-mac-dev-hybrid-v1/`에 둔다.

브라우저에서 LSTM 자동 선택·설정 활성화를 확인했고 실제 가중치로 합성 등록 → 비교 → 종료까지
실행했다. 종료 시 지속 후보 1회·측정 불가 약3초, LSTM 평균 예측 오차 15.1%가 표시됐다.
이 값은 합성 입력 진단이며 정확도나 실제 사람의 결과가 아니다. 해당 탭의 콘솔 오류는 없었다.

## 측정은 이렇게 진행한다

1. 시작 한 번으로 카메라 연결·구도 안내 뒤 개인 기준 8초를 모은다.
   기준 좌표 중앙값과 그 구간의 예측 오차 q99(하한0.02)를 고정한다. LSTM 가중치를 개인별로
   다시 학습하는 과정은 아니다.
2. MediaPipe의 얼굴·어깨 13점 xyz를 현재 어깨 중심·폭으로 정규화한다. 전체 이동·일정한
   크기 변화는 제거되므로 화면 점선과 떨어지는 정도가 그대로 판정 거리가 되지는 않는다.
3. 최근 30관측(약3초)을 LSTM에 넣어 0.3초 뒤의 상대 좌표를 예측한다.
   실제 0.3초 뒤 관측이 도착했을 때 이전 예측과 비교해 오차를 구한다. 미래 자료를 미리 사용하지 않는다.
4. 현재 상대 좌표와 개인 기준 사이 거리도 별도로 구한다. 거리12% 이상에서 이탈 관찰을
   시작하고 8% 이하에서 복귀를 확인한다.
5. 왼쪽 **LSTM+룰**은 이탈3초와 낮은 예측 오차1초가 함께 유지되면 지속 후보로 표시한다.
   큰 예측 오차가 계속 나더라도 이탈5초에는 후보를 만들며, 오차만으로 일시 동작을 확정하지 않는다.
   오른쪽 **룰만**은 같은 거리와 3초 지속시간으로 비교한다. 회복 확인은 3초다.
6. 가림·품질 부족·누락은 측정 불가이며 지속시간을 끊는다. 다시 연속 관측이 모여야 예측 판단을 재개한다.

실제 웹캠은 Panoptic↔MediaPipe 점 정의·좌표축·사용 환경이 근사 대응이다. 이 LSTM은
**미래 위치 예측 모델**이며 보편적인 정상/비정상 자세 분류기나 검증된 서비스 모델이 아니다.
룰 대비 오알림·놓침·지연 개선은 참여자 분리 실제 자료로 추가 검증해야 한다.

## 재현 명령

기존 데이터 hash 검증을 그대로 사용한다. 결과 디렉터리는 새 이름을 사용해야 한다.

```sh
.venv/bin/python -m model.analysis.panoptic_lstm --data data/external/panoptic/171204_pose1 --output runs/panoptic/another-mac-run --epochs 25
.venv/bin/python -m model.analysis.export_forecast_browser --model runs/panoptic/another-mac-run/research-lstm.pt
node --experimental-transform-types frontend/scripts/forecast-parity.mjs
.venv/bin/python -m model.analysis.forecast_hybrid --model runs/panoptic/another-mac-run/research-lstm.pt --output runs/panoptic/another-mac-hybrid
```

`make check`: 저장소 검사, Python **163개**, 프론트 **51파일·391개**, 타입·빌드 통과.
Java21/Maven 부재로 백엔드 단계에서 종료하여 전체 성공은 아니다.
모델이 늦게 발견돼도 종료된 비교군 결과를 LSTM으로 다시 이름 붙이지 않는 마지막 회귀 포함
`make check-frontend`: **51파일·392개**, 타입·빌드 통과.
실제 카메라 정확도·FPS, 독립 참여자 성능, 운영 배포는 미검증이다.
