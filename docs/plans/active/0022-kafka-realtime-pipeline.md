# Kafka 실시간 전달 경로와 프론트 게이트웨이

- 상태: planned (DevOps가 계약 v1 수용, 메시지 단위·판정 엔진 결정 대기. 아래 '결정과 진행 기록' 첫 항목)
- 담당: 동욱 요청, Claude 작성. 팀원 요청으로 프론트가 게이트웨이까지 담당
- 시작일: 2026-10-05
- 관련 요구사항/ADR: [ADR 0011](../../decisions/0011-api-cep-boundary.md), [ADR 0012](../../decisions/0012-session-timing-policy.md),
  [ADR 0013](../../decisions/0013-frontend-server-feature-connection.md), [ADR 0017](../../decisions/0017-desktop-app-shell-and-redesign.md),
  [플랫폼 경계](../../design/data-platform-boundary.md), [플랫폼 v4 연결 지점](../../design/frontend-platform-seams.md),
  [서비스 안내](../../../backend/README.md)

## 배경

팀 공유 "자세 분석 플랫폼 아키텍처 v4"(2026-10-02 초안)는 측정 데이터를 WebSocket으로 받아 Kafka 토픽
(`posture.baselines`, `posture.inference`, `posture.episodes`)으로 서비스 사이에 전달한다.
현재 동작하는 서버(`jin_app`)는 Kafka 없이 HTTP 한 요청 안에서 API → FastAPI 추론 → Esper CEP를 차례로 호출한다.
팀원이 Kafka 쪽을 프론트에서 맡아 주기를 요청했다.

브라우저와 Electron 화면은 Kafka 프로토콜로 직접 연결할 수 없고, 브로커 주소·인증 정보를 사용자 기기에 둘 수도 없다.
따라서 프론트가 맡는 범위는 **화면과 Kafka 사이의 경계**다. 화면 ↔ 실시간 게이트웨이(WebSocket) ↔ Kafka.

이 계획은 `jin_app`에서 이미 정한 결정을 그대로 따른다. v4 초안과 다른 점은 아래 'v4 초안과 다른 점'에 둔다.

## 따르는 기존 결정

| 결정 | 이 계획에서의 의미 |
| --- | --- |
| ADR 0013 | 화면은 원본 키포인트가 아니라 **개인 기준 대비 변화량 3개와 품질**([입력 v2](../../../contracts/inference-request.v2.schema.json))만 보낸다 |
| ADR 0011 | 붕괴·회복·재알림 시간 판정은 **Esper CEP 한 곳**이 한다. 게이트웨이·화면·Kafka 처리기는 시간 판정을 다시 구현하지 않는다 |
| ADR 0012 | 시간 값은 세션 생성 시 고정한 정책을 따른다. Kafka 경로가 값을 바꾸지 않는다 |
| 서비스 안내 '다음 결정' 2 | 도입 전에 **세션 파티션 키·중복 처리·백프레셔·재생 계약**을 먼저 정한다 |
| 플랫폼 경계 | `cep_outbox`는 서비스 복구용이다. Kafka 토픽을 연구·학습 export로 쓰지 않는다. export는 동의·삭제 계약 후 별도로 둔다 |
| ADR 0017 | 화면 연결 지점은 `features/platform/ports.ts`의 `RealtimePort`와 `LiveView`를 사용한다 |

## 목표 구조

```text
[React 웹 / Electron]
   │ WebSocket: 입력 v2 묶음(약 0.5초), 순번 포함
   ▼
[실시간 게이트웨이]  ← 프론트 담당
   │ produce  posture.features.v1   (key = session_id)
   ▼
[추론 처리기] FastAPI /v2/infer 호출 → produce posture.inference.v1 (관측 v2)
   ▼
[CEP 처리기] Esper 시간 판정 → produce posture.episodes.v1 (사건 v1) + 조회 snapshot
   ▼
[실시간 게이트웨이] consume posture.episodes.v1 → 해당 세션 화면으로 push
   ▼
[API] 저장(MySQL) — 기존 영구 모드 경로 유지
```

