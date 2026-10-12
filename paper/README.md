# 논문 자료 모음

논문·보고서 작성에 필요한 연구 질문, 실험 설계, 실험 결과, 관련 연구, 참고문헌을 한곳에 모은 진입 문서다.
세부 내용의 정본은 각 원본 문서이며, 이 문서는 요약과 링크만 제공한다. 수치나 결정이 바뀌면 원본을 먼저 고친다.

- 정리일: 2026-10-12 (`test_0.2.4` 기준)
- 참고문헌 가져오기: [references.bib](references.bib)

> 아래 결과는 모두 **제작(합성) 데이터** 또는 공개 사진 fixture로 얻은 것이다.
> 실제 사용자 정확도, 오알림률, 건강·치료 효과로 인용하지 않는다.

## 1. 연구 주제와 질문

가제: **개인 기준 보정과 시계열 랜드마크를 이용한 단일 RGB 카메라 기반 앉은 자세 변화 감지**
([논문 구상 원문](../docs/references/posture_ai_paper_one_page.md), [프로젝트 요약](../docs/references/posture_ai_project_one_page.md))

- **RQ1:** 개인 기준 자세 대비 변화량을 쓰면 처음 보는 사용자의 Macro-F1과 시간당 오알림이 개선되는가?
- **RQ2:** 시계열 모델이 일시적 움직임과 지속적 자세 이탈을 프레임 단위 모델보다 잘 구분하는가?

포즈·얼굴 추정기를 새로 만드는 연구가 아니라, 사전학습 추적기 출력 위에 개인화와 시간 정보를 넣었을 때의
효과를 보는 연구다. 기업연계 계획서와의 차이는 [계획서 요약](../docs/references/current-proposal-review.md)에 있다.

## 2. 실험 설계

정본: [연구 프로토콜 초안](../docs/research/protocol.md) (가설·설계 단계, 실제 참여자 실험 결과 없음)

| 항목 | 내용 |
| --- | --- |
| 비교군 | M0 고정 각도 규칙 · M1 프레임 KNN · M2 프레임 MLP · M3 개인 보정 없는 GRU · M4 개인 기준 변화량 GRU(제안) |
| 분할 | 참여자 단위 GroupKFold 또는 LOSO. 프레임 무작위 분할 금지. 시험 참여자는 기준 등록 20~30초만 보정에 사용 |
| 지표 | Macro-F1, balanced accuracy, 클래스별 recall, 시간당 false alarm, 감지 지연, p95 추론 지연/FPS, 95% 신뢰구간 |
| 소거실험 | 개인 기준 보정 유무, 시계열 모델 유무를 각각 제거 |
| 모집 목표 | 프로토타입 6명, 본 실험 최소 20명 (목표이며 확보 인원이 아님) |

자료 준비와 수집: [참여자 분할·시간 창 준비](../docs/research/dataset-preparation.md),
[안내형 수집 v2](../docs/research/guided-collection-v2.md), [파일럿 CSV](../docs/research/pilot-csv.md),
[본인 자세 동작 실험](../docs/research/personal-pilot-training.md)(같은 사람 회차 분할, 새 사용자 평가 아님).

## 3. 지금까지 구현한 실험

