# 계정·저장 API v1

> 과거 계약. 현재 구현은 [DB V2.3 계정 API v2](accounts.v2.md)를 사용한다. 아래는 이전 형식의 기록이다.

API의 같은 출처 HTTP 계약이다. 프론트의 `/api/v1/`는 Nginx·Vite가 API의 `/v1/`로 전달한다.
기존 [특징·관측·사건·조회 계약](README.md)은 변경하지 않는다. API는 계정과 MySQL을 필수로 하며 계정 없는 모드는 없다.
저장 구조는 DB 스키마 V2.2이다([ADR 0020](../docs/decisions/0020-single-api-decision-engine.md)).
2026-10-09 변경: 탈퇴 30일 유예와 철회 경로, `setup.device`는 받지만 저장하지 않음, 모든 시각 KST 저장.

## 인증과 요청 조건

인증은 DB에 저장하는 서버 세션 cookie를 사용한다. cookie는 HttpOnly·SameSite=Lax이며 HTTPS 배포에서는
`POSEGOOD_COOKIE_SECURE=true`로 설정한다. `GET /auth/csrf`에서 받은 토큰을 모든 변경 요청의
`X-CSRF-TOKEN`에 보낸다. 가입·로그인·탈퇴 철회도 CSRF 대상이다. 로그인/로그아웃 후 토큰을 다시 받는다.

인증한 사용자가 요청의 소유자다. 보호 요청의 `X-PoseGood-User-Id`는 현재 화면에서 확인한 `user_id`다.
이는 다른 탭에서 로그인 계정이 변경됐을 때 오래된 화면의 쓰기를 차단하는 보조 조건이며 인증 수단이 아니다.
다른 값은 `409 AUTH_CHANGED`, 미인증은 401, CSRF 실패는 403, 다른 사람의 측정 세션은 404다.
오류는 `{error, code, message}`이며 비밀번호·내부 토큰·SQL 상세를 응답하지 않는다.
계정 작업 잠금 대기는 `503 ACCOUNT_BUSY`, 세션 처리 대기는 `503 SESSION_BUSY`, DB 일시 장애는 `503 STORAGE_UNAVAILABLE`이다.
셋 다 같은 요청 본문을 유지하여 재시도한다. 409 순서/중복 충돌과 구분한다.

## 공개 계정 경로

| 경로 | 요청 | 응답 |
| --- | --- | --- |
| `GET /auth/csrf` | 없음 | `{header_name:"X-CSRF-TOKEN", token}` |
| `POST /auth/register` | `{email,password,profile,consent_version:"service-v1"}` | 사용자, 로그인 cookie |
| `POST /auth/login` | `{email,password}` | 사용자, 로그인 cookie. 탈퇴 유예 중이면 `403 ACCOUNT_CLOSED` |
| `POST /auth/withdrawal/cancel` | `{email,password}` | 사용자, 로그인 cookie. 처리 중이면 `409 WITHDRAWAL_NOT_CANCELLABLE` |
| `GET /auth/me` | 로그인 cookie | `{user_id,email,profile}` |
| `POST /auth/logout` | CSRF·사용자 조건 | 204 |
| `PUT /auth/password` | `{current_password,new_password}` | 204, 모든 로그인 철회(그 사용자의 `SPRING_SESSION` 행 삭제, 실시간 연결 종료) |
| `DELETE /auth/account` | `{password}` | 204, 탈퇴 접수(아래 '탈퇴') |

`user_id`는 `user_account_id`의 10진 문자열(예: `"42"`)이다.
`profile`은 `{name,age,occupation}`이다. 이름 1..30자(`display_name`), 나이 정수 1..120, 직업 1..80자를 받는다.
이메일은 검증 후 소문자로 정규화한다. 새 비밀번호는 최소 12자와 최대 UTF-8 72바이트를 모두 만족해야 한다.
`service-v1`은 서비스 자료 보관에 대한 명시적 선택이며 연구·학습 활용 동의가 아니다. 동의(T-41)는 보류라 저장하지 않는다.

## 설정과 기록

`GET /workspace` 응답:

```json
{
  "schema_version": "1.0",
  "profile": {"name": "합성 예제", "age": 30, "occupation": "합성 테스트"},
  "rules": {"holdSeconds": 3, "recoverSeconds": 3, "realertSeconds": 60, "threshold": 0.7},
  "preferences": {"alerts_on": true},
  "records": []
}
```

