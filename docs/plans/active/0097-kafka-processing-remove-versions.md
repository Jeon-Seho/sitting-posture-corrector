# Kafka·처리 서비스 이름에서 버전 빼기 (ADR 0049 후속)

- 상태: in_progress (코드·문서 끝, 서버 전환 전)
- 담당: 계획·코드 Kimyoujin(DB/BE). 검토: 처리 서비스·Kafka 명세 DevOps/BE 홍규, io-api kafka 모드 PM
- 시작일: 2026-11-18 (계획 2026-11-16)
- 관련 요구사항/ADR: [ADR 0049](../../decisions/0049-no-version-in-names.md), [Kafka 명세](../../design/kafka-spec.md),
  [처리 서비스 HTTP API](../../design/processing-api-spec.md), [계획 0031](0031-realtime-kafka-transition.md)(Kafka 전환, D-57)
- 브랜치: `refactor/repo-remove-api-version-paths` (주소 `/v2` 삭제와 같은 PR)

## 문제와 완료 기준

앱이 부르는 주소의 `/v2`는 지웠지만 Kafka와 처리 서비스에는 버전 붙은 이름이 남아 있었다(토픽 `posture.*.v1`, 그룹 `judge-v1` 등,
처리 서비스 주소 `/api/v1/…`·`/judge/v1/…`). `kafka-spec.md` 7장은 「호환되지 않는 변경은 새 토픽 버전으로」라고 적어 ADR 0049와 어긋났다.

완료 기준:

- 토픽, 컨슈머 그룹, 처리 서비스 주소, Redis 키, HDFS 경로, 클래스, 환경변수, Kafka 계약 파일 이름에 버전 번호가 없다(아래 「제외」 빼고).
- `kafka-spec.md`의 바꾸는 법이 ADR 0049와 같다.
- 처리 서비스·Kafka 추론·io-api kafka 모드·계약·J1 시험이 통과한다.
- 서버에서 `integration_test.sh`의 Kafka 단계(2·8·9·11·12·17)가 새 이름으로 통과하고, 옛 토픽·그룹·HDFS 임시 폴더를 정리했다.

## 범위와 제외

| 대상 | 옛 이름 | 새 이름 |
|---|---|---|
| 토픽 | `posture.{features,inference,episodes,alerts,stored,keypoints}.v1` | `posture.{…}` (`posture.dlq` 그대로) |
| 컨슈머 그룹 | `judge-v1`·`report-store-v1`·`inference-service-v1` | `judge`·`report-store`·`inference-service` |
| 처리 서비스 주소 | `POST /api/v1/realtime/features`, `GET /judge/v1/status`·`/judge/v1/sessions/{id}` | `POST /api/realtime/features`, `GET /judge/status`·`/judge/sessions/{id}` |
| Redis | `posture:v1:judge:{id}` | `posture:judge:{id}` |
| HDFS | `/data/staging/{realtime,keypoints}-v1`, `/data/checkpoints/j1-{realtime,keypoints}-v1` | 뒤의 `-v1`을 뺌 |
| 설정·환경변수 | `app.kafka.topic.posture-*-v1`, `POSTURE_*_V1_TOPIC`, `KAFKA_TOPIC_POSTURE_*_V1`, `KAFKA_V1_CONSUMER_GROUP_ID`, `REALTIME_V1_ENABLED` | `-v1`·`_V1` 뺌 |
| 처리 서비스 클래스 | `V1SessionJudge`·`V1JudgeRegistry`·`V1JudgeStore`·`RedisV1JudgeStore`·`V1Observation`·`V1Policy`와 시험 4개 | `SessionJudge`·`JudgeRegistry`·`JudgeStore`·`RedisJudgeStore`·`JudgeObservation`·`JudgePolicy` |
| Kafka 추론 상수 | `FEATURES_V1_TOPIC`·`INFERENCE_V1_TOPIC`·`V1_CONSUMER_GROUP_ID`, 스레드 `realtime-v1-consumer` | `_V1` 뺌, `realtime-consumer` |
| 도구 | `replay_realtime_v1.py`·`replay_keypoints_v1.py` | `replay_realtime.py`·`replay_keypoints.py` |
| 계약 파일 | `kafka-*.v1.schema.json`, `parity/*-cases.v1.json`, `inference-request.v2`·`posture-observation.v2`·`posture-event.v1`·`session-view.v1`(`.schema.json`), `contracts/examples/v2/`, `tests/test_inference_v2.py` | 버전 뺌, 예시 폴더는 `contracts/examples/inference/`, 시험은 `tests/test_inference.py` |
| WebSocket·REST 계약 이름 (11/18 추가, 보류 계획 범위 2-1) | `realtime-ws.v2.schema.json`, `realtime/examples-v2/`, `frames/posture-frames.v1.schema.json`(이름 `posture.frames.v1`), `accounts.v2.md`, `consent-documents.v2.md`, `RealtimeHandlerV2`(시험 `helloV2`·`endV2`), `tests/test_realtime_ws_v2.py` | `realtime-ws.schema.json`, `realtime/examples-ws/`, `posture-frames.schema.json`(`posture.frames`), `accounts.md`, `consent-documents.md`, `RealtimeHandler`(`helloMessage`·`endMessage`), `tests/test_realtime_ws.py` |
| 지운 옛 계약 (11/18 추가) | `accounts.v1.md`, `feature-response.v1.schema.json`과 그 예시 `synthetic-feature-response.json` | 지움([지운 문서 기록](../../removed-docs.md) 16절) |

