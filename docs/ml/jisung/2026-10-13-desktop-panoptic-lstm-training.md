# Panoptic 좌표 LSTM 실제 학습 결과

- 환경: desktop, 2026-10-13, `feature/repo-baseline-mediapipe`, 기준 commit `8ab1c18`
- 요청: 개인 기준은 제외하고 공개 좌표로 LSTM 학습
- 상태: 실제 CPU 학습·가중치 저장 완료. 서비스 연결·독립 시험 성능 미검증.
- 입력과 출처: [다운로드 기록](2026-10-13-desktop-panoptic-download.md)
- 재현 명령·상세 설정: [연구 도구 안내](../../../model/analysis/PANOPTIC_LSTM.md)

## 실제 학습

`171204_pose1`의 몸19/얼굴70을 프레임·track으로 조인해 얼굴9+귀2+어깨2의 13점을 사용했다.
Panoptic 정의이며 MediaPipe 원래 13점과 동일하지 않다.
어깨 중심·너비로 정규화한 39차원 시계열을 약 10Hz, 30시점 입력으로 만들고
0.3초 뒤의 동일 좌표를 예측한다. 개인 기준 등록·정상/비정상 라벨은 사용하지 않았다.

원본 몸 레코드 26,603개 중 몸·얼굴 조인 실패 1,311개, 선택 점 품질 부족 116개를 제외했다.
25,176개 유효 관측에서 품질/시간 단절을 넘지 않는 학습 창 2,465개를 만들었다.
실제 참여자 대응이 미검증이므로 시퀀스 전체를 학습에만 사용했다.
검증/시험 집합은 없으며 track 단위 분할을 참여자 분할로 대신하지 않았다.

LSTM 1층 hidden48 + linear39, 18,999 파라미터, 25epochs,
Adam lr0.001, seed42, batch128, CPU threads4.
학습 MSE(스케일된 좌표)는 epoch1 0.789041에서 epoch25 0.353409로 감소했다.
학습 루프·최종 학습 집합 예측 시간은 2.458초이며 파싱·설치·cold import는 제외한다.
Python3.12.7, PyTorch2.7.1+cpu, Windows11 환경이다. 사용자 서버/GPU 실측이 아니다.

## 학습 자료에서의 진단 결과

아래 값은 **학습에 사용한 동일 창**의 오차다. 새 참여자 정확도가 아니다.
점 거리 오차는 13개 점의 예측−정답 3D Euclidean distance를 평균한 어깨 너비 단위다.

| 비교 방법 | 좌표 MAE | 평균 점 거리 |
| --- | --- | --- |
| LSTM 보정 예측 | 0.022213 | 0.045511 |
| 마지막 좌표 유지 | 0.021552 | 0.044814 |
| 마지막 두 시점의 등속 예측 | 0.031386 | 0.064127 |

LSTM은 등속 예측보다 낮은 오차지만 **마지막 좌표 유지보다 약 1.55% 높은 점 거리 오차**다.
학습 오차 감소만으로 시계열 모델의 효용이 확인되었다고 해석하지 않는다.
자세 분류 정답이 없어 accuracy/F1을 산출하지 않았고 독립 평가 점수도 없다.

## 저장 위치

Git 제외 `runs/panoptic/2026-10-13-desktop-lstm-v1/`:

- `research-lstm.pt`: 실제 가중치·학습 scaler·설정
- `report.json`: 데이터 hash·학습 history·집계 결과·환경

실제 자료·가중치·track manifest를 Git에 추가하지 않는다.
결과는 서비스에 자동 연결하지 않으며 다음 실험에는 검증된 참여자 대응과 독립 자료가 필요하다.

## 검증

- 새 합성 테스트 7개 통과, 합성 CLI 2epochs 성공, 실제 가중치 재로딩 성공(79,969bytes).
- `python -X utf8 tools/dev.py test`: 154개 중150통과, 기존 배포 오류3개, skip1개.
  백업 파일 Windows unlink 2개와 Linux/POSIX 배포 잠금1개이며 신규 LSTM 테스트는 통과했다.
- `python -X utf8 tools/dev.py check-repo`, `git diff --check` 통과.
- 타입 검사/프론트 빌드/전체 make check/독립 성능 평가는 실행하지 않았다.
- 상세 실패·복구 기록은 [완료 계획](../../plans/completed/0030-panoptic-lstm.md)을 따른다.
