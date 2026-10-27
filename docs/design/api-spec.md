# PoseGood API 명세서

> 자세교정 서비스 · 백엔드 API

Spring Boot API가 제공하는 REST 22개와 WebSocket 1개(`/v2/realtime`)의 요청·응답·오류를 정리했다. 코드 기준은 `feature/repo-auth-refresh-token` 브랜치(2026-10-27, DB 스키마 V2.6)다.

| 항목 | 내용 |
|---|---|
| 서버 | Java 17 · Spring Boot 4.0.8 · Gradle · Jackson 3 |
| 추론 | FastAPI `POST /v2/infer` |
| DB | MySQL 8.4 · 스키마 V2.6 |
| 코드 기준 | `feature/repo-auth-refresh-token` (2026-10-27, develop 미병합) |
| 개정 | 2026-10-28 (처음 2026-10-13) — [변경 이력](#변경-이력) |

> [!NOTE]
> 이 문서는 **지금 코드**를 그대로 적은 것이고, 코드와 다른 계약이 생기면 이 문서와 코드를 함께 고친다.
> **세션 생성(S1)·종료(S3) 응답은 이 문서가 기준이다(10/15 결정)** — 둘 다 200 `SessionView`이고, 「FE ↔ BE API 명세 (입출구 서버)」의 201 새 응답 형식은 쓰지 않는다.
> 실시간은 `/v2/realtime`(좌표 프레임, [11장](#11-websocket-v2realtime))만 쓴다. `/v1/realtime`은 2026-10-26 삭제했다([10장](#10-websocket-v1realtime)). 구간 입력(S2)·기록 저장(R2)은 아직 남아 있다(앱 v2 전환 뒤 삭제, BE-1).
> 일별 통계 조회 [T1](#t1)(`GET /v2/stats/daily`)은 형식만 확정했고 기록 하나 조회 R1b(`GET /v2/records/{id}`)와 함께 아직 구현 전이다(FE 요청 BE-2·BE-5 ③).

## 목차

1. [공통 규칙](#1-공통-규칙)
2. [오류 코드](#2-오류-코드)
3. [엔드포인트 목록](#3-엔드포인트-목록)
4. [계정](#4-계정)
5. [동의·설정](#5-동의설정)
6. [기준 자세](#6-기준-자세)
7. [측정 세션](#7-측정-세션)
8. [기록·시스템](#8-기록시스템)
9. [공통 응답 객체](#9-공통-응답-객체)
10. [WebSocket `/v1/realtime`](#10-websocket-v1realtime) (삭제)
11. [WebSocket `/v2/realtime`](#11-websocket-v2realtime)
- [변경 이력](#변경-이력)

## 1. 공통 규칙

앱은 모든 경로 앞에 `/api`를 붙여 호출한다(예: `/api/v2/auth/login`). Nginx와 Vite 개발 서버가 접두사를 떼고 API로 넘긴다.

| 항목 | 규칙 |
|---|---|
| 인증 | **access 토큰(JWT HS256, 30분)**을 `Authorization: Bearer <token>`으로 보낸다. 가입·로그인 응답 본문으로 받는다. 서버는 로그인 상태를 저장하지 않는다(세션·CSRF 없음, ADR 0031). 만료 뒤 인증이 필요한 요청은 `401 UNAUTHENTICATED`. |
| 로그인 유지 | **refresh 토큰(14일)**은 HttpOnly 쿠키 `posegood_refresh`(SameSite=Lax, Path `/`, HTTPS 배포에서 `POSEGOOD_COOKIE_SECURE=true`로 Secure)로만 준다. 앱은 access 토큰 만료 전(`expires_in` 기준 1~2분 전)에 [A8](#a8) `POST /v2/auth/refresh`로 새 토큰을 받는다. refresh 토큰은 쓸 때마다 바뀐다. |
| 계정 확인 헤더 | 로그인이 필요한 경로 대부분(아래 "계정 헤더" 표시)에 `X-PoseGood-User-Id: <user_id>`를 붙인다. 로그인 계정과 다르면 `409 AUTH_CHANGED`. 다른 탭에서 계정이 바뀐 화면의 쓰기를 막는 용도이며 인증 수단이 아니다. |
| 본문 형식 | JSON, 필드는 snake_case. 알 수 없는 필드, 중복 키, 문자열→숫자 같은 타입 강제 변환, 문자열 자리의 객체·배열은 모두 `400 INVALID_CONTRACT`. 단 `/v2/workspace`의 `rules`와 `/v2/records` 본문은 앱 형식(camelCase)을 그대로 쓴다. |
| 예시와 고정값 | 엔드포인트마다 있는 JSON 블록의 값은 **예시**다. 값의 규칙은 "요청 필드" 표에 있고, 표에 **고정**이 붙은 값(`schema_version`, `feature_version`, `document_version`)은 적힌 그대로 보낸다. |
| 시각 | 응답은 UTC ISO-8601(`2026-10-13T08:00:00.123Z`). DB는 KST `DATETIME(3)`. 세션 안의 시각(`*_ms`)은 세션 시작부터의 경과 밀리초. |
| 멱등성 | 세션 생성(같은 정책·기준), 특징 입력(같은 sequence·같은 본문), 종료(같은 `end_ms`), 기준 등록(같은 `registration_id`·좌표)은 다시 보내도 같은 결과를 돌려준다. 본문이 다르면 409. 재전송은 최근 120개 구간까지 알아보고, 더 오래된 순번은 역순으로 보아 409다. |
| 재시도 | 502·503은 같은 요청을 그대로 다시 보낸다. 판정 상태는 이미 반영돼 있어 남은 DB 쓰기만 이어서 한다. |
| 배치 (API 밖) | API는 탈퇴를 **접수만** 하고 `daily_stat`에는 **쓰지 않는다**. 탈퇴 최종 삭제는 Spark **J3**(cron 매일 04:00, 30일 유예 뒤), 일별 통계는 Spark **J2**(cron 매일 00:00, 전날 KST 하루치)가 한다(아키텍처 v5.2). 오늘 세션은 다음 날 일별 집계에 들어간다. 서버 연동 뒤에도 T1은 어제까지 제공·표시하고, 오늘 목록·요약·달력·그래프는 앱이 로컬에 수집한 서버 결과를 사용한다(10/22 결정, [FE 연동 명세 4.5](api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위)). |
| 오류 본문 | `{"error": "...", "code": "...", "message": "..."}`. 입력값·SQL·토큰은 응답에 넣지 않는다. |
| 다른 출처 화면 (CORS) | 화면과 API가 다른 주소(Vercel `https://app.<도메인>` → `https://api.<도메인>`)일 때는 `POSEGOOD_CORS_ALLOWED_ORIGINS`(쉼표 구분, 실제 주소만, `*` 불가)에 적힌 출처만 허용한다. 확인 요청(OPTIONS)은 로그인 없이 답한다. 허용: 메서드 GET·POST·PUT·DELETE, 헤더 `Authorization`·`Content-Type`·`X-PoseGood-User-Id`, 쿠키(refresh) 포함. 다른 출처는 403. 비우면 CORS 없음(같은 출처 화면만 — Nginx·Vite). 실시간 연결의 출처는 별도 설정(11장) |

로그인 방식은 2026-10-27 쿠키 세션 + 로그인 고정 30분에서 access·refresh 토큰으로 바꿨다([ADR 0031](../decisions/0031-jwt-access-refresh-login.md)).
- access 토큰은 철회하지 않는다. 로그아웃·비밀번호 변경·탈퇴 뒤에도 남은 시간(최대 30분)은 통하고, refresh 토큰은 바로 막힌다. 열린 실시간 연결은 비밀번호 변경·탈퇴 때 바로 `closed(unauthorized)`로 닫힌다.
- 바꾼 refresh 토큰을 30초(유예) 안에 다시 쓰면(여러 탭이 동시에 갱신) 한 번 더 새 토큰을 준다. 그 뒤에 다시 쓰면 탈취로 보고 그 사용자의 refresh 토큰을 모두 철회한다.
- 실시간 연결은 `hello`의 `access_token`으로 한 번만 확인한다. 측정 중에 토큰이 만료돼도 연결은 끝까지 간다(11장).
- 설정: `POSEGOOD_JWT_SECRET`(서명 키, 32바이트 이상, 배포에서 필수), `POSEGOOD_ACCESS_TOKEN_LIFETIME`(30m), `POSEGOOD_REFRESH_TOKEN_LIFETIME`(14d).

`model_version`·`feature_version` 등 모델명·버전명은 개발·연동용 내부 정보이며 서비스 화면에는 표시하지 않는다(2026-10-22 결정). 이 명세의 요청·응답 필드와 고정값 검증은 유지하며, 같은 이름이 계산 조건의 동일성까지 보장하지는 않는다([내부 관리 기준](../../contracts/README.md#모델명특징-버전의-내부-관리)).

## 2. 오류 코드

HTTP 상태만으로 구분이 안 되는 경우가 많아서 앱은 `code` 값으로 분기한다.

| HTTP | code | 의미 | 앱 처리 |
|---|---|---|---|
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 | 입력 수정 후 다시 요청 |
| 400 | `INVALID_PASSWORD` | 비밀번호 규칙(12자 이상, UTF-8 72바이트 이하) 위반 또는 현재 비밀번호 불일치 | 입력 안내 |
| 400 | `CONSENT_REQUIRED` | 필수 동의 누락·중복·다른 문서 버전, 선택 동의 없이 나이·직업 입력 | 동의 화면으로 |
| 401 | `UNAUTHENTICATED` | 로그인 없음 또는 만료 | 로그인 화면으로 |
| 401 | `INVALID_CREDENTIALS` | 이메일·비밀번호 불일치 | 입력 안내 |
| 403 | `ACCESS_DENIED` | 접근 거부 | — |
| 403 | `ACCOUNT_CLOSED` | 탈퇴 접수한 계정으로 로그인 (철회 불가, 30일 뒤 삭제) | "탈퇴 처리 중, 30일 뒤 삭제" 안내 |
| 404 | `SESSION_NOT_FOUND` | 세션이 없거나 다른 사용자의 것 | 측정 종료 |
| 404 | `SESSION_LOST` | DB 행은 있지만 API 재시작으로 판정 상태가 사라짐 | 마지막 확인 요약으로 기록 저장 |
| 404 | `BASELINE_NOT_FOUND` | 등록된 기준 자세 없음 | 기준 등록 화면으로 |
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) | 설정 다시 불러오기. S6·R3에서는 "이 기록은 지울 수 없어요" |
| 409 | `AUTH_CHANGED` | X-PoseGood-User-Id가 로그인 계정과 다름 | 계정 정보 다시 불러오기 |
| 409 | `ACCOUNT_EXISTS` | 이미 쓰는 이메일(탈퇴 접수 뒤 최종 삭제 전 계정 포함) | 입력 안내 |
| 409 | `SESSION_ENDED` | 끝난 세션에 입력 | 측정 종료 |
| 409 | `BASELINE_REQUIRED` | 기준 자세 없이 세션 생성 | 기준 등록 화면으로 |
| 429 | `LIMIT_REACHED` | 세션 최대 측정 시간(기본 24시간 = 계약의 시각 상한) 초과, 진행 중 세션 512개 초과 | 새 세션으로 |
| 502 | `INFERENCE_FAILED` | 추론 서비스 실패·응답 계약 불일치 | 같은 요청 재시도 |
| 503 | `STORAGE_UNAVAILABLE` | DB 일시 장애 | 같은 요청 재시도 |
| 503 | `ACCOUNT_BUSY` | 같은 계정 작업이 진행 중(2초 대기 초과) | 같은 요청 재시도 |
| 503 | `SESSION_BUSY` | 같은 세션 요청이 진행 중(10초 대기 초과) | 같은 요청 재시도 |

## 3. 엔드포인트 목록

| No | Method | 경로 | 로그인 | 설명 | 성공 |
|---|---|---|---|---|---|
| [A2](#a2) | POST | `/v2/auth/register` | - | 회원가입 | 200 |
| [A3](#a3) | POST | `/v2/auth/login` | - | 로그인 | 200 |
| [A4](#a4) | GET | `/v2/auth/me` | 필요 | 내 정보 | 200 |
| [A5](#a5) | POST | `/v2/auth/logout` | 쿠키 | 로그아웃 | 204 |
| [A6](#a6) | PUT | `/v2/auth/password` | 필요 | 비밀번호 변경 | 204 |
| [A7](#a7) | DELETE | `/v2/auth/account` | 필요 | 탈퇴 접수 | 204 |
| [A8](#a8) | POST | `/v2/auth/refresh` | 쿠키 | 로그인 유지(새 access·refresh 토큰) | 200 |
| [C1](#c1) | PUT | `/v2/consents/optional-profile` | 필요 | 선택 정보 동의·철회 | 200 |
| [W1](#w1) | GET | `/v2/workspace` | 필요 | 설정 + 기록 조회 | 200 |
| [W2](#w2) | PUT | `/v2/workspace` | 필요 | 설정 저장 | 200 |
| [B1](#b1) | POST | `/v2/baselines` | 필요 | 기준 자세 등록 | 200 |
| [B2](#b2) | GET | `/v2/baselines/current` | 필요 | 현재 기준 자세 | 200 |
| [S1](#s1) | PUT | `/v2/sessions/{id}` | 필요 | 세션 생성 | 200 |
| [S2](#s2) | POST | `/v2/sessions/{id}/features` | 필요 | 특징 입력 → 추론 → 판정 | 200 |
| [S3](#s3) | POST | `/v2/sessions/{id}/end` | 필요 | 세션 종료 | 200 |
| [S4](#s4) | GET | `/v2/sessions/{id}` | 필요 | 세션 상태 조회 | 200 |
| [S5](#s5) | GET | `/v2/sessions/{id}/metadata` | 필요 | 세션 메타데이터 | 200 |
| [S6](#s6) | DELETE | `/v2/sessions/{id}` | 필요 | 세션 삭제 | 204 |
| [R1](#r1) | GET | `/v2/records` | 필요 | 기록 목록 | 200 |
| [R2](#r2) | POST | `/v2/records` | 필요 | 기록 저장 | 200 |
| [R3](#r3) | DELETE | `/v2/records/{id}` | 필요 | 기록 삭제 | 204 |
| [H1](#h1) | GET | `/health` | - | 상태 확인 | 200 |
| [WS2](#websocket-v2-연결) | WS | `/v2/realtime` | hello 토큰 | 좌표 프레임 측정, 판정 push | 101 |

## 4. 계정

가입·로그인·로그인 유지·로그아웃·비밀번호·탈퇴 접수. 탈퇴는 철회할 수 없다. 비밀번호는 BCrypt(강도 12)로 저장한다. 토큰 규칙은 [1장](#1-공통-규칙)과 [ADR 0031](../decisions/0031-jwt-access-refresh-login.md).

<a id="a1"></a>

### A1 · ~~`GET /v2/auth/csrf`~~ — 삭제 (2026-10-27)

토큰 로그인으로 바꿔 CSRF 토큰이 필요 없어졌다(ADR 0031). 로그인 유지는 [A8](#a8).

<a id="a2"></a>

### A2 · `POST /v2/auth/register` — 회원가입

공개

- 계정 행과 동의 행을 한 트랜잭션으로 저장하고 기본 판정 정책(3초/3초/60초/0.7)을 연결한다.
- 성공하면 바로 로그인 상태가 된다: 본문에 access 토큰, `Set-Cookie`로 refresh 토큰(로그인 A3와 같음).
- 이메일은 앞뒤 공백을 지우고 소문자로 바꿔 저장한다.

**요청 필드**

| 필드 | 타입 | 필수 | 규칙 |
|---|---|---|---|
| `email` | `string` | 필수 | 이메일 형식, 254자 이하 |
| `password` | `string` | 필수 | 12자 이상, UTF-8 72바이트 이하 |
| `profile.name` | `string` | 필수 | 1~30자 |
| `profile.age` | `int \| null` | 선택 | 14~120. OPTIONAL_PROFILE 동의가 있을 때만 |
| `profile.occupation` | `string \| null` | 선택 | 1~80자. OPTIONAL_PROFILE 동의가 있을 때만 |
| `consents[].type` | `enum` | 필수 | TERMS, ACCOUNT_INFO, POSE_COORDINATES, MEASUREMENT_RECORD, AGE_14_OVER 모두 + 선택 OPTIONAL_PROFILE |
| `consents[].document_version` | `string` | 필수 | **고정** `service-v2` |

**요청 본문 (예시)**

```json
{
  "email": "user@example.com",
  "password": "correct-horse-battery",
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "consents": [
    {
      "type": "TERMS",
      "document_version": "service-v2"
    },
    {
      "type": "ACCOUNT_INFO",
      "document_version": "service-v2"
    },
    {
      "type": "POSE_COORDINATES",
      "document_version": "service-v2"
    },
    {
      "type": "MEASUREMENT_RECORD",
      "document_version": "service-v2"
    },
    {
      "type": "AGE_14_OVER",
      "document_version": "service-v2"
    }
  ]
}
```

**응답 200 (예시)** + `Set-Cookie: posegood_refresh=…; HttpOnly; SameSite=Lax; Path=/`

```json
{
  "user_id": "42",
  "email": "user@example.com",
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "today": "2026-10-13",
  "access_token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiIsImlhdCI6MTc2MDM0MjQwMCwiZXhwIjoxNzYwMzQ0MjAwfQ.c2lnbmF0dXJl",
  "token_type": "Bearer",
  "expires_in": 1800
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 |
| 400 | `INVALID_PASSWORD` | 비밀번호 규칙(12자 이상, UTF-8 72바이트 이하) 위반 또는 현재 비밀번호 불일치 |
| 400 | `CONSENT_REQUIRED` | 필수 동의 누락·중복·다른 문서 버전, 선택 동의 없이 나이·직업 입력 |
| 409 | `ACCOUNT_EXISTS` | 이미 쓰는 이메일(탈퇴 접수 뒤 최종 삭제 전 계정 포함) |

<a id="a3"></a>

### A3 · `POST /v2/auth/login` — 로그인

공개

- 성공하면 access 토큰(본문)과 새 refresh 토큰(`Set-Cookie`)을 발급한다. `expires_in`은 access 토큰의 남은 초다.
- 없는 이메일도 더미 해시와 비교해서 응답 시간으로 계정 유무를 알 수 없게 한다.
- 탈퇴 접수한(CLOSED) 계정은 로그인할 수 없다. 비밀번호가 맞으면 403 ACCOUNT_CLOSED로 따로 알려 앱이 "탈퇴 처리 중, 30일 뒤 삭제"를 안내하게 한다.

**요청 본문 (예시)**

```json
{
  "email": "user@example.com",
  "password": "correct-horse-battery"
}
```

**응답 200 (예시)** + `Set-Cookie: posegood_refresh=…`

```json
{
  "user_id": "42",
  "email": "user@example.com",
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "today": "2026-10-13",
  "access_token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiIsImlhdCI6MTc2MDM0MjQwMCwiZXhwIjoxNzYwMzQ0MjAwfQ.c2lnbmF0dXJl",
  "token_type": "Bearer",
  "expires_in": 1800
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | 이메일·비밀번호 불일치 |
| 403 | `ACCOUNT_CLOSED` | 탈퇴 접수한 계정으로 로그인 (철회 불가, 30일 뒤 삭제) |
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 |

<a id="a4"></a>

### A4 · `GET /v2/auth/me` — 내 정보

로그인 필요

- 앱 시작 시 로그인 상태와 user_id를 확인할 때 쓴다. 받은 user_id를 이후 X-PoseGood-User-Id에 넣는다.
- `today`는 서버 기준 오늘 날짜(KST `YYYY-MM-DD`)다. 앱은 「오늘」을 이 값으로 정한다(BE-6, FE ADR 0029). 가입(A2)·로그인(A3) 응답에도 같은 필드가 있다.

**요청 본문**: 없음

**응답 200 (예시)**

```json
{
  "user_id": "42",
  "email": "user@example.com",
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "today": "2026-10-13"
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 로그인 없음 또는 만료 |

<a id="a5"></a>

### A5 · `POST /v2/auth/logout` — 로그아웃

공개 · refresh 쿠키

- 이 기기의 refresh 토큰을 철회하고 쿠키를 지운다(`Max-Age=0`). 다른 기기의 로그인은 유지된다.
- access 토큰은 철회하지 않는다. 앱이 버린다(만료까지 최대 30분 남음). 쿠키가 없거나 모르는 토큰이어도 204.

**요청 본문**: 없음

**응답 204**: 본문 없음 + `Set-Cookie: posegood_refresh=; Max-Age=0`

<a id="a6"></a>

### A6 · `PUT /v2/auth/password` — 비밀번호 변경

로그인 필요 · 계정 헤더

- 그 계정의 refresh 토큰을 모두 철회해 모든 기기에서 로그인 유지를 끊는다. 이 기기의 쿠키도 지운다.
- 열린 WebSocket은 closed: unauthorized로 닫는다. 이미 발급된 access 토큰은 만료(최대 30분)까지 남는다. 새 비밀번호로 다시 로그인해야 한다.

**요청 필드**

| 필드 | 타입 | 필수 | 규칙 |
|---|---|---|---|
| `current_password` | `string` | 필수 | 현재 비밀번호 |
| `new_password` | `string` | 필수 | 12자 이상, UTF-8 72바이트 이하 |

**요청 본문 (예시)**

```json
{
  "current_password": "correct-horse-battery",
  "new_password": "new-long-passphrase"
}
```

**응답 204**: 본문 없음

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 400 | `INVALID_PASSWORD` | 비밀번호 규칙(12자 이상, UTF-8 72바이트 이하) 위반 또는 현재 비밀번호 불일치 |
| 401 | `UNAUTHENTICATED` | 로그인 없음 또는 만료 |
| 503 | `ACCOUNT_BUSY` | 같은 계정 작업이 진행 중(2초 대기 초과) |
| 409 | `AUTH_CHANGED` | X-PoseGood-User-Id가 로그인 계정과 다름 |

<a id="a7"></a>

### A7 · `DELETE /v2/auth/account` — 탈퇴 접수

로그인 필요 · 계정 헤더

- deletion_request(REQUESTED)를 추가하고 계정을 CLOSED로 바꾼다. refresh 토큰을 모두 철회하고 진행 중 세션을 메모리에서 뺀다. CLOSED 계정은 남은 access 토큰으로도 401이다.
- 되돌릴 수 없다(철회 없음). 유예 30일 동안 계정·기록은 그대로 두고, 유예가 끝나면 Spark J3(cron 매일 04:00)가 HDFS 사용자 폴더와 DB 행을 지운다. API는 삭제하지 않는다.
- 최종 삭제 전까지 같은 이메일로 다시 가입할 수 없다(ACCOUNT_EXISTS).

**요청 본문 (예시)**

```json
{
  "password": "correct-horse-battery"
}
```

**응답 204**: 본문 없음

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 400 | `INVALID_PASSWORD` | 비밀번호 규칙(12자 이상, UTF-8 72바이트 이하) 위반 또는 현재 비밀번호 불일치 |
| 401 | `UNAUTHENTICATED` | 로그인 없음 또는 만료 |
| 503 | `ACCOUNT_BUSY` | 같은 계정 작업이 진행 중(2초 대기 초과) |
| 409 | `AUTH_CHANGED` | X-PoseGood-User-Id가 로그인 계정과 다름 |

<a id="a8"></a>

### A8 · `POST /v2/auth/refresh` — 로그인 유지

공개 · refresh 쿠키 (2026-10-27, ADR 0031)

- 쿠키 `posegood_refresh`로 새 access 토큰과 새 refresh 토큰을 받는다. 옛 refresh 토큰은 바뀐 것으로 표시된다.
- 앱은 access 토큰 만료 전(`expires_in` 기준 1~2분 전)에 부른다. 동시에 나가는 요청은 갱신 한 번을 같이 기다리게 한다(FE 공통 처리).
- 바꾼 토큰을 30초 안에 다시 쓰면 한 번 더 새 토큰을 준다(여러 탭). 그 뒤 재사용은 탈취로 보고 그 사용자의 refresh 토큰을 모두 철회한 뒤 401.
- 실패(401)하면 쿠키를 지운다. 앱은 로그인 화면으로 보낸다. 네트워크 오류·5xx는 로그아웃하지 말고 다시 시도한다.

**요청 본문**: 없음

**응답 200 (예시)** + `Set-Cookie: posegood_refresh=…` (새 토큰)

```json
{
  "user_id": "42",
  "access_token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiIsImlhdCI6MTc2MDM0NDEwMCwiZXhwIjoxNzYwMzQ1OTAwfQ.c2lnbmF0dXJl",
  "token_type": "Bearer",
  "expires_in": 1800,
  "today": "2026-10-13"
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 쿠키 없음, 모르는 토큰, 만료(14일), 철회(로그아웃·비밀번호 변경·탈퇴), 유예 뒤 재사용, 탈퇴한 계정 |

## 5. 동의·설정

판정 기준과 자세 알림은 user_account가 가리키는 threshold_policy 행과 sound_alert_enabled에 저장된다. 정책 행은 고치지 않고, 같은 값의 행을 찾거나 새로 추가한다.

<a id="c1"></a>

### C1 · `PUT /v2/consents/optional-profile` — 선택 정보 동의·철회

로그인 필요 · 계정 헤더

- 철회하면 기존 동의 행에 withdrawn_at을 기록하고 나이·직업을 NULL로 비운다.
- 다시 동의하면 새 행을 추가한다. 같은 상태를 반복해서 보내면 아무것도 바뀌지 않는다.

**요청 본문 (예시)**

```json
{
  "agreed": true,
  "document_version": "service-v2"
}
```

**응답 200 (예시)** W1과 같은 형식

```json
{
  "schema_version": "2.0",
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "rules": {
    "holdSeconds": 3,
    "recoverSeconds": 3,
    "realertSeconds": 60,
    "threshold": 0.7
  },
  "preferences": {
    "alerts_on": false
  },
  "consents": {
    "optional_profile": false
  },
  "records": []
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 400 | `CONSENT_REQUIRED` | 필수 동의 누락·중복·다른 문서 버전, 선택 동의 없이 나이·직업 입력 |
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 |
| 503 | `ACCOUNT_BUSY` | 같은 계정 작업이 진행 중(2초 대기 초과) |

<a id="w1"></a>

### W1 · `GET /v2/workspace` — 설정 + 기록 조회

로그인 필요 · 계정 헤더

- 앱 시작 시 한 번에 프로필·판정 기준·알림 설정·선택 동의 상태·기록 목록을 받는다.
- records는 R1과 같은 배열이다.

**요청 본문**: 없음

**응답 200 (예시)**

```json
{
  "schema_version": "2.0",
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "rules": {
    "holdSeconds": 3,
    "recoverSeconds": 3,
    "realertSeconds": 60,
    "threshold": 0.7
  },
  "preferences": {
    "alerts_on": true
  },
  "consents": {
    "optional_profile": false
  },
  "records": []
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 로그인 없음 또는 만료 |
| 409 | `AUTH_CHANGED` | X-PoseGood-User-Id가 로그인 계정과 다름 |

<a id="w2"></a>

### W2 · `PUT /v2/workspace` — 설정 저장

로그인 필요 · 계정 헤더

- profile, rules, preferences 세 개를 모두 보낸다. 동의와 기록은 이 요청으로 바뀌지 않는다.
- 바꾼 판정 기준은 다음 세션부터 적용된다.

**요청 필드**

| 필드 | 타입 | 필수 | 규칙 |
|---|---|---|---|
| `profile` | `object` | 필수 | A2의 profile과 같은 규칙 |
| `rules.holdSeconds` | `number` | 필수 | 붕괴 확정 시간. 0 초과 10 이하, 0.5초 단위 |
| `rules.recoverSeconds` | `number` | 필수 | 회복 확정 시간. 0 초과 10 이하, 0.5초 단위 |
| `rules.realertSeconds` | `int` | 필수 | 재알림 간격. 1~180초 |
| `rules.threshold` | `number` | 필수 | 붕괴 확률 임계값. 0 초과 1 이하, 소수 셋째 자리까지 |
| `preferences.alerts_on` | `boolean` | 필수 | 자세 알림 켜기(sound_alert_enabled) |

**요청 본문 (예시)**

```json
{
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "rules": {
    "holdSeconds": 3,
    "recoverSeconds": 3,
    "realertSeconds": 60,
    "threshold": 0.7
  },
  "preferences": {
    "alerts_on": true
  }
}
```

**응답 200 (예시)** W1과 같은 형식

```json
{
  "schema_version": "2.0",
  "profile": {
    "name": "홍길동",
    "age": null,
    "occupation": null
  },
  "rules": {
    "holdSeconds": 3,
    "recoverSeconds": 3,
    "realertSeconds": 60,
    "threshold": 0.7
  },
  "preferences": {
    "alerts_on": false
  },
  "consents": {
    "optional_profile": false
  },
  "records": []
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 |
| 400 | `CONSENT_REQUIRED` | 필수 동의 누락·중복·다른 문서 버전, 선택 동의 없이 나이·직업 입력 |
| 503 | `ACCOUNT_BUSY` | 같은 계정 작업이 진행 중(2초 대기 초과) |
| 409 | `AUTH_CHANGED` | X-PoseGood-User-Id가 로그인 계정과 다름 |

## 6. 기준 자세

카메라 보정 동안 모은 9개 관절의 평균 좌표를 저장한다. 영상, 개별 프레임, 장치 ID는 저장하지 않는다.
자세 등록은 B1 하나뿐이다. 앱이 3초 동안 판정 가능 프레임의 평균을 내서 보낸다. `/v2/realtime` 자세 등록(`purpose: calibration`)은 2026-10-27 삭제했다([11.4](#114-자세-등록)).

<a id="b1"></a>

### B1 · `POST /v2/baselines` — 기준 자세 등록

로그인 필요 · 계정 헤더

- 항상 새 행을 추가하고 과거 행은 고치지 않는다.
- 같은 `registration_id`와 같은 좌표로 다시 보내면 기존 행을 돌려준다. 같은 `registration_id`에 다른 좌표면 409.
- `registered_at`은 서버가 등록을 받은 시각이다. 앱은 시각을 보내지 않는다(2026-10-26 [ADR 0028](../decisions/0028-server-time-for-baseline-registration.md)).
- 좌표는 소수 다섯째 자리로 반올림해 저장하고, 저장된 값을 응답한다.
- baseline_id는 DB 키로 만든 이름 기반 UUID다.

**요청 필드**

| 필드 | 타입 | 필수 | 규칙 |
|---|---|---|---|
| `registration_id` | `UUID` | 필수 | 촬영 한 번마다 앱이 한 번 만든다. 재시도 때 같은 값. (예전 `registered_at`은 보내면 400) |
| `calibration_ms` | `long` | 필수 | 3,000~999,900 (검증만 하고 저장하지 않음) |
| `sample_count` | `int` | 필수 | 20~100,000 (검증만 하고 저장하지 않음) |
| `landmarks.{관절}` | `{x, y}` | 필수 | nose, left_eye, right_eye, left_ear, right_ear, mouth_left, mouth_right, left_shoulder, right_shoulder. 각 0~1 |

**요청 본문 (예시)**

```json
{
  "registration_id": "3f2b8c1e-7a4d-4e9b-9c61-0d5a2e8f4b17",
  "calibration_ms": 5000,
  "sample_count": 120,
  "landmarks": {
    "nose": {
      "x": 0.50112,
      "y": 0.41873
    },
    "left_eye": {
      "x": 0.52741,
      "y": 0.38902
    },
    "...": "right_eye, left_ear, right_ear, mouth_left, mouth_right, left_shoulder, right_shoulder"
  }
}
```

**응답 200 (예시)**

```json
{
  "schema_version": "2.0",
  "baseline_id": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
  "registered_at": "2026-10-13T08:00:00.000Z",
  "landmarks": {
    "nose": {
      "x": 0.50112,
      "y": 0.41873
    },
    "left_eye": {
      "x": 0.52741,
      "y": 0.38902
    },
    "...": "right_eye, left_ear, right_ear, mouth_left, mouth_right, left_shoulder, right_shoulder"
  }
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 |
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) |
| 503 | `ACCOUNT_BUSY` | 같은 계정 작업이 진행 중(2초 대기 초과) |

<a id="b2"></a>

### B2 · `GET /v2/baselines/current` — 현재 기준 자세

로그인 필요 · 계정 헤더

- 사용자의 가장 최근(DB ID가 가장 큰) 기준 자세를 돌려준다. 세션 생성 때 이 baseline_id를 쓴다.

**요청 본문**: 없음

**응답 200 (예시)**

```json
{
  "schema_version": "2.0",
  "baseline_id": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
  "registered_at": "2026-10-13T08:00:00.000Z",
  "landmarks": {
    "nose": {
      "x": 0.50112,
      "y": 0.41873
    },
    "left_eye": {
      "x": 0.52741,
      "y": 0.38902
    },
    "...": "right_eye, left_ear, right_ear, mouth_left, mouth_right, left_shoulder, right_shoulder"
  }
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 404 | `BASELINE_NOT_FOUND` | 등록된 기준 자세 없음 |

## 7. 측정 세션

세션 ID는 앱이 만든 UUID다. 진행 중 판정 상태는 API 메모리에 있으므로 API를 재시작하면 진행 중 세션은 404 SESSION_LOST가 된다.

<a id="s1"></a>

### S1 · `PUT /v2/sessions/{id}` — 세션 생성

로그인 필요 · 계정 헤더

- policy와 baseline_id는 계정의 현재 정책·현재 기준과 같아야 한다(설정 화면에서 받은 값을 그대로 보냄).
- monitor_session에 정책·기준·알림 설정을 고정하고 메모리에 판정 엔진을 만든다.
- 같은 UUID·같은 본문 재시도는 같은 세션을 돌려준다.
- 응답은 처음·재시도 모두 200 SessionView(빈 요약, ended:false)다. started_at·baseline_id·alert_enabled는 응답에 없다 — 시작 시각은 S5, 알림 여부는 W1의 preferences.alerts_on, 기준은 B2로 확인한다.

**요청 필드**

| 필드 | 타입 | 필수 | 규칙 |
|---|---|---|---|
| `policy.hold_ms` | `long` | 필수 | 500ms 단위 |
| `policy.recovery_ms` | `long` | 필수 | 500ms 단위 |
| `policy.reminder_ms` | `long` | 필수 | 1,000ms 단위 |
| `policy.threshold` | `number` | 필수 | 0 초과 1 이하 |
| `baseline_id` | `UUID` | 필수 | B2의 baseline_id |

**요청 본문 (예시)**

```json
{
  "policy": {
    "hold_ms": 3000,
    "recovery_ms": 3000,
    "reminder_ms": 60000,
    "threshold": 0.7
  },
  "baseline_id": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60"
}
```

**응답 200 (예시)**

```json
{
  "schema_version": "1.0",
  "session_id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "policy": {
    "hold_ms": 3000,
    "recovery_ms": 3000,
    "reminder_ms": 60000,
    "threshold": 0.7
  },
  "timer_policy": "legacy-interrupt-v1",
  "ended": false,
  "last_sequence": -1,
  "summary": {
    "total_ms": 0,
    "valid_ms": 0,
    "normal_ms": 0,
    "deviation_ms": 0,
    "rest_ms": 0,
    "away_ms": 0,
    "unknown_ms": 0,
    "missing_ms": 0,
    "collapse_count": 0,
    "alert_count": 0,
    "interval_count": 0,
    "keep_rate": null,
    "events_per_hour": null,
    "mean_interval_ms": null,
    "mean_recovery_ms": null
  },
  "events": []
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) |
| 409 | `BASELINE_REQUIRED` | 기준 자세 없이 세션 생성 |
| 404 | `SESSION_LOST` | DB 행은 있지만 API 재시작으로 판정 상태가 사라짐 |
| 429 | `LIMIT_REACHED` | 세션 최대 측정 시간(기본 24시간 = 계약의 시각 상한) 초과, 진행 중 세션 512개 초과 |
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 |
| 503 | `ACCOUNT_BUSY` | 같은 계정 작업이 진행 중(2초 대기 초과) |

<a id="s2"></a>

### S2 · `POST /v2/sessions/{id}/features` — 특징 입력 → 추론 → 판정

로그인 필요 · 계정 헤더

- 구간 하나(1~1,500ms)의 특징을 받아 FastAPI에 추론을 요청하고, 결과로 판정 엔진을 진행시킨다.
- 세션 잠금 안에서 순서대로 처리한다. sequence는 이전보다 커야 하고 start_ms는 이전 구간 끝 이상이어야 한다.
- 구간 사이 빈 시간은 MISSING으로 제외하고, 순번만 건너뛰면 연속 누적을 끊는다.
- 새 사건(붕괴 확정·재알림·회복·중단)은 응답 전에 DB에 쓴다.

**요청 필드**

| 필드 | 타입 | 필수 | 규칙 |
|---|---|---|---|
| `schema_version` | `string` | 필수 | **고정** `"2.0"` |
| `feature_version` | `string` | 필수 | **고정** `"shoulder-relative-deltas-v1"` |
| `baseline_id` | `UUID` | 필수 | 세션에 고정된 기준과 같아야 함 |
| `sequence` | `long` | 필수 | 0부터 증가 |
| `start_ms / end_ms` | `long` | 필수 | 세션 시작부터 경과 ms. 길이 1~1,500ms |
| `phase` | `enum` | 필수 | running · rest(휴식) · away(자리 비움) |
| `measurement_quality` | `enum` | 필수 | good · poor |
| `features` | `object \| null` | 선택 | 어깨 폭으로 정규화한 (현재 − 기준) 변화량과 품질. 측정 불가면 null |

**요청 본문 (예시)**

```json
{
  "schema_version": "2.0",
  "feature_version": "shoulder-relative-deltas-v1",
  "baseline_id": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
  "sequence": 41,
  "start_ms": 41000,
  "end_ms": 42000,
  "phase": "running",
  "measurement_quality": "good",
  "features": {
    "head_gap_delta": -0.081,
    "lateral_offset_delta": 0.012,
    "shoulder_tilt_delta": 0.02,
    "current_quality": 0.93,
    "baseline_quality": 0.95
  }
}
```

**응답 200 (예시)**

```json
{
  "schema_version": "1.0",
  "observation": {
    "schema_version": "2.0",
    "sequence": 41,
    "start_ms": 41000,
    "end_ms": 42000,
    "phase": "running",
    "valid": true,
    "collapse_probability": 0.82,
    "deviation_type": "forward_slouch",
    "model_version": "reference-feature-rule-v1"
  },
  "session": "{ SessionView }"
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) |
| 409 | `SESSION_ENDED` | 끝난 세션에 입력 |
| 429 | `LIMIT_REACHED` | 세션 최대 측정 시간(기본 24시간 = 계약의 시각 상한) 초과, 진행 중 세션 512개 초과 |
| 502 | `INFERENCE_FAILED` | 추론 서비스 실패·응답 계약 불일치 |
| 503 | `SESSION_BUSY` | 같은 세션 요청이 진행 중(10초 대기 초과) |
| 503 | `STORAGE_UNAVAILABLE` | DB 일시 장애 |
| 404 | `SESSION_LOST` | DB 행은 있지만 API 재시작으로 판정 상태가 사라짐 |

<a id="s3"></a>

### S3 · `POST /v2/sessions/{id}/end` — 세션 종료

로그인 필요 · 계정 헤더

- 마지막 구간 뒤 남은 시간은 MISSING으로 제외하고, 열린 사건을 interrupted(ended)로 끝낸 뒤 session_ended 사건을 만든다.
- monitor_session 종료 시각·good_sec과 excluded_interval을 한 트랜잭션으로 한 번만 반영한다. daily_stat은 쓰지 않는다(Spark J2가 다음 날 00:00에 집계).
- 응답은 200 SessionView(ended:true). 같은 end_ms 재시도는 같은 결과, 이미 끝난 세션에 다른 end_ms를 보내면 409 CONFLICT.

**요청 본문 (예시)**

```json
{
  "end_ms": 600000
}
```

**응답 200 (예시)**

```text
{ SessionView, ended: true }
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) |
| 404 | `SESSION_LOST` | DB 행은 있지만 API 재시작으로 판정 상태가 사라짐 |
| 503 | `SESSION_BUSY` | 같은 세션 요청이 진행 중(10초 대기 초과) |
| 503 | `STORAGE_UNAVAILABLE` | DB 일시 장애 |

<a id="s4"></a>

### S4 · `GET /v2/sessions/{id}` — 세션 상태 조회

로그인 필요 · 계정 헤더

- 메모리의 최신 판정 상태를 돌려준다. 끝난 세션은 30분 동안 조회할 수 있다.

**요청 본문**: 없음

**응답 200 (예시)**

```json
{
  "schema_version": "1.0",
  "session_id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "policy": {
    "hold_ms": 3000,
    "recovery_ms": 3000,
    "reminder_ms": 60000,
    "threshold": 0.7
  },
  "timer_policy": "legacy-interrupt-v1",
  "ended": false,
  "last_sequence": 41,
  "summary": {
    "total_ms": 42000,
    "valid_ms": 40000,
    "normal_ms": 33000,
    "deviation_ms": 7000,
    "rest_ms": 0,
    "away_ms": 0,
    "unknown_ms": 2000,
    "missing_ms": 0,
    "collapse_count": 1,
    "alert_count": 1,
    "interval_count": 0,
    "keep_rate": 0.825,
    "events_per_hour": 90,
    "mean_interval_ms": null,
    "mean_recovery_ms": null
  },
  "events": [
    {
      "schema_version": "1.0",
      "session_id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
      "event_id": 1,
      "kind": "collapse_confirmed",
      "timestamp_ms": 38000,
      "onset_ms": 35000,
      "onset_valid_ms": 33000,
      "deviation_type": "forward_slouch",
      "reason": null
    }
  ]
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 404 | `SESSION_NOT_FOUND` | 세션이 없거나 다른 사용자의 것 |
| 404 | `SESSION_LOST` | DB 행은 있지만 API 재시작으로 판정 상태가 사라짐 |

<a id="s5"></a>

### S5 · `GET /v2/sessions/{id}/metadata` — 세션 메타데이터

로그인 필요 · 계정 헤더

- DB 행 기준이라 재시작 뒤에도 조회된다. model_version은 메모리에 상태가 있고 관측이 1건 이상일 때만 채운다.

**요청 본문**: 없음

**응답 200 (예시)**

```json
{
  "started_at": "2026-10-13T08:00:00.000Z",
  "ended_at": null,
  "baseline_id": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
  "model_version": "reference-feature-rule-v1"
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 404 | `SESSION_NOT_FOUND` | 세션이 없거나 다른 사용자의 것 |

<a id="s6"></a>

### S6 · `DELETE /v2/sessions/{id}` — 세션 삭제

로그인 필요 · 계정 헤더

- monitor_session과 하위 행(사건·알림·제외 구간)을 지운다. 일별 통계는 그대로 둔다.
- 특징 적재 파일(feature_archive)이 연결돼 있으면(J1이 HDFS에 적재한 세션) 409 CONFLICT. 적재된 기록은 사용자가 지울 수 없고, 탈퇴하면 J3가 모두 지운다. 전용 코드는 두지 않는다(10/15).

**요청 본문**: 없음

**응답 204**: 본문 없음

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 404 | `SESSION_NOT_FOUND` | 세션이 없거나 다른 사용자의 것 |
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) |

## 8. 기록·시스템

앱 기록 원문은 저장하지 않는다. 저장 요청은 서버 판정과 대조한 뒤 세션을 닫는 데 쓰고, 조회는 세션 테이블에서 다시 만든다.

<a id="r1"></a>

### R1 · `GET /v2/records` — 기록 목록

로그인 필요 · 계정 헤더

- 닫힌 세션을 최신순으로 RecordItem 목록(`records`)으로 돌려준다. 서버 기준 오늘 날짜 `today`(KST `YYYY-MM-DD`)를 함께 준다.
- **2026-10-27부터 배열 대신 객체 `{today, records}`다(BE-6). 예전처럼 배열로 읽으면 깨진다.**
- 자세 방향은 저장 칸이 없어 unspecified, 바른 자세 시간은 0.1초 정밀도다.

**요청 본문**: 없음

**응답 200 (예시)**

```json
{
  "today": "2026-10-13",
  "records": [
    {
      "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
      "startedAt": "2026-10-13T08:00:00.000Z",
      "endedAt": "2026-10-13T08:10:00.000Z",
      "mode": "camera",
      "valid": 580,
      "good": 520,
      "total": 600,
      "events": [
        {
          "id": 1,
          "type": "forwardHead",
          "startAt": 35,
          "confirmedAt": 38,
          "endAt": 44,
          "durationSec": 9,
          "alerts": 1,
          "blockId": 0,
          "recovered": true,
          "endedBySession": false,
          "endReason": null,
          "firstAlertAt": 38,
          "recoverySec": 6
        }
      ],
      "rules": {
        "holdSeconds": 3,
        "recoverSeconds": 3,
        "realertSeconds": 60,
        "threshold": 0.7
      },
      "server": {
        "baselineId": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
        "modelVersion": "reference-feature-rule-v1",
        "confirmed": true,
        "view": "{ SessionView, ended: true }"
      }
    }
  ]
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 로그인 없음 또는 만료 |

<a id="r2"></a>

### R2 · `POST /v2/records` — 기록 저장

로그인 필요 · 계정 헤더

- server가 포함된 카메라 측정 기록만 받는다.
- 합계·사건·정책·기준·모델 버전이 서버가 확인해 준 판정과 다르면 409.
- 통과하면 아직 열린 세션을 닫는다. 메모리 상태가 없으면 전체를 MISSING으로 제외하고 good_sec=0으로 닫는다.
- 응답은 보낸 기록에서 날짜만 DB 시각으로 바꾼 것이다.

**요청 본문 (예시)**

```json
{
  "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "startedAt": "2026-10-13T08:00:00.000Z",
  "endedAt": "2026-10-13T08:10:00.000Z",
  "mode": "camera",
  "valid": 580,
  "good": 520,
  "total": 600,
  "events": [
    {
      "id": 1,
      "type": "forwardHead",
      "startAt": 35,
      "confirmedAt": 38,
      "endAt": 44,
      "durationSec": 9,
      "alerts": 1,
      "blockId": 0,
      "recovered": true,
      "endedBySession": false,
      "endReason": null,
      "firstAlertAt": 38,
      "recoverySec": 6
    }
  ],
  "rules": {
    "holdSeconds": 3,
    "recoverSeconds": 3,
    "realertSeconds": 60,
    "threshold": 0.7
  },
  "server": {
    "baselineId": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
    "modelVersion": "reference-feature-rule-v1",
    "confirmed": true,
    "view": "{ SessionView, ended: true }"
  }
}
```

**응답 200 (예시)**

```json
{
  "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "startedAt": "2026-10-13T08:00:00.000Z",
  "endedAt": "2026-10-13T08:10:00.000Z",
  "mode": "camera",
  "valid": 580,
  "good": 520,
  "total": 600,
  "events": [
    {
      "id": 1,
      "type": "forwardHead",
      "startAt": 35,
      "confirmedAt": 38,
      "endAt": 44,
      "durationSec": 9,
      "alerts": 1,
      "blockId": 0,
      "recovered": true,
      "endedBySession": false,
      "endReason": null,
      "firstAlertAt": 38,
      "recoverySec": 6
    }
  ],
  "rules": {
    "holdSeconds": 3,
    "recoverSeconds": 3,
    "realertSeconds": 60,
    "threshold": 0.7
  },
  "server": {
    "baselineId": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
    "modelVersion": "reference-feature-rule-v1",
    "confirmed": true,
    "view": "{ SessionView, ended: true }"
  }
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 400 | `INVALID_CONTRACT` | 형식·범위 위반, 정책 값을 DB에 담을 수 없음 |
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) |
| 404 | `SESSION_NOT_FOUND` | 세션이 없거나 다른 사용자의 것 |
| 503 | `SESSION_BUSY` | 같은 세션 요청이 진행 중(10초 대기 초과) |

<a id="r3"></a>

### R3 · `DELETE /v2/records/{id}` — 기록 삭제

로그인 필요 · 계정 헤더

- S6과 같다. UUID가 아닌 ID나 이미 없는 세션은 204로 조용히 넘어간다.
- 409 CONFLICT = HDFS에 적재된 기록이라 지울 수 없음. 앱은 R3에서 받은 409를 이 뜻으로 본다.

**요청 본문**: 없음

**응답 204**: 본문 없음

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 409 | `CONFLICT` | 재시도 본문 불일치, 역순·겹침 구간, 설정·기준 변경, 기록 불일치, HDFS에 적재된 기록 삭제(S6·R3) |

<a id="t1"></a>

### T1 · `GET /v2/stats/daily` — 일별 통계 (설계 확정, 구현 전)

로그인 필요 · 계정 헤더

> [!NOTE]
> 2026-10-26 형식 확정, 아직 코드 없음(FE 요청 BE-2·BE-5 ③, 이름 T1은 FE가 붙임). 데이터 `daily_stat`은 Spark J2가 쓰고 API는 읽기만 한다. J2가 돌기 전에는 모든 날이 0으로 채워진다.

- 로그인한 사용자 본인의 `daily_stat`을 날짜순으로 돌려준다.
- **어제까지만** 준다. `to`가 서버 기준 오늘(KST) 이후면 어제로 자른다. 오늘 화면은 앱이 로컬에 모은 서버 결과를 쓴다(10/22 결정, [FE 연동 명세 4.5](api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위)).
- **행이 없는 날은 0으로 채운다.** `from`~`to`(자른 뒤)의 모든 날짜가 `days`에 한 번씩 들어간다.
  `valid_sec`·`good_sec`은 0.0, 횟수는 0, `min_until_collapse_sec`·`max_until_collapse_sec`·`computed_at`은 null(DB에서도 「표본 없음」은 NULL이다).
- **객체로 감싼다.** 날짜 목록은 `days`에 넣고, 서버 기준 오늘 날짜 `today`(KST `YYYY-MM-DD`)를 함께 준다.
- **필드 이름은 DB `daily_stat` 컬럼 이름 그대로**(snake_case)다. 초 단위 값은 0.1초 정밀도다.

**요청 쿼리**

| 이름 | 타입 | 필수 | 규칙 |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | 필수 | 시작 날짜(KST) |
| `to` | `YYYY-MM-DD` | 필수 | 끝 날짜(KST, 포함). 오늘 이후면 어제로 자름. 자른 뒤 `from`보다 앞이면 `days`는 빈 배열 |

**응답 200 (예시)** — 10/26에 10/24~10/30을 요청한 경우

```json
{
  "today": "2026-10-26",
  "from": "2026-10-24",
  "to": "2026-10-25",
  "days": [
    {
      "stat_date": "2026-10-24",
      "valid_sec": 3600.0,
      "good_sec": 2950.5,
      "session_count": 3,
      "event_count": 5,
      "alerted_event_count": 4,
      "min_until_collapse_sec": 120.0,
      "max_until_collapse_sec": 900.0,
      "computed_at": "2026-10-24T15:00:03.120Z"
    },
    {
      "stat_date": "2026-10-25",
      "valid_sec": 0.0,
      "good_sec": 0.0,
      "session_count": 0,
      "event_count": 0,
      "alerted_event_count": 0,
      "min_until_collapse_sec": null,
      "max_until_collapse_sec": null,
      "computed_at": null
    }
  ]
}
```

| 필드 | 뜻 (DB `daily_stat` 설명) |
|---|---|
| `stat_date` | 집계 날짜. KST, 세션 시작 날짜 기준 |
| `valid_sec` | 유효 측정 시간 합(유지율의 분모) |
| `good_sec` | 바른 자세 시간 합(분자) |
| `session_count` | 세션 수 |
| `event_count` | 붕괴 사건 수 |
| `alerted_event_count` | 알림이 표시된 사건 수 |
| `min_until_collapse_sec`·`max_until_collapse_sec` | 바른 자세에서 붕괴까지 걸린 시간의 최솟값·최댓값(5분 이상 세션만). 표본이 없으면 null |
| `computed_at` | J2가 집계한 시각(UTC). 0으로 채운 날은 null |

<a id="h1"></a>

### H1 · `GET /health` — 상태 확인

공개

- DB에 SELECT 1을 보내 연결을 확인한다. 배포 헬스 체크용.

**요청 본문**: 없음

**응답 200 (예시)**

```json
{
  "status": "ok",
  "storage": "mysql"
}
```

**오류**

| HTTP | code | 의미 |
|---|---|---|
| 503 | `STORAGE_UNAVAILABLE` | DB 일시 장애 |

## 9. 공통 응답 객체

### SessionView — 세션 조회 (schema 1.0)

S1·S2·S3·S4 응답과 WebSocket `decision`·`progress`가 이 구조(또는 그 `summary`)를 쓴다. 아래 값은 예시다.

```json
{
  "schema_version": "1.0",
  "session_id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "policy": {
    "hold_ms": 3000,
    "recovery_ms": 3000,
    "reminder_ms": 60000,
    "threshold": 0.7
  },
  "timer_policy": "legacy-interrupt-v1",
  "ended": false,
  "last_sequence": 41,
  "summary": {
    "total_ms": 42000,
    "valid_ms": 40000,
    "normal_ms": 33000,
    "deviation_ms": 7000,
    "rest_ms": 0,
    "away_ms": 0,
    "unknown_ms": 2000,
    "missing_ms": 0,
    "collapse_count": 1,
    "alert_count": 1,
    "interval_count": 0,
    "keep_rate": 0.825,
    "events_per_hour": 90,
    "mean_interval_ms": null,
    "mean_recovery_ms": null
  },
  "events": [
    {
      "schema_version": "1.0",
      "session_id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
      "event_id": 1,
      "kind": "collapse_confirmed",
      "timestamp_ms": 38000,
      "onset_ms": 35000,
      "onset_valid_ms": 33000,
      "deviation_type": "forward_slouch",
      "reason": null
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `policy` | object | 세션 생성 때 고정된 정책(ms). 이후 설정을 바꿔도 이 세션은 그대로다. |
| `timer_policy` | string | `legacy-interrupt-v1`. 중단되면 연속 누적 시간을 0으로 되돌린다(일시정지 후 재개가 아님). |
| `last_sequence` | long | 마지막으로 받은 구간 순번. 아직 없으면 -1. |
| `summary.*_ms` | long | 전체·유효·바른 자세·이탈·휴식·자리 비움·판정 불가·누락 시간. |
| `summary.keep_rate` | double \| null | 바른 자세 시간 ÷ 유효 시간. 유효 시간이 0이면 null. |
| `summary.events_per_hour` | double \| null | 유효 시간 1시간당 붕괴 횟수. |
| `summary.mean_interval_ms` | double \| null | 붕괴 시작 사이 평균 간격(유효 시간 축). 붕괴가 2번 미만이면 null. |
| `summary.mean_recovery_ms` | double \| null | 첫 알림부터 회복 확정까지 평균 시간. |
| `events[].kind` | enum | `collapse_confirmed`(최초 알림) · `reminder` · `recovery_confirmed` · `interrupted` · `session_ended` |
| `events[].reason` | string \| null | `interrupted`일 때 `missing` · `missing_sequence` · `unmeasurable` · `rest` · `away` · `ended` |
| `events[].onset_valid_ms` | long | 이탈이 시작된 위치를 유효 시간 축으로 나타낸 값. |

### Observation — 추론 결과 (schema 2.0)

```json
{
  "schema_version": "2.0",
  "sequence": 41,
  "start_ms": 41000,
  "end_ms": 42000,
  "phase": "running",
  "valid": true,
  "collapse_probability": 0.82,
  "deviation_type": "forward_slouch",
  "model_version": "reference-feature-rule-v1"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `sequence` · `start_ms` · `end_ms` · `phase` | - | 요청과 반드시 같다. 다르면 API가 `502 INFERENCE_FAILED`로 거절한다. |
| `valid` | boolean | 판정에 쓸 수 있는 구간인지. `phase`가 running이 아니거나, `measurement_quality`가 poor이거나, 품질 값이 0.65 미만이면 반드시 false. |
| `collapse_probability` | 0 ~ 1 | 붕괴 확률. 정책의 `threshold` 이상이면 이탈 후보. `valid=false`이면 0. |
| `deviation_type` | enum | `none` · `forward_slouch` · `left_lean` · `right_lean` · `unspecified` |
| `model_version` | string | API 설정값(`reference-feature-rule-v1`)과 같아야 한다. |

### Observation 3.0 — 실시간 v2 관측

`/v2/realtime`의 `observation` 메시지에 담긴다. 추론 응답(2.0)을 API가 바꿔 보낸다.

```json
{
  "schema_version": "3.0",
  "sequence": 42,
  "start_ms": 21000,
  "end_ms": 21500,
  "phase": "running",
  "valid": true,
  "valid_ms": 500,
  "collapse_probability": 0.82,
  "deviation_type": "forward_slouch",
  "invalid_reason": null,
  "model_version": "reference-feature-rule-v1"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `valid_ms` | long | 해당 전송 구간 안에서 판정에 사용한 유효 하위 구간 길이의 합이다. 판정 불가·휴식·자리 비움·누락 시간은 포함하지 않는다. |
| `invalid_reason` | enum \| null | `valid`면 null. 아니면 `unmeasurable`(판정 가능 프레임 없음, 휴식·자리 비움 포함) · `head_turn`(고개를 돌린 프레임만 있었음) · `settling`(아직 보내지 않음). |
| 나머지 | - | Observation 2.0과 같다. |

### RecordItem — 앱 기록 (camelCase)

R1 응답과 R2 요청에 쓰는 앱 형식이다. `valid`·`good`·`total`과 사건 시각은 초 단위다.

```json
{
  "id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  "startedAt": "2026-10-13T08:00:00.000Z",
  "endedAt": "2026-10-13T08:10:00.000Z",
  "mode": "camera",
  "valid": 580,
  "good": 520,
  "total": 600,
  "events": [
    {
      "id": 1,
      "type": "forwardHead",
      "startAt": 35,
      "confirmedAt": 38,
      "endAt": 44,
      "durationSec": 9,
      "alerts": 1,
      "blockId": 0,
      "recovered": true,
      "endedBySession": false,
      "endReason": null,
      "firstAlertAt": 38,
      "recoverySec": 6
    }
  ],
  "rules": {
    "holdSeconds": 3,
    "recoverSeconds": 3,
    "realertSeconds": 60,
    "threshold": 0.7
  },
  "server": {
    "baselineId": "9b1c0e0a-2c4d-3f6a-8e1b-5a7c9d2e4f60",
    "modelVersion": "reference-feature-rule-v1",
    "confirmed": true,
    "view": "{ SessionView, ended: true }"
  }
}
```

## 10. WebSocket `/v1/realtime`

<a id="websocket-연결"></a>

> [!NOTE]
> **2026-10-26 삭제.** 앱이 [`/v2/realtime`](#11-websocket-v2realtime)으로 넘어가 서버 경로·계약(`realtime-ws.v1`)·예시를 지웠다. 이 경로로 연결하면 실패한다.
> 장 번호는 다른 문서의 참조(11.3 등)를 지키려고 남긴다. 예전 내용은 git 기록에 있다.

## 11. WebSocket `/v2/realtime`

<a id="websocket-v2-연결"></a>

연결 하나가 **측정 한 번**(`purpose: "measure"`)이다. 자세 등록은 B1으로 한다(WebSocket 등록은 2026-10-27 삭제). 앱은 관절 9개 좌표 프레임을 0.5초 구간으로 묶어 보내고, API가 기준 대비 특징 변화량을 계산해 추론(`POST /v2/infer`)·판정에 넣는다. 결과는 같은 연결로 push한다.

계약: [`realtime-ws.v2.schema.json`](../../contracts/realtime/realtime-ws.v2.schema.json), 구간 형식 [`posture-frames.v1`](../../contracts/realtime/frames/posture-frames.v1.schema.json), 예시 [`examples-v2/`](../../contracts/realtime/examples-v2/).

| 항목 | 규칙 |
|---|---|
| 인증 | `hello`의 `access_token`(로그인 access 토큰)으로 연결 때 **한 번만** 확인한다(ADR 0031). 측정 중에는 다시 확인하지 않아 토큰이 만료돼도 연결은 끝까지 가고, 비밀번호 변경·탈퇴 때만 `closed(unauthorized)`로 바로 닫는다. HTTP 단계는 열려 있고, 토큰이 없거나 틀리면 `hello`에 `closed(unauthorized)`로 답한다. 같은 출처 페이지만 허용한다(`POSEGOOD_REALTIME_ALLOWED_ORIGINS`로 추가). |
| 재연결 | 없다([ADR 0024](../decisions/0024-session-ends-on-lost-connection.md)). 연결이 끊기면 그 측정은 끝난다. 다시 하려면 새 `session_id`로 S1부터. |
| 메시지 크기 | 64KB 이하. 넘으면 `closed(bad_message)`. 120초 동안 메시지가 없으면 연결이 끊긴다. |
| 메시지 범위 | 연결 하나가 세션(또는 등록) 하나라 `hello`·`ready`만 ID를 담는다. 나머지 메시지에는 `session_id`가 없다. |
| 서버 설정 | `posegood.realtime.hello-timeout`(10초), `ready-timeout`(5초), `max-session-duration`(기본 24시간, `POSEGOOD_MAX_SESSION_DURATION`), `unmeasurable-timeout`(기본 30분, 0 = 끔, `POSEGOOD_UNMEASURABLE_TIMEOUT`) |

### 11.1 순서

```
측정:  S1 PUT /v2/sessions/{id} → WS 연결 → hello(measure) → ready
       → features × N (0.5초마다 구간 1개) → observation · decision · alert · ack · progress
       → end → decision(session_ended) → closed(ended)
```

1. 연결 뒤 **10초 안에** 첫 메시지로 `hello`를 보낸다. 없거나 `hello` 전에 다른 메시지가 오면 `closed(bad_message)`.
2. 서버는 확인이 끝나면 `ready`를 보낸다. 앱은 5초 기다린다. 서버 준비가 5초를 넘으면 서버는 그 세션을 끝내고 `closed(session_lost)`를 보낸다.
3. `features`는 `ready` 뒤에만 보낸다.

### 11.2 앱 → 서버

| type | 필드 | 설명 |
|---|---|---|
| `hello` | schema_version **고정** "2.0", purpose **고정** "measure", session_id, **access_token** | S1이 성공한 세션. access_token은 지금 가진 access 토큰(만료가 가까우면 A8로 먼저 갱신). `purpose: "calibration"`은 삭제돼 `closed(bad_message)`. |
| `features` | items[**정확히 1개**] | 좌표 구간 하나(아래 표). 2개 이상이면 `closed(bad_message)`. |
| `end` | end_ms | 측정: 사용자가 종료. 등록: 촬영 끝(마지막 구간 `end_ms`가 3000 이상일 때). |

**구간(`items[0]`) 필드**

| 필드 | 규칙 |
|---|---|
| `schema_version` | **고정** "3.0" |
| `feature_version` | **고정** "keypoints-9-v1" |
| `sequence` | 0 이상, 구간마다 1씩 증가. 같은 값·작은 값이면 `closed(bad_message)`(다시 보내기 없음). |
| `start_ms` · `end_ms` | `[start_ms, end_ms)`, 길이 1~1500ms, 앞 구간과 겹치면 안 됨. 측정은 S1 응답 시각, 등록은 촬영 시작이 0. |
| `phase` | `running` · `rest`(일시정지) · `away`(카메라 끊김). 그 밖의 값(예전 등록 `calibration`)은 `closed(bad_message)`. `rest`·`away`는 `frames: []`. |
| `frames[]` | 최대 30개. `t_ms`, `p`, 선택 `valid` |
| `frames[].p` | 관절 9개 `[x, y, visibility]`(코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨 = MediaPipe 0·2·5·7·8·9·10·11·12). x·y는 -1~2(화면 비율, 소수 5자리), visibility 0~1. 사람이 없으면 `null`. |
| `frames[].valid` | `false`만 허용. 앱이 위치를 판별하지 못한 프레임에만 붙이고, 서버는 그 프레임을 판정에서 뺀다. 없으면 생략한다. |

```json
{ "type": "hello", "schema_version": "2.0", "purpose": "measure", "session_id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90" }
```

```json
{
  "type": "features",
  "items": [
    {
      "schema_version": "3.0",
      "feature_version": "keypoints-9-v1",
      "sequence": 42,
      "start_ms": 21000,
      "end_ms": 21500,
      "phase": "running",
      "frames": [
        { "t_ms": 21012, "p": [[0.51234, 0.40211, 0.99], "… 관절 9개"] },
        { "t_ms": 21075, "p": null },
        { "t_ms": 21140, "p": [[0.51234, 0.40211, 0.99], "… 관절 9개"], "valid": false }
      ]
    }
  ]
}
```

```json
{ "type": "end", "end_ms": 600000 }
```

### 11.3 측정 — 서버가 하는 일

| 단계 | 내용 |
|---|---|
| `hello` 확인 | 로그인 사용자가 세션 주인인지, 세션이 아직 진행 중인지, 세션의 기준 자세로 특징을 계산할 수 있는지 확인한다. 같은 세션에 이미 연결이 있으면 `closed(bad_message)`. |
| 특징 계산 | 프레임별 판정 가능 여부와 촬영 시각을 이용해 유효·판정 불가 하위 구간을 구분한다. 특징은 유효한 연속 하위 구간별로 계산하며, 판정 불가 구간 전후의 프레임을 하나의 연속 관측으로 합치지 않는다. 카메라는 640×480 고정이다. |
| 판정 불가 | 쓸 프레임이 없으면 `measurement_quality: poor`로 추론에 넘기고, `observation.invalid_reason`은 고개 돌림만 있었으면 `head_turn`, 아니면 `unmeasurable`. |
| 추론·판정 | S2와 같은 흐름(추론 → 판정 → DB 기록). 판정 규칙·DB 기록도 S2와 같다. |
| 응답 | 구간마다 `observation` → 새 사건마다 `decision`(알림 대상이면 `alert`) → `ack` → `progress`. |
| 일시 장애 | 추론·DB 일시 장애(502·503)는 `stalled`만 보내고 **연결을 유지**한다. 그 구간은 다시 받지 않으므로 다음 구간과의 빈 시간은 누락(MISSING)이 된다. |
| 시간 한도 | 제품 한도는 없다(2026-10-26 결정). 계약의 시각 상한(`*_ms` ≤ 86,400,000 = 24시간)을 넘는 구간이 오면 마지막으로 받은 구간 끝에서 세션을 끝내고 `decision(session_ended)` → `closed(limit_reached)`. 서버는 최근 120개 구간만 기억해 측정 시간이 길어도 메모리가 늘지 않는다. |
| 측정불가 시간 초과 | 판정 불가(`running`인데 유효하지 않음)와 자리 비움(`away`) 구간이 이어진 시간이 `unmeasurable-timeout`(기본 30분)에 닿으면, 그 구간 끝에서 세션을 끝내고 저장한 뒤 `decision(session_ended)` → `closed(unmeasurable_timeout)`. 유효한 측정 구간이나 사용자가 누른 쉬기(`rest`)가 오면 0부터 다시 센다. 구간 사이 빈 시간(누락)은 더하지 않는다. HTTP S2로 받은 구간도 같고, 그때는 응답의 `session.ended`가 true다. 앱은 이 사유를 저장된 정상 종료로 처리한다(10/27). |
| `end` | `decision(session_ended)` → `closed(ended)`. `end_ms`가 마지막 구간 끝보다 앞서면 마지막 구간 끝에서 끝낸다. S3로 끝내도 같은 메시지를 보낸다. |
| 끊김 | 측정 중 연결이 끊기면 마지막으로 받은 구간 끝에서 세션을 끝낸다. 끝난 세션으로 다시 `hello`하면 `closed(session_lost)`. |

<a id="114-자세-등록"></a>

### 11.4 자세 등록 (삭제)

2026-10-27 삭제했다. 자세 등록은 [B1](#b1) `POST /v2/baselines`로만 한다 — 앱이 3초 동안 판정 가능 프레임(11.3과 같은 조건)의 관절 평균을 내서 보낸다. `hello`의 `purpose: "calibration"`, `ready`의 등록 형식, `calibration_result`는 없다. 장 번호는 다른 문서의 참조를 지키려고 남긴다.

### 11.5 서버 → 앱

| type | 필드 | 설명 |
|---|---|---|
| `ready` | purpose, session_id, started_at | `hello`를 받아들였다. `features`를 보내기 시작한다. 측정이면 `started_at` = 서버의 세션 시작 시각(S1을 받은 시각, UTC). 앱은 오늘 기록의 시각·날짜를 이 값으로 정한다(ADR 0028). |
| `ack` | last_sequence | 여기까지 처리 완료. 표시만 하고 다시 보내지 않는다. |
| `observation` | observation | 구간마다 [Observation 3.0](#observation-30--실시간-v2-관측). 점수 = 100 × (1 − collapse_probability). |
| `progress` | last_sequence, summary, paused_reason | 누적 요약. `paused_reason`: 마지막 구간이 휴식이면 `rest`, 카메라 끊김이면 `away`, 판정 불가면 `unmeasurable`, 측정 중이면 null. |
| `decision` | event, summary | 새 판정 사건과 그 시점 요약. 그 사건을 포함한 `progress`보다 먼저 온다. `event`에는 `schema_version`·`session_id`가 없다. |
| `alert` | event_id, kind, deviation_type | collapse_confirmed·reminder이고 세션의 알림이 켜져 있을 때만. 앱은 거르지 않는다. |
| `stalled` | since_last_sequence | 추론·DB 일시 장애. 연결은 유지된다. |
| `closed` | reason, ended_at | 서버가 연결을 닫기 직전(아래 표). `ended_at` = 이 연결에서 측정 세션이 끝났으면 서버의 세션 종료 시각(DB `ended_at`과 같음, UTC), 끝나기 전에 닫혔거나 등록이면 `null`(ADR 0028). |

| `closed.reason` | 언제 |
|---|---|
| `ended` | 측정 종료(`end`·S3), 등록 결과를 보낸 뒤 |
| `unauthorized` | 로그인 없음·탈퇴 계정, 비밀번호 변경·탈퇴로 로그인이 지워짐 |
| `not_owner` | 다른 사용자의 세션 또는 없는 세션 |
| `session_lost` | 서버에 판정 상태가 없음(재시작·정리됨·삭제), 이미 끝난 세션, `ready` 준비 시간 초과 |
| `no_baseline` | 판정에 쓸 기준 자세가 없음 |
| `bad_message` | 형식 오류, `hello` 순서·10초 제한 위반, 구간 1개가 아님, 목적과 맞지 않는 `phase`, 64KB 초과, 중복·역순 순번, 같은 세션의 두 번째 연결 |
| `server_shutdown` | 서버 종료. 측정 중이던 세션은 끊김과 같이 끝난다. |
| `limit_reached` | 최대 측정 시간 초과(11.3) |
| `unmeasurable_timeout` | 측정불가(판정 불가·자리 비움)가 정해진 시간(기본 30분) 이어져 서버가 끝내고 저장함(11.3). `ended_at`이 있다 |

**서버 → 앱 (예시)**

```json
{ "type": "ready", "purpose": "measure", "session_id": "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90", "started_at": "2026-10-26T01:00:00.120Z" }
```

```json
{
  "type": "progress",
  "last_sequence": 42,
  "summary": "{ summary }",
  "paused_reason": null
}
```

```json
{
  "type": "decision",
  "event": {
    "event_id": 1,
    "kind": "collapse_confirmed",
    "timestamp_ms": 21000,
    "onset_ms": 18000,
    "onset_valid_ms": 17000,
    "deviation_type": "forward_slouch",
    "reason": null
  },
  "summary": "{ summary }"
}
```

```json
{ "type": "closed", "reason": "ended", "ended_at": "2026-10-26T01:00:21.620Z" }
```

## 변경 이력

코드를 바꾸면 이 문서의 해당 엔드포인트와 함께 아래에 한 줄을 더한다(최신이 위).

| 날짜 | 코드 기준 | 내용 |
|---|---|---|
| 2026-10-28 | `fix/repo-backend-followup` | 측정불가 자동 종료 5분 → 30분, 기본 켬(`unmeasurable-timeout` 0 → 30m). 앱이 `closed(unmeasurable_timeout)`을 처리하므로(10/27) 끄지 않는다 |
| 2026-10-27 | `feature/repo-auth-refresh-token` | WebSocket 자세 등록(`purpose: calibration`, `calibration_result`) 삭제 — 등록은 B1뿐(11.4). `hello`는 `purpose: "measure"`만, 구간 `phase`에서 `calibration` 삭제 |
| 2026-10-27 | `feature/repo-auth-refresh-token` | 새 계정의 알림 기본값 켜짐(`alerts_on: true`, DB V2.6 `sound_alert_enabled` 기본값 참). 기존 계정 값은 그대로 |
| 2026-10-27 | `feature/repo-auth-refresh-token` | **로그인을 쿠키 세션 + 고정 30분에서 access 토큰(JWT, Bearer, 30분) + refresh 토큰(HttpOnly 쿠키, 14일, 교체·30초 유예·재사용 감지)으로 바꿈 — 호환성 깨짐.** A1 CSRF 삭제, A8 refresh 추가, A2·A3 응답에 토큰, A5 로그아웃은 refresh 쿠키로, WS `hello`에 `access_token`(11장). DB V2.6 `refresh_token` (ADR 0031) |
| 2026-10-27 | `fix/repo-backend-sync` | A2·A3·A4 응답에 `today`(KST 날짜). **R1 응답을 배열에서 `{today, records}` 객체로 바꿈 — 호환성 깨짐**(BE-6 ③) |
| 2026-10-27 | `feature/repo-remove-ws-calibration` | 다른 출처 화면용 CORS(`POSEGOOD_CORS_ALLOWED_ORIGINS`, 1장). 비우면 지금과 같다 |
| 2026-10-26 | `fix/repo-backend-sync` | 최대 측정 시간 5,000초 → 기본 24시간(계약 상한, 제품 한도 없음). 재전송 기억을 최근 120개 구간으로. 측정불가(판정 불가·자리 비움) 5분이면 그 지점에서 끝내고 저장, `closed(unmeasurable_timeout)` — 설정 `unmeasurable-timeout`, 앱 처리 전까지 끔(11.3·11.5) |
| 2026-10-26 | 설계(구현 전) | [T1](#t1) `GET /v2/stats/daily` 형식 확정: 어제까지로 자름, 빈 날은 0으로 채움, `{today, from, to, days}` 객체, 필드는 `daily_stat` 컬럼 이름 그대로. 「T1·R1b 제공하지 않음」은 잘못 적은 것이라 되돌림 |
| 2026-10-26 | `fix/repo-backend-sync` | 로그인 고정 30분 만료 구현(1장, `LoginLifetime`) — 활동해도 늘지 않는다. `/v1/realtime` 삭제(10장, 3장 WS 행) |
| 2026-10-26 | `fix/repo-backend-sync` | `/v2/realtime`: `ready`(측정)에 `started_at`, `closed`에 `ended_at`(서버 시각, 모르면 null). 계약 `realtime-ws.v2`·예시 변경 — 앱 검증과 함께 바꿔야 함 ([ADR 0028](../decisions/0028-server-time-for-baseline-registration.md) 3번) |
| 2026-10-26 | `fix/repo-backend-sync` | B1: 요청의 `registered_at` → `registration_id`(UUID, 재시도 구분). `registered_at`은 서버 시각. DB V2.5(migration 015). 호환성 깨짐 — 예전 본문은 400 ([ADR 0028](../decisions/0028-server-time-for-baseline-registration.md)) |
| 2026-10-16 | `c7b8605` | `/v2/realtime` 추가(11장: 좌표 프레임 측정·자세 등록, `ready`·`calibration_result`, `closed` 사유 `no_baseline`·`bad_message`·`limit_reached`, `stalled` 뒤 연결 유지, Observation 3.0). 429 관측 10,000건 한도 → 최대 측정 시간(기본 5,000초). `/v1/realtime`은 v2 전환 뒤 삭제 |
| 2026-10-16 | `dc2de48` | HTML 명세서를 Markdown으로 옮김(내용 같음). WebSocket 사용 조건(`VITE_REALTIME_URL`) 한 줄 추가 |
| 2026-10-15 | `dc2de48` | 아키텍처 v5.2 전환 1차: 탈퇴 철회(A8)·`WITHDRAWAL_NOT_CANCELLABLE` 삭제, 탈퇴 최종 삭제는 Spark J3, `daily_stat`은 Spark J2(S3에서 쓰지 않음). S1·S3 응답은 200 `SessionView`로 확정. R3·S6의 적재 기록 409는 공통 `CONFLICT`(전용 코드 없음) |
| 2026-10-14 | `316877d` | Java 17·Spring Boot 4.0.8·Gradle·Jackson 3 전환 반영. 문자열 자리의 객체·배열 → 400. 예시·고정값 표시 |
| 2026-10-13 | `ce57f56` | 처음 작성 (REST 23개 + `/v1/realtime`) |
