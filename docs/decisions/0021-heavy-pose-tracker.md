# ADR 0021: 공통 추적기를 Heavy로 전환

- 상태: accepted
- 날짜: 2026-10-12
- 근거: 사용자가 Lite·Full·Heavy의 연산량 차이를 확인하며 Heavy로 변경하도록 요청했다.

## 결정

실시간 측정과 학습용 수집이 공유하는 추적기를 공식 Pose Landmarker Heavy float16 v1로 전환한다.
tasks-vision 1.0.1과 GPU 우선·CPU fallback, 추론 간격 조절은 유지한다.
`frontend/model-asset.json`에 공식 URL·모델 ID·SHA-256을 고정하고 자산 준비 시 해시를 검증한다.
공식 가중치는 Git 제외 자산 경로에만 내려받는다. CSV의 `pose_model`은 Heavy ID로 기록한다.
[ADR 0020](0020-shoulder-up-landmarks.md)에 따라 공통 관측에는 어깨 포함 머리 13개만 남긴다.

## 근거와 한계

[공식 기존 Pose 벤치마크](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)의 추론 지연은
Pixel 3 TFLite GPU에서 Lite/Full/Heavy 20/25/53ms, MacBook Pro 2017에서 25/27/38ms다.
연산량 자체나 현재 웹 앱의 측정값이 아니며 Heavy가 이 앱에서 같은 비율로 느려지거나 더 정확하다는 보장은 없다.
어깨 아래 출력 제거는 모델의 전신 추론 비용을 줄이지 않는다. 실제 FPS·추론 지연·어깨 위 촬영 품질은 별도 검증 대상이다.
기존 Lite 자료와 Heavy 자료는 `pose_model`로 구분하고 좌표 분포 확인 전에 같은 분포로 취급하지 않는다.

이전 선택: [ADR 0007](0007-lite-pose-tracker.md). 모델 종류: [공식 Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).
