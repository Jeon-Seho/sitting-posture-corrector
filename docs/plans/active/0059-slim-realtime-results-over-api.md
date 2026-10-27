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
| `observation` | `collapse_probability`, `valid`, `invalid_reason`, **`alerting`·`keep_rate`(새로)** | 점수, 서버만 아는 판정 불가 안내, 「자세가 흐트러졌어요」 켜고 끄기, 측정 중 유지율 |
| `alert` | `kind`(`collapse_confirmed`·`reminder`), `event_id`, `deviation_type` | 토스트·소리·데스크톱 팝업 |
| `stalled` | `since_last_sequence` | 「분석이 잠시 멈췄어요」 |
| `closed` | `reason`, `ended_at` | 종료 처리, 기록 종료 시각 |

**뺄 것:** `progress` 전체(요약 15개·`paused_reason`), `decision` 전체(사건 상세·요약), `ack`, `observation`의 `sequence`·`start_ms`·`end_ms`·`phase`·`valid_ms`·`deviation_type`·`model_version`·`schema_version`.

**`observation.alerting`(새 필드):** 서버가 지금 붕괴를 확정한 상태인지(확정 뒤 회복·중단·종료 전까지 참). 서버 `SessionEngine`이 이미 들고 있는 상태라 필드 하나다. 이것으로 회복 신호를 따로 두지 않는다 — 회복을 앱이 3초 세서 정하면 ADR 0021(복귀 대기는 서버)과 어긋나고, 서버의 다시 알림·DB `collapse_event.recovered_at`과 화면이 달라진다.

### 앱이 셀 것

| 값 | 방법 |
|---|---|
| 측정 시계 | `ready` 받은 시각부터 앱 시계 차이(1초씩 더하지 않음 — 숨은 탭에서 느려짐). 전체 시간이라 쉬기·자리 비움·판정 불가를 빼지 않는다(10/27) |
| 알림 횟수 | 받은 `alert` 개수 |

측정 중 숫자는 앱 값이고, 결과 화면·기록은 끝난 뒤 받은 서버 값이다. 끝날 때 몇 초 달라질 수 있다.

### 끝난 뒤 API로

`closed(ended)`(또는 `closed`가 10초 안에 안 오면, 지금처럼) S4 `GET /v2/sessions/{id}`(서버에 있음)로 `SessionView`를 한 번 받는다. 요약 15개(전체·유효·바른 자세·흐트러진·확인 못 한 시간, 쉬기·자리 비움·누락, 유지율, 시간당 이탈, 평균 간격, 회복 시간)와 사건 목록이 들어 있다. 결과 화면과 오늘 로컬 기록(ADR 0027)이 이 값을 쓴다. 나중에 R1b가 생기면 바꿀 수 있다.

## 바꾸는 순서 (두 단계 — 어느 쪽이 먼저 배포돼도 깨지지 않게)

**1단계 — 더하기만 (FE·BE 따로 해도 됨)**
- BE: `observation.alerting`·`keep_rate` 추가(필드 추가라 지금 앱은 무시).
- FE: 측정 시계·알림 횟수를 앱이 세고, 「흐트러졌어요」는 `observation.alerting`이 있으면 그것을, 없으면 지금처럼 `decision`을 본다. 종료 뒤 항상 S4로 결과를 받아 기록을 만든다(`progress`·`decision` 요약은 S4 실패 때만 대신 씀). 측정 중 화면에서 요약 칸(유지율 등)은 정할 것 2에 따라 숨기거나 남긴다.
- 이 단계까지는 계약에서 아무것도 빼지 않는다.

