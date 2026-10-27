# 백엔드 재작성: DB V2.2·프론트 계약 기준 단일 API

> 2026-10-13 후속: 현재 DB V2.3·계정 API v2 연동은 [ADR 0022](../../decisions/0022-db-v23-feature-v2-integration.md)에 따른다. 아래 V2.2 요구·결과는 당시 작업 기록이다.

- 상태: in_progress
- 담당: sunshine-yj 요청, Claude 구현 (브랜치 `feature/repo-backend-db-v2`, DB V2.2 작업과 한 브랜치)
- 시작일: 2026-10-09
- 관련 요구사항/ADR: [DB 안내](../../../database/README.md) (V2.2, CR-04), [ADR 0020](../../decisions/0020-single-api-decision-engine.md),
  [ADR 0011](../../decisions/0011-api-cep-boundary.md)(대체됨), [ADR 0012](../../decisions/0012-session-timing-policy.md),
  [ADR 0013](../../decisions/0013-frontend-server-feature-connection.md), [계정 계약](../../../contracts/accounts.v1.md),
  [실시간 계약](../../../contracts/realtime/README.md)

## 문제와 완료 기준

API는 아직 V1.1 테이블과 별도 Esper CEP를 사용한다. DB V2.0(CR-04)은 CEP 운영 테이블 4개와 장치·모델 버전 테이블을 지웠고
"판정은 백엔드가 맡는다"고 정했다. 그래서 현재 API는 V2.0 DB에서 시작하지 않는다.

완료 기준:

1. `backend/`는 Spring Boot API 하나다. CEP 모듈·Esper·메모리 개발 모드가 없다.
2. API가 `schema_V2_2.sql` + 시드만으로 시작하고, V2.2 테이블만 읽고 쓴다(2026-10-10 V2.0 → V2.2).
3. 프론트의 기존 HTTP 계약(계정·작업공간·기록·세션·특징)과 응답 검증(`validation.ts`)을 통과한다.
   V2.1이 요구하는 세션 생성 `setup.baseline`(관절 좌표)만 바꾼다.
4. 붕괴·회복·재알림 판정이 기존 CEP 시험과 같은 결과를 낸다(경계값·누락·중복·종료).
5. 실시간 WebSocket(`realtime-ws.v1`)으로 특징을 받고 관측·사건·요약을 push한다.
6. Java 단위 시험과 실제 MySQL 통합 시험을 실행한 결과를 기록한다.

## 범위와 제외

변경: `backend/` 전체, `compose.yaml`, `infra/docker/java.Dockerfile`, `infra/nginx/default.conf`, `infra/mysql/initdb`,
배포·HTTP smoke 도구의 CEP 제거, 관련 문서·ADR.

제외: 프론트 화면 변경, 세션 생성 기준 자세 외의 프론트 계약 변경, FastAPI 추론 규칙(그대로 호출), Kafka(계획 0022),
HDFS 적재(`feature_archive` 쓰기), 학습 모델 연결.

## 사용자 결정 (2026-10-09)

| 질문 | 결정 |
| --- | --- |
| 시간 판정 위치 | API 안으로 통합. Esper CEP 모듈을 없앤다 (V2.0 CR-04) |
| 추론 | FastAPI `/v2/infer` 호출 유지 |
| 메모리 개발 모드 | 없앤다. MySQL 영구 모드만 둔다 |
| 실시간 WebSocket | 포함한다 (`/v1/realtime`) |
| DB V2.2 반영 (2026-10-10) | 커밋을 나누지 않고 브랜치 하나(`feature/repo-backend-db-v2`)에 백엔드 재작성과 함께 적용 |

## 설계

| 영역 | 내용 |
| --- | --- |
| 판정 엔진 | `session/engine`: 순수 Java. 기존 EPL 세 규칙과 CEP의 시간 누적·사건 기록을 그대로 옮겼다. 사건마다 그 시점 요약을 함께 보관한다 |
| 진행 중 상태 | API 메모리(`LiveSessions`). V2.2에는 관측·스냅샷 테이블이 없으므로 재시작하면 진행 중 세션은 복구하지 않고 404로 알린다 |
| DB 쓰기 | 정책: `threshold_policy`(찾기/추가, 행은 고치지 않음). 기준 자세: `baseline_posture`에 등록할 때마다 새 행(V2.2~, 2026-10-13 ADR 0022로 바뀜 — 이전 「사용자당 1행 덮어쓰기」). 세션 생성: `monitor_session`(현재 기준의 `baseline_posture_id` FK·정책·`alert_enabled` 복사). 사건: `collapse_event`·`correction_alert`(처리 직후). 종료: `monitor_session` 종료 3컬럼, `excluded_interval`. `daily_stat`은 쓰지 않는다(2026-10-15 v5.2, Spark J2가 집계) |
| 기록 | 원문 저장 없음(V2.1). `POST /v1/records`는 검증 후 세션 행을 닫고, 목록은 닫힌 세션을 테이블에서 다시 만든다(`RecordRebuild`) |
| 재전송 | 세션 메모리에 `sequence → 요청 hash·관측`을 둔다. DB 쓰기 실패는 503이며 같은 요청 재전송 때 남은 사건을 다시 쓴다 |
| 계정 | 이메일·비밀번호, DB 세션(`SPRING_SESSION`), CSRF. 로그인 끊기는 `SPRING_SESSION` 행 삭제 + 실시간 연결 종료. 「자세 알림」 = `alert_enabled`. 탈퇴는 접수만 한다(CLOSED, 철회 없음). 30일 유예 뒤 최종 삭제는 Spark J3(2026-10-15 v5.2) |
| 시각 | 모든 `DATETIME(3)`은 KST. API 응답의 시각은 UTC ISO-8601 |

