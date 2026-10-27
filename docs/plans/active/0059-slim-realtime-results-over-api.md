# 실시간 WS는 측정 중 화면에 필요한 것만, 결과 상세는 API로

- 상태: draft (2026-10-27, klaod-tech 제안. 팀장 방향 「WS는 좌표 같은 기본값 말고는 최대한 받지 않는다」와 같음 — BE 합의 전)
- 담당: FE(klaod-tech), 계약·서버는 BE(김유진), Kafka 모드는 PM, 화면 표시는 lellon0403과 확인
- 시작일: 2026-10-27
- 관련: [연동 명세](../../design/api-ws-spec.md) 4·5장, [WS v2 계약](../../../contracts/realtime/realtime-ws.v2.schema.json), [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md)(판정은 서버), [ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)(오늘 기록은 앱이 모은 서버 결과), [ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)(자정), [ADR 0032](../../decisions/0032-unmeasurable-frame-signal-only.md)(판정 불가 신호), [FE 제안서](../../design/fe-server-proposal.md) BE-8(프레임마다 전송)

## 문제

측정 중 서버는 약 1초마다 `progress.summary`(숫자 15개)를, 사건마다 `decision`(사건 상세 + 요약 15개)을 보낸다. 측정 중 화면이 실제로 실시간으로 바꾸는 것은 점수, 판정 불가 표시, 「흐트러졌어요」 상태, 알림뿐이고 나머지는 결과 화면·기록에서만 쓴다. 앱이 프레임마다 보내게 되며(BE-8) 메시지가 늘어난 만큼, 측정 중 WS는 실시간 화면에 필요한 것만 남기고 결과는 측정이 끝난 뒤 API로 한 번 받는다.

## 목표 모습

### 앱 → 서버 (바꾸지 않음)

`hello`, 프레임마다 `features`(관절 9개, 판정 불가는 `p: null`·`valid: false`), `phase`(`rest`·`away`), `end`. 이미 「좌표 같은 기본값」만이다.

### 서버 → 앱 (측정 중)

| 메시지 | 남길 필드 | 화면에서 하는 일 |
|---|---|---|
| `ready` | `session_id`, `started_at` | 측정 시작, 기록 시작 시각 |
| `observation` | `collapse_probability`, `valid`, `invalid_reason`, **`alerting`(새로)** | 점수, 서버만 아는 판정 불가 안내, 「자세가 흐트러졌어요」 켜고 끄기 |
| `alert` | `kind`(`collapse_confirmed`·`reminder`), `event_id`, `deviation_type` | 토스트·소리·데스크톱 팝업 |
| `stalled` | `since_last_sequence` | 「분석이 잠시 멈췄어요」 |
| `closed` | `reason`, `ended_at` | 종료 처리, 기록 종료 시각 |

**뺄 것:** `progress` 전체(요약 15개·`paused_reason`), `decision` 전체(사건 상세·요약), `ack`, `observation`의 `sequence`·`start_ms`·`end_ms`·`phase`·`valid_ms`·`deviation_type`·`model_version`·`schema_version`.

**`observation.alerting`(새 필드):** 서버가 지금 붕괴를 확정한 상태인지(확정 뒤 회복·중단·종료 전까지 참). 서버 `SessionEngine`이 이미 들고 있는 상태라 필드 하나다. 이것으로 회복 신호를 따로 두지 않는다 — 회복을 앱이 3초 세서 정하면 ADR 0021(복귀 대기는 서버)과 어긋나고, 서버의 다시 알림·DB `collapse_event.recovered_at`과 화면이 달라진다.

### 앱이 셀 것

| 값 | 방법 |
|---|---|
| 측정 시계 | `ready` 받은 시각부터 앱 시계 차이(1초씩 더하지 않음 — 숨은 탭에서 느려짐). 쉬기·자리 비움을 뺄지는 정할 것 1. 측정 불가는 빼지 않는다(앱이 일부만 알아 서버 값과 맞지 않음) |
| 알림 횟수 | 받은 `alert` 개수 |

측정 중 숫자는 앱 값이고, 결과 화면·기록은 끝난 뒤 받은 서버 값이다. 끝날 때 몇 초 달라질 수 있다.

### 끝난 뒤 API로

`closed(ended)`(또는 `closed`가 10초 안에 안 오면, 지금처럼) S4 `GET /v2/sessions/{id}`(서버에 있음)로 `SessionView`를 한 번 받는다. 요약 15개(전체·유효·바른 자세·흐트러진·확인 못 한 시간, 쉬기·자리 비움·누락, 유지율, 시간당 이탈, 평균 간격, 회복 시간)와 사건 목록이 들어 있다. 결과 화면과 오늘 로컬 기록(ADR 0027)이 이 값을 쓴다. 나중에 R1b가 생기면 바꿀 수 있다.

## 바꾸는 순서 (두 단계 — 어느 쪽이 먼저 배포돼도 깨지지 않게)

