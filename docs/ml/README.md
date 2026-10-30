# ML 계획과 작업 기록

## 새 ML 설계 계획

- [정면 어깨 위 관측의 판정 한계](measurement-limits.md): 지원할 2D 변화와 제외할 신체 상태, 형태·배치·품질, 팔꿈치 포함과 LSTM 보류의 근거. 수집 전에 확인한다.
- [개인 자세 ML 수집 학습 평가 재설계](rebuild-plan.md): 서비스 FE·BE 유지. 한계 확인 이후 본인 한 명·CPU 우선으로 진행할 조건부 수집·학습·평가안.
- [실행 계획 0052](../plans/active/0052-ml-rebuild.md) · [범위 결정 ADR 0038](../decisions/0038-ml-rebuild-scope.md).

새 설계는 구현 전 계획이다. 아래 문서는 현재 실행 중인 `/dev`의 정상 수집·미래 좌표 예측 실험과 당시 결과를 설명한다.

## 기존 실험 구현과 기록

- [카메라 성능 측정과 모델 비교](camera-performance.md): M1 GPU 경로 확인·동일 입력 Lite/Full/Heavy 비교·실제 앱 12.7→23.5–27.2 FPS 개선 결과.
- [실제 촬영과 ML 공백 감사](live-keypoint-audit.md): 변경 전 관찰과 공백 기록. 등록 검증·학습 연결은 아래 최신 계획에서 보완한다.
- [최신 ML 계획](current-plan.md): 정상 등록 검증·중심 고정, 자동 6% 기본 선택, 연속 창 진단과 실제 MediaPipe 학습 연결.
- [MediaPipe 로컬 학습 안내](mediapipe-training.md): 수집 JSON 검사·참여자 분할·pilot·학습·model.json 불러오기. 실제 자료는 비공개 경로에 둔다.
- [HTML로 보기](current-plan.html): 같은 계획을 수집 흐름·판정 흐름·비교군으로 정리한 독립 페이지. 인터넷이나 추가 패키지 없이 연다.
- [결정 ADR 0028](../decisions/0028-normal-only-developer-model.md): `/dev` 한정 적용과 서비스 경계.
- [결정 ADR 0032](../decisions/0032-normal-reference-and-mediapipe-training.md): 학습 중심 고정·동일 추출기 등록 검증·자동 v2·미래 실제 관측을 타깃으로 쓰는 학습 경계.

새 작업은 위 재설계 계획에서 시작한다. 기존 구현 설명과 아래 환경별 기록은 당시 결과와 재현 근거로 보존한다.

## 담당별 기록

담당별 조사·결정·작업 인계를 모은다. 현재 프로젝트의 제품 범위·계약·ADR은 기존 기준 문서를 따른다.
작업 기록에 있는 제안이나 과거 검증을 현재 구현 완료로 해석하지 않는다.

- [jisung 작업 기록](jisung/README.md): 개인 기준 특징, 로컬 개발과 서버 연결, 테스트 브랜치 비교.

실제 영상·랜드마크·참여자 식별 정보·모델 가중치는 이 폴더에 저장하지 않는다.
