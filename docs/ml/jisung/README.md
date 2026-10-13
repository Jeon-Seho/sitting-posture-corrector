# jisung ML 작업 기록

이 폴더에는 jisung의 ML 개발 판단과 환경별 인계를 기록한다.

## 환경별 파일 구분

- 파일 이름은 `YYYY-MM-DD-<환경>-<주제>.md`를 사용한다.
- 이번 환경의 기록은 `desktop`, 집에서 별도로 작성하는 기록은 `home`처럼 환경을 구분한다.
- 기존 환경의 파일을 덮어쓰지 않고 새 기록에서 관련 문서를 연결한다.
- 각 기록에 작업 환경·브랜치·기준 커밋·참고 브랜치·구현/제안/검증 상태를 남긴다.
- 집의 체크아웃과 미커밋 문서는 현재 환경에서 확인하지 못했다. 동기화 시 두 기록의 결정과 코드 상태를 대조한다.
- 프로젝트 공통 ADR·연구 규격은 원래 위치를 유지한다. 이 폴더는 환경별 기록의 진입점이다.

## 기록 목록

| 날짜·환경 | 기록 |
| --- | --- |
| 2026-10-12 · desktop | [개인 기준 특징과 서버 연결 방향](2026-10-12-desktop-posture-feature-decisions.md) |
| 2026-10-12 · desktop | [코·어깨 3점과 얼굴·어깨 13점 비교 HTML](2026-10-12-desktop-pose-feature-comparison.html) |
| 2026-10-13 · desktop | [test_0.2.4 논문·데이터셋 자료 확인](2026-10-13-desktop-test-024-reference-review.md) |
| 2026-10-13 · desktop | [외부 데이터셋 적용·접근 조건 조사](2026-10-13-desktop-external-dataset-review.md) |
| 2026-10-13 · desktop | [MultiPosture 13포인트 실제 학습 결과](2026-10-13-desktop-multiposture-training.md) |
| 2026-10-13 · desktop | [Panoptic 공개 시계열 다운로드·구조 확인](2026-10-13-desktop-panoptic-download.md) |
| 2026-10-13 · desktop | [Panoptic 좌표 LSTM 실제 학습 결과](2026-10-13-desktop-panoptic-lstm-training.md) |
| 2026-10-13 · desktop | [미래 예측 + 룰 조합 실험](2026-10-13-desktop-forecast-rule-hybrid.md) |
| 2026-10-13 · desktop | [웹캠 LSTM·룰 직접 비교 화면](2026-10-13-desktop-live-forecast-experiment.md) |

## 공통 기준

로컬 미래 예측 실험 인계 브랜치는 `feature/repo-jisung-local-forecast`다.
HTML은 2026-10-12 작성 시점의 설명 자료이며 현재 연구 구현은 2026-10-13 실험 기록을 따른다.
원본 인라인 시각화의 테마·호스트 연동 코드를 보존했으므로 단독 브라우저 표시와 일부 동작은 다를 수 있다.

[문서 지도](../../index.md), [Git 명명 규칙](../../../CONTRIBUTING.md),
[연구 프로토콜](../../research/protocol.md), [출력 계약](../../../contracts/README.md).
