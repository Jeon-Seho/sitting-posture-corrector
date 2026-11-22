# 실시간 메시지 평탄화와 단일 프레임 처리 단순화

- 상태: in_progress (서버 구현·develop 통합·목적별 커밋 완료, FE 최종 인계·공동 확인 대기)
- 담당: Jeon-Seho(서버·공유 계약·적재·관련 시험), FE 구현·배포는 프론트엔드 담당자
- 시작일: 2026-11-18
- 통합 기준: origin/develop `1794cf5f`
- 작업 브랜치: `feature/repo-realtime-message-simplification`
- 관련 요구사항/ADR: [FE 제안서](../../design/fe/fe-server-proposal.md) 요구 4(BE-19)·5(BE-20),
  [Kafka 전환 계획 0031](0031-realtime-kafka-transition.md),
  [ADR 0021](../../decisions/0021-app-sends-information-server-judges.md),
  [연결 종료 ADR](../../decisions/0024-session-ends-on-lost-connection.md), [품질 기준](../../quality.md)

## 문제와 완료 기준

작업 시작 시 앱은 관측마다 구간을 닫아 보통 한 프레임을 보냈지만, WS의 `items[]`·`frames[]`와
서버의 특징 평균·미사용 `ack`·목업 품질·위치·고개 돌림 제외·visibility 0.65 하한이 남아 있었다.
단일 프레임을 직접 계산하고 FE가 측정 불가를 전달하도록 단순화한다. 서버 구현과 주요 검증은 완료했고,
사용자 검토·승인과 목적별 커밋 구성을 마쳤으며, FE 최종 인계·실제 신형 FE 공동 확인이 남아 있다.

호환성은 현재 앱의 측정·휴식·복귀·종료·기록 조회가 전환 중에도 이어지는 것으로 검증한다.
구형 배열 형식 지원과 여러 프레임 평균은 별개다. 평균 제거를 구형 지원 종료까지 미루지 않는다.

완료 기준은 다음과 같다.

1. 구형 앱은 기존 hello와 배열 형식으로 계속 측정하고, 서버가 신형 평탄화 입력도 받는다.
   신형 hello는 schema_version 없이 받고, features의 items 유무로 형식을 구분한다.
   신형은 합성 클라이언트로 검증하고 실제 FE 전환은 담당자에게 인계한다.
2. WS ack 없이 관측·시간·사건·알림·종료·S4·R1이 동작한다. Kafka 브로커 저장 확인과 내부 지연 감지는 보존한다.
3. 측정 특징 평균을 제거한다. 기존 필터를 통과하던 단일 프레임은 같은 기준 좌표에서 기존 특징값과 규칙 점수를 낸다.
4. 서버 목업 품질·위치·고개 돌림 필터와 두 규칙 추론의 0.65 하한을 제거한다. 고개를 돌려도 일반 자세로 채점한다.
   FE 측정 불가·빈 관측·rest·away는 유효 시간에서 제외하고 연속 판정을 끊는다.
5. 새 좌표 적재 계약에서 단일 프레임·관절 순서·null·관측 시각 유무·순번·구간 경계를 보존한다.
   생산자부터 적재·재생 도구까지 같은 평탄화 계약을 사용한다.
6. 계약·회귀 시험, 전체 게이트, 명시적 MySQL·Kafka 연결 시험을 검증 범위별로 기록한다.

## 범위와 제외

### 변경 범위

| 경계 | 검토·변경 대상 |
|---|---|
| WS 서버 | RealtimeHandler, RealtimeMessages, 버전 없는 hello와 형태에 따른 신구형 파싱 |
| 특징 계산 | FrameInterval, FrameFeatures, SessionService, LocalPipeline, KafkaPipeline |
| Kafka 결과 | KafkaResults의 head_turn 힌트 전달과 관련 생성·설정 코드 |
| 규칙 추론 | model/inference/service.py, backend/inference/app/realtime.py의 0.65 하한 |
| 계약 | 신구형 WS 스키마·합성 예시, 단일 프레임 본문, 기존 좌표 적재 계약의 평탄화 |
| 적재·도구 | KafkaPipeline 좌표 발행·재생 도구·적재 시험. J1·compose·토픽 설정은 develop 구현 유지 |
| 검증·문서 | 서버·공유 계약·적재 시험, BE API 명세, 계약 README, backend-status, 근거 ADR, FE 인계 내용 |

### 프론트엔드 담당자에게 인계할 범위

FE 앱 코드와 FE 테스트의 구현·수정은 프론트엔드 담당자가 수행한다. 이번 브랜치에서는 기존 FE를 읽고
호환성을 검증하며, 새 계약·합성 예시·필요한 변경점과 회귀 기준을 인계한다.
frames.ts·LiveSession.ts·messages.ts·측정 화면·카메라 연결, FE 명세 갱신과 배포가 인계 대상이다.
공유 WS 계약 변경은 서버 수신 규칙과 함께 작성하고 FE 담당자와 전환 전에 맞춘다.

### 이번 작업의 경계

- 내부 posture.features의 특징 입력과 추론 요청·결과 구조는 유지한다. WS를 기존 계산·전달 경로에
  연결하는 변환만 수행한다. 좌표 적재 계약은 새 단일 프레임 구조로 개정한다.
- 장기적으로 모든 계약에서 schema_version을 제거하는 방향에 합의했다. 이번에는 신형 WS 입력의
  버전 필드를 제거하고, observation·B1·B2·S4·R1·W1 등 응답 전체의 삭제는 후속 작업으로 둔다.
  develop FE의 응답 버전 검사는 제거됐지만, 서버 응답·추론·Kafka 봉투 필드 삭제는 이번 범위에 추가하지 않는다.
- 연구 모델 연결과 연구 전처리의 품질·고개 돌림 규칙은 실제 모델 연결 단계에서 검증한다.
- local 경로 삭제와 운영 Kafka 전환은 계획 0031에서 관리한다. 이번 변경은 존재하는 두 경로에 적용한다.
- local 저장 전 closed, 24시간 상한 응답, 자정 직후 FE 표시 등 조사 중 발견한 별도 문제는 후속으로 둔다.
- 자세 등록 B1의 기준 좌표 평균, 점수 공식, 세션 확정·회복·재알림 정책은 이번 단순화와 구분한다.
- FE 제안서·다른 담당자의 계획 재작성과 계획 파일 명명 규칙 변경은 포함하지 않는다.

## 계약과 호환성 설계

### 신형 features

다음은 명시적인 합성 좌표 예시다.

```json
{
  "type": "features",
  "sequence": 42,
  "start_ms": 21000,
  "end_ms": 21100,
  "phase": "running",
  "t_ms": 21012,
  "p": [[0.51, 0.40, 0.99], [0.53, 0.37, 0.98], [0.49, 0.37, 0.98], [0.56, 0.39, 0.91], [0.46, 0.39, 0.90], [0.52, 0.44, 0.97], [0.50, 0.44, 0.97], [0.66, 0.62, 0.95], [0.36, 0.62, 0.96]]
}
```

