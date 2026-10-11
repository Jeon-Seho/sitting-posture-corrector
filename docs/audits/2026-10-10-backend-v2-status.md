# 백엔드 V2 재작성 현황 (2026-10-10)

- 기준: DB 스키마 V2.2(`database/`, 2026-10-10)와 현재 프론트(`frontend/`)
- 브랜치: `feature/repo-backend-db-v2` — **아직 커밋하지 않음** (작업 트리 변경 약 170개 파일)
- 관련 문서: [계획 0023](../plans/active/0023-backend-v2-rebuild.md), [ADR 0020](../decisions/0020-single-api-decision-engine.md),
  [계정·저장 API 계약](../../contracts/accounts.v1.md), [백엔드 안내](../../backend/README.md)

## 1. 한눈에 보기

| 영역 | 상태 |
| --- | --- |
| 단일 API(Spring Boot) + 판정 엔진, CEP·메모리 모드 제거 | 구현 완료 |
| 계정(가입·로그인·비밀번호·탈퇴 유예·철회·일괄 삭제) | 구현 완료 |
| 설정(프로필·판정 기준·자세 알림) | 구현 완료. 소리 설정은 남음 |
| 측정(세션 생성·특징·종료·삭제)과 DB 기록 | 구현 완료 |
| 기록(저장 검증·목록 재구성) | 구현 완료. 사건 방향은 잃음 |
| 실시간 WebSocket `/v1/realtime` | 구현 완료. 실제 브라우저 확인 전 |
| 시간당 알림 상한, 특징 적재(HDFS), 기록만 삭제 | 미구현 |
| 실제 MySQL 통합 시험·smoke·브라우저 시험 | 실행 안 함 |

## 2. 구현한 것

### 2.1 구조

- `backend/`는 Spring Boot API 하나다(Java 21, Spring Boot 3.5.16, Maven). Esper CEP 모듈, 내부 HTTP, outbox, 메모리 개발 모드를 없앴다.
- 점수는 FastAPI `POST /v2/infer`가 만들고, 붕괴·회복·재알림 시간 판정은 API 안의 판정 엔진(`engine/`)이 한다.
- 시작할 때 V2.2 스키마를 확인한다: 테이블 12개, `baseline_posture` 좌표 컬럼, `user_account.alert_enabled`, 기본 정책 `DEFAULT_TEMP`.
  V2.0·V2.1에서 지운 테이블이 있으면 시작하지 않는다. Windows MySQL의 소문자 테이블 이름(`spring_session`)도 받아들인다.

### 2.2 계정 (`account/`)

| 기능 | 경로 | DB |
| --- | --- | --- |
| 가입·로그인·로그아웃·내 정보·CSRF | `/v1/auth/register`·`login`·`logout`·`me`·`csrf` | `user_account`(기본 정책 연결), `SPRING_SESSION` |
| 비밀번호 변경 | `PUT /v1/auth/password` | 그 사용자의 `SPRING_SESSION` 행 삭제, 열린 실시간 연결 종료 |
| 탈퇴 접수 | `DELETE /v1/auth/account` | `deletion_request`(`ACCOUNT_ALL`, `REQUESTED`), 계정 `CLOSED`, 로그인 삭제 |
| 탈퇴 철회 (유예 30일 안) | `POST /v1/auth/withdrawal/cancel` | 요청 행 삭제, 계정 `ACTIVE` |
| 최종 삭제 | 매시간 작업 | 적재 기록 → 세션 → 일별 통계 → 기준 자세 → 삭제 요청 → 계정, 한 트랜잭션 |

### 2.3 설정 (`workspace/`)

- `GET`/`PUT /v1/workspace`: 프로필은 `user_account`, 판정 기준은 같은 값의 `threshold_policy` 행을 찾거나 `USER` 행을 추가한다(행은 고치지 않음).
- 「자세 알림」(`preferences.alerts_on`)은 `user_account.alert_enabled`에 저장하고 측정 시작 때 `monitor_session.alert_enabled`로 복사한다(V2.2).

