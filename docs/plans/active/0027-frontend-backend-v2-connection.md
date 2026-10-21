# 프론트를 백엔드 API v2·DB V2.3에 연결

- 상태: planned
- 담당: 미정 (feature/repo-backend-db-v2에서 정리)
- 시작일: 2026-10-14
- 관련 요구사항/ADR: [계정·기준 자세·저장 API v2](../../../contracts/accounts.v2.md), [동의 문서 v2](../../../contracts/consent-documents.v2.md),
  [ADR 0020](../../decisions/0020-single-api-decision-engine.md), [ADR 0022](../../decisions/0022-db-v23-feature-v2-integration.md),
  [계획 0025](0025-backend-db-v23-integration.md), [FE 연동 명세](../../design/api-ws-spec.md)

## 문제와 완료 기준

백엔드는 DB V2.3에 맞춘 API v2(`/v2/auth`, `/v2/baselines`, `/v2/sessions`, `/v2/workspace`, `/v2/records`)만 제공한다.
프론트(`frontend/`, `model/prototype/`)는 2026-10-14에 develop 상태로 되돌렸다. 그래서 다음처럼 서로 맞지 않는다.

- 로그인·가입은 이 기기 localStorage에만 저장하고 서버를 부르지 않는다(`app/LocalServiceApp.tsx`, `features/auth/`).
- 서버 판정은 `/api/v1/sessions`를 부르고 세션 생성 본문에 옛 V1.1 `setup`을 담는다. API는 로그인과 `{policy,baseline_id}`를 요구하므로
  「서버 판정 사용」은 401(로그인 전)이나 400/409(형식·기준 없음)로 실패한다.
- 기준 자세를 서버에 등록·조회하는 코드가 없다.

완료 기준: 합성 계정으로 가입 → 로그인 → 자세 등록(DB 저장) → 서버 판정 측정 → 종료 → 기록 조회 → 새로고침·재로그인 후 기준 복원이
실제 API·임시 MySQL에서 동작한다. `check-frontend`, `check-browser`, `check-compose`가 통과한다.

## 범위와 제외

프론트 인증·기준 자세·세션·설정/기록 어댑터와 해당 테스트, 합성 브라우저 시나리오, 관련 문서를 바꾼다.
백엔드 API·DB 스키마는 바꾸지 않는다(필요하면 계획 0025에 별도 기록). 좌표 스트림 v3·Kafka(계획 0022)는 제외한다.
되돌린 코드는 Git에 남아 있다. 계정 앱 v2 코드는 커밋 `ce57f56`의 `frontend/src/features/accounts/`,
세션 v2·좌표 평균 변경은 커밋 `3e7a0f5`의 `frontend/`·`model/prototype/`에 있다. 그대로 되살리지 말고 develop의 새 화면 구조(`features/auth/`, `LocalServiceApp`)에 맞춰 옮긴다.

## 수정해야 하는 부분

### 1. 기준 자세를 관절 좌표 평균으로 요약 (`model/prototype/`, `hooks/useCamera.ts`)

API `POST /v2/baselines`와 DB `baseline_posture`는 관절 9개(`nose`, `left_eye`, `right_eye`, `left_ear`, `right_ear`, `mouth_left`,
`mouth_right`, `left_shoulder`, `right_shoulder`)의 `{x,y}` 평균(0..1, 소수 5자리)을 저장한다. 지금 프론트는 몸 위치·크기(`placement`)만 요약한다.

- [ ] `model/prototype/pose.ts`: `placement()`를 관절 9개 좌표를 돌려주는 `anchors()`·`BASELINE_LANDMARKS`·`Anchors` 타입으로 바꾼다.
      관절이 하나라도 화면 밖(0..1 밖)이면 `null`.
- [ ] `model/prototype/calibration.ts`: `CalibrationSummary.placement`를 `landmarks: Anchors | null`로 바꾸고, 화면 안 프레임만 평균한다.
- [ ] `hooks/useCamera.ts`: `observeCalibration`에 `anchors(observation.landmarks)`를 넘긴다.
- [ ] API는 유효 좌표 표본 20개 이상, 촬영 3,000ms 이상을 요구한다. 지금 등록 기준(3초·표본 15개)과 다르므로
      계정 모드에서는 좌표 표본 20개가 모일 때까지 등록을 끝내지 않는다(`3e7a0f5`의 `useCamera.ts` 참고).
- 참고: `3e7a0f5:model/prototype/{pose,calibration}.ts`, `3e7a0f5:frontend/src/lib/engine.test.ts`.