| phase | 의미 | t_ms | p |
|---|---|---|---|
| running | 양 어깨가 보이고 전송할 9점 좌표가 모두 있는 관측 | 필수 | 9점의 `[x, y, visibility]` |
| unmeasurable | 키포인트 감지 실패 또는 새 관측 없는 구간 | 관측 있을 때만 필수 | 필수, null |
| rest | 사용자가 누른 쉬기 | 생략 | 생략 |
| away | 기존 입력 지연·카메라 이탈에 따른 중단 | 생략 | 생략 |

- 측정 불가는 p: null로 통일하고 빈 배열은 추가하지 않는다. 관측이 없으면 임의의 t_ms를 만들지 않는다.
- 모든 phase에서 sequence·start_ms·end_ms를 보낸다. 시간축·단위·구간 경계·관절 순서는 현행을 따른다.
- FE는 양 어깨의 visibility 0.65 이상·화면 안 x/y 0.02~0.98을 확인한다. 얼굴 점은 visibility가 낮아도
  좌표가 있으면 보낸다. 9점 중 좌표 자체가 빠졌거나 사람이 없으면 측정 불가로 보낸다.
  이 검사는 FE 담당 범위이며 서버에 품질 하한을 다시 추가하지 않는다.
- 새 본문에서 입력 valid·items·frames·프레임별 버전 필드를 제거한다. 신형 hello에도 schema_version을 넣지 않는다.
- 신형에서 관측이 있는 t_ms는 start_ms 이상 end_ms 미만이다. 같은 시각은 나중 관측 한 장을 유지하고,
  이미 닫힌 구간보다 앞선 시각의 늦은 관측은 FE가 버린다. 서버의 구간 내 t_ms 검증은 신형 입력에 적용한다.
  구형은 기존에 t_ms가 구간 밖이어도 허용하므로 전환 기간에는 그 허용 범위를 유지한다.
- 출력 observation.valid·invalid_reason은 계속 사용한다. 측정 불가 구간에는 점수를 만들지 않는다.

### 버전과 세부 구현 결정

사용자 합의와 구현에서 선택한 세부 사항을 구분한다. 근거는 [ADR 0053](../../decisions/0053-realtime-flat-input-and-server-filter-removal.md)에 기록했다.

- 2026-11-19 사용자 결정으로 신형 hello의 schema_version을 제거한다. 구형 hello의 2.0 필드는
  호환 기간에 계속 허용한다. features는 items가 있으면 구형, 없으면 신형으로 파싱하며 두 형식을
  섞은 메시지와 알 수 없는 필드는 거절한다. ready 형태와 응답 버전 필드는 현재 값을 유지한다.
  URL·토픽·계약·클래스 이름은 develop의 버전 없는 이름을 유지한다(ADR 0049).
- 좌표 적재는 posture.keypoints 하나와 kafka-keypoints.schema.json을 사용한다. 본문은 단일 프레임
  공통 스키마이며 WS 전용 type은 포함하지 않는다. 봉투의 기존 schema_version은 유지한다.
  J1은 기존 구독·체크포인트·keypoints.jsonl을 유지하며 별도 메시지 구분·파일을 추가하지 않는다.
- 구형 WS로 여러 장이 들어오는 예외에는 배열 마지막 한 장을 채택했다. 평균은 계산하지 않는다.
  마지막이 p: null 또는 구형 valid: false이면 측정 불가로 처리하고 앞의 유효 프레임으로 바꾸지 않는다.
  이는 평균 제거 요청을 구체화한 구현 선택이며 별도 사용자 확정사항은 아니다. 서비스에서 여러 장을 의도적으로 보내는 경로는 확인되지 않았고,
  기존 스모크·합성 예시에는 여러 장이 있다. 실제 운영 트래픽에서 빈도를 측정한 결과는 없다.

### 호환 기간과 배포 순서

1. 구형 hello·배열 파싱을 유지한 서버에 버전 없는 hello·평탄화 입력을 추가한다. 기존 FE는 ack를 무시하므로
   서버 전송을 먼저 중단할 수 있다. FE의 구형 응답 해석도 전환 중 유지한다.
2. 구형 running의 p: null·valid: false·빈 frames와 신형 unmeasurable을 같은 측정 불가 의미로 정규화한다.
   내부 추론에는 기존 running·품질 poor·특징 null로 전달한다. 새 phase를 기존 내부 열거형에 그대로 넘기지 않는다.
   rest·away 시간 집계와 측정 불가 자동 종료는 기존 규칙을 유지한다.
3. 신구형으로 같은 단일 프레임을 보냈을 때 내부 특징 입력·관측·사건·요약이 같은지 합성 시험으로 비교한다.
4. 서버 지원과 합성 신형 통합 시험 확인 후 FE 담당자가 앱을 새 형식으로 바꾼다.
   서버 배포 전 신형 FE가 운영에 나가지 않도록 배포 순서를 인계한다.
5. 구형 서버로 되돌릴 때는 FE 담당자가 먼저 FE를 구형으로 되돌리고 신형 연결 종료를 확인한다.
   FE만 구형으로 되돌리는 경우 양쪽을 지원하는 서버로 측정할 수 있다.
6. FE 배포와 기존 연결 종료 확인 후 담당자 간에 구형 삭제 시점을 정한다. 신형 구현만으로 구형을 제거하지 않는다.

### 좌표 적재 전환

- 구형 WS 입력도 마지막 한 장의 평탄화 본문으로 정규화해 기존 posture.keypoints 토픽에 보낸다.
- 생산자·스키마·합성 예시·재생 도구·적재 시험을 함께 맞춘다. 적재 스위치 기본값·동의 범위와
  적재 실패에도 측정이 계속되는 동작을 유지한다.
- J1 구현과 기존 구독·체크포인트·임시 폴더·keypoints.jsonl을 유지한다. 본문 형태별 분기나 파일 분리는 추가하지 않는다.
- 이미 저장된 자료는 변환·삭제하지 않는다. 새 생산 본문은 신형 좌표를 구형 frames 배열로 되돌리지 않고 원문으로 적재한다.

## 작업 단계

### 1. 변경 전 기준과 계약

- [x] 현재 HEAD·작업 트리·관련 구현·시험을 조사한다.
- [x] 신구형 WS와 새 적재 합성 fixture, phase별 필수·금지 필드를 정의했다.
- [x] 단일 프레임 기존 수치 시험과 판정 시험을 보존하고 신구형 서비스 시퀀스의 관측·사건·종료 집계 동등성을 추가했다.
- [x] 신형 hello의 버전 제거와 응답 버전 제거의 후속 분리를 확인했다.
- [x] 구형 다중 프레임의 마지막 한 장 채택과 적재 계약 개정을 ADR 0053에 기록했다.