`PUT /workspace`는 `{profile,rules,preferences}` 전체를 받는다. `records`를 이 요청으로 변경하지 않는다.
`rules`는 사용자의 `threshold_policy` 행이다. 가입 직후 값은 시드 `DEFAULT_TEMP`(임시값)이다.
`holdSeconds`·`recoverSeconds`는 0.5초 단위, `realertSeconds`는 1 이상 정수, `threshold`는 소수 셋째 자리까지만 받고 그 밖은 400이다.
`preferences.alerts_on`은 「자세 알림」 `user_account.alert_enabled`(V2.2, 기본 켜짐)이며 새 측정의 `alert_enabled`로 복사된다.
꺼진 측정의 알림 시도는 `ALERT_OFF`로 억제 기록한다. 소리 설정 `sound_alert_enabled`(기본 꺼짐)는 아직 앱 설정이 없어 API가 바꾸지 않는다.
데모 표시 여부는 서버에 저장하지 않는다.
설정의 시간은 초이며 측정 생성의 policy는 밀리초다. 진행 중인 측정의 고정 policy는 변경하지 않는다.
`rules`와 기존 기록의 camelCase 키는 유지한다. 새로운 계정 필드는 snake_case다.

`GET /records`, `POST /records`, `DELETE /records/{id}`는 로그인한 사용자 범위에서 동작한다.
기록은 프론트의 [RecordItem](../frontend/src/features/storage/types.ts) 구조다. V2.1에서 원문 테이블(`client_record`)이 없어져
기록 원문을 저장하지 않는다.

- `POST /records`는 서버 측정 기록(`server` 필드)만 받는다(없으면 400). 기록은 해당 사용자의 세션과 일치해야 하고(아니면 409,
  다른 사람 세션은 404), 통과하면 세션 행이 아직 열려 있을 때 닫은 뒤 보낸 기록을 날짜만 바꿔 그대로 응답한다.
  확인 종료가 아닌 기록(`confirmed: false`)은 판정 상태가 있으면 마지막 수신 시각에서 끝내 `DISCONNECTED`로,
  재시작으로 상태가 없으면 `ERROR`로 닫는다. 같은 기록의 재전송은 같은 응답이다.
- `GET /records`(와 `GET /workspace`의 `records`)는 닫힌 세션마다 하나씩, 시작 시각의 역순으로 세션 테이블에서 다시 만든다.
  테이블에 없는 값은 이렇게 채운다: 사건의 자세 방향은 `unspecified`(화면 종류 `referenceChange`, T-36 붕괴 유형 보류),
  `last_sequence`는 -1, 바른 자세 시간은 `good_sec`의 0.1초 단위. `USER_STOP`은 `confirmed: true`,
  `DISCONNECTED`는 `confirmed: false`와 조회 요약, `ERROR`는 `confirmed: false`·`view: null`·합계 0이다.
  그래서 저장 직후 응답과 다시 읽은 기록은 이 값들이 다를 수 있다.

- 판정 상태가 API에 있으면: 기록의 조회 요약은 서버 사건 이력의 앞부분이어야 하고, 확인 종료(`confirmed`)면 서버 요약과 같아야 한다.
- API 재시작으로 상태가 없으면: DB에 남은 종료 시각·바른 자세 시간·사건 수·알림 수와 맞아야 한다.
- 관측 요약·사건 투영·policy·기준 ID·모델 ID가 조회 요약과 맞아야 한다. 시작·확인 종료 날짜는 서버 DB 시각으로 바꿔 저장하므로 응답의 날짜를 채택한다.

`DELETE /records/{id}`는 ID가 서버 세션이면 그 세션을 삭제한다(기록이 곧 세션이다).

## 측정 생성

`PUT /sessions/{UUID}` 본문은 `{policy, setup}`이다. `policy`는 위 단위 규칙을 밀리초로 따른다. `setup`이 없으면 400이다.
`setup`은 기준 자세다: 보정 동안 9개 관절(코·눈·귀·입 양끝·어깨)의 MediaPipe 정규화 좌표 평균. 영상·프레임별 값은 넣지 않는다.

