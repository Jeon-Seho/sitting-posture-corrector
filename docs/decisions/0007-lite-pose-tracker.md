# ADR 0007: 실시간 추적기를 Lite로 전환

- 상태: 채택 (파일럿)
- 날짜: 2026-09-22

## 근거

Heavy 추적기는 M1 Air에서 약 10 FPS로 체감될 수 있었다. 사용자가 수집·체험 화면의 부드러움을 우선 확인하기 위해 Lite 전환을 요청했다.

## 결정

- 공식 Pose Landmarker Lite float16 v1 모델을 로컬에서 사용한다. tasks-vision 1.0.1은 유지한다.
- 모델 URL과 SHA-256은 `frontend/model-asset.json`에 고정하고 가중치는 Git에 추가하지 않는다.
- 카메라 최대 30 FPS, GPU 최대 30회/초, CPU 최대 20회/초의 기존 스케줄링은 유지한다.
- CSV의 `pose_model`에 Lite 모델 ID를 기록한다. 기존 Heavy 수집 자료와 새 Lite 자료는 모델별로 구분한다.
- 라벨 수집 규격과 좌표 필드, 개인 기준 규칙은 변경하지 않는다.

## 결과와 한계

Lite는 계산량을 줄이기 위한 선택이지만 이 프로젝트와 M1 Air에서 실제 FPS가 개선됐다는 결과는 아직 없다. 같은 장면에서 Heavy와 Lite의 속도·검출 안정성·좌표 분포를 비교하기 전에는 정확도 차이도 주장하지 않는다.

규격: [안내형 수집 v2](../research/guided-collection-v2.md).
이전 결정: [Heavy와 안내형 좌표 수집](0006-heavy-guided-collection.md).