검증은 동일한 합성 단일 프레임과 감지 실패·관측 공백·휴식 시퀀스에 대한 기대값을 명시하는 것이다.

### 2. 서버 단순화와 양쪽 형식 지원

- [x] hello 두 형태와 items 유무에 따른 파싱, 공통 단일 프레임 처리를 구현했다.
  신형 t_ms 범위 검사는 연결 시간축에서 수행해 자정 이후 내부 시간축 변환과 섞이지 않게 한다.
- [x] 특징 평균, 품질 하한·화면 가장자리·최소 어깨 폭 기준, 고개 돌림 제외를 제거했다.
  특징 계산식과 기준 대비 변화량은 보존하고 형식·좌표 범위·유한성·나눗셈 가능 여부를 검증한다.
- [x] 기존 합성 등록 좌표의 기준 읽기·단일 프레임 특징 수치와 서비스 측정을 시험했다.
- [x] local·Kafka 규칙 추론의 0.65 하한을 제거했다. 내부 품질 필드 구조는 유지한다.
  FE 측정 불가에서 온 poor·특징 누락·비유한 값은 계속 점수를 만들지 않는다.
- [x] ack 전송·정의를 삭제하고 내부 접수 시각 갱신을 유지했다. Kafka head_turn 힌트 전달을 정리했다.

검증은 신구형 입력 동등성, 단일 프레임 수치 회귀, 잘못된 입력 거절, 지연 감지·저장 완료 대기의 보존이다.

### 3. 적재와 시험 도구

- [x] 단일 프레임 적재 스키마·예시·생산자·재생·시험을 동기화했다. J1 구현·설정은 develop과 동일하게 유지한다.
- [x] ws_realtime_smoke.py의 구간 내 5장을 1장으로 바꾸고 ack 대기를 해당 sequence의 observation 확인으로 바꿨다.
  같은 합성 좌표를 반복하던 구간의 길이와 phase를 보존해 확정·회복·요약 기대값을 유지하는지 확인한다.
- [x] local/Kafka·신형/구형 네 조합에서 합성 구간 167개와 관측을 대조하고, 사건·알림·제외 구간·종료 후 DB 조회를 확인했다.
  Kafka lag·DLQ·DB 저장 확인을 유지한다.
- [x] develop의 버전 없는 replay_keypoints.py에 평탄화 본문을 반영했다. 단일 토픽·파일의 적재 시험을 갱신하고
  comm_test_guided.py·integration_test.sh의 develop 변경을 보존했다.

검증은 평탄화 본문의 재생·적재 왕복과 기존 자료 보존, 적재 실패에도 측정 계속, 관측 순번 대조와 최종 저장 결과다.

### 4. FE 담당자에게 계약과 회귀 기준 인계

구현 전 업무 요청과 FE 회신 확인은 완료했다. 아래는 이번 서버 구현 결과를 바탕으로 최종 지원 시점·회귀 결과를 전달하고 공동 확인할 항목이다.

- [ ] 확정한 버전 없는 hello·phase별 필드·합성 예시·서버 지원 시점과 되돌리기 순서를 인계한다.
- [ ] FE 작업 항목으로 같은 시각의 여러 관측에서 한 장 유지, 필수 9점 누락·관측 공백의 unmeasurable 전송을 적는다.
  기존 어깨 감지·카메라 상태 처리와 가짜 0 좌표 방지 여부를 FE 담당자가 검증하도록 전달한다.
- [ ] FramePhase의 calibration 제거·새 phase 추가, UI running/paused와 전송 phase 구분을 전달한다.
- [ ] ack 수신 정리·head_turn 전용 표시와 FE 명세 갱신을 담당자 작업으로 전달한다.
- [ ] start→ready 전 대기→측정→rest/away→재개→end→저장 확인→R1 회귀 시나리오를 전달한다.

서버에서는 합성 신구형 입력으로 순번·시간 연속성과 공백의 t_ms 생략을 검증한다.
기존 FE 회귀 시험은 수정 없이 실행하고, 신형 FE의 화면·전송·알림 검증은 FE 담당자와 연동 확인 때 기록한다.

### 5. 통합 확인과 전환 완료

- [x] BE API 명세, 공유 계약 README, backend-status와 ADR을 변경 경계에 맞춰 갱신했다.
- [x] 기존 FE 회귀 시험·전체 게이트·명시적 MySQL·Kafka 시험과 합성 신구형 WS 네 조합을 검증했다.
  실제 신형 FE 브라우저 공동 확인은 아래 항목으로 구분한다.
- [x] 단일 토픽·단일 파일의 좌표 재생·적재 왕복과 기존 자료를 변환하지 않는 구현을 확인했다.
- [ ] FE 최종 인계 후 이번 서버 지원 작업의 완료 결과를 기록한다.
- [ ] FE 담당자의 신형 배포 후 실제 연동을 공동 확인한다. 구형 삭제의 담당·시점은 후속 항목으로 기록한다.

서버 지원 작업 완료와 전체 전환 완료를 구분한다. 실제 신형 FE 연동과 구형 삭제가 끝나기 전에는
계획 전체를 completed로 표시하지 않는다. FE 구현·배포를 이 브랜치에서 대신 수행하지 않는다.

## 기존 테스트 검토와 회귀 기준

| 기존 시험·진입점 | 바꿀 기대 | 유지·추가할 회귀 |
|---|---|---|
| FrameFeaturesTest | 평균, head_turn·낮은 품질·가장자리 제외 기대 | 단일 프레임 기존 수치, null, 0 어깨 폭, 비정상 좌표, 기존 기준 읽기 |
| RealtimeHandlerTest | ack 순서·개수와 새 파싱 | hello 인증·소유권, 신구형 측정, 잘못된 입력, 한도·중단·자정, 종료·로그아웃·서버 종료 |
| KafkaPipelineTest | head_turn 힌트·좌표 적재 본문 | 같은 세션 키, 시작→특징→종료, 순서·중복·겹침 거절, 발행 실패, 적재 무효·실패 |
| KafkaResultsTest | head_turn 사유 전달 | 관측4.0, 측정 불가 누적, stored 전후 두 순서, S4 종료 의미 |
| FE frames.test.ts (검토·인계, 수정은 FE 담당자) | 배열 출력 기대 | 9점 순서·반올림, 누락·null, 같은 시각, 0.5초 공백, rest/away 경계, end 직전 부분 구간 |
| FE LiveSession·messages·page 시험 (검토·인계, 수정은 FE 담당자) | 새 전송과 ack/head_turn 표시 | ready 대기, 오래된 관측, alert 순서, stalled 후 S4, 저장 지연, 관측3.0/4.0 호환, 기존 자정 처리 |
| test_realtime_ws.py와 신형 WS 시험 | 신구형 합성 예시 | 버전 없는/기존 hello, items 유무, 혼합 형식 거절, phase와 p/t_ms, 신형 t_ms 경계, 구형 valid, 출력 valid |
| test_realtime_contracts.py | 새 적재 계약 예시 | 특징 토픽의 좌표 혼입 거절, kind·session 일치, 단일 토픽의 평탄화 본문 |
| test_inference.py, backend/inference/tests/test_realtime.py와 양쪽 parity 시험 | 낮은 visibility도 유한 특징이면 채점 | 기존 정상 점수, poor/null/rest/away 무효, 비유한 값·DLQ |
| test_batch_j1_hdfs_archive.py, test_comm_test_guided.py | 새 적재·도구 출력 | 세션/순번 중복 제거, null 보존, 기존 파일 보존, 감시 토픽·오프셋 추적 |
| MySqlIntegrationTest와 실제 시험 WS | 신구형 입력 시나리오 | DB 종료 값·사건·알림·제외 시간, S4/R1 결과, 다른 사용자 접근 차단 |

