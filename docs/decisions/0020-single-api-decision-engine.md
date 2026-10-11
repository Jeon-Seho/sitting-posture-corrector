# ADR 0020: 판정을 API 안으로 통합하고 DB V2.2만 사용

- 상태: accepted
- 날짜: 2026-10-09 (2026-10-10 DB V2.1·V2.2 반영)
- 근거: 사용자 결정(2026-10-09). "백엔드를 프론트와 DB에 맞게 처음부터 다시 만든다", 판정은 API 안으로 통합,
  FastAPI 추론 유지, 메모리 개발 모드 제거, 실시간 WebSocket 포함. DB V2.0(CR-04)의 "CEP를 쓰지 않는다.
  붕괴 확정·회복·재알림 판정은 백엔드가 맡는다". 2026-10-10 사용자 요청: DB V2.2(V2.1 포함)에 맞춘다.
- 대체: [ADR 0011](0011-api-cep-boundary.md)(API·Esper CEP 분리), [ADR 0018](0018-db-schema-v11-service-storage.md)(V1.1 저장)
- 유지: [ADR 0012](0012-session-timing-policy.md)(시간 정책), [ADR 0013](0013-frontend-server-feature-connection.md)(특징 입력),
  [ADR 0014](0014-mysql-persistence-and-accounts.md)(계정·DB 세션)

## 결정

1. **백엔드는 Spring Boot API 하나다.** Esper CEP 모듈·내부 HTTP·outbox·재전달을 없앴다. Java 21·Spring Boot 3.5.16·Maven은 유지한다.
2. **시간 판정은 `backend/api/.../engine/`의 순수 Java다.** 임계 비교 세 개(붕괴 확정·회복·재알림)는 `DecisionRules`에만 둔다.
   시간 누적·사건 기록·통계·중단/초기화(`legacy-interrupt-v1`)는 이전 CEP와 같다. 이전 CEP 엔진 시험 16개를 같은 입력·기대값으로 옮겨 동등성을 확인한다.
3. **추론은 FastAPI `POST /v2/infer`를 그대로 호출한다.** 출력이 요청과 맞지 않거나 저품질을 유효로 표시하면 502이며 상태를 바꾸지 않는다.
4. **메모리 개발 모드는 없다.** API는 MySQL과 계정을 필수로 한다. 개발·시험은 임시 MySQL(로컬 loopback 또는 Docker)을 쓴다.
5. **DB는 V2.2만 쓴다.** API는 시작할 때 V2.2 테이블 12개, `baseline_posture` 좌표 컬럼, `user_account.alert_enabled`, 기본 정책 시드를
   확인하고, V2.0·V2.1에서 지운 테이블이 남아 있으면 시작하지 않는다.
6. **진행 중 판정 상태는 API 메모리에 있다.** V2.2에는 관측·스냅샷 테이블이 없다(CR-04). 그래서:
   - 세션은 생성 때 `baseline_posture`(사용자당 1행, 관절 좌표 18개 덮어쓰기)·`threshold_policy`·`monitor_session`을 쓴다.
     세션에는 `calibration_uuid`·정책·`user_account.alert_enabled`를 복사한다.
   - 사건은 처리 직후 `collapse_event`·`correction_alert`로 나눠 쓴다. 쓰기에 실패하면 503이고, 같은 요청을 다시 보내면 남은 사건을 쓴다.
   - 종료 때 `monitor_session`의 종료 3컬럼, `excluded_interval`, `daily_stat`(세션 시작의 KST 날짜에 누적)을 한 트랜잭션으로 쓴다.
   - API를 재시작하면 진행 중 세션의 상태는 복구하지 않는다. 행이 남은 세션은 `404 SESSION_LOST`로 알린다.
   - 같은 이유로 API는 한 인스턴스로 실행한다. 종료된 세션 상태는 기록 저장 확인을 위해 30분 보관한다.
   - 앱 기록은 원문을 저장하지 않는다(V2.1에서 `client_record` 삭제). 기록 저장은 서버 판정과 맞는지 확인하고 세션 행을 닫는다.
     확인 못 한 종료는 상태가 있으면 `DISCONNECTED`, 없으면 `ERROR`로 닫는다. 기록 목록은 닫힌 세션을 테이블에서 다시 만든다.
