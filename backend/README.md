# 백엔드 — 세션·계정·판정 API

Java 17·Spring Boot 4.0.8·Gradle로 만든 API 하나다([ADR 0020](../docs/decisions/0020-single-api-decision-engine.md), [ADR 0023](../docs/decisions/0023-backend-java17-boot4-gradle.md)).
현재 프론트 특징 v2 유지 범위는 [ADR 0022](../docs/decisions/0022-db-v23-feature-v2-integration.md)를 따른다.
DB는 MySQL [스키마 V2.3](../database/README.md)만 쓴다. 현재 점수는 FastAPI `POST /v2/infer`가 만들고,
붕괴·회복·재알림 시간 판정은 API 안의 판정 엔진이 한다. 학습된 LSTM, 미래 예측, 사용자별 재학습은 구현하지 않았다.

## 코드 구조

```text
backend/api/src/main/java/org/posegood/api/
├── ApiApplication.java
├── common/     # 오류 응답 {error,code,message}, KST 시각 변환, JSON·SHA-256
├── contract/   # 경계 계약 record (특징 입력 v2, 관측 v2, 사건·조회 v1, 세션 요청)
├── engine/     # 판정 엔진: SessionEngine(순서·누락·중복), Timeline(시간 누적),
│               # EpisodeLedger(사건·통계), DecisionRules(정책 임계 비교 — 이곳에만 있다)
├── policy/     # threshold_policy 찾기·추가 (행은 고치지 않는다)
├── account/    # 가입·로그인·CSRF·비밀번호·탈퇴(30일 유예, 철회, 일괄 삭제)
├── session/    # 세션 생성·특징·종료·삭제, 진행 중 상태(LiveSessions), FastAPI 호출, DB 기록
├── workspace/  # 설정(user_account + threshold_policy), 앱 기록 검증·세션 테이블에서 다시 만들기
├── realtime/   # /v1/realtime WebSocket
└── system/     # /health, 시작 시 스키마 V2.3 확인
```

흐름: `SessionController`·`RealtimeHandler` → `SessionService` → `InferenceClient`(FastAPI) → `SessionEngine` → `SessionRepository`(MySQL).
세션 하나의 요청은 세션 잠금 안에서 차례로 처리한다(추론 호출 포함). 판정 결과는 처리 직후 DB에 쓰고 실시간 채널로 보낸다.

## 진행 중 상태와 DB

V2.3에는 관측·스냅샷 테이블이 없다(CR-04). 그래서 진행 중 세션의 판정 상태는 API 메모리에 있다.

| 시점 | DB에 쓰는 것 |
| --- | --- |
| 가입·동의 | 계정+필수 5종/선택 동의를 한 트랜잭션으로 저장. 선택 철회 시 나이·직업을 NULL로 비움 |
| 기준 등록 | `POST /v2/baselines`로 이력 행 추가. 등록 시각·좌표가 같은 재시도는 기존 행 반환 |
| 세션 생성 | 계정의 현재 정책·기준 FK·알림 설정을 `monitor_session`에 고정 |
| 특징 처리 | 사건과 알림 시도 시각을 저장. 회복이면 `ended_at`·`recovered_at`, 중단이면 `ended_at` |
| 종료 | 종료 시각·`good_sec`, 제외 구간, 일별 통계를 한 번만 반영. 5분 이상 세션의 붕괴까지 시간 min/max 포함 |
| 상태를 잃은 종료 | 알 수 없는 전체 시간을 MISSING으로 제외, good=0. 일별 집계는 하지 않음 |
| 삭제 | 세션 행(하위 행 cascade). `feature_archive`가 있으면 409 |

- DB 쓰기에 실패하면 503이다. 판정 상태는 이미 반영됐으므로 같은 요청을 다시 보내면 남은 사건을 쓴다.
- API를 재시작하면 진행 중 세션의 상태는 사라진다. 행이 남은 세션은 `404 SESSION_LOST`로 알리고, 앱은 마지막 확인 요약을 기록으로 남긴다.
  그래서 API는 한 인스턴스로 실행한다. 종료된 세션 상태는 기록 저장 확인을 위해 30분 보관한다(`posegood.ended-session-retention`).
