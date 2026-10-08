# Backend 작업 지도

루트 [AGENTS.md](../AGENTS.md)와 [아키텍처](../docs/architecture.md)를 먼저 따른다.

- 담당: 세션, 설정, 통계 API 및 필요한 추론 연결 어댑터.
- 자세 판정과 보정 로직을 중복 구현하지 않는다. 경계 입력은 [계약](../contracts/README.md)으로 검증한다.
- 실제 영상·랜드마크·식별 정보를 요청 로그에 남기지 않는다.
- API 구현 시 인증/세션 경계, 오류 응답, 만료·삭제 규칙을 명시하고 검증한다.
- 첫 구현 때 실행/API 검증 명령을 문서화하고 루트 게이트에 연결한다.
- 사용자 승인한 Java 21·Spring Boot API와 별도 Esper CEP는 [서비스 안내](README.md)와 [ADR 0011](../docs/decisions/0011-api-cep-boundary.md)를 따른다.
- API는 시간 판정을 중복하지 않는다. 실제 비교 조건은 CEP EPL에만 둔다. `make check-backend`와 루트 게이트로 합성 HTTP 흐름을 검증한다.