7. **계정은 V2.2 절차를 따른다.** 로그인 끊기(비밀번호 변경·탈퇴)는 그 사용자의 `SPRING_SESSION` 행 삭제와 열린 실시간 연결 종료다
   (V2.1에서 `auth_epoch` 삭제). 「자세 알림」은 `alert_enabled`, 소리는 `sound_alert_enabled`다(V2.2). 탈퇴하면 `deletion_request`(`REQUESTED`)를 쓰고 `CLOSED`로 바꾼다. 식별 정보와 기록은 30일 동안 그대로 둔다.
   유예 중에는 `POST /v1/auth/withdrawal/cancel`로 철회할 수 있다. 유예가 끝나면 시간마다 도는 작업이 계정 단위 한 트랜잭션으로 지운다.
   `feature_archive` 파일이 남은 계정은 파일 삭제 기능이 생길 때까지 `FAILED`로 둔다.
8. **시각은 KST로 저장한다**(CR-04). JDBC 세션 시간대도 `Asia/Seoul`이다. API 응답의 시각은 UTC ISO-8601이다.
9. **실시간 채널은 API의 `/v1/realtime` WebSocket이다**([실시간 계약 v1 초안](../../contracts/realtime/README.md)). Kafka 없이 HTTP와 같은 처리 경로를 쓴다.
   세션 생성·종료·복구는 HTTP에 남긴다. 로그인 쿠키로 인증하고 같은 출처 페이지만 허용한다.
10. **프론트 계약은 최소로만 바꾼다.** HTTP 경로와 응답 형식은 그대로다. V2.1이 기준 자세를 관절 좌표로 저장하므로 세션 생성의
    `setup.baseline`만 좌표 9개(평균)로 바꿨다. `setup.device`·`frame`은 받지만 저장하지 않는다. 새 경로는 탈퇴 철회 하나다.

## 결과와 한계

- 재시작하면 진행 중 측정이 끊긴다. 앱은 마지막 확인 요약을 기록으로 남길 수 있다. 서버 검증은 DB에 남은 종료·바른 자세 시간·사건 수로 한다.
  그 기록 저장이 행을 `ERROR`로 닫는다. 바른 자세 시간과 제외 구간을 알 수 없어 `good_sec` 0으로 두고 `daily_stat`에 더하지 않으며,
  다시 읽은 기록은 요약 없이(합계 0) 보인다. 앱이 기록을 보내지 않은 행은 열린 채 남는다.
- `correction_alert.delivered`는 세션의 알림 설정(`alert_enabled`)을 기록한다. 시간당 알림 상한(`notify_max_per_hour`)은 아직 적용하지 않는다.
- `deviation_type`(좌우·전방 방향)은 붕괴 유형(T-36) 보류로 사건 테이블에 없다. 다시 만든 기록에서는 `unspecified`(화면 `referenceChange`)다.
  다시 만든 기록의 `last_sequence`는 -1, 바른 자세 시간은 0.1초 단위다. 저장 직후 화면과 다시 읽은 기록이 이만큼 다를 수 있다.
- 소리 설정 `sound_alert_enabled`는 앱 설정 화면에 스위치가 없어 API가 바꾸지 않는다(기본 꺼짐).
- 해상도를 저장하지 않으므로 `CAPTURE_RESOLUTION`(640×480)과 다른 영상이면 시작하지 않는 검사는 앱 몫이며 아직 없다.
- 계정 없는 서버 판정 모드가 없어졌다. 서버 판정은 계정 앱(`VITE_SERVER_ACCOUNTS=true`)에서만 동작한다.
- 브라우저 smoke의 서버 시나리오와 서버 benchmark는 계정 없는 메모리 API를 전제로 작성되어 있어 다시 써야 한다([계획 0023](../plans/active/0023-backend-v2-rebuild.md)).