기존 평균 기대 시험 intervalAveragesUsableFramesAndSkipsTheRest는 단일 프레임·구형 예외 채택 시험으로 대체한다.
headTurnAndUnmeasurableReasons와 framesAtTheEdgeOrTooNarrowAreUnusable은 합의한 채점·계산 불가 기준으로 갱신한다.
backend/inference의 test_low_quality_is_invalid는 0.65 미만도 채점하되 poor/null은 제외하는 시험으로 바꾼다.

기존 기대를 일괄 삭제하거나 출력값에 맞춰 시험을 느슨하게 만들지 않는다. 의도한 제외 규칙 변경과
보존할 단일 프레임 수치·연속 판정·저장 기대를 구분한다. 같은 합성 입력을 신구형 WS에서 비교한다.

## 검토 완료와 커밋 구성

사용자 검토·승인 후 origin/develop `1794cf5f` 위에 아래 목적별 커밋을 구성했다.
우리 변경은 `git diff origin/develop...HEAD`, 커밋 순서는 `git log --reverse origin/develop..HEAD`로 확인한다.
기존 보존 커밋과 승인 당시 파일 트리는 로컬 복구 태그로 보관하고 develop 이력은 변경하지 않았다.

| 커밋 순서 | 핵심 동작과 관련 파일 |
|---|---|
| 1. 특징·필터 | [특징 계산](../../../backend/api/src/main/java/org/posegood/api/session/FrameFeatures.java), [규칙 추론](../../../model/inference/service.py), [Kafka 추론](../../../backend/inference/app/realtime.py). 마지막 한 장 사용, 평균·목업 필터·visibility 하한 제거, 점수 공식과 계산 불가 제외 유지 |
| 2. WS 입력·ack | [수신기](../../../backend/api/src/main/java/org/posegood/api/realtime/RealtimeHandler.java), [구간 파서](../../../backend/api/src/main/java/org/posegood/api/contract/FrameInterval.java), [WS 계약](../../../contracts/realtime/realtime-ws.schema.json). 버전 없는 hello·평탄화/구형 입력 공존, ack 제거, 접수 지연 감지와 관련 시험 유지 |
| 3. 좌표 적재 | [생산자](../../../backend/api/src/main/java/org/posegood/api/realtime/KafkaPipeline.java), [계약](../../../contracts/realtime/kafka-keypoints.schema.json), [재생](../../../tools/platform/replay_keypoints.py), [적재 시험](../../../tests/test_batch_j1_hdfs_archive.py). 단일 토픽·단일 파일, J1 구현은 develop과 동일 |
| 4. 통합 시험 보정 | [MySQL 시험](../../../backend/api/src/test/java/org/posegood/api/it/MySqlIntegrationTest.java), 공용 ApiClient. 동시 측정 거절·종료 후 새 측정과 HTTP/1.1 시험 호환. 연구 UI 시험의 Windows 줄끝 처리도 포함 |
| 5. 문서 | [ADR 0053](../../decisions/0053-realtime-flat-input-and-server-filter-removal.md), 현재 계약·개발 상태·계획. 최신 본문과 과거 이력 분리, develop의 버전 없는 이름 보존 |

여러 단위에 걸친 파일은 변경 구간을 나누어 코드·시험 의존성을 유지한다.
승인된 최종 코드·계약·예시·시험 내용은 보존하며, FE·인프라·처리 서비스의 원격 합의를 유지한다.

## 검증 결과와 남은 한계

아래는 이번 문서 정리 전에 완료한 검증이다. 실행 경위·실패와 후속 해결 증거는 뒤의 기록에 보존한다.

| 범위 | 최종 결과 |
|---|---|
| 전체 기본 게이트 | Python 248건 중 233 통과·Spark 15 건너뜀, FE Vitest 1,051건·Node 8건·타입·빌드 통과 |
| 백엔드 기본·명시적 MySQL | 최종 JDK17 build -Pmysql-integration: API 167건(MySQL 19건 포함)·processing 67건 전부 통과, 실패·건너뜀 0. JDK21 Checkstyle·빌드 통과 |
| 별도 Kafka 추론·Spark 배치 | 각각 17건·42건 통과. Spark 시험의 건너뜀 0 |
| 실제 local/Kafka × 신형/구형 WS | 네 조합 74개 확인 항목 통과. 관측·사건·알림·저장·종료 후 동일 계정 재측정 확인, 좌표 334건·DLQ 0 |
| Kafka → Spark J1 → HDFS → MySQL | keypoints.jsonl 단일 파일, 세션별 167·169건과 archive 2행, 중복 제거·null·시각 생략·재실행 새 행 0 확인 |
| WS 예시 기본 위치·legacy 분리와 디렉터리 개편 롤백 | 최종 경로 기준 Python 계약 시험 26건·FE 프레임 시험 8건 통과. 광범위한 contracts 개편은 철회하고 examples-flat 제거와 legacy 분리만 유지 |
| 목적별 커밋 경계 | 첫 경계 Java 73건 확인(경로 선반영 1건을 분리 순서에 맞춰 보정한 뒤 해당 클래스 7건 재통과), 두 번째 경계 Java 43건·Python 계약 22건 통과. 두 경계 모두 main·test 컴파일 통과 |

두 번째 세션 준비 409는 현재 측정 제한 정책에 맞춘 시험으로 수정했고, HTTP 시간 초과 3건은
공용 시험 ApiClient의 HTTP/1.1 지정 후 최종 원본 코드 시험에서 해소했다.
근거: `.cache/realtime-http1-fixed-mysql-summary.json`, `.cache/realtime-merge-docker/summary.json`,
`.cache/contracts-layout-rollback-report.json` 및 아래 실행 기록.

