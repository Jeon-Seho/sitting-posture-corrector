# 앱 ↔ 입출구 서버 API 명세 (REST·WebSocket) 초안

> 작성: 2026-10-13 · FE · 상태: **초안** · 대상: BE(입출구 서버 `auth`·`api`·`ws`, D-48)
> 근거: [FE 제안서](fe-server-proposal.md)(2·3장), BE 답변(10/13), 아키텍처 v5.1 연결 ①②, [계정 계약 v1](../../contracts/accounts.v1.md), [실시간 계약 v1](../../contracts/realtime/README.md), DB V2.1
> 아키텍처 v5.1에서 이 명세는 BE와 FE가 함께 쓴다. 이 문서는 FE 초안이고, 결정할 것은 5장에 모았다.

## 1. 나누는 기준

| 통로 | 맡는 일 | 경로 |
|---|---|---|
| **REST** (HTTP) | 로그인·계정, 설정, 기준 자세 조회, 세션 행 만들기, 연결이 끊겼을 때의 종료, 기록·지난 통계 조회 | `/api/v1/**` |
| **WebSocket** | 측정 중 좌표 보내기와 실시간 결과 받기, 자세 등록 프레임 보내기와 등록 결과 받기 | `/ws` |

- 같은 입출구 서버(같은 출처)다. WebSocket은 HTTP 로그인 쿠키를 그대로 쓴다.
- 통계는 서버가 계산한다. 앱은 받은 값을 표시만 한다.
- 시각: REST의 날짜·시각은 ISO 8601에 KST(`+09:00`)를 붙인다. 세션 안의 시각은 `t_ms`(세션 시작 기준 ms)다.
- 이름: 새 필드는 snake_case로 쓴다. 시간 길이는 이름에 단위를 붙인다(`_ms`, `_sec`).

## 2. REST

### 2.1 공통

- 인증: 서버 세션 쿠키(HttpOnly, SameSite=Lax). 바꾸는 요청은 `X-CSRF-TOKEN`을 붙인다(`GET /auth/csrf`). 계정 계약 v1과 같다.
- 오류 본문: `{ "code": "...", "message": "..." }`. 상태 코드는 아래 표를 따른다.

| 상태 | 뜻 | 앱이 하는 일 |
|---|---|---|
| 400 | 형식이 틀림 | 입력 오류를 보인다 |
| 401 | 로그인 안 됨·만료 | 로그인 화면으로 |
| 403 | CSRF 실패 | 토큰을 다시 받고 한 번 재시도 |
| 404 | 없음 또는 남의 것 | "찾을 수 없어요" |
| 409 | 중복·순서 충돌(같은 ID에 다른 본문 등) | 화면을 새로 고친다 |
| 503 | 서버 일시 불가 | 잠시 뒤 재시도 |

### 2.2 계정 (`auth`) — 계정 계약 v1 그대로

| 경로 | 요청 | 응답 |
|---|---|---|
| `GET /auth/csrf` | — | `{header_name, token}` |
| `POST /auth/register` | `{email, password, profile, consents}` | 사용자, 로그인 쿠키 |
| `POST /auth/login` | `{email, password}` | 사용자, 로그인 쿠키 |
| `GET /auth/me` | — | `{user_id, email, profile}` |
| `POST /auth/logout` | — | 204 |
| `PUT /auth/password` | `{current_password, new_password}` | 204 |
| `DELETE /auth/account` | `{password}` | 204. 측정 중이면 서버가 종료한다 |
| `POST /auth/withdrawal/cancel` | `{email, password}` | 사용자 |

- `consents`: `[{type: "C1".."C6", version, agreed}]`. 항목은 [동의 제안서](consent-proposal.md) 1장. 학습용 동의는 없다(실제 서비스는 학습용 데이터를 받지 않는다).

### 2.3 설정 (`api`)

| 경로 | 요청 | 응답 |
|---|---|---|
| `GET /settings` | — | `{threshold, alerts_on}` |
| `PUT /settings` | `{threshold, alerts_on}` | 저장한 값 |

- `threshold`: 0.5~0.95, 소수 셋째 자리까지. 화면 3단계는 0.80·0.70·0.60이고 기본은 0.70이다.
- `alerts_on`: 「자세 알림」 켜기·끄기. 다음 측정의 `alert_enabled`가 된다. 저장 칸은 DB와 정한다(FE 제안서 N16).
- 판정 시간 규칙(확정 3초·복귀·재알림)은 서버 상수라 앱 설정에 없다. 소리는 저장하지 않는다.
- 팀 API의 `/workspace`(설정 + 기록 묶음)는 이것과 2.6 기록으로 나눈다(10/13 결정).

### 2.4 기준 자세 (`api`)

| 경로 | 요청 | 응답 |
|---|---|---|
| `GET /baseline` | — | `{baseline_id, registered_at}`. 없으면 404 |

- 등록은 WebSocket 등록 연결로 한다(3.3). 앱은 등록 결과를 받은 뒤 이것을 다시 부른다.

### 2.5 측정 세션 (`api`)

