# ADR 0023: 백엔드를 Java 17·Spring Boot 4.0.8·Gradle로 전환

- 상태: accepted
- 날짜: 2026-10-14
- 근거: 사용자(백엔드·DB 담당) 요청 「현재 백엔드를 Java 17 · Spring Boot 4.0.8 · gradle로 변경」
- 범위: `backend/`. 이전 스택(Java 21·Spring Boot 3.5.16·Maven, [ADR 0020](0020-single-api-decision-engine.md) 1항)을 대체한다.
- 진행·팀원 전달 사항: [계획 0028](../plans/active/0028-backend-java17-boot4-gradle.md)

## 결정

1. **빌드는 Gradle Wrapper다.** `backend/gradlew`(Gradle 9.7.1), `backend/settings.gradle`, `backend/api/build.gradle`.
   `backend/pom.xml`·`backend/api/pom.xml`은 지웠다. 산출물 이름은 그대로 `session-api-0.1.0-SNAPSHOT.jar`이고 위치만
   `backend/api/target/`에서 `backend/api/build/libs/`로 바뀐다. 실제 MySQL 시험 스위치는 Maven과 같은 `-Pmysql-integration`이다.
2. **Java 17로 컴파일한다**(Gradle toolchain 17). Java 21 전용 API(`List.getFirst/getLast`, `ExecutorService`의 try-with-resources)는 Java 17 문법으로 바꿨다.
3. **Spring Boot 4.0.8**(Spring Framework 7, Spring Security 7, Spring Session 4, Tomcat 11)로 올린다.
   - Boot 4의 모듈 분리에 맞춰 `spring-boot-starter-webmvc`, `-session-jdbc`, `-restclient`(추론 호출의 `RestClient.Builder`), `-webmvc-test`를 쓴다.
   - JSON은 Boot 4 기본인 **Jackson 3**(`tools.jackson.*`)이다. Jackson 2 호환 모듈(`spring-boot-jackson2`)은 쓰지 않는다.
4. **API 동작은 바꾸지 않는다.** 경로·요청/응답 계약·DB 스키마 V2.3은 그대로다. Jackson 3 전환으로 생긴 차이는 다음처럼 막았다.
   - 같은 키가 두 번 나오는 JSON 거부: 예전 설정 `spring.jackson.parser.strict-duplicate-detection`이 Boot 4에서 폐기되어
     `common/JsonConfiguration`에서 `StreamReadFeature.STRICT_DUPLICATE_DETECTION`을 켠다.
   - Jackson 3의 `asText()`/`asString()`은 객체·배열에서 예외를 던져 형식 오류가 400 대신 500이 될 수 있다.
     클라이언트 입력은 Jackson 2의 `asText()`와 같은 값을 돌려주는 `Json.text()`로 읽는다.
5. **DB는 바꾸지 않는다.** Spring Session JDBC 4.0.5의 MySQL 테이블 정의는 스키마 V2.3의 `SPRING_SESSION`·`SPRING_SESSION_ATTRIBUTES` 컬럼과 같다.

## 결과

- 백엔드 단위 시험은 Java 17·Gradle로 통과한다. 실제 MySQL 통합 시험은 MySQL(로컬 또는 Docker)이 있어야 한다.
- 로그인 세션 속성은 Java 직렬화로 DB에 저장된다. Spring Security 버전이 바뀌었으므로 업그레이드 전에 만든 로그인 세션은 다시 로그인해야 할 수 있다.
- 개발 도구(`tools/runtime.py`·`dev_tasks.py`·`compose_smoke.py`)는 같은 날 Gradle Wrapper와 `build/libs/` 경로로 바꿨다(사용자 요청).
  `tools/maven-settings.xml`의 역할(개인 설정 배제)은 저장소 전용 Gradle 홈(`.cache/gradle`)이 맡는다.
- Docker 이미지(`infra/docker/java.Dockerfile`)와 CI(`.github/workflows/harness.yml`)는 아직 Maven·Java 21이다. 담당 팀원 작업으로
  [계획 0028](../plans/active/0028-backend-java17-boot4-gradle.md)에 정리했다. 그 전까지 `check-compose`·Compose 이미지 빌드·CI는 실패한다.
