# 자세 측정 데이터 흐름과 백엔드 연동 예시

이 문서는 프런트의 키포인트가 추론·판정을 거쳐 화면으로 돌아오는 흐름을 정리한다. 아래 숫자와 UUID는 **합성 예시**다.

추론 서버는 `POST /infer`에서 [100배 증강 프레임 RF](pretrained/frame-rf-100x/README.md)를 기본으로 제공한다. 현재 develop의 Java API는 같은 주소에 특징 변화량을 보내므로 이 추론 서버와 연결하면 422를 받는다. BE가 프레임과 기준 자세를 보내도록 전환할 때 함께 병합·배포한다. [계획 0098](../docs/plans/active/0098-frame-rf-service-inference.md)

## 1. BE 연결 후 local 서비스 경로

```text
프런트
  → WebSocket /realtime: 키포인트 9개
  → API 서버: 프레임 9점 좌표와 기준 자세 9점 전달
  → 추론 서버 POST /infer: 6개 특징 계산, 프레임 RF, 구간 점수 변환
  → API 서버 내부 판정 엔진: 이탈 지속·복귀·알림 판단
  → WebSocket /realtime: observation / decision / alert / progress
  → 프런트
```

시간 판정은 API 판정 엔진이 담당한다. Kafka 경로는 기본으로 꺼져 있다. Kafka 소비자는 features 본문의 특징 변화량으로 자체 규칙 점수를 계산한다. [특징 변화량 계약](../contracts/feature-deltas.schema.json), [Kafka 전환 계획](../docs/plans/active/0031-realtime-kafka-transition.md)

### 1-1. 프런트 → API 서버: 키포인트

세션 생성과 WebSocket `hello`·`ready` 이후, 앱은 `/realtime`에 아래처럼 보낸다. 구간과 프레임의 시간은 세션 시작 기준 밀리초다. 앱의 현재 전송은 메시지마다 보통 프레임 하나다.

```json
{
  "type": "features",
  "items": [
    {
      "schema_version": "3.0",
      "feature_version": "keypoints-9-v1",
      "sequence": 42,
      "start_ms": 4200,
      "end_ms": 4300,
      "phase": "running",
      "frames": [
        {
          "t_ms": 4200,
          "p": [
            [0.50, 0.46, 0.99],
            [0.52, 0.38, 0.99],
            [0.48, 0.38, 0.99],
            [0.54, 0.40, 0.99],
            [0.46, 0.40, 0.99],
            [0.51, 0.43, 0.99],
            [0.49, 0.43, 0.99],
            [0.60, 0.60, 0.99],
            [0.40, 0.60, 0.99]
          ]
        }
      ]
    }
  ]
}
```

- 각 점은 `[x, y, visibility]`다. 좌표는 화면 크기 대비 값이며 y는 아래로 증가한다. 좌표 자체는 미러링하지 않는다.
- 점 순서는 MediaPipe 인덱스 **0, 2, 5, 7, 8, 9, 10, 11, 12**: 코, 양 눈, 양 귀, 양 입꼬리, 양 어깨다. 입꼬리는 입 개폐량이 아니라 얼굴 높이 특징에 쓰인다.
- 영상 자체는 보내지 않는다. 추적할 수 없는 프레임은 `p: null`로 보낸다.
- 기준 자세는 앞서 `POST /baselines`로 별도 등록한다. 상세 형식과 허용 범위는 [프레임 계약](../contracts/realtime/frames/posture-frames.schema.json), [WebSocket 계약](../contracts/realtime/realtime-ws.schema.json)을 따른다.

### 1-2. API 서버 → 추론 서버: 프레임과 기준 9점