| 경로 | 요청 | 응답 |
|---|---|---|
| `PUT /sessions/{session_id}` | `{frame: {width, height}}` | 201 새로 만듦 / 200 같은 요청 재전송. `{session_id, started_at: null}` |
| `POST /sessions/{session_id}/end` | `{end_ms}` | 200. 이미 끝난 세션이어도 200 |

- `session_id`는 앱이 만든 UUID다(DB `client_session_uuid`, 10/13 결정). 응답을 못 받고 다시 보내도 세션이 둘로 생기지 않는다. `/sessions`는 만들기·종료만 맡고, 끝난 세션 조회는 `/records`(2.6)다.
- 정책(threshold·알림)과 기준 자세는 서버가 그 사용자의 현재 값을 복사한다. 앱이 보내지 않는다. 기준 자세가 없으면 409 `NO_BASELINE`.
- `started_at`은 WebSocket `hello`를 받을 때 정해진다(3.1). 그래서 만들 때는 비어 있다.
- 종료는 보통 WebSocket `end`로 한다. `POST .../end`는 연결이 끊겨 `end`를 보낼 수 없을 때만 쓴다. 서버 안에서는 `ws`가 `session_ended`를 낸다.

### 2.6 기록 (`api`)

| 경로 | 요청 | 응답 |
|---|---|---|
| `GET /records?date=YYYY-MM-DD` | 날짜(KST). 없으면 오늘 | 그날 세션 목록 `[{session_id, started_at, ended_at, end_reason, summary}]`, 시작 시각 내림차순 |
| `GET /records/{session_id}` | — | 세션 하나: `{session_id, started_at, ended_at, end_reason, summary, events, excluded}` |
| `DELETE /records/{session_id}` | — | 204. 그 세션과 사건·알림을 지운다 |

- 당일 화면은 세션마다 따로 보인다. 같은 날 측정을 합치지 않는다(FE 제안서 1장 4번).
- **5분 미만 세션은 저장하지 않는다(10/12 회의 결정).** 목록·지난 통계에 나오지 않고 `GET /records/{id}`는 404다. 그 세션의 결과는 WebSocket으로 받은 마지막 `progress`·`decision`으로만 종료 화면에 보인다.
- `summary`(세션 하나, 서버 계산):

| 필드 | 뜻 |
|---|---|
| `total_ms` | 측정 시간(시작~종료) |
| `valid_ms` | 유효 측정 시간 = 측정 시간 − 제외 구간 |
| `good_ms` | 바른 자세 시간 |
| `good_ratio` | `good_ms ÷ valid_ms`. `valid_ms`가 0이면 `null` |
| `excluded_ms` | `{pause, absence, unmeasurable}` 사유별 제외 시간 |
| `collapse_count` | 이탈 사건 수 |
| `alert_count` | 실제로 표시된 알림 수 |
| `interval_min_ms`, `interval_max_ms` | 이탈 사이 간격의 최소·최대. 사건이 2개 미만이면 `null` |
| `recovery_mean_ms` | 평균 회복 시간. 회복이 없으면 `null` |

- `events`: `[{event_seq, started_at_ms, confirmed_at_ms, ended_at_ms, end_reason, alerts: [{attempt_seq, at_ms, delivered, suppress_reason}]}]`. 시각은 `t_ms` 기준이다.
- `excluded`: `[{start_ms, end_ms, reason}]`. `reason`은 `PAUSE`·`ABSENCE`·`UNMEASURABLE`.
- 측정 중인 세션은 목록에 `ended_at: null`로 나온다. 앱은 측정 중에는 WebSocket 값을 쓴다.
- 앱이 기록을 만들어 올리던 `POST /records`는 없앤다. 기록은 서버 판정 결과다.

### 2.7 지난 통계 (`api`)

| 경로 | 요청 | 응답 |
|---|---|---|
| `GET /stats/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` | 날짜 범위(KST, 최대 92일) | `[{date, valid_sec, good_sec, good_ratio, session_count, event_count, alerted_event_count, interval_min_sec, interval_max_sec, recovery_mean_sec}]` |

- 지난 날짜만 온다(어제까지). 오늘은 `GET /records`로 세션마다 본다.
- 측정이 없는 날은 빠진다. 앱이 빈 날을 채워 그린다.
- 간격 최소·최대와 회복 시간은 `daily_stat`에 칸을 더해 J3이 계산한다(10/13 결정, FE 제안서 N21). V2.1에는 아직 칸이 없어, DB에 칸이 생긴 뒤 계산 로직을 만든다. 그 전에는 이 세 필드가 `null`이다.
- 전날 합산은 J3이 03:00에 돌아 00:00~03:00에는 없다(FE 제안서 N20).

## 3. WebSocket

### 3.1 연결과 시작

- 주소: `/ws`. 연결 하나가 측정 한 번(또는 등록 한 번)을 맡는다.
- 연결 뒤 앱이 처음 보내는 것은 `hello`다. 다른 메시지가 먼저 오면 서버는 `closed(bad_request)`로 닫는다.
- 측정: 앱은 `PUT /sessions/{id}`로 세션 행을 만든 뒤 연결한다. 서버가 첫 `hello`를 받은 시각이 `started_at`이고, 앱은 `hello`를 보낸 순간을 `t_ms` 0으로 둔다.
- 재연결: 같은 `session_id`로 다시 `hello`를 보낸다. 시작 시각은 바뀌지 않는다.

