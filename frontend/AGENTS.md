# Frontend 작업 지도

루트 [AGENTS.md](../AGENTS.md)와 [아키텍처](../docs/architecture.md)를 먼저 따른다.

- 담당: 카메라 권한, 기준 등록 안내, 실시간 상태, 알림 전달, 통계 화면.
- [출력 계약](../contracts/README.md)으로 AI 결과를 소비한다. 모델 내부 좌표로 별도 자세 판정을 만들지 않는다.
- `unmeasurable`, 기준 미등록, 카메라 거부·끊김을 구분해서 보여준다.
- 신뢰도를 의학적 확률로 표현하지 않는다. 실제 영상을 기본 업로드하거나 보관하지 않는다.
- 첫 구현 때 실행/빌드/타입/주요 UI 흐름 검증을 문서화하고 루트 게이트에 연결한다.
- 현재 로컬 프로토타입은 React/TypeScript/Vite다. [ADR 0002](../docs/decisions/0002-webcam-prototype.md)를 따른다.
- 실행은 `make dev`, 검증은 `make check-frontend`. 특징·분류는 `model/prototype/`, 웹캠·시연 공통 시간 정책은 기존 `src/lib/engine.ts`에 둔다. [ADR 0003](../docs/decisions/0003-retro-integration.md)의 통합 예외를 따른다.