## 작업 단계

- [x] 관련 문서·현재 구현·프론트 계약 확인
- [x] 판정 엔진과 CEP 동등성 시험 (이전 CEP 시험 16개를 같은 입력·기대값으로 이전)
- [x] 저장소·서비스·HTTP·WebSocket 구현
- [x] Java 단위 시험
- [ ] 실제 MySQL 통합 시험(`-Pmysql-integration`)과 HTTP smoke 실행
- [x] Compose·Docker·Nginx·배포 도구에서 CEP 제거, HTTP smoke를 계정·MySQL 흐름으로 전환
- [x] 문서·ADR·계약 설명 동기화
- [x] 후속: 브라우저 smoke 서버 시나리오와 서버 benchmark를 계정 로그인 흐름으로 전환 (2026-10-13. 브라우저는 [계획 0025](0025-backend-db-v23-integration.md)의 계정 UI 시나리오, 서버 benchmark는 아래 기록)
- [ ] 후속: `make check-compose`(Docker) 전체 실행
- [x] DB V2.2 반영: 스키마 확인, 계정(`alert_enabled`, `auth_epoch` 제거), 좌표 기준 자세, 테이블 기반 기록, 프론트 setup, 도구·Compose initdb
- [ ] 후속: 앱 설정 화면의 소리 스위치(`sound_alert_enabled`), 해상도(640×480) 불일치 시 시작 거부

## 결정과 진행 기록

- 2026-10-09: 사용자 결정(위 표). ADR 0020으로 ADR 0011·0018을 대체한다.
- `setup.device`는 V2.0에 저장 칸이 없어 받기만 한다(앱 계약 유지). 세션 재시도 비교에서도 뺐다.
- 탈퇴 철회 경로 `POST /v1/auth/withdrawal/cancel`을 추가했다(DB-04 6-1-1). 앱 화면은 아직 없다. → 2026-10-15 v5.2에서 삭제(아래).
- `daily_stat`은 종료 때 누적한다. 세션 삭제는 빼지 않는다(DB 무결성 시나리오 2와 같음). → 2026-10-15 v5.2에서 누적 삭제(아래).
- JDBC는 `connectionTimeZone=Asia/Seoul`만 쓴다. 값은 시간대 없는 KST `LocalDateTime`으로 주고받으므로
  MySQL 시간대 테이블이 없는 서버(Windows 기본 설치)에서도 동작한다.
- 메모리 모드를 전제로 한 `tools/http_response_fault.py`(API↔CEP 응답 유실 주입)를 지웠다. 추론 실패는 Java 통합 시험이 다룬다.
- Compose smoke의 재시작 검증은 "진행 중 세션 복구"에서 "로그인·종료된 세션 행 유지, 진행 중 상태는 `SESSION_LOST`"로 바꿨다.
- 2026-10-10: DB V2.2(김유진, V2.1 포함)에 맞췄다. 사용자 결정: 브랜치를 나누지 않는다. DB README 9·11장의 백엔드 주의 사항을 따랐다.
  - 「자세 알림」(`alerts_on`)은 `alert_enabled`에 저장하고 세션에 복사한다. 소리(`sound_alert_enabled`)는 앱 설정이 없어 기본값(꺼짐)으로 둔다.
  - `auth_epoch` 대신 비밀번호 변경·탈퇴 때 `SPRING_SESSION` 행을 지우고, 그 로그인으로 연 실시간 연결을 `unauthorized`로 닫는다.
  - 기준 자세: 사용자당 1행. 같은 보정 ID·같은 값은 그대로, 값이 다르면 409. 세션에 쓰인 뒤 바뀐 보정 ID는 409(재촬영 전 탭 방지).
    프론트는 보정 프레임마다 9개 관절 좌표를 모아 평균을 보낸다. 0..1 밖 좌표가 있는 프레임은 빼고, 15프레임 미만이면 보정 실패다.
  - 기록: `client_record`가 없어 저장 응답은 검증한 본문을 그대로 돌려주고, 목록은 테이블에서 다시 만든다. 방향은 `unspecified`,
    `last_sequence`는 -1, 바른 자세 시간은 0.1초 단위다(`RecordRebuildTest`가 판정 엔진 결과와 같음을 확인).
  - 확인 못 한 종료의 기록 저장은 세션 행을 닫는다: 상태 있음 → 마지막 수신 시각에서 끝내 `DISCONNECTED`, 상태 없음 → `ERROR`(`good_sec` 0,
    `daily_stat` 제외, 다시 읽으면 요약 없음).
