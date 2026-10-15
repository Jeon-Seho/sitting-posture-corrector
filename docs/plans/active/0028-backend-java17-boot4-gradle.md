# 백엔드 Java 17·Spring Boot 4.0.8·Gradle 전환

- 상태: in_progress (백엔드 완료, `backend/` 밖의 도구·이미지·CI는 담당 팀원 작업 대기)
- 담당: sunshine-yj 요청(백엔드·DB 담당), Claude 구현. `backend/` 밖은 각 담당 팀원
- 시작일: 2026-10-14
- 관련 요구사항/ADR: [ADR 0023](../../decisions/0023-backend-java17-boot4-gradle.md), [ADR 0020](../../decisions/0020-single-api-decision-engine.md), [백엔드 안내](../../../backend/README.md)

## 문제와 완료 기준

백엔드를 Java 21·Spring Boot 3.5.16·Maven에서 Java 17·Spring Boot 4.0.8·Gradle로 옮긴다. API 경로·계약·DB 스키마 V2.3은 바꾸지 않는다.
완료 기준: `backend/gradlew -p backend build`(단위 시험)와 `-Pmysql-integration`(실제 MySQL 통합 시험)이 통과하고,
`make check-backend`·`dev-server`·`check-browser`·`check-compose`·Compose 이미지 빌드가 새 빌드로 동작한다.

## 범위와 제외

백엔드 담당이 바꾼 것: `backend/` 전체와 버전을 언급하는 문서. `tools/`, `infra/`, `.github/`, `tests/`는 직접 바꾸지 않고
아래 「팀원 작업 요청」에 정리했다. 이 파일들은 여러 팀원이 함께 쓰므로 담당자가 반영한다.

## 백엔드에서 바꾼 것 (2026-10-14)

| 항목 | 이전 | 이후 |
| --- | --- | --- |
| 빌드 | `backend/pom.xml`, `backend/api/pom.xml`(Maven) | `backend/settings.gradle`, `backend/api/build.gradle`, Gradle Wrapper 9.7.1(`backend/gradlew`, `gradlew.bat`, `gradle/wrapper/`) |
| Java | 21 | 17 (Gradle toolchain) |
| Spring Boot | 3.5.16 | 4.0.8 (Spring Framework 7, Security 7, Session 4.0.5, Tomcat 11) |
| JSON | Jackson 2 (`com.fasterxml.jackson.*`) | Jackson 3 (`tools.jackson.*`). 어노테이션 패키지는 그대로 |
| 산출물 | `backend/api/target/session-api-0.1.0-SNAPSHOT.jar` | `backend/api/build/libs/session-api-0.1.0-SNAPSHOT.jar` (이름 같음, 위치만 다름) |
| 실제 MySQL 시험 | `mvn -f backend/pom.xml -Pmysql-integration verify` | `backend/gradlew -p backend build -Pmysql-integration` (환경 변수는 같음) |

코드 변경:

- Boot 4 모듈 분리: `spring-boot-starter-webmvc`, `-session-jdbc`, `-restclient`(추론 호출 `RestClient.Builder`가 없으면 시작 실패), 시험용 `-webmvc-test`.
- Jackson 3: 패키지 이름, `JsonProcessingException`→`JacksonException`, `JsonDeserializer`→`ValueDeserializer`, `@JsonComponent`→`@JacksonComponent`, `fieldNames()`→`propertyNames()`.
- 동작 보존 두 가지(ADR 0023 4항): 중복 키 거부를 `common/JsonConfiguration`으로 다시 켬, 클라이언트 입력은 Jackson 2와 같은 값을 주는 `Json.text()`로 읽음.
  둘 다 `common/JsonTest` 단위 시험이 있다.
- Java 17: `getFirst()/getLast()` → `get(0)/get(size-1)`, 시험의 `ExecutorService` try-with-resources → `shutdown()`·`awaitTermination()`.
- DB: 변경 없음. Spring Session JDBC 4.0.5의 MySQL 테이블 정의와 스키마 V2.3의 `SPRING_SESSION` 컬럼이 같다.

## 팀원 작업 요청 (`backend/` 밖)

아래 2·3·4의 남은 항목이 반영되기 전까지 `check-compose`, Compose 이미지 빌드, CI(`harness.yml`)는 Maven·`backend/pom.xml`·`target/` 경로를 찾다가 실패한다.
`make check-backend`·`dev-api`·`dev-server`·`check-browser`·`benchmark-server`는 1의 반영으로 Gradle Wrapper를 쓴다.

### 1. 개발 도구 (`tools/`) — 2026-10-14 반영 완료(사용자 요청으로 백엔드 담당이 직접 수정)

- [x] `tools/runtime.py`: `maven_executable()`을 `gradle_executable()`(`backend/gradlew`, Windows `gradlew.bat`)과
  `gradle_command()`(`--no-daemon --console=plain --gradle-user-home .cache/gradle -p backend ...`)로 바꿨다.
  `service_jar()`는 `backend/<component>/build/libs/`를 가리킨다. 안내 문구는 Java 17.
- [x] `tools/dev_tasks.py`: `maven()` → `gradle()`. `check-backend`는 `build` → (임시 MySQL) `build -Pmysql-integration` → HTTP smoke.
  프론트 명령(`check-frontend`, `dev`)은 바꾸지 않았다.
- [x] `tools/compose_smoke.py`의 `mysql_integration()`: 같은 Gradle 명령으로 실제 MySQL 시험을 돌린다.
- [x] `tools/maven-settings.xml` 삭제. 개인 설정 배제는 저장소 전용 Gradle 홈(`.cache/gradle`, Git 제외)이 맡는다.
  `POSEGOOD_MAVEN_CACHE`는 `POSEGOOD_GRADLE_HOME`으로 바뀌었다.