제외(바꾸지 않음):

| 대상 | 이유 |
|---|---|
| 메시지 안 `schema_version`·`feature_version`·`model_version` | 형식 변경이라 따로 한다(보류, 결정 2) |
| 메시지 형식 버전에 묶인 코드 이름 `RealtimeMessages.V2`, `Observation.V4` | `schema_version` `"2.0"`·`"4.0"` 값과 짝이라 메시지 버전 필드를 뺄 때 함께 한다 |
| 모델·특징 이름 값(`reference-feature-rule-v1` 등), DB 스키마 버전, 배포 목록 `posegood-images-v1`, 연구 수집 형식(`posture-collection-v1` 등), 저장된 파일 형식 계약(`normal-posture-collection.v1.md` 등 7개) | ADR 0049 예외 |
| `posture-status.v1` 계약 | 옛 상태 출력 계약. 쓰는 곳을 확인하고 지울지 따로 정한다 |
| 완료 계획·결정·감사 기록, `architecture_v5.4_change_notes.md`, 명세의 날짜 변경 이력 줄 | 기록이라 옛 이름 그대로. 파일 링크만 새 경로로 고침 |

## 작업 단계

- [x] 결정할 것 정하기(아래 결정 1~5)
- [x] 처리 서비스: 토픽·그룹·주소·Redis 키·클래스·설정·로그 문구
- [x] Kafka 추론(`backend/inference`): 토픽·그룹·상수·환경변수
- [x] io-api kafka 모드: 토픽 설정(`application.properties`)·시험
- [x] J1: 토픽·HDFS 경로, `tests/test_batch_j1_hdfs_archive.py`
- [x] 계약·예시·비교 시험 데이터 이름과 계약 시험
- [x] 점검 도구: `integration_test.sh`(옛 D-38 이름 안내에서 `posture.inference`·`inference-service` 빼고 `.v1` 잔여 안내 추가), `replay_*`, `comm_test_guided.py`
- [x] 문서: `kafka-spec.md`(머리말·7장), `processing-api-spec.md`, `infra/README.md`(서버 전환 절차), 계약 안내, `bigdata/README.md`, ADR 0049 결과
- [x] 로컬 검증
- [ ] 서버 전환(운영 kafka 모드를 켜기 전, `infra/README.md` 「Kafka 이름에서 버전 빼기」)
- [ ] 며칠 뒤 옛 토픽·그룹·HDFS 폴더 정리

## 결정과 진행 기록

- 2026-11-16: 계획(저장소 밖 메모). D-57(kafka 모드)이 같은 파일을 크게 고치므로 그 병합 뒤에 하기로 함.
- 2026-11-18: D-57이 #134로 develop에 들어옴. 김유진 결정:
  1. 새 토픽 이름은 `posture.inference`를 다시 쓴다. 옛 D-38 토픽·그룹(`posture.inference`·`inference-service`)이 서버에 남아 있으면 배포 전에 지운다.
  2. 메시지 버전 필드는 이번에 빼지 않는다(이름만).
  3. 별도 PR이 아니라 `/v2` 주소 삭제 브랜치에서 같이 하고 한 PR로 올린다(서버·앱 배포를 같은 날 하므로 서버 전환도 함께).
  4. WebSocket 계약 이름은 이번에 하지 않는다.
  5. 시험용 입구는 `/api/realtime/features`(버전만 뺌). 처리 서비스는 서버 안(`api-server:8080`)에만 열려 io-api의 `/api/realtime`과 겹치지 않는다.
