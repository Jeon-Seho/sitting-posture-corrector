# 자세 측정 데이터 흐름과 백엔드 연동 예시

이 문서는 프런트의 키포인트가 추론·판정을 거쳐 화면으로 돌아오는 흐름을 정리한다. 아래 숫자와 UUID는 **합성 예시**다. 기준: `feature/model-replay-two-stage-pilot`, 2026-11-09.

현재 서비스의 추론은 규칙 기반이고, 웹캠 비교 화면에서 사용하는 2단계 학습 모델은 별도의 로컬 연구 도구다. 두 경로가 이미 연결된 것은 아니다.
2026-11-12부터 [프레임별 2단계 RF 파일럿](analysis/frame_pilot/README.md)을 별도 경로로 준비한다. 유효한 프레임마다 점수를 내고, 3초 지속 판정은 서비스 판정 서버의 책임이다.

## 1. 현재 서비스 경로

```text
프런트
  → WebSocket /v2/realtime: 키포인트 9개
  → API 서버: 기준 자세와 비교해 특징 3개 계산
  → 추론 서버 POST /v2/infer: 규칙 기반 이탈 점수
  → API 서버 내부 판정 엔진: 이탈 지속·복귀·알림 판단
  → WebSocket /v2/realtime: observation / decision / alert / progress
  → 프런트
```

현재 판정 엔진은 API 서버 안에 있다. Kafka를 통한 별도 처리 서비스 연결은 [전환 계획](../docs/plans/active/0031-realtime-kafka-transition.md)에서 다루며, 이 문서의 HTTP 경로가 이미 그 전환을 마쳤다는 뜻은 아니다.

### 1-1. 프런트 → API 서버: 키포인트

세션 생성과 WebSocket `hello`·`ready` 이후, 앱은 `/v2/realtime`에 아래처럼 보낸다. 구간과 프레임의 시간은 세션 시작 기준 밀리초다. 앱의 현재 전송은 메시지마다 보통 프레임 하나다.

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
- 영상 자체는 보내지 않는다. 추적할 수 없는 프레임은 `p: null`, `valid: false`로 보내며 정상 프레임으로 대체하지 않는다.
- 기준 자세는 앞서 `POST /v2/baselines`로 별도 등록한다. 상세 형식과 허용 범위는 [프레임 계약](../contracts/realtime/frames/posture-frames.v1.schema.json), [WebSocket 계약](../contracts/realtime/realtime-ws.v2.schema.json)을 따른다.

### 1-2. API 서버 → 추론 서버: 기존 특징 3개

API 서버가 등록된 기준 자세와 좌표 구간을 사용해 특징을 계산한 다음 `POST /v2/infer`를 호출한다. 다음은 기준 자세와의 차이를 가정한 합성 예시다.

```json
{
  "schema_version": "2.0",
  "feature_version": "shoulder-relative-deltas-v1",
  "baseline_id": "00000000-0000-4000-8000-000000000001",
  "sequence": 42,
  "start_ms": 4200,
  "end_ms": 4300,
  "phase": "running",
  "measurement_quality": "good",
  "features": {
    "head_gap_delta": -0.225,
    "lateral_offset_delta": 0.0,
    "shoulder_tilt_delta": 0.0,
    "current_quality": 0.99,
    "baseline_quality": 1.0
  }
}
```

세 변화량은 각각 머리-어깨 높이, 좌우 치우침, 어깨 기울기의 **현재 − 기준**이다. 기존 API는 3개 변화량과 품질을 받으며 2단계 실험 모델의 6개 입력을 아직 받지 않는다. 요청·응답의 구간과 `sequence`는 일치해야 한다([입력 계약](../contracts/inference-request.v2.schema.json)).

### 1-3. 추론 서버 → 판정 엔진: 관측 결과

위 요청에 대한 현재 규칙 추론의 응답 예시다. API 서버는 이를 자신의 판정 엔진에 전달한다.

```json
{
  "schema_version": "2.0",
  "sequence": 42,
  "start_ms": 4200,
  "end_ms": 4300,
  "phase": "running",
  "valid": true,
  "collapse_probability": 0.7159090909090908,
  "deviation_type": "unspecified",
  "model_version": "reference-feature-rule-v1"
}
```

`collapse_probability`는 0~1의 이탈 점수다. 현재 구현은 학습 모델이 아닌 규칙 점수이며 이름과 달리 보정된 확률이 아니다. `deviation_type: unspecified`는 이탈 방향을 특정하지 못한다는 뜻이다. 실제 모델/특징 버전을 속여서 같은 이름을 쓰지 않는다([관측 계약](../contracts/posture-observation.v2.schema.json)).

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
    "collapse_probability": 0.7159090909090908,
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

판정 엔진의 누적 알림 시도 횟수는 `progress.summary.alert_count`에서 확인한다. 이는 실제 화면·OS 표시 성공 횟수와 같다고 보장할 수 없다. 세션 알림이 꺼져 있어도 판정 엔진에는 시도 이력이 남지만 프런트로 `alert`를 보내지는 않는다. 판정 불가일 때 프런트용 `observation`은 `valid: false`, `posture: null`, `collapse_probability: null`, 지속 시간 0과 사유를 보낸다. 기존 **추론 v2 내부 응답**은 스키마상 `valid: false`일 때 점수 0과 `deviation_type: none`을 넣지만, 0을 정상 관측으로 취급하면 안 된다.

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

## 3. 2단계 모델의 서비스 연결 시 협의할 점

1. **입력 계약:** 기존 `/v2/infer`는 3개 특징만 받는다. 6개 특징, 기준 어깨 너비와 등록 시 9점의 품질을 어디에서 계산·검증할지 결정하고, 필요한 계약을 버전 관리해야 한다. 기존 v2 요청에 임의 필드를 추가하면 거부된다.
2. **출력 계약:** `model.score`를 기존 `collapse_probability`에 연결하는 방안을 검토할 수 있다. 다만 현재 실험 응답에는 서비스 관측에 필요한 `sequence`, 구간, `model_version`이 없고, 2클래스 모델은 좌·우 등 `deviation_type`을 예측하지 않는다. 기존 관측 계약과 버전 처리를 정해야 한다.
3. **시간 구간:** 기존 창 모델의 최근 1초 창은 0.5초마다 서로 겹친다. 새 프레임 모델은 입력 창을 기다리지 않는다. 어느 쪽이든 서버에서 순번·촬영 시각·누락·판정 구간을 정하고, 끊긴 구간을 정상이나 이탈로 채우지 않는다.
4. **임계값과 알림:** 실험의 0.65와 기존 규칙의 기본 0.7은 다른 값이다. 모델별 비교 기준을 학습·검증 자료에 근거해 정하고 세션 정책에 반영해야 한다. 화면의 `100 × (1 − 점수)`와 표시용 평활화는 모델 입력이나 판정에 사용하지 않는다.
5. **품질과 검증:** `unmeasurable`은 정상 또는 0점이 아니다. 실험 모델은 독립적인 실제 사용자 성능을 입증한 결과가 아니며, 시험 참여자 데이터로 임계값을 튜닝하지 않는다.

자세한 실험 실행과 해석은 [웹캠 비교 안내](analysis/live_comparison/README.md), 서비스 데이터 경계는 [계약 안내](../contracts/README.md)를 참고한다.