### 3.2 앱 → 서버

| `type` | 본문 | 언제 |
|---|---|---|
| `hello` | `{session_id, purpose: "measure" \| "calibration", last_event_id, last_acked_sequence}` | 연결 직후 한 번. 재연결이면 마지막으로 받은 사건 번호와 `ack` 번호를 넣는다 |
| `features` | 좌표 묶음 `posture.frames.v1`(FE 제안서 2.1): `{sequence, start_ms, end_ms, phase, width, height, frames}` | 0.5초마다 한 건 |
| `end` | `{end_ms}` | 측정 종료 |

- `features`라는 이름은 아키텍처 v5.1을 따른다. 본문은 특징값이 아니라 좌표다.
- 판정 불가 프레임은 `frames[].flag: "position_unknown"`을 붙인다.
- 재전송: `ack`를 못 받은 묶음은 같은 `sequence`로 다시 보낸다. 서버는 중복을 버린다.
- 등록 연결(`purpose: "calibration"`)에서는 `phase: "calibration"` 묶음만 보내고 `end`는 보내지 않는다.

### 3.3 서버 → 앱

| `type` | 본문 | 앱이 하는 일 |
|---|---|---|
| `ack` | `{last_sequence}` | 재전송 대기열에서 지운다 |
| `observation` | `{sequence, valid, collapse_probability, invalid_reason}` | 실시간 상태와 안내 문구 |
| `progress` | `{last_sequence, paused, summary}` (`summary`는 2.6과 같은 필드) | 측정 시간·비율 등 숫자 |
| `decision` | `{event_id, kind, t_ms, summary}` | 사건 기록. `kind`: `collapse_confirmed`·`reminder`·`recovery_confirmed`·`interrupted`·`session_ended`·`excluded_started`·`excluded_ended` |
| `alert` | `{event_id, kind}` | 토스트·소리 |
| `stalled` | `{since_ms}` | "분석이 잠시 멈췄어요" |
| `calibration_result` | `{status: "ok" \| "failed", reason, baseline_id, registered_at}` | 등록 결과. 뒤이어 `closed(ended)` |
| `closed` | `{reason}` | 아래 표 |

| `closed.reason` | 뜻 | 앱이 하는 일 |
|---|---|---|
| `ended` | 정상 종료(측정 `end` 처리 끝, 등록 끝) | 결과 화면 |
| `unauthorized` | 로그인 만료 | 로그인 화면. 측정은 서버에서 이어지지 않는다 |
| `not_owner` | 남의 세션 | 오류 표시 |
| `no_baseline` | 등록한 자세 없음 | 「자세 등록」으로 안내 |
| `session_lost` | 서버가 세션을 잃음 | 기록 조회로 마무리 |
| `server_shutdown` | 서버 재시작 | 재연결 시도 |
| `bad_request` | 형식 오류 | 오류 표시, 재연결하지 않음 |

- 재연결하면 서버는 `last_event_id` 뒤의 `decision`을 먼저 보내고 최신 `progress`를 마지막에 보낸다. `observation`과 `alert`는 다시 보내지 않는다.
- 종료: 앱은 `end` 뒤 최종 `decision`과 `closed(ended)`를 받을 때까지 연결을 유지한다. 10초 안에 안 오거나 끊기면 `GET /records/{id}`로 종료 화면을 그린다. 5분 미만 세션이라 404면 마지막으로 받은 `progress`로 그리고 "5분 미만 측정은 기록에 남지 않아요"를 보인다.

## 4. 측정 한 번의 흐름

```
1  GET  /api/v1/baseline                 → 200 (없으면 404 → 「자세 등록」 안내)
2  PUT  /api/v1/sessions/{uuid}          → 201
3  WS   /ws  ─ hello{purpose:"measure"}  → (서버: started_at, session_started 발행)
4        ─ features × n   ⇄  ack · observation · progress · decision · alert
5        ─ end{end_ms}    ←  decision(session_ended) · closed(ended)
6  GET  /api/v1/records/{uuid}           (끊겼을 때만)
```

## 5. 같이 정할 것

정해진 것(10/13): Q1 세션은 앱 UUID로 `PUT`, Q3·Q4 `/settings`·`/records` 분리, Q6 지난 통계 칸은 `daily_stat`에 추가. 본문에 반영했다.

| # | 질문 | FE 안 |
|---|---|---|
| Q2 | 세션 시작 때 앱이 보내는 것 | 영상 크기만. 정책·기준은 서버가 복사한다 |
| Q5 | `progress`·기록의 `summary` 필드 | 2.6 표. 실시간과 기록이 같은 이름을 쓴다 |
| Q7 | 등록 연결의 ID | 등록마다 앱이 새 UUID를 `hello.session_id`에 넣는다(BE 답변의 Kafka 키와 같게) |
| Q8 | 경로 앞부분 | `/api/v1/**`, `/ws` |
