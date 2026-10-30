# 서버가 3초씩 묶은 좌표 프레임을 추론 서버에 넘기고 프레임마다 판정

- 상태: in_progress (BE 구현·검증 끝, 커밋 전. FE 수정과 함께 배포 — FE 공지 2026-10-30)
- 담당: BE(김유진)
- 시작일: 2026-10-29
- 관련 요구사항/ADR: [ADR 0020](../../decisions/0020-single-api-decision-engine.md)(판정은 API 안, 특징 A안), [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md), [FE 제안서](../../design/fe-server-proposal.md) BE-5 ②·BE-8, [API 명세](../../design/api-spec.md) 9장·11장, [연동 명세](../../design/api-ws-spec.md) 5.1

## 문제와 완료 기준

10/27부터 앱은 좌표를 프레임 1장마다 보낸다(BE-8). BE는 같은 날 「서버가 받은 프레임을 자체적으로 묶어 처리한다」고 답했지만 코드가 없다. 지금 서버는 구간을 받는 즉시 특징을 계산해(`FrameFeatures.interval`, 쓸 수 있는 프레임 평균) 추론(`POST /v2/infer`, 구간당 특징 1개)에 넣는다. `valid_ms`는 구간 전체 길이를 더한다(`Timeline.addMeasured`, BE-5 ②).

완료 기준:

- 앱·`/v2/realtime` 입력 계약(`posture.frames.v1`, 프레임마다 구간 1개)은 바꾸지 않는다. FE 변경 없음.
- API가 세션별로 받은 구간을 모아 **서버 시계 3초마다** FastAPI 추론 서버에 **프레임째로** 넘긴다.
- 추론 서버는 **프레임마다** 점수·이탈 종류·판정 가능 여부를 돌려준다(평균 1개로 판정하지 않음).
- 3초 확정·회복·다시 알림과 `valid_ms`는 API 판정 엔진이 **프레임 촬영 시각 `t_ms`**로 센다. 서버 시계는 묶어 보내는 주기에만 쓴다.
- `valid_ms` = 판별 가능한 프레임 시간의 합. 판정 불가 프레임 시간은 제외 시간으로 간다(바른 + 이탈 + 제외 = 전체).
- 합성 좌표로 「3초 묶음 안에 판정 불가 프레임이 섞인 경우」의 `valid_ms`·`keep_rate`·확정 시각을 단위·MySQL 통합 시험으로 확인한다.

## 범위와 제외

- 바꿈: `backend/api` 실시간 처리(묶음 버퍼, 추론 호출, 엔진의 프레임 단위 시간), `model/inference`(프레임 배열을 받는 새 추론 API), 새 추론 계약(`contracts/`), 실시간 `observation` 4.0, API 명세 9·11장, ADR 0020 3절(특징 계산 위치), [백엔드 개발 상태](../../backend-status.md), `tools/service_smoke.py`.
- FE 문서(연동 명세 5.1·5.3, FE 제안서 BE-5 ②·BE-8)와 앱 코드는 BE가 고치지 않는다 — 고칠 곳은 FE 공지(저장소 밖, 2026-10-30)로 보냈다.
- 그대로: 앱(`frontend/`), `posture-frames.v1`, `realtime-ws.v2`의 앱 → 서버 메시지, DB 스키마(V2.6).
- 제외: Kafka 경로([계획 0031](0031-realtime-kafka-transition.md))는 이 계획 뒤에 같은 형식으로 맞춘다. 학습된 모델 연결.

## 정한 것 (2026-10-29, BE)