- 2026-10-15: 아키텍처 v5.2 전환 공지(DB·BE 김유진)에 맞췄다([ADR 0020](../../decisions/0020-single-api-decision-engine.md) 6·7번).
  - 탈퇴 철회를 없앴다: `POST /v2/auth/withdrawal/cancel`, `WITHDRAWAL_NOT_CANCELLABLE`, 철회 쿼리 삭제. CLOSED 계정 로그인은 `403 ACCOUNT_CLOSED`
    ("탈퇴 30일 뒤 삭제" 안내)이고 철회용 예외는 없다.
  - 매시간 탈퇴 삭제 작업(`purgeWithdrawn`)과 `posegood.withdrawal-*` 설정을 지웠다. 최종 삭제·완료 안내는 Spark J3(cron 매일 04:00, A안).
  - 세션 종료 때 `daily_stat` 누적을 지웠다. 일별 통계는 Spark J2(cron 매일 00:00, 전날 KST)만 쓴다. 쓰지 않게 된 `CollapseRanges`를 지웠다.
  - 검증: `backend/gradlew -p backend build` 통과(단위 시험). `-Pmysql-integration`은 로컬 MySQL `root` 비밀번호가 없어 접속 거부로 실행하지 못했다.
    `tools/service_smoke.py`는 아직 `daily_stat` 1행을 기대하므로 `check-backend`의 smoke가 실패한다(tools 담당 수정 필요).
- 2026-10-26: `tools/service_smoke.py`의 `daily_stat` 기대값을 「세션 종료 직후 0행(API는 쓰지 않음)」으로 바꿨다. 집계 값 확인은 J2 시험의 몫이다. 실행은 아직 하지 않았다.

## 검증 결과와 남은 한계

2026-10-10(DB V2.2 반영 후), Windows 11, JDK 21.0.6(Oracle), Maven 3.9.11, Node 24, Python 3.12. 이 PC에는 Docker가 없다.

| 명령 | 결과 |
| --- | --- |
| `mvn -f backend/pom.xml verify` | 단위 시험 34개 통과(판정 엔진 19, 정책 3, 추론 검증 5, 기록 검증 4, 기록 재구성 3). MySQL 통합 5개는 프로필 없이 건너뜀 |
| `python -m unittest discover -s tests` | 137개 중 131개 통과·1개 건너뜀. 실패 6개는 `test_deploy_configuration`의 Docker CLI 없음·Windows 파일 잠금이며, 변경 전 커밋에서도 같은 6개가 실패한다 |
| `npm --prefix frontend run check` | 37개 파일 286개 시험, 타입 검사, 빌드 통과 |
| `python tools/check_repository.py` | 깨진 링크 2개: `database/proposals/0001-v03-supplement.md`의 V1.x 스키마 링크(#24에서 파일 삭제 때부터 존재, DB 담당 문서라 그대로 둠) |

아직 실행하지 않은 것: 실제 MySQL 통합 시험(`-Pmysql-integration`, V2.2 기준으로 고침), `tools/service_smoke.py`, `make check-browser`,
`make benchmark-server`, `make check-compose`. 로컬 MySQL은 있으나 시험용 비밀번호 파일(`.cache/test-mysql-password`)이 없다.

남은 한계:

- ~~브라우저 smoke의 서버 시나리오와 서버 benchmark의 API 대상이 401로 실패한다.~~ 2026-10-13 해결: 서버 benchmark는 작업자마다 합성 계정 가입·기준 등록(`tools/service_smoke.py`의 `Account`·`register_baseline` 재사용)을 측정 밖에서 마친 뒤 `/v2/sessions`를 쓴다.
  정책은 새 계정의 시드 기본값(0.7, 3초, 3초, 60초)이다. 확인: `python tools/server_benchmark.py --target both --warmup 1 --repetitions 4 --concurrency 2`(JDK 21, Docker 임시 MySQL 8.4) 추론 4/4·API 4/4 성공, 세션 생성·종료 2/2, 실패 0.
  같은 날 `tools/service_smoke.py` 7단계 통과, `tests/test_server_benchmark.py`·`test_service_contracts.py` 23개 통과(1개 건너뜀). `JAVA_HOME`이 JDK 17이면 API가 시작하지 않으니 JDK 21을 지정한다.
- 진행 중 세션은 API 재시작에서 복구하지 않는다(ADR 0020). 앱이 기록을 보내지 않은 끝나지 않은 행은 자동으로 닫지 않는다.
- 다시 읽은 기록은 사건 방향을 잃는다(T-36 보류). 방향을 남기려면 DB에 `collapse_event` 방향 컬럼 또는 T-36 확정이 필요하다.
- ~~`database/README.md` 11장(백엔드 코드와의 관계)은 아직 V1.1 백엔드 기준 문구다.~~ 2026-10-21 해결: 11장을 V2.4·아키텍처 v5.2 기준으로 고쳤다.
- 시간당 알림 상한·실제 알림 표시 여부·HDFS 적재와 파일 삭제·탈퇴 완료 안내는 구현하지 않았다.
