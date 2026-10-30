# 앱 판정 제거와 서버 결과 전용 화면

- 상태: in_progress (10/21 V3 `feature/frontend-features-and-integrationV3`에서 측정·자세 등록을 서버로 바꾸고 로컬 판정을 지움. 10/22 코드 검토로 재시도·B2 실패·측정 시작/종료 경계를 고침. 10/26 서버 시각·KST·B1 `registration_id`(BE 브랜치에 맞춤). 남은 것: 더미 데이터 삭제, 기록 화면의 서버 연결, 실제 서버 시험(BE 로그인 뒤))
- 담당: FE
- 시작일: 2026-10-11
- 관련: [FE 제안서](../../design/fe-server-proposal.md)(BE에 물을 것 1장, FE 할 일 7장), [연동 명세](../../design/api-ws-spec.md),
  [WebSocket v2 계약](../../../contracts/realtime/realtime-ws.v2.schema.json), [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md)(옛 0025·0026 포함)·[0024](../../decisions/0024-session-ends-on-lost-connection.md)

## 배경

10/20까지(V2) 앱은 서버 없이도 혼자 판정했다. 점수, 상태(좋음/무너짐/측정 불가), 고개 돌림 제외, 복귀 대기를 브라우저가 계산했다.
서버가 없던 시기의 FE 개발·시연용 구성이었다. 10/21 V3에서 측정 쪽 판정을 지웠다(ADR 0021).

2026-10-11 팀 결정: **앱은 판정하지 않는다.** 앱 판정 자체와 ML용 CSV 판정 라벨을 모두 없앤다.

## 목표

앱은 **카메라 → 관절 추출 → 좌표 전송 → 서버 결과 표시**만 한다.

| | 시작할 때(10/11) | 바뀐 뒤 |
|---|---|---|
| 판정 | 앱(로컬) 또는 개발 서버(v1, 특징 변화량) | 서버만(v2, 좌표) |
| 로그인·기록 | 이 기기에서(로컬 로그인·회원가입, 10/13) | 입출구 서버(A1~A7, W1, R1. 탈퇴 철회 A8은 10/15 없어짐) |
| 화면 상태 | 앱 판정 | 서버 `observation`·`progress`·`decision`·`alert` |
| 네트워크 끊김 | 앱 판정으로 계속 | 세션을 끝내고 화면을 막는 팝업. 재연결하지 않는다(ADR 0024) |
| 유형 표시 | 표시하지 않음(10/11 제거) | 같음 |
| ML용 CSV | 좌표만(라벨 없음, v3) | 같음 |

## 완료 기준

1. FE 코드(`frontend/src`)에 판정 코드가 없다. 점수·상태·고개 돌림·복귀 대기 계산을 import하는 곳이 없다(검색으로 확인).
2. 서버 없이 측정을 시작하면 이유를 안내하고 시작하지 않는다.
3. 측정 중 화면 상태는 서버 메시지로만 바뀐다. WebSocket v2 합성 예시를 넣는 컴포넌트 시험으로 확인한다.
4. 연결이 끊기면 세션을 끝내고 종료 화면을 그린다. 서버가 끊긴 시점까지 저장하므로 앱은 S3를 부르지 않고, `end` 뒤 `closed`가 10초 안에 없으면 S4로 결과를 읽는다(10/22). 가짜 서버 시험으로 확인한다.
5. 서버 담당이 합성 시험 데이터([규칙 사례](../../../contracts/examples/frames/reference-rule-cases.json))로 같은 결과를 확인했다.
6. `python tools/dev.py check` 통과. 프론트 시험 수·타입·빌드 결과를 기록한다.

## 범위와 제외

- 범위: `frontend/src` 전체(판정·내보내기·화면 연결), `contracts/realtime/`, 데이터 플랫폼 경계·세션 내보내기 명세.
- 제외: 서버 판정 구현(서버 담당), ML 모델, DB 스키마, 측정하기 화면(lellon0403), 학습용 자세 데이터 수집 화면(jisung).
- 지키는 것: 실제 영상·랜드마크·참여자 정보는 저장소에 넣지 않는다. 시험은 합성 데이터만 쓴다.