### 2.4 측정 (`session/`, `engine/`)

| 시점 | 처리 | DB |
| --- | --- | --- |
| 생성 `PUT /v1/sessions/{id}` | 기준 자세 등록 → 세션 생성. 같은 값 재시도는 멱등, 다른 값은 409 | `baseline_posture`(사용자당 1행, 좌표 18개 덮어쓰기), `threshold_policy`, `monitor_session`(`calibration_uuid`·정책·알림 설정 복사) |
| 특징 `POST .../features` | FastAPI 추론 → 판정 엔진 → 새 사건 즉시 기록 | `collapse_event`, `correction_alert`(알림 꺼짐이면 `ALERT_OFF`) |
| 종료 `POST .../end` | 열린 사건 중단, 요약 확정 | `monitor_session` 종료 3컬럼, `excluded_interval`(PAUSE/ABSENCE/UNMEASURABLE/MISSING), `daily_stat` 누적 |
| 조회·메타데이터·삭제 | `GET`, `GET .../metadata`, `DELETE` | 삭제는 하위 행 cascade, 적재 파일 있으면 409 |

- 판정 규칙: 후보가 `hold` 이상 지속 → 붕괴 확정, 마지막 알림 뒤 `realert` 경과 → 재알림, 바른 자세 `recover` 이상 → 회복.
  휴식·자리 비움·판정 불가·시간 공백·순번 누락은 열린 사건을 중단한다. 이전 CEP 시험 16개를 같은 입력·기대값으로 옮겨 동등성을 확인했다.
- 재시도·오류: 같은 순번·같은 본문은 처음 결과, 다른 본문·역순·겹침은 409, 세션당 10,000건 초과는 429,
  추론 오류는 502(상태 변경 없음), DB 오류는 503(같은 요청 재전송 때 남은 사건 기록).

### 2.5 기록 (`workspace/`)

V2.1에서 기록 원문 테이블(`client_record`)이 없어졌으므로 원문을 저장하지 않는다.

- `POST /v1/records`: 서버 측정 기록만 받는다. 서버 판정과 맞는지 검증한 뒤 세션 행이 열려 있으면 닫는다.
  종료 확인을 못 받은 기록은 판정 상태가 있으면 `DISCONNECTED`, API 재시작으로 상태가 없으면 `ERROR`로 닫는다.
- `GET /v1/records`: 닫힌 세션마다 테이블에서 기록을 다시 만든다(`RecordRebuild`). 판정 엔진 결과와 같은지 단위 시험으로 확인했다.

### 2.6 실시간 (`realtime/`)

- `/v1/realtime` WebSocket: `hello`(재연결 시 놓친 사건 재전송), `features`(1~30구간) → `observation`·`decision`·`alert`·`ack`·`progress`.
- 일시 장애는 `stalled`, 로그인 없음 `unauthorized`, 다른 사람 세션 `not_owner`, 상태 없음 `session_lost`.

### 2.7 프론트·인프라·도구

- 프론트: 보정 동안 9개 관절(코·눈·귀·입 양끝·어깨) 좌표 평균을 세션 생성 `setup.baseline.landmarks`로 보낸다.
  화면 밖 좌표가 있는 프레임은 빼고, 남은 프레임이 15개 미만이면 보정 실패로 처리한다. 그 밖의 화면·계약은 그대로다.
- Compose에서 CEP 서비스를 없앴고, MySQL 초기화는 `schema_V2_2.sql` + `seed_04`를 쓴다. Nginx·Vite가 WebSocket을 전달한다.
- 시험용 임시 DB 도구(`tools/test_mysql.py`), HTTP smoke, 배포 smoke를 V2.2·계정 흐름으로 바꿨다.

## 3. 검증