```json
{
  "device": {"key": "브라우저 카메라 deviceId(출력 가능 ASCII ≤128)", "label": "카메라 이름 ≤100"},
  "frame": {"width": 640, "height": 480},
  "baseline": {
    "baseline_id": "보정 UUID", "calibration_ms": 3000, "sample_count": 20,
    "landmarks": {
      "nose": {"x": 0.5, "y": 0.4}, "left_eye": {"x": 0.52, "y": 0.37}, "right_eye": {"x": 0.48, "y": 0.37},
      "left_ear": {"x": 0.56, "y": 0.38}, "right_ear": {"x": 0.44, "y": 0.38},
      "mouth_left": {"x": 0.515, "y": 0.45}, "mouth_right": {"x": 0.485, "y": 0.45},
      "left_shoulder": {"x": 0.65, "y": 0.62}, "right_shoulder": {"x": 0.35, "y": 0.62}
    }
  }
}
```

`device`·`frame`은 앱 호환을 위해 받지만 저장하지 않는다(V2.0에서 장치 테이블, V2.1에서 세션 해상도 삭제).
좌표는 0..1이고 소수 다섯째 자리까지 저장한다. 화면 밖으로 추정된 관절이 있는 프레임은 평균에서 빼고, 그런 프레임만 남으면 앱이 보정 실패로 처리한다.
기준 자세는 사용자당 한 행이다. 새 `baseline_id`는 그 행을 덮어쓰고, 세션은 시작 때 `baseline_id`를 복사한다.
현재 기준을 같은 값으로 다시 보내면 그대로 쓰고, 값이 다르면 409다. 이미 세션에 쓰였다가 바뀐 기준이나 다른 계정의 기준이면 409다.
같은 세션 UUID 재전송은 같은 `policy`·`baseline_id`여야 하고 다르면 409다.
특징 요청의 `baseline_id`는 생성 때의 기준과 같아야 한다(409). 종료 응답을 받지 못했으면 같은 `end_ms`로 다시 보낸다.
종료가 확인된 뒤 다른 `end_ms`는 409다.

진행 중 판정 상태는 API 메모리에 있다. API가 재시작되면 행이 남은 세션은 `404 SESSION_LOST`다(행이 없거나 다른 사람 세션은 `404 SESSION_NOT_FOUND`).
같은 UUID의 빈 세션으로 대체하지 않는다.

`GET /sessions/{UUID}/metadata`는 소유 측정의 `{started_at,ended_at,baseline_id,model_version}`을 반환한다.
알 수 없는 값은 null이다. `DELETE /sessions/{UUID}`는 소유 측정(곧 그 기록)을 삭제한다.
특징 적재 파일(`feature_archive`)이 있는 측정은 파일 삭제 배치 전까지 409다.

## 탈퇴

DB V2.2 절차(database/README.md 9장)를 따른다.

1. 접수: `deletion_request`(`ACCOUNT_ALL`, `REQUESTED`, `account_closed_at`)를 쓰고 계정을 `CLOSED`로 바꾼다. 모든 로그인을 끊는다.
   식별 정보와 기록은 지우지 않는다. 유예 중 같은 이메일로 다시 가입할 수 없고, 로그인은 `403 ACCOUNT_CLOSED`다.
   로그인 끊기는 그 사용자의 `SPRING_SESSION` 행 삭제다(V2.1에서 `auth_epoch` 삭제).
2. 철회: 유예 중 `POST /auth/withdrawal/cancel`로 계정을 `ACTIVE`로 되돌리고 요청 행을 지운다(이력 없음).
3. 최종 삭제: `account_closed_at + 30일`이 지나면 매시간 도는 작업이 계정 단위 한 트랜잭션으로 지운다.
   순서는 적재 기록 → 세션(하위 행 cascade) → 일별 통계 → 기준 자세 → 삭제 요청 → 계정이다.
   특징 적재 파일이 남은 계정은 `FAILED`로 두고 다음 실행에서 다시 본다. 삭제 완료 안내 메일은 아직 없다.

내려받은 CSV와 기존 백업은 별도 저장물이므로 함께 지웠다고 주장하지 않는다. 백업 만료·연구 동의/철회는 운영 결정이 필요하다.

## 내부 경계

Compose에서 FastAPI는 내부 토큰을 검증한다. `/health`만 토큰 없이 접근할 수 있고 외부 브라우저에 토큰을 전달하지 않는다.
[아키텍처 v5.2 스택별 역할](../docs/design/architecture_v5.2_stack_roles.md)을 따른다.
