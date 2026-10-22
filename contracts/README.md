# AI·서비스 경계 계약

MySQL 계정 모드의 로그인·CSRF·동의·기준 자세·설정/기록/삭제 경로는 [계정·저장 API v2](accounts.v2.md)를 따른다.
계정·설정·기준·세션 REST는 v2(`/v2/…`, DB V2.3)로 바뀐다. 계약 문서는 [계정 API v2](accounts.v2.md)·[동의 문서 v2](consent-documents.v2.md)(BE, 10/15 합침)이다. 앱이 부르는 때와 응답별 동작은 [FE 연동 명세](../docs/design/api-ws-spec.md)에 있다.

AI 출력과 측정 조회의 기존 버전은 유지한다. [데이터 플랫폼 경계](../docs/design/data-platform-boundary.md)는 별도 export 계약을 요구한다.
Kafka 토픽과 실시간 WebSocket 메시지는 [실시간 전달 계약 v1 초안](realtime/README.md)에 있다(팀 확인 전).
Kafka 토픽의 운영 명세(파티션·키·컨슈머 그룹·DLQ·보존·시험용 입구)는 [Kafka 명세](../docs/design/kafka-spec.md)다. 「Kafka 계약 v1」과 「WebSocket v1」은 다른 것이다 — WebSocket이 v2로 바뀌어도 Kafka 계약 v1은 그대로 쓴다.
앱 ↔ 입출구 서버 WebSocket v2는 [realtime-ws.v2](realtime/realtime-ws.v2.schema.json)와 [합성 예시](realtime/examples-v2/)다.

## 모델명·특징 버전의 내부 관리

2026-10-22 결정: `model_version`과 `feature_version` 등 모델명·버전명은 개발·연동·연구의 내부 관리용이다. 실제 서비스의 측정·기록·통계·비교 화면에는 표시하지 않는다. 비표시는 API 필드 삭제나 고정값 검증 생략을 뜻하지 않는다.