- 모든 `DATETIME(3)`은 KST다. JDBC 연결도 `connectionTimeZone=Asia/Seoul`이다. API 응답 시각은 UTC ISO-8601이다.
- 알림 시도는 `(monitor_session_id,event_seq,attempted_at)`으로 저장한다. 전달 여부·억제 사유 컬럼은 없다.
- 현재 앱 `alerts_on`은 `user_account.sound_alert_enabled`(기본 false)에 대응한다. 기준 등록·재조회는 평균 좌표를 정본으로 사용한다.
- 앱 기록은 따로 저장하지 않는다(V2.1에서 `client_record` 삭제). `GET /v2/records`는 닫힌 세션을 위 테이블에서 다시 만든다.
  사건 방향은 저장 칸이 없어 `unspecified`다([계약](../contracts/accounts.v2.md)).
- 비밀번호 변경·탈퇴는 그 사용자의 `SPRING_SESSION` 행을 지우고 열린 실시간 연결을 닫는다(V2.1에서 `auth_epoch` 삭제).

## API

모든 경로는 Nginx·Vite에서 `/api` 접두사를 떼고 전달된다. 계정·CSRF·소유권·오류 형식은 [계정·저장 API v2](../contracts/accounts.v2.md)을 따른다.

| 경로 | 역할 |
| --- | --- |
| `GET /v2/auth/csrf`, `POST /v2/auth/register`, `POST /v2/auth/login`, `GET /v2/auth/me`, `POST /v2/auth/logout` | 계정·로그인 |
| `PUT /v2/auth/password`, `DELETE /v2/auth/account` | 비밀번호 변경(모든 로그인 철회), 탈퇴 접수 |
| `POST /v2/auth/withdrawal/cancel` | 탈퇴 유예 중 철회(이메일·비밀번호) |
| `GET`·`PUT /v2/workspace`, `GET`·`POST /v2/records`, `DELETE /v2/records/{id}` | 설정·앱 기록 |
| `PUT /v2/sessions/{UUID}` | `{policy, baseline_id}`로 세션 생성. 현재 계정 정책·기준과 일치해야 함. 같은 값의 재시도는 멱등, 다른 값은 409 |
| `POST /v2/sessions/{UUID}/features` | 특징 입력 v2 → FastAPI → 판정. [특징 응답 v1](../contracts/feature-response.v1.schema.json) |
| `POST /v2/sessions/{UUID}/end` | `{end_ms}`로 종료. 같은 값은 멱등, 다른 값은 409 |
| `GET /v2/sessions/{UUID}`, `GET .../metadata`, `DELETE /v2/sessions/{UUID}` | 조회 v1, 시작·종료 시각·기준 ID, 삭제 |
| `POST /v2/baselines`, `GET /v2/baselines/current` | 독립 기준 등록·현재 기준 조회 |
| `PUT /v2/consents/optional-profile` | 선택 정보 동의·철회 |
| `GET /v1/realtime` (WebSocket) | 실시간 채널(아래) |
| `GET /health` | DB 연결 확인 |

### 판정 규칙

[ADR 0012](../docs/decisions/0012-session-timing-policy.md)와 [계약 설명](../contracts/README.md)을 따른다. 정책은 세션 생성 때 고정한다.

- 관측 점수가 `threshold` 이상이면 이탈 후보다. 후보가 연속으로 `hold_ms` 이상이면 `collapse_confirmed`(최초 알림),
  같은 사건에서 마지막 알림 뒤 `reminder_ms`가 지나고 계속 이탈이면 `reminder`, 기준 내 자세가 연속 `recovery_ms` 이상이면 `recovery_confirmed`다.
- 휴식·자리 비움·저품질·시간 공백·순번 누락은 열린 사건을 중단(`interrupted`)하고 연속 누적을 0으로 만든다. 정상이나 회복으로 바꾸지 않는다.
- 같은 sequence·같은 본문의 재시도는 처음 결과를 돌려준다. 다른 본문 중복, 역순·겹친 구간, 종료 후 입력은 409다. 세션당 10,000건까지 받는다(429).

### 실시간 채널

`/v1/realtime`은 [실시간 계약 v1 초안](../contracts/realtime/README.md)의 WebSocket 메시지를 Kafka 없이 처리한다.
세션 생성·종료·복구는 HTTP로 한다.