**2단계 — 빼기 (FE 1단계 배포, 서버 자정 끊기, 리프레시 토큰이 모두 된 뒤 BE — 정한 것 3·4)**
- BE: `progress`·`decision`·`ack`를 보내지 않고 `observation`을 위 필드로 줄인다. WS 계약 `schema_version`을 올린다(`hello`의 `2.0` → `2.1`, 서버는 한동안 둘 다 받음 — BE와 정하기).
- FE: 계약 사본·예시·계약 시험(`tests/test_realtime_ws_v2.py`) 갱신, 1단계의 「없으면 `decision`」 대체 경로 삭제.
- Kafka 모드(`ws`, 계획 0031): 같은 메시지 구성으로(PM).

## 정한 것과 남은 것 (10/27 klaod-tech)

1. **측정 시계: 전체 시간으로 정함.** `ready`부터 끝까지, 쉬기·자리 비움·판정 불가를 빼지 않은 가공 없는 값이다. 유효 시간은 결과 화면(S4)에서.
2. **측정 중 유지율: `keep_rate` 하나를 남기기로 정함.** 사용자가 시간 대신 퍼센트 하나로 바로 알 수 있어서다. `observation`에 `keep_rate`를 더하고(1단계), 2단계에서 `progress`를 빼도 남는다. 앱이 직접 계산하지 않는다(「바른 자세」 경계가 서버 규칙).
3. **자정(확인 결과·FE 의견):** 자정 끊기·리프레시 토큰은 BE가 한다. develop 기준 서버에는 아직 자정 끊기(`day_changed`)가 없고, Spark J2(매일 00:00, Kafka가 아니라 MySQL을 읽는 배치)도 구현 전이다. J2는 **세션 시작 시각의 KST 날짜**로 집계한다(`database/README.md` 「일별 통계」). FE 의견(ADR 0029 A안 그대로): 서버가 00:00에 `closed(day_changed)`로 닫으면 앱은 카메라·화면을 그대로 두고 새 S1·WS를 바로 시작해 사용자에게는 끊기지 않은 것처럼 보인다(기록은 날마다 하나). 이어 붙이기가 실패할 수 있는 곳은 새 S1이다 — 로그인 30분이 지났으면 401이므로 **리프레시 토큰이 자정 끊기보다 먼저**여야 한다. 실패하면 자정까지는 이미 저장됐으므로 「자정이 지나 측정을 이어가지 못했어요」로 끝낸다. BE에 확인: J2가 00:00 정각에 돌면 자정에 닫히는 세션과 겹치므로 몇 분 뒤(예: 00:10)에 돌리기. 「오늘」 날짜는 이미 A4(로그인·앱 시작·창 돌아올 때)의 `today`로 받는다. PR #64의 앱 날짜 나누기는 자정 끊기가 생기면 지운다(lellon0403과 확인).
4. **S4가 실패하는 경우(확인 결과):** 연결이 끊기면(어떤 이유든) 서버가 마지막으로 받은 구간 끝에서 세션을 끝내고 DB에 저장한다(`RealtimeHandlerV2.afterConnectionClosed`, ADR 0024). 서버를 내릴 때도 같다(`@PreDestroy`). 그래서 S4가 실패해도 **서버 기록은 남고, 앱이 결과 숫자를 못 받는 것만** 문제다. 로그인 만료는 WS 시작(`hello`)에서만 검사하므로 30분이 지나도 측정은 끊기지 않고, 끝난 뒤 REST(S4·R1)만 401이 된다.
   - ① 로그인 30분 만료 → 리프레시 토큰(BE)으로 해결. 앱은 401을 받으면 갱신 요청을 한 번 보내고 원래 요청을 다시 보낸다.
   - ② 서버 재배포 → 의도된 끊김(측정 종료·저장). 자정과 겹치지 않게 배포하기만 BE에 부탁.
   - ③ 종료 뒤 30분 지나 조회 → 실제로는 드물어(사용자가 끈 경우) 따로 처리하지 않는다.
   - ④ 네트워크 끊김·10초 초과 → 의도된 예외. 끊기기 전까지 서버에 저장된다.
   - ⑤ 종료를 누르고 결과가 오기 전(최대 10초)에 앱을 닫음 → 서버에는 저장되지만 오늘 로컬 기록(ADR 0027)에 그 측정이 빠진다. 다음 날 T1에는 나온다. 막으려면 종료 중 창 닫기를 잠깐 막거나, 앱 시작 때 R1 오늘 기록으로 채운다(lellon0403과 정할 것).
   - 실패 때 화면: 앱 측정 시계·알림 횟수·서버 시각으로 「종료 미확인」 기록을 남기고, R1을 읽을 때 DB 값으로 덮어쓴다. 2단계(`progress` 빼기)는 리프레시 토큰 뒤에.
