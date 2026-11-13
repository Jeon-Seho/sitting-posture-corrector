# 100배 증강 프레임 RF 연구 후보

사용자 요청으로 기존 프레임별 2단계 RF의 100배 증강 후보를 이 경로에 보관한다. `frame-corrector.joblib`은 세로 이동 보정기이고, `frame-posture.joblib`은 개인 기준 대비 자세 이탈 분류기다. 두 파일을 함께 사용한다. `report.json`에는 모델 해시와 실험 설정, 평가 집계만 담으며 원본 영상·랜드마크·참여자 이름·개별 촬영 정보는 포함하지 않는다.

각 유효 프레임에서 33개 랜드마크 중 코·눈·귀·입꼬리·어깨 9점의 6개 특징을 이용해 이탈 점수를 출력한다. 3초 지속 판정은 서버의 역할이며 이 모델에는 들어 있지 않다. 입력 품질이 낮으면 `unmeasurable`로 처리한다. 서비스 추론 경로에는 아직 연결되지 않았다.

기존 25배와 같은 데이터·분할·0.5 탐색 기준에서, 두 라벨이 있는 8개 그룹의 프레임별 균형 정확도는 89.98%에서 90.38%로 관측됐다. 이름 기준 9개 그룹의 동일인 여부와 안내 라벨의 실제 수행은 확인 전이다. 전체 자료로 학습한 이 후보 자체에는 독립 시험이 없고, 실제 사용자·실시간 속도·3초 알림은 검증하지 않았다. 0.5는 점수 비교용 기준이며 보정된 확률이나 검증된 운영 임계값이 아니다.

## 불러오기

기존 연구용 로더는 모델 폴더가 Git 작업 디렉터리 바깥에 있어야 하므로, 파일 세 개를 신뢰하는 비공개 폴더로 복사한 뒤 사용한다. Python 3.9.6, numpy 1.26.4, scikit-learn 1.6.1, joblib 1.4.2에서 생성·확인했다. `joblib`을 불러올 때는 코드가 실행될 수 있으므로 출처를 확인한다.

```sh
mkdir -p "<private>/frame-rf-100x"
cp model/pretrained/frame-rf-100x/frame-corrector.joblib model/pretrained/frame-rf-100x/frame-posture.joblib model/pretrained/frame-rf-100x/report.json "<private>/frame-rf-100x/"
python -m model.analysis.live_comparison.server --artifacts-dir "<private>/frame-rf-100x"
```

웹캠 연구 화면을 사용하려면 프로젝트의 개발 의존성도 필요하다. 전체 학습 보고서·실제 촬영과 이름 매핑은 비공개로 보관한다. 실험과 추론의 상세 내용은 [프레임 RF 문서](../../analysis/frame_pilot/README.md)를 참고한다.