| 토픽 | 메시지 본문(기존 계약 재사용) | 키 | 생산 | 소비 |
| --- | --- | --- | --- | --- |
| `posture.features.v1` | [입력 v2](../../../contracts/inference-request.v2.schema.json) + 봉투 | `session_id` | 게이트웨이 | 추론 처리기 |
| `posture.inference.v1` | [관측 v2](../../../contracts/posture-observation.v2.schema.json) + 봉투 | `session_id` | 추론 처리기 | CEP 처리기 |
| `posture.episodes.v1` | [사건 v1](../../../contracts/posture-event.v1.schema.json)과 [조회 v1](../../../contracts/session-view.v1.schema.json) + 봉투 | `session_id` | CEP 처리기 | 게이트웨이, API 저장 |
| `posture.baselines` | 보류 | — | — | — |

봉투(envelope)는 `schema_version`, `session_id`, `sequence`(입력 순번) 또는 `event_id`, `produced_at`만 더한다.
새 판정 필드를 만들지 않고 기존 계약을 그대로 싣는 것이 원칙이다.

## 프론트 담당 범위

| 항목 | 내용 |
| --- | --- |
| 1 메시지 계약 | WebSocket 메시지(`hello`·`features`·`ack`·`decision`·`alert`·`stalled`·`closed`)와 세 토픽의 봉투를 `contracts/`에 JSON Schema와 합성 예제로 둔다 |
| 2 로컬 Kafka | `compose.yaml`에 선택 프로필 `kafka`(KRaft 단일 브로커, private 네트워크)와 토픽 생성 작업을 둔다. 이미지는 기존 관례대로 digest를 고정한다 |
| 3 실시간 게이트웨이 | WebSocket 수신, 로그인 세션·세션 소유자 확인, 입력 검증, `posture.features.v1` produce, `posture.episodes.v1` consume 후 세션별 push, 5초 무응답 시 `stalled` |
| 4 클라이언트 `RealtimePort` | 약 0.5초 묶음 전송, 순번·재전송, 재연결, `stalled` → `LiveView.analysisPaused`, 판정 → `LiveView` |
| 5 검증 | 합성 입력으로 중복·역순·누락·재연결·브로커 중단을 시험하고 `make check`에 연결한다 |

추론 처리기의 모델 교체(ML), CEP 처리기·저장·통계(백엔드)는 각 담당과 계약으로 맞춘다. 프론트가 대신 구현하지 않는다.

## 전달 계약 (선행 조건)

- **파티션 키**: `session_id`. 한 세션의 순서는 한 파티션 안에서만 보장되므로 순서 판단은 `sequence`로 한다.
- **중복**: Kafka는 최소 한 번 전달이다. 소비자는 `(session_id, sequence)`와 `(session_id, event_id)`로 중복을 버린다.
  같은 순번의 다른 내용은 기존 HTTP 경로와 같이 거부한다(ADR 0013의 409 규칙).
- **백프레셔**: 게이트웨이는 세션별 미확인 입력 한도(기존 프론트 큐 16개와 같은 값에서 시작)를 넘으면 받지 않고 화면에 알린다.
  끊긴 시간을 정상·이탈 시간으로 채우지 않는다.
- **재생**: CEP 재시작 시 `posture.inference.v1`을 세션 시작부터 다시 읽어 상태를 복구할지, 기존 `cep_outbox` 복구를 유지할지 결정한다.
- **보존**: 토픽 보존 기간은 짧게 둔다. 탈퇴·삭제 요청이 Kafka 로그에 남지 않도록 보존 기간과 삭제 절차를 함께 정한다.
- **개인정보**: 메시지와 게이트웨이 로그에 영상·랜드마크·원본 좌표·이메일을 넣지 않는다.

## v4 초안과 다른 점 (팀 확인 필요)

| 항목 | v4 초안 | 이 계획(`jin_app` 결정) |
| --- | --- | --- |
| 전송 데이터 | 키포인트 | 변화량 3개·품질(ADR 0013). 키포인트가 필요한지는 ML 담당(지성)의 모델 입력 결정에 따른다 |
| 시간 판정 | 실시간 상태머신 서비스 | Esper CEP(ADR 0011) |
| 시간 값 | T1 10초·T2 5초 | 세션 정책값(ADR 0012) |
| 인증 | 게이트웨이 JWT | 기존 서버 로그인 세션·CSRF. Electron 패키징 앱(`app://posegood`)의 연결 방식은 별도 결정 |
| 기준 자세 토픽 | `posture.baselines` | 보류. [DB 전환 계획](0021-db-schema-v03-alignment.md)의 기준 특징 저장 결정 후 |
| 일별 통계 | Spark 일 배치 | 범위 밖. 기존 API 통계 유지 |

## 작업 단계

