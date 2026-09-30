# ADR 0011: 입력 API와 Esper 시간 판정 분리

- 상태: accepted (사용자 승인한 작은 개발 흐름)
- 날짜: 2026-09-30

Spring Boot API는 입력·저장·조회, 별도 Esper CEP는 붕괴·회복·재알림 시간 조건,
FastAPI는 현재 자세 추론 점수를 담당한다. API에서 같은 시간 판정을 중복하지 않는다.
Java 21·Spring Boot 3.5.16·Esper 9.0.0·Maven을 고정한다. Python 3.9 호환 FastAPI 경계를 별도 제공한다.
공식 런타임/의존성만 사용하며 기존 프론트는 실제 특징 전송 없이 로컬 모드를 유지한다.

새 관측 v2는 추론의 duration 필드를 제거하고 세션 상대 구간/sequence/유효성/추론 점수를 전달한다.
CEP 사건 v1과 조회 snapshot v1을 추가하고 기존 상태 v1은 보존한다.
세션별 설정을 고정하고 중복/역순/누락·종료 및 의존성 장애를 명시적으로 처리한다.

통계의 붕괴 간격은 같은 측정 세션 내 유효 시간 축에서만 계산하고 휴식·자리 비움·측정 불가·누락을 제외한다.
새 로컬 기록은 발생점의 유효 시간도 보관한다. 과거 기록의 알려지지 않은 제외 시간은 복원한 척하지 않는다.

기본 붕괴 3초/재알림 60초와 커스텀 값을 유지한다. 복귀 2초는 기존 임시값이다.
알림 휴식 정책은 기존 중단/reset 동작을 `legacy-interrupt-v1`로 이름 붙여 보존하며 최종 결정으로 취급하지 않는다.
휴식 제외 통계 결정으로 타이머 freeze/resume 정책을 임의로 도입하지 않는다.

현재 메모리 저장과 합성 규칙 추론은 외부 DB·계정·실제 LSTM·학습/수집을 대체하지 않는다.
Kafka/Redis/HDFS/Spark는 역할·신뢰성·보관 계약 합의 후 단계별 도입한다.
구현과 실행/검증은 [서비스 안내](../../backend/README.md)를 따른다.
기술 근거: [Spring Boot 요구사항](https://docs.spring.io/spring-boot/3.5/system-requirements.html),
[Esper](https://www.espertech.com/esper/esper-downloads/), [Maven](https://maven.apache.org/download.cgi),
[FastAPI 테스트](https://fastapi.tiangolo.com/tutorial/testing/).