**1단계 — 더하기만 (FE·BE 따로 해도 됨)**
- BE: `observation.alerting` 추가(필드 추가라 지금 앱은 무시).
- FE: 측정 시계·알림 횟수를 앱이 세고, 「흐트러졌어요」는 `observation.alerting`이 있으면 그것을, 없으면 지금처럼 `decision`을 본다. 종료 뒤 항상 S4로 결과를 받아 기록을 만든다(`progress`·`decision` 요약은 S4 실패 때만 대신 씀). 측정 중 화면에서 요약 칸(유지율 등)은 정할 것 2에 따라 숨기거나 남긴다.
- 이 단계까지는 계약에서 아무것도 빼지 않는다.

**2단계 — 빼기 (FE 1단계가 배포된 뒤 BE)**
- BE: `progress`·`decision`·`ack`를 보내지 않고 `observation`을 위 필드로 줄인다. WS 계약 `schema_version`을 올린다(`hello`의 `2.0` → `2.1`, 서버는 한동안 둘 다 받음 — BE와 정하기).
- FE: 계약 사본·예시·계약 시험(`tests/test_realtime_ws_v2.py`) 갱신, 1단계의 「없으면 `decision`」 대체 경로 삭제.
- Kafka 모드(`ws`, 계획 0031): 같은 메시지 구성으로(PM).

## 정할 것

1. **측정 시계 기준(lellon0403):** 시작부터 전체 / 전체 − 쉬기·자리 비움.
2. **측정 중 유지율(팀장·lellon0403):** ① 측정 중에는 숨기고 결과에서만(WS에서 완전히 뺌, 권장 — 팀장 방향) ② 측정 중에도 보이려면 `observation`에 `keep_rate` 하나만 남김. 앱이 직접 내는 것은 「바른 자세」 경계가 서버 규칙이라 하지 않는다.
3. **자정 날짜 나누기:** develop PR #64에서 가져온 날짜 나누기(`useSessionPersistence` `observe`, ADR 0031)는 측정 중 `progress` 요약으로 자정에서 나눈다. `progress`를 빼면 재료가 없어진다. ① 서버가 KST 자정에 측정을 끊으면(ADR 0029 A안) 측정 하나는 하루뿐이라 필요 없음 — 2단계를 자정 끊기 뒤로 ② 그 전에 2단계를 하면 자정을 넘긴 측정은 시작한 날에 모두 넣음. 회의(자정 A안·리프레시 토큰)와 같이 정하기.
4. **S4 실패 때:** 마지막으로 아는 값(앱 측정 시계·알림 횟수, 서버 시각)으로 「종료 미확인」 기록을 남기고 다음에 R1을 읽을 때 덮어쓴다. 요약 숫자가 비므로 기록 상세는 「서버 확인 전」으로 표시.
5. **서버만 아는 판정 불가 줄이기(FE, 팀장 확인):** 정확도·가장자리·거리 검사를 앱이 하면(ADR 0021 예외 「측정이 안 되는 모든 경우」 안) `valid`·`invalid_reason`은 고개 돌림만 남는다. 이 계획과 따로 해도 된다.
6. **S1 `policy`:** REST라 이 계획과 별개. 서버가 계정 설정(W1·W2)에서 읽게 하면 앱이 안 보내도 됨 — BE 여유가 생기면.

## 이미 정한 것 (10/27)

- 판정 불가 프레임은 좌표 없이 신호만(ADR 0032). 앱이 정한 판정 불가는 서버를 기다리지 않고 바로 표시(`LiveState.placeable`).
- 점수·붕괴 확정·다시 알림·회복과 그 시간 규칙은 서버(ADR 0021). 앱은 확정·회복을 세지 않는다.
- 서버는 받은 프레임을 자체적으로 묶어 판정한다(BE 10/27). 묶은 뒤 확인할 것은 제안서 BE-8.

## 작업 단계

- [ ] 이 계획을 팀장·BE에 공유하고 정할 것 1~3 정하기(제안서 BE-10으로)
- [ ] BE 1단계: `observation.alerting`
- [ ] FE 1단계: `LiveSession`(측정 시계·알림 횟수, `alerting` 우선), 종료 뒤 S4로 기록(`useSessionPersistence` `finish`), 측정 화면 요약 칸 정리(lellon0403 확인), 시험
- [ ] FE: 가짜 서버(`frontend/scripts/fake-server.mjs`)를 새 메시지 구성으로 바꿔 화면 확인
- [ ] BE 2단계: `progress`·`decision`·`ack` 중단, `observation` 줄이기, `schema_version`
- [ ] FE 2단계: 계약 사본·예시·계약 시험, 대체 경로 삭제
- [ ] 연동 명세 1·4·5장, 이 계획 결과 기록

## 검증 결과와 남은 한계

(작업 뒤 적는다)