| 항목 | 결과 |
| --- | --- |
| 백엔드 단위 시험 `mvn verify` | 34개 통과 (판정 엔진 19, 정책 3, 추론 검증 5, 기록 검증 4, 기록 재구성 3) |
| 프론트 `npm run check` | 286개 시험, 타입 검사, 빌드 통과 |
| Python `unittest` | 137개 중 133개 통과·1개 건너뜀(2026-10-11, Docker 설치 후). 남은 3개는 Windows 전용 문제(백업 시험의 파일 잠금, POSIX 배포 잠금) |
| 저장소 검사 | DB 담당 문서의 기존 깨진 링크 2개만 남음 |
| 로컬 실행 (2026-10-10) | 로컬 `posture_service`(V2.2) + `posture_be` 계정으로 추론·API·프론트 기동, `/health` `mysql ok`, CSRF 200, 미로그인 401 확인 |
| `make check-backend` (2026-10-11) | Docker 임시 MySQL로 단위 34개 + **실제 MySQL 통합 5개** + 실제 FastAPI HTTP smoke 6단계 모두 통과 |
| `make check-compose` (2026-10-11) | 이미지 3개 빌드, Compose 전체 기동(DB V2.2 초기화), **45개 확인 통과**: 내부 토큰 401, 계정·측정·재시작, 실제 Chrome 계정 화면 21개, Compose DB에서 통합 시험 5개, 백업 → 빈 DB 복원·행 수 일치. 검증 컨테이너·볼륨·포트 정리 확인 |
| 종단 확인 (2026-10-11) | 실행 중인 추론·API·프론트(Vite 프록시 `/api`)에 합성 계정으로 37개 항목 모두 통과: 가입·기본 설정, 측정(실제 FastAPI 추론으로 붕괴 3초·회복 6초·휴식·누락·종료, 재시도 멱등·409), DB 행(`monitor_session`·`baseline_posture`·`collapse_event`·`correction_alert`·`excluded_interval`·`daily_stat`), 기록 저장 검증·조작 409·목록 재구성, 자세 알림 끔 → `ALERT_OFF`, 실시간 WebSocket, 기준 자세 덮어쓰기·옛 기준 409, 비밀번호 변경 시 다른 기기 401·`SPRING_SESSION` 0행, 탈퇴 403·철회. 끝난 뒤 합성 행은 모두 지움 |

**실행하지 않은 것**: `make check-browser`, `make benchmark-server`(둘 다 서버 시나리오가 옛 API 전제라 다시 써야 함).
실제 카메라로 화면을 눌러 보는 확인은 아직이다(브라우저 확인은 합성 카메라 입력).

**이 확인에서 고친 것 (2026-10-11)**: 시험 도구의 MySQL 8 로그인에 필요한 `cryptography`를 `requirements-dev.txt`에 추가했다.
Windows에서 백업·복원 도구가 비밀 설정 파일을 읽지 못하던 기존 문제(`infra/README.md`에 적혀 있던 것)를 healthcheck와 같은 0400 복사본 방식으로 고쳤다.
남은 표시 문제: Windows 콘솔 인코딩(cp949) 때문에 Docker 출력 한 줄을 읽는 스레드 경고가 로그에 남지만 결과에는 영향이 없다.

## 4. 남은 구현

