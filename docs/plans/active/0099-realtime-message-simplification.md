# 실시간 메시지 평탄화와 단일 프레임 처리 단순화

- 상태: in_progress (서버 구현·검증·develop 통합·목적별 커밋 완료, FE 최종 인계·공동 확인 대기)
- 담당: Jeon-Seho(서버·공유 계약·좌표 적재·관련 시험), FE 구현·배포는 프론트엔드 담당자
- 시작일: 2026-11-18
- 브랜치: `feature/repo-realtime-message-simplification`, 통합 기준 develop `1794cf5f`
- 관련: [FE 제안서](../../design/fe/fe-server-proposal.md) 요구 4(BE-19)·5(BE-20),
  [ADR 0053](../../decisions/0053-realtime-flat-input-and-server-filter-removal.md),
  [ADR 0049](../../decisions/0049-no-version-in-names.md), [Kafka 전환 계획 0031](0031-realtime-kafka-transition.md)

## 문제와 완료 기준

앱은 보통 구간당 한 프레임을 보내지만 WS의 items·frames 배열, 특징 평균과 목업 품질·위치·고개 돌림 필터가 남아 있었다.
FE가 측정 불가를 전달하도록 접점을 단순화하되, 전환 중 기존 앱의 측정·휴식·재개·종료·기록 조회를 유지한다.

- 구형 hello·배열 입력과 신형 버전 없는 hello·평탄화 입력을 함께 받는다.
- WS ack·특징 평균·서버 목업 필터·local/Kafka 규칙 추론의 visibility 0.65 하한을 제거한다.
- 기존 단일 프레임 특징값·점수식·연속 판정·알림·시간 집계·저장과 측정 불가 제외가 유지된다.
- 좌표 적재의 생산자·계약·예시·재생·시험을 평탄화하고, 기존 토픽·파일·자료를 보존한다.
- 서버 지원 검증과 실제 신형 FE 연동·배포 확인을 구분하고, 후자는 FE 담당자와 공동 확인한다.

## 범위와 제외

| 경계 | 변경 내용 |
|---|---|
| WS·특징 계산 | RealtimeHandler·FrameInterval의 신구형 파싱, FrameFeatures·SessionService·KafkaPipeline의 단일 프레임 처리, ack·head_turn 힌트 제거 |
| 규칙 추론 | model/inference·backend/inference 및 InferenceClient의 visibility 하한 제거 |
| 좌표 적재 | posture.keypoints 본문·계약·예시·재생 도구·관련 시험. J1 구현·구독·체크포인트·compose는 develop 그대로 유지 |
| 검증·문서 | 서버·계약·적재 회귀 시험, API 명세·계약 안내·개발 상태·ADR과 FE 인계 |

- FE 앱·시험·FE 명세·배포는 FE 담당 범위다. 이 브랜치는 기존 FE 호환성을 검증하고 확정 계약·회귀 기준을 인계한다.
- 내부 특징·추론·Kafka 봉투 구조와 응답 전체 schema_version 제거, 연구 모델 연결·전처리 검증은 후속 범위다.
- B1 기준 좌표 평균·점수 공식·확정/회복/재알림 정책은 유지한다. local 삭제·운영 Kafka 전환은 계획 0031에서 관리한다.
- local 저장 전 closed, 24시간 상한 응답·자정 직후 FE 표시 등 별도 문제와 다른 담당자의 계획·명명 규칙 변경은 제외한다.

