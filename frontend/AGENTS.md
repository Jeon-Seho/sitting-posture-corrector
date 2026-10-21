# Frontend 작업 지도

루트 [AGENTS.md](../AGENTS.md)와 [아키텍처](../docs/architecture.md)를 먼저 따른다.

- 담당: 카메라 권한, 기준 등록 안내, 실시간 상태, 알림 전달, 통계 화면.
- [출력 계약](../contracts/README.md)으로 AI 결과를 소비한다. 모델 내부 좌표로 별도 자세 판정을 만들지 않는다.
- `unmeasurable`, 기준 미등록, 카메라 거부·끊김을 구분해서 보여준다.
- 신뢰도를 의학적 확률로 표현하지 않는다. 실제 영상을 기본 업로드하거나 보관하지 않는다.
- 첫 구현 때 실행/빌드/타입/주요 UI 흐름 검증을 문서화하고 루트 게이트에 연결한다.
- 앱은 React/TypeScript/Vite다. **앱은 항상 서버로 측정하고 판정하지 않는다**([ADR 0021](../docs/decisions/0021-app-sends-information-server-judges.md), [ADR 0025](../docs/decisions/0025-app-always-measures-on-server.md)). 점수·상태·알림·통계는 서버가 보낸 것만 쓴다. 로컬 판정·시간 정책을 다시 넣지 않는다.
- 자세 등록은 앱이 관절 9개 3초 평균을 내서 B1로 보낸다([ADR 0026](../docs/decisions/0026-baseline-average-by-app-b1.md)). 측정은 `src/features/session/live/`, 등록은 `src/features/baseline/`, 서버 요청은 `src/features/platform/api.ts`.
- 실행은 `make dev`, 검증은 `make check-frontend`.
