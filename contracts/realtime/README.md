# 실시간 전달 계약 v1 (초안)

- 분야: 프론트, 백엔드
- 작업: GP-0069
- 상태: **초안(draft)**. 팀 확인([GP-0087](../../docs/plans/active/0022-kafka-realtime-pipeline.md))과 홍규 검토 전이다. 확정 시 이 줄을 바꾼다.
- 근거: [계획 0022](../../docs/plans/active/0022-kafka-realtime-pipeline.md) 1단계, 기존 [입력 v2](../inference-request.v2.schema.json)·[관측 v2](../posture-observation.v2.schema.json)·[사건 v1](../posture-event.v1.schema.json)·[조회 v1](../session-view.v1.schema.json)

기존 계약을 새로 만들지 않고 감싸기만 한다. 본문은 위 계약을 `$ref`로 그대로 쓴다.
원본 영상·랜드마크·좌표·이메일은 어떤 메시지에도 넣지 않는다. 모르는 필드는 거부한다.

## 흐름

```
앱 ─WebSocket─▶ 게이트웨이/입구 API ─▶ posture.features.v1 ─▶ 추론 ─▶ posture.inference.v1 ─▶ 판정 CEP
앱 ◀─WebSocket─ 게이트웨이 ◀──────────────────────────── posture.episodes.v1 ◀────────────────┘
```

## Kafka 토픽

| 토픽 | 생산 → 소비 | `kind` | 본문 | 스키마 |
| --- | --- | --- | --- | --- |
| `posture.features.v1` | 입구 → 추론 | `session_started` / `features` / `session_ended` | 정책·기준 ID·화면 크기 / 입력 v2 / `end_ms` | [kafka-features.v1](kafka-features.v1.schema.json) |
| `posture.inference.v1` | 추론 → 판정 | `session_started` / `observation` / `session_ended` | 시작·종료는 그대로 전달 / 관측 v2 | [kafka-inference.v1](kafka-inference.v1.schema.json) |
| `posture.episodes.v1` | 판정 → 게이트웨이 | `decision` | 사건 v1 + 그 시점 요약 + `last_sequence` | [kafka-episodes.v1](kafka-episodes.v1.schema.json) |

공통 봉투: `schema_version`, `message_id`(UUID), `session_id`(UUID), `user_id`, `produced_at`(UTC), `kind`, `body`.

규칙:

- **메시지 키는 `session_id`다.** Kafka는 같은 키 안에서만 순서를 지킨다. 세션 시작·특징·종료를 같은 토픽·같은 키로 보내야 판정이 항상 시작 → 특징 → 종료 순서로 받는다.
- 추론은 `session_started`·`session_ended`를 **바꾸지 않고** `posture.inference.v1`로 넘긴다. 판정은 한 토픽만 읽는다.
- 판정은 세션 시작 메시지의 `policy`로 판정한다. 환경변수 값은 시작 메시지가 없을 때의 기본값일 뿐이다.
- 같은 세션의 같은 `sequence`는 한 번만 반영한다(재전송 무시). `phase`(`rest`·`away`)와 품질 `poor`는 제외 구간이다.
- `event_id`는 세션마다 1부터 1씩 증가한다. 게이트웨이와 앱은 이미 받은 번호를 버린다.
- `user_id`는 로그인 계정 ID를 문자열로 쓴다. 숫자 ID로 바뀌어도(안건 Q16) 문자열로 담는다.

## WebSocket 메시지

스키마: [realtime-ws.v1](realtime-ws.v1.schema.json)

| `type` | 방향 | 역할 |
| --- | --- | --- |
| `hello` | 앱 → 게이트웨이 | 입장과 이어받기. 게이트웨이는 로그인 사용자와 세션 주인을 확인하고, `last_event_id` 이후 사건을 다시 보낸다. 실패하면 `closed`로 거절한다 |
| `features` | 앱 → 게이트웨이 | 약 0.5초 분량의 입력 v2 구간 1~30개를 순번 순서로 보낸다 |
| `ack` | 게이트웨이 → 앱 | `last_sequence`까지 Kafka에 넣었다는 영수증. 앱은 재전송 대기열에서 지운다 |
| `decision` | 게이트웨이 → 앱 | 확정된 판정 사건과 그 시점 요약. 화면 상태와 숫자는 이것으로만 바꾼다. 재연결 때 다시 받는다 |
| `alert` | 게이트웨이 → 앱 | 이탈 확정·재알림일 때만 알림(토스트·소리)을 띄우라는 신호. 지난 알림은 다시 보내지 않는다 |
| `stalled` | 게이트웨이 → 앱 | 5초 동안 판정 진행이 없다. 화면은 "분석이 잠시 멈췄어요"(`analysisPaused`)를 보인다 |
| `closed` | 게이트웨이 → 앱 | 채널 종료와 이유: `ended`, `unauthorized`, `not_owner`, `session_lost`, `server_shutdown` |

`decision`은 기록이라 빠지면 안 되고, `alert`는 그 순간의 알림이라 몰아서 울리면 안 된다. 그래서 둘을 나눴다.

## 합성 예제와 검증

[examples](examples/)의 12개 파일은 손으로 만든 합성 세션 하나다. 실제 사람의 측정값이 아니다.
`tests/test_realtime_contracts.py`가 예제 통과, 모르는 필드·원본 좌표·`kind`와 본문 불일치·알림 대상이 아닌 사건·묶음 크기 초과 거부,
봉투와 사건의 `session_id` 일치를 검사한다.

## 아직 정하지 않은 것

- 토픽 이름: 홍규 저장소는 `posture.summary`·`posture.inference`를 쓴다. 이름은 홍규 검토 때 맞춘다.
- `features` 본문은 입력 v2다. LSTM 입력이 정해지면(안건 Q5·Q7, GP-0083) 새 버전으로 올린다.
- 입구를 팀 API로 할지(안건 Q1)와 게이트웨이 구현 언어·담당(GP-0087).
- 기준 자세 전달 토픽은 보류한다(GP-0098).
