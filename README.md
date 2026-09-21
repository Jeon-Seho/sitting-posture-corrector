# sitting-posture-corrector · PoseGood

웹캠 기반 개인 기준 자세 변화 알림 프로토타입. 기존 `feature/retro-redesign` 프론트에 실제 웹캠을 통합했다.
React 18과 레트로 디자인·6개 화면을 유지하며, 실제 웹캠/발표용 합성 시연 중 선택할 수 있다.
현재는 **MediaPipe + 개인 기준 비교 규칙**이며 LSTM·Spring Boot·DB·실제 인증은 연결되지 않았다.

## 실행

Node.js 24 이상, Python 3.9 이상에서:

```sh
make setup
make dev
```

[로컬 화면](http://127.0.0.1:5173/) → 로그인 → 측정 준비 → 카메라 켜기 → 5초 기준 등록 → 측정 시작.
실제 로그인 정보는 필요 없다. 웹캠 권한을 지원하는 브라우저에서 실행한다.

## 동작

- 기본 3초 지속 후 이벤트·화면 알림, 60초 재알림 간격, 2초 정상 복귀 확인
- 휴식·측정 불가는 유효 시간에서 제외하고 연속 이벤트를 끊음
- 설정에서 시간·임계값·알림 여부 변경 가능 (모델 재학습 불필요)
- 측정 종료 화면에서 이번 세션의 유지율·이벤트·발생 간격·회복 시간 확인
- 영상·음성 저장/업로드 없음. 명시적 라벨 수집은 좌표 CSV로 다운로드하며 세션 통계와 분리됨
- 홈·대시보드는 발표용 예시 기록. 실제 웹캠 기록과 연결되지 않음

## 파일럿 수집

측정 화면 아래의 수집 패널에서 수동 라벨을 붙여 CSV로 내려받는다. 영상은 저장하지 않는다.
[수집 방법과 pandas 분석](docs/research/pilot-csv.md)을 참고한다. 화면에 실제 추적 FPS·추론 시간이 표시된다.

## 구조와 개발

- [프론트 실행·사용·제약](frontend/README.md)
- [문서 지도](docs/index.md), [작업 지침](AGENTS.md), [개발 흐름](docs/development.md)
- [기존 디자인](DESIGN.md), [제품 방향](PRODUCT.md)
- [출력 계약](contracts/README.md), [연구 프로토콜](docs/research/protocol.md)
- `frontend/src/lib/engine.ts`: 웹캠·시연 공통 세션 정책
- `model/prototype/pose.ts`: 품질·정규화·개인 기준 비교

검증: `make check` (문서/구조, Python 계약 회귀, 프론트 상태 전이·특징 테스트, 타입 검사, 빌드).