- `schema_version`은 메시지 계약의 버전이다. 호환성을 깨는 변경은 기존 계약 변경 규칙을 따른다.
- `model_version`·`feature_version`은 내부 모델·특징 식별자다. 기존 개발 과정에서 계산식이나 특징 의미를 바꾸고도 이름을 유지한 사례가 있으므로, 같은 이름만으로 동일한 계산 조건이라고 판단하지 않는다.
- 연구 결과의 재현에는 [연구 프로토콜](../docs/research/protocol.md#보고와-재현)에 따라 코드·설정·데이터 근거를 별도로 남긴다. 이를 서비스 화면이나 서비스 DB의 세션별 버전 저장 의무로 확대하지 않는다.
- 서비스 DB에서 모델 버전 관리 테이블·세션 버전 칼럼을 제외한 결정은 유지한다([DB 안내](../database/README.md)). 근거가 없는 과거 기록의 모델·계산 조건은 추정해 복원하지 않는다.

## 기존 상태 출력 v1

기준: [JSON Schema](posture-status.v1.schema.json). 프레임워크와 전송 방식에 독립적인 초기 계약이다.
자세 유형은 프로토타입 후보를 사용한다. 최초 통합 전 변경할 수 있으나 변경 시 버전·문서·예제를 함께 갱신한다.

| 필드 | 의미 |
| --- | --- |
| `schema_version` | 현재 `1.0` |
| `timestamp_ms` | 세션 시작 기준 단조 증가 시간, 밀리초 |
| `status` | `normal`, `deviation`, `unmeasurable` |
| `deviation_type` | `forward_slouch`, `left_lean`, `right_lean` 또는 `null` |
| `confidence` | [0, 1] 모델 점수 또는 `null`; 보정된 확률·의학적 확률을 뜻하지 않음 |
| `measurement_quality` | `good` 또는 `poor`; 품질 임계값은 수집 전 결정 |
| `duration_ms` | 현재 연속 이탈의 경과 시간; 다른 상태는 0 |

- `normal`: 품질 `good`, 이탈 유형 `null`, 유효한 confidence, duration 0.
- `deviation`: 품질 `good`, 후보 이탈 유형과 유효한 confidence, duration ≥ 0.
- `unmeasurable`: 품질 `poor`, 이탈 유형·confidence `null`, duration 0.
- 알려지지 않은 필드, NaN/Infinity, 음수 시간은 거부한다.

`deviation`은 현재 자세 이탈 판정이다. 사용자 알림은 설정 시간 이상 지속될 때 별도 정책이 결정한다.
단일 메시지 스키마는 타임스탬프 순서, 실제 지속시간, 임계값 또는 재등록 필요성을 검증하지 않는다.
이것들은 파이프라인 구현에서 시퀀스 단위로 검사해야 한다.

## 합성 예제와 변경

[정상](examples/normal.json), [이탈](examples/deviation.json), [측정 불가](examples/unmeasurable.json)는
수작업으로 만든 합성 데이터이며 실제 사람의 측정 결과가 아니다. `make test`가 예제와 거부 사례를 검사한다.
스키마가 필드 추가도 거부하므로 생산자·소비자의 호환성 변경은 새 계약 파일과 버전으로 배포한다.
원본 좌표·영상·참여자 ID는 이 계약에 넣지 않는다.

## 특징 입력 v2와 응답 v1

[특징 입력 v2](inference-request.v2.schema.json)는 FastAPI `POST /v2/infer`와
API `POST /v2/sessions/{UUID}/features`(v1 실시간이 남아 있는 동안)가 공유한다. 기존 FastAPI `/v1/infer`의 두 임시 특징은 보존한다.
[합성 요청](examples/v2/synthetic-feature-request.json)과
[TS·Python 공유 합성 사례](examples/v2/reference-feature-cases.json)를 함께 검증한다.
[합성 응답](examples/v2/synthetic-feature-response.json)은 이 요청의 1초 이탈 후보와 아직 확정 사건이 없는 요약을 보여준다.

| 필드 | 의미 |
| --- | --- |
| `schema_version`, `feature_version` | `2.0`, `shoulder-relative-deltas-v1` |
| `baseline_id` | 카메라 기준 등록 UUID의 `8-4-4-4-12` 문자열. 참여자 ID가 아니다. |
| `sequence` | 0 이상 정수. 세션별 순서·중복 비교에 사용한다. |
| `start_ms`, `end_ms` | 세션 상대 `[start_ms,end_ms)` 구간. 별도로 `0 < end_ms-start_ms <= 1500`을 검사한다. 최대 시각은 24시간이다. |
| `phase`, `measurement_quality` | `running/rest/away`, `good/poor` |
| `features` | 아래 다섯 값의 객체 또는 명시적 `null`. 필드 생략은 허용하지 않는다. |

특징 객체는 어깨 너비로 정규화한 현재−기준 변화량 `head_gap_delta`, `lateral_offset_delta`,
`shoulder_tilt_delta`와 `[0,1]`의 `current_quality`, `baseline_quality`만 받는다.
변화량은 유한수이며 `[-1,1]` 제한을 두지 않는다. 원본 영상·랜드마크·기준 특징 원값을 넣지 않는다.
알 수 없는 필드와 NaN/Infinity를 거부한다.

v2 추론 점수는 `min(1, max(|head|/0.22, |lateral|/0.20, |shoulder|/0.03)*0.7)`이다.
어깨 기울기 스케일은 [ADR 0019](../docs/decisions/0019-shoulder-tilt-scale.md)로 0.13에서 0.03으로 낮췄다.
`running/good`, 특징 존재, 현재·기준 품질 각각 0.65 이상일 때만 유효하다.
그 외에는 관측의 `valid=false`, 점수 0, 유형 `none`이며 정상 시간으로 대체하지 않는다.
품질·스케일·점수 임계값은 검증 전 규칙이다. 점수는 보정된 확률이 아니다.

유효 점수 0은 `none`이다. 좌우 변화가 다른 두 변화보다 엄격히 우세하면
원본 양수는 사용자 본인 기준 `left_lean`, 음수는 `right_lean`이다(카메라 원본 영상이 반전되지 않아 큰 x가 사용자 왼쪽, 2026-10-08 확인).
좌우 치우침은 2026-10-08부터 양 귀 가운데(머리 중심) 기준이고, 앱은 고개를 돌린 프레임(귀 가운데 대비 코 위치 변화 0.15 초과)과 되돌린 뒤 1초를 `poor`로 보낸다.
머리 높이·어깨 기울기 우세나 동점은 `unspecified`이며 전방 굽힘을 단정하지 않는다.
출력은 관측 v2, 모델명은 `reference-feature-rule-v1`이다.

API는 추론 관측을 판정 엔진에 넣고 [특징 응답 v1](feature-response.v1.schema.json)의
`{schema_version:"1.0", observation, session}`으로 관측 v2와 최신 확인 조회 v1을 반환한다.
입력의 sequence·구간·phase와 관측의 대응, 조회의 수용 범위도 소비자가 검사한다.
API는 요청 hash·원 추론 출력을 진행 중 세션마다 10,000건까지 메모리에 보관하여 동일 요청을 재시도한다.
고정 기준·고정 모델명·종료·재시작 뒤 404 유실(`SESSION_LOST`)은
[서비스 안내](../backend/README.md)와 [ADR 0013](../docs/decisions/0013-frontend-server-feature-connection.md)를 따른다.

## 관측과 사건 계약

새 독립 서버 흐름은 [관측 v2](posture-observation.v2.schema.json)를 사용한다.
추론 출력은 현재 점수/유효성만 제공하고 시간 판정은 API 판정 엔진이 한다. v1은 기존 흐름 호환성으로 보존한다.
[사건 v1](posture-event.v1.schema.json), [조회 snapshot v1](session-view.v1.schema.json),
[수작업 합성 관측](examples/v2/synthetic-observation.json)을 함께 검증한다.
`make check-backend`는 실제 FastAPI 생산자와 API 소비자를 같은 계약으로 HTTP 검증한다.
구간·순서·재시도·중단·통계 의미는 [서비스 계약 설명](../backend/README.md)을 따른다.

시간 정책은 [ADR 0012](../docs/decisions/0012-session-timing-policy.md)에 따라 확정했다.
기본값은 연속 이탈 3초에 최초 알림, 기준 내 자세 연속 3초에 복귀, 같은 사건의 마지막 알림부터
60초가 지나고 이탈 중이면 재알림이다. 휴식 이후에는 새로 시작하며, 저품질·누락은 연속 판정을 끊고
유효 시간·사건 간격 통계에서 제외한다. 측정 불가를 정상 관측이나 복귀로 대체하지 않는다.
세션에 적용한 설정은 고정하며 사용자의 설정 변경은 다음 측정 세션부터 적용한다.
기존 동작을 확정한 문서 동기화이므로 관측/사건/조회 스키마와 전송 값 `legacy-interrupt-v1`은 유지한다.
