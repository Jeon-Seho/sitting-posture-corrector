# ADR 0028: 절대 시각은 서버가 정한다 — 기준 자세 등록 시각과 재전송 구분

- 상태: accepted (②·④는 브랜치 `fix/repo-backend-sync`에 구현, ③은 보류)
- 날짜: 2026-10-26 (번호: FE 브랜치 `feature/frontend-features-and-integrationV3`가 0025~0027을 써서 0028부터)
- 근거: 2026-10-26 사용자(DB·BE) 결정 — 「시간 입력 기준을 서버로 통일한다」. 범위 검토는 「서버 기준 시각으로 통일할 때 영향 범위」(DB·BE 검토 문서, 2026-10-26)
- 대체: [옛 ADR 0022](../removed-docs.md) 「완료 시각을 고정해 재시도한다」, FE ADR 0021 5절(옛 0026 4번)의 「`registered_at`은 촬영이 끝난 UTC 시각, 같은 본문으로 재시도」(V3 브랜치)

## 배경

DB에 들어가는 시각 중 앱 시계에서 온 절대 시각은 기준 자세 등록(B1)의 `registered_at` 하나였다.
앱이 촬영을 끝낸 시각을 보내고, 서버는 그 값과 UK-14(사용자, 등록 시각)로 재전송 중복을 막았다.
PC 시계가 틀리면 등록 시각도 틀리고, 재전송 구분이 그 시각에 묶여 있어 서버 시각으로 바꿀 수 없었다.
세션 안의 시각(사건·알림·제외 구간·종료)은 서버의 `started_at`(S1을 받은 시각) + 앱이 잰 경과 ms다.

## 결정

1. **원칙:** 절대 시각은 서버가 정한다. 세션 안의 간격은 앱이 잰 경과 시간을 쓰고, 그 기준점(`started_at`)은 서버 시각이다.
2. **② 기준 자세 등록 시각 (구현):**
   - B1 `POST /v2/baselines`는 `registered_at`을 받지 않고 `registration_id`(UUID)를 받는다. 앱이 촬영 한 번마다 한 번 만들고 재시도에 그대로 보낸다.
   - `baseline_posture.registered_at`은 서버가 등록을 받은 시각이다.
   - 재전송은 `baseline_posture.client_registration_uuid`와 UK-16(사용자, 등록 식별자)으로 막는다. 같은 식별자·같은 좌표는 그 행, 다른 좌표는 409다.
   - UK-14(사용자, 등록 시각)는 지운다. FK-04(사용자) 인덱스 역할은 UK-16이 이어받는다.
   - WebSocket 등록(`purpose: calibration`)은 2026-10-27 지웠다. 등록은 B1뿐이라 식별자는 항상 앱이 만든다(FE ADR 0021).
   - DB 스키마 V2.5, migration 015. 기존 행의 식별자는 `UUID()`로 채운다.
3. **④ 오늘 기록 시각 (구현):** WebSocket `ready`(측정)에 `started_at`, `closed`에 `ended_at`을 서버 시각(UTC ISO)으로 싣는다.
   - `started_at`은 DB `monitor_session.started_at`(서버가 S1을 받은 시각)이다.
   - `ended_at`은 이 연결에서 세션이 끝났을 때 `started_at + 요약 total_ms`다. DB에 저장하는 `ended_at`과 같은 식이다(`closed`가 저장보다 먼저 나가서 DB를 읽지 않는다).
     끝나기 전에 닫혔으면(잘못된 메시지·로그인 끊김·서버 종료 등) `null`이고, 앱은 나중에 기록 조회로 받는다.
   - 앱은 오늘 기록의 시각과 날짜(서버 `started_at`의 KST 날짜)를 이 값으로 정한다. 계약 `realtime-ws.v2`(엄격한 스키마)와 FE V3 검증을 함께 바꾼다.
   - Kafka 경로(계획 0031)의 `ws`도 같은 필드를 보내야 한다.
4. **③ 세션 안 시각 (보류):** 경과 ms를 서버 수신 시각으로 바꾸지 않는다(판정 간격에 네트워크 지연이 섞이고 재전송 중복 방지가 깨진다). 서버 시계로 경과 시간의 상한을 검사하는 안은 나중에 다시 정한다.

## 결과

- **호환성이 깨진다.** API는 모르는 필드를 거부하므로(`fail-on-unknown-properties=true`) `registered_at`을 보내는 예전 본문은 `400 INVALID_CONTRACT`다.
  WebSocket v2 스키마도 모르는 필드를 허용하지 않으므로, 예전 검증을 쓰는 앱은 `ready.started_at`·`closed.ended_at`을 받으면 거부할 수 있다.
  `develop`의 앱은 B1을 부르지 않는다. B1을 쓰는 FE V3는 병합 전에 `registration_id`로 바꿔야 한다.
- 배포 순서: migration 015 → 새 API → 앱. 새 API는 `client_registration_uuid`가 없는 DB(V2.4 이하)에서 시작하지 않는다.
- 계약 [accounts.v2](../../contracts/accounts.v2.md)·[BE API 명세](../design/api-spec.md) B1, [DB 안내](../../database/README.md)를 함께 바꿨다.
- 남은 일: FE V3 반영(②의 `registration_id`, ④의 새 필드), Kafka 경로 `ws`의 같은 필드, DB 명세서(xlsx) V2.5, ERD, 실제 MySQL 검증. 상태는 [개발 상태](../backend-status.md)에 둔다.
