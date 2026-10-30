# 얼굴 추적과 공개 자료 재검토

- 확인일: 2026-10-15 · /dev 개발 실험
- [현재 ML 계획](current-plan.md) · [얼굴 추적 결정](../decisions/0037-developer-face-landmarker.md)
- 상태: Face 추적·동일 영상 비교 구현, 공개 메타데이터 확인. 새 참여자 모델 학습·서비스 정확도 검증 없음.

## 이번 얼굴 추적의 의미

공식 Face Landmarker v1과 기존 Pose Full을 같은 영상에서 비교한다. Face 윤곽이 기본 표시이며 기존 Pose/겹쳐 보기를 선택할 수 있다.
안경 착용·미착용10초 정면 비교를 별도로 수행한다. 검출 유지와 모델 간 위치 차이는 수동 정답을 대신하지 않는다.
시각적 오버레이만 아래로 이동하지 않으며 실제 Face 추출 좌표를 사용한다. 원본 Pose 입력과 Face 상대 깊이는 다른 좌표계다.
현재39D LSTM·정상 수집·알림은 Pose를 계속 사용한다. 얼굴 전용 입력의 정상 모델이 생겼다고 주장하지 않는다.

## 예전에 사용한 논문과 학습

두 실험이 있었다. 아래 수치는 **저장소의 당시 기록**이며 이번에 재학습한 결과가 아니다.

| 실험 | 실제 수행한 일 | 결과·한계 |
| --- | --- | --- |
| [Panoptic LSTM 기록](jisung/2026-10-13-desktop-panoptic-lstm-training.md) | 171204_pose1 몸19/얼굴70에서13점·39D·30시점→300ms 뒤 좌표 회귀 | 학습 집합 점 거리 LSTM0.045511, 마지막 위치 유지0.044814. 검증/시험 없음. 움직임 예측이며 자세 분류가 아님 |
| [MultiPosture 학습 기록](jisung/2026-10-13-desktop-multiposture-training.md) | 참여자8/2/3명 분할, 외부 자료의 직립·앞/뒤/좌/우 몸통5종 분류 | 저장 모델 시험 Macro-F1 0.8111. 직립 recall69.89%, 뒤로 기울임54.55%. 실제 웹캠/개인 이탈 검증 없음 |

Panoptic 근거는 Joo 등의 *Panoptic Studio: A Massively Multiview System for Social Interaction Capture*다.
MultiPosture 근거는 Carneros-Prado 등의 *A Comparison Between Multilayer Perceptrons and Kolmogorov-Arnold Networks for Multi-Task Classification in Sitting Posture Recognition*, IEEE Access2024, DOI10.1109/ACCESS.2024.3510034다.
논문 데이터로 학습했다는 사실과 우리 알림이 좋아진다는 것은 별도 검증이다.

## 현재 사용할 수 있는 공개 자료

| 자료 | 맞는 용도 | 바로 연결할 수 없는 부분 |
| --- | --- | --- |
| [CMU Panoptic 공식 도구](https://github.com/CMU-Perceptual-Computing-Lab/panoptic-toolbox) | 동기화 RGB·프레임별 몸/얼굴3D·카메라 보정. 현재 추출기로 영상을 재처리해 라벨 없는 미래 예측의 사전 학습 후보 | 제공 얼굴70점과 Face478점은 다름. 정상/지속 붕괴 정답 없음. 비상업 연구용이며 상업 서비스용 권한으로 해석하지 않음 |
| [MultiPosture](https://zenodo.org/records/14230872) | 기존 Heavy 얼굴·어깨 특징으로5종 몸통 분류 또는 학습 참여자의TUP만 이용한 정상 분포 실험 후보 | 영상·시간/세션·visibility 없음. Face로 재추출하거나 행 순서로LSTM 창을 만들 수 없음. 공개 좌표의 정의/정규화와 현 추출기의 호환성 확인 필요 |
| [EYEDIAP 공식 설명](https://www.idiap.ch/en/dataset/eyediap) | RGB·프레임별 머리 자세/눈 위치·카메라 보정으로 고개 회전과 검출 변동 비교 | 몸통 붕괴 라벨 없음. [신청/EULA](https://zenodo.org/records/4467455) 기반 비상업 연구; 이번에 신청·서명하지 않음 |

MultiPosture 공식 API를 이번에 다시 조회하여 `open`, `cc-by-4.0`, data.csv9,327,935bytes와 MD5`7efbc94d653acf32eefecec3ff26d6c6`을 확인했다.
원본 좌표는 새로 다운로드/저장하지 않았다. 공식 설명은4,800프레임·11관절이지만 과거 실제 CSV 집계는13명·4,794행·33관절이었다.
현재 메타데이터와 과거 파일 집계를 구분한다. 파일 설명만으로 시간 정보를 새로 만들지 않는다.

## 제안하는 학습 경로

1. 얼굴 추출 성능부터 안경·반사·고개 회전 조건으로 비교한다. Face와 Pose의 차이를 어느 한쪽의 정답으로 사용하지 않는다.
2. 공개 시계열을 사용할 때에는 해당 영상에 현재 동일 Pose/Face 버전을 적용해 다시 추출한다. source ID, 영상 시각, 품질·세션 경계를 보존한다.
3. 먼저 개인/참여자를 train·validation·test로 나눈다. Panoptic track ID가 여러 시퀀스에서 동일인임을 보장하지 않으므로 track 분할을 참여자 분할로 부르지 않는다.
4. Pose39D 예측은 기존 v2 경로를 사용하되 Face 특징을 붙이는 학습은 별도 계약·버전으로 구현한다. Face 상대z를Pose worldz로 간주하지 않는다.
5. 자체 확인한 정상 구간으로 정상 분포를 학습하고, 짧은 고개 돌림·스트레칭·지속 기대기의 독립 평가를 유지한다. 공개 upright가 우리 사용자의 기준 등록 정답을 대신하지 않는다.

우선순위: 기존 MultiPosture 분류를 비교군으로 보존하고, Panoptic RGB 재추출로 시계열 표현 학습을 검토한다.
머리 동작 정답 검증에는 EYEDIAP을 별도로 신청한다. Face Landmarker 자체의 안경 성능 개선 학습과 다운스트림LSTM 학습은 다른 작업이다.
현재 SDK 모델을 이 CSV만으로 자동 fine-tuning할 수 있다고 주장하지 않는다.

## 실제 얼굴 비교 결과

[실제 비교 기록](measurements/face-tracking-2026-10-15.md): 착용79/79·미착용77/77 유효Face, 평균 모델 간 차이16.8/8.0px, Face 추론23.2/24.6ms. 사용자가 Face 기본 추적을 선택했다. 두 구간의 거리/각도가 완전히 통제되지 않았으므로 안경의 인과 효과나 정확도 개선률은 산출하지 않는다.