- [ ] 팀 확인: 프론트가 게이트웨이까지 담당, 위 'v4 초안과 다른 점', 게이트웨이 구현 언어
- [ ] ML 담당 확인: 서비스 모델 입력(변화량/키포인트), fps·윈도우, 추론 결과 필드
- [ ] 전달 계약 결정(재생·보존)과 ADR 작성
- [ ] 1 메시지 계약과 합성 예제, `make test` 검증 — 2026-10-06 초안 작성: [실시간 전달 계약 v1](../../../contracts/realtime/README.md), 합성 예제 12개, `tests/test_realtime_contracts.py` 6개 통과. 팀 확인·홍규 검토 후 체크
- [ ] 2 Compose `kafka` 프로필과 토픽 생성
- [ ] 3 게이트웨이와 합성 추론/CEP 처리기로 왕복 확인
- [ ] 4 클라이언트 `RealtimePort`, 기존 HTTP 서버 판정·로컬 판정과 선택 공존 — 2026-10-06 FE 구현: `frontend/src/features/session/realtime/`, 서버 세션 컨트롤러에 `VITE_REALTIME_URL`로 선택 연결. 가짜 게이트웨이 테스트만 통과, 실제 게이트웨이 왕복은 3단계 이후
- [ ] 5 실패 경로 시험과 `make check` 연결, 문서 갱신

## 결정과 진행 기록

- 2026-10-07 확인: 홍규의 `DevOps` 브랜치(`501ab5d`, `platform/docs/FE연동안_BE검토의견.md`, 2026-10-06)는 이 계약 v1을 따르기로 했다.
  역할은 Q1 C안(입구·인증·세션 시작/종료 = 팀 `develop`, Kafka 뒤 추론·판정 = DevOps/BE, 게이트웨이·화면 수신 = FE)이고,
  기존 `POST /api/v1/posture/summary`(camelCase)는 부하 시험·재생용으로만 남긴다. DevOps 작업 D-21(토픽·봉투·키 `session_id`),
  D-22(`posture.episodes.v1` 발행, 추론 입력 v2·관측 v2), D-23(세션 정책·중복·`phase`/`poor` 제외 구간·명시적 종료)은 등록만 됐다.
  회의에서 정할 것: ① Kafka 메시지 단위(FE가 약 0.5초를 구간 1개로 합쳐 보내기 요청, 구간마다면 동시 4~5명 한계)
  ② 판정 엔진 A(DevOps 상태머신 확장) / B(팀 `backend/cep`에 Kafka 연결, BE 의견) ③ DB 쓰기는 판정이 아닌 저장 소비자가.
  현재 `lee_app1`의 Kafka 형식 저장(`kafkaExport.ts`)은 계약 v1 봉투 형식이다.
- 2026-10-06 (동욱): 계약 초안 작성(`contracts/realtime/`). 실시간 상태는 서버 관측을 WebSocket `observation`으로 받는다
  (모델이 바뀌어도 화면과 판정이 같은 기준). 세션 시작·종료는 기존 HTTP, WebSocket은 측정 중 전송·결과 수신만(SSE는 대안으로만 기록).
  FE 클라이언트는 실시간 전달 어댑터로 구현한다.
- 2026-10-05: `jin_app` 문서(ADR 0011~0017, 서비스 안내, 플랫폼 경계, 기술 스택 검토, v4 연결 지점)를 기준으로 작성했다.
  v4 원본 문서는 저장소에 없어 연결 지점 문서의 요약만 반영했다. 입력 토픽 이름(`posture.features.v1`)은 이 계획에서 정한 가칭이다.
- 게이트웨이 구현 언어 후보: Spring Boot(기존 `backend/` Maven 모듈·`backend/contracts` 재사용·`check-backend` 게이트 공유) 또는 Node.
  추가 런타임을 늘리지 않는 Spring Boot 모듈(`backend/realtime`)을 우선 제안한다. Kafka 클라이언트는 도입 시점에 공식 지원 상태를 확인한다.
- 기존 HTTP 서버 판정(`POST /v1/sessions/{id}/features`)과 로컬 판정은 Kafka 경로가 검증될 때까지 유지한다. 서버가 멈췄을 때 로컬 판정으로 넘어갈지는 미정이다.

## 검증 결과와 남은 한계

- 계획 문서만 작성했다. 코드·의존성·Compose는 바꾸지 않았고 Kafka를 설치·실행하지 않았다.
- 처리량·지연 목표와 실제 카메라 입력 성능은 정하지 않았다. 측정 없이 수치를 정하지 않는다.
