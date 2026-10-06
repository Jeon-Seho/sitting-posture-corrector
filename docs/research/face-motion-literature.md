# 얼굴 회전·동작·부분 관측 관련 논문 및 공식 자료

- 분야: 논문, 머신러닝
- 작업: GP-0125
- 확인일: 2026-10-06
- 관련 구현: [0.2.0 실험 설계와 결과](../areas/machine-learning/face-motion-v020.md)

## 보고서에서 구분할 범위

아래는 저자 제공 arXiv 서지·초록과 공식 API/데이터 안내를 확인한 문헌 검토다.
모든 논문의 본문 전체, 원래 모델과 실험을 재현한 것은 아니다. 논문 수치를 우리 앱
성능으로 인용하지 않는다. 구현은 MediaPipe 사전학습 추적기를 이용하고, 별도의
작은 시간 CNN을 학습한다. 얼굴 추적기·6DRepNet·ST-GCN을 자체 재학습한 작업이 아니다.
얼굴의 신원을 식별하는 얼굴 인증도 수행하지 않는다.

## 문헌과 구현의 연결

| ID | 서지 정보 및 원문 | 핵심 내용 | 이번 적용과 제외 |
| --- | --- | --- | --- |
| R1 | Kartynnik, Y.; Ablavatski, A.; Grishchenko, I.; Grundmann, M. (2019). *Real-time Facial Surface Geometry from Monocular Video on Mobile GPUs*. CVPR Workshop on Computer Vision for Augmented and Virtual Reality. [arXiv:1907.06724](https://arxiv.org/abs/1907.06724) | 단안 영상에서 조밀한 3D 얼굴 표면을 추정하는 경량 모델. | 얼굴 중심 추적의 근거. 실제 사용은 현행 Face Landmarker task이며 2019 논문 모델과 동일 가중치라고 주장하지 않음. |
| R2 | Grishchenko, I.; Ablavatski, A.; Kartynnik, Y.; Raveendran, K.; Grundmann, M. (2020). *Attention Mesh: High-fidelity Face Mesh Prediction in Real-time*. CVPR Workshop on Computer Vision for Augmented and Virtual Reality. [arXiv:2006.10962](https://arxiv.org/abs/2006.10962) | 눈·입 등 의미 영역에 attention을 적용한 얼굴 mesh 추정. | 얼굴 세부 추적 관련 검토. 자체 attention 네트워크를 구현하거나 학습하지 않음. |
| R3 | Zhou, Y.; Barnes, C.; Lu, J.; Yang, J.; Li, H. (2019; arXiv 최초 2018). *On the Continuity of Rotation Representations in Neural Networks*. CVPR. [arXiv:1812.07035](https://arxiv.org/abs/1812.07035) | 회전의 연속적인 5D/6D 표현을 제안. | 기준 회전에 대한 상대 회전행렬의 첫 두 열 6개 값을 시간 모델 입력으로 사용. 원래 회전 회귀 실험은 재현하지 않음. |
| R4 | Hempel, T.; Abdelrahman, A. A.; Al-Hamadi, A. (2022). *6D Rotation Representation For Unconstrained Head Pose Estimation*. ICIP, pp. 2496–2500. [arXiv:2202.12555](https://arxiv.org/abs/2202.12555), [DOI](https://doi.org/10.1109/ICIP46576.2022.9897219) | 6D 회전 표현과 geodesic loss를 이용한 머리 자세 회귀. | Euler 각 하나만으로 학습하지 않는 설계에 참고. 6DRepNet 가중치·geodesic loss는 적용하지 않음; 앱의 회전 추정은 MediaPipe가 담당. |
| R5 | Bazarevsky, V.; Grishchenko, I.; Raveendran, K.; Zhu, T.; Zhang, F.; Grundmann, M. (2020). *BlazePose: On-device Real-time Body Pose tracking*. CVPR Workshop on Computer Vision for Augmented and Virtual Reality. [arXiv:2006.10204](https://arxiv.org/abs/2006.10204) | 모바일 실시간 신체 33개 keypoint 추정·추적. | 기존 Pose Landmarker로 어깨와 손목 보조 관측. 가려진 관절의 추정을 실제 관측으로 취급하지 않도록 visibility/presence와 화면 경계를 확인. |
| R6 | Bai, S.; Kolter, J. Z.; Koltun, V. (2018). *An Empirical Evaluation of Generic Convolutional and Recurrent Networks for Sequence Modeling*. arXiv preprint. [arXiv:1803.01271](https://arxiv.org/abs/1803.01271) | 여러 시퀀스 과제에서 convolution과 recurrent 모델을 비교. | dilation 1/2/4의 causal 시간 convolution을 시험. 원래 residual TCN 전체 구현은 아니며 이 앱에서 LSTM보다 우수하다는 비교 결과도 아직 없음. |
| R7 | Yan, S.; Xiong, Y.; Lin, D. (2018). *Spatial Temporal Graph Convolutional Networks for Skeleton-Based Action Recognition*. AAAI. [arXiv:1801.07455](https://arxiv.org/abs/1801.07455) | skeleton의 공간·시간 구조를 함께 학습하는 ST-GCN. | 관절과 시간 정보를 함께 다루는 대안 검토. 팔꿈치·몸통이 자주 없으므로 현재 구현에는 graph convolution을 채택하지 않음. |
| R8 | Liu, J.; Shahroudy, A.; Perez, M.; Wang, G.; Duan, L.-Y.; Kot, A. C. (2019 online publication). *NTU RGB+D 120: A Large-Scale Benchmark for 3D Human Activity Understanding*. IEEE TPAMI. [arXiv:1905.04757](https://arxiv.org/abs/1905.04757), [DOI](https://doi.org/10.1109/TPAMI.2019.2916873) | 여러 사람·시점의 120가지 행동을 제공하는 benchmark. | A104 stretch oneself 등을 향후 행동 학습 후보로 검토. 이번 학습에는 사용하지 않음. 정식 권·호·쪽수는 최종 보고서 제출 전 출판사 서지에서 확인. |

## 공식 API 자료와 데이터 접근

- [Face Landmarker Web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js):
  얼굴 landmark와 선택적 transformation matrix 출력. 동기 추론이 UI를 막을 수 있어 별도 worker 사용.
  해당 행렬은 의료용 경추 각도나 실제 거리의 측정 결과가 아니다.
- [Pose Landmarker Web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js):
  신체 landmark와 품질 설정. 현재 구현은 어깨·손목을 보조 정보로 사용한다.
- [MatrixData 정의](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/framework/formats/matrix_data.proto),
  [Face geometry pipeline](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_geometry/libs/geometry_pipeline.cc):
  행렬 packed data의 COLUMN_MAJOR 기본 배열을 확인하고 양의 yaw fixture로 어댑터를 검증한다.
- [NTU 공식 데이터 및 이용 조건](https://rose1.ntu.edu.sg/dataset/actionRecognition/):
  A35 nod head/bow, A36 shake head, A104 stretch oneself 포함.
  계정·요청·승인 및 release agreement가 필요하며 연구·비상업 목적 조건이 있다.
  현재 다운로드하지 않았고 승인·학습 완료 상태가 아니다. Kinect 전체 skeleton에서
  웹캠 얼굴/부분 상체로 바뀌는 관측 차이를 별도 검증해야 한다.
- [CMU MoCap 분류](https://mocap.cs.cmu.edu/motcat.php?maincat=4): 운동·스트레칭 자료 후보.
  홈페이지 직접 요청은 조회 시간 초과였다. 원본/조건을 확인하거나 학습에 사용하지 않았음.
- BIWI/AFLW2000은 R4의 머리 회전 평가 자료로 소개되어 있으나 이번에 확보·학습하지 않음.
  머리 회전 정답이 있다는 것만으로 바른 몸 자세나 스트레칭 의도 정답을 만들 수 없다.

## 보고서에 사용할 수 있는 기술 설명

“본 실험은 사전학습된 얼굴 및 신체 landmark 추적기로 관측 특징을 추출하고,
기준 자세에 대한 상대 회전과 부분 관측 mask를 입력으로 하는 다중 과제 시간 CNN을
구성하였다. 자세 후보와 움직임 후보를 별도 출력하며, 측정 불가 구간과 근거가 부족한
얼굴 단독 구간에서는 몸 자세 평가를 보류하였다. 초기 학습·검증·시험은 제작 시퀀스를
사용하였으며, 실제 사용자에 대한 일반화 성능은 검증되지 않았다.”

위 문장은 구현 범위 설명이다. 정확도 개선, 스트레칭의 건강 효과, 거북목 진단,
실제 사용자 대상 학습 완료로 확장해서 쓰지 않는다.

## 참고문헌 가져오기용 BibTeX

학회용 최종 서지는 제출 전에 출판사 형식으로 확인한다. 다음은 원문 식별에 필요한 최소 필드다.

```bibtex
@article{kartynnik2019face,
  title={Real-time Facial Surface Geometry from Monocular Video on Mobile GPUs},
  author={Kartynnik, Yury and Ablavatski, Artsiom and Grishchenko, Ivan and Grundmann, Matthias},
  journal={arXiv preprint arXiv:1907.06724}, year={2019}, url={https://arxiv.org/abs/1907.06724}
}
@article{grishchenko2020attention,
  title={Attention Mesh: High-fidelity Face Mesh Prediction in Real-time},
  author={Grishchenko, Ivan and Ablavatski, Artsiom and Kartynnik, Yury and Raveendran, Karthik and Grundmann, Matthias},
  journal={arXiv preprint arXiv:2006.10962}, year={2020}, url={https://arxiv.org/abs/2006.10962}
}
@inproceedings{zhou2019continuity,
  title={On the Continuity of Rotation Representations in Neural Networks},
  author={Zhou, Yi and Barnes, Connelly and Lu, Jingwan and Yang, Jimei and Li, Hao},
  booktitle={CVPR}, year={2019}, url={https://arxiv.org/abs/1812.07035}
}
@inproceedings{hempel2022sixd,
  title={6D Rotation Representation For Unconstrained Head Pose Estimation},
  author={Hempel, Thorsten and Abdelrahman, Ahmed A. and Al-Hamadi, Ayoub},
  booktitle={ICIP}, year={2022}, pages={2496--2500}, doi={10.1109/ICIP46576.2022.9897219}
}
@article{bazarevsky2020blazepose,
  title={BlazePose: On-device Real-time Body Pose tracking},
  author={Bazarevsky, Valentin and Grishchenko, Ivan and Raveendran, Karthik and Zhu, Tyler and Zhang, Fan and Grundmann, Matthias},
  journal={arXiv preprint arXiv:2006.10204}, year={2020}, url={https://arxiv.org/abs/2006.10204}
}
@article{bai2018temporal,
  title={An Empirical Evaluation of Generic Convolutional and Recurrent Networks for Sequence Modeling},
  author={Bai, Shaojie and Kolter, J. Zico and Koltun, Vladlen},
  journal={arXiv preprint arXiv:1803.01271}, year={2018}, url={https://arxiv.org/abs/1803.01271}
}
@inproceedings{yan2018stgcn,
  title={Spatial Temporal Graph Convolutional Networks for Skeleton-Based Action Recognition},
  author={Yan, Sijie and Xiong, Yuanjun and Lin, Dahua},
  booktitle={AAAI}, year={2018}, url={https://arxiv.org/abs/1801.07455}
}
@article{liu2019ntu120,
  title={NTU RGB+D 120: A Large-Scale Benchmark for 3D Human Activity Understanding},
  author={Liu, Jun and Shahroudy, Amir and Perez, Mauricio and Wang, Gang and Duan, Ling-Yu and Kot, Alex C.},
  journal={IEEE Transactions on Pattern Analysis and Machine Intelligence},
  year={2019}, doi={10.1109/TPAMI.2019.2916873}, url={https://arxiv.org/abs/1905.04757}
}
```