계약 상세는 [WS 스키마](../../../contracts/realtime/realtime-ws.schema.json),
[단일 프레임 본문](../../../contracts/realtime/frames/posture-frame.schema.json),
[현재·legacy 예시](../../../contracts/realtime/examples-ws/), [좌표 적재 스키마](../../../contracts/realtime/kafka-keypoints.schema.json),
[BE API 명세 11장](../../design/api-spec.md#11-websocket-realtime)을 따른다. 형식·JSON 예시는 이 계획에 중복하지 않는다.

## 작업 단계

- [x] 기존 구현·관련 계약·시험과 FE 요청·회신을 확인하고 호환성 기준을 정한다.
- [x] 신구형 WS 파싱·phase별 필드 검증·ack 제거와 접수 시각·지연 감지 보존을 구현한다.
- [x] 마지막 한 장 계산·서버 목업 필터 및 규칙 추론 하한 제거와 단일 프레임 수치 회귀를 검증한다.
- [x] 단일 토픽·단일 파일의 좌표 적재·재생·중복 제거·null/관측 시각 생략을 검증한다.
- [x] 전체 게이트·명시적 MySQL·local/Kafka 신구형 WS·Spark/HDFS 왕복을 확인하고 관련 문서를 갱신한다.
- [x] develop의 버전 없는 이름·FE 변경·D-98 종료 처리를 보존하고, 사용자 승인 후 목적별 5개 커밋으로 정리한다.
- [x] 확정 계약·서버 지원 상태·공동 회귀 기준·배포/되돌리기 순서를 담은 FE 인계 문서를 저장소 밖에 작성한다.
- [ ] 브랜치·지원 시점과 인계 문서를 전달하고, FE가 완료 보고한 구현과 최종 계약의 차이를 확인한다.
- [ ] 실제 신형 FE에서 시작·ready 대기·감지 실패·관측 공백·rest/away·재개·종료·S4/R1·재측정을 공동 확인한다.
- [ ] FE 배포·기존 연결 종료 확인 후 구형 지원·legacy 예시·관련 시험 제거의 담당·시점을 정한다.

신구형 지원 서버를 먼저 배포한 뒤 신형 FE를 연동·배포한다. 서버를 구형으로 되돌릴 때는 FE를 먼저 복구한다.
서버 지원 작업 완료와 전체 전환 완료를 구분하며 실제 신형 FE 연동·구형 종료 확인 전에는 계획 전체를 completed로 표시하지 않는다.

## 결정과 진행 기록

- 2026-11-18: 호환성을 우선하되 평균 제거를 구형 지원 종료까지 미루지 않기로 했다. 새 품질 기준·평활화·버퍼·연구 모델 연결은 추가하지 않는다.
- 2026-11-19: FE 회신을 수용해 신형 hello의 버전을 없애고 items 유무로 입력을 구분한다. 혼합 형식은 거절하며 응답 버전 필드는 유지한다.
  phase는 running·unmeasurable·rest·away, 측정 불가 p는 null이다. 촬영 관측에만 t_ms를 넣고 신형은 구간 안 시각을 검증한다.
  FE는 어깨 품질·9점 좌표 누락을 검사하고 얼굴의 낮은 visibility는 허용한다. 서버는 형식·범위·유한성·계산 가능 여부를 검사한다.
- 구형 다중 프레임은 마지막 한 장만 사용한다. 마지막이 측정 불가면 앞의 유효 좌표를 재사용하지 않는다. 출력 observation.valid는 유지한다.
- FE는 같은 시각 마지막 관측·늦은 프레임 버리기·4개 phase·ack/head_turn 표시 정리와 평탄화 구현을 완료했다고 보고했다.
  실제 신형 FE 코드와 서버의 공동 연동 결과는 별도 확인하며, FE의 완료 보고를 서버 검증 결과로 대체하지 않는다.
- 2026-11-22 develop 통합: posture.keypoints 하나의 평탄화 본문과 기존 keypoints.jsonl을 사용한다.
  별도 형식 구분·토픽·파일·체크포인트를 두던 초안은 폐기하고, 이미 저장된 파일은 변환·삭제하지 않는다.
- 계획 번호 충돌로 0097을 0099로 옮겼다. 광범위한 contracts 디렉터리 개편은 철회하고 examples-flat 제거·기본 예시와 legacy 분리만 유지한다.
- 검증 중 두 번째 세션 준비 409는 동시 측정 거절·정상 종료 후 새 측정 정책에 맞춰 시험을 수정했다.
  HTTP 시간 초과 3건은 공용 시험 ApiClient의 HTTP/1.1 지정으로 해결했다. 서비스 정책·계약 변경으로 우회하지 않았다.
- 사용자 승인 후 develop 위에 특징·필터(`74ecdee3`), WS 입력·ack(`72586b61`), 좌표 적재(`b15bb777`),
  통합 시험 보정(`ba2e0201`), 문서(`c790b45e`)를 커밋했다. 기존 보존 커밋·승인 파일 트리는 로컬 복구 태그에 보존했다.
- FE 인계 문서는 작성했으며 실제 전달·회신·공동 시험은 남아 있다. 원격 push·PR·배포는 수행하지 않았다.

## 검증 결과와 남은 한계

아래는 코드 구현·통합·커밋 분리 때의 결과다. 이번 계획 압축은 문서 검증만 수행하며 기존 시험을 반복하지 않는다.

| 명령·범위 | 최종 결과 |
|---|---|
| `python tools/dev.py check` | Python 248건 중 233 통과·Spark 15 건너뜀. 기존 FE Vitest 1,051건·Node 8건·타입·빌드 통과 |
| JDK17 `backend/gradlew -p backend build -Pmysql-integration`, 임시 Docker MySQL | API 167건(MySQL 전용 19건 포함)·processing 67건 전부 통과, 실패·건너뜀 0. JDK21 Checkstyle·빌드 통과 |
| `python -m pytest backend/inference/tests -q` / Spark 컨테이너의 배치 시험 | Kafka 추론 17건 / Spark 42건 통과. 별도 Spark 실행에서는 건너뜀 0 |
| 실제 local/Kafka × 합성 신형/구형 WS | 확인 항목 18·18·19·19개(총 74) 통과. 종료 후 동일 계정 재측정·DB 저장, 좌표 334건·DLQ 0 확인 |
| 실제 Kafka→Spark J1→HDFS→MySQL | keypoints.jsonl 단일 파일, 세션별 167·169건·archive 2행. 중복 제거·null·시각 생략·재실행 새 행 0 확인 |
| 예시 이동·디렉터리 개편 롤백 후 관련 시험 | Python 계약 26건·FE 프레임 8건 통과 |
| 목적별 커밋 경계 | main·test 컴파일 통과. 첫 경계 73건 중 경로 선반영 1건을 보정한 뒤 해당 클래스 7건 재통과, 두 번째 경계 Java 43건·Python 계약 22건 통과 |

주요 회귀는 기존 단일 프레임 수치·신구형 동등성, 잘못된 입력 거절, 측정 불가 제외·연속 판정·사건/알림·저장·재측정과 적재 왕복이다.
기존 기대를 출력에 맞춰 느슨하게 만들지 않았고, 의도한 필터 제거와 보존할 계산·판정·저장 기대를 구분했다.

- 실제 신형 FE·브라우저·카메라·공개 프록시·운영 배포와 기존 플랫폼 integration_test.sh 전체는 미수행이다.
- 모든 서비스 통합 입력은 합성이며 기존 MySQL 접속 정보·실제 참여자 자료는 사용하지 않았다. 검증용 임시 DB·컨테이너·프로세스는 회수했다.
- 검증 시 기존 CRLF·Vite 번들 경고가 남았다. 전체 기본 게이트에 FE lint는 포함되지 않으며 별도로 실행하지 않았다.
- 상세 실행 경위와 대체된 초안은 정리 전 커밋 `c790b45e`의 이 파일에서 확인한다. 당시 결과를 현재 결과로 해석하지 않는다.
  로컬 증거는 `.cache/realtime-http1-fixed-mysql-summary.json`, `.cache/realtime-merge-docker/summary.json`,
  `.cache/contracts-layout-rollback-report.json`, `.cache/realtime-purpose-split/`에 있으며 공유 환경에 존재한다고 가정하지 않는다.