### 2. 로그인·가입을 서버 계정에 연결 (`features/auth/`, `app/LocalServiceApp.tsx`)

- [ ] API 클라이언트: `/api/v2/auth/csrf`로 CSRF 토큰을 받아 변경 요청에 `X-CSRF-TOKEN`을 붙이고,
      로그인한 `user_id`를 `X-PoseGood-User-Id`에 붙인다. 401·403·`409 AUTH_CHANGED`·503 재시도를 처리한다.
      (`ce57f56:frontend/src/features/accounts/client.ts`의 `createAccountClient`를 옮긴다.)
- [ ] `LocalServiceApp.login()`: 입력값을 확인하지 않는 로컬 로그인을 `POST /auth/login`으로 바꾼다. 앱 시작 때 `GET /auth/me`로 로그인 상태를 복원한다.
      `403 ACCOUNT_CLOSED`면 "탈퇴한 계정입니다. 되돌릴 수 없고 탈퇴 30일 뒤 삭제됩니다"를 보여 준다(2026-10-15 v5.2: 철회 경로 없음).
- [ ] `LocalServiceApp.register()`: localStorage(`KEYS.account`, `KEYS.profile`) 저장 대신 `POST /auth/register`에
      `{email,password,profile,consents}`를 보낸다. 로그아웃은 `POST /auth/logout`.
- [ ] 비밀번호 변경 `PUT /auth/password`, 탈퇴 `DELETE /auth/account`를 설정 화면에 잇는다.
      탈퇴 확인 화면에 "되돌릴 수 없고 30일 뒤 완전히 삭제되며, 그 전에는 같은 이메일로 다시 가입할 수 없다"를 알리고 비밀번호로 확인받는다(공지 결정 ⑥·⑦).
- [ ] 로그인 계정이 바뀌거나 세션이 끊기면 카메라·전송을 멈추고 메모리 기준을 비운다.

### 3. 가입 동의·프로필 규칙을 API 계약에 맞춤 (`features/auth/consents.ts`, `password.ts`, `features/storage/`, `features/profile/`)

| 항목 | 지금 프론트(develop) | API v2 계약 |
| --- | --- | --- |
| 동의 문서 버전 | `terms-2026-10` | `service-v2` |
| 동의 전송 형식 | C1~C6 → `boolean` 선택값(로컬 저장) | `[{type,document_version}]`, 필수 5종 모두 포함, 미동의 선택 항목은 보내지 않음 |
| 이름 | 1..50자 | 1..30자 |
| 나이 | 없음 또는 정수 1..120 | `null` 또는 정수 14..120, 선택 동의(`OPTIONAL_PROFILE`) 있을 때만 |
| 직업 | 없음 또는 1..80자 | `null` 또는 공백 아닌 1..80자, 선택 동의 있을 때만 |
| 비밀번호 | 1자 이상, 72바이트 이하 | 12자 이상, UTF-8 72바이트 이하 |

- [ ] 문서 버전을 하나로 정한다. 화면 문구가 `service-v2`와 다르면 [동의 문서 계약](../../../contracts/consent-documents.v2.md)과 함께 맞춘다.
- [ ] `Profile` 타입의 선택 값 표현(`undefined`)과 API(`null`) 변환을 어댑터 한곳에서 처리한다.
- [ ] 선택 동의 철회·재동의는 `PUT /consents/optional-profile`(철회 시 나이·직업 삭제)로 보낸다.
- [ ] 비밀번호 최소 길이는 사용자(팀)와 정한다. API를 바꾸지 않으면 프론트 안내·검증을 12자로 맞춘다.

### 4. 기준 자세 등록·복원 (`hooks/useCamera.ts`, 새 훅)

- [ ] 등록이 끝나면 `POST /baselines`로 `{registered_at,calibration_ms,sample_count,landmarks}`를 보낸다. `registered_at`은 촬영 완료 시각을 고정해 재시도에도 그대로 쓴다.
- [ ] 로그인 직후 `GET /baselines/current`로 기준을 불러온다. `404 BASELINE_NOT_FOUND`면 등록 화면으로 보낸다.
- [ ] 저장 응답의 평균 좌표로 기준 특징(`Features`)을 다시 만든다. 카메라가 연결되면 실제 영상 크기로 다시 계산한다.
- [ ] 계정 모드에서는 PC(localStorage) 기준을 읽거나 쓰지 않는다. 남은 PC 기준이 계정 기준을 가리지 않게 하기 위해서다.
- [ ] 「등록 끝나면 바로 측정」은 DB 저장이 끝난 뒤에 시작한다(API가 기준 없는 세션을 `409 BASELINE_REQUIRED`로 거부).
- 참고: `ce57f56:frontend/src/features/accounts/{baseline.ts,useRemoteBaseline.ts}`, `3e7a0f5:frontend/src/hooks/useCamera.ts`의 `adoptBaseline`·`baselineStored`.

