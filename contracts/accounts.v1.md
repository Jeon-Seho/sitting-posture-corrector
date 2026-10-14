# 계정·저장 API v1

MySQL 영구 모드의 같은 출처 HTTP 계약이다. 프론트의 `/api/v1/`는 Nginx가 API의 `/v1/`로 전달한다.
기존 [특징·관측·사건·조회 계약](README.md)은 변경하지 않는다.
메모리 개발 모드는 계정 API를 제공하지 않는다.
저장 구조는 DB 스키마 V1.1([ADR 0018](../docs/decisions/0018-db-schema-v11-service-storage.md))이다.
2026-10-06 변경(프론트·API 함께 배포): `user_id` 형식, 이름 30자, `preferences`에서 `show_demo` 제거,
영구 모드 세션 생성의 `setup` 필수, 정책 단위 검사, 탈퇴 절차.

## 인증과 요청 조건

인증은 DB에 저장하는 서버 세션 cookie를 사용한다. cookie는 HttpOnly·SameSite=Lax이며 HTTPS 배포에서는
`POSEGOOD_COOKIE_SECURE=true`로 설정한다. `GET /auth/csrf`에서 받은 토큰을 모든 변경 요청의
`X-CSRF-TOKEN`에 보낸다. 가입·로그인도 CSRF 대상이다. 로그인/로그아웃 후 토큰을 다시 받는다.

인증한 사용자가 요청의 소유자다. 보호 요청의 `X-PoseGood-User-Id`는 현재 화면에서 확인한 `user_id`다.
이는 다른 탭에서 로그인 계정이 변경됐을 때 오래된 화면의 쓰기를 차단하는 보조 조건이며 인증 수단이 아니다.
다른 값은 `409 AUTH_CHANGED`, 미인증은 401, CSRF 실패는 403, 다른 사람의 측정 세션은 404다.
오류는 `{error, code, message}`이며 비밀번호·내부 토큰·SQL 상세를 응답하지 않는다.
계정 잠금 대기는 `503 ACCOUNT_BUSY`이며 같은 요청 본문을 유지하여 재시도한다.
409 순서/중복 충돌과 구분하고 일시적인 잠금 대기를 확정 거부로 처리하지 않는다.

## 공개 계정 경로

| 경로 | 요청 | 응답 |
| --- | --- | --- |
| `GET /auth/csrf` | 없음 | `{header_name:"X-CSRF-TOKEN", token}` |
| `POST /auth/register` | `{email,password,profile,consent_version:"service-v1"}` | 사용자, 로그인 cookie |
| `POST /auth/login` | `{email,password}` | 사용자, 로그인 cookie |
| `GET /auth/me` | 로그인 cookie | `{user_id,email,profile}` |
| `POST /auth/logout` | CSRF·사용자 조건 | 204 |
| `PUT /auth/password` | `{current_password,new_password}` | 204, 모든 로그인 철회 |
| `DELETE /auth/account` | `{password}` | 204, 탈퇴(아래 '탈퇴') |

`user_id`는 `user_account_id`의 10진 문자열(예: `"42"`)이다.
`profile`은 `{name,age,occupation}`이다. 이름 1..30자(`display_name`), 나이 정수 1..120, 직업 1..80자를 받는다.
이메일은 검증 후 소문자로 정규화한다. 새 비밀번호는 최소 12자와 최대 UTF-8 72바이트를 모두 만족해야 한다.
`service-v1`은 서비스 자료 보관에 대한 명시적 선택을 기록하며 연구·학습 활용 동의가 아니다.

## 설정과 기록

`GET /workspace` 응답:

```json
{
  "schema_version": "1.0",
  "profile": {"name": "합성 예제", "age": 30, "occupation": "합성 테스트"},
  "rules": {"holdSeconds": 3, "recoverSeconds": 2, "realertSeconds": 30, "threshold": 0.5},
  "preferences": {"alerts_on": true},
  "records": []
}
```

`PUT /workspace`는 `{profile,rules,preferences}` 전체를 받는다. `records`를 이 요청으로 변경하지 않는다.
`rules`는 사용자의 `threshold_policy` 행이다. 가입 직후 값은 시드 `DEFAULT_TEMP`(임시값)이다.
`holdSeconds`·`recoverSeconds`는 0.5초 단위, `realertSeconds`는 1 이상 정수, `threshold`는 소수 셋째 자리까지만 받고 그 밖은 400이다.
`preferences.alerts_on`은 `sound_alert_enabled`이며 새 측정의 `alert_enabled`가 된다. 데모 표시 여부는 서버에 저장하지 않는다.
설정의 시간은 초이며 측정 생성의 policy는 밀리초다. 진행 중인 측정의 고정 policy는 변경하지 않는다.
`rules`와 기존 기록의 camelCase 키는 유지한다. 새로운 계정 필드는 snake_case다.