## 작업 단계

### 0단계 — 팀 결정 (끝남)

- [x] 앱이 붙는 서버: BE 입출구 서버(`auth`·`api`·`ws`, 아키텍처 v5.1, v5.2에서도 같음). 게이트웨이는 FE가 만들지 않는다.
- [x] 앱이 보내는 정보: 좌표 구간 `posture.frames.v1`, 판정 불가 프레임은 `valid:false`(BE 명세 10/13).
- [x] 앱과의 계약: [연동 명세](../../design/api-ws-spec.md)와 [WebSocket v2 계약](../../../contracts/realtime/realtime-ws.v2.schema.json)(10/13).
- [x] `observation.invalid_reason`(BE 동의). 10/22 기준 `unmeasurable` 하나만 쓴다.

### 1단계 — 서버와 무관한 준비 (끝남)

- [x] 규칙 문서와 합성 시험 데이터([규칙 사례](../../../contracts/examples/frames/reference-rule-cases.json), `referenceRuleCases.test.ts`).
- [x] ADR 0021, 어긋나는 문서에 변경 안내.
- [x] 좌표 묶음 코드 준비(`features/session/realtime/frames.ts`, klaod-tech).

### 2단계 — 앱 판정 제거

- [x] ML용 CSV 판정 라벨 제거, 유형 표시 제거(10/11). 수집 CSV v3(10/12).
- [x] 예전 계정 모드 제거, 로컬 로그인·회원가입 3단계(10/13).
- [x] 로컬 판정 제거(F5 측정 쪽, 10/21 `f88ffe3`): 판정 엔진(`machine`·`scenario`·`snapshot`), `lib/returnSettle.ts`, `lib/cameraSample.ts`, 로컬 측정 화면, 이어하기. `lib/engine.ts`는 기록 타입만 남김. `postureScore`는 서버 공식(100×(1−collapse_probability)) 표시로 남김.
- [x] 측정 화면의 점수·상태를 서버 결과 표시로 바꾼다. 서버 없이는 측정을 시작하지 않는다(10/21, 개발자 옵션 「서버 판정 사용」 삭제).
- [ ] 더미 데이터 삭제(10/21 결정): 발표용 예시 기록(`data/exampleRecords.ts`), 합성 시연 `demo` 기록, `testing/legacySyntheticRecord.ts`. 자동 시험용 가짜 카메라(`?synthetic=1`)는 남긴다.
- [x] 앱의 특징값 계산 삭제(10/22): 어깨 유예·머리 판정, 고개 돌림·점수·분류, 특징값(`features` → `measurable`), 기준 특징 다리(`baselineFeatures`).
- [ ] 남은 앱 계산: 기록 화면의 앱 통계(`lib/stats`·`lib/comparison`) — 서버 기록·통계(R1·T1)로 바꿀 때.

### 3단계 — 서버 연결 (BE `/v2/realtime` 뒤)

