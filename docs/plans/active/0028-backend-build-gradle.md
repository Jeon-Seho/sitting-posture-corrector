# 백엔드 빌드를 Maven에서 Gradle로 (팀과 같은 도구)

- 상태: planned (팀 Gradle 구성 확인 대기)
- 담당: FE(klaod-tech)가 계획, 빌드 파일·도구 변경은 BE·DevOps와 함께
- 시작일: 2026-10-14
- 관련: [FE 명령과 검사](../../design/fe-commands-and-checks.md), [ADR 0011](../../decisions/0011-api-cep-boundary.md)(Java 21·Spring Boot 3.5.16·Maven 고정),
  [백엔드 안내](../../../backend/README.md), [설치 목록](../../../requirements-front.txt)

## 배경

PM·DB(BE)가 10/14에 팀은 Gradle을 쓴다고 했다. 이 저장소의 `make check`는 Maven으로 백엔드를 빌드한다.
FE는 Maven 때문에 `make check`가 계속 실패한다고 의심했다. 아래 원인 분석으로 확인했다.

## 원인 분석 (2026-10-14, Windows 노트북, `lee_app3` `fd1c4a7`)

`make check` = ① `check-repo` → ② `test` → ③ `check-frontend` → ④ `check-backend` → ⑤ `check-browser` → ⑥ `check-compose`.

| 단계 | 결과 | 원인 | Maven 탓인가 |
|---|---|---|---|
| ④ `check-backend` (Maven `verify`) | **통과.** Java 시험 59개, 실패 0, 14개 건너뜀(MySQL 없음). 서비스 왕복 PASS | — | 아니다 |
| ⑤ `check-browser` | **실패.** 첫 단계 `camera-preview.mjs`의 `picker.options.length`에서 `TypeError` | 10/14 `9f3bc92`(lellon0403)가 자세 데이터 수집 화면의 기본 `<select id="capture-task">`를 앱 모양 `SelectMenu`로 바꿨다. 시나리오는 아직 `<select>`의 `options`를 읽는다. 그 전(10/13)에는 "first episode confirms at exactly 3 seconds" 항목이 실패했다(원인 미확인) | 아니다 |
| ⑥ `check-compose` | **실패.** 이 PC는 Docker 데몬이 꺼져 있어 돌리지 못했다. 데몬이 있어도 실패한다 | `infra/mysql/initdb/10-posegood-schema.sh`가 지워진 `schema_V1_1.sql`을 찾는다(`database/schema`에는 V2_2·V2_3만). 계정 브라우저 시나리오는 지운 계정 모드(`VITE_SERVER_ACCOUNTS`)를 쓴다 | 아니다 |
| CI (`.github/workflows/harness.yml`) | ⑤·⑥ 때문에 실패 | `make check` 전체를 돌린다. `setup-java`만 있고 Maven은 러너에 깔린 것을 쓴다 | 아니다 |

**결론: 지금 `make check` 실패는 Maven 때문이 아니다.** 실패는 화면이 바뀌었는데 브라우저 시나리오를 고치지 않은 것(⑤)과 DB V2.3·계정 모드 제거를 Compose가 따라가지 못한 것(⑥)에서 온다.
Gradle로 바꿔도 이 실패는 그대로다. 그래도 바꾸는 이유는 팀과 같은 도구를 써서 BE 코드가 들어올 때 빌드가 갈라지지 않게 하는 것이다.

앞으로 실패할 수 있는 곳: BE 브랜치(`feature/repo-backend-db-v2`)는 API가 MySQL 없이 시작하지 않는다(ADR 0020). 그 코드가 develop에 들어오면 ④·⑤도 임시 MySQL이 필요하다. 이것도 빌드 도구와는 따로 풀어야 한다.

## 문제와 완료 기준

- `backend/`가 팀과 같은 Gradle 구성(같은 버전, 같은 DSL, wrapper 포함)으로 빌드된다.
- `python tools/dev.py check-backend`, `check-browser`, `check-compose`, Docker 이미지, CI가 Maven 없이 돈다.
- Maven 파일(`pom.xml` 4개, `tools/maven-settings.xml`)과 문서의 Maven 안내가 남지 않는다.
- 만들어지는 JAR 이름·위치를 도구가 그대로 찾는다(지금 `backend/<모듈>/target/<이름>-0.1.0-SNAPSHOT.jar`).

## 먼저 팀에 확인할 것