| # | 내용 | 근거 |
| --- | --- | --- |
| 1 | 묶는 곳은 Spring API. 앱은 지금처럼 프레임마다 보낸다 | BE 10/27 답(BE-8), FE 변경 없이 가능 |
| 2 | 묶는 주기만 서버 시계 3초. 프레임 길이·`valid_ms`·3초 규칙은 `t_ms` | 도착 시각에는 네트워크 지연이 섞인다(연동 명세 5.1) |
| 3 | 판정 단위는 프레임마다(B안). 추론 서버에 프레임을 통째로 넘긴다 | 평균이 판정을 흐린다(BE-8 10/27 팀장 결정 이유) |
| 4 | 프레임을 받는 곳은 FastAPI 추론 서버(`model/inference`). 시간 판정은 계속 API 엔진(`engine/DecisionRules.java`) | ADR 0020, backend/AGENTS.md |
| 5 | 판별 가능한 프레임 시간만 `valid_ms`에 더한다 | BE-5 ② 보류를 닫음 |
| 6 | `observation`은 묶음마다 1개(A안, 10/30) | 앱은 마지막 `observation` 하나로 화면을 그리므로 프레임마다 보내도 같은 화면 |
| 7 | `observation`에서 `model_version`을 뺀다(10/30) | DB에 저장하지 않고(T-32 V2.0 폐기), 앱은 기록 비교 경고에만 쓰는데 지난 기록은 서버가 지금 설정값으로 채워 경고가 의미 없다. 추론 응답 검증(`InferenceClient`)에는 계속 쓴다 |
| 8 | `observation` 형식 번호만 3.0 → 4.0으로 올린다. 계약 파일은 `realtime-ws.v2.schema.json` 그대로 고치고 `realtime-ws.v3`를 새로 만들지 않는다(10/30, A안) | 필드를 빼거나 더하면 호환성이 깨진다(스키마가 모르는 필드를 거부, 앱 `validObservation`). FE·BE가 함께 바꾸고 옛 앱을 따로 지원하지 않으므로 [계약 안내](../../../contracts/README.md) 48행의 「새 계약 파일」 대신 번호만 올린다. 접속 주소 `/v2/realtime`과 좌표 구간 `posture.frames.v1`은 그대로 |
| 9 | `observation` 4.0은 필드 4개: `valid`·`posture`·`collapse_probability`·`invalid_reason`(10/30, 아래 예시). `sequence`·`start_ms`·`end_ms`·`phase`·`valid_ms`·`deviation_type`·`model_version`은 뺀다. `bad_ms`는 넣지 않는다 | 앱이 측정 중 화면에 쓰는 값만 남긴다. 처리 위치는 `ack`·`progress`의 `last_sequence`, 상태는 `progress.paused_reason`, 누적 시간은 `summary`에 있다. 모델은 이탈 확률 하나를 내고 서버가 좋음/나쁨으로 나누므로(ADR 0043 3클래스, ADR 0045) 이탈 종류는 모델 출력에 없다 |
| 10 | `posture`·`collapse_probability`는 묶음의 **마지막 판정 가능 프레임** 값(10/30) | 화면은 「지금 자세」를 보인다. 평균은 판정을 흐린다(3번). 판정 가능 프레임이 없으면 `valid:false` |
| 11 | `ack`는 받은 즉시, `observation`·`decision`·`alert`·`progress`는 묶음 처리 뒤(10/30) | 앱은 `ack`를 표시에만 쓴다. 판정 결과는 묶음 단위로만 생긴다 |
| 12 | 추론은 새 경로 `POST /v3/infer`. 요청에 세션 기준 자세 9관절 `[x, y]`를 함께 넣어 추론 서버는 상태 없이 둔다. `/v2/infer`는 Kafka 경로·비교 시험이 옮길 때까지 남긴다(10/30) | 추론 서버를 여러 대로 늘리거나 재시작해도 세션 상태를 잃지 않는다 |
| 13 | 특징 계산은 추론 서버(`model/inference/frames.py`)로 옮긴다. API의 `FrameFeatures.java`는 hello의 기준 자세 확인과 같은 규칙의 Java 기준값으로 남긴다(10/30) | 두 구현을 같은 합성 사례(`reference-rule-cases.json`)로 시험해 값이 갈라지지 않게 한다 |
| 14 | 프레임 하나는 찍힌 시각부터 다음 프레임까지(구간의 첫 프레임은 구간 시작부터), **최대 0.5초**. 넘는 부분과 판정 불가 프레임은 제외(`unknown_ms`)이고 연속 시간을 끊는다(10/30) | 앱이 새 프레임 없이 구간을 닫는 길이와 같다. 구간 단위일 때의 중단 후 초기화 정책과 같다 |
| 15 | 3초를 기다리지 않고 넘기는 때: `rest`·`away` 구간, `end`(S3 포함), 연결 끊김, 자정 넘김, 프레임 210장 초과. 측정불가 시간 초과는 묶음 처리 중 그 구간에서 끝내고 남은 구간은 버린다(10/30) | 자정 넘김은 넘기기 전에 묶음을 비우므로 묶음이 두 세션에 걸치지 않는다 |
| 16 | 추론 연결·응답 오류는 한 번 다시 부르고, 그래도 실패하면 그 묶음은 버리고(누락) `stalled`. 계약과 맞지 않는 응답은 다시 부르지 않는다(10/30) | 지금처럼 다시 받지 않는다(앱은 재전송하지 않음) |
| 17 | 새 사건은 `decision`을 보내기 전에 DB에 쓴다. DB가 실패해도 결과는 보내고 `stalled`, 다음 처리 때 다시 쓴다(10/30) | 예전에는 DB에 쓴 뒤에 오는 `ack`가 「저장됨」 신호였는데 `ack`가 판정보다 먼저 가게 됐다 |
| 18 | 알림이 최대 3초 늦는 것을 받아들이고 팀장·FE에 알린다(10/30 BE, FE 공지) | 묶음의 대가. 설정 `batch-window`로 줄일 수 있다 |