### 5. 서버 판정 세션을 v2로 (`features/session/server/`, `features/session/useSessionPersistence.ts`)

- [ ] `client.ts`: `/api/v1/sessions/…`를 `/api/v2/sessions/…`로 바꾸고 계정 클라이언트의 인증된 `fetch`를 쓴다.
- [ ] `controller.ts`: 세션 생성 본문을 `{policy, setup}`에서 `{policy, baseline_id}`로 바꾼다. `baseline_id`는 서버가 돌려준 현재 기준 ID다.
- [ ] `contracts.ts`·`validation.ts`: V1.1 `ServerSetup`(target_center·head_gap 등)을 정리한다. 새로고침 복구용으로 저장된 옛 `{policy,setup}` 요청은 계속 읽을 수 있게 둔다.
- [ ] `setup.ts`의 `serverSetup()`과 `useSessionPersistence.ts`의 setup 생성을 지운다(v2에서는 기준을 따로 등록).
- [ ] 측정 시작 전에 기준이 DB에 저장됐는지 확인하고, 아니면 안내한다.
- 참고: `3e7a0f5:frontend/src/features/session/server/`.

### 6. 설정·기록을 서버에 저장 (`features/storage/`, `features/history/`)

- [ ] 로그인 상태에서는 프로필·설정을 `GET/PUT /workspace`, 기록을 `GET/POST/DELETE /records`로 읽고 쓴다. 최종 기록을 localStorage에 복제하지 않는다.
- [ ] 「자세 알림」 스위치는 `preferences.alerts_on`(DB `sound_alert_enabled`)에 대응한다.
- [ ] 다시 읽은 기록은 사건 방향 `unspecified`, 순번 -1, 바른 자세 시간 0.1초 정밀도다. 달력·기록 화면이 이 값을 깨지지 않게 표시하는지 확인한다.
- 참고: `ce57f56:frontend/src/features/accounts/useRemoteWorkspace.ts`.

### 7. 개발 환경·검증 도구

- [ ] `frontend/vite.config.ts`: `/api` 프록시에 `ws: true`를 켜서 실시간 채널(`/v1/realtime`)도 프록시를 지나게 한다.
- [ ] 합성 카메라(`features/testing/useSyntheticCamera.ts`)에 합성 관절 좌표 9개를 넣는다(`3e7a0f5:frontend/src/features/testing/syntheticLandmarks.ts`).
- [ ] `tools/browser/scenarios.mjs`의 서버 판정 단계와 `tools/browser/accounts.mjs`·`tools/compose_smoke.py`의 계정 브라우저 시나리오를 새 로그인·가입 화면에 맞춘다(아래 8 참고).
- [ ] 계정 모드 선택 방법을 정한다. develop은 `VITE_SERVER_ACCOUNTS` 스위치를 지웠지만 `compose.yaml`, `infra/docker/frontend.Dockerfile`, `tools/frontend_proxy.py`에는 아직 남아 있다.
      스위치를 되살릴지, `features/platform/serverConfig.ts`에 새 스위치를 둘지, 서버 연결을 기본으로 할지 정한다.

### 8. 브라우저 검증(`check-browser`) — 프론트 팀 공유 사항

**무엇이 바뀌었나 (2026-10-14 정리)**

- 이 브랜치의 커밋 `fcc8ef7`·`ce57f56`은 `tools/browser_smoke.py`의 `main()`이 프론트 팀 시나리오(`tools/browser_smoke.mjs` →
  `tools/browser/scenarios.mjs`) 대신 계정 UI 시나리오(`tools/account_browser_smoke.py` → `tools/browser/accounts.mjs`)를 돌리게 바꿨었다.
  그래서 develop에서 프론트 팀이 새 로그인·달력 화면에 맞춰 고친 `scenarios.mjs`가 게이트에서 빠지고, develop이 지운 계정 화면을 조작하는 시나리오가 대신 돌았다.