- 로그인 쿠키로 인증한다. 같은 출처 페이지만 허용한다(`posegood.realtime.allowed-origins`로 추가). 프록시는 원래 Host(포트 포함)를 넘긴다.
- `hello` → `last_event_id` 뒤 사건(`decision`)을 다시 보내고, `ack`·`progress`를 보낸다. 끝난 세션이면 `closed: ended`.
- `features`(1~30구간) → 구간마다 `observation`, 새 사건마다 `decision`(그 시점 요약 포함)과 알림 대상이면 `alert`, 묶음 끝에 `ack`·`progress`.
- 추론·DB 일시 장애는 `stalled`를 보내고 연결을 닫는다. 앱은 다시 연결해 확인받지 못한 구간을 다시 보낸다.
  로그인 없음은 `unauthorized`, 다른 사람 세션은 `not_owner`, 상태 없음·계약 위반은 `session_lost`다.
- HTTP로 종료하면 연결된 채널에 `session_ended` 사건, `progress`, `closed: ended`를 보낸다.
- 프론트는 `VITE_REALTIME_URL`(예: `ws://127.0.0.1:8080/api/v1/realtime`)을 지정하면 이 채널을 쓴다.

## 준비와 검증

JDK 17 이상, Python 3.9+, Node 24+가 필요하다(설치 목록: [requirements-front.txt](../requirements-front.txt)). Gradle은 설치하지 않아도 된다.
`backend/gradlew`(Gradle Wrapper 9.7.1)가 처음 실행할 때 Gradle을 받는다. 의존성은 Maven Central·PyPI에서 받는다.
`make` 명령(`tools/`)도 이 Wrapper를 부르며, 개인 설정이 섞이지 않도록 Gradle 홈을 `.cache/gradle`(Git 제외)로 따로 둔다. `POSEGOOD_GRADLE_HOME`으로 바꿀 수 있다.

```sh
make setup
make check-backend   # 단위 시험 → 실제 MySQL 통합 시험 → 실제 FastAPI HTTP smoke
```

`check-backend`의 MySQL은 다음 순서로 고른다. 없으면 실패하며 건너뛰지 않는다.

1. `POSEGOOD_TEST_MYSQL_PASSWORD` 또는 Git 제외 파일 `.cache/test-mysql-password`(로컬 loopback MySQL, 기본 `root`).
   `POSEGOOD_TEST_MYSQL_URL`(기본 `jdbc:mysql://127.0.0.1:3306/`)·`POSEGOOD_TEST_MYSQL_USER`로 바꿀 수 있다. 계정은 데이터베이스를 만들고 지울 수 있어야 한다.
2. 없으면 Docker로 Compose와 같은 MySQL 이미지 컨테이너를 잠시 띄운다.

시험은 `posture_service_it_<임의값>` 데이터베이스를 `schema_V2_3.sql`과 시드로 만들고 끝나면 지운다. 합성 계정·입력만 쓴다.
Gradle을 직접 실행할 때는 `-Pmysql-integration`이 실제 MySQL 시험을 켠다. Windows는 `backend\gradlew.bat`을 쓴다.

```sh
backend/gradlew -p backend build                        # 컴파일·단위 시험·JAR
backend/gradlew -p backend build -Pmysql-integration    # + 실제 MySQL (위 환경변수 필요)
```

JAR는 `backend/api/build/libs/session-api-0.1.0-SNAPSHOT.jar`다(Maven 때는 `backend/api/target/`).

수동 실행: API는 MySQL(`POSEGOOD_DATABASE_URL`·`_USER`·`_PASSWORD`, 기본 `127.0.0.1:3306/posture_service`)과
추론(`make dev-inference`, 127.0.0.1:8092)이 필요하다. `make dev-api`로 JAR를 실행한다.
`make dev-server`는 임시 DB·API·추론·계정 모드 프론트를 함께 띄우고 끝나면 DB를 지운다. 실제 배포는 [Compose 안내](../infra/README.md)를 따른다.

## 다음 결정

1. 다중 인스턴스: 진행 중 상태를 공유할 저장소(Redis 등)나 세션 고정 라우팅이 필요하다.
2. Kafka(계획 0022): 지금은 실시간 채널이 API 안에서 바로 처리한다. 토픽 전환 때 같은 메시지 계약을 쓴다.
3. 알림의 실제 표시 여부 전달(현재 DB에는 시도만 기록).
4. HDFS 특징 적재(`feature_archive`)와 탈퇴 때 파일 삭제.
