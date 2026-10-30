# FE 자정 점검용 합성 카메라 정비

- 작성: 2026-10-30 · 담당: klaod-tech(FE) · 브랜치: `feature/fe-camera-midnight-test`
- 상태: 1·2번 구현 끝, 실제 시험 서버 실행 전
- 계기: 팀장(Jeon-Seho) 인계서 「자정 브라우저 점검의 합성 입력·서버 시각 인계」(2026-10-30, 저장소 밖 공유)
- 관련: [frontend README 자정 측정](../../frontend/README.md#시각-스타일과-자정-측정2026-10-26), [ADR 0029](../decisions/0029-midnight-cut-and-server-time.md), [품질 문서](../quality.md)

## 1. 배경

`tools/browser/midnight.mjs`(도구 담당: 팀장)는 `browser-smoke` 모드 Vite를 Chrome으로 조작해
로그인 → 자세 등록(B1) → 측정(S1·WS) → 자정 통과 → 종료 → 오늘·달력 표시를 확인한다.
카메라 입력과 측정 경과 시간만 합성이고 REST·WS·R1은 실제 시험 서버를 쓴다.

인계서가 지적한 다섯 가지 중 FE 혼자 할 수 있는 것은 1·2번이다.

| # | 문제 | 담당 | 이 문서 |
|---|---|---|---|
| 1 | 합성 정상 프레임에 관절 좌표가 없어(`landmarks: []`) 서버가 측정 불가로 셈 → `valid_ms` 0 | FE | 처리 |
| 2 | 합성 등록이 고정 UUID를 바로 넣고 B1을 부르지 않음. `progress`·`registering`이 바뀌지 않아 등록 화면이 15초 제한(`REGISTRATION_LIMIT_MS`)에서 실패 | FE | 처리 |
| 3 | 자정 기준은 서버 시각(`ready.started_at`). 브라우저 시계로 대신할 수 없음 | BE·시험 | 아래 4장 |
| 4 | 같은 세션 유지 검사는 `POSEGOOD_MIDNIGHT_ROLLOVER=false` 전제 | BE | 10/30: 앱이 `session_rollover`를 처리함. 켜면 시나리오가 바뀜 — 5번과 함께 |
| 5 | R1 기록에 날짜별 `days`가 없어 서버 확정 뒤 자정 넘긴 기록이 시작한 날로 몰림 | FE·BE·dev | 10/30 방향: 서버 자정 넘김(B안)을 켜 한 기록 = 하루로 만들고 앱 날짜 나누기(ADR 0027)를 지움. 팀 공유 계획(저장소 밖) |

`browser-smoke`는 개발 serve 전용이다. 일반 개발·preview·빌드·실제 카메라 동작은 바뀌지 않는다.

## 2. 정한 것

- **좌표:** 고정한 바른 자세 9개 관절(`FRAME_JOINTS`)을 `syntheticPose.ts`에 둔다. 서버 `FrameFeatures` 조건을 통과하는 값이다.
  코·어깨 visibility 0.95, 좌표 0.02~0.98 안, 어깨 폭 30%, 양 귀 대칭(고개 돌림 0), 어깨 y 0.6(`FRAMING_BOTTOM` 0.88 위).
  실제 참여자 좌표가 아니며 앱이 판정하지 않는다.
- **등록:** 별도 알고리즘을 만들지 않고 실제 `useCamera`와 같은 `useServerBaseline`을 쓴다.
  3초 평균(`observeCapture`)·B1 저장·진행률·저장 중·실패·기존 등록 불러오기(B2)가 실제와 같고, 서버가 돌려준 기준 ID를 쓴다.
- **어깨 상태:** `shoulders`·`framing`을 실제 `useCamera`와 같은 계산으로 채운다(등록 화면이 읽음).
- **합성 프레임 종류(10/30 추가):** 모든 종류를 실제 카메라와 같은 길(`readShoulders` → `LiveSession` → `FrameBatcher`)로 보내 현재 WS 형식과 같게 한다.
  예전 `'deviation'`·`'poor'`는 좌표 없이(`landmarks: []`) 보내 서버에 「사람 없음」(`p: null`)으로만 갔다.
  `'deviation'` = 바른 자세에서 얼굴 7점을 0.12 아래로(고개 돌림 0, 서버 프레임 조건 통과, 판정은 서버), `'poor'` = 양 어깨가 화면 아래 → `{ p: null, valid: false }`, `'absent'` = 사람 없음 → `{ p: null }`.
- **범위 밖:** 예측·`/dev`는 `baselineMode: 'local'`이라 서버 등록을 하지 않는다.

## 3. 작업 단계

- [x] 인계서 1~5번을 develop `d711694` 소스와 대조
- [x] 1번: `frame(ms, 'normal')`에 좌표 싣기 — `bootstrap.ts`, `syntheticPose.ts`
- [x] 2번: 합성 카메라를 `useServerBaseline`에 연결 — `useSyntheticCamera.ts`
- [x] 단위 테스트 3개 — `useSyntheticCamera.test.tsx`
- [x] 합성 프레임 종류 모두 현재 WS 형식으로(10/30, `fix/fe-synthetic-frame-kinds`) — 종류별 `features` 메시지 시험
- [x] `frontend/README.md` 자정 측정 절에 바뀐 동작 기록
- [ ] 시험 서버(시험 DB·`@example.invalid` 계정) 준비 — 팀장·BE와 협의
- [ ] `browser-smoke` + 시험 서버로 등록 → `ready`까지 수동 확인
- [ ] `midnight.mjs` 실제 자정 실행(아래 4장) 후 결과 기록
- [x] PR 및 develop 병합(#87)

## 4. 자정 실행 방법(3번) 제안

서버 시간대는 이미 KST(`KstTime.ZONE`)라 날짜 경계는 문제없다. 남은 것은 `ready.started_at`을 자정 전 10초 안에 오게 하는 방법이다.

- **A. 실제 자정에 실행(제안):** 서버 변경 없음. 다만 도구 시작부터 `ready`까지(Chrome·로그인·등록 약 5초) 시간이 일정하지 않으므로,
  도구에 「로그인·카메라 연결까지 끝낸 뒤 23:59:50까지 기다렸다가 등록 프레임을 보내는」 단계를 넣어 달라고 도구 담당에게 요청한다.
  예약 실행(작업 스케줄러)은 23:58쯤 건다.
- **B. 시험 서버 시계 조작:** 언제든 실행할 수 있으나 BE 작업이 필요하다.

## 5. 검증 결과

- 2026-10-30, develop `d711694` 기준: `npm run typecheck` 통과, `features/testing` ESLint 0, Vitest 119개 파일·918개 통과.
- 등록 시간: 3초에 표본 20개(`CAPTURE_MIN_SAMPLES`)가 필요해 도구의 250ms 간격이면 약 5초 걸린다(15초 제한 안).
- 실제 API·DB·Chrome 실행, 실제 자정 실행은 하지 않았다.

## 6. 남은 것

- 5번(서버 확정 뒤 날짜별 표시): R1에 날짜별 합계 추가 / 로컬 `days` 보조 유지 / rollover 켜기 중 하나를 BE·dev와 정한다.
- 시험 서버 준비와 4장 A안의 도구 대기 단계는 팀장 회신 뒤 진행한다.

## 7. 진행 기록

- 2026-10-30: 인계서 대조, 1·2번 구현과 단위 테스트, 이 문서 작성.
- 2026-10-30: 5번 방향을 서버 자정 넘김(B안)으로. 앱 `session_rollover` 처리, ADR 0029·연동 명세·제안서를 BE 구현에 맞춤(`feature/fe-midnight-session-rollover`).
- 2026-10-30: #87 병합. 합성 `'deviation'`·`'poor'`가 옛 방식(좌표 없음)이라 모든 종류를 실제 카메라와 같은 길로 보내게 고침, `'absent'` 추가.