- 2026-10-14 `main()`을 develop과 같이 `run_browser()`로 되돌렸다. 이제 `check-browser`는 다시 `scenarios.mjs`를 실행한다.
- 백엔드 구조 때문에 develop과 다르게 남긴 부분: API가 MySQL 없이 시작하지 않으므로(ADR 0020) `run_browser()`는
  `tools/test_mysql.py`의 임시 MySQL(로컬 MySQL 또는 Docker)을 만들어 API에 넘긴다. 시나리오 중간의 API 재시작도 같은 DB로 다시 띄우고,
  준비 확인은 옛 `/v1/sessions/{id}` 대신 `/health`로 한다(재시작 뒤 진행 중 세션은 `SESSION_LOST`).
- `scenarios.mjs`, `browser_smoke.mjs`, 프론트 코드는 바꾸지 않았다.

**지금 예상되는 결과 (실행하지 못함: 2026-10-14 이 PC에 Docker 데몬·로컬 MySQL 설정이 없음)**

- 로그인 화면 표시, 합성 입력 고지 확인까지는 통과할 것으로 본다.
- 첫 `startSession()`(측정하기 → 개발자 옵션 「서버 판정 사용」)에서 실패한다. 프론트가 `PUT /api/v1/sessions/{id}`를 로그인 없이,
  `{policy, setup}` 본문으로 보내지만 API는 로그인한 사용자의 `PUT /v2/sessions/{id}` `{policy, baseline_id}`만 받는다.
- MySQL이 없는 PC에서는 시나리오 전에 임시 DB 준비 단계에서 실패한다(`check-backend`와 같은 조건).

**프론트 팀 확인·결정 요청**

- [ ] 서버 판정 단계를 계정 로그인·기준 자세 등록(위 2·4·5)이 생긴 뒤 v2 흐름으로 고칠지, 그 전까지 `scenarios.mjs`에서 서버 판정 단계를 어떻게 다룰지 정한다.
- [ ] `scenarios.mjs`의 직접 API 호출(`/api/v1/sessions/...`, 173·235행 부근)을 v2 경로와 로그인 쿠키·CSRF·`X-PoseGood-User-Id` 헤더로 바꾼다.
- [ ] 계정 UI 시나리오(`accounts.mjs`)는 지금 `check-compose`에서만 쓴다. 새 가입 화면(`features/auth/`)의 선택자로 고치거나 `scenarios.mjs`로 합칠지 정한다.
- [ ] 이 PC처럼 Docker·MySQL이 없는 환경에서 브라우저 검증을 어떻게 돌릴지 정한다(백엔드 담당과 협의).

## 작업 단계

- [x] 프론트 코드를 develop 상태로 되돌리고 수정할 부분을 이 문서에 정리(2026-10-14)
- [ ] 계정 모드 스위치·동의 버전·비밀번호 길이를 팀과 정함
- [ ] 1 → 4 → 5 순서로 기준 자세·세션 연결, 그다음 2·3 인증·가입, 6 설정·기록
- [ ] 7 검증 도구와 문서(`frontend/README.md`, `docs/design/api-ws-spec.md`) 동기화
- [ ] `check-frontend`, `check-backend`, `check-browser`, `check-compose` 실행과 결과 기록

## 결정과 진행 기록

- 2026-10-14: develop(#42)이 프론트 계정 모드를 지웠으므로, 이 브랜치의 프론트 v2 변경을 develop 위에 덧대지 않고 모두 되돌렸다.
  백엔드·DB·계약은 V2.3·API v2를 유지한다. 프론트 연결은 이 계획으로 다시 진행한다.
- 2026-10-15: 아키텍처 v5.2로 탈퇴 철회(`POST /auth/withdrawal/cancel`)가 없어졌다. 2번의 철회 안내를 "철회 불가·30일 뒤 삭제" 안내로 바꿨다.
  통계 화면의 일별 통계는 Spark J2가 다음 날 00:00 이후 채우므로, 오늘 측정은 다음 날부터 보인다(오늘 통계를 바로 보일지는 공지 ④에서 FE·BE가 정함).

## 검증 결과와 남은 한계

- 되돌린 직후: 프론트는 develop과 같은 코드다. 백엔드와 연결되지 않으므로 서버 판정·계정 브라우저 시나리오는 실패한다.
- 2026-10-14 `tools/browser_smoke.py` 수정 뒤: `py_compile` 통과, `tests.test_browser_smoke` 1개 통과.
  `check-browser`는 Docker 데몬이 꺼져 있고 로컬 MySQL 설정이 없어 실행하지 못했다. 위 8의 결과는 코드를 읽고 예상한 것이다.
