# test_0.2.4 논문·데이터셋 자료 확인

- 확인일: 2026-10-13
- 환경: desktop. 집 작업 내용은 미확인.
- 현재 작업 브랜치: `feature/repo-baseline-mediapipe`
- 조사 대상: `origin/test_0.2.4`, `97e4ac126ca24c4e57d7226f17f6c865221587ac`
- 범위: 원격 파일·학습 코드·자료 목록 조회. 현재 앱에 병합하거나 모델을 실행하지 않았다.

## 자료 위치

| 경로 | 내용 |
| --- | --- |
| [paper/README.md](https://github.com/Jeon-Seho/sitting-posture-corrector/blob/97e4ac1/paper/README.md) | 연구 질문, 비교 실험 설계, 합성 실험 결과, 관련 연구, 원본 문서 지도 |
| [paper/references.bib](https://github.com/Jeon-Seho/sitting-posture-corrector/blob/97e4ac1/paper/references.bib) | 얼굴·회전·시계열·행동 관련 8편의 BibTeX |
| [docs/research/face-motion-literature.md](https://github.com/Jeon-Seho/sitting-posture-corrector/blob/97e4ac1/docs/research/face-motion-literature.md) | 논문별 적용/미적용 범위, 공식 API와 데이터 접근 자료 |
| [docs/areas/machine-learning/face-motion-v020.md](https://github.com/Jeon-Seho/sitting-posture-corrector/blob/97e4ac1/docs/areas/machine-learning/face-motion-v020.md) | 얼굴 CNN 구조·합성 학습·실행 검증·0.2.4 정책 변경 이력 |

paper/는 요약과 서지의 진입점이며 논문 PDF 묶음이나 실제 학습 데이터 폴더가 아니다.

## 논문 목록의 범위

기술 문헌 8편은 Facial Surface Geometry, Attention Mesh, 연속 6D 회전 표현,
6DRepNet, BlazePose, 시간 convolution/recurrent 비교, ST-GCN, NTU RGB+D 120이다.
별도로 자세 감지 관련 BlazePose, Kulikajevas, ALIGN, LSP-YOLO, Odesola 연구 5편이 정리돼 있다.
BlazePose는 두 목록에 중복된다. 자세 연구 5편은 해당 문서에서 서지·성능 수치의 외부 재확인이 필요하다고 명시한다.
이번 조사는 원격의 문헌 정리 존재 여부와 구현 연결을 확인한 것이며 전체 논문 본문·수치를 재검증한 것은 아니다.

## 데이터셋과 실제 사용 구분

| 자료 | 문서의 용도 | 원격에서 확인한 사용 상태 |
| --- | --- | --- |
| NTU RGB+D / 120 | 고개 움직임·행동/스트레칭 후보 | 미다운로드·미사용으로 기록. 전신 Kinect 관측과 우리 정면 얼굴·어깨 관측은 다름 |
| CMU MoCap | 운동·스트레칭 모션 후보 | 원본/조건 미확인·학습 미사용으로 기록 |
| BIWI / AFLW2000 | 머리 회전 평가 자료 | 소개만 있으며 확보·학습하지 않았다고 기록 |
| 자체 제작 시계열 | 작은 LSTM/얼굴 CNN의 연결·학습 실험 | 생성 코드가 있음. 실제 참여자 자료가 아니며 생성 seed 분할을 사람 분할로 해석하지 않음 |
| 합성 CSV fixture | 기존 자료 준비 검사 | `model/analysis/dataset/synthetic/`의 CSV 6개가 Git에 있음. 얼굴 CNN 학습 시계열과 별도 자료 |

원격 tree의 데이터 관련 산출물을 확인했다. 공개 데이터셋 원본·논문 PDF·학습 가중치는 Git에 없고,
요구사항 CSV와 합성 검사 CSV, BibTeX가 있다. Git 밖 개인 자료나 다른 PC의 파일 존재 여부는 확인하지 않았다.
`train_face_motion.py`는 manifest가 없으면 제작 특징 시계열을 생성하고, manifest가 있으면 검토된 개인 자료를 읽는다.
코드에 실제 자료 입력 기능이 있다는 것만으로 해당 자료의 확보·학습 완료를 주장하지 않는다.

NTU 공식 페이지는 25개 신체 관절·RGB/깊이/IR 자료 및 계정·요청·승인 절차를 안내한다.
실제 사용 전에 원본 이용 조건과 관측/라벨 대응을 확인한다.
[NTU 공식 안내](https://rose1.ntu.edu.sg/dataset/actionRecognition/).
CMU 공식 홈페이지는 이번 조회에서도 시간 초과로 내용을 확인하지 못했다.

## 0.2.4의 중요한 변경

가중치는 0.2.0과 같다고 기록돼 있다. 감점은 CNN 확률 대신 등록 기준 대비 직접 관측한
roll·pitch·얼굴 크기 접근·어깨 대비 머리 위치 변화의 지속으로 판단한다.
원격 `faceMotion.ts`의 `faceDeviation`과 `FaceDecision`에서도 기하 변화 및 지속 확인 경로를 확인했다.
CNN 출력은 목 움직임·스트레칭 후보 표시에 남아 있다. 이 정책 변경이 실제 사용자 정확도 개선을 입증하지는 않는다.

개인 기준 대비 기하 변화량을 먼저 비교한다는 우리의 개발 순서에 참고할 수 있다.
현재는 Pose 13점·손목 제외를 유지한다. Face Landmarker 입력과 손목 기능을 포함하는 이 브랜치를 통째로 채택하지 않는다.
공개 행동/머리 회전 라벨이 개인 기준 대비 자세 변화량의 정답으로 바로 대응하는지도 별도로 검토해야 한다.

## 확인 결과와 제한

논문·서지·데이터 후보 자료는 존재한다. 바로 투입할 공개 실자료나 검증된 개인 기준 변화량 모델을 확보한 상태는 아니다.
원격 조회와 문서·코드 대조만 수행했으며 데이터 다운로드·모델 재학습·실카메라 평가는 실행하지 않았다.
다음 자료 선별은 정면·얼굴/어깨·개인 기준·낮은 라벨 비용의 현재 목표와 맞는지부터 판단한다.
