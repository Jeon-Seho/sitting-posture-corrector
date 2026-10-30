# MediaPipe 처리 모듈 분리

- 상태: completed
- 담당: Codex
- 시작일: 2026-10-12
- 관련 요구사항/ADR: 사용자 요청의 개발 편의 분리, [특징 비교 결정](../../decisions/0023-baseline-feature-comparison.md)

## 문제와 완료 기준

SDK 타입·모델 준비·추론 주기·13점 추출과 화면 표시가 연결돼 있어 ML 입력 처리 수정 경계가 불명확하다.
React·그리기·저장에 의존하지 않는 MediaPipe 모듈을 만들고 실제 카메라 경로에 연결한다.
GPU/CPU fallback·취소·측정 불가·원본 시계열·기준 등록 저장과 기존 판정 결과를 유지한다.

## 범위와 제외

프론트 내부 MediaPipe 전용 모듈, 카메라 표시 어댑터, 회귀 검증과 개발 안내.
A/B/C 새 판정·가중치·임계값은 이번 분리에서 확정하지 않는다. 서버·CSV·기준 저장 형식은 유지한다.

## 작업 단계

- [x] 기존 코드·문서·작업 규칙 확인
- [x] SDK·원본 관측·추론 루프 분리와 기존 호출부 연결
- [x] 실패·취소·관측 생명주기 합성 검증
- [x] 개발 안내·문서 동기화
- [x] 범위별 검증과 결과 기록

## 결정과 진행 기록

`frontend/src/features/mediapipe/`는 브라우저 SDK 어댑터다. 특징·기준 비교는 `model/prototype/`에 둔다.
프론트 hook은 모듈 자체 타입만 사용한다. SDK 패키지 직접 의존을 한 파일로 모은다.
모델 준비는 detector.ts, 원본 선택은 landmarks.ts, 추론 시간 처리는 tracking.ts로 분리했다.
camera/frameLoop.ts는 기존 특징과 평활화 표시만 연결한다. 원본 관측은 SDK 버퍼와 분리된 복사본이다.
취소된 callback 이후 새 타이머를 생성하지 않도록 추론 루프의 stop을 보장한다.

## 검증 결과와 남은 한계

- `python tools/dev.py check-frontend`: 41파일·295테스트 통과. TypeScript·Vite 빌드 통과, 기존 500kB 청크 경고 유지.
- `python tools/dev.py check-repo`: 저장소 구조·로컬 링크·산출물 경로 검사 통과.
- 서버 없는 임시 실행기 `.venv/Scripts/python.exe .cache/local-baseline-browser.py`: 분리된 Chrome 프로필의 로컬 브라우저 검사 18개 통과. 기존 기준 저장·화면/PiP 15개 + 실제 추론/표시 어댑터 3개. 브라우저 오류 없이 Chrome/Vite 정리 완료.
- 새 브라우저 검증은 기존 합성 시계 진행을 사용한다. 첫 시도에서 시계를 진행하지 않아 관측 대기가 실패했으며 검사만 수정한 뒤 통과했다.
- `python tools/dev.py check-browser`: production 합성 진입 제외 확인 후 API·CEP JAR 누락으로 서비스 시작 실패. 전체 게이트는 통과하지 않았다.
- 전체 `make check`는 프론트 내부 구조 변경에 대해 재실행하지 않았다. 서버/DB 경계는 변경하지 않았다.
- 실제 카메라 품질·장치 FPS·실제 모델 추론·새 특징 성능·데스크톱 EXE 재패키징은 별도 검증 대상이다.