API는 `POST /infer`에 구간의 순번·시작/끝 시각·phase와 함께 기준 UUID, 프레임 목록, DB에 저장한 평균 기준 좌표 9점을 보낸다. 프레임 항목은 `[x, y, visibility]` 9점 배열 또는 추적 불가를 나타내는 `null`이다. 기준은 `[x, y]` 9점이며 visibility를 저장하지 않는다. 요청에는 프레임별 `t_ms`가 없고, 응답은 요청의 `sequence`·구간·`phase`를 돌려준다. [입력 스키마](../contracts/inference-request.schema.json), [합성 요청](../contracts/examples/inference/synthetic-inference-request.json), [일부 프레임이 null인 요청](../contracts/examples/inference/synthetic-inference-request-with-null-frames.json)

RF는 9점 모두 유한하고 좌표가 0~1, visibility가 0.65 이상인 프레임을 사용한다. 기하가 유효하지 않거나 얼굴 길이가 없거나 고개 돌림 변화가 0.15를 초과하는 프레임도 제외한다. 사용 가능한 프레임마다 학습 때와 같은 6개 특징을 구하고, 세로 이동 보정기의 출력을 반영한 특징으로 분류기의 이탈 클래스 점수를 계산한다. 기준 자세의 기하가 유효하지 않으면 422를 반환한다.

추론 서버는 시작 시 보정기와 분류기의 트리를 `CompiledForest`의 NumPy 배열로 변환해 모든 트리를 한꺼번에 계산한다. Compose의 `POSEGOOD_INFERENCE_WORKERS`로 Uvicorn 프로세스 수를 지정하며 기본은 2개다. 각 프로세스가 시작할 때 모델을 한 번씩 메모리에 올린다.

### 1-3. 추론 서버 → 판정 엔진: 관측 결과

추론 서버는 유효 프레임의 이탈 클래스 점수 평균 `p`를 `p ≤ 0.5`이면 `1.4·p`, 그보다 크면 `0.4 + 0.6·p`로 변환해 `collapse_probability`로 보낸다. RF의 0.5는 기존 기본 임계값 0.7에 대응한다. 아래 값은 평균 점수 0.6을 가정한 합성 예시다. [합성 응답](../contracts/examples/inference/synthetic-inference-response.json)

```json
{
  "schema_version": "2.0",
  "sequence": 42,
  "start_ms": 4200,
  "end_ms": 4300,
  "phase": "running",
  "valid": true,
  "collapse_probability": 0.76,
  "deviation_type": "unspecified",
  "model_version": "frame-rf-100x-v1",
  "invalid_reason": null
}
```

`collapse_probability`는 0~1의 이탈 점수이며 점수 변환에 확률 보정의 근거는 없다. `deviation_type`은 처음 세 특징의 평균 변화량을 기존 규칙으로 비교한 표시용 값이다. RF는 방향을 분류하지 않는다.