실제 신형 FE 브라우저·카메라, 공개 프록시·배포와 기존 플랫폼 integration_test.sh 전체는 미수행이다.
구형 WS 제거·응답 전체 schema_version 제거·연구 모델 연결은 이번 구현에 포함하지 않는다.
사용자 승인 후 로컬 목적별 커밋과 develop 통합을 마쳤다. push·배포는 수행하지 않았으며, FE 인계와 전체 전환 완료를 구분한다.

## 결정과 진행 기록

- 2026-11-22 사용자가 최종 검토를 승인했다. 기존 구현 보존 커밋 `2dd2c469`는
  `backup/realtime-before-purpose-split-20261122`, 승인 파일 트리는 `backup/realtime-reviewed-tree-20261122`에
  로컬 태그로 보존했다. 승인된 충돌 해결 결과를 develop 기준 목적별 커밋으로 구성하고 병합 중 상태를 해소했다.
  코드·계약·시험은 승인 파일 트리와 같으며, 문서의 검토·커밋 상태만 후속 갱신했다. 원격 push는 하지 않았다.
  커밋 경계 검증은 격리 사본에서 관련 시험만 실행했다. 첫 경계에서 legacy 예시 경로 변경이 앞서 들어간
  시험 1건은 경로 변경을 두 번째 커밋으로 옮겨 해결했고, 원본 최종 파일은 바꾸지 않았다.
  이전 실패·재실행·두 번째 경계 증거는 `.cache/realtime-purpose-split/`에 구분해 보존했다.
