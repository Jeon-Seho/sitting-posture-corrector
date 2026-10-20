# Backend 작업 지도

루트 [AGENTS.md](../AGENTS.md)와 [아키텍처](../docs/architecture.md)를 먼저 따른다.

- 담당: 계정·설정·세션·기록 API, 붕괴·회복·재알림 시간 판정, FastAPI 추론 연결, 실시간 채널.
- 구조와 실행은 [서비스 안내](README.md)와 [ADR 0020](../docs/decisions/0020-single-api-decision-engine.md)를 따른다.
- 정책 임계 비교는 `engine/DecisionRules.java`에만 둔다. 다른 곳에서 시간 판정을 다시 구현하지 않는다.
- 자세 분류·개인 보정은 `model/`의 책임이다. 경계 입력은 [계약](../contracts/README.md)으로 검증한다.
- DB 정본은 `database/`(스키마 V2.3)다. API는 테이블을 만들거나 바꾸지 않는다.
- 실제 영상·랜드마크·특징 값·식별 정보를 로그에 남기지 않는다. 오류 응답에 입력 값을 넣지 않는다.
- 변경 후 `make check-backend`(단위 → 실제 MySQL → HTTP smoke)로 검증한다. MySQL이 없다고 건너뛰지 않는다.
- 백엔드 동작·API·DB 사용을 바꾸면 같은 커밋에서 [개발 상태](../docs/backend-status.md)를 갱신한다.
