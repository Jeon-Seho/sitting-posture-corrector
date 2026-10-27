# 실시간 WS는 측정 중 화면에 필요한 것만, 결과 상세는 API로

- 상태: draft (2026-10-27, klaod-tech 제안 — 팀장·BE와 정하기 전)
- 담당: FE(klaod-tech), 계약 변경은 BE(김유진)와 함께
- 시작일: 2026-10-27
- 관련: [연동 명세](../../design/api-ws-spec.md) 4·5장, [WS v2 계약](../../../contracts/realtime/realtime-ws.v2.schema.json), [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md)(판정은 서버), [ADR 0027](../../decisions/0027-today-records-from-collected-server-results.md)(오늘 기록은 앱이 모은 서버 결과), [FE 제안서](../../design/fe-server-proposal.md) BE-8(프레임마다 전송)

## 문제

develop의 기록 상세 화면(10/27 확인)에 보이는 값 대부분은 측정이 끝난 뒤에만 보면 된다. 그런데 지금은 측정 중 WS로 약 1초마다 오는 `progress.summary`(숫자 15개)와 `decision`의 `summary`에 모두 실려 온다. 프레임마다 보내기(BE-8)로 메시지가 늘어난 만큼 측정 중 WS에는 그때 화면에 필요한 것만 남기고, 나머지는 측정이 끝난 뒤 API로 한 번 받는다.

## 지금 측정 중 WS로 받아 쓰는 것 (V3 `LiveSessionPage`)

| 화면 값 | 지금 출처 | 측정 중에 필요한가 |
|---|---|---|
| 자세 점수, 「자세를 확인할 수 없어요」 | `observation`(`collapse_probability`·`valid`·`invalid_reason`) | 필요 |
| 바른 자세 유지 비율 | `summary.keep_rate`(= `normal_ms ÷ valid_ms`) | **필요** |
| 측정한 시간(유효), 측정 시계(전체) | `summary.valid_ms`·`total_ms` | **필요** — 앱이 더하는 것으로 바꿀 후보 |
| 알림(토스트·소리·팝업), 「자세가 흐트러졌어요」 | `alert`, `decision`(`collapse_confirmed`·`recovery_confirmed` 등) | **필요** |
| 자세 이탈 건수·확정/재알림 횟수 | `summary.collapse_count`·`alert_count` | 알림 횟수만 — `alert` 개수로 앱이 셀 수 있음 |
| 시간당 이탈, 발생 간격 평균, 최초 알림부터 복귀 | `summary.events_per_hour`·`mean_interval_ms`·`mean_recovery_ms` | 아니요 — 결과 화면 |
| 흐트러진 시간, 확인 못 한 시간, 휴식·자리 비움·누락 | `summary.deviation_ms`·`unknown_ms`·`rest_ms`·`away_ms`·`missing_ms` | 아니요 — 결과 화면(측정 중 「집계 제외」 칸은 뺄지 화면 담당과 정하기) |
| 서버 확정 사건 표 | `decision.event` 목록 | 아니요 — 결과 화면 |

## 바꿀 안

1. **측정 중 WS에 남길 것:** `observation`(점수), `alert`(알림), `progress`의 `keep_rate`. `decision`은 「흐트러졌어요/돌아왔어요」 표시에 필요한 `kind`·`event_id`만(또는 `alert`와 새 `recovered` 신호로 대신 — BE와 정하기). `closed`·`ready`·`stalled`·`ack`는 그대로.
2. **앱이 셀 것:** 측정 시간. 서버가 판정한 결과로 더하므로 앱이 판정하는 것은 아니다(ADR 0021 유지).
   - 측정 시계(전체 시간): `ready` 뒤 보낸 구간의 길이 합(앱 시계 `end_ms`). 지금 `total_ms`와 같은 값.
   - 측정한 시간(유효): `observation.valid`가 참인 구간의 `end_ms − start_ms` 합. 프레임마다 보내므로(BE-8) 프레임 단위로 정확하다. 서버 `valid_ms`와 같은 값이어야 하며, 끝난 뒤 API 값으로 덮어쓴다.
   - 알림 횟수: 받은 `alert` 개수.