`observation` 4.0 (10/30 확정):

```json
{"type": "observation", "observation": {
  "schema_version": "4.0",
  "valid": true,
  "posture": "bad",
  "collapse_probability": 0.92,
  "invalid_reason": null
}}
```

| 필드 | 값 |
| --- | --- |
| `valid` | 묶음에 판정 가능 프레임이 하나라도 있으면 `true` |
| `posture` | `good`·`bad`, `valid:false`면 `null`. 서버가 세션 정책 `threshold`를 적용한 그 순간의 판정이며 알림 확정(3초)은 계속 `decision`·`alert` |
| `collapse_probability` | 나쁨일 확률 0~1, 앱 점수 = 100 × (1 − 값). `valid:false`면 0 |
| `invalid_reason` | `valid`면 `null`, 아니면 `unmeasurable`·`head_turn` |

## 남은 질문

- **FE와 함께 배포:** FE는 `messages.ts`의 `LiveObservation`·`validObservation`, `useSessionPersistence.ts`의 `model_version`, `lib/comparison.ts`의 버전 경고를 고쳐야 한다. 서버만 먼저 바꾸면 앱이 `observation`을 버린다 — FE와 함께 배포.
- **`decision`·`alert`의 `deviation_type` — 보류(10/30 BE):** 학습 모델(3클래스)로 바뀔 때 **완전히 뺀다(B안, ADR 0045 5절)**. 모델을 언제 바꿀지 정해지지 않아 이 계획에서는 구현하지 않고, 그때까지 지금처럼 규칙 모델의 종류(`left_lean`·`right_lean`·`unspecified` 등)를 그대로 보낸다. 뺄 때 함께 바꿀 것: 계약 `realtime-ws.v2`의 `decision.event`·`alert`, 서버 `EpisodeLedger`·`RealtimeMessages`·`RecordProjection`(기록 `type`), 앱 `messages.ts` `validDecision`·`events.ts`·`server/projection.ts`·`storage/validation.ts`(기록 `type` 검사), S4 `SessionView` 사건. `observation` 4.0에서 빼는 것(9번)은 이와 별개로 이 계획에서 한다.
- **자세 모델:** ML이 3클래스(기준·이탈·스트레칭, `collapse_probability = p(이탈)`)로 정했다([ADR 0043](../../decisions/0043-base-deviation-stretch-collection.md)). 서비스 쪽은 [ADR 0045](../../decisions/0045-posture-from-three-class-model.md)(채택 10/30 BE): `posture`는 `good`·`bad`. ML 확인에 따라 바뀔 수 있다.
- **짧은 가림 유지 규칙(ML 요청):** 얼굴만 판정 불가일 때 2초까지 직전 값 유지·타이머 정지([ML 재설계](../../ml/rebuild-plan.md#짧은-가림-유지-규칙-2026-10-29-사용자-결정-be-구현-요청)). BE 검토 중(10/30). 받으면 엔진(`SessionEngine`)과 `observation`의 판정 불가 표시가 바뀐다. 스트레칭 중 시간 규칙도 미정(ADR 0043).
- 10/30 `contracts/README.md` 「모델명·특징 버전의 내부 관리」에 `observation` 4.0의 `model_version` 제외를 적었다(7번).
- **팀 확인:** 알림 지연(18번)과 `posture` 이름(`good`·`bad`)은 BE가 정했고(ADR 0045) 알림 지연은 팀장·FE 확인 전이다.
- **Kafka 경로:** 계획 0031의 `ws` → Kafka 경로는 아직 구간 하나·1500ms 형식이다. 같은 묶음 방식으로 맞출지 계획 0031 담당과 정한다.
- **정리할 코드:** v2 추론 호출(`InferenceClient.infer(InferenceRequest)`)·`FrameFeatures.interval`(구간 평균)은 실시간에서 쓰지 않는다. Kafka 경로·비교 시험이 옮기면 지운다.

## 작업 단계

- [x] 관련 문서와 현재 구현 확인(10/29: `RealtimeHandlerV2`·`SessionService.frames`·`FrameFeatures.interval`·`Timeline.addMeasured`·`model/inference/routes.py`)
- [x] 남은 질문 중 `observation`·`ack`·추론 API 형식을 정하고 이 문서에 기록(10/30, 6~18번)
- [x] 새 추론 계약(`contracts/inference-request.v3`·`inference-response.v3`)과 합성 예시(`contracts/examples/v3/`, 응답은 실제 추론 출력)
- [x] `model/inference`: `POST /v3/infer`(`frames.py`·`service.predict_frames`), 합성 기준값과 같은지 비교 시험(`tests/test_inference_v3.py`)
- [x] `backend/api`: 세션별 묶음(`LiveSession`)·서버 시계 3초(`batch-window`)·200ms 스케줄러·즉시 넘기는 때, 프레임 조각(`FrameBatch`)을 엔진에(`SessionEngine.accept(List)`), `observation` 4.0, `stalled` 이벤트
- [x] 문서 동기화(BE 문서): API 명세 9·11장·변경 이력, ADR 0020 3절, 계약 안내, backend README, 백엔드 개발 상태. FE 문서는 FE 공지로
- [x] `make check-backend`(단위 → 실제 MySQL → HTTP smoke)와 추론 시험, 결과 기록
- [ ] 커밋·PR, FE 수정과 함께 develop에 합치기

## 결정과 진행 기록

- 2026-10-29: 위 「정한 것」 1~5 확정(BE). 지금 API 명세에는 좌표 프레임을 추론 서버로 넘기는 API가 없다 — `/v2/realtime`은 구간 1개·1500ms·30장 제한, `/v2/infer`는 구간당 특징 1개만 받는다.
- 2026-10-30: 6~18번 확정(BE), 구현. 브랜치 `feature/repo-server-frame-batch-inference`. 첫 MySQL 통합 시험에서 `decision`을 받은 직후 DB를 읽으면 아직 저장 전인 경우를 찾아 17번으로 고쳤다.
- 2026-10-30: develop(`66a780c`, PR #83)을 합쳤다. ML ADR 0043(3클래스)과 번호가 겹쳐 BE 모델 출력 ADR을 0045로 옮기고 3클래스에 맞췄다. `posture`는 `good`·`bad`로 확정(BE).

## 검증 결과와 남은 한계

2026-10-30, 이 PC(Windows, JDK 17, Python 3.12 `.venv`, 로컬 MySQL80 일회용 DB):

- `python tools/dev.py check-backend`: 통과. Gradle 빌드(API·처리 서비스) → `-Pmysql-integration`(API 99개 중 `MySqlIntegrationTest` 11개 포함 실패 0·건너뜀 0, 처리 서비스 62개) → `tools/service_smoke.py` 8단계 PASS(실제 FastAPI `/v3/infer`, 기본 3초 묶음, 3초 확정·6초 회복).
- 새·바뀐 시험: `FrameBatchTest` 5개, `SessionServiceTest` 새 5개, `SessionEngineTest` 새 2개, `InferenceClientTest` 새 3개, `RealtimeHandlerV2Test`(ack 즉시·묶음 뒤 progress·`stalled` 이벤트·자정 뒤 `t_ms` 이동), MySQL 통합 시험(3초 전에 판정하지 않음, 4.0 필드).
- Python `unittest discover -s tests`: 163개 중 159 통과, 건너뜀 1, 오류 3 — 오류는 `test_deploy_configuration` 3개로 이 PC에 Docker CLI가 없어서다(이 변경과 무관). 새 `tests/test_inference_v3.py` 7개(합성 기준값 17사례 포함)와 `test_realtime_ws_v2.py`의 4.0 시험 통과.
- `python tools/dev.py check-repo`: 통과.
- 하지 않은 것: 앱(FE)과 함께 돌려 보기(FE 수정 전이라 앱은 4.0 `observation`을 버린다), `make check-frontend`·`check-browser`(FE를 바꾸지 않음), Compose·서버 PC, Kafka 경로, 실제 사람·카메라 자료.
- 남은 한계: 알림·점수 표시가 최대 3초 늦다. 묶음 하나의 추론이 실패하면 최대 3초가 누락이다. API 명세 11.5의 「실제」 메시지 블록은 계획 0064 전 실행 값이다(새 순서는 그 앞 안내에 적음).