- [x] 좌표 구간 전송(F1), `rest`·`away`·`end`와 종료 대비책(F3), 판정 불가 프레임 `valid:false`(F11 앱 쪽) — 10/21 `features/session/live/`. 해상도 표시(F13)는 남음.
- [x] 화면 구동(F4, 측정 화면): `observation`·`progress`·`decision`·`alert`·`stalled`, `invalid_reason`(고개 돌림 안내)(10/21).
- [x] 자세 등록 서버 연결(F2, 10/21 `0449abb`): **10/20 전체 회의로 WS calibration 대신 앱이 관절 9개 3초 평균을 내서 B1로**, 기준 조회는 B2.
- [x] 계정 서버 연결 A1~A5(F12, 10/22): ghdrb1246 `f27dd24`(D-66)를 V3로 옮김 — 스위치 없이 항상 서버 계정, 로그인 뒤 `setServerAuth`, CSRF 403 재시도. 남은 것: A6·A7·C1·W1·W2, `AUTH_CHANGED`.
- [ ] (옛 기록) 계정 서버 연결(F12)은 BE 담당(10/14, DevOps 10/21 재확인): 로컬 로그인·가입을 A1~A7·W1로, 비밀번호 12자 검사. 로그인 뒤 `setServerAuth({ userId, csrfToken })`(`features/platform/serverAuth.ts`)를 부르면 앱의 B1·B2·S1·S4가 계정 정보를 쓴다. W1도 같이(S1 `policy`가 계정 값과 같아야 함, FE 제안서 1장 BE-3). 10/22 ghdrb1246이 `feature/fe-v2-auth-login` `f27dd24`(V2 화면 기준)에 A1~A5를 연결했다. V3로 옮길 때 맞출 것은 FE 제안서 7.2 「F12 브랜치 검수」. 받으면 FE가 맞출 것은 FE 제안서 7.2의 7번(`AUTH_CHANGED`·CSRF 403·계정이 바뀐 뒤 도착한 응답).
- [ ] 기록·달력 화면의 서버 연결은 화면 담당(lellon0403)이 `recordsSource.ts`에서 과거 기록 R1·R1b와 어제까지의 통계 T1로 붙인다. 오늘 목록·집계는 서버 결과를 로컬에 수집해 사용하며 해당 수집·집계 처리는 남긴다(10/22 확정, 연동 명세 4.5). V3는 측정 결과를 R1과 같은 형식(`server.view` = SessionView)으로 이 기기에 남긴다(`useSessionPersistence.ts`, 키 하나 — 계정별로 나누지 않음, 연동 명세 4.5 「팀 참고」) — R1로 바꿔도 오늘 표시용으로 유지.

### 4단계 — 검증과 정리

- [ ] 실패 경로 시험: 서버 없음, 연결 끊김, 중복 순번, 로그인 만료, `ready` 5초 초과. 10/22 가짜 서버 시험(`LiveSession.test.ts`)으로 연결 끊김·`ready` 5초·`closed(unauthorized)`·S1 무응답 재시도·S1 실패를 확인. 남은 것: 중복 순번(서버가 거름), 실제 서버로 같은 경로.
- [ ] `python tools/dev.py check`, 서버 담당과 연동 시험(T-13, F9: DevOps 8088 시험 환경, `ssh -L 8088:127.0.0.1:8088`). `check-browser` 시나리오는 서버 전용에 맞춰 다시 쓴다(계획 0030 G6).
- [ ] 이 계획을 끝내고 지운다(지운 문서 기록에 남김).

## 결정과 진행 기록