- [ ] Gradle 코드가 어느 브랜치·레포에 있는지(10/14 기준 원격 9개 브랜치·전체 기록에 Gradle 파일 없음)
- [ ] Gradle 버전, Groovy/Kotlin DSL, wrapper(`gradlew`) 커밋 여부, 버전 카탈로그 사용 여부
- [ ] 기존 Maven 모듈(`contracts`·`cep`·`api`)도 옮기는지, 새 서버(입출구·처리·추론, BE 명세 9장 #1 D-50)만 Gradle인지
- [ ] 빌드 결과 JAR 이름(`bootJar` 이름)과 시험 분리 방식(지금 MySQL 시험은 Maven 프로필 `mysql-integration`)
- [ ] 바꾸는 사람: 빌드 파일은 BE, `tools/`·Docker·CI는 DevOps, FE 문서는 FE

## 범위와 제외

바꾸는 곳(10/14 기준 Maven을 직접 쓰는 곳):

| 종류 | 파일 | 바꿀 내용 | 담당 |
|---|---|---|---|
| 빌드 | `backend/pom.xml`, `backend/{contracts,cep,api}/pom.xml` | `settings.gradle(.kts)`, 모듈별 `build.gradle(.kts)`, `gradlew`·`gradle/wrapper/`. Spring Boot 3.5.16, Java 21 toolchain, Esper 9.0.0 그대로 | BE |
| 도구 | `tools/runtime.py` `maven_executable()`·`service_jar()` | `gradlew`(Windows는 `gradlew.bat`) 경로, JAR 위치 `build/libs/` | DevOps |
| 도구 | `tools/dev_tasks.py` `check_backend()` | `gradlew --no-daemon -p backend build`(`verify` 대신). 캐시 `GRADLE_USER_HOME=.cache/gradle` | DevOps |
| 도구 | `tools/compose_smoke.py` | MySQL 시험을 Gradle 태스크(예: `:api:mysqlIntegrationTest`)로 | DevOps |
| 도구 | `tools/maven-settings.xml` | 지운다(공개 저장소만 쓰는 설정은 `settings.gradle`의 `repositories`로) | DevOps |
| 시험 | `tests/test_deploy_configuration.py`(313~333행 Maven 명령 검사) | Gradle 명령으로 | DevOps |
| 배포 | `infra/docker/java.Dockerfile` | `FROM gradle:<버전>-jdk21` 또는 wrapper, `COPY` 경로를 `build/libs/`로 | DevOps |
| CI | `.github/workflows/harness.yml` | `gradle/actions/setup-gradle` 추가(캐시) | DevOps |
| 문서 | `README.md`, `backend/README.md`, `infra/README.md`, `requirements-front.txt`, ADR 0011 | Maven 안내를 Gradle로. ADR 0011은 새 ADR로 대체 기록 | BE·FE |
| 문서 | [FE 명령과 검사](../../design/fe-commands-and-checks.md) ④·「빌드 도구」 | Gradle 명령과 필요한 것 | FE |

제외: ⑤ 브라우저 시나리오와 ⑥ Compose 실패 수정(원인이 다르다, 아래 「같이 고칠 것」), Java 코드 변경, 프론트.

## 작업 단계

- [ ] 팀 Gradle 구성 확인(위 「먼저 팀에 확인할 것」)
- [ ] BE: Gradle 빌드 파일과 wrapper를 추가하고 Maven과 같은 시험 수(59개, MySQL 14개 분리)가 도는지 비교
- [ ] DevOps: `tools/`·시험·Dockerfile·CI를 Gradle로. JAR 경로 한 곳(`service_jar()`)만 바꾸면 되게 둔다
- [ ] 두 도구가 같은 결과인지 확인한 뒤 `pom.xml`·`maven-settings.xml` 삭제
- [ ] 문서 동기화, ADR 0011 대체 ADR 작성
- [ ] `check-backend`, `check-browser`, `check-compose`, `docker compose build`, CI 실행과 결과 기록

## 같이 고칠 것 (Gradle과 별개, `make check` 실패의 실제 원인)

| # | 실패 | 고칠 곳 | 담당 |
|---|---|---|---|
| G1 | ⑤ `capture-task`가 `SelectMenu`로 바뀜 | `tools/browser/camera-preview.mjs`(그리고 `scenarios.mjs`의 같은 선택)를 새 목록 상자 조작으로 | 수집 화면 담당(lellon0403)·FE |
| G2 | ⑤ 첫 사건 3초 확정 항목 | 원인 조사(develop 흐름) | FE |
| G3 | ⑤ 재연결 항목 | ADR 0022(끊기면 세션 종료)에 맞춰 시나리오 수정 | FE |
| G4 | ⑥ `schema_V1_1.sql` 없음 | 초기화 스크립트를 `schema_V2_3.sql`로(DB 브랜치 병합과 함께) | DB·DevOps |
| G5 | ⑥ 계정 브라우저 시나리오 | 지운 계정 모드 대신 새 가입 화면(`features/auth/`)으로, 또는 서버 계정 연결 뒤 다시 | FE·DevOps |

## 결정과 진행 기록

- 2026-10-14: 원인 분석. Maven `check-backend`는 통과했다. `make check` 실패는 ⑤·⑥이고 Maven과 무관하다. 그래도 팀 도구와 맞추려고 Gradle 전환을 계획한다. 팀 구성을 확인하기 전에는 빌드 파일을 바꾸지 않는다.

## 검증 결과와 남은 한계

- 실행: `python tools/dev.py check-backend` → 통과(`BUILD SUCCESS`, Java 59개 중 14개 건너뜀, 서비스 왕복 PASS).
- 실행: `python tools/dev.py check-browser` → 실패(`camera-preview.mjs` `TypeError`, 위 G1).
- 못 돌림: `check-compose`(Docker 데몬 꺼짐). 실패 이유는 코드로 확인했다(G4·G5).