3. **측정이 끝난 뒤 API로 받을 것:** 결과 화면·기록 상세의 나머지 전부. `closed(ended)`를 받으면 S4 `GET /v2/sessions/{id}`(서버에 있음)로 `SessionView` 전체(요약 15개·사건 목록)를 한 번 받아 기록(ADR 0027 로컬 사본)에 넣는다. 나중에는 R1b `GET /v2/records/{id}`로 바꿀 수 있다(BE-2).

## 판정 불가와 서버 응답 (10/27 정함)

- 앱이 정한 판정 불가(어깨가 안 보임·사람 없음, ADR 0021 10/12 예외)는 서버에 묻지 않고 앱이 바로 「자세를 확인할 수 없어요」를 띄운다 — 10/27 V3 반영(`LiveState.placeable`). BE가 바빠 서버 쪽 예외 처리는 만들지 않는다.
- 서버만 아는 판정 불가(고개 돌림, 코·어깨 정확도 0.65 미만, 화면 가장자리, 어깨 폭 10% 미만)는 아직 서버가 정하므로 `observation.valid`·`invalid_reason`(코드 `head_turn`·`unmeasurable`, 문구는 앱)이 필요하다. 이 검사까지 앱으로 옮기면 `valid`를 WS에서 뺄 수 있다 — ADR 0021 경계를 바꾸는 일이라 팀 합의(검사 함수 `shoulderCheck.ts` `measurable`과 기준 자세는 앱에 이미 있음).
- 판정 불가 프레임을 좌표 없이 상태만 보낼지(`p: null`, `valid: false`)는 HDFS·학습 데이터에서 빠지므로 ML(지성)·BE와 확인.
- S1 `policy`는 사용자 설정을 서버에 알려 그 측정의 판정 규칙(3초 확정 등)을 고정하는 값이다(서버의 값을 받아오는 것이 아님, 시간은 앱이 보낸 구간 길이로 셈). 서버가 계정 설정(W1·W2)을 이미 알고 다르면 409이므로, 빼고 서버가 계정에서 읽게 하는 것은 BE 여유가 생기면 정할 안건. 확정·알림 판정을 앱으로 옮기는 것은 ADR 0021과 DB 사건 기록이 어긋나 하지 않는다.

## 정할 것

- **「측정 시간」이 무엇인가:** 화면 문구는 「측정한 시간」인데 값은 유효 시간(`valid_ms`)이고 시계는 전체(`total_ms`)다. 측정 중에 둘 다 보일지, 하나만 보일지 화면 담당(lellon0403)과 정하기.
- **`keep_rate`도 앱이 낼 수 있다:** `observation`마다 바른 자세(`valid`이고 `collapse_probability` < `policy.threshold`) 시간을 더하면 되지만, 「바른 자세」의 경계는 서버 판정 규칙(정책·히스테리시스)이라 앱이 같은 값을 낸다고 보장할 수 없다 — 서버 값으로 받는 것을 권한다.
- **S4가 실패하면:** 지금처럼 마지막으로 받은 값으로 「종료 미확인」 기록을 남기고, 다음에 R1을 읽을 때 덮어쓴다. 측정 중 WS 요약이 줄어드는 만큼 그때 남는 값도 줄어든다(유지율·시간·알림 수만).
- **Kafka 모드(`ws`, 계획 0031):** 같은 메시지 구성으로.

## 작업 단계

- [ ] 팀장·BE와 1·2·3안 합의(제안서 BE-9로 올리기)
- [ ] BE: WS 계약 `progress`(요약 → `keep_rate`), `decision`(요약 빼기) 바꾸기. S4 응답은 그대로
- [ ] FE: `LiveSession` — 측정 시간·유효 시간·알림 수를 앱이 더하기, `progress`는 `keep_rate`만 읽기
- [ ] FE: 종료 뒤 S4로 결과 받기 → 결과 화면·`useSessionPersistence` `finish`가 S4 `SessionView`로 기록을 만들기(날짜 나누기 `observe`는 앱이 더한 시간으로)
- [ ] FE: 계약 시험·앱 시험, 가짜 서버(`frontend/scripts/fake-server.mjs`)로 화면 확인
- [ ] 연동 명세 4·5장, 이 계획 결과 기록

## 검증 결과와 남은 한계

(작업 뒤 적는다)
