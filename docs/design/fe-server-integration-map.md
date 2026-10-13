# 앱–서버 연결 지도

- 작성: 2026-10-13 (FE). 사용자 요청: "백엔드·서버와 연결해야 하는 부분을 확인해 미리 준비"
- 확인한 것: `develop`(`fa793ba`, DB V2.3), BE `feature/repo-backend-db-v2`(`0fcde59`), FE `lee_app2`(`690cc27`),
  [FE 제안서](fe-server-proposal.md), [실시간 계약 v1](../../contracts/realtime/README.md), [계정 계약](../../contracts/accounts.v1.md),
  [판정 불가 처리](https://github.com/Jeon-Seho/sitting-posture-corrector/blob/lee_app2/docs/design/unmeasurable-handling.md)(`lee_app2`)
- 연결 설정은 한곳에 모았다: `frontend/src/features/platform/serverConfig.ts`

앱은 BE가 만드는 입출구 서버 하나(`auth`·`api`·`ws`)와만 통신한다(아키텍처 v5). 판정은 서버가 하고
앱은 좌표와 사실(일시정지·카메라 끊김·종료)만 보낸다([ADR 0021](../decisions/0021-app-sends-information-server-judges.md)).

## 1. 기능별 상태

상태: **연결됨** = 앱 코드가 지금 BE API를 호출한다 · **준비됨** = 앱 쪽 코드·시험이 있고 서버만 붙이면 된다 ·
**로컬** = 서버가 없어 이 PC에만 둔다 · **대기** = 서버 결정이 먼저 필요하다.

| 기능 | 서버 쪽(경로·메시지) | 앱 위치 | 상태 | 기다리는 것 |
| --- | --- | --- | --- | --- |
| 로그인·가입·로그아웃·비밀번호·탈퇴 | `GET /v1/auth/csrf`·`/me`, `POST /register`·`/login`·`/logout`·`/withdrawal/cancel`, `PUT /password`, `DELETE /account` | `app/LocalServiceApp.tsx`, `features/auth/` | **로컬**(2026-10-13 계정 모드 삭제, 입력값 확인 없음) | BE `auth`, 가입 동의 6종 요청 형식(N9) |
| 프로필·설정 보관 | `GET`·`PUT /v1/workspace` | `features/storage/` | 로컬 | 「자세 알림」 저장 칸(N16, V2.2 되돌림) |
| 세션 만들기·보내기·끝내기·조회 | `PUT /v1/sessions/{id}`, `POST …/features`, `POST …/end`, `GET …`, `GET …/metadata` | `features/session/server/client.ts`·`controller.ts` | 연결됨(특징 변화량 형식) | 좌표 프레임으로 바꾸는 시점(F1) |
| 실시간 연결 | WebSocket `/v1/realtime`: 앱 `hello`·`features` → 서버 `ack`·`observation`·`progress`·`decision`·`alert`·`stalled`·`closed` | `features/session/realtime/client.ts` | 연결됨(개발, `VITE_REALTIME_URL`) | 좌표 메시지 이름(F1) |
| **좌표 프레임** `posture.frames.v1` | `ws` 메시지(이름 BE와 결정), 0.5초 1건, 관절 9개 그대로 | `features/session/realtime/frames.ts`, 계약 초안 `contracts/realtime/frames/` | **준비됨** | BE `ws`가 좌표를 받는 날(N5), 메시지 이름 |
| **판정 불가 표시**(10/12 회의) | 프레임의 `valid: false` (FE 제안 이름) | `frames.ts` + `features/camera/shoulderGrace.ts`(어깨 2초 유예) | **준비됨** | 필드 이름·기준 확정(판정 불가 처리 0장) |
| 일시정지·자리 비움 | 프레임 `phase: rest`·`away`, 빈 `frames` | `frames.ts` `setPhase` | 준비됨 | — |
| 측정 종료 뒤 최종 결과 | `ws end` → 최종 `decision` → `closed(ended)`. 10초 넘거나 놓치면 `GET /api/records/{id}` | — | **할 일**(F3) | `end` 확정(N4), `api` 종료 경로(BE S6) |
| 연결 끊김 | 앱은 재연결·재전송하지 않고 세션을 끝낸다([ADR 0022](../decisions/0022-session-ends-on-lost-connection.md)) | `features/connection/` | 구현됨 | **BE 공유 필요:** 제안서 1·2장의 "재연결 후 같은 순번 재전송"과 다르다. 서버도 끊긴 세션을 닫아야 한다 |
| 기록: 하루의 세션(기록 탭은 오늘, 달력 탭은 고른 날) | `GET /records?date=YYYY-MM-DD`, `GET /records/{id}` ([API 명세](api-ws-spec.md) 2.6) | `features/history/recordsSource.ts` `sessionsOn`, `DayRecord.tsx`, `LocalHistory.tsx`, `RecordCalendarPage.tsx` | **준비됨**(같은 모양, 지금은 이 PC 기록) | `api` 구현 |
| 달력: 날짜별 합계(월 달력·잔디·최근 7일·30일) | `GET /stats/daily?from&to`(≤ 92일, 어제까지) ([API 명세](api-ws-spec.md) 2.7) | `recordsSource.ts` `dailyStats`, `ActivityHeatmap.tsx`, `RecordCalendar.tsx` | **준비됨**(같은 모양, 지금은 이 PC 기록) | `api` 구현. 잔디는 13주(91일)라 한 번 요청, 달력은 달마다 요청. 오늘 칸은 `GET /records?date=오늘`로 채운다. 알림 총수(다시 알림 포함)는 API 행에 없어 `alerted_event_count`로 바꿔 보여야 한다 |
| **자세 등록 저장·조회** | 미정(제안서 2.3 ①~⑤) | `features/camera/savedBaseline.ts`(이 PC, 카메라별) | 로컬 | N1 등록 흐름·경로 |
| **가입·설정 동의 6종** | DB V2.3 `user_consent`. API 미정 | `features/auth/consents.ts`(회원가입 1단계 화면 `ConsentList.tsx`) | **준비됨**(선택은 이 PC에 저장) | 요청 형식(N9) |
| 알림 띄우기 | `ws alert`. 앱은 거르지 않는다 | `useServerSessionScreen.ts` `onNotifications`, 데스크톱 팝업 | 연결됨(받기) | 서버 어디서 판단할지(N6) |
| 등록 전 구도 확인 | 서버 없음(F7) | `useCamera` `framing`, `usePostureRegistration` | 구현됨 | — |
| 측정 시작 시각 | `monitor_session.started_at` = 앱 `t_ms` 0 | `FrameBatcher(origin)` | 준비됨 | N13 |

## 2. 연결 스위치

예전 계정 모드 스위치 `VITE_SERVER_ACCOUNTS`는 2026-10-13 지웠다. 로그인·가입은 BE `auth`가 생길 때까지 로컬이다.

| 변수 | 뜻 |
| --- | --- |
| `VITE_REALTIME_URL=ws://…` | 실시간 구간을 WebSocket(`/v1/realtime`)으로. 없으면 HTTP |
| `VITE_REALTIME_FRAMES=true` | 특징 변화량 대신 좌표 프레임을 보낸다. **아직 연결 안 함**(F1, BE 수용 후) |
| `POSEGOOD_API_URL` (개발 서버) | `/api` 중계 대상. 기본 `http://127.0.0.1:8090` |

## 3. 붙일 때 순서 (BE가 준비되는 대로)

1. **좌표 프레임(F1):** BE `ws`가 좌표 메시지를 받으면 `RealtimeClient`의 `features` 묶음 대신 `FrameBatcher` 결과를 보낸다.
   `VITE_REALTIME_FRAMES`로 켜고 끈다. 계약 초안(`contracts/realtime/frames/`)을 BE와 함께 확정한다.
2. **판정 불가 표시:** 필드 이름이 정해지면 `frames.ts`와 계약 초안만 바꾼다. 앱 기준은 어깨 2초 유예가 끝난 프레임이다.
3. **종료(F3):** `end` 뒤 `closed(ended)`까지 연결 유지, 10초 대기 후 기록 조회로 종료 화면.
4. **자세 등록(F2, N1):** 경로가 정해지면 `savedBaseline.ts`의 읽기·쓰기를 서버 호출로 바꾼다. 화면(측정하기·설정 다시 등록)은 그대로다.
5. **동의(F6, N9):** 가입 요청에 `consentPayload()`를 넣고, 가입 화면을 6종 체크 목록으로 바꾼다. 설정에 철회 토글을 더한다.

## 4. 이 PC에서 확인하지 못한 것

- BE 브랜치 서버를 띄우려면 JDK 21·Maven이 필요하다(2026-10-13 이 PC에는 JDK 17만 있음). 그래서 실제 왕복은 해 보지 않았다(F9, T-13).
- `feature/repo-backend-db-v2`는 DB V2.2 기준이고 develop은 V2.3이다. BE가 V2.3에 맞추는지 확인해야 한다.
