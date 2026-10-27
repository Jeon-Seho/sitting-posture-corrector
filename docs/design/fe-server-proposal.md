# FE 제안서: 서버 판정 이전과 연동

> 작성자: klaod-tech(FE) · 작성: 2026-10-11 · 최신화: 2026-10-27(BE PR #65 병합 반영 1.0 표·BE-5·BE-6, 프레임마다 전송·BE 묶음 답 BE-8, 판정 불가 좌표 없이 ADR 0032·BE-9, 시간 필드 BE-7, 측정 중 WS 줄이기 계획 0059, develop PR #64 디자인·작은 창 합침, 7.2 14~20) · 2026-10-26(웹 작은 창 삭제·숨은 탭 측정, ADR 0028 — 2장·7.2 9·11번·8.3·8.4. 저녁: 자정 끊기·서버 시각, ADR 0029 — 1장 BE-6·2장·7.2 12번. 회의: 리프레시 토큰은 BE 완료 뒤 적용, WS 판정 메시지 유지 — BE-6 ①, `valid_ms` 예시 — BE-5 ②, A4 `today`만 — BE-6 ③, 시간 필드 설명 요청 — BE-7·1.1 ⑥. 10/27: 좌표 프레임마다 전송 — BE-8·1.1 ⑦) · 2026-10-25(develop 합침, 팀장 10/22 결정 반영 — 2장 4, 7.2 5-a, BE-5) · 2026-10-22(문서 정리: 앱이 보내고 받는 것의 상세를 [연동 명세](api-ws-spec.md)으로 옮기고, 데스크톱 구조를 [배포](fe-deploy.md)에서 8.4로 옮김. 7.2에 바뀐 곳 기록. 같은 날 V3 코드 검토로 고친 것과 F12 때 맞출 것을 7.2에, BE에 물을 것 1개를 1장에. 저녁: 남은 앱 판정 삭제(F5), API·WS 대조와 F12 브랜치 검수를 7.2에, BE-4) · 대상: 팀 전원 — 팀장(Jeon-Seho), DB·BE(김유진, GitHub `sunshine-yj`), DevOps(홍규, ghdrb1246), ML(지성, jisung), 화면(lellon0403)
> **사람 표기:** 이 문서의 DB·BE는 김유진(GitHub `sunshine-yj`, 커밋 이름 `Kimyoujin`, 10/26 「백엔드·DB 변경사항 정리」 기준), DevOps는 홍규(ghdrb1246), ML은 지성(jisung), 화면은 lellon0403(기록·달력·측정하기), FE는 klaod-tech다. 10/22까지의 BE 작업 일부(로그인 F12 `f27dd24` 등)는 ghdrb1246이 했다. 학습용 자세 데이터 수집 화면은 jisung이 진행 중이다.
> **코드 읽는 법:** A·W·B·S·R·T·C + 숫자(예: S1, B2)는 서버 API — [연동 명세](api-ws-spec.md) 3장 표. F1~F15는 FE 할 일 — 이 문서 7장. BE-1~BE-11은 BE에 요청한 것 — 이 문서 1장(BE와 다른 곳 한눈에는 1.0). F-a~F-e·B-a~B-g는 김유진 10/26 정리 문서의 항목 번호. G1~G6은 `make check` 실패 항목 — [계획 0030](../plans/active/0030-make-check-failures.md). D-nn·T-nn은 BE·DevOps 작업 번호, J2·J3은 서버의 Spark 작업(일별 집계·탈퇴 삭제) — [아키텍처 v5.2](architecture_v5.2_stack_roles.md).
> **이 문서의 역할:** FE의 **전제·결정 요약, BE와 다른 곳·남은 질문, 할 일, 10/26 기준 앱 상태**. 앱이 언제 무엇을 보내고 받는지는 [연동 명세](api-ws-spec.md), 필드·본문은 [BE API 명세](api-spec.md), 결정의 근거는 ADR([0021](../decisions/0021-app-sends-information-server-judges.md)·[0024](../decisions/0024-session-ends-on-lost-connection.md)·[0025](../decisions/0025-app-always-measures-on-server.md)·[0026](../decisions/0026-baseline-average-by-app-b1.md)·[0027](../decisions/0027-today-records-from-collected-server-results.md)·[0028](../decisions/0028-no-web-camera-window-desktop-only.md)·[0029](../decisions/0029-midnight-cut-and-server-time.md). BE의 서버 시각 ADR은 BE 브랜치에 있다 — 10/26 같은 0028을 써서 BE가 번호를 옮기기로 함), 실행 계획은 [계획 0023](../plans/active/0023-frontend-server-only.md), 명령은 [FE 작업 명령과 검사](fe-commands-and-checks.md), 배포는 [배포](fe-deploy.md)다.
> 지금 FE 브랜치: `feature/frontend-features-and-integrationV3`(서버 전용, 10/21). **10/27:** develop `2e1fd2b`에 BE 브랜치(PR #65, 김유진 `fix/repo-backend-sync`)와 lellon0403 디자인·작은 창(PR #64)이 들어갔다. V3는 PR #64를 10/27에 합쳤고(7.2 19번), PR #65를 합친 뒤 develop으로 PR한다(계약 파일 몇 개가 같은 줄을 같은 뜻으로 고쳐 충돌). 앱 로그인 연결(F12)은 ghdrb1246의 `f27dd24`를 10/22 V3로 옮겼다. CORS는 BE 코드에 없다(WS 허용 출처 `POSEGOOD_REALTIME_ALLOWED_ORIGINS`만 있음).

## 1. BE와 다른 곳, 남은 질문과 요청

### 1.0 BE와 다른 곳 한눈에 (10/27)

기준: FE는 V3(10/27 로컬, 푸시 전), BE는 develop `2e1fd2b`(10/27 PR #65로 김유진 `fix/repo-backend-sync` 병합 — DB V2.5, WS 서버 시각, `today`, 로그인 고정 30분, `/v1/realtime` 삭제, 최대 측정 시간 없앰, `unmeasurable_timeout`). 10/27 BE 공유 문서 「백엔드 변경·보류 사항 공유」 기준.

| 항목 | FE (V3) | BE 지금(develop) | 필요한 것 |
|---|---|---|---|
| B1 `registration_id`, WS `ready.started_at`·`closed.ended_at`, A2·A3·A4 `today` | 맞춤 | 있음 | 없음 — 맞음 |
| R1 응답 `{today, records}` | 앱은 아직 R1을 안 부름(7.2 2번) | 있음 | 앱이 붙일 때 `records`로 읽기(연동 명세 4.5) |
| T1 `{today, from, to, days}` | 아직 안 씀 | 형식만 확정, 구현 전 | BE-2. 화면과 맞는지 lellon0403과 확인 |
| R1b | 아직 안 씀 | 없음 | BE-2 |
| `closed(unmeasurable_timeout)` | 저장된 정상 종료로 처리(10/27) | 있음, 기본 꺼짐 | **서버에서 켜도 됨**(`POSEGOOD_UNMEASURABLE_TIMEOUT=5m`) |
| 측정 중 `bad_message`·`unauthorized` | 서버가 저장하므로 「저장됨」(`lost`)으로 기록(10/27) | 마지막 구간까지 저장 | 없음 — 맞음 |
| 좌표 전송 단위 | **프레임마다**(10/27 팀장 결정, BE-8) | 메시지마다 구간 1개로 판정. BE 10/27 답: 「서버가 받아 자체적으로 묶겠다」 | BE-8 확인 4가지(묶은 뒤 평균 여부, `valid_ms`, `observation` 구간 값, `ack`) |
| 판정 불가 프레임 | **좌표 없이 `{t_ms, p: null, valid: false}`**(10/27, ADR 0032, BE-9) | 그대로 받음(판정 불가 시간으로 셈) | 알림만 — HDFS·학습 데이터에 좌표 없음 |
| `valid_ms` 계산 | 서버 값을 보임 | 구간 전체(명세는 유효 부분만) — BE 보류 | BE-5 ②. 서버가 프레임을 묶는 방식과 함께 |
| 측정 중 WS 요약 | 지금은 `progress`·`decision` 요약 15개를 씀 | 같음 | [계획 0059](../plans/active/0059-slim-realtime-results-over-api.md) 제안(측정 중은 점수·유지율·알림만, 결과는 끝난 뒤 S4) — 합의 전 |
| 자정에 측정 끊기 | 사유 처리 준비(방식이 정해지면 먼저 넣음) | 없음(보류). BE 의견 A안 | 회의 — 7.2 18번. 이 문서 1.1·BE-6 ①은 B안을 권했으나 BE는 A안(리프레시 토큰으로 401 해결) |
| 로그인 만료 | 고정 30분으로 안내 | 고정 30분 구현(`7034f0e`). 리프레시 토큰 예정 | 리프레시 토큰이 되면 앱 적용(10/26 회의) |
| J2 실행 시점 | — | 00:00 정각 | BE-6 ⑤ (자정 끊기를 켜면 겹침) |
| Kafka 모드(`ws`) | — | 계획 0031 1단계(PM) | 같은 규칙으로(서버 시각, `unmeasurable_timeout`, 프레임 묶음) |
| W1·W2 | S1 `policy`는 앱 기본값 | 앱에 아직 안 붙음 | BE-3 (설정을 바꾸면 S1 409). S1 `policy`를 빼고 서버가 계정 설정을 읽게 하는 안은 BE 여유가 생기면(계획 0059) |
| CORS | `app.` → `api.` 다른 출처 | 없음 | BE 문서 B-e, [배포](fe-deploy.md) S-1 |
| 판정 시간 규칙 이름·단위 | `Rules`(초) ↔ S1 `policy`(ms) 변환 | W1·W2 초 / S1 ms | BE-4 |
| 알림 기본값 | 켜짐 | DB 기본 false | 함께 정하기 |
| S1 뒤 WS가 안 열린 세션 | 앱은 S3를 부르지 않음 | 서버가 모른 채 열어 둠 | 아래 「BE에 물을 것」 |
| WS 자세 등록(`purpose: calibration`) | 쓰지 않음(ADR 0026) | 남아 있음 | 지울지 BE가 정함 |
| S2·R2 | 쓰지 않음 | 남아 있음(BE: 시험 도구가 써서 뒤로 미룸) | BE-1 |
| 동의 문구 `POSE_COORDINATES` | 좌표 프레임 전송 | 「특징 변화량」 문구 | BE-1 |

**팀장(Jeon-Seho)에게 물을 것 1개(10/25): `docs/design/data-platform-boundary.md`를 계속 쓰실 건가요?**
FE가 10/22 문서 정리 때 이 문서를 지웠다(10/06 기준이라 낡았고, [아키텍처 v5.2 스택별 역할](architecture_v5.2_stack_roles.md)과 겹친다고 봄). 그런데 같은 날 팀장님이 develop `db220d8`에서 이 문서를 현행 기준으로 고쳐 쓰셨다(서버 연동 뒤 좌표 전송, MySQL 저장 항목, 백엔드 개발 상태·DB 안내 링크, 옛 CEP·outbox 내용은 「과거 플랫폼 경계」 절로 분리).
그냥 지우면 그 수정을 말없이 버리게 되므로, 10/25 develop을 V3에 합칠 때 팀장님 판을 남겼다.
- 계속 쓰신다면: 그대로 둔다. 다만 아키텍처 v5.2 스택별 역할과 겹치는 부분은 한쪽으로 모으면 좋겠다.
- 필요 없다면: FE가 지우고, 남은 링크 1곳([ADR 0021](../decisions/0021-app-sends-information-server-judges.md))만 정리한다. develop에서 이 문서를 가리키던 README·계약·architecture 등의 링크는 V3에서 이미 지웠다.

**BE에 물을 것 1개(10/22, BE 10/26 정리 문서 7장에도 남은 결정으로 있음):** S1은 성공했는데 WS가 열리지 않았거나 `hello` 전에 끊긴 세션은 서버가 모른 채 열려 있다. 앱이 이때 S3 `POST /v2/sessions/{id}/end`로 닫을까, 서버가 시간이 지나면 정리할까? (측정 중 끊김·`ready` 5초 초과는 서버가 이미 끝낸다. [연동 명세](api-ws-spec.md) 4장 S3·S4)
 공개 배포의 HTTPS는 도메인 + Cloudflare 이름 있는 터널로 정했다([배포](fe-deploy.md), 10/19~20). 10/16~19의 BE 확인 기록은 git 이력(`dc2c5d4` 이 문서 1장)에 있다.
최대 측정 시간은 정하지 않았다(10/22 기준 서버 기본값 5,000초). 앱은 `closed(limit_reached)`만 처리하므로 값이 정해져도 바꿀 것이 없다.

BE에 요청한 것(FE는 결과만 확인한다):

| # | 내용 | 시점 |
|---|---|---|
| BE-1 | (`/v2/realtime`과 `closed(limit_reached)`는 10/17 구현됨) `POST /v2/records`·S2(앱이 부르지 않음)를 v1과 함께 정리, BE 동의 문서(`contracts/consent-documents.v2.md`) `POSE_COORDINATES`의 「측정 중에는 기준 대비 특징 변화량」을 v2(좌표 프레임 전송)에 맞춘 문구로 | v1 정리 때(앱 v2 전환 뒤) |
| BE-2 | R1b `GET /v2/records/{id}`(없으면 S4로 대신), T1 `GET /v2/stats/daily` | 연동 명세 4장 R1·R1b·T1 |
| BE-3 | (로그인·가입 F12는 10/22 ghdrb1246 `f27dd24` → V3로 옮겨 끝남.) **W1 `GET /v2/workspace`도 붙여 주기.** S1은 `policy`가 계정에 저장된 판정 기준과 같아야 받는다(다르면 409 `CONFLICT`). 그 값은 W1 `rules`에서 온다. 로그인이 끝나면 `setServerAuth({ userId, csrfToken })`(`features/platform/serverAuth.ts`)를 불러 앱의 B1·B2·S1이 계정 정보를 쓰게 한다(10/21) | F12와 같이 |
| BE-4 | **판정 시간 규칙 이름 맞추기(10/22 요청, BE 10/26 정리 문서 7장에도 남은 결정).** 같은 값이 W1·W2 `rules`(초)에서는 `holdSeconds`·`recoverSeconds`·`realertSeconds`, S1 `policy`(ms)에서는 `hold_ms`·`recovery_ms`·`reminder_ms`다. 이름(`hold`·`recovery`·`reminder`)과 단위를 하나로 맞추면 앱의 `Rules`·설정 화면·저장 검증도 따라 바꾼다 | BE가 정할 때 |
| BE-5 | **10/22 팀장 문서 정리와 서버 코드가 다른 곳(10/25 확인, develop `3285cce`).** **10/27 상태(PR #65):** ① 로그인 고정 30분 구현(`7034f0e`), ④ 서버 주석 정리(`7034f0e`), ⑤ BE 문서에 ADR 0026 반영(아키텍처 문서는 팀장 몫), ② `valid_ms`는 BE 보류(프레임 묶음 방식과 함께), ③ T1 형식 확정·R1b 구현 전. ① 로그인 만료: 명세는 「로그인부터 30분 고정」인데 서버는 `spring.session.timeout=30m`(마지막 요청부터). ② `valid_ms`·특징 계산: 명세는 「유효 하위 구간별 계산·합」인데 `Timeline.addMeasured`는 구간 전체 길이, `FrameFeatures.interval`은 판정 가능 프레임 전부 평균. 예(0.5초 구간 8장, 4·5번 판정 불가): 지금 코드는 `valid_ms` 500·특징은 6장 평균 1개, 명세는 `valid_ms` 약 375(판정 가능한 6장 길이)·특징은 [1~3]과 [6~8]을 따로. `valid_ms`는 기준 비교가 아니라 요약(`keep_rate = normal_ms ÷ valid_ms`, 시간당 이탈, `onset_valid_ms`)에 쓰는 시간 길이다. 명세대로 하면 하위 구간 특징이 여러 개인데 추론 입력은 구간당 1개라 어떻게 합칠지는 명세에 없다 — BE가 정할 때 함께 정하기. 앱은 바꿀 것 없음. ③ T1·R1b 컨트롤러 없음(BE-2). ④ `FrameFeatures.java`·`FrameFeaturesTest.java`·`SessionService.java`·`backend/README.md`가 V3에서 지운 `model/prototype/serverFeatures.ts`·`calibration.ts`를 근거로 가리킴(V3를 develop에 넣으면 사라짐). ⑤ 문서에 남은 옛 앱 동작(10/25 design 점검): [API 명세](api-spec.md) 10장 WebSocket v1 머리 「앱은 `VITE_REALTIME_URL`이 있을 때만 이 채널, 없으면 S2」 — 앱은 10/21부터 항상 `/v2/realtime`이고 S2·v1을 쓰지 않는다. API 명세 11장과 [v5.2 변경 안내](architecture_v5.2_change_notes.md) 「자세 등록」·FE 줄, [스택별 역할](architecture_v5.2_stack_roles.md) 추론 서비스 줄의 「등록 전용 WS(`purpose: calibration`), 추론이 평균 좌표 계산」 — 10/20 전체 회의로 앱이 3초 평균을 내서 B1로 보낸다([ADR 0026](../decisions/0026-baseline-average-by-app-b1.md)). 서버의 calibration 경로를 남길지는 BE가 정한다 | BE가 정할 때 |
| BE-6 | **자정 끊기와 서버 시각(10/26 요청, [ADR 0029](../decisions/0029-midnight-cut-and-server-time.md)).** **10/27 상태(PR #65):** ②·③ develop에 있음(`ready.started_at`·`closed.ended_at`, A2·A3·A4 `today`, R1 `today`), ① 보류 — BE 의견 A안(`closed(day_changed)` → 앱이 새 S1·WS, 401은 리프레시 토큰), 회의에서 정함(7.2 18번), ⑤ J2 시점은 Spark 담당. ① **KST 00:00에 진행 중인 측정을 서버가 끝내고 저장**(팀 회의 결정). FE 제안은 B안 — 같은 WS 연결에서 이전 세션을 저장하고 새 세션으로 넘긴 뒤 알림(다시 인증·재연결 공백 없음). 대안 A안(`closed` 새 사유 → 앱이 S1부터)은 로그인 30분 고정 만료 때문에 자정에 새 S1이 401이 될 수 있다. 메시지 안과 정할 것은 1.1. **10/26 회의:** BE가 리프레시 토큰을 만들기로 했다(10/26 BE 브랜치 코드에는 아직 없음 — 로그인은 쿠키 세션 `spring.session.timeout=30m`뿐). 완료되면 그때 앱에 적용하고, 그 뒤에는 A안의 401 걱정이 없어진다. 같은 회의에서 WS의 판정 메시지(`observation`·`decision`·`alert`·`progress`)는 **그대로 두기로** 했다 — 판정은 지금처럼 서버가 추론 API(`POST /v2/infer`)를 불러 하고 결과를 WS로 보낸다. 서버 시간대는 확인 끝: 설정은 `Asia/Seoul`(DB 세션은 `+09:00`), 문서·화면 표기는 KST. ② ~~WS `ready`에 `started_at`, `closed`에 `ended_at`~~ **10/26 BE 구현됨**(김유진, `fix/repo-backend-sync` `b903751`, develop 미병합 — `started_at` 필수, `ended_at` 필수·null 가능). Kafka 모드(`ws`, 계획 0031)도 같은 규칙으로. ③ A4 `GET /v2/auth/me`에 `today`(KST `YYYY-MM-DD`), R1·T1을 만들 때 `today`. 새 API는 필요 없다(10/26: 처음엔 `server_time`(ISO-8601)도 요청했으나 앱은 날짜만 쓰므로 뺌). ④ ~~위 응답에 `Cache-Control: no-store`~~ **철회(10/26):** Spring Security 기본값(`Cache-Control: no-cache, no-store, max-age=0, must-revalidate`)이 이미 붙는다(BE 확인, `SecurityConfiguration`이 `headers()`를 끄지 않음). ⑤ J2(00:00)가 자정에 끊긴 세션의 저장과 겹치지 않게 실행 시점이나 대기를 정하기. ⑥ 계약: FE도 10/26 `realtime-ws.v2.schema.json`을 BE `b903751`과 같은 정의로 맞췄다(두 브랜치가 같은 줄을 고쳐 합칠 때 충돌이 나도 내용은 같다). 자정 메시지는 방식을 정한 뒤 FE가 넣는다. 확인: 측정 안 시간축(`t_ms`·`start_ms`·`end_ms`)은 앱 시계로 둔다(판정 정확도). **순서:** 앱이 자정 메시지를 처리한 뒤에 ①을 켜기 — 지금 앱은 모르는 사유를 측정 실패로 처리해 기록을 남기지 않는다 | FE 7.2 12번과 같이 |
| BE-7 | **[API 명세](api-spec.md)에 설명 줄이 없는 시간 필드(10/26 요청).** 예시 JSON에만 나오고 필드 표에 뜻이 없다: ① 좌표 프레임 `t_ms`(프레임을 찍은 시각, 측정은 S1 응답 시각이 0 — FE 연동 명세 4.4), ② 사건 `timestamp_ms`(사건이 확정된 시점), ③ 사건 `onset_ms`(이탈이 실제로 시작된 시점, 세션 시간 축 — `onset_valid_ms`와 짝). 괄호 안은 FE가 이해한 뜻이니 맞는지 확인해 표에 넣어 주기. 앱은 바꿀 것 없음 | 명세 고칠 때 |
| BE-8 | **좌표를 프레임마다 보냄(2026-10-27 팀장 결정, V3 앱 반영).** 앱은 0.5초 묶음 대신 구간 하나에 프레임 1장을 담아, 다음 프레임이 찍힐 때 보낸다(초당 약 10개, 0.5초 동안 새 프레임이 없으면 그때 빈 구간 포함으로 닫음). 이유: 묶으면 서버가 쓸 수 있는 장을 평균해 판정하는데 평균이 판정을 흐린다 — 장마다 따로 판정하기로. **서버는 바꾸지 않아도 동작한다**(BE 브랜치 `80ba7db`·develop·V3의 `FrameFeatures.interval`은 모두 「쓸 수 있는 프레임 평균」이라 1장이면 그 장 그대로, 구간 길이 1~1500ms·`items` 1개 규칙도 그대로). BE에 제안·확인할 것: ① 부담 — 메시지마다 추론 호출(`POST /v2/infer`)·DB 저장(`persist()`)·`ack`·`observation`·`progress`가 초당 약 2번 → 약 10번(팀장: 부담은 감수). `progress`는 구간마다가 아니라 약 1초마다로 줄이는 것을 검토. ② `valid_ms`(BE-5 ②)는 구간 = 프레임 1장이라 명세(판별 가능 부분만 합)와 코드가 사실상 같아진다 — 보류를 닫아도 됨. ③ 평균 코드(`average(usable)`)와 아키텍처 v5.2의 「0.5초 묶음 평균」 설명은 이제 쓰이지 않으므로 정리할지 BE·팀장이 정하기. ④ 재전송 기억 120개 구간은 프레임마다면 약 12초 분량(앱은 재전송하지 않아 영향 없음). ⑤ 계약 `features` 설명을 FE가 10/27에 고침(「프레임 1장 구간」) — BE 사본과 합칠 때 맞추기. Kafka 모드(`ws`, 계획 0031)도 같은 입력 빈도로  **10/27 BE 답: 서버가 받은 프레임을 자체적으로 묶어 처리한다.** 그러면 확인할 것: ⓐ 묶은 뒤 쓸 수 있는 프레임을 평균하면 프레임마다 보낸 목적(평균이 판정을 흐림)이 사라지니 장마다 판정할지, ⓑ `valid_ms`는 묶은 구간에서 판별 가능한 프레임 시간만 더할지(BE-5 ②), ⓒ `observation`의 `sequence`·`start_ms`·`end_ms`를 묶은 구간 기준으로 무엇으로 할지 계약에 적기(앱은 이 값을 쓰지 않음), ⓓ `ack`를 프레임마다/묶음마다 | BE가 확인할 때 |
| BE-9 | **판정 불가 프레임은 좌표 없이 신호만(2026-10-27 FE 결정, [ADR 0032](../decisions/0032-unmeasurable-frame-signal-only.md), V3 반영).** 어깨가 화면 밖이거나 관절이 빠진 프레임은 `{ t_ms, p: null, valid: false }`로 보낸다(ADR 0021 10/12 예외의 「좌표는 함께」를 바꿈). 서버 코드는 그대로 동작한다(`FrameInterval.Frame`이 받음, 판정 불가 시간으로 셈). 알릴 것: HDFS·학습 데이터에 이 프레임은 좌표가 없다(ML 지성), 사람 없음(`p: null`, `valid` 없음)과 구별하려면 `valid`를 본다 | 알림만 |
| BE-10 | **측정 중 WS 줄이기([계획 0059](../plans/active/0059-slim-realtime-results-over-api.md), 10/27 제안 — 팀장 방향 「WS는 기본값 말고는 최대한 받지 않음」).** 1단계(더하기만): `observation`에 `alerting`(지금 붕괴 확정 상태인지, 회복 신호 대신)·`keep_rate`(측정 중 유지율, 10/27 FE 결정) 추가. 2단계(FE 1단계 배포, 서버 자정 끊기, 리프레시 토큰 뒤): `progress`·`decision`·`ack`를 보내지 않고 `observation`을 `collapse_probability`·`valid`·`invalid_reason`·`alerting`·`keep_rate`로 줄임, `schema_version` 올림. 결과 요약·사건은 끝난 뒤 S4(이미 있음). Kafka 모드도 같게. 측정 시계는 앱이 전체 시간으로 셈. 리프레시 토큰이 먼저인 이유: S4는 서버 메모리를 읽고 로그인은 30분 고정이라, 지금은 30분 넘는 측정 끝에 S4가 401 | 팀장·BE 합의 |
| BE-11 | **S1 `policy` 빼기(10/27 FE 결정, [계획 0059](../plans/active/0059-slim-realtime-results-over-api.md) 정한 것 6).** 지금 S1은 앱이 보낸 `policy`를 계정 정책과 비교해 다르면 409, 같으면 그 값으로 고정한다. 서버가 이미 아는 값이라 앱이 보내지 않게 한다: `policy`가 없으면 계정 정책(`account.policyId`)으로 고정. 3초·60초 시간 규칙은 지금처럼 서버가 센다. BE가 받게 한 뒤 FE가 빼기. 함께 부탁: 리프레시 토큰을 자정 끊기보다 먼저, J2를 00:00 정각보다 몇 분 뒤에, 재배포를 자정과 겹치지 않게 | BE 여유 있을 때 |
서버·모델 내부의 정할 것(0.5초 구간 점수 합치기, 자세 유형을 낼지)은 BE·ML·DevOps가 정한다. 앱은 서버가 보낸 결과를 그대로 보이므로 어느 쪽이든 영향이 없다.
일별 집계는 **매일 00:00**에 돈다(10/14 확정, 아키텍처 v5.2의 J2).

### 1.1 김유진(DB·BE)님께 — 「백엔드·DB 변경사항 정리 (10/26)」 확인 결과와 추가 요청 (klaod-tech)

**문서 5.1의 FE 할 일은 V3(`feature/frontend-features-and-integrationV3`)에 반영했습니다.**

- **F-a B1 본문:** `registration_id`(촬영마다 `crypto.randomUUID()`, 502·503·응답 없음 재시도에 같은 값). `registered_at`은 보내지 않습니다.
- **F-b WS:** 앱은 모르는 필드를 무시해서 그대로 받습니다. 계약 `realtime-ws.v2.schema.json`도 `b903751`과 같은 정의(`ready.started_at` 필수, `closed.ended_at` 필수·null 가능)로 맞췄습니다. 두 브랜치가 같은 줄을 고쳐 합칠 때 충돌 표시가 나도 내용은 같습니다.
- **F-c 기록 시작·종료:** `ready.started_at`·`closed.ended_at`. `ended_at`이 null이거나 `closed`가 없으면 「종료 미확인」으로 두고, 종료 시각은 `started_at` + 마지막 `progress`의 `total_ms`.
- **F-d 오늘을 나누는 날짜:** 서버 시각의 KST 날짜(시작 날짜 기준, J2·T1과 같음).
- **F-e 문서:** FE ADR 0026·0027, 연동 명세(`api-ws-spec.md`) B1·WS 갱신.
- **ADR 번호:** FE 0028(웹 작은 창 없음, 10/26 14:31 V3 푸시)과 BE 0028(서버 시각, 10/26 15:43 `cab11c1`)이 겹쳐 BE가 번호를 옮기기로 했습니다. FE는 0028·0029(자정 끊기·서버 시각)를 쓰므로 BE는 0030부터 써 주세요.

**병합 순서:** V3의 B1이 `registration_id`를 보내므로, V3만 먼저 develop에 들어가면 지금 서버(V2.4)에서 자세 등록이 400이 됩니다. 문서 4장 순서대로 `fix/repo-backend-sync`와 V3를 같이(또는 BE 먼저) 합쳐 주세요.

**추가 요청 (BE 문서에 아직 없는 것)**

**① KST 00:00에 진행 중인 측정을 서버가 끊기 (팀 회의 결정)**

- 이유: J2는 세션 시작 날짜로 집계하고 00:00에 전날을 계산합니다. 22:50~02:00 측정은 J2가 돌 때 진행 중이라 어제 통계에 못 들어가고, 앱의 오늘 화면(오늘 시작한 것만)에도 안 들어가 어디에도 보이지 않습니다. 자정에서 끊으면 측정 하나가 항상 하루 안에 있어 시작 날짜 = 끝난 날짜가 됩니다.
- FE 제안 방식(B안): 같은 WS 연결 안에서 서버가 이전 세션을 저장하고 새 세션으로 넘긴 뒤 앱에 알림.
  - 연결을 끊지 않으므로 다시 인증할 필요가 없습니다(로그인 30분 고정 만료와 부딪히지 않음).
  - 다시 연결하는 1~5초 공백이 없습니다.
  - 자정 앞뒤는 구간이 도착한 시각이 아니라 프레임 `t_ms`로 나누면 늦게 온 구간도 맞는 쪽에 들어갑니다.
- 메시지 안(이름·모양은 BE가 정해 주세요):

  `{ "type": "session_rollover", "ended": { "session_id": "<이전>", "ended_at": "2026-10-26T15:00:00.000Z", "summary": { … } }, "session_id": "<새 UUID>", "started_at": "2026-10-26T15:00:00.000Z", "at_ms": <자정이 앱 t_ms 축에서 몇 ms인지> }`

- 정할 것:
  - 이전 세션 `ended_at`과 새 세션 `started_at` = KST 00:00:00.000
  - 앱이 보내는 `t_ms`·`end_ms`는 연결 기준으로 이어서 보내고 서버가 `at_ms`를 빼서 새 세션 ms로 바꿀지, 아니면 앱이 넘김 뒤 새 세션 기준(0부터)으로 다시 셀지
  - 새 세션 UUID는 서버가 만들기(S1 없이), `policy`·`baseline`·알림 설정은 이전 세션 것을 이어받기
  - 자정 직전에 흐트러져 있던 사건은 이전 세션에서 `interrupted`로 끝내고, 새 세션은 새 사건부터
- 대안(A안): 서버가 `closed`(새 사유)로 닫고 앱이 S1부터 다시 시작. 단 로그인한 지 30분이 넘은 사용자는 자정에 새 S1이 401이 되어 측정이 끊기는 문제가 있어 B안을 권합니다.
- 순서: 지금 앱은 모르는 `closed` 사유·메시지를 측정 실패로 처리해 기록을 남기지 않습니다. 방식을 정해 주시면 FE가 먼저 처리를 넣고, 그다음 서버에서 켜 주세요.

**② A4 `GET /v2/auth/me` 응답에 `today`(KST `YYYY-MM-DD`)**

- (10/26 수정) 처음에는 `server_time`(ISO-8601)도 요청했지만 빼겠습니다. 앱은 몇 시인지는 쓰지 않고 오늘이 며칠인지만 쓰므로, 날짜를 서버가 KST로 정해 주는 `today` 하나면 됩니다.

- 측정하지 않을 때도 「오늘」을 서버 기준으로 정하려고 합니다. 앱은 시간을 세지 않고, 앱 시작·창으로 돌아올 때·기록/달력 화면을 열 때 A4를 다시 불러(1분에 한 번까지) 이 값으로 바꿉니다.
- 새 API는 필요 없습니다. R1·T1을 만들 때 `today`를 같이 넣어 주시면 기록 화면에서는 따로 묻지 않습니다.

**③ ~~A4·R1·T1과 B1 응답에 `Cache-Control: no-store`~~** — 철회(10/26 BE 확인: Spring Security 기본값으로 이미 붙음). `headers()`를 끄게 되면 알려 주세요.

**④ J2 실행 시점** — 00:00 정각에 돌면 자정에 끊긴 세션이 저장되기 전에 집계할 수 있습니다. 몇 분 뒤(예: 00:05)에 돌리거나 끝나지 않은 세션을 기다리게 해 주세요(J2 담당과 함께).

**⑤ Kafka 모드(`ws`, 계획 0031)** 도 ①·`started_at`·`ended_at`을 같은 규칙으로.

**⑥ API 명세에 시간 필드 설명 줄 넣기 (BE-7)** — `t_ms`·`timestamp_ms`·`onset_ms`는 예시 JSON에만 있고 필드 표에 뜻이 없습니다. FE가 이해한 뜻은 BE-7에 적었으니 맞는지 확인해 표에 넣어 주세요.

**⑦ 좌표를 프레임마다 보냄 (BE-8, 10/27 팀장 결정)** — 앱이 0.5초 묶음 대신 프레임 1장짜리 구간을 다음 프레임이 찍힐 때마다 보냅니다(초당 약 10개). 서버 코드는 그대로 동작하지만(1장 평균 = 그 장), 추론·저장이 초당 약 10번으로 늘어납니다. `progress`를 약 1초마다로 줄일지, `valid_ms` 보류(BE-5 ②)를 닫을지, 평균 코드·v5.2 설명을 정리할지 봐 주세요.

**확인 부탁:** 측정 안 시간축(`features`의 `t_ms`·`start_ms`·`end_ms`)은 앱 시계(단조 시계)로 둡니다. 프레임을 찍은 순간은 앱만 알고, 서버가 받은 시각을 쓰면 네트워크 지연이 3초 확정 같은 판정에 섞이기 때문입니다. BE 문서 원칙(절대 시각은 서버, 세션 안 간격은 앱 경과 시간 + 서버 `started_at`)과 같습니다.

그 밖에 BE와 다른 곳은 위 1.0 표, 자세한 내용은 [ADR 0029](../decisions/0029-midnight-cut-and-server-time.md)과 아래 BE-6.

## 2. 전제와 현재 구조

1. **판정은 서버가 한다.** 점수·상태·유형·판정 가능 여부·고개 돌림·복귀 대기는 서버(추론·판정)가 만든다.
   측정 앱은 판정하지 않고 판정 결과를 라벨로 붙이지 않는다. 서버 없이 쓰는 로컬 모드는 10/21 지웠다(ADR 0021·0025).
   학습용 정답 라벨은 **학습용 수집 화면**(jisung, 진행 중)에서 참여자에게 준 과제와 참여자의 자기 보고로 정해진다(ML 답 10/14). 필요한 라벨 열과 형식은 ML이 수집 화면 담당에게 요청한다.
   예외: 사용자 위치를 판별할 수 없는 순간(어깨선이 안 보이는 등)은 앱이 "판정 불가"로 표시해 보낸다([연동 명세](api-ws-spec.md) 5.2).
2. **앱은 입출구 서버 하나와만 통신한다**(아키텍처 v5, 10/11). 입출구 서버(`auth`·`api`·`ws`)는 BE가 만든다. FE는 앱 쪽 연결과 API 명세를 함께 쓴다.
3. **좌표 수집 동의는 가입의 필수 조건이다.** 로컬 모드가 없어 동의 없이는 측정할 수 없다. 실제 서비스에서는 학습용 데이터를 받지 않는다([동의 제안서](consent-proposal.md)).
4. **세션 판정·결과와 어제까지의 일별 통계는 서버가 계산한다. 오늘 표시값은 앱이 로컬에 모은 서버 결과로 집계한다(10/22 팀장 결정).** 앱은 자세 점수·사건을 다시 판정하지 않는다. 화면별 출처는 [연동 명세 4.5](api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위).
   - **오늘 측정은 방금 끝난 세션의 결과로만 보인다(10/13 결정).** 예: 12시에 3시간, 6시에 2시간을 측정했으면 6시 측정이 끝났을 때 결과 화면에는 그 2시간만 반영한다. 앞서 한 측정과 합치지 않는다.
   - **기록·달력 화면:** 오늘 세션 목록은 하나씩, 오늘 합산·유지율 링·잔디·그래프는 로컬에 모은 기록으로 계산한다. 서버 통계(T1)는 어제까지(일별 집계 매일 00:00 KST). 기간 화면은 과거 T1과 오늘 로컬 값을 날짜가 겹치지 않게 쓴다. (10/14 「통계는 어제까지만 그린다」를 10/22에 바꿈)
   - **모델명·버전은 화면에 보이지 않는다(10/22 팀장 결정).** 10/25 측정 화면 「추론 모델」, 기록 상세 「모델 버전」을 지웠다. 저장 형식(`server.modelVersion`)과 API 필드는 그대로.
   - **5분 미만 세션(10/14 정정).** 5분(`STAT_MIN_SESSION_SEC`) 미만 세션도 저장하고 기록 목록·일별 통계에 넣는다. "붕괴까지 걸린 시간" 최소·최대에서만 뺀다(DB V2.3, 10/14 정정). 처음에 "저장하지 않는다"로 적은 것은 회의 내용을 잘못 이해한 것이다.

FE가 정한 것(앱 쪽 동작):

| 항목 | 결정 |
|---|---|
| 민감도 | 화면 3단계(느긋하게 0.80 · 보통 0.70 · 꼼꼼하게 0.60)와 세밀 조정(0.5~0.95). 기본은 0.7이고 LSTM으로 바뀌어도 그대로 쓴다. DB에는 threshold 값 하나로 저장한다. 단계 칸은 필요 없다 |
| 소리 | 저장하지 않는다. 측정마다 꺼진 채 시작하고 측정 화면에서 켠다(브라우저는 사용자 동작 없이 소리를 켤 수 없다). 「자세 알림」 켜기·끄기만 서버에 저장한다(V2.3 `sound_alert_enabled`) |
| 영상 크기 | 640×480 고정(팀 결정, DB V2.3 `CAPTURE_RESOLUTION`). 앱은 640×480을 요청한다. 고정이라 **서버에 해상도를 보내지 않는다**(10/15, 좌표 구간의 `width`·`height` 삭제). 다른 크기면 시작하지 않는 처리는 두지 않고(10/19), 측정 화면 위에 실제 카메라 크기를 작게 표시한다(예정, F13) |
| 배포 (10/19) | 공개 배포는 **HTTPS**. 화면은 Vercel `app.<도메인>`, 서버는 Cloudflare 이름 있는 터널 `api.<도메인>`(DevOps). 데스크톱 앱도 PC 파일(`app://posegood`)이 아니라 `https://app.<도메인>`을 연다 — 화면 수정이 서버 배포 없이 반영된다. 자세한 구상은 [배포](fe-deploy.md) |
| 자세 등록 (10/20 전체 회의, 10/26 갱신) | 앱이 관절 9개 3초 평균을 내서 B1로 보낸다. 이 PC에는 저장하지 않는다([ADR 0026](../decisions/0026-baseline-average-by-app-b1.md)). 10/26부터 B1은 `registration_id`(촬영마다 UUID)를 보내고 등록 시각은 서버가 정한다(DB V2.5, BE 브랜치) |
| 측정 (10/21) | 「측정 시작」은 항상 서버 측정이고 앱은 판정하지 않는다. 서버 결과는 형식만 확인한다([ADR 0025](../decisions/0025-app-always-measures-on-server.md)) |
| 네트워크 끊김 | 세션을 끝내고 화면을 막는 팝업을 띄운다. 재연결·재전송하지 않는다([ADR 0024](../decisions/0024-session-ends-on-lost-connection.md)) |
| 카메라 (10/16, [계획 0053](../plans/active/0053-multiple-cameras.md)) | 측정하기 카메라 화면 위에서 메인 카메라를 고른다(설정과 같은 선택). **기준 자세는 카메라와 상관없이 하나**(팀 논의: 카메라마다 등록은 비효율, ML 학습 자료도 사람마다 기준 하나). 쓰던 카메라가 빠지면 측정 종료·저장 |
| 앱이 닫힌 측정 (10/16 → 10/21) | 이어하기는 없다. 10/21부터 앱이 닫히면 연결이 끊기고 서버가 마지막 구간까지 저장한다(앱이 따로 저장하지 않음, ADR 0025) |
| 측정 중 작은 창·쉬기 (10/20 → 10/26) | **10/26부터 웹에는 작은 창이 없다**(Chrome이 카메라만 쓰는 페이지에 자동 PiP를 열지 않음, [ADR 0028](../decisions/0028-no-web-camera-window-desktop-only.md)). 웹은 다른 탭에 가도 측정이 이어진다. 데스크톱 앱은 PoseGood 창이 가려지거나 최소화되면 작은 창이 저절로 보인다([계획 0055](../plans/active/0055-desktop-camera-window.md)). 버튼은 최소화(영상만 숨김, 측정 계속)·확대(측정 화면으로)·X. **X는 측정 종료·저장**이다(창을 닫는 것은 그만하겠다는 뜻, 서버도 바로 정리됨). **일시정지(휴식이든 앱이 스스로 멈춘 것이든)가 10분 이어지면 자동으로 종료·저장**한다 — 쉬기를 걸어 두고 잊으면 측정도 안 하는데 서버가 연결·판정 상태를 계속 붙잡고 있게 되기 때문(일시정지 중에도 0.5초마다 빈 휴식 구간이 간다). **이 10분은 서버가 자기 시계로 판단해 종료하고 앱에 알린다(BE 담당). 앱에는 타이머를 두지 않고 서버가 보낸 종료를 처리한다.** 서버가 끝냈을 때 보낼 신호(`decision(session_ended)`·`closed` 사유)는 BE와 정한다. 사용자가 X를 누른 것은 판정 불가(UNMEASURABLE)가 아니라 본인 의사라 종료로 처리한다 |
| 자정·날짜·시각 (팀 회의, 10/26 문서화) | **측정은 KST 00:00에 서버가 끊는다**(22:50~02:00도 자정에서 나뉨). 하나의 측정은 하루 안에 있어 날짜가 섞이지 않는다. 화면의 날짜·시각은 서버 시각을 따르고 앱은 시간을 세지 않는다(오늘 = 가장 최근에 받은 서버 시각의 KST 날짜). 측정 안 시간축과 자세 등록 3초는 앱 시계. [ADR 0029](../decisions/0029-midnight-cut-and-server-time.md), BE-6 |
| 탈퇴 | 되돌릴 수 없다(BE 10/15, A8 없어짐). 확인창 문구·탈퇴 계정 로그인 안내는 [연동 명세](api-ws-spec.md) 2장 |

```
앱 ──HTTP /api/v2──▶ 입출구 서버 (BE `backend/api`) ──▶ MySQL(계정·설정·세션 행·기록)
앱 ──WebSocket /api/v2/realtime──▶ 같은 서버: 좌표 → 특징 계산(FrameFeatures) → 추론 POST /v2/infer → 판정
   ▲                                   │
   └──── push: observation·decision·alert·ack·progress·stalled·closed ─┘
```

서버 쪽(BE 10/17, `FrameFeatures` 안): 입출구 서버가 연결마다 로그인과 세션 주인을 확인하고(`hello` → `ready`), 좌표 구간으로 특징을 계산해 추론·판정하고, 결과를 같은 연결로 보낸다(BE 명세 11장).
나중에 Kafka 경로(`posture.features.v1` → 추론 → `posture.inference.v1` → 판정 → `posture.episodes.v1`·`posture.alerts.v1`, BE 계획 0031)로 옮겨도 앱 쪽 계약(WebSocket v2)은 바뀌지 않는다.
재연결은 없다(ADR 0024). 연결이 끊기면 서버가 마지막으로 받은 구간 끝에서 세션을 끝낸다(BE 명세 11.3).
로그인은 측정 연결을 열 때 확인하므로 측정은 끝까지 간다. 로그인은 로그인한 때부터 30분이 지나면 활동과 상관없이 만료되므로(10/22 BE 명세 1장, 10/27 develop 구현 `7034f0e`. 리프레시 토큰으로 바뀔 예정) 긴 측정 뒤 HTTP가 401이면 로그인 화면으로 보낸다.

## 3·4. 앱이 보내는 것과 받는 것 (요약)

상세는 [연동 명세](api-ws-spec.md)으로 옮겼다(10/22). 여기에는 요약만 둔다.

- **보내는 것:** 프레임마다 좌표 구간 1개(10/27 팀장 결정, 서버가 받아 묶음 — BE-8; 관절 9개, 판정 불가 프레임은 좌표 없이 `{t_ms, p: null, valid: false}` — ADR 0032) — 연동 명세 5.1. 쉬기 `rest`, 카메라 영상 멈춤 `away`, 종료 `end`(사용자 종료·데스크톱 작은 창 X·카메라 빠짐·영상 크기 변경) — 5.2. 자세 등록은 앱이 낸 평균을 B1로(`registration_id`) — 5.4.
- **받는 것:** 화면은 서버 메시지로 바뀐다(앱이 정한 판정 불가 「자세를 확인할 수 없어요」만 서버를 기다리지 않고 바로, 10/27). 측정 중 WS를 줄이고 결과는 끝난 뒤 S4로 받는 안은 [계획 0059](../plans/active/0059-slim-realtime-results-over-api.md). 점수 = 100 × (1 − `collapse_probability`), 「자세가 흐트러졌어요」는 서버 확정 사건, 숫자는 서버 요약 — 5.3(메시지별 동작과 화면 상태 표).
- **끝나는 경우:** 사용자·작은 창·카메라 빠짐·영상 크기 변경은 앱이 `end`, 앱을 닫거나 연결이 끊기면 서버가 저장, 판정 불가·자리 비움 5분은 서버가 끝냄(`unmeasurable_timeout`, 서버 기본 꺼짐, 앱 처리 끝남), 쉬기 10분은 서버에 아직 없음, KST 자정은 보류(BE-6 ①) — 5.2·6.3.
- **시각:** 기록의 시작·종료와 「오늘」은 서버 값(`ready.started_at`·`closed.ended_at`·A4 `today`), 측정 안 시간축만 앱 시계 — 연동 명세 1장, ADR 0029.

## 5. 서버 부담 (동시 50명, 하루 8시간 추정)

| 항목 | 특징값 전송(예전) | 좌표 전송(지금) |
|---|---|---|
| 메시지 | 0.5초에 1건, 수백 바이트 | 0.5초에 1건, 약 2KB |
| Kafka 유입량 | 수십 KB/s | 약 200KB/s |
| 서버 계산 | 0.5초당 점수 1번 | 초당 약 800프레임(계산은 가볍다) |
| 저장 | MySQL에 결과만 | HDFS에 좌표 약 5GB/일 추가 |

메시지 수가 같아서 처리량은 거의 같다(10/01 측정 기준 약 40~50명, DevOps 재측정 예정).
실제 부담은 구현·운영이다: 좌표 처리 단계, 세션별 상태, 3초 규칙과 자동 재개, HDFS 적재·동의 철회 삭제, 서버 장애 시 화면 판정 정지.

## 6. 넘겨준 판정 규칙과 시험 데이터

판정 규칙(판정 가능 검사, 특징값, 고개 돌림, 점수, 복귀 대기, 보정, 판정 불가 시간 처리)은 10/11에 BE에 넘겼고 서버가 구현한다(D-34·D-35·D-23).
이 문서에서는 계산 방법을 뺐다. 원문은 이 파일의 git 이력 `d69b22c`(BE 회신 반영본)에 있다.

- [합성 시험 데이터](../../contracts/examples/frames/reference-rule-cases.json): 좌표 → 기대 결과(프레임 17·시간 순서 4·보정 1). 서버 구현이 같은 결과를 내는지 확인용이다.
- 앱 판정 코드로 만든 자료다. 앱 판정과 그 시험(`referenceRuleCases.test.ts`)은 10/21 지웠다(ADR 0025). 자료 파일은 서버가 같은 결과를 내는지 확인용으로 남긴다. 다시 만들어야 하면 develop의 앱 코드로 만든다.
- 규칙을 바꾸자는 제안은 BE·ML이 정한다. 시험 데이터를 다시 만드는 것도 이제 서버 쪽 몫이다. 두 귀가 모두 있어야 판정한다는 규칙(`one_ear_missing`)과 float64 계산도 ML 결정에 따라 바뀔 수 있다.

## 7. FE가 할 일

표는 FE 할 일 번호(F1~F15)마다 한 줄이다. 끝난 것(10/13)은 표에서 뺐다: 회원가입 동의 화면(F6 앞부분), 등록 전 구도 확인(F7, lellon0403), 팀 API 브랜치 확인(F8, BE `api-spec.html`), develop PR(F10, #42), 동의 제안서(F12 문서).

| # | 할 일 | 상태 (10/22) | 막힌 것 · 근거 |
|---|---|---|---|
| F1 | 좌표 구간 전송: `/v2/realtime`에 구간 1개씩(10/21 0.5초마다 → 10/27 프레임마다), `hello` → `ready`(5초) 뒤에만 보냄 | 끝남(10/21 `f88ffe3`, `features/session/live/`). 실제 서버 시험 남음 | 로그인(F12)·W1 · [연동 명세](api-ws-spec.md) 5.1 |
| F1-a | S1 `policy`를 W1 `rules`로 보내기. W1 전에는 앱 기본값(`DEFAULT_RULES`를 ms로) | 앱 기본값으로 보냄. 서버 계정 값과 다르면 409 | W1(BE-3) |
| F2 | 자세 등록: 앱이 낸 관절 9개 3초 평균을 B1로 저장, B2로 조회, `closed(no_baseline)` 안내 | 끝남(10/21 `0449abb`, 10/22 재시도·B2 실패 처리, 10/26 B1 `registration_id` — DB V2.5). 실제 서버 시험 남음 | F12 · 연동 명세 5.4, ADR 0026 |
| F3 | `rest`·`away`·`end` 전송, `end` 뒤 10초 기다린 뒤 S4. 카메라가 빠지거나 영상 크기가 바뀌면 `end` | 끝남(10/21 `f88ffe3`) | 연동 명세 5.2·6장 |
| F4 | 화면을 서버 메시지로만 구동: 점수·상태·통계, `invalid_reason`, `paused_reason`. `alert`는 앱이 거르지 않음(D-54) | 측정 화면은 끝남(10/21). 사건 종류는 5개만 쓰고 `excluded_started/ended`는 무시한다(`messages.ts`) | 연동 명세 5.3 |
| F5 | 앱 판정 지우기 | 측정 쪽은 끝남(10/21, ADR 0025). 10/22 어깨 유예·머리 판정·고개 돌림·특징값 계산(기준 특징 다리 포함)도 지움 — 앱은 프레임이 판정 가능한지만 본다. 남은 것: 기록 화면의 앱 통계 중 어제까지(T1로 바꿀 때). 오늘 집계는 남긴다(ADR 0027) | 기록 화면 서버 연결(7.2의 2번) |
| F6 | 측정 화면의 「좌표 전송 안 함」 문구 고치기 | 안 함 | — |
| F9 | 서버 PC 왕복 시험(T-13) 일정 잡기 | 안 함 | DevOps 8088 환경 |
| F11 | 판정 불가 표시: 측정이 안 되는 프레임에 `valid:false` | 앱 쪽 끝남(10/21). 10/22 어깨 유예를 지워 어깨가 안 보이면 바로 `valid:false` | 연동 명세 5.2 |
| F12 | 계정 서버 연결: 로컬 로그인·가입을 A1~A7·W1로, 비밀번호 12자 검사, 탈퇴 확인창에 비밀번호 칸(A7 본문 `{password}`) | **A1~A5 끝남(10/22 V3):** ghdrb1246의 `f27dd24`(D-66)를 V3로 옮김. 스위치 없이 항상 서버 계정, 로그인·가입·`me` 뒤 `setServerAuth`(B1·B2·S1·S4가 같은 계정·CSRF 토큰), CSRF 403 재시도. 남은 것: 비밀번호 변경(A6)·탈퇴(A7)·선택 동의(C1)·W1·W2 | BE · 연동 명세 2장 |
| F13 | 카메라 해상도 표시: 측정 화면 위에 실제 카메라 크기(예: 640×480)를 작게. 다른 크기여도 시작은 막지 않음(10/19) | 안 함 | 표시 위치를 화면에서 정하기 |
| F14 | 데스크톱 앱이 `https://app.posegood.site`(Vercel)에서 화면을 열기: `sameAddress` 검사·알림 팝업 주소·`app://` 정리, 열 수 없으면 「서버에 연결할 수 없어요」 | 안 함 | Vercel 연결 · [배포](fe-deploy.md) 4장 5단계 |
| F15 | v2 전환으로 필요 없어진 코드 정리 | 끝남(10/21, 7.1 표) | — |

담당(10/14 정함): 기록·달력 화면과 측정하기 화면은 lellon0403, 학습용 자세 데이터 수집 화면은 jisung(진행 중). FE(klaod-tech)는 서버로 보내는 처리(F1~F3), 판정 불가 처리(F11), 회원가입·동의 화면을 한다. 계정 서버 연결(F12)은 BE가 맡는다(BE 계획 0027과 같은 일 — A1~A5는 10/22 ghdrb1246 `f27dd24`를 V3로 옮겨 끝났고, A6·A7·C1·W1·W2가 남음). 10/26부터 FE(klaod-tech)가 기록·달력 화면의 API·WS·서버 판별 로직도 고친다(화면 모양은 lellon0403).

### 7.0 v2를 다시 할 때 정할 것 (10/19 → 10/21 결정)

10/21 FE(klaod-tech) 결정으로 셋 다 FE 권장안대로 했다([ADR 0025](../decisions/0025-app-always-measures-on-server.md)): 서버 결과는 형식만 검사(되감김 멈춤·2초 넘은 관측 숨기기 없음), 서버 측정 중 쓰던 카메라가 빠지면 `end`로 종료·저장, 측정 중 영상 크기가 바뀌어도 종료·저장. 그대로 둔 것: 순번 중복 막기, 좌표를 계약 범위(-1~2)로 자르기, `ready` 5초·`end` 뒤 10초 대기.

### 7.1 v2 전환 때 정리할 것 (10/19, BE `a0d99a3` 기준)

서버(`/v2/realtime`, S1)가 받지 않거나 서버가 대신 하게 되어 앱에 남길 필요가 없는 것이다. FE 몫만 적고, lellon0403 화면에 걸친 것은 이 표 바로 뒤 「다른 담당 화면에 걸친 겹침」에 둔다.

| # | V2까지의 앱(~10/20) | v2에서 | 처리 |
|---|---|---|---|
| 1 | 측정 시작에 `setup`(카메라 key·이름, 화면 크기, 기준 자세 평균·표준편차·중심·면적)을 보냄 — DB V1.1 때 형식(`server/setup.ts`, `ServerSetup`) | S1은 `policy`·`baseline_id`만 받고 모르는 필드는 400 | **10/21 지웠다** |
| 2 | 구간마다 `baseline_id`·`measurement_quality`·특징 변화량(`FrameRequest`, 입력 v2)을 보내려고 앱이 특징을 계산(`serverFeatures`) | 좌표 구간만 받고 서버가 기준 자세로 특징을 계산(`FrameFeatures` 안) | **10/21:** `FrameBatch`로 바꿨다. 판정 불가는 어깨가 유예 뒤에도 안 보이는 프레임에 `valid:false`(F11) |
| 3 | HTTP 측정 경로(`server/client.ts` `/api/v1/sessions/…/features`, `VITE_REALTIME_URL`이 없을 때) | `/v1/sessions` 없음, S2도 전환 뒤 삭제 | **10/21 지웠다.** WS만 쓰고 S1·S4는 `/api/v2`(`features/platform/api.ts`) |
| 4 | 확인받지 못한 요청을 보관·재시도(`server/queue.ts`, 체크포인트의 `pending`·`nextSequence`·기준 특징·화면 크기) | 재전송 없음, 순번이 겹치면 `closed(bad_message)` | **10/21 지웠다**(이어하기 draft도) |
| 5 | WS 재연결·미확인 구간 재전송·30개 묶음·`last_event_id`·알림 거르기(`realtime/client.ts`) | 재연결 없음, 메시지당 구간 1개, 알림은 서버가 거름 | **10/21 다시 썼다**(`live/LiveSession.ts`) |
| 6 | 측정 중 앱이 닫히면 다음 로그인 때 앱이 그때까지를 기록으로 저장(10/16), 개발 서버 측정은 이어하기를 물음 | 서버가 끊김을 보고 마지막 구간 끝에서 끝내고 저장(BE 명세 11.3) | **10/21:** 이어하기·앱 저장을 지웠다. 기록 화면이 서버 기록(R1)을 읽기 전까지는 서버가 확인한 요약을 이 기기에도 R1과 같은 형식으로 남긴다. R1로 바꿀 때 지우려 했으나 10/22 결정으로 오늘 화면용으로 남긴다([ADR 0027](../decisions/0027-today-records-from-collected-server-results.md)) |
| 7 | 자세 등록 결과(평균 특징)를 이 PC에 저장(`camera/savedBaseline.ts`) | 앱이 낸 관절 평균을 B1로 저장, B2로 조회(10/20) | **10/21 지웠다**(`features/baseline/`). 3·2·1 촬영 화면은 남겼다. 서버 좌표에서 특징을 계산해 넘기던 다리는 10/22 지웠다 |
| 8 | 개발자 옵션 내보내기 둘: 입력 v2 특징(`kafkaExport.ts`, 예전 `posture.features.v1` 형식), 좌표(`poseDebugExport.ts`) | 앱이 보내는 것은 좌표 구간(`posture.frames.v1`) 하나 | **10/21 둘 다 지웠다**(로컬 측정 화면과 함께). 좌표가 필요하면 보내는 형식(`posture.frames.v1`) 그대로 ML과 정한다 |
| 9 | `platform/ports.ts`(아키텍처 v4 초안 연결점, 아무도 가져다 쓰지 않음) | — | **10/21 지웠다** |

다른 담당 화면에 걸친 겹침(알리기만): 앱 판정(10/21 지움)과 측정하기 화면, 기록 통계의 출처 전환(`lib/stats`·`lib/comparison`, 과거는 T1·오늘은 로컬 집계 — 오늘 집계는 남김, 10/22)은 lellon0403, 로컬 로그인·기록(`LocalServiceApp`)은 F12(BE)다.

참고: 앱의 옛 판정 구현(고개 돌림 제외·귀 기준 치우침·복귀 대기)은 `lee_app1`의 `676ae89`에 있다. 회의 안건 원문과 BE 문서는 저장소 밖(DevOps)에 있다.

### 7.2 다음 할 일 (10/27 기준)

**10/27에 한 것(V3 로컬 커밋, 푸시 전):** A4 `today`(`server_time` 철회), 좌표 프레임마다 전송(BE-8), develop PR #64 합침(디자인·작은 창은 lellon0403 것, 날짜 나누기는 서버 요약으로, 19번), `unmeasurable_timeout`·측정 중 종료 사유 처리(14·15번), 앱이 정한 판정 불가 즉시 표시, 판정 불가 프레임 좌표 없이(ADR 0032), 계획 0059 초안. 시험 273개·`tsc`·빌드·`check-repo` 통과. 남은 것: 실제 서버 확인(16번, 이 PC에 MySQL·Docker 없음), PR #65를 V3에 합치고 develop으로 PR, 회의 안건(18·20번, 판정 불가 범위 넓히기).

**10/26 인계 (데스크톱 → 노트북):** V3 `origin/feature/frontend-features-and-integrationV3`에 모두 푸시했다. 노트북에서 `git fetch origin` 뒤 `git merge --ff-only origin/feature/frontend-features-and-integrationV3`로 받는다. 원격의 `DevOps` 브랜치는 지워졌으니 fetch 설정에 남아 있으면 지운다(`git config --unset remote.origin.fetch '\+refs/heads/DevOps:.*'`).
- 보낼 것(디스코드, klaod-tech): 김유진(DB·BE) — **이 문서 그대로**(1.0 BE와 다른 곳, 1.1 10/26 정리 문서에 대한 답과 추가 요청, BE-5·BE-6. BE-6 ⑤ J2 실행 시점은 J2 담당과 함께), 홍규(DevOps) — BE 10/26 정리 문서 5.2(migration 015 등)와 [배포](fe-deploy.md) 3.1, 팀장 — 1장 맨 위 「팀장에게 물을 것」(`data-platform-boundary.md` 계속 쓸지). 답이 오면 이 문서·연동 명세에 반영한다.
- 이어서 할 일: 아래 표 1번(더미 데이터 삭제)부터. 9번(자동 PiP)·10번(시험 전용 로컬 로그인 삭제)은 [계획 0054](../plans/active/0054-pip-fix-and-server-only-login.md).
- 10/26 오후: 9번은 방향을 바꿔 끝냈다 — 웹 작은 창 삭제(V3 `409de69`), 숨은 탭에서도 측정이 이어지게 프레임 타이머를 Worker로(`86b7a46`), 결정 [ADR 0028](../decisions/0028-no-web-camera-window-desktop-only.md). 데스크톱 작은 창은 [계획 0055](../plans/active/0055-desktop-camera-window.md)(11번).
- 10/26에 정한 것: 로컬 기록은 키 하나, 계정별로 나누지 않음([ADR 0027](../decisions/0027-today-records-from-collected-server-results.md)). 포크(Vercel)는 그대로 `11126de`(fe-deploy 6장).

10/25~26에 한 것: develop(PR #63) 합침, 팀장 10/22 결정을 연동 명세·이 문서에 옮김, 모델명·버전 화면 표시 삭제(5-a), design 문서 점검(fe-deploy·명령·동의 제안서 고침, 다른 담당 문서는 BE-5 ⑤), ADR 0027. 10/26 오후~저녁: 웹 작은 창 삭제·숨은 탭 측정·데스크톱 작은 창(9·11번), 서버 시각·KST·B1 `registration_id`·ADR 0028·0030(12·13번). 시험 238개·`tsc`·빌드·`check-repo`·WS 계약 시험 통과.
10/21에 한 것: F2 자세 등록(B1·B2), F1+F3 측정(S1 → `/v2/realtime`), 로컬 판정·이어하기·v1 서버 코드 삭제. 시험 213개·`check-repo` 통과, 실제 서버 시험은 아직.

| 순서 | 할 일 | 막힌 것 |
|---|---|---|
| 1 | **더미 데이터 삭제**(2단계): 발표용 예시 기록 `data/exampleRecords.ts`와 설정의 토글(`KEYS.demo`, `saveDemoPreference`), 합성 시연 `mode: 'demo'`, `testing/legacySyntheticRecord.ts`. 자동 시험용 가짜 카메라는 남긴다 | — |
| 2 | **기록 화면을 서버로**(3단계): `recordsSource.ts`에서 과거는 R1·T1, 오늘은 로컬. 측정 결과를 이 기기에 R1 형식으로 남기는 것(`useSessionPersistence.ts` `finish`)은 10/22 결정으로 R1로 바꿔도 **남긴다**(오늘 표시용. 키 하나로 두고 계정별로 나누지 않음 — 한 PC 여러 계정의 한계는 연동 명세 4.5 「팀 참고」). 기록·달력은 lellon0403 담당(10/14)이라 함께 | BE 로그인(F12) |
| 3 | `check-browser` 시나리오를 서버 전용으로 다시 쓰기([계획 0030](../plans/active/0030-make-check-failures.md) G6): 가짜 S1·`/v2/realtime`·B1·B2 | — |
| 4 | 실제 서버 시험: DevOps 8088 환경(`ssh -L 8088:127.0.0.1:8088`)에서 로그인 → 등록 → 측정 → 종료 → 기록. 그 환경의 화면은 BE 브랜치(10/22부터 develop)의 `frontend/`로 빌드되므로 V3 화면으로 빌드해야 한다(DevOps와 정하기) | F12·W1 |
| 5 | S1 `policy`를 W1 `rules`로(F1-a, BE-3) | W1 |
| 5-a | **10/25 develop 합침**(PR #63 = BE `047a095`+팀장 문서 정리 `db220d8`): 코드는 옛 경로 삭제뿐이라 충돌 없음. 팀장 10/22 결정(오늘 로컬 집계, 모델명 비표시, 로그인 고정 30분, `valid_ms` 정의)을 연동 명세 0·1·4.5·5.2장과 이 문서에 옮김. 모델 버전 표시 2곳 지움. BE와 다른 곳은 1장 BE-5 | — |
| 6 | 남은 앱 계산: 기록 화면의 앱 통계(`lib/stats`·`lib/comparison`)는 과거만 T1로, 오늘 집계는 남김(10/22). 기준 특징 다리는 10/22 지움 | 2 |
| 7 | F12에 이어 맞출 것: (10/22 끝남: `setServerAuth` 연결, CSRF 403 `ACCESS_DENIED` 재시도) 남은 것: 409 `AUTH_CHANGED`면 A4로 계정을 다시 받고 `setServerAuth` 갱신(10/22 기준 일반 `conflict` 안내), 계정이 바뀐 뒤 도착한 이전 계정의 B1·B2 응답은 버리기 | — |
| 8 | S1은 됐는데 WS가 열리지 않은 세션을 S3로 닫을지 BE와 정하기(연동 명세 4장 S3·S4). 측정 중 끊김·`ready` 초과는 서버가 끝낸다 | BE 확인 |
| 9 | ~~작은 카메라 창(자동 PiP)이 안 열리는 문제 고치기~~ **10/26 끝남(방향 바꿈):** 카메라만으로는 Chrome이 자동 PiP를 열지 않아 웹 작은 창을 지웠다. 숨은 탭에서 측정이 멈추던 것(`setTimeout` 초당 1번)은 Worker 타이머로 고쳤다 — [계획 0054](../plans/active/0054-pip-fix-and-server-only-login.md) 1단계 기록, [ADR 0028](../decisions/0028-no-web-camera-window-desktop-only.md) | — |
| 10 | 시험 전용 로컬 로그인 지우기(`ServiceApp.test.tsx`를 가짜 계정 서버로, `LocalServiceApp`의 `accounts === null` 경로·`KEYS.account` 삭제) — 계획 0054 2단계, 9번 다음 | 9 |
| 11 | 데스크톱 앱 작은 카메라 창(PoseGood 창이 가려지면 보이고, 앞으로 오면 숨음), 웹에는 「데스크톱 앱에서 쓸 수 있어요」 안내 — [계획 0055](../plans/active/0055-desktop-camera-window.md) | 9 |
| 12 | **자정 끊기와 서버 시각**([ADR 0029](../decisions/0029-midnight-cut-and-server-time.md)). **10/26 함:** 서버 시각 저장소(`features/platform/serverClock.ts`, 가장 최근 서버 시각 → 오늘), 기록 시작·종료를 `ready.started_at`·`closed.ended_at`으로(`closed`가 없으면 서버 시작 + 서버가 잰 전체 시간, 서버 필드가 오기 전에만 PC 시계), 창·탭으로 돌아올 때와 기록·달력을 열 때 A4(1분에 한 번까지), 날짜 함수 KST 고정(`lib/kst.ts`)과 시작 시각 기준 통일(`comparison.ts`·`history.ts`는 종료 시각을 쓰고 있었음), 시각 표시 KST, 계약 선택 필드. 기록·달력은 로직만 고침(화면 모양은 그대로, lellon0403 화면 — klaod-tech가 로직 수정을 맡기로 함). **남은 것:** 자정에 끊긴 뒤 측정 잇기(A·B 방식을 정한 뒤, 서버가 자정 끊기를 켜기 전에 먼저) | BE-6 |
| 13 | **BE 브랜치 `fix/repo-backend-sync`(`b903751`, 김유진 10/26 정리 문서)에 맞추기 — V3 병합 전.** 10/26 함: F-a B1 본문 `registration_id`(촬영마다 `crypto.randomUUID()`, 재시도에 같은 값, `registered_at` 안 보냄 — DB V2.5 `cab11c1`), F-b WS 검증(앱은 모르는 필드를 무시하므로 바꿀 것 없음, 계약은 BE와 같은 정의로), F-c 기록 시작·종료를 `ready.started_at`·`closed.ended_at`으로(`ended_at` null이면 「종료 미확인」), F-d 오늘 날짜는 서버 시각의 KST 날짜, F-e ADR 0026·0027·연동 명세. ADR 번호: FE 0028(웹 작은 창)·0029(자정·서버 시각)는 그대로 두고, 같은 날 0028을 쓴 BE ADR은 BE가 0030 이후로 옮기기로 함. **반영 순서(BE 문서 4장):** ① FE V3 새 계약(이 항목) → ② DB migration 015 → ③ 새 API → ④ 앱 배포. V3만 먼저 develop에 들어가면 지금 서버(V2.4)가 B1의 `registration_id`를 모르므로 **BE 브랜치와 함께 합친다**. **10/27: BE 브랜치가 PR #65로 develop에 먼저 들어감 — 순서 문제 풀림** | — |
| 14 | ~~`closed(unmeasurable_timeout)` 처리~~ **10/27 함**(`LiveSession.ts` `CLOSED`, 계약 `closed.reason`, 연동 명세 5.3 — 서버에서 켜도 됨)(BE 10/27 공유 문서 3장 FE 1): 판별 불가·자리 비움이 5분 이어지면 서버가 저장하고 이 사유로 닫는다. 앱은 「저장된 정상 종료」로(예: 「측정을 못 하는 상태가 5분 이어져 측정을 마쳤어요」), 계약 사본 `closed.reason`에 추가. 지금은 모르는 사유라 측정 실패로 처리해 기록을 남기지 않는다. 서버는 앱이 처리한 뒤 켠다(`POSEGOOD_UNMEASURABLE_TIMEOUT=5m`, 기본 꺼짐) | — |
| 15 | ~~측정 중 `bad_message`·`unauthorized`를 「저장됨」으로~~ **10/27 함**(`ready` 뒤에만, 모르는 사유도 같게)(BE 10/27 FE 6): 서버는 이때도 마지막 구간까지 저장한다. 측정 중이었다면 `session_lost`처럼 `lost: true`로 로컬 기록을 남긴다(`LiveSession.ts` `CLOSED`) | — |
| 16 | **좌표 프레임마다 전송 실제 서버 확인**(10/27 팀장 결정, BE-8): V3 `frames.ts`는 프레임 1장짜리 구간을 다음 프레임이 찍힐 때 보낸다. BE 브랜치 서버에 붙여 `bad_message` 없이 프레임마다 `observation`이 오는지, 요약 시간이 맞는지 앱으로 확인 | 4 |
| 17 | ~~R1·T1 새 형식~~ **10/27 연동 명세 4.5에 적음**(앱은 아직 R1·T1을 부르지 않아 코드는 2번에서)(BE 10/27 1장 6·10번): R1은 배열이 아니라 `{today, records}`, T1은 `{today, from, to, days}`(필드는 `daily_stat` 칸 이름). 연동 명세 4.5를 고치고, 2번에서 R1·T1을 붙일 때 이 형식으로 읽기. T1이 기록·달력 화면에 맞는지 lellon0403과 확인 | 2, T1 구현 |
| 18 | **자정 끊기 방식 맞추기**: BE는 A안(`closed(day_changed)` → 앱이 새 S1·WS로 이어감, 로그인 401은 리프레시 토큰으로 해결)을 권한다(BE 10/27 2.1). ADR 0029는 A안, 이 문서 1.1·BE-6 ①은 B안이라 FE 문서끼리 다르다 — 회의에서 정한 뒤 한쪽으로 맞추고, 그 사유 처리를 앱에 먼저 넣는다 | 팀 회의, 리프레시 토큰 |
| 19 | **develop PR #64(lellon0403 `ad7cd42`, 10/26) 디자인·작은 창을 V3로 가져오기**: klaod-tech가 요청해 lellon0403이 앱 전체 디자인(숲 테마·글꼴·아이콘·그림)과 데스크톱 작은 카메라 창(테두리 없는 Electron 창, 접기·앱으로 돌아가기)을 바꾼 것. **디자인과 작은 창은 PR #64 것을 쓰고 V3의 것(`features/desktop/DesktopCameraWindow` 등)은 뺀다.** 로직(서버 전용 측정, `serverClock`·`lib/kst`, 프레임 전송)은 V3 것을 유지. 미리 합쳐 본 결과 충돌 35개 파일, V3가 지운 파일(웹 `CameraWindow`·`useCameraWindow`, 옛 `SessionLive`·`SessionResult`·`MeasureParts`·`RecoveryNotice`)을 PR #64가 고쳐 둠. 번호 겹침: PR #64의 ADR 0025·계획 0054·0055가 V3의 같은 번호와 겹침. **10/27 합침:** 디자인(아이콘·그림·숲 테마·글꼴, `DESIGN.md`)과 작은 창(`CameraWindow`·`useCameraWindow`·`electron/camera-window.cjs`)은 PR #64 것, V3 `DesktopCameraWindow`·계획 0055는 지움(superseded). 날짜 나누기(`dailyMeasurement.ts`, 그쪽 ADR → 0031)는 V3 서버 누적 요약으로 다시 붙임(`useSessionPersistence` `observe`). 「오늘」은 V3대로 서버 날짜(`useServerToday`), 그쪽 `useKstDay`(PC 시계 1초마다)는 지움, `lib/kstDay.ts`는 `lib/kst` 이름만 남김. 메일 인증 화면은 꺼진 채로 들어옴. 그쪽 계획 → 0057·0058. V3가 지운 옛 로컬 측정 화면·중간 기록·그 시험은 그대로 지움. 시험 271개·`tsc`·빌드·`check-repo` 통과. **남은 것:** 데스크톱 앱에서 작은 창·새 디자인을 실제로 띄워 보기, `check-browser`(Docker 필요) | 실제 앱 확인 |
| 20 | **측정 중 WS 줄이기, 결과 상세는 API로**(10/27 계획을 두 단계로 다시 씀 — BE-10)([계획 0059](../plans/active/0059-slim-realtime-results-over-api.md), 10/27 klaod-tech 제안): 측정 중 WS는 점수·판정 불가·`alerting`·유지율(`keep_rate`)(`observation`)과 알림(`alert`)만, 측정 시간은 앱이 `ready`부터 전체 시간으로 세고(10/27 정함), 끝난 뒤 S4로 요약·사건 전체를 받아 기록에. WS 계약을 바꾸므로 BE와 합의 필요 | 팀장·BE 합의 |

**10/22 V3 코드 검토로 고친 것:** S1·B1은 응답이 없으면(연결 오류·5초 초과) 같은 본문으로 다시 보냄(`retryUnanswered`), B2가 실패하면 등록을 자동으로 시작하지 않고 「다시 불러오기」·「새로 등록」, S1 응답 전에 측정을 끝내면 연결하지 않음, `end` 뒤 WS가 먼저 닫히면 S4를 한 번만. 같은 날 남은 앱 판정(어깨 유예·머리 판정·고개 돌림·특징값 계산)도 지웠다(F5). 시험 217개 통과.

**10/22 F12 브랜치 검수 → 같은 날 V3로 옮김** (`origin/feature/fe-v2-auth-login` `f27dd24`, ghdrb1246 — 서버 컨테이너 8088에서 확인. 우리는 Cloudflare 터널 `api.posegood.site`로 붙으므로 검수용으로만 봄):

| 항목 | 그 브랜치 | V3로 옮길 때 |
|---|---|---|
| 기준 코드 | BE 브랜치(`047a095`) 위 = V2 화면. `LocalServiceApp`이 `workspace.setDraft(loadLocalState().draft)`를 부른다 | 이어하기(draft)는 V3에서 지웠으므로 그 줄은 빼고 옮긴다. `serverConfig.ts`도 양쪽이 고쳐 충돌한다 |
| `accountClient.ts`(A1~A5) | `/api/v2/auth`, `credentials: 'include'`, CSRF 캐시(로그인·로그아웃 때 비움), **403 `ACCESS_DENIED`면 토큰을 새로 받아 한 번 재시도**, 로그아웃에 `X-PoseGood-User-Id`, 시간 초과 10초 | 그대로 가져온다. 7.2 7번의 CSRF 403 재시도를 V3 `api.ts`에도 같은 방식으로 넣는다 |
| 로그인 뒤 V3 서버 요청 | 없음(그 브랜치에는 `setServerAuth`가 없다) | 로그인·가입·`me` 성공 때 `setServerAuth({ userId: view.user_id, csrfToken })`, 로그아웃 때 `setServerAuth(null)`. CSRF 토큰은 `accountClient`의 것을 같이 쓴다(두 군데서 따로 받으면 로그인 때 하나가 낡는다) |
| `VITE_SERVER_ACCOUNTS` | 다시 만든 스위치. `true`면 서버 계정, 없으면 이 기기 로컬 로그인. 서버 컨테이너 Dockerfile은 `true` | **10/22 결정(klaod-tech): 스위치 없음, 항상 서버 계정**(로컬로 돌릴 이유가 없다 — 측정이 항상 서버). V3에는 이 변수가 없다. 서버 컨테이너 Dockerfile의 `ARG`는 남아도 영향 없음(BE에 알림) |
| 앱을 다시 열 때 | `me()`로 로그인 되살림. 실패는 조용히 무시 | V3는 그 뒤 B2(기준 자세)를 받으므로 `me()` 성공 → `setServerAuth` 순서가 맞아야 한다. `me()` 응답은 형식 검사 없이 쓴다(로그인·가입은 검사) |
| 409 `AUTH_CHANGED` | 로그아웃만 헤더를 보냄, 실패는 무시 | 7.2 7번 그대로: V3 `api.ts`에서 받으면 `me()`로 다시 맞춘다 |
| 같은 출처 전제 | 8088 화면 컨테이너(같은 출처)에서만 확인 | `app.posegood.site` → `api.posegood.site`는 다른 출처라 CORS(BE, 아직 없음)·`POSEGOOD_COOKIE_SECURE=true`·WS 허용 출처가 있어야 한다([배포](fe-deploy.md)) |
| 시험 | `accountClient.test.ts`, `LocalServiceApp.accounts.test.tsx` | 함께 옮긴다 |

**10/22 서버 연동 전 API·WS 대조** (BE 브랜치 `047a095` 코드 — API 명세·계약·서버 코드가 V3가 받은 `d87d497`과 같음):

| 항목 | 결과 |
|---|---|
| S1 본문 `{policy, baseline_id}`, `policy` 4개 정수 ms·`threshold` | 맞음. 모르는 필드는 400이라 더 보내지 않는다 |
| S1 기본 판정 기준 | 서버 기본값(0.7·3초·3초·60초)이 앱 `DEFAULT_RULES`와 같아 W1 전에도 새 계정은 통과. **설정 화면에서 바꾸면 W2가 붙기 전까지 S1이 409**(「설정이나 기준 자세가 바뀌었어요」) — 실제 서버 시험 때 설정을 바꾸지 않는다 |
| `hello`(`type`·`schema_version` 2.0·`purpose`·`session_id`, 다른 키 금지), `end`(`type`·`end_ms`) | 맞음 |
| `features`의 구간: `schema_version` 3.0, `keypoints-9-v1`, 길이 1~1500ms, 프레임 30개 이하, `valid`는 false만, `p`는 9×3 또는 null | 맞음(앱은 0.5초·30fps 이하라 15개 이하) |
| 관절 값 범위(x·y -1~2, visibility 0~1) | **고침**: 앱이 자르지 않아 화면 밖으로 크게 벗어난 추정 좌표 하나로 측정이 `bad_message`로 끝날 수 있었다. 7.0에는 「자른다」고 적혀 있었다 |
| 서버 → 앱 `ready`·`ack`·`observation`(3.0)·`progress`(`paused_reason`)·`decision`·`alert`·`stalled`·`closed` 8개 사유 | 맞음. null 필드도 키가 온다(Jackson 기본) |
| 서버 동작: 구간 400·409 → `bad_message`, 429 → `limit_reached`, 502·503 → `stalled`(그 구간은 누락), 끊김 → 마지막 구간 끝에서 서버가 종료 | 앱 처리와 맞음 |
| 남은 것 | 7.2의 7번(`AUTH_CHANGED`·CSRF 403 재시도·계정이 바뀐 뒤 응답), 8번(S1 뒤 WS가 안 열린 세션), CORS·WS 허용 출처(배포 요청), R1·T1(기록 화면) |

**10/22 문서 정리 (무엇이 어디로 갔나)** — 지운 것은 [지운 문서 기록](../removed-docs.md) 6장.

| 전 | 후 |
|---|---|
| 이 문서 3장(보내는 것)·3.2(쉬기·자리 비움·종료 표, DB 규칙)·3.3(등록)·4장·4.1(화면 상태) | [연동 명세](api-ws-spec.md) 5.1·5.2·5.4·5.3. 여기에는 3장 요약만 |
| 이 문서 1장의 10/16~19 BE 확인 기록, 7.0 미정 3개의 설명 | 지움(결정 결과만 남김, git `dc2c5d4`) |
| 이 문서 4.1의 로컬 화면 상태 7개(`suspect`·`recovering`·최근 30분 흐름) | 지움. V3 화면 상태는 연동 명세 5.3 표 |
| 이 문서 6장 `referenceRuleCases.test.ts` 설명 | 10/21 시험이 지워진 것에 맞춰 고침 |
| 연동 명세 0.1~0.6(10/13~15 검토 답변·BE 명세 대조, 약 120줄) | 지움. 지금 유효한 결정만 0장 표로 |
| 연동 명세 0.7(탈퇴) | 연동 명세 2장 끝 |
| 연동 명세 4장 REST 요청·응답 본문 | BE 명세가 기준이라 빼고 앱이 지킬 것만 4장에 |
| 연동 명세 5.3 자세 등록·6.2·6.4 | 5.4·6.3으로 번호 바뀜 |
| `fe-domain-idea.md`(배포 구상) | 이름 `fe-deploy.md`(배포). 6장(데스크톱 앱 구조)은 이 문서 8.4로 |
| `server-persistence-and-auth.md`, `data-platform-boundary.md`(10/01~06, 예전 v1 백엔드 기준) | 지움. (10/25: `data-platform-boundary.md`는 팀장이 10/22 develop에서 현행 기준으로 고쳐 써 develop 합칠 때 되살림(유지 여부는 1장에서 팀장에게 물음)) 10/22 기준 서버 구조는 [아키텍처 v5.2 스택별 역할](architecture_v5.2_stack_roles.md)·[변경 안내](architecture_v5.2_change_notes.md) |
| 코드: 쉬는 중 카메라 영상이 멈추면 `rest` 유지 | DB V2.3 우선순위(`ABSENCE` 먼저)대로 `away`로 바꿈(`LiveSession.away`, 시험 1개 추가) |

알릴 것: BE — **10/22부터 어깨가 하나라도 안 보이는 프레임은 바로 `valid:false`**(전에는 처음 2초는 `valid:true`), 관절을 `[0, 0, 0]`으로 채운 프레임도 `valid:false`. **고개 돌림 구간은 학습 데이터에서 뺀다**(10/22 klaod-tech: 지금 API 판정의 `head_turn` 제외를 유지, Kafka 경로(계획 0031 표 5번)에서도 `head_turn` 힌트를 같은 조건으로 넣어야 함). `FrameFeatures.java` 주석이 가리키는 `pose.ts` `headTurned`·`serverFeatures.ts`는 10/22 앱에서 지웠다(원본은 develop). 로그인 뒤 `setServerAuth({ userId, csrfToken })`(`features/platform/serverAuth.ts`)와 W1(BE-3). lellon0403 — 측정하기의 로컬 판정이 없어졌고 측정 화면은 `features/session/live/`, 기록 상세는 서버 결과 형식(`server.view`)을 그대로 쓴다.
V3를 develop에 합치는 것은 `api.posegood.site` 터널이 붙은 뒤에 한다(Vercel 배포본이 서버 없이는 측정할 수 없게 되므로). 10/26 정정: Vercel은 포크 develop을 배포하므로 develop에 합치는 것만으로는 운영 화면이 바뀌지 않는다 — 포크 최신화를 서버 준비 뒤에 한다. 또 V3는 BE 브랜치 `fix/repo-backend-sync`와 함께 합친다(7.2 13번).

## 8. 지금 앱 (FE 참고)

10/19 연동 명세 7장(FE 참고)과 데스크톱 앱 화면 설계(`docs/design/desktop-app.md`, lellon0403)를 여기로 합쳤다. 데스크톱 창·시작 프로그램·알림 팝업은 8.4, 실행 명령은 [FE 작업 명령과 검사](fe-commands-and-checks.md)에 있다. 시각 규칙은 [DESIGN.md](../../DESIGN.md), 결정은 [ADR 0017](../decisions/0017-desktop-app-shell-and-redesign.md).

### 8.1 서버에 붙은 것과 남은 것 (10/21 V3)

10/26 기준. 「서버에 붙일 때」 칸이 「—」이면 이미 서버로 바뀐 것, 칸이 채워져 있으면 아직 이 PC(브라우저)에서 도는 것이다.

| 항목 | 10/22 앱 | 서버에 붙일 때 |
|---|---|---|
| 로그인 | **10/22 바꿈:** A3 로그인·A4 `me`(앱을 다시 열 때)·A5 로그아웃(`features/auth/accountClient.ts`) | — |
| 가입 | **10/22 바꿈:** A2(`consentPayload()`), 비밀번호 12자·72바이트(`validServerPassword`). 프로필·동의 선택은 화면용 사본을 이 기기에도 둔다 | — |
| 기준 자세 | **10/21 바꿈:** 서버에 하나(앱이 관절 평균을 내서 B1, 조회 B2, `features/baseline/`), 어느 카메라든 같은 것 | — |
| 실시간 | **10/21 바꿈:** `/v2/realtime` 좌표 구간(`features/session/live/LiveSession.ts`, `realtime/frames.ts`) | — |
| 기록(오늘 탭)·달력의 고른 날 | 이 PC 기록. `features/history/recordsSource.ts` `sessionsOn`, `DayRecord.tsx`, `LocalHistory.tsx`, `RecordCalendarPage.tsx`(화면 담당 lellon0403, 10/14) | 과거 세션은 R1·R1b, 오늘은 로컬에 모은 서버 결과로 목록·요약(10/22, 연동 명세 4.5) |
| 달력: 날짜별 합계(월 달력·잔디·최근 7일·30일) | 이 PC 기록. `recordsSource.ts` `dailyStats`, `ActivityHeatmap.tsx`, `RecordCalendar.tsx` | 어제까지는 T1(≤ 92일), 오늘 칸과 기간 그래프의 오늘 값은 로컬 집계(10/22). 같은 날짜를 서버·로컬에서 겹쳐 더하지 않는다. 잔디는 1년(53주)이라 92일씩 5번, 달력은 달마다 요청. 알림 총수(재알림 포함)는 T1 행에 없어 `alerted_event_count`로 보인다. 기간 통계는 날짜를 고르지 않았을 때의 오른쪽 칸(`PeriodCard`)에 붙일 예정 |
| 알림 | **10/21 바꿈:** v2 `alert`를 그대로 소리·토스트·데스크톱 팝업으로 | — |
| 날짜·시각 | **10/26 바꿈:** 기록 시작·종료는 WS `ready.started_at`·`closed.ended_at`, 「오늘」은 가장 최근 서버 시각의 KST 날짜(`features/platform/serverClock.ts`), 날짜 계산·표시 KST 고정(`lib/kst.ts`) | 서버가 값을 보내면 그대로(BE 브랜치 병합, A4 `today`는 BE-6). 그 전에는 PC 시계를 KST로 |
| 판정 불가 표시 | **10/22 바꿈:** 어깨가 하나라도 안 보이는 프레임에 바로 `valid:false`(`features/camera/shoulderCheck.ts`, `LiveSession.ingest`). 2초 동안 머리로 판정하던 유예는 지웠다 | — |
| 앱 판정 | **10/21 V3에서 지웠다**(판정 엔진·복귀 대기·카메라 샘플·로컬 측정 화면). 점수는 서버 공식 100×(1−collapse_probability)로 표시만(`postureScore`). develop과 Vercel 배포본은 10/26 기준 V2(로컬 판정) | — |
| 기록 통계 계산 | 앱이 기록으로 계산한다(`lib/stats`·`lib/comparison`·`recordsSource.ts`, 오늘 포함). 5분 미만 세션 규칙은 없다 | 어제까지는 서버 값(T1, 5분 미만은 「붕괴까지 걸린 시간」 최소·최대에서만 뺌 — 서버 계산), 오늘은 로컬 집계 — 오늘 집계 코드는 남긴다(10/22). 화면 담당 lellon0403 |
| 탈퇴 | 이 브라우저의 자료를 바로 지운다(`WithdrawalDialog.tsx`) | A7: 비밀번호 칸, 「되돌릴 수 없고 30일 뒤 완전히 삭제, 그 전에는 같은 이메일로 다시 가입할 수 없음」. 탈퇴 계정 로그인(403 `ACCOUNT_CLOSED`)에 연락처 안내(연동 명세 2장 탈퇴). 10/22 기준 로컬에서는 바로 지워지므로 30일 문구를 미리 넣지 않는다 |

### 8.2 연결 설정 (`features/platform/serverConfig.ts`)

| 변수 | 뜻 |
|---|---|
| `VITE_API_BASE_URL=https://…` | API 주소 앞부분. 화면을 다른 곳(Vercel)에서 낼 때 운영은 `https://api.posegood.site`. 없으면 같은 출처 `/api`(10/19, [배포](fe-deploy.md)) |
| `POSEGOOD_API_URL` (개발 서버) | `/api` 중계 대상. 기본 `http://127.0.0.1:8090` |

예전 계정 모드 스위치 `VITE_SERVER_ACCOUNTS`는 2026-10-13(10/22 F12 브랜치가 다시 만들었지만 V3로 옮기며 빼서 로그인은 항상 서버), 실시간 스위치 `VITE_REALTIME_URL`·`VITE_REALTIME_FRAMES`와 개발자 옵션의 「서버 판정 사용」은 2026-10-21 지웠다(앱은 항상 서버로 측정, WS 주소는 API 주소나 페이지 주소에서 만든다).

### 8.3 화면과 코드 위치

사이드바 탭은 측정하기·기록·달력·설정 4개다(`app/AppSidebar.tsx`, `app/navigation.ts`의 `tabOf`·`resolvePage`, 조립 `app/ServiceScreens.tsx`). 화면 담당: 측정하기·기록·달력은 lellon0403(10/14).

| 탭 | 화면 | 코드 | 보여 주는 것 |
|---|---|---|---|
| 측정하기 | 준비 | `pages/SetupPage.tsx`, `features/camera/CameraPicker.tsx` | 카메라 → 얼굴·어깨 → 등록한 자세가 없으면 3·2·1 뒤 3초 등록 후 자동 측정, 있으면 2.5초 머물 때 자동 시작(`features/camera/useAutoStart.ts`) 또는 「측정 시작」. 카메라 화면 위 메인 카메라 선택(10/16). 자세 등록 탭은 10/13 여기로 합침 |
| 측정하기 | 측정 중·결과 (10/21 V3) | `features/session/live/LiveSessionPage.tsx`, `useLiveSession.ts`, `LiveSession.ts` | 서버가 준 값만: 상태 알약, 교정 카드, 잠시 쉬기/종료/소리 독, 점수 링, 이번 측정 요약, 결과(바른 자세 비율, 이탈·알림·집계 제외, 서버 사건 표). 예전 로컬 측정 화면(`SessionLive`·`SessionResult`·`MeasureParts`, 최근 30분 흐름)은 지웠다 |
| 기록 | 오늘 | `features/history/LocalHistory.tsx` | 오늘 측정 목록과 요약(10/13 기록·달력 분리) |
| 달력 | 고른 날·날짜별 합계 | `features/history/RecordCalendarPage.tsx`, `RecordCalendar.tsx`, `ActivityHeatmap.tsx`, `DayRecord.tsx` | 월 달력, 잔디, 고른 날의 기록 |
| 설정 | 설정 | `pages/SettingsPage.tsx` | 알림(3단계 선택 + 세밀 조정), 기준 자세 다시 등록(측정하기에서 등록), 컴퓨터를 켤 때, 계정, 개발자 옵션 |
| 설정 | 프로필 / 자세 데이터 수집 | `features/profile/*`, `pages/CollectionPage.tsx` | 프로필 수정, 학습용 수집(jisung) |
| — | 로그인 | `pages/LoginPage.tsx` | 왼쪽 소개, 오른쪽 입력 |
| — | 작은 카메라 창 | (10/26 데스크톱만) `frontend/electron/main.cjs`, `features/desktop/`(계획 0055), 측정 상태·종료 연결 `features/session/sessionControl.ts` | **10/26 웹에서는 지웠다**([ADR 0028](../decisions/0028-no-web-camera-window-desktop-only.md)): 카메라만 쓰는 페이지는 Chrome이 자동 PiP 처리기를 부르지 않고(최소 시험 페이지도 같음, 자동 PIP 허용, 클릭으로는 열림), 클릭으로 연 창은 앱 탭에서도 떠 있어 측정 화면을 방해한다. 웹은 다른 탭에 가도 측정이 이어진다(프레임 타이머 `features/camera/frameTimer.ts`, Worker). **데스크톱 앱:** PoseGood 창이 포커스를 잃거나 최소화되면 오른쪽 아래에 작은 창이 저절로 보이고, 앞으로 오면 숨는다([계획 0055](../plans/active/0055-desktop-camera-window.md)). 10/20 시안 그대로 영상만, 띠에 상태 점·문구(초록 「바른 자세예요」, 빨강 「자세가 흐트러졌어요」+테두리, 회색 「자세를 확인할 수 없어요」·「쉬는 중」, 측정 중이 아니면 「카메라 사용 중」)와 최소화·확대·X(측정 중이면 종료·저장) |

디자인 시안(캔버스 7장: 측정 중·알림·기준 등록·결과·기록·설정·작은 창)은 claude.ai 아티팩트로 공유했다(lellon0403). 시안의 숫자는 화면 예시 값이며 측정 결과가 아니다.

### 8.4 데스크톱 앱 구조 (`frontend/electron/`)

10/19 데스크톱 앱 화면 설계(`docs/design/desktop-app.md`, lellon0403)에서 배포 문서로 옮겼다가, 10/22 배포와 상관없어 여기로 옮겼다. [배포](fe-deploy.md) 4장 5단계(F14)에서 바꿀 곳이 여기 있다.

| 파일 | 역할 |
|---|---|
| `main.cjs` | 창 생성, 외부 주소 차단(`sameAddress`), 단일 실행, 시작 프로그램 등록, 데스크톱 설정 파일(`userData/desktop-settings.json`), 패키징된 앱의 `app://posegood` 파일 제공 |
| `preload.cjs` | 페이지에 `window.posegoodDesktop`(launch 정보, 시작 프로그램, 자동 카메라, 알림 팝업 설정·표시, 종료, 10/26 작은 카메라 창 `cameraWindow`·`focusApp`·`setCameraWindowCompact`)만 노출 |
| (10/26) 작은 카메라 창 | `main.cjs`가 `window.open('about:blank', 'posegood-camera-window')` 하나만 테두리 없는 항상-위 창으로 허락하고(`allowCameraWindow`), 앱 창이 포커스를 잃거나 최소화되면 `showInactive`, 앞으로 오면 숨긴다(`syncCameraWindow`). 화면은 `features/desktop/DesktopCameraWindow.tsx`가 portal로 그린다. [계획 0055](../plans/active/0055-desktop-camera-window.md) |
| `popup-preload.cjs` | 알림 팝업 창에 `window.posegoodPopup`(문구 받기, 닫기, 앱 열기)만 노출 |
| `launch-dev.mjs` | 바탕화면 바로가기용: 개발 서버(5174) → 창 → 종료 시 서버 정리 |

- **보안:** IPC는 앱 자신의 주소에서 온 요청만 받는다. `nodeIntegration` 끔, `contextIsolation`·`sandbox` 켬. 화면을 `https://app.<도메인>`에서 열면 이 「앱 자신의 주소」가 바뀐다(F14).
- **창:** 기본 1360×860, 최소 1180×760. 제목 표시줄은 숨기고(`titleBarStyle: 'hidden'`) Windows는 `titleBarOverlay`로 창 버튼만 크림색(`#fbf5ee`) 위에 그린다. 메뉴는 `removeMenu()`로 없앤다. 개발 실행에서는 F12 키/Ctrl+Shift+I, Ctrl+R을 유지한다. 페이지는 `data-desktop`과 `--titlebar-h`로 여백을 맞추고 `features/desktop/TitleBar.tsx`가 끌기 영역을 그린다.
- **아이콘:** `frontend/public/branding/posegood-icon.svg`가 정본이고 PNG·ICO는 같은 SVG에서 내보낸다. 로그인·사이드바의 `BrandMark`, 브라우저 탭, Electron 창이 같은 아이콘을 쓴다. Windows 패키징은 `win.icon`으로 ICO를 넣고 `signExecutable: false`로 서명만 생략한다(`signAndEditExecutable: false`는 아이콘 편집까지 막아 쓰지 않는다). 빠른 실행기는 `copy-desktop.mjs`의 `/win32icon`으로 같은 ICO를 넣는다. 아이콘을 바꾸면 `npm run desktop:pack`으로 다시 만든다.

#### 시작 프로그램 (설정 → 컴퓨터를 켤 때)

1. `자동으로 PoseGood 열기`: `app.setLoginItemSettings({ openAtLogin, args: ['--launched-at-login'] })`. 패키징 전에는 비활성(개발 실행은 개발 서버가 필요하다).
2. `열릴 때 카메라 바로 켜기`: 데스크톱 설정 파일에 저장. 시작 프로그램 인자로 열렸고 켜져 있으면 `features/desktop/useLaunchAutomation.ts`가 로그인 후 측정하기에서 카메라를 한 번 연결한다. 등록한 자세가 있으면 2.5초 머물 때 측정이 저절로 시작된다(`useAutoStart.ts`, 10/13).
3. 남은 것: 트레이. 작은 항상-위 카메라 창은 [계획 0055](../plans/active/0055-desktop-camera-window.md)(10/26 시작, [ADR 0028](../decisions/0028-no-web-camera-window-desktop-only.md)). (설치 파일 패키징과 패키징된 앱의 `dist` 읽기, 저장된 기준 자세 불러오기는 이미 됐다.)

#### 자세 알림 팝업 (10/06 요청, 10/14 모양 변경)

알림(붕괴 확정·재알림)이 울릴 때 앱 창이 가려졌거나 최소화돼 있으면 화면 오른쪽 아래에 작은 팝업(`public/alert-popup.html`)을 띄운다. 앱 창이 포커스를 갖고 보이면 앱 안 토스트·소리만 쓴다(main이 `in-app`으로 건너뜀).

- 항상 위에 뜨지만 포커스를 가져가지 않고(`showInactive`) 8초 뒤 숨는다. 앱 안 스낵바와 같은 짙은 갈색 작은 알약이고, 의자 아이콘을 두른 링이 남은 시간을 보여 준다. 알약을 누르면(또는 Enter) 앱을 열고, X·Esc로 닫고, 좌우로 70px 넘게 밀면 그 방향으로 밀려나며 닫힌다.
- 문구는 `features/desktop/alertPopup.ts`에 있다(예전 측정 화면의 방향별 문구에서 왔다). 재알림은 "아직 자세가 돌아오지 않았어요."를 앞에 붙인다.
- 설정 `알림 → 다른 창을 볼 때 팝업`(기본 켜짐)은 데스크톱 설정 파일의 `alertPopup`에 저장한다. 교정 알림을 끄면 팝업도 없다. `개발자 옵션 → 알림 모양 확인 → 앱 밖 알림창`은 앱을 보고 있거나 팝업이 꺼져 있어도 띄운다.
- 앱 창을 닫으면 숨은 팝업 창도 정리해 앱이 종료된다. 일반 브라우저 탭에는 팝업이 없다.
- 검증(lellon0403): 패키징 EXE를 숨긴 창·독립 프로필로 실행해 `showAlert`→`popup`, 문구·표시, 설정 끔→`off`를 확인했다. 실제 측정 중 다른 창을 볼 때의 확인은 따로 한다.
- 팝업 주소는 패키징 때 `app://posegood/alert-popup.html`이라, 화면을 `app.<도메인>`에서 열 때 같이 바꾼다(F14).