- [x] `backend/api/build.gradle`: `-Pmysql-integration`일 때 시험 결과를 재사용하지 않게 했다(DB 환경 변수는 Gradle이 추적하지 않음).

### 2. Docker 이미지 (`infra/docker/java.Dockerfile`) — 담당: 배포·인프라 담당

- [ ] 빌드 단계 `maven:3.9.16-eclipse-temurin-21` + `mvn -B -f backend/pom.xml -DskipTests package` →
  JDK 17 이미지(예: `eclipse-temurin:17-jdk-jammy`)에서 `cd backend && ./gradlew --no-daemon bootJar`.
  Wrapper가 처음에 `services.gradle.org`에서 Gradle 9.7.1을 받으므로 빌드 환경이 이 주소에 접근할 수 있어야 한다.
- [ ] 실행 단계 `eclipse-temurin:21-jre-jammy` → `eclipse-temurin:17-jre-jammy`.
- [ ] JAR 복사 경로 `/source/backend/api/target/...` → `/source/backend/api/build/libs/session-api-0.1.0-SNAPSHOT.jar`.

### 3. CI (`.github/workflows/harness.yml`) — 담당: CI 담당

- [ ] `actions/setup-java`의 `java-version: '21'`(33행) → `'17'`. Maven 캐시를 쓰고 있다면 Gradle 캐시(`cache: gradle` 또는 `gradle/actions/setup-gradle`)로 바꾼다.

### 4. Python 시험 (`tests/`) — 담당: 개발·검증 도구 담당

- [x] `tests/test_deploy_configuration.py`(316~336행): 1과 함께 Gradle 명령 기대값으로 바꿨다(이 시험이 1의 명령을 고정하므로 같이 고치지 않으면 `make test`가 실패한다).
- [ ] `tests/test_service_contracts.py`(57행): `backend/`의 `pom.xml`에서 Esper 의존성이 없는지 본다. 이제 `pom.xml`이 없어 검사가 아무것도 확인하지 않는다.
  `backend/**/build.gradle`과 `settings.gradle`을 보도록 바꾼다.
- `tests/test_server_benchmark.py`(242행)의 `backend/api/target/example.java`는 비공개 경로 거부 예시라 바꾸지 않아도 된다.

### 5. 설치 안내 (프론트 포함 모든 팀원)

- JDK는 17이면 된다. Maven은 설치하지 않아도 된다(Wrapper가 Gradle을 받는다). `JAVA_HOME`은 JDK 17 이상을 가리켜야 한다.
- `requirements-front.txt`, `README.md`, `docs/development.md`, `docs/design/fe-commands-and-checks.md`의 안내는 이 계획과 함께 고쳤다.

## 작업 단계

- [x] Gradle 빌드·Wrapper, Java 17, Spring Boot 4.0.8, Jackson 3 전환(`backend/`)
- [x] 동작 보존(중복 키 거부, 입력 글자 변환)과 단위 시험 추가
- [x] 버전을 언급하는 현재 문서 갱신, ADR 0023
- [ ] 실제 MySQL 통합 시험(`-Pmysql-integration`) 실행
- [x] 개발 도구 1과 결합된 시험(4의 첫 항목) 반영
- [ ] 실제 MySQL로 `make check-backend`·`check-browser` 확인
- [ ] 팀원 작업 2·3·4(남은 항목) 반영 후 `check-compose`·Compose 빌드·CI 확인

## 결정과 진행 기록

- 2026-10-14: Groovy DSL(`build.gradle`)을 썼다. Spring Initializr의 Gradle 기본 형식과 같다.
  Gradle 9.7.1은 이 PC에 이미 받아 둔 배포본과 같은 버전이며 Spring Boot 4.0.x Gradle 플러그인이 지원한다.
- Jackson 2 호환 모듈(`spring-boot-jackson2`)은 Boot 4에서 폐기 예정이라 쓰지 않고 Jackson 3으로 옮겼다.
- 과거 계획·감사 문서의 "JDK 21·Maven" 기록은 당시 사실이므로 고치지 않았다.

## 검증 결과와 남은 한계

- 2026-10-14, Windows 10, JDK 17.0.20, Gradle 9.7.1(Wrapper):
  `backend/gradlew -p backend build` 통과. 시험 47개 중 40개 통과, 0 실패, 7개 건너뜀(`MySqlIntegrationTest`, MySQL 필요).
  새 `JsonTest` 3개 포함. 컴파일 시 폐기 예정 API 경고 0개(`-Xlint:deprecation,removal`로 확인).
- JAR를 DB 없이 실행해 Spring 컨텍스트 전체(보안·세션·WebSocket·Jackson·RestClient)가 올라오고 MySQL 연결 단계에서만 멈추는 것을 확인했다.
- 실행하지 못한 것: 실제 MySQL 통합 시험 7개(Docker 데몬 꺼짐, 로컬 MySQL 설정 없음), HTTP smoke, 브라우저·Compose 검증(도구가 아직 Maven 사용).
  Spring Security 7·Spring Session 4의 실제 로그인·CSRF·세션 저장 동작은 통합 시험으로 확인해야 한다.
- 2026-10-14 개발 도구 반영 뒤: `python tools/dev.py test` 140개 통과·1 건너뜀(`test_deploy_configuration` 23개 포함).
  `dev_tasks.gradle("build")`로 저장소 전용 Gradle 홈에 Gradle 9.7.1을 받아 빌드 성공, `service_jar()`가 `build/libs`의 JAR를 찾음.
  MySQL이 필요한 `check-backend` 후반·`check-browser`는 Docker 데몬이 꺼져 있어 실행하지 못했다.