5. **판정 불가 보내는 형식: 그대로 둠(10/27).** `valid: false`(+`p: null`)는 좌표가 없어 서버가 항상 `unmeasurable`로 센다. 서버의 `head_turn`은 좌표가 있을 때만 나온다(`FrameFeatures`: 코와 양 귀 중점의 차이를 기준 자세와 비교, 0.15 초과). 서버 `observation.valid`·`invalid_reason`은 앱이 좌표를 보낸 프레임에서 서버가 찾은 판정 불가(고개 돌림, 정확도 0.65 미만, 가장자리 2%, 어깨 폭 10% 미만, 귀 없음)를 알리는 데 남긴다.
6. **S1 `policy` 빼기로 정함(10/27, BE-11).** 지금 서버는 앱이 보낸 `policy`를 계정의 정책(`account.policyId`)과 비교해 다르면 409 「settings changed」, 같으면 그 값으로 측정 규칙을 고정한다. 서버가 이미 아는 값이라 앱이 보내지 않고, 서버가 계정 정책으로 고정한다. 3초(무너짐 확정)·3초(회복)·60초(다시 알림)는 지금처럼 **서버 `SessionEngine`이 프레임 시간(`t_ms`)으로 센다** — 앱은 세지 않는다(ADR 0021). 앱은 설정 화면 표시에만 W1 값을 쓴다. 순서: BE가 `policy` 없는 S1을 받게 한 뒤 FE가 보내지 않는다.

## 이미 정한 것 (10/27)

- 판정 불가 프레임은 좌표 없이 신호만(ADR 0032). 앱이 정한 판정 불가는 서버를 기다리지 않고 바로 표시(`LiveState.placeable`).
- 점수·붕괴 확정·다시 알림·회복과 그 시간 규칙은 서버(ADR 0021). 앱은 확정·회복을 세지 않는다.
- 서버는 받은 프레임을 자체적으로 묶어 판정한다(BE 10/27). 묶은 뒤 확인할 것은 제안서 BE-8.

## 작업 단계

- [x] 측정 시계(전체)·측정 중 유지율(`keep_rate`) 정하기(10/27 klaod-tech)
- [ ] 이 계획을 팀장·BE에 공유(제안서 BE-10·BE-11로), PR #64 날짜 나누기·종료 중 앱 닫기(정한 것 4⑤)를 lellon0403과 정하기
- [ ] BE: S1 `policy` 없이 받기(BE-11) → FE: S1에서 `policy` 빼기
- [ ] BE 1단계: `observation.alerting`·`keep_rate`
- [ ] FE 1단계: `LiveSession`(측정 시계·알림 횟수, `alerting` 우선), 종료 뒤 S4로 기록(`useSessionPersistence` `finish`), 측정 화면 요약 칸 정리(lellon0403 확인), 시험
- [ ] FE: 가짜 서버(`frontend/scripts/fake-server.mjs`)를 새 메시지 구성으로 바꿔 화면 확인
- [ ] BE 2단계: `progress`·`decision`·`ack` 중단, `observation` 줄이기, `schema_version`
- [ ] FE 2단계: 계약 사본·예시·계약 시험, 대체 경로 삭제
- [ ] 연동 명세 1·4·5장, 이 계획 결과 기록

## 검증 결과와 남은 한계

(작업 뒤 적는다)
