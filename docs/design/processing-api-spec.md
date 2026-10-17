# 처리 서비스 HTTP API — 운영·확인용 (`backend/processing`, 컨테이너 `api-server`)

- 담당: DevOps/BE. 갱신: 2026-10-17
- 이 API는 **앱이 부르지 않는다.** 앱 ↔ 서버 API는 [API 명세](api-spec.md)(입출구 서버 `backend/api`)와 [연동 명세](api-ws-spec.md)다.
  여기 있는 것은 서버 PC에서 처리 서비스(판정·판정 결과 저장)의 상태를 보고 시험하는 경로다. 서비스 사이 데이터는 [Kafka 명세](kafka-spec.md)로 오간다.
- 주소: `http://<서버>:<API_SERVER_HOST_PORT>`(기본 8080, `infra/compose/.env`). 지금은 LAN에 열려 있고 인증이 없다 —
  내부 전용으로 내리고 SSH 터널로만 쓰는 정리는 D-43이다. 운영 환경에서는 시험용 API를 끈다(아래 `REPORT_TEST_FIXTURES_ENABLED`).
- 이름 정리 예정(D-53): 판정은 Esper CEP가 아니라 상태머신인데 경로에 `cep`가 남아 있다. `/cep/v1/*`·`/cep/service-db`는 이름이 바뀔 수 있다.

## 1. 상태 확인

| 메서드·경로 | 응답 | 쓰는 곳 |
| --- | --- | --- |
| `GET /actuator/health/liveness` | `{"status":"UP"}` — 프로세스만 본다 | compose 헬스체크(외부 DB 장애가 컨테이너 재시작으로 번지지 않게) |
| `GET /actuator/health/readiness` | `db`(MySQL)·`redis` 포함 | 통합 테스트 6단계 |
| `GET /actuator/health` | 전체 | 수동 확인 |
| `GET /cep/service-db` | 서비스 DB(V2.3 `posture_service`) 준비 상태: `ok`, `specVersion`, `tableCount`(13), 빠진·지운 테이블/컬럼, 기본 정책 id(값 4개로 찾음), 계정 권한, `problems`·`warnings` | 통합 테스트 6단계. 기동 직후 로그에도 한 번 남긴다 |

## 2. 판정 (Kafka `posture.inference.v1` → `posture.episodes.v1`)

| 메서드·경로 | 응답 |
| --- | --- |
| `GET /cep/v1/status` | 진행 중 세션 수, 발행한 `decision`·`progress` 수, 건너뛴 관측(중복·이전 `sequence`) 수, 재시작 뒤 복원한 세션 수 |
| `GET /cep/v1/sessions/{session_id}` | 그 세션의 정책·요약(`total_ms`·`valid_ms`·`normal_ms`·`deviation_ms`·이탈·알림 횟수 등)·사건 목록. 진행 중이거나 최근 끝난 200개 안에서 찾는다. 없으면 404 |

판정 상태는 Redis에 있어 처리 서비스가 다시 시작해도 이어지지만, 이 조회는 메모리 기준이라 재시작 직후에는 다음 메시지가 올 때까지 404일 수 있다.

## 3. 판정 결과 저장 (Kafka `posture.episodes.v1` → MySQL V2.3)

| 메서드·경로 | 응답 |
| --- | --- |
| `GET /report/store` | 저장 컨슈머(`report-store-v1`) 상태: 받은 수, 저장·중복·세션 없음·이벤트 없음·DLQ·DB 실패 수, 마지막 오류, `testFixturesEnabled` |
| `GET /report/sessions/{session_id}` | 저장된 세션(종료 `ended_ms`·`good_sec`·기준 자세 id·정책 id·알림 사용)·이벤트(`started_ms`·`confirmed_ms`·`ended_ms`·`recovered_ms`·`end_kind`)·알림(`attempted_ms`·`displayed`)·제외 구간. 시각은 세션 시작 기준 ms. 세션 행이 없으면 404 |

- 저장은 세션 행을 만들지 않는다. 세션 행은 입출구 서버가 측정 시작 때 만들고, 저장은 `client_session_uuid`(= Kafka `session_id`)로 찾기만 한다.
  행이 없는 세션의 메시지는 건너뛰고 `sessionNotFound`로 센다.
- V2.3에는 종료 사유 칸이 없어 `end_kind`는 시각으로 판정한다: `recovered_at`이 있으면 `RECOVERED`, 세션 종료 시각과 같으면 `SESSION_END`, 그 밖은 `EXCLUDED`.
- `good_sec`은 바른 자세 시간(ms)을 0.1초 아래 버림한다(입출구 서버와 같음, D-58).

### 시험용 (`REPORT_TEST_FIXTURES_ENABLED=true`일 때만, 아니면 403)

| 메서드·경로 | 하는 일 |
| --- | --- |
| `POST /report/test/sessions/{session_id}?alertEnabled=true&startedAt=<ISO>` | 합성 시험 계정(`test-*@example.invalid`)·기준 자세(합성 좌표)·세션 행을 만든다 |
| `DELETE /report/test/sessions/{session_id}` | 시험 계정의 세션을 지운다(이벤트·알림·제외 구간은 CASCADE). 세션이 남지 않으면 계정도 지운다 |
| `POST /report/test/apply` | 본문 JSON Lines(`episodes.v1` 메시지 한 줄에 하나)를 컨슈머와 같은 처리로 다시 넣는다(재전송 멱등 시험) |

## 4. Kafka 경로 시험용 입구

`POST /api/v1/realtime/features` — `posture.features.v1` 메시지를 그대로 발행한다. 형식·규칙은 [Kafka 명세](kafka-spec.md) 4장.
입출구 서버(`ws`)가 Kafka에 이어지면(계획 0031) 시험에만 남는다.

## 5. 옛 경로 (정리 예정, D-38)

아키텍처 v4 이전 경로다. 새 작업에 쓰지 않는다. 테스트용 스키마 `posture_app`에 쓴다.

| 메서드·경로 | 하는 일 |
| --- | --- |
| `POST /api/v1/posture/summary` | 프레임 1건 → Kafka `posture.summary` |
| `GET /cep/active`, `GET /cep/events/recent?limit=20` | 옛 판정 엔진의 진행 중·최근 이벤트 |
| `GET /cep/db-writer` | 옛 경로 DB 쓰기 버퍼 상태 |
| `POST /cep/sessions/expire` | 옛 경로 세션 만료 검사 즉시 실행 |

## 6. 확인 방법

전체 확인은 통합 테스트다: `tools/platform/integration_test.sh --quick`(서버 PC, 저장소 루트). 단계와 옵션은 [플랫폼 시험 도구](../../tools/platform/README.md),
compose·`.env`는 [infra](../../infra/README.md) "빅데이터 플랫폼 (서버 PC)" 절.