| 버전 | 모델 | 학습 자료와 결과 | 정본 |
| --- | --- | --- | --- |
| 0.1.0 | 상대좌표 2층 LSTM (코·양어깨 상대 특징, 3클래스) | 제작 시퀀스 9,000개(학습 6,000 / 검증 1,500 / 시험 1,500, 생성 identity 분리). 127 epoch 조기 종료, 시험 Macro-F1 1.0. 생성 패턴 검증일 뿐 실제 성능 아님. 실사용에서 고개 회전·스트레칭·어깨 누락에 취약 | [LSTM 실험](../docs/areas/machine-learning/relative-pose-lstm.md), [계획 0023](../docs/plans/active/0023-relative-pose-lstm-lab.md) |
| 0.2.0 | 얼굴 중심 다중 과제 시간 CNN (40프레임 × 특징 26개, dilation 1/2/4, 자세 4 + 행동 5 출력) | 제작 시퀀스 학습 6,400 / 검증 1,600 / 시험 1,600. 140 epoch(best 105). 관측 가능 자세 오류율 1.0008%(Macro-F1 0.9925), 행동 0.7792%(0.9925). 실제 사람 오차율 미측정 | [얼굴 모델 기록](../docs/areas/machine-learning/face-motion-v020.md), [계획 0024](../docs/plans/active/0024-face-motion-lab.md) |
| 0.2.1~0.2.3 | 0.2.0과 같은 가중치 | 입력 연결 오류 수정, 머리/상체 평가 범위 분리, 백그라운드 처리·얼굴 재포착 | [버전별 변경 이력](../README.md#테스트-버전-변경-이력) |
| 0.2.4 | 0.2.0과 같은 가중치 | 감점을 모델 확률 대신 등록 기준 대비 직접 관측한 변화(roll·pitch·얼굴 접근·어깨 대비 머리 위치)의 지속으로 판정. 모델 출력은 목 움직임·스트레칭 후보 표시에만 사용 | [0.2.4 기록](../docs/areas/machine-learning/face-motion-v020.md#024-관측-기반-감점과-기록-화면-수정2026-10-07) |

논문에 쓸 때의 의미: 0.1.0 → 0.2.x는 "어깨가 안 보이거나 고개를 돌리는 실제 상황"에서 생긴 실패를
부분 관측 mask, 상대 회전 표현, 행동 출력 분리로 다룬 설계 변경이다. 0.2.4는 합성 학습 모델의 확률을
실제 영상에 그대로 쓰기 어렵다는 관찰에 따른 판정 정책 변경이다. 어느 것도 실제 사용자 실험으로 검증되지 않았다.

## 4. 관련 연구

### 자세 감지·개인화 (초기 논문 구상에서 정리)

원문 비교표: [논문 구상 3절](../docs/references/posture_ai_paper_one_page.md#3-관련-연구와-차이).
이 다섯 편은 서지와 성능 수치를 외부에서 다시 확인하지 않았다. 인용 전에 원문을 확인한다.

| 연구 | 요지 | 본 연구와의 차이 |
| --- | --- | --- |
| [BlazePose (2020)](https://arxiv.org/abs/2006.10204) | 단일 RGB 33개 keypoint 실시간 추정 | 분류·개인화 모델이 아니라 특징 추출기 |
| [Kulikajevas et al. (2021)](https://doi.org/10.7717/peerj-cs.442) | RGB-D 시퀀스, 계층적 이미지 구성 | 깊이 센서 사용. 본 연구는 일반 RGB 랜드마크 |
| [ALIGN, Sahoo et al. (2026)](https://doi.org/10.3390/a19010048) | 측면 RGB·MediaPipe 특징 프레임 분류, 지속 오자세 알림 | 가장 가까운 연구. 본 연구는 시계열과 개인 기준을 결합 |
| [LSP-YOLO, Li et al. (2025 preprint)](https://arxiv.org/abs/2511.14322) | 이미지 단위 경량 다중분류 | 비개인화. 본 연구는 지속 상태 판정에 초점 |
| [Odesola et al. (2025)](https://doi.org/10.3390/s25185610) | 압력 매트 기반 개인별 자세 분류 | 전용 장비 필요. 본 연구는 비접촉 카메라 |

### 얼굴 회전·동작·부분 관측 (0.2.0 설계 근거)

정본: [얼굴 문헌 검토](../docs/research/face-motion-literature.md) (arXiv 서지·초록과 공식 API 확인, 2026-10-06)

| ID | 연구 | 이번 구현과의 관계 |
| --- | --- | --- |
| R1 | Kartynnik et al. 2019, [Real-time Facial Surface Geometry](https://arxiv.org/abs/1907.06724) | 얼굴 중심 추적의 근거 (실제 사용은 MediaPipe Face Landmarker) |
| R2 | Grishchenko et al. 2020, [Attention Mesh](https://arxiv.org/abs/2006.10962) | 얼굴 세부 추적 검토. 자체 구현 없음 |
| R3 | Zhou et al. 2019, [Continuity of Rotation Representations](https://arxiv.org/abs/1812.07035) | 상대 회전행렬 첫 두 열(6D)을 입력으로 사용 |
| R4 | Hempel et al. 2022, [6D Rotation for Head Pose](https://arxiv.org/abs/2202.12555) | Euler 각만 쓰지 않는 설계 참고. 가중치·loss 미사용 |
| R5 | Bazarevsky et al. 2020, [BlazePose](https://arxiv.org/abs/2006.10204) | 어깨·손목 보조 관측, visibility 확인 |
| R6 | Bai et al. 2018, [Generic Conv vs Recurrent](https://arxiv.org/abs/1803.01271) | causal 시간 convolution 채택 근거. LSTM 대비 우위는 미검증 |
| R7 | Yan et al. 2018, [ST-GCN](https://arxiv.org/abs/1801.07455) | 대안 검토. 관절 누락이 잦아 미채택 |
| R8 | Liu et al. 2019, [NTU RGB+D 120](https://arxiv.org/abs/1905.04757) | 향후 행동(스트레칭) 학습 후보. 미다운로드·미사용 |

공식 API·데이터 접근 조건(Face/Pose Landmarker, NTU, CMU MoCap)은 [문헌 검토의 공식 자료 절](../docs/research/face-motion-literature.md#공식-api-자료와-데이터-접근)에 있다.

## 5. 보고서용 기술 설명

[문헌 검토](../docs/research/face-motion-literature.md#보고서에-사용할-수-있는-기술-설명)의 문장을 기본으로 쓰고,
0.2.4 이후 판정 정책은 다음과 같이 덧붙일 수 있다.

> 시간 모델은 제작 시퀀스로만 학습되었으므로, 감점 여부는 등록 기준 대비 직접 관측한 머리 회전·
> 얼굴 크기·어깨 대비 머리 위치 변화가 정해진 시간 이상 지속되는지로 판단하였다. 모델 출력은 목 움직임과
> 스트레칭 후보를 구분하는 데 사용하였다. 임계값은 실험값이며 실제 사용자에서 민감도와 오알림률을 최적화하지 않았다.

## 6. 쓰지 않을 주장과 남은 검증

- 거북목 진단, 치료·교정 효과, 스트레칭의 건강 효과를 주장하지 않는다 (비의료 서비스).
- 제작 데이터의 오류율·Macro-F1을 실제 사용자 성능으로 쓰지 않는다. 생성 seed 분할은 참여자 분할이 아니다.
- 논문 수치를 우리 앱 성능으로 인용하지 않는다.
- 남은 검증: 실제 참여자 자료 수집(동의·익명화 절차 동결 후), 참여자 분할 평가, M0~M4 비교와 소거실험,
  사용자 실카메라에서의 감점 검출률·시간당 오알림 측정.

## 7. 원본 문서 목록

| 분류 | 문서 |
| --- | --- |
| 구상·배경 | [논문 구상](../docs/references/posture_ai_paper_one_page.md), [프로젝트 요약](../docs/references/posture_ai_project_one_page.md), [계획서 요약](../docs/references/current-proposal-review.md), [제공 자료 안내](../docs/references/README.md) |
| 연구 설계 | [프로토콜](../docs/research/protocol.md), [자료 준비](../docs/research/dataset-preparation.md), [수집 v2](../docs/research/guided-collection-v2.md), [파일럿 CSV](../docs/research/pilot-csv.md), [본인 실험](../docs/research/personal-pilot-training.md) |
| 실험 기록 | [LSTM 0.1.0](../docs/areas/machine-learning/relative-pose-lstm.md), [얼굴 0.2.x](../docs/areas/machine-learning/face-motion-v020.md), [버전 이력](../README.md#테스트-버전-변경-이력) |
| 문헌 | [얼굴 문헌 검토](../docs/research/face-motion-literature.md), [BibTeX](references.bib) |