`GET /records`, `POST /records`, `DELETE /records/{id}`는 로그인한 사용자 범위에서 동작한다.
기록은 프론트의 [RecordItem](../frontend/src/features/storage/types.ts) 구조를 사용한다.
서버 기록의 관측 요약·사건·policy·기준/모델 ID가 해당 사용자의 DB 확인 snapshot과 일치해야 한다.
미확인 종료 보관도 실제로 확인했던 snapshot만 수용하며 정상 종료로 바꾸지 않는다.
같은 ID·같은 원래 본문의 재전송은 기존 기록, 다른 본문은 409다.
서버 측정의 시작/확인 종료 날짜는 서버 DB 시각으로 정규화하므로 저장 응답의 날짜를 채택한다.

## 측정 생성 (영구 모드)

`PUT /sessions/{UUID}` 본문은 `{policy, setup}`이다. `policy`는 위 단위 규칙을 밀리초로 따른다.
`setup`은 V1.1에서 세션보다 먼저 있어야 하는 장치·영상 크기·기준 자세다. 보정 집계만 담고 영상·랜드마크·프레임별 값은 넣지 않는다.

```json
{
  "device": {"key": "브라우저 카메라 deviceId(출력 가능 ASCII ≤128)", "label": "카메라 이름 ≤100"},
  "frame": {"width": 640, "height": 480},
  "baseline": {
    "baseline_id": "보정 UUID", "calibration_ms": 5000, "sample_count": 20,
    "target_center_x": 0.5, "target_center_y": 0.6, "target_area_ratio": 0.05,
    "head_gap": {"mean": 0.25, "std": 0.01}, "lateral_offset": {"mean": 0, "std": 0.01},
    "shoulder_tilt": {"mean": 0, "std": 0.01}
  }
}
```

화면 위치는 0..1로 정규화한 어깨 중점과 코·어깨 상자 면적이다. 같은 UUID 재전송은 같은 `policy`·`setup`이어야 하고 다르면 409다.
새 `baseline_id`는 이전 활성 기준을 비활성화한다. 비활성 기준이나 다른 계정의 기준으로 만들면 409, `setup`이 없으면 400이다.
특징 요청의 `baseline_id`는 생성 때의 기준과 같아야 한다(409). 확인되지 않은 종료는 저장하지 않으므로
종료 응답을 받지 못했으면 같은 `end_ms`로 다시 보낸다. 종료가 확인된 뒤 다른 `end_ms`는 409다.

`GET /sessions/{UUID}/metadata`는 소유 측정의 `{started_at,ended_at,baseline_id,model_version}`을 반환한다.
미확정 값은 null이다. 기존 조회 snapshot v1에 필드를 추가하지 않고 날짜/고정 정보의 별도 경계를 제공한다.
`DELETE /sessions/{UUID}`는 소유 측정과 연결 기록을 함께 삭제한다.

기록 삭제는 연결된 서버 측정·관측·hash·snapshot·outbox·사건도 정리하고 CEP 정리 요청을 내구 저장한다.

탈퇴는 `deletion_request`를 남기고 계정을 `CLOSED`로 바꾼 뒤 이메일·비밀번호 해시·이름·나이·직업을 비우고 모든 로그인을 끊는다.
보존 기간이 정해지지 않아 0으로 처리한다. 측정·기준·장치·기록·일별 통계를 바로 지우고 요청을 `DONE`으로 둔다.
특징 적재 파일(`feature_archive`)이 남은 측정은 파일 삭제 배치를 기다린다. 같은 이메일로 다시 가입할 수 있다. 내려받은 CSV와 기존 백업은 별도 저장물이므로 즉시 삭제했다고 주장하지 않는다.
보존 기간·백업 만료·연구 동의/철회는 운영 결정이 필요하다.

## 복구와 내부 경계

API는 최초 추론 관측과 요청 hash·CEP 전달 작업을 CEP 호출 전에 같은 DB 트랜잭션으로 저장한다.
CEP 확인 후 입력 완료와 요약·사건·확인 snapshot을 함께 갱신한다.
HTTP 호출 동안 DB 행 트랜잭션을 유지하지 않는다. 계정별 MySQL 잠금으로 처리 순서와 삭제 경쟁을 제어한다.
미확인 요청은 원 관측으로 재전달한다. 확인 관측을 고정 policy로 재생해 API/CEP 재시작을 복구한다.
과거 사건 ID와 요약이 바뀌면 복구를 실패시키며 새 빈 세션으로 과거를 대체하지 않는다.

Compose에서는 CEP와 FastAPI가 내부 토큰을 검증한다. `/health`만 토큰 없이 접근 가능하며 외부 브라우저에
토큰을 전달하지 않는다. 내부 replay/cleanup API는 서비스 복구용이고 분석 플랫폼 export 계약은 아니다.
[데이터 플랫폼 책임](../docs/design/data-platform-boundary.md)을 따른다.