- 2026-10-11: 앱 판정·라벨 전부 제거, 서버 전용 앱으로 결정. 소리 설정은 저장하지 않는다. 화면 크기는 640×480 요청.
- 2026-10-11: 규칙 문서를 쓰며 확인한 사실. "판정 불가 3초 연속 → 측정 멈춤·자동 재개"는 앱에도 구현되지 않았다(서버 몫).
- 2026-10-12: 기준 자세 등록과 측정 시작을 나눈다. 측정 좌표는 0.5초마다 평균 없이 보내고, 평균은 등록에서만 낸다.
- 2026-10-12: 수집 CSV v3(앱 판정·규칙 특징 열 제거, `bb5fd45`). 「라벨」은 서버·ML 정답만 뜻한다.
- 2026-10-12: 아키텍처 v5 반영. 게이트웨이는 BE `ws`, 측정 종료는 WebSocket `end`. 두 귀가 모두 있어야 판정한다(BE 회신).
- 2026-10-13: 서버 연결이 끊기면 세션을 끝낸다(ADR 0024). 세션 번호는 날짜마다 1부터. 메인 카메라 선택(lellon0403. 10/16 klaod-tech가 선택을 카메라 화면 위로 옮기고 기준 자세를 카메라와 상관없이 하나로 바꿈).
- 2026-10-13: BE API 명세에 맞춰 연동 명세와 WebSocket v2 계약을 만들었다. 세션 시작 = S1을 받은 시각, 5분 미만 세션도 저장(DB V2.3, 10/14 정정), 오늘 측정은 방금 끝난 세션만 결과에, 기록 화면에는 지난 날짜만.
- 2026-10-13: 어깨 2초 유예(`shoulderGrace.ts`, lellon0403, `c505f26`): 어깨가 사라지면 2초 동안 마지막 어깨로 머리를 판정. 2026-10-22 지움(아래).
- 2026-10-13: 예전 계정 모드 삭제, 로컬 로그인·회원가입 3단계(동의 C1~C6 → 계정 정보 → 자세 등록 선택).
- 2026-10-20 전체 회의: 자세 등록의 3초 평균은 FE가 내서 B1로 보낸다(WS 등록 쓰지 않음).
- 2026-10-21: V2를 develop에 넣고(PR #60) V3에 BE 브랜치를 받았다. V3는 서버 전용(로컬 모드 스위치 없음). FE 제안서 7.0의 미정 3개는 FE 권장안대로(klaod-tech 결정, 형식 검사만, 카메라 빠짐·영상 크기 변경은 `end`). F2(`0449abb`), F1+F3과 로컬 판정·이어하기·v1 서버 코드 삭제(`f88ffe3`). 더미 데이터도 지우기로 했다(klaod-tech: develop에 다 있으니 지운다).
- 2026-10-22: 남은 앱 판정 코드 삭제(klaod-tech 결정: 판정 값이 하나라도 없으면 그때부터 서버 판정부가 처리한다). 어깨 유예와 머리 판정(`shoulderGrace.ts` → `shoulderCheck.ts`, 어깨가 안 보이면 바로 `valid:false`), `model/prototype/pose.ts`의 고개 돌림·점수·분류(`headTurned`·`referenceScore`·`classify`·`payload`)와 `turn` 특징, 쓰지 않던 `calibration.ts`·`serverFeatures.ts`, 특징 필터(`createFeatureFilter`)와 `camera.current`·`calibrationSummary`. 이어서 특징값(머리 높이·좌우 치우침·어깨 기울기) 계산도 지우고 프레임 검사는 `measurable`(참/거짓)만 남김, `camera.baseline`은 서버 기준 자세 그대로(기준 특징 다리 삭제), 합성 카메라는 「판정 가능/불가」만 낸다.
- 2026-10-22: 로그인은 스위치 없이 항상 서버 계정(klaod-tech: 로컬로 돌릴 이유가 없다). F12 브랜치(`f27dd24`)를 V3로 옮기고 `setServerAuth`·CSRF 403 재시도를 붙임. 예전 화면 시험(`ServiceApp.test.tsx`)만 계정 클라이언트를 「없음」으로 바꿔 이 기기 로그인으로 돈다(시험 전용). PiP를 고친 뒤 지운다([계획 0054](0054-pip-fix-and-server-only-login.md)).
- 2026-10-22: 고개 돌림 구간은 학습 데이터에서 뺀다(klaod-tech). 서버의 `head_turn` 제외를 그대로 두고, 짧은 판정 불가를 이어 보는 처리(`EVENT_BREAK_SEC`)도 요청하지 않는다(다른 값이 섞이지 않게). 관절을 `[0, 0, 0]`으로 채운 프레임은 `valid:false`(`jointsComplete`).
- 2026-10-22: 서버 연동 전 API·WS 대조(BE `047a095`). 형식은 맞고, 관절 값 범위(x·y -1~2, visibility 0~1)를 앱이 자르지 않던 것을 고침(`frameJoints`). 결과 표는 FE 제안서 7.2.
- 2026-10-22: V3 코드 검토. S1·B1은 응답이 없어도 같은 본문으로 다시 보냄, B2가 실패하면 등록을 자동으로 시작하지 않음, S1 응답 전에 끝낸 측정은 연결하지 않음, `end` 뒤 WS가 먼저 닫히면 S4 한 번. BE 코드 확인 결과 측정 중 끊김은 서버가 닫으므로 앱은 S3를 부르지 않는다(연동 명세 4장).
- 2026-10-22: 오늘 표시 기준을 정리했다. 서버 연동 뒤에도 오늘 세션 목록·요약·달력·그래프는 로컬에 수집한 서버 결과를 사용한다. 어제까지의 일별 통계는 T1으로 제공·표시한다. 앞선 기록의 오늘 제외 설명은 이 결정으로 대체하며, 세션 결과 화면은 방금 끝난 세션만 표시한다.
- 2026-10-25: develop(PR #63, 팀장 `db220d8`)을 V3에 합침. 모델명·버전 화면 표시를 지움(팀장 10/22 결정). 오늘 표시용 로컬 기록은 키 하나로 두고 계정별로 나누지 않는다(klaod-tech: 한 PC 한 사람이 보통이고, 나누면 계정 ID를 넘기는 곳이 늘어 복잡해진다. 한계는 연동 명세 4.5 「팀 참고」).

- 2026-10-26: 웹 작은 창 삭제·숨은 탭 측정(Worker 타이머)·데스크톱 작은 창([ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md), 계획 0054·0055). 화면의 날짜·시각을 서버 시각으로(기록 시작·종료 = `ready.started_at`·`closed.ended_at`, 「오늘」 = 가장 최근 서버 시각의 KST 날짜, KST 고정, [ADR 0029](../../decisions/0029-midnight-cut-and-server-time.md)). BE 브랜치 `fix/repo-backend-sync`(김유진)에 맞춰 B1 `registration_id`. 기록·달력 로직은 FE가 고치기로 함(화면 모양은 lellon0403).

## 검증 결과와 남은 한계

2026-10-26, Windows 11 데스크톱(V3): 프론트 단위 시험 238개, `tsc`, 빌드, `check-repo`, WS 계약 시험(`tests/test_realtime_ws_v2.py`·`test_realtime_contracts.py` 16개) 통과. 데스크톱 작은 창은 개발 실행으로 짧게 확인. 실제 서버 시험은 아직(BE 브랜치 병합·터널 필요).

2026-10-25, Windows 11 데스크톱(V3, develop `3285cce` 합침): 프론트 단위 시험 231개, `tsc`, 빌드, `check-repo` 통과. 모델 버전 표시 삭제로 기록 상세 시험 2곳을 「보이지 않음」 확인으로 바꿈. 실제 서버 시험·`check-browser`·`check-backend`·`check-compose`는 돌리지 않음.

2026-10-22 저녁, Windows 11 데스크톱(V3): 남은 앱 판정·특징값 계산 삭제와 좌표 범위 자르기 뒤 프론트 단위 시험 217개(머리 판정·특징 필터 시험 삭제, 범위·채운 관절 시험 추가). F12를 옮긴 뒤 231개(옮겨 온 계정 시험 11개, `setServerAuth`·CSRF 재시도 3개), `tsc`, 빌드, `check-repo` 통과.

2026-10-22, Windows 11 데스크톱(V3 `84678a2`): 프론트 단위 시험 221개(재시도·B2 실패·측정 경계 7개 추가), `tsc`, 빌드, `check-repo` 통과. 실제 서버 시험은 아직(F12가 BE 브랜치에 없음). `check-browser`·`check-backend`·`check-compose`는 돌리지 않음.

2026-10-21, Windows 11 데스크톱(V3 `f88ffe3`): 프론트 단위 시험 213개(로컬 판정 시험 삭제, 서버 측정 11개·자세 등록 13개 추가), `tsc`, 빌드, `check-repo` 통과. 실제 서버 시험은 아직 못 함(BE 로그인 연결 필요). `check-browser`는 서버 전용이 되며 시나리오를 다시 써야 한다(0030 G6).

2026-10-13, Windows 11 노트북(Node 24, Python 3.13): 프론트 단위 시험 321개, `tsc`, 빌드, `check-repo`, Python 계약 시험 통과.
`check-browser`는 develop 병합 뒤 "첫 사건이 정확히 3초에 확정" 단계에서 실패한다(측정 흐름은 develop 변경, 원인 미확인).
`check-compose`는 계정 모드 삭제로 계정 브라우저 시나리오가 깨진다(sunshine-yj 파일, [명령과 검사](../../design/fe-commands-and-checks.md)).
