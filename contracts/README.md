# AI 상태 출력 계약 v1

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

## API·CEP 관측과 사건 계약

새 독립 서버 흐름은 [관측 v2](posture-observation.v2.schema.json)를 사용한다.
추론 출력은 현재 점수/유효성만 제공하고 시간 판정은 CEP가 한다. v1은 기존 흐름 호환성으로 보존한다.
[사건 v1](posture-event.v1.schema.json), [조회 snapshot v1](session-view.v1.schema.json),
[수작업 합성 관측](examples/v2/synthetic-observation.json)을 함께 검증한다.
`make check-backend`는 실제 FastAPI 생산자와 API/Esper 소비자를 같은 계약으로 HTTP 검증한다.
구간·순서·재시도·중단·통계 의미는 [서비스 계약 설명](../backend/README.md)을 따른다.
