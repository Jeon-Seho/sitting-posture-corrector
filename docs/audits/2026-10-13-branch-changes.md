# feature/repo-backend-db-v2 변경 분석 (2026-10-13)

- 비교 기준: `origin/develop`(`fa793ba`, DB V2.3 #40) ↔ 이 브랜치 `HEAD`(`abaaf61`, develop 병합 커밋)
- 범위: ① 커밋된 변경(develop 대비) ② 아직 커밋하지 않은 작업 트리 변경(2026-10-13 작성 시점)
- 관련 문서: [ADR 0020](../decisions/0020-single-api-decision-engine.md), [계획 0026 백엔드 재작성](../plans/active/0026-backend-v2-rebuild.md),
  [백엔드 V2 현황](2026-10-10-backend-v2-status.md), [백엔드 안내](../../backend/README.md)

## 1. 한눈에 보기

| 항목 | 내용 |
| --- | --- |
| 핵심 변경 | 백엔드를 **API + Esper CEP + 공용 계약(3개 모듈)** 에서 **Spring Boot API 하나**로 다시 만들었다. 시간 판정은 API 안의 순수 Java 판정 엔진이 한다 |
| 규모(커밋, develop 대비) | 191개 파일, +6,792 / −8,115줄. 그중 `backend/`가 127개 파일(+5,647 / −7,193) |
| 파일 상태 | 추가 42, 삭제 68, 수정 70, 이름 변경 11 |
| DB | 병합 후 `database/`는 develop(V2.3)과 **같다**. 이 브랜치만의 DB 변경은 남지 않았다 |
| 현재 커밋의 동작 | 백엔드는 옛 V2.2(`user_account.alert_enabled`)를 전제로 해서 **develop의 DB로는 API가 시작하지 않는다**(4장) |
| 커밋 전 작업 | 백엔드·프론트를 DB V2.3에 맞추는 작업(계획 0025, ADR 0022)이 작업 트리에 진행 중이다. 83개 파일(5장) |
| 원격 | 로컬이 `origin/feature/repo-backend-db-v2`보다 53커밋 앞섬(push 전) |

## 2. 커밋 이력

| 커밋 | 날짜 | 내용 |
| --- | --- | --- |
| `7606c4b` feat(db) | 10-10 | 스키마 V2.2 반영(ERD V2.2, migration 011 `alert_enabled`). develop의 #35와 같은 내용이며 develop에서는 #38로 되돌렸다. 병합 때 develop(V2.3) 쪽을 택해 결과에 남지 않는다 |
| `fcc8ef7` feat(repo)! | 10-11 | 백엔드를 단일 API로 다시 쓰고 DB V2.2에 맞춤. 이 브랜치 변경의 거의 전부 |
| `0fcde59` docs(backend) | 10-11 | 백엔드 코드 주석을 한국어로 정리 |
| `abaaf61` merge | 10-13 | `origin/develop` 병합. 충돌 14개 해결(DB는 develop 기준, 문서는 양쪽을 합침) |

## 3. 커밋된 변경 (develop 대비)

### 3.1 백엔드 구조

| 전(develop) | 후(이 브랜치) |
| --- | --- |
| `backend/api`, `backend/cep`(Esper, EPL 규칙), `backend/contracts` 3개 모듈 | `backend/api` 하나. `cep`·`contracts` 모듈 삭제 |
| API → FastAPI → CEP(내부 HTTP, 내부 토큰, outbox·재전달) | API → FastAPI, 판정은 API 안 `engine/` |
| 메모리 개발 모드 + `persistent` 프로필 | 메모리 모드 없음. MySQL과 계정이 필수 |
| DB V1.1 테이블(`JdbcSessionStore` 등) | DB V2.2 테이블만 사용, 시작 때 스키마 확인 |

새 패키지 (`backend/api/src/main/java/org/posegood/api/`):

| 패키지 | 역할 | 주요 파일 |
| --- | --- | --- |
| `common/` | 오류 응답, KST 시각 변환, JSON | `ApiError`, `ErrorHandler`, `KstTime`, `Json` |
| `contract/` | 경계 계약 record(옛 `contracts` 모듈에서 옮김) | `FeatureDeltas`, `Observation`, `Policy`, `SessionRequests`, `SessionView` |
| `engine/` | 시간 판정(옛 CEP에서 옮김) | `SessionEngine`, `Timeline`, `EpisodeLedger`, `DecisionRules`(임계 비교는 이곳에만), `ExcludedSpan` |
| `policy/` | `threshold_policy` 찾기·추가 | `ThresholdPolicyRepository` |
| `account/` | 가입·로그인·CSRF·비밀번호·탈퇴 유예·철회 | `AccountRepository`, `AccountService`, `UserLocks` |
| `session/` | 세션 생성·특징·종료·삭제, 진행 중 상태, FastAPI 호출 | `SessionController`, `SessionService`, `LiveSessions`, `InferenceClient`, `SessionRepository` |
| `workspace/` | 설정, 앱 기록 검증, 세션 테이블에서 기록 다시 만들기 | `WorkspaceService`, `RecordValidator`, `RecordRebuild`, `ServerRecordVerifier` |
| `realtime/` | `/v1/realtime` WebSocket | `RealtimeHandler`, `RealtimeMessages` |
| `system/` | `/health`, 시작 때 스키마 확인 | `HealthController`, `SchemaVerifier` |

삭제된 패키지: `application/`, `gateway/`, `persistence/`, `repository/`, `web/`(API), 그리고 `backend/cep`·`backend/contracts` 전체.

### 3.2 동작 변경

- **판정**: 붕괴 확정·재알림·회복의 세 임계 비교를 `DecisionRules`로 옮겼다. 옛 CEP 엔진 시험 16개를 같은 입력·기대값으로 옮겨 결과가 같은지 확인했다.
- **진행 중 상태**: V2.2에 관측·스냅샷 테이블이 없어 API 메모리(`LiveSessions`)에 둔다. API를 재시작하면 진행 중 세션은 `404 SESSION_LOST`가 되고, 그래서 한 인스턴스로만 실행한다.
- **DB 쓰기 시점**: 세션 생성(`baseline_posture`·`threshold_policy`·`monitor_session`), 사건 직후(`collapse_event`·`correction_alert`), 종료(`monitor_session` 종료 컬럼·`excluded_interval`·`daily_stat`).
- **기록**: 원문 테이블(`client_record`)이 V2.1에서 없어져 저장하지 않는다. `GET /v1/records`는 닫힌 세션을 테이블에서 다시 만든다. 사건 방향은 `unspecified`가 된다.
- **계정**: 비밀번호 변경·탈퇴 때 `SPRING_SESSION` 행을 지우고 실시간 연결을 닫는다(`auth_epoch` 대신). 탈퇴 철회 `POST /v1/auth/withdrawal/cancel`을 새로 만들었다.
- **시각**: DB는 KST(`connectionTimeZone=Asia/Seoul`), API 응답은 UTC ISO-8601.
- **실시간**: `/v1/realtime` WebSocket으로 특징을 받고 관측·사건·알림·진행을 보낸다(Kafka 없음).

### 3.3 프론트·모델

- 세션 생성 `setup.baseline`을 보정 동안의 **관절 9개 좌표 평균**으로 바꿨다(`model/prototype/calibration.ts`, `pose.ts`). 화면 밖 좌표가 있는 프레임은 빼고 15프레임 미만이면 보정 실패다.
- 서버 세션 계약·응답 검증(`features/session/server/contracts.ts`, `validation.ts`, `setup.ts`)을 새 API에 맞췄다.
- Vite 프록시가 WebSocket을 전달한다(`ws: true`). 합성 카메라에 관절 좌표를 추가했다(`syntheticLandmarks.ts`).
- 그 밖의 화면은 바꾸지 않았다.

### 3.4 인프라

- `compose.yaml`: `cep` 서비스 삭제, API의 JDBC 시간대를 KST로, `persistent` 프로필 삭제.
- `infra/nginx/default.conf`: `/api/v1/realtime` WebSocket 전달 추가.
- `infra/mysql/initdb/10-posegood-schema.sh`: 빈 볼륨에 `schema_V2_2.sql`과 시드를 적용.
- `infra/docker/java.Dockerfile`: `cep` 이미지 단계 삭제. `Makefile`: `dev-cep` 삭제.

### 3.5 도구·시험

- `tools/service_smoke.py`를 계정·MySQL 흐름으로 다시 썼다(−511줄 중 대부분 교체).
- `tools/test_mysql.py` 추가: 로컬 loopback MySQL 또는 Docker로 시험용 임시 DB를 만든다. `requirements-dev.txt`에 `PyMySQL`·`cryptography` 추가.
- `check-backend`: 단위 시험 → 실제 MySQL 통합 시험 → 실제 FastAPI HTTP smoke 순서로 바꿨다.
- 메모리 모드 전제의 `tools/http_response_fault.py`와 시험을 지웠다. 배포 도구(`tools/deploy/`)에서 CEP를 뺐다.
- 백엔드 시험: 단위 시험(판정 엔진·정책·추론 검증·기록 검증·기록 재구성)과 MySQL 통합 시험(`it/`)을 새로 만들었다.

### 3.6 문서·계약

- 새 문서: [ADR 0020](../decisions/0020-single-api-decision-engine.md)(ADR 0011·0018 대체), [계획 0026 백엔드 재작성](../plans/active/0026-backend-v2-rebuild.md), [백엔드 V2 현황](2026-10-10-backend-v2-status.md).
- 갱신: `backend/README.md`(새로 씀), `contracts/accounts.v1.md`, `contracts/realtime/README.md`, `docs/architecture.md`, `docs/code-structure.md`, `docs/quality.md` 등.

### 3.7 이 브랜치가 확인한 검증 (2026-10-11, DB V2.2 기준)

[백엔드 V2 현황](2026-10-10-backend-v2-status.md) 3장 기록: 단위 시험 34개, 실제 MySQL 통합 5개, HTTP smoke, `make check-compose` 45개 확인, 합성 계정 종단 확인 37개 통과.
이 결과는 **옛 V2.2 DB 기준**이며 develop 병합 뒤에는 다시 확인하지 않았다.

## 4. 현재 커밋 상태의 문제 (병합 직후)

| 문제 | 근거 | 영향 |
| --- | --- | --- |
| 스키마 불일치 | `SchemaVerifier`가 `user_account.alert_enabled`를 요구하지만 develop 스키마에는 `sound_alert_enabled`만 있다 | API가 시작하지 않음 |
| 초기화 파일 | `initdb`와 통합 시험(`DisposableDatabase`)이 `schema_V2_2.sql`을 쓰지만, 이 파일은 이제 develop의 V2.2(#39)이고 최신은 `schema_V2_3.sql`이다 | Compose·MySQL 통합 시험 실패 |
| 계획 번호 중복 (해결) | develop의 [0023 앱 판정 제거](../plans/active/0023-frontend-server-only.md)와 이 브랜치의 백엔드 재작성이 같은 번호였다 | 2026-10-13 백엔드 재작성을 [0026](../plans/active/0026-backend-v2-rebuild.md)으로 옮김 |
| 옛 API 전제 도구 (해결) | 브라우저 smoke의 서버 시나리오와 서버 benchmark가 계정 없는 메모리 API를 전제로 했다 | 2026-10-13 계정 로그인 흐름으로 바꿈. 서버 benchmark 실제 실행 통과 |
| 방향 결정과의 관계 | develop의 [ADR 0021](../decisions/0021-app-sends-information-server-judges.md)(앱은 좌표만 보내고 서버가 판정, Kafka 경로)과 이 브랜치의 특징 v2 단일 API는 경로가 다르다 | 팀 합의 필요 |

병합 직후 확인: `check-repo` 통과, `check-frontend` 통과. 백엔드 시험은 실행하지 않았다.

## 5. 커밋 전 작업 (작업 트리, 2026-10-13 진행 중)

이 문서를 쓸 때 작업 트리에 아직 커밋하지 않은 변경이 있었다. 진행 중이므로 이 문서를 쓰면서 시험을 다시 돌리지는 않았다.

- 문서: [계획 0025 백엔드·프론트·DB V2.3 연동](../plans/active/0025-backend-db-v23-integration.md)(담당 표기: Codex), [ADR 0022](../decisions/0022-db-v23-feature-v2-integration.md), [계정 API v2](../../contracts/accounts.v2.md), [동의 문서 v2](../../contracts/consent-documents.v2.md)
- 규모: 수정 70개 파일(+752 / −810)과 새 파일 약 10개. 백엔드 계정·세션·작업공간, 프론트 계정·서버 세션, 도구가 대부분이다.
- 주요 결정(ADR 0022):
  - DB V2.3을 정본으로 두고, 백엔드에서 삭제된 컬럼을 쓰지 않는다. DB는 바꾸지 않는다.
  - 계정·기준 등록·세션 생성은 HTTP v2로 바꾸고, 특징/관측 v2와 실시간 v1은 유지한다. 좌표 스트림·Kafka는 이번 범위가 아니다.
  - 기준 등록을 측정과 분리한다(`BaselineController`·`BaselineRepository`). 매번 새 기준 행을 추가하고 계정 모드는 유효 표본 20개 이상을 요구한다.
  - 앱의 `alerts_on`을 DB의 `sound_alert_enabled`에 대응시킨다. 가입 동의를 `user_consent`에 저장한다(`ConsentRepository`).
  - 붕괴까지 걸린 시간 최소·최대(V2.3)를 계산한다(`CollapseRanges`).
- 계획 0025에 적힌 검증: `tools/dev.py check`의 저장소·Python·프론트·실제 MySQL·FastAPI·계정 브라우저 단계 통과, Java 44개(단위 37 + MySQL 통합 7) 통과, 프론트 316개 통과. `check-compose`는 확인 중이고 "문서·계약 동기화 및 전체 게이트 검증" 단계가 남았다.

이 작업이 커밋되면 4장의 스키마 불일치·초기화 파일 문제는 해결될 것으로 보인다. ADR 0021과의 경로 차이는 남는다.

같은 날 이어서 고친 것: `LiveSession`의 낡은 `end_reason` 주석, 서버 benchmark의 계정 로그인 전환(실제 MySQL·API·추론으로 실행 통과), 계획 번호 중복(백엔드 재작성 → 0026).

## 6. 다음에 할 일

1. 커밋 전 작업(계획 0025)을 마무리하고 `check-compose`까지 확인한 뒤 커밋한다.
2. ADR 0021(좌표 전송·Kafka)과 이 브랜치의 특징 v2 단일 API 중 어느 경로로 갈지 팀과 정한다.
3. 원격에 push하고 develop으로 PR을 연다.