- 2026-11-18 계획 작성. 사용자는 호환성을 최우선으로 하며 FE 제안서의 단계 전환을 채택했다.
  특징 평균은 구형 지원 종료를 기다리지 않고 제거한다. 품질 판단은 FE가 맡고 고개를 돌려도 채점한다.
  작업 시작 기준은 develop `ed726158`(Kafka 연결 PR #134 병합)이었다.
- 신형 phase는 running·unmeasurable·rest·away다. 감지 실패와 관측 공백 모두 측정 불가이며 p는 null이다.
- 2026-11-19 FE 회신을 검토했다. FE는 양 어깨 품질 확인·9점 좌표 누락 확인, 같은 시각 마지막 관측,
  늦은 관측 버리기, ack·head_turn 표시 정리와 평탄화 구현을 완료했다고 보고했다.
  회신의 커밋은 이 체크아웃에 없어 실제 코드와 시험 결과는 연동 단계에서 별도로 확인한다.
- 2026-11-19 사용자 결정으로 FE의 버전 없는 hello와 items 유무 구분안을 수용했다.
  모든 계약의 버전 필드 제거는 장기 방향이며, 응답 전체 삭제는 이번 범위 밖의 후속 작업이다.
- FE 구현·테스트 수정·FE 명세 갱신·배포는 프론트엔드 담당자에게 인계한다.
  이번 브랜치는 서버·공유 계약·좌표 적재·관련 시험을 구현하고 기존 FE 호환성을 확인한다.
- 새 품질 기준·평활화·버퍼·연구 모델 연결은 추가하지 않는다.
- 현 HEAD에 Kafka 연결·저장 완료 대기(D-67)·좌표 적재(D-92)가 있다. 초기 설정은 local이다.
  develop 병합만으로 운영 Kafka 활성화나 실기기 검증 완료를 판단하지 않는다.

### develop 통합 진행 (2026-11-22)

- 사용자 승인: 현재 구현을 보존한 뒤 최신 develop을 작업 브랜치에 병합한다. 이름·경로 변경과
  중복은 정리하고, 동작 선택이 필요한 충돌은 양쪽 동작과 통합안을 제시해 검토받는다.
- 병합 대상: origin/develop `1794cf5f`. FE 변경과 D-98의 Kafka 종료·측정 잠금 해제를 보존한다.
- 계약·토픽·클래스 이름은 ADR 0049의 버전 없는 이름에 맞춘다. 새 WS 입력은 schema_version 없이
  받고 구형 입력 호환은 유지한다. FE 응답 검사는 이미 제거됐으나 서버 응답·추론·Kafka 전체의
  schema_version 삭제는 원격 FE 제안서 요구 13이 구분한 후속 범위로 유지한다.
- 좌표 적재는 현재 develop의 버전 없는 토픽과 기존 자료·체크포인트를 함께 고려해 검토한다.
  새 버전 토픽을 추가하는 기존 초안은 그대로 적용하지 않는다.
- 계획 번호 0097이 원격 계획과 중복되어 이 계획을 0099로 옮겼다. 원격 계획 0097·0098은 보존한다.
- 검증: develop 대비 FE 무변경, 전체 자동 검사, MySQL, local/Kafka 신구형 WS,
  종료 후 재측정, Spark·HDFS 좌표 적재를 경계별로 확인한다. 기존 실패 2건과 신규 실패를 구분한다.

#### 통합 중간 결과와 검토 대기

- 병합 전 구현 보존 커밋: `2dd2c469`. 병합 커밋은 아직 만들지 않았다.
- WS 계약은 `realtime-ws.schema.json` 하나에 신구형 입력을 통합했다. 현재 입력·응답 예시는
  `examples-ws/`, 공통 본문은 `frames/posture-frame.schema.json`을 사용한다. 구형 hello·features와
  ack 거절 확인용 예시는 `examples-ws/legacy/`로 분리하고, 호환 지원 종료 시 관련 시험과 함께
  제거한다. 예시 이동 후 계약 시험·BE fixture 경로와 문서 링크를 검증한다.
- D-98의 `release`·`disconnected`와 관련 시험을 보존했다. API 167건 중 148 통과·MySQL 전용
  19건 건너뜀, processing 67건 통과. WS·기존 프레임 계약 14건, 평탄화 계약·추론 비교 9건 통과.
- FE 추적 파일 591개가 origin/develop과 줄끝 정규화 후 동일함을 확인했다.
- 2026-11-22 사용자 확정: `posture.keypoints` 단일 토픽·평탄화 본문·`keypoints.jsonl` 단일 파일을
  유지한다. 별도 메시지 구분·구독·체크포인트·파일 분리는 추가하지 않는다. J1은 develop 구현을
  그대로 유지하고 테스트·계약·재생 도구를 평탄화 본문으로 갱신한다. 운영 적재 현황은 미확인이다.
- 사용자 요청으로 검증 후 우리 변경을 WS 계약, 특징·필터 단순화, 좌표 적재, 최종 문서 등 목적별
  커밋으로 나눈다. 보존 커밋은 별도 기준점으로 남기고 develop 커밋 이력은 수정하지 않는다.
- 사용자 검토 게이트: 실제 추가 커밋과 이력 재구성 전에 병합 내용·검증 결과를 먼저 검토받는다.
  `2dd2c469` 이후 병합 커밋·분리 커밋은 만들지 않는다. 사용자 승인 후 목적별 커밋 작업을 진행한다.
- 중간 추가 검증: FE 1051건과 Node 8건·TypeScript·빌드 통과. Kafka 추론 17건 통과.
  JDK 21 Checkstyle 통과(기존 CRLF 경고 포함). 전체·MySQL·Kafka/HDFS는 최종 통합 코드로 재검증한다.

### develop 통합 검증 (2026-11-22)

- `JAVA_HOME=JDK17 .venv/Scripts/python tools/dev.py check`: 통과. Python 248건 중 233 통과·15 Spark
  건너뜀, FE Vitest 1051건·Node 8건 통과, TypeScript·Vite 빌드 통과. API 167건 중 148 통과·19 MySQL
  전용 건너뜀, processing 67건 통과. Checkstyle·빌드 통과(기존 CRLF 경고 포함).
- `.venv/Scripts/python -m pytest backend/inference/tests -q`: 17건 통과.
- `docker run ... apache/spark:4.2.0 /work/.cache/run_spark_checks.py`: 42건 전부 통과, 건너뜀 0.
- `.cache/run_realtime_merge_docker_check.py`(JDK17, 임시 MySQL·Kafka·Redis와 실제 API/processing/추론):
  local flat/legacy 각각 18, Kafka flat/legacy 각각 19개 확인 항목 통과(총 74). 종료 후 동일 계정의
  새 S1도 네 조합에서 성공. 관측·사건·통계·DB 저장·인증 거부·ack 미수신 확인. 좌표 334건·DLQ 0건.
- `.cache/run_realtime_merge_j1_check.py`: 실제 Kafka→Spark J1→HDFS `keypoints.jsonl`→MySQL archive
  2행 검증 통과. 중복 제거 후 세션별 167·169건(한 세션의 합성 측정 불가 2건 추가), null·관측 시각
  생략·rest 필드 생략 보존. 재실행은 새 행 0건. 별도 좌표 파일 없음. HDFS 컨테이너 회수 완료.
- 명시적 MySQL 첫 실행(`.cache/run_realtime_mysql_check.py`, 30초 JUnit 제한): API 167건 중 163 통과·
  4 실패, MySQL 전용 19건 중 15 통과·4 실패. 기존 두 번째 세션 준비의 409와 HTTP 요청 시간 초과 3건을
  구분한다. 신형 WS 시험의 시간 초과 위치는 WS 전송 전 가입 요청이다. 해당 3건은 새 임시 DB의 단독 재실행에서도 모두 시간 초과했다.
  HTTP 대기의 근본 원인은 미확정이다. 관련 없는 API·메일·HTTP 클라이언트 코드는 수정하지 않았다.
- 운영 서버·실제 영상·참여자 데이터·기존 MySQL 접속 정보는 사용하지 않았다. 실제 FE 브라우저·카메라,
  공개 프록시/배포, 플랫폼 전체 integration_test.sh는 실행하지 않았다.
- 임시 자원 회수: 이번 검증용 MySQL 3개·Kafka·Redis·HDFS·Spark 컨테이너, 시험 네트워크와
  API/processing/추론 프로세스를 모두 종료·회수했다. 기존 IDE·Gradle 서버는 건드리지 않았다.
- 로그: `.cache/realtime-merge-full-check.log`, `realtime-merge-spark.log`, `realtime-merge-mysql-summary.json`,
  `realtime-merge-mysql-integration.log`, `realtime-merge-mysql-retry.log`, `realtime-merge-docker-check.log`,
  `realtime-merge-j1.log`, `realtime-merge-docker/summary.json`.

### 2026-11-22 세션 점유 정책에 맞춘 통합 시험 후속

- 사용자 승인으로 `baselinesOwnershipLossAndInferenceFailure`의 준비 흐름을 수정했다.
  첫 세션의 연결 전 유예와 실제 연결 중 각각 두 번째 세션 생성의 409 및
  `MEASUREMENT_IN_PROGRESS`를 확인한다. 첫 세션을 WS `hello`→`ready`→`end`→`closed(ended)`로
  정상 종료한 뒤 새 기준으로 같은 두 번째 세션 ID를 생성하고 200을 확인한다.
- 첫 세션의 기존 종료 블록을 두 번째 세션 생성 앞으로 옮겼다. 기준 좌표·세션 FK 보존,
  타 사용자 소유권, 추론 실패 후 다음 구간 처리, 상태 소실·DB 종료 행·기록 목록 검증은 유지한다.
- 서비스 정책과 구현은 변경하지 않는다. 추가 커밋 없이 사용자 검토 대기를 유지한다.
- `JAVA_HOME=JDK17 .venv/Scripts/python tools/dev.py check-backend`: 통과. API 167건 중 148 통과·
  MySQL 전용 19건 건너뜀. processing 67건의 기존 성공 결과 재사용(UP-TO-DATE), Checkstyle·빌드 통과.
- `.cache/run_realtime_session_policy_mysql_check.py`: 새 임시 Docker MySQL에서 해당 시험 1건을
  단독 실행했으나 첫 가입 요청(`ApiClient.register`, MySqlIntegrationTest 571행)의 30초 HTTP 대기로
  실패했다. 세션 생성·종료 단언에는 도달하지 못해 수정한 흐름의 실제 통과는 아직 확인하지 못했다.
- 소스 변경 없이 시험 JVM만 JDK21로 지정한 `.cache/run_realtime_session_policy_mysql_java21_check.py`도
  같은 가입 요청에서 시간 초과했다. JDK17에만 국한된 문제라고 판단하지 않는다. 원인은 미확정이다.
- 최초 MySQL·기본 검사를 겹쳐 실행해 Gradle 결과 파일 EOF/NoSuchFile 오류가 난 결과는 수용하지
  않았다. 이후 두 검사를 순차 재실행한 위 결과로 기록한다. 임시 MySQL 컨테이너·DB는 모두 회수했다.
- 로그·요약: `.cache/realtime-session-policy-{backend,mysql,mysql-java21}*.log`와 각각의 summary JSON.

### 2026-11-22 HTTP 시험 클라이언트 호환 수정·최종 검증

- 요청과 응답 메타데이터·동시 스레드 덤프로 가입 요청이 서버까지 도착했지만 서버는 POST 본문의 첫 바이트,
  Java 클라이언트는 응답을 기다리는 상태를 확인했다. 세션·가입 비즈니스 로직 실행 전의 대기다.
- 같은 서버·본문의 대조 요청은 HTTP/1.1 지정 시 200, 기본 협상 시 시간 초과였다. 한글·영문 모두 같았다.
  어느 라이브러리의 내부 결함인지는 단정하지 않는다. 공통 `ApiClient`의 기본 협상이 재현 조건임을 확인했다.
- 저장소 원본을 바꾸기 전 HTTP/1.1만 지정한 임시 사본으로 시간 초과 3건과 수정한 세션 정책 시험을
  실행해 4건 전부 통과했다(`.cache/http1-control-mysql-summary.json`).
- 사용자 승인 후 `ApiClient` 생성에 `.version(HttpClient.Version.HTTP_1_1)` 한 줄을 반영했다.
  서버·FE·계약·메일·인증·세션 정책은 바꾸지 않았다. 기존 쿠키·토큰·응답 처리를 유지한다.
- 원본 코드 최종 검증: `JAVA_HOME=JDK17 .venv/Scripts/python .cache/run_realtime_http1_fixed_mysql_check.py`.
  임시 Docker MySQL만 사용해 `backend/gradlew -p backend build -Pmysql-integration`을 실행했다
  (기존과 같은 무한 대기 방지용 30초 JUnit 제한, 임시 대조 클래스·classpath 교체는 사용하지 않음).
- API 167건 전부 통과(MySQL 전용 19건 포함), processing 67건 전부 통과, 실패·건너뜀 0건.
  JDK21 Checkstyle와 JAR 빌드 통과(기존 CRLF 경고 포함). 이 빌드가 기본 BE 검사도 포함하므로 중복 실행하지 않는다.
- 앞선 세션 준비 409와 HTTP 시간 초과 실패는 최종 원본 실행에서 해소됐고, 정책에 맞춰 수정한 시험의
  세션 생성·정상 종료·재생성·기준·소유권·추론 장애·상태 소실·기록 검증까지 통과했다.
- 로그·요약: `.cache/realtime-http1-fixed-mysql.log`, `realtime-http1-fixed-mysql-runner.log`,
  `realtime-http1-fixed-mysql-summary.json`. 임시 시험 DB·MySQL 컨테이너 회수 완료.
- 추가 커밋·푸시 없이 사용자 검토 대기를 유지한다. 앞선 실패 기록은 당시 결과로 보존한다.

### 2026-11-22 WebSocket 예제 기본 위치·legacy 분리

- 사용자 요청으로 신규 입력·현재 응답을 `contracts/realtime/examples-ws/`에 모으고
  `examples-flat/`을 제거했다. Kafka 예시의 `examples/`는 유지한다.
- 구형 hello·features와 삭제된 ack의 거절 확인용 예시만 `examples-ws/legacy/`로 옮겼다.
  이동한 JSON 9개의 내용은 보존했으며, 관련 Python·Java 시험 경로와 계약 안내를 갱신했다.
  구형 입력 수신은 계속 지원하고, 호환 지원 종료 시 legacy 예시·관련 시험을 함께 제거한다.
- `JAVA_HOME=JDK17 .venv/Scripts/python tools/dev.py check`: Python 248건 중 233 통과·Spark 15 건너뜀,
  FE Vitest 1,051건·Node 8건과 타입·빌드 통과. BE에서는 빠뜨린 legacy 경로와 같은 세션의
  중복 연결을 만든 시험 준비 2건이 실패해 수정했다.
- 수정 후 `tools/dev.py check-backend`: API 167건 중 148 통과·MySQL 19 건너뜀,
  processing 67건 통과, Checkstyle·빌드 통과. 수정 영향이 없는 Python·FE 게이트는 반복하지 않았다.
  로그는 `.cache/realtime-examples-reorganization-check.log`와
  `.cache/realtime-examples-reorganization-backend.log`에 구분해 보존한다.
- 문서 로컬 링크와 `git diff --check` 통과. MySQL·실제 FE 연결은 이번 예제 정리에서 재실행하지 않았다.
  서버 실행 코드·FE 코드는 바꾸지 않았고 추가 커밋 없이 검토 대기를 유지한다.

### 병합 전 좌표 적재 설계 (대체됨)

다음은 병합 전 초안이며 적용하지 않는다. 현재 설계는 본문의 좌표 적재 전환과 ADR 0053을 따른다.

- 좌표 적재는 posture.keypoints.v2·kafka-keypoints.v2를 사용한다. 새 본문은 단일 프레임 공통 스키마로
  표현하고 WS 전용 type은 포함하지 않는다. 봉투·본문 버전 식별을 스키마와 예시에 명시한다.

#### 좌표 적재 전환

- 구형 WS 입력도 새 단일 프레임으로 정규화해 새 적재 본문을 만든다. WS와 적재 전환을 단계별로 배포한다.
- 새 스키마·토픽·J1·재생 도구를 준비한 뒤 생산자 설정을 바꾼다. 적재 스위치 기본값·동의 범위와
  적재 실패에도 측정이 계속되는 동작을 유지한다.
- 구형 토픽 메시지·HDFS 파일은 구형으로 식별해 읽기·재생한다. 기존 자료를 일괄 변환하거나 지우지 않는다.
  기존 Spark 체크포인트를 재사용하지 않고 새 구독용을 준비한다. 세션·순번 중복 제거와 삭제 대상을 확인한다.
- 새 좌표 본문을 적재·재생까지 연결한다. 신형 좌표를 구형 frames 배열로 되돌려 저장하지 않는다.

### 병합 전 구현·검증 기록

아래 기록의 버전 토픽·분리 파일·체크포인트 설계는 병합 전 초안이다. 현재 통합 설계는 위의
2026-11-22 사용자 확정 사항과 ADR 0053을 따른다. 이전 실행 결과는 병합 후 코드의 결과와 구분한다.

#### 2026-11-19 실행 결과

| 명령·범위 | 결과 |
|---|---|
| `python tools/dev.py check` | 전체 게이트 통과. `.cache/realtime-full-check-final.log` |
| 위 게이트의 Python unittest | 246개 중 231개 통과, pyspark 미설치로 15개 건너뜀 |
| 위 게이트의 기존 FE | Vitest 1,039개 + Node 8개 통과, TypeScript·Vite 빌드 통과. FE 파일 변경 없음 |
| `backend/gradlew.bat -p backend build` 최종 재검증 | API 163개 중 144개 통과·명시적 MySQL 19개 건너뜀, processing 67개 통과. Checkstyle·빌드 성공 |
| `.venv/Scripts/python.exe -m pytest backend/inference/tests -q` | 별도 Kafka 추론 시험 17개 통과 |
| `.venv/Scripts/python.exe -m unittest tests.test_batch_j1_hdfs_archive` | 최종 J1 보강 후 14개 중 6개 통과·Spark 8개 건너뜀 |
| 문서 링크·공백·도구 문법 | 변경 문서의 로컬 대상 확인, `git diff --check` 통과. 새 파일도 별도 공백 검사. `bash -n tools/platform/integration_test.sh` 통과 |

전체 게이트 통과 후 MySQL 시험의 ack 대기를 결과 수신으로 갱신하고, 신형 hello·평탄화 입력·낮은 visibility로
같은 저장 시나리오를 실행하도록 추가했다. 이 변경은 백엔드 build로 재검증했고 실제 DB 시험은 실행하지 않았다.
J1의 기존 Spark 시험에도 v1/v2 동시 저장·순번 중복 제거·null·시각 생략·별도 스트림·임시 폴더 정리를 추가했지만,
Spark 실행 자체는 환경 부족으로 건너뛰었다. 기본 게이트의 성공을 실제 Kafka·HDFS 왕복 성공으로 해석하지 않는다.

Checkstyle은 기존 파일의 CRLF와 긴 줄 경고가 남아 있다. 수정한 Java는 LF로 저장했고 새로 추가한 줄의 경고는 없다.
기존 Vite 큰 번들 경고도 남아 있다. 전체 게이트에 FE lint는 포함되지 않으며 이번에 별도 실행하지 않았다.

검증 중 확인한 선행 문제 두 곳만 최소 수정했다. SessionServiceTest에 빠져 있던 닫는 중괄호를 보충했고,
연구 UI Node 시험의 import 제거 정규식이 Windows CRLF도 처리하게 했다. FE 앱·테스트·명세는 수정하지 않았다.
연구 비교 코드가 가져가는 MINIMUM_FEATURE_QUALITY 상수는 보존하되 서비스 규칙 추론에서 적용하지 않는다.

#### 미검증·공동 확인

- 최초에는 Docker 엔진 연결 오류로 MySQL·Kafka·Spark·HDFS 통합을 실행하지 못했다.
  같은 날 사용자가 Docker를 실행한 뒤 아래 추가 검증을 수행했다. 기존 MySQL 접속 정보는 사용하지 않았다.
- v2 토픽과 J1 구독을 먼저 준비하고 생산자를 전환한다. 기존 v1 자료·체크포인트·파일은 보존한다.
- FE 회신의 신형 브랜치는 현재 체크아웃에 없다. 실제 신형 FE·브라우저·카메라 연동과 배포는 공동 확인 단계다.
- 구형 WS 삭제와 응답 전체의 schema_version 삭제는 수행하지 않았다. 커밋·push·배포도 수행하지 않았다.

#### 2026-11-19 Docker 준비 후 추가 검증

기존 DB·플랫폼 설정을 사용하지 않고 별도 네트워크와 임의 포트의 임시 컨테이너를 준비했다.
MySQL은 tools/test_mysql.py의 고정 이미지, Kafka 4.3.1·Redis 7.4.11·Spark 4.2.0·Hadoop 3.2.1은
저장소의 이미지 버전을 사용했다. API/처리 서비스는 현재 빌드 JAR, 두 추론 서비스는 현재 소스를 실행했다.
직접 서비스 실행 JVM은 로컬 Java 25.0.5였고 Gradle 시험 JVM은 Java 17이었다.

| 시험 | 결과·증거 |
|---|---|
| 명시적 MySQL: 임시 MySQL을 준비한 뒤 `backend/gradlew.bat -p backend build -Pmysql-integration` | API 전체 163개 중 161개 통과·2개 실패. 이 중 명시적 DB 시험 19개는 17개 통과·2개 실패. `.cache/realtime-mysql-integration.log`, API JUnit 보고서 |
| `test_batch_*.py`, Spark 컨테이너 | 42개 모두 통과·skip 0. 앞서 제외된 Spark 15개 포함. `.cache/realtime-spark-check.log` |
| ws_realtime_smoke.py의 local 신형/구형 시나리오 | 각각 17개 확인 통과, 관측 167개·종료·S4·DB 사건/알림/제외 시간 확인 |
| 같은 도구의 Kafka 신형/구형 시나리오 | 각각 18개 확인 통과. 두 세션의 keypoints.v2 334건, DLQ 0건. `.cache/realtime-docker/summary.json` 및 각 시나리오 로그 |
| 실제 Kafka → Spark J1 → HDFS → MySQL feature_archive | 세션 2개 적재, v1/v2 파일 분리·순번 중복 제거·재실행 중복 방지 통과. `.cache/realtime-j1-docker.log` |

WS 도구의 legacy 인자가 scenario에서 run_socket으로 전달되지 않았고, run_socket의 인자에도 빠져 있었다.
이 두 곳을 보완한 뒤 실제 네 조합을 실행했다. 신형·구형 결과에서 ack는 수신하지 않았다.
신형 평탄화·구형 WS 종료/저장·끊김 종료의 Java MySQL 시험도 통과했다.

J1 시험은 WS가 발행한 좌표 334건을 새 스키마로 확인한 뒤, 합성 중복 1건·측정 불가 2건과
구형 재생 도구의 합성 6건을 추가했다. HDFS에는 v2가 각각 169/167건, v1은 한 세션에 6건 저장됐고,
중복은 제거됐다. p: null과 촬영 시각 유무, rest의 필드 생략을 확인했다. J1은 같은 세션을 다시 적재하지 않았다.
이 추가 합성 입력은 적재 경계 시험이며 새로운 WS 관측 시나리오의 실행으로 보고하지 않는다.

MySQL 실패는 다음과 같고, 이번 입력 단순화 구현을 고치기 위해 다른 기능을 변경하지 않았다.

- MySqlIntegrationTest.baselinesOwnershipLossAndInferenceFailure: 두 번째 세션 생성에서 200 기대에 409 응답.
  현재 같은 계정의 다른 측정 주장(기본 30초)을 거절하는 코드와 시험의 복수 세션 준비가 충돌한다.
- AccountMailIntegrationTest.registrationRequiresVerifiedMatchingEmailInTheSameBrowser: HTTP 호출 대기 중 30초 제한 초과.
  첫 실행에서는 다른 메일 시험의 mock 호출 검증 실패도 관찰됐다. 원인은 확정하지 않았으며 재현·진단이 필요하다.

최초 실행의 HTTP 호출이 제한 시간 없이 대기해 소유한 시험 worker를 종료했다. 두 번째 실행에는
Git 제외 Gradle init script로 시험별 30초 제한만 적용해 전체 결과를 수집했다. 두 실패를 제외하거나 성공 처리하지 않았다.
원래 플랫폼 integration_test.sh 전체는 기존 서버 이름·설정·체크포인트를 전제로 하므로 실행하지 않았고,
이번 관련 경계는 위 격리 환경에서 직접 실행했다. 실제 FE·공개 터널·운영 배포 검증은 포함하지 않는다.

임시 DB·컨테이너·네트워크·API/추론/처리 프로세스는 종료·삭제 확인했다. 받은 Docker 이미지는 캐시에 남겼다.