- 공유 계약 예시 폴더 `contracts/examples/v2/`는 `/infer` 요청·응답과 관측 예시라 `contracts/examples/inference/`로 옮겼다.
- 옛 D-53 그룹 변경 절차(`api-server-cep-v1` → `judge-v1`)는 끝난 작업의 기록이라 옛 이름으로 남겼다.
- 2026-11-18(같은 날 뒤): 결정 4를 바꿔, 메시지 버전 필드 보류 계획에 묶여 있던 **범위 2-1(WebSocket·REST 계약 파일 이름)**도 이 PR에 넣었다(김유진).
  이름만 바꾸고 주고받는 형식(`schema_version` 값 포함)은 그대로다. `posture.frames.v1`·`realtime-ws.v2`는 메시지 값이 아니라 계약 이름이라 앱 동작은 바뀌지 않는다.
  더 쓰지 않는 `accounts.v1.md`·`feature-response.v1`(과 예시)은 이름을 바꾸지 않고 지웠다.

## 검증 결과와 남은 한계

로컬 검증(2026-11-18, develop `ed72615` 병합 위):

- `python tools/dev.py check-backend`: 통과. api 156(건너뜀 18), processing 67(이름 바꾼 `JudgeRegistryTest`·`JudgeRestoreTest`·`SessionJudgeParityTest`·`SessionJudgeTest` 포함).
- `backend/gradlew -p backend :api:test :processing:test -Pmysql-integration`(로컬 MySQL): api 156 중 155 통과. 실패 1개
  `MySqlIntegrationTest.baselinesOwnershipLossAndInferenceFailure`(두 번째 세션 409)는 develop 원본에서도 같다(#127 측정 한 기기 제한과 기존 시험이 어긋남, 이 계획 밖).
  kafka 모드 시험 `KafkaPipelineTest`·`KafkaResultsTest`와 `SessionEngineParityTest`(공용 `judge-cases.json`) 통과.
- Kafka 추론 `backend/inference/tests`: Python 3.11(서비스 이미지와 같음) 임시 환경에 `requirements*.txt` 설치, 17 통과.
  (이 PC의 Python 3.12에서는 `kafka-python 2.0.2`가 불러오기에서 실패한다 — 이번 변경과 무관.)
- Python `unittest discover -s tests`: 241 중 실패 1(전부터 실패하던 `test_model_live_comparison` 브라우저 카메라 시험), 건너뜀 15.
  계약·비교·J1·통신 도구·추론 시험(`test_realtime_contracts`·`test_realtime_parity`·`test_batch_j1_hdfs_archive`·`test_comm_test_guided`·`test_inference`·
  `test_inference_internal_auth`·`test_realtime_ws_v2`) 67 통과, J1 Spark 시험 8개는 pyspark가 없어 건너뜀.
- 이름 바꾼 파일을 가리키는 Markdown 링크: 깨진 것 0.
- 옛 이름 검색: 기록 문서·날짜 변경 이력·옛 이름 대조표와 점검 도구의 「옛 이름 남음」 안내 말고 0.

범위 2-1(WebSocket·REST 계약 이름)을 더한 뒤 다시 검증(2026-11-18):

- `check-backend` 통과, MySQL 포함 api 156 중 155·processing 67 통과(실패 1은 위와 같은 develop 문제). 이름 바꾼 `RealtimeHandlerTest` 포함.
- 앱 `check-frontend`: 1039 중 1036. `/dev` 시험 2개(`DeveloperRoute`·`useObservationComparison`)는 서버 검사와 동시에 돌아 5초 시간 초과였고 따로 돌리면 48개 모두 통과.
  남은 1개는 이 PC Node ICU의 `recordTimezone`(`오전` 대신 `AM`). `npm run build` 통과. 앱 소스는 주석·시험 설명만 바뀜.
- Python 241 중 실패 1(전부터 실패하던 브라우저 카메라 시험), 계약 시험 `test_realtime_ws`·`test_realtime_contracts`·`test_frame_contract` 통과. Kafka 추론 17 통과.
- 바꾸거나 지운 파일을 가리키는 Markdown 링크: 깨진 것 0(지운 계약을 가리키던 링크는 `docs/removed-docs.md`로).

아직 하지 않은 검증:

- 서버 `integration_test.sh`(Kafka·Redis·HDFS·Spark가 있는 서버에서만). 전환 때 2·8·9·11·12·17단계를 새 이름으로 확인한다.
- J1 Spark 시험(pyspark 필요)과 앱 검사(앱 코드는 바뀌지 않음).
