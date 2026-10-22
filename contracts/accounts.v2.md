# 계정·기준 자세·저장 API v2

현재 MySQL [DB V2.3](../database/README.md) 계정 앱의 계약이다. 프론트 `/api/v2/`는 API `/v2/`로 전달된다.
v1의 가입·workspace·세션 생성 형식과 호환되지 않아 별도 경로를 쓴다. 기존 v1 계정 경로는 제공하지 않는다.
특징 요청·관측 v2, 사건·조회·WebSocket v1은 그대로 유지한다. [ADR 0022](../docs/decisions/0022-db-v23-feature-v2-integration.md).

## 인증

DB에 저장하는 HttpOnly·SameSite=Lax 로그인 쿠키를 쓴다. HTTPS에서는 `POSEGOOD_COOKIE_SECURE=true`.
`GET /auth/csrf`의 `{header_name:"X-CSRF-TOKEN",token}`을 모든 변경 요청에 붙인다. 로그인·로그아웃 뒤 재발급한다.
보호 요청은 로그인으로 확인한 10진 문자열 `user_id`를 `X-PoseGood-User-Id`에 붙인다.
다른 탭의 계정 변경은 `409 AUTH_CHANGED`, 미인증 401, CSRF 실패 403, 타인 세션 404다.
이 헤더는 인증 수단이 아니다. 응답에 비밀번호·토큰·SQL·입력 자료를 노출하지 않는다.
`503 ACCOUNT_BUSY`, `SESSION_BUSY`, `STORAGE_UNAVAILABLE`은 같은 본문으로 재시도한다.

## 계정과 동의

| 경로 | 요청과 결과 |
| --- | --- |
| `POST /auth/register` | `{email,password,profile,consents}` → `{user_id,email,profile}` + 로그인 |
| `POST /auth/login` | `{email,password}` → 사용자 + 로그인. 탈퇴 대기 계정은 `403 ACCOUNT_CLOSED` |
| `GET /auth/me` | 사용자 |
| `POST /auth/logout` | 204 |
| `PUT /auth/password` | `{current_password,new_password}` → 204, 모든 로그인과 열린 실시간 연결 철회 |
| `DELETE /auth/account` | `{password}` → 204, 탈퇴 접수 |
| `PUT /consents/optional-profile` | `{agreed:boolean,document_version:"service-v2"}` → workspace |

`profile`은 `{name,age,occupation}`. 이름 1..30자 필수, 나이 `null` 또는 정수 14..120,
직업 `null` 또는 공백이 아닌 1..80자다. 나이·직업은 선택 동의가 있어야 입력할 수 있다.
새 비밀번호는 최소 12자·최대 UTF-8 72바이트. 이메일은 검증 후 공백 제거·소문자로 정규화한다.

`consents`는 `{type,document_version}` 배열. 문서 버전은 [service-v2](consent-documents.v2.md).
필수 `TERMS`, `ACCOUNT_INFO`, `POSE_COORDINATES`, `MEASUREMENT_RECORD`, `AGE_14_OVER`를 모두 명시한다.
`OPTIONAL_PROFILE`은 선택이며 미동의 항목은 보내지 않는다. 누락·중복·알 수 없는 종류·다른 버전은 400.
계정과 동의 행은 하나의 트랜잭션이다. 동의 시각은 서버 KST다.
선택 철회는 기존 동의의 `withdrawn_at`과 계정의 `age=NULL,occupation=NULL`을 같은 트랜잭션으로 처리한다.
재동의는 새 행이며, 동일 상태의 반복 요청은 행을 추가하지 않는다. 필수 철회는 탈퇴로 처리한다.
V2.2 기존 계정의 과거 동의 시각은 만들어 넣지 않는다. 개정 약관의 일괄 재동의 화면은 후속 범위다.

## 설정

`GET /workspace`:

```json
{
  "schema_version": "2.0",
  "profile": {"name": "합성 예제", "age": null, "occupation": null},
  "rules": {"holdSeconds": 3, "recoverSeconds": 3, "realertSeconds": 60, "threshold": 0.7},
  "preferences": {"alerts_on": false},
  "consents": {"optional_profile": false},
  "records": []
}
```

`PUT /workspace`는 `{profile,rules,preferences}` 전체를 받는다. 동의·기록은 이 요청으로 변경하지 않는다.
정책 행은 불변이며 네 값으로 찾거나 추가한다. 기본값은 기존 3초/3초/60초/0.7을 설정으로 지정한다.
`holdSeconds`·`recoverSeconds`는 0.5초 단위, `realertSeconds`는 정수, `threshold`는 소수 셋째 자리까지다.
`alerts_on`은 DB가 세션 알림 원본으로 정한 `user_account.sound_alert_enabled`에 대응한다(기본 false).
기기의 소리 재생 허용과 데모 표시는 DB에 저장하지 않는다.

## 기준 자세

`POST /baselines`는 `{registered_at,calibration_ms,sample_count,landmarks}`를 받는다.
`registered_at`은 프론트가 촬영을 완료한 UTC ISO 시각이며 재시도에 그대로 쓴다.
연속 촬영 3,000..999,900ms, 유효 좌표 표본 20..100,000개를 확인한다. 두 수치는 검증만 하며 DB에 저장하지 않는다.
`landmarks`는 `nose,left_eye,right_eye,left_ear,right_ear,mouth_left,mouth_right,left_shoulder,right_shoulder`의
`{x,y}` 평균 좌표(각 0..1)다. 영상·개별 프레임·장치 ID를 저장하지 않는다. 좌표는 소수 다섯째 자리로 반올림한다.