`running`에서 쓸 수 있는 프레임이 하나도 없으면 `valid: false`, 점수 0, `deviation_type: "none"`, `invalid_reason: "unmeasurable"` 또는 `"head_turn"`을 반환한다. `rest`·`away`는 `valid: false`이고 사유는 `null`이다. 유효 관측의 사유도 `null`이다. RF를 선택한 상태에서 가중치를 불러오지 못하면 `/health`와 `/infer`는 503을 반환한다. 규칙 점수는 `POSEGOOD_INFERENCE_MODEL=rule`로 명시적으로 선택할 수 있다. [키포인트 요청·관측 응답 계약](../contracts/README.md#키포인트-입력과-관측-응답)

### 1-4. 판정 엔진 → 프런트: 관측과 알림

아래는 임계값 0.7인 세션에서 이번 100ms 구간부터 이탈이 시작된 예시다. `posture: bad`는 현재 구간의 순간 판정이며 아직 알림 확정이라는 뜻은 아니다.

```json
{
  "type": "observation",
  "observation": {
    "schema_version": "4.0",
    "sequence": 42,
    "valid": true,
    "posture": "bad",
    "collapse_probability": 0.76,
    "hold_ms": 100,
    "recovery_ms": 0,
    "invalid_reason": null
  }
}
```

설정된 시간만큼 이탈이 지속되고 세션의 알림이 켜져 있으면, 서버는 나중에 별도의 `alert`를 보낸다. 기본 정책은 최초 알림 3초, 복귀 3초, 같은 사건 재알림 60초다.

```json
{
  "type": "alert",
  "event_id": 1,
  "kind": "collapse_confirmed",
  "deviation_type": "unspecified"
}
```

판정 엔진의 누적 알림 시도 횟수는 `progress.summary.alert_count`에서 확인한다. 이는 실제 화면·OS 표시 성공 횟수와 같다고 보장할 수 없다. 세션 알림이 꺼져 있어도 판정 엔진에는 시도 이력이 남지만 프런트로 `alert`를 보내지는 않는다. 판정 불가일 때 프런트용 `observation`은 `valid: false`, `posture: null`, `collapse_probability: null`, 지속 시간 0과 사유를 보낸다. 추론 응답이 `valid: false`이면 API는 그 구간을 정상 시간에서 제외하고 열린 사건을 중단한다.

## 2. 현재 2단계 모델 실험 경로

웹캠 비교 화면은 서비스 경로와 별도로 `127.0.0.1`의 로컬 서버를 사용한다. `POST /api/session`으로 세션을 만들고 `POST /api/frame`으로 관측을 보내며, 화면은 그 응답을 직접 받는다. 세션 응답의 `visibility_minimum`은 로컬 모델에 적용된 9점 품질 하한으로, 화면의 특징 표시에도 사용한다. API 서버/운영 판정 엔진과 연결되어 있지 않다. 연구 화면의 화면·시스템 알림 횟수도 운영 서버 알림 기록이 아니다.

실험 `/api/frame` 요청은 `session`, 증가하는 `time_ms`, 4:3 `width`·`height`, `landmarks`를 받는다. 정규화 좌표는 640×480 기준 공간으로 계산한다. `landmarks`는 33개 자리의 배열이며 위 9개 MediaPipe 인덱스에만 `{x, y, visibility}`를 담고 나머지는 빈 객체다. 이는 1-1의 9개 배열 WebSocket 형식과 다르다.

기준 등록이 끝나고 측정 가능한 창이 모이면 응답 예시는 다음과 같다. 합성 랜드마크를 현재 로드된 모델에 넣은 결과를 반올림했다.

```json
{
  "status": "measured",
  "features": [-0.225, 0.0, 0.0, 0.0, 0.0, 0.0],
  "rule": {"score": 0.715909, "threshold": 0.7, "deviation": true},
  "model": {"score": 0.907111, "threshold": 0.65, "deviation": true},
  "model_uncorrected": {"score": 0.940777, "threshold": 0.65, "deviation": true},
  "correction_px": -1.483900
}
```

| 필드 | 뜻 |
| --- | --- |
| `model.score` | 보정 후 분류기의 이탈 클래스(1) 점수. 0~1이며 높을수록 이탈 쪽이다. `predict_proba` 출력이지만 실제 확률로 보정·검증된 값은 아니다. |
| `model_uncorrected.score` | 세로 이동 보정 전 비교 분류기의 이탈 클래스 점수. |
| `rule.score` | 기존 3개 특징의 규칙 기반 점수. 학습 모델 점수가 아니다. |
| `threshold`, `deviation` | 각 점수의 실험 비교 기준과 그 순간의 기준 통과 여부. 모델 0.65는 현재 로드한 `report.json`에서 읽은 값으로, 모든 모델의 고정값이 아니다. |
| `correction_px` | 합성 세로 이동에 대해 학습한 보정기의 출력. 실제 의자 이동량을 뜻하지 않는다. |

프레임별 후보에서 `model_uncorrected.score`는 같은 프레임 분류기에 보정 전 값을 넣은 결과다. 별도로 학습한 미보정 분류기와의 비교는 아니다.

위 예시는 기존 핵심 필드만 발췌했다. 로컬 연구 화면의 `measured` 응답에는 추가로 `explanation`이 들어간다. `schema_version: "1.0"`, `rule` 세 항목, `model` 여섯 항목으로 구성되며 계산이 실패한 `model` 설명은 `null`이다. `unmeasurable`에는 설명이나 점수가 없다. 이 필드는 운영 추론·WebSocket 계약에는 추가되지 않았다.

예를 들어 합성 분류기에서 원래 모델 이탈 점수가 `0.44`였고 머리–어깨 높이만 0으로 대체해 보정기와 분류기를 다시 실행한 점수가 `0.42`라면 `explanation.model`의 해당 항목은 다음과 같다. 다른 다섯 특징을 고정한 비교다.

```json
{"feature":"head_gap","value":0.2,"counterfactual_score":0.42,"effect":0.02,"level":"red"}
```

`effect`는 `원래 이탈 점수 - 대체 이탈 점수`다. 화면에는 이 값을 100배 하여 `기준 대체 시 +2.0점`으로 표시한다. 규칙 항목에는 `component_score`, 등록 시 관찰된 `reference_range`, 최대 성분 여부 `dominant`, `level`이 들어간다. 색은 연구 화면의 설명용이며 판정·알림에 사용하지 않는다. 자세한 한계와 색상 정의는 [웹캠 비교 안내](analysis/live_comparison/README.md#카메라-특징-설명)를 따른다.

로컬 연구 화면은 사용자가 선택한 자세별 점수를 `POST /api/scenarios/save`로 저장할 수도 있다. 저장 버튼을 누른 경우에만 `model/test/senario/` 또는 실행 시 지정한 폴더에 `live-comparison-scenario-v1` JSON을 새로 만든다. `records`의 각 항목에는 자세 ID·이름, `automatic`/`manual` 출처와 0~100 표시 점수가 들어간다. 자동 기록에는 원점수·판정·세션 누적 알림 횟수·특징 설명을 추가하며, 수동 수정 시 자동 정보는 제외한다. 영상, 랜드마크 좌표, 참여자 이름, 세션 토큰은 저장하지 않는다. 이 저장 경로는 운영 API와 무관하며 JSON을 학습 자료나 정확도 평가로 자동 사용하지 않는다.

`features` 순서는 **머리-어깨 높이 차이, 좌우 치우침, 어깨 기울기, 얼굴 높이, 어깨 높이, 어깨 폭 비율 변화**다. 분류기에는 6개가 들어가고, 보정기에는 6개에 기준 어깨 너비를 더한 7개가 들어간다. 얼굴 높이에는 양 눈과 양 입꼬리의 세로 거리가 반영된다.

기준 등록은 최소 3초·20개 유효 표본이다. 기존 창 모델은 이후 최근 1초의 특징별 중앙값을 약 0.5초마다 평가한다. 프레임별 후보는 등록 뒤 유효한 관측마다 점수를 계산하며 창을 기다리지 않는다. 두 방식 모두 모델에 필요한 9점의 visibility가 부족하면 이전 점수를 지우고 `unmeasurable`을 반환한다. 시작값 0.65는 검증 전 입력 품질 설정이다. 등록 중에는 `registering`과 `progress`, 등록 직후 `ready`, 창 모델이 관측을 모을 때 `warming`을 반환한다.

## 3. 서비스 연결의 남은 한계

서비스의 기준 자세는 visibility를 저장하지 않아 기준 9점이 학습 때와 같은 품질 조건을 충족하는지 확인할 수 없다. RF 후보의 독립 시험과 0.5 운영 기준 검증도 남아 있다. 9점 검사에서 제외되는 구간이 늘면 열린 사건의 중단이 더 잦아질 수 있다. 이탈이 계속되면 3초 뒤 새 사건으로 확정돼 새 최초 알림이 나갈 수 있다. [ADR 0050](../docs/decisions/0050-frame-rf-service-inference.md)
