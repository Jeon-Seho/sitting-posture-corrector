# ADR 0031: 로그인은 access 토큰(JWT)과 refresh 토큰으로 한다

- 상태: accepted (브랜치 `feature/repo-auth-refresh-token`에 구현, develop 미병합)
- 날짜: 2026-10-27 (번호: FE가 0028·0029를 써서 BE는 0030 이후. 0030은 BE ADR 0028의 새 번호로 남겨 둠)
- 근거: 2026-10-27 사용자(DB·BE) 결정 — 로그인 방식 C안(JWT access + refresh), access 30분, refresh 14일, 쿠키 세션은 한 번에 교체, access 토큰은 철회하지 않음, `SPRING_SESSION` 테이블은 남김, `X-PoseGood-User-Id` 검사는 유지
- 대체: API 명세 1장의 「DB(`SPRING_SESSION`)에 저장하는 로그인 쿠키, 로그인 성공 시점부터 30분 고정 만료」(2026-10-22 팀장 문서 정리, 10/26 `LoginLifetime` 구현), BE-5 ①

## 배경

로그인은 Spring Session JDBC 쿠키 세션이었고, 10/26부터 로그인한 때부터 30분이 지나면 활동과 상관없이 만료됐다.
쓰는 중에도 30분마다 다시 로그인해야 했고, 긴 측정 뒤 첫 요청이 401이 됐다.
자정에 측정을 끊고 새 세션으로 잇는 안(BE-6 ①)은 새 S1이 401이 되는 문제도 있었다.
요청마다 DB의 `SPRING_SESSION`을 읽는 구조라 나중에 서비스를 나누기도 어려웠다.

## 결정

1. **access 토큰:** JWT(HS256), 수명 30분, `sub` = 사용자 ID. 가입·로그인·갱신 응답 본문으로 주고, 앱은 `Authorization: Bearer`로 보낸다. 서버에 저장하지 않는다.
2. **refresh 토큰:** 무작위 32바이트, 수명 14일. HttpOnly 쿠키 `posegood_refresh`(SameSite=Lax, Path `/`)로만 준다. DB `refresh_token`(V2.6, migration 016)에는 SHA-256만 둔다.
3. **갱신:** `POST /v2/auth/refresh`. 쓸 때마다 새 refresh 토큰으로 바꾼다. 바꾼 뒤 30초 안의 재사용(여러 탭이 동시에 갱신)은 허용하고, 그 뒤 재사용은 탈취로 보고 그 사용자의 refresh 토큰을 모두 철회한다.
4. **철회:** 로그아웃은 그 기기의 refresh 토큰, 비밀번호 변경·탈퇴는 그 사용자의 refresh 토큰 전부. **access 토큰은 철회하지 않는다** — 남은 시간(최대 30분)은 통한다. 탈퇴한 계정은 요청마다 계정 상태를 확인하므로(`CurrentUser`) 바로 401이다.
5. **실시간 연결:** `hello`의 `access_token`으로 연결 때 한 번만 확인한다. 측정 중에는 다시 확인하지 않는다. 비밀번호 변경·탈퇴 때는 지금처럼 그 사용자의 연결을 바로 닫는다.
6. **정리:** 쿠키 세션·CSRF·`LoginLifetime`·`GET /v2/auth/csrf`를 없앤다(이행 기간 없음). `SPRING_SESSION`·`SPRING_SESSION_ATTRIBUTES` 테이블은 쓰지 않지만 남긴다. `X-PoseGood-User-Id` 검사(다른 탭의 계정 바뀜)는 유지한다.
7. **설정:** `POSEGOOD_JWT_SECRET`(32바이트 이상, 배포 필수 — 비면 실행마다 무작위 키), `POSEGOOD_ACCESS_TOKEN_LIFETIME`, `POSEGOOD_REFRESH_TOKEN_LIFETIME`, `POSEGOOD_COOKIE_SECURE`, `POSEGOOD_REFRESH_COOKIE_PATH`.

## 이유

- 쓰는 동안 로그인이 이어지고(14일), 앱은 만료 전에 미리 갱신하면 401을 맞지 않는다.
- 측정 연결은 한 번만 인증하므로 갱신이 측정을 늦추지 않는다. 자정 끊기(A·B안 어느 쪽이든)에서도 재로그인이 필요 없다.
- refresh 토큰을 HttpOnly 쿠키에 두면 스크립트가 읽을 수 없고, 짧은 access 토큰만 앱 메모리에 있다.
- access 토큰 철회를 두지 않아 DB 컬럼을 늘리지 않는다. 남는 위험은 최대 30분이고, 실시간 연결과 탈퇴 계정은 따로 막힌다.

## 결과

- **호환성 깨짐:** 앱은 쿠키·CSRF 대신 토큰을 다뤄야 한다(요청 공통 처리, 미리 갱신, 갱신 하나로 묶기, 탭 공유, `hello`의 `access_token`). 계약 `realtime-ws.v2`의 `hello`에 `access_token`이 필수가 됐다.
- DB V2.6이 필요하다(`refresh_token`). V2.5 DB는 migration 016을 적용한다. Compose 초기화 스크립트(`infra/mysql/initdb`)와 DevOps 점검 도구(`tools/platform/*`)는 담당이 맞춘다.
- 검증: 단위 시험(`AuthTokensTest`, `RealtimeHandlerV2Test`)과 통합 시험 수정. 실제 MySQL 통합 시험은 아직 돌리지 않았다.
- 남은 일: 만료된 refresh 행은 API가 매일 04:30(KST)에 지운다. 다중 인스턴스에서는 서명 키를 같이 써야 한다.