응답은 `{schema_version:"2.0",baseline_id,registered_at,landmarks}`이며 저장된 정밀도의 좌표를 돌려준다.
동일 사용자·등록 시각·정규화 좌표의 재전송은 같은 행을 반환한다. 같은 시각의 다른 좌표는 409다.
새 등록은 INSERT하며 과거 행을 수정하지 않는다. `GET /baselines/current`는 사용자별 가장 큰 DB ID의 행,
없으면 `404 BASELINE_NOT_FOUND`다.
공개 `baseline_id`는 `UUID.nameUUIDFromBytes(UTF8("posegood:baseline:"+userId+":"+baselinePostureId))`다.
DB 키에서 안정적으로 만들고, 모든 접근은 별도로 소유권을 확인한다.

프론트는 저장 응답의 평균 좌표로 기준 특징을 다시 구성하고, 조회 후에도 같은 계산을 쓴다.
현재 영상의 종횡비를 사용한다. 카메라가 꺼진 조회 화면의 임시 640×480 계산은 연결 후 실제 크기로 갱신한다.
복원 시 visibility=1은 이미 등록을 통과한 기준이라는 표시이며 새 측정의 신뢰도가 아니다.
카메라 위치·구도가 달라지면 다시 등록한다. 로그인 계정이 바뀌면 메모리 기준을 비운다.

## 측정과 기록

`PUT /sessions/{UUID}`는 `{policy,baseline_id}`. 계정의 현재 정책·현재 기준과 같아야 하며 다르면 409다.
정책은 ms 단위다. 기준이 없으면 `409 BASELINE_REQUIRED`. 세션은 계정 정책 FK·기준 FK·알림 설정을 고정한다.
같은 UUID·같은 정책·기준으로 재시도하면 같은 세션이다. 다른 본문은 409다.
`POST /sessions/{UUID}/features`는 기존 특징 v2, `POST .../end`는 `{end_ms}`(고정 재시도),
`GET /sessions/{UUID}`는 조회 v1, `GET .../metadata`는 `{started_at,ended_at,baseline_id,model_version}`다.
WebSocket은 `/v1/realtime`이며 기존 hello/features/observation/ack/progress/decision/alert/closed를 쓴다.

`GET /records`, `POST /records`, `DELETE /records/{id}`는 [RecordItem](../frontend/src/features/storage/types.ts)을 쓴다.
POST는 소유 세션의 확인받은 요약·사건·정책·기준과 일치하는 기록만 받고 DB의 날짜를 응답한다.
GET은 DB 테이블에서 재구성한다. 사건 방향은 저장하지 않으므로 `unspecified`, 순번은 -1,
바른 자세 시간은 `good_sec`의 0.1초 정밀도다. `recovered_at`이 있으면 회복, 그 외 세션 종료와 같은 시각이면
종료 중단, 나머지는 제외 중단으로 복원한다. 알림은 시도 시각으로 정렬한다.
DB에 종료 원인이 없으므로 v2 기록의 `confirmed:true`는 서버에 종료·요약이 저장됐음을 뜻한다.
원래 브라우저가 종료 응답을 받았는지는 DB에서 복원하지 않는다.

서버 연동 뒤의 화면은 어제까지의 일별 통계를 T1으로 제공·표시하고, 오늘 목록·집계는 앱이 로컬에 수집한 서버 세션 결과를 사용한다(2026-10-22 결정). 서버의 기록 조회·저장과 별개인 표시용 보관이며, 같은 날짜·세션을 중복 합산하지 않는다. 구체적인 출처는 [FE 연동 명세 4.5](../docs/design/api-ws-spec.md#45-기록통계-r1r1br3t1-be-다음-주-범위)를 따른다.

판정 상태는 API 메모리이며 재시작 후 `404 SESSION_LOST`다. 상태를 잃은 세션의 미확인 기록 저장은
알 수 없는 전체 구간을 MISSING으로 제외하고 good=0으로 닫는다. 일별 통계를 추가하지 않는다.
전체가 MISSING인 기록은 `confirmed:false,view:null`, 수치 합계 0으로 표시해 정상/이탈 시간을 만들어내지 않는다.
기록 삭제는 세션과 하위 행을 지우며 일별 통계는 유지한다. 적재 파일이 연결된 세션은 409다.

종료 집계는 한 트랜잭션으로 한 번만 반영한다. 일별 붕괴까지 시간 min/max는 5분 이상 세션의
시작/직전 붕괴 종료→다음 붕괴 시작 및 마지막 무붕괴 구간에서 제외 시간을 뺀 표본을 쓴다.
표본이 없으면 NULL이며 세션 시작 KST 날짜에 누적한다.

탈퇴 접수는 CLOSED와 삭제 요청을 저장하고 모든 로그인을 끊는다.
만료 후 적재 파일 삭제 확인→세션→일별 통계→기준→삭제 요청→계정 순서로 지우며 동의는 FK CASCADE다.
HDFS 파일 삭제와 완료 메일은 아직 구현하지 않았다. 실제 영상·학습 자료는 이 API의 저장 대상이 아니다.