| 항목 | 내용 | 필요한 결정·작업 |
| --- | --- | --- |
| 소리 설정 | `sound_alert_enabled`(V2.2) 저장 경로 없음. 설정 화면에 소리 스위치가 없다 | 프론트 스위치 + `preferences` 계약에 필드 추가 |
| 시간당 알림 상한 | `notify_max_per_hour`를 적용하지 않는다. `RATE_LIMIT` 억제 기록 없음 | 상한 초과 시 판정·화면 동작 결정 |
| 실제 표시 여부 | `correction_alert.delivered`는 세션 알림 설정 값이다. 화면에 실제로 떴는지는 모른다 | 프론트가 표시 결과를 알려 줄지 결정 |
| 해상도 검사 | `CAPTURE_RESOLUTION`(640×480)과 다르면 측정을 시작하지 않는 검사가 프론트에 없다 | 프론트 구현 |
| 기록만 삭제 | `deletion_request`의 `RECORDS_ONLY` 범위 미구현(탈퇴 `ACCOUNT_ALL`만) | 화면·API 설계 |
| 특징 적재 | HDFS 적재와 `feature_archive` 쓰기·파일 삭제 미구현. 적재 파일이 있는 탈퇴 계정은 `FAILED`로 남는다 | 데이터 플랫폼 작업 |
| 탈퇴 안내 | 탈퇴 완료 안내 메일·철회 화면 없음(철회 API만 있음) | 프론트·메일 |
| 동의 저장 | `user_consent`(T-41) 보류로 가입 동의를 저장하지 않는다 | DB 결정 |
| 시험 도구 | 브라우저 smoke의 서버 시나리오와 서버 benchmark가 계정 없는 옛 API를 전제로 해 401로 실패 | 계정 로그인 흐름으로 다시 작성 |
| 다중 인스턴스·Kafka | 진행 중 상태가 API 메모리에 있어 한 인스턴스만 가능. Kafka는 계획 0022 | 공유 저장소 또는 고정 라우팅 |

## 5. 문제와 위험

| 문제 | 영향 | 대응 |
| --- | --- | --- |
| 실제 DB에서만 드러난 문제 | 로컬 실행에서 시작 실패 2건(빈 이름 `sessionRepository` 충돌, 소문자 테이블 이름)이 나와 고쳤다. 이후 통합 시험·Compose 전체 확인은 모두 통과했다 | 변경 때마다 `make check-backend`, 배포 전 `make check-compose` |
| **사건 방향 손실** | DB에 방향 칸이 없어(T-36 `collapse_type` 보류) 다시 읽은 기록의 사건이 모두 「기준 변화」로 보인다. 측정 직후 화면과 다르다 | DB 담당과 방향 저장 칸(또는 T-36 확정) 논의 |
| 다시 만든 기록의 정밀도 | 바른 자세 시간은 0.1초 단위(`good_sec`), `last_sequence`는 -1. 저장 직후와 다시 읽은 값이 조금 다를 수 있다 | 계약 문서에 명시함 |
| API 재시작 | 진행 중 측정이 끊긴다(`SESSION_LOST`). 앱이 기록을 보내면 `ERROR`로 닫히고 다시 읽은 기록은 요약 없음(합계 0). 기록을 보내지 않은 행은 열린 채 남는다 | 운영은 한 인스턴스, 재시작 최소화 |
| 커밋 안 됨 | 이틀 작업이 작업 트리에만 있다 | 확인 후 이 브랜치에 커밋 |
| 기본 정책 임시값 | `DEFAULT_TEMP`는 threshold(0.700)만 확정, 나머지 4개는 임시값 | 확정되면 DB 담당이 `DEFAULT` 행 추가, API 설정 `posegood.default-policy-name` 변경 |
| 이전 중간 자료 | 옛 형식(`target_center_*`)으로 저장된 브라우저 중간 측정 자료는 형식 검사에서 거부된다 | 새로 측정 |
| DB 문서 | `database/README.md` 11장은 아직 옛 V1.1 백엔드 기준 문구다 | DB 담당 문서라 고치지 않음, 갱신 요청 |
| DB 계정 정보 노출 | 로컬 DB 계정 비밀번호가 작업 대화에 남았다 | 다른 곳에서도 쓰는 DB라면 비밀번호 변경 |
| DB 계정 사용 | API는 `posture_be`(SELECT·INSERT·UPDATE·DELETE)만 쓴다. `posture_fe`·`posture_app`은 쓰지 않는다 | 용도 확인 |

## 6. 다음 순서 (제안)

1. 화면에서 가입 → 설정 → 기준 등록 → 측정 → 종료 → 기록 확인을 직접 해 본다.
2. 실제 MySQL 통합 시험과 HTTP smoke를 실행하고 결과를 계획 0023에 기록한다.
3. 이 브랜치에 커밋한다.
4. 남은 구현 중 우선순위를 정한다(소리 스위치, 시간당 알림 상한, 해상도 검사가 작다).
