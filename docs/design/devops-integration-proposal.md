# FE 제안: DevOps 서버 연동 확인과 게이트웨이

> 작성: 2026-10-11 · FE · 대상: DevOps(홍규), DB(유진), ML(지성)
> 확인 기준: `DevOps` 브랜치 `f27f778`(2026-10-10), `feature/repo-backend-db-v2` `fcc8ef7`(2026-10-11, 미병합), [실시간 계약 v1 초안](../../contracts/realtime/README.md), [FE 회신: v4 회의](v4-meeting-fe-reply.md), [DB V2.1 FE 검토](db-v21-fe-review.md)

## 요약

- DevOps 서버의 **Kafka 뒤쪽(추론 → 판정 → `posture.episodes.v1`)은 실시간 계약 v1대로 동작한다.** FE가 붙을 수 있는 토대는 있다.
- **앱과 닿는 양 끝이 비어 있다.** 브라우저가 붙을 게이트웨이(WebSocket)가 없고, `session_started`를 Kafka에 넣을 입구 API도 없다.
- **게이트웨이는 10/06 역할 나누기(Q1 C안)대로 FE가 만든다.** 서버 PC에서 Kafka 옆에 띄우는 서비스다. 배치·인증·입력 형식을 아래(3장)에서 정해 주면 바로 시작한다.
- FE는 **앱 판정을 모두 없애기로 했다**(10/11, 5장). 지금 서버 입력은 앱이 계산한 특징값·품질이라 이 결정과 맞지 않는다. 입력 형식을 같이 정해야 한다(질문 Q2).

## 1. 확인한 현재 상태

### 되어 있는 것

| 항목 | 위치 |
|---|---|
| `posture.features.v1` → 관측 v2 → `posture.inference.v1` (규칙 점수, DLQ) | `platform/inference-service/app/realtime.py` |
| v1 판정기: 세션 `policy` 사용, `rest`·`away` 제외, `decision`·`progress` 발행 | `platform/api-server/.../cep/v1/V1SessionJudge.java`, `KafkaEpisodesSink.java` |
| 판정 상태 Redis 저장·재시작 복원 (D-37) | `RedisV1JudgeStore.java` |
| 서비스 DB V2.1/V2.2 준비 확인 (D-32, D-41) | `store/ServiceSchemaVerifier.java` |

### 비어 있는 것

| # | 항목 | 확인한 내용 | 영향 |
|---|---|---|---|
| G1 | 브라우저용 게이트웨이 | 서버 코드에 WebSocket이 없다. 입구는 시험용 `POST /api/v1/realtime/features`(인증 없음, 끌 수 있음)뿐이다 | 앱이 결과를 실시간으로 받을 길이 없다 |
| G2 | 세션 시작·종료 → Kafka | C안에서 입구 API(팀 `develop`)가 `session_started`·`session_ended`를 넣는다. 지금 다시 만드는 팀 API(`fcc8ef7`, ADR 0020)는 **Kafka를 쓰지 않는다** | 판정기가 세션을 모르고 특징 메시지를 DLQ로 보낸다 |
| G3 | 입력 형식 | 입구 검사가 특징 변화량 3개·품질만 받고 모르는 필드를 거부한다. 추론은 앱이 보낸 `measurement_quality`로 판정 가능 여부를 정한다 | 앱이 특징값·판정 가능 검사를 계속 해야 한다 |
| G4 | 결과 저장 (D-30) | 서비스 DB는 준비 확인만 한다 | 기록 화면에 쌓일 데이터가 없다 |
| G5 | 유형 값 | 추론이 `deviation_type`(`left_lean` 등)을 낸다 | 앱 유형 표시 제거(5장)와 맞추려면 계약에서도 정리가 필요하다 |

## 2. 확인 요청

| # | 질문 | 대상 |
|---|---|---|
| Q1 | **Q1 C안(입구 = 팀 `develop`, Kafka 뒤 = DevOps, 게이트웨이 = FE)이 아직 유효한가?** 팀 API가 ADR 0020으로 Kafka 없이 판정까지 하게 됐는데, 둘 중 어느 구조로 갈지 | DevOps·DB |
| Q2 | 서버 입력을 **좌표 프레임**(v4 회의 결정, 계약 이름 `posture.frames.v1`)으로 언제 바꿀 수 있나. 그 전까지 특징값을 누가 계산하나(3장 ③) | DevOps·ML |
| Q3 | 게이트웨이를 서버 PC의 Compose에 넣어도 되나. 포트, Kafka 내부 주소(`kafka:19092`), 토픽 생성 방식 | DevOps |
| Q4 | 게이트웨이의 로그인 확인 방식(3장 ②) | DevOps·DB |
| Q5 | D-30(결과 저장) 일정과 저장 서비스 위치 | DevOps |
| Q6 | 판정 불가 이유 `observation.invalid_reason`(`unmeasurable`·`head_turn`·`settling`) 추가. 없으면 앱이 "고개를 돌린 동안은 판정하지 않아요" 같은 안내를 못 띄운다 | DevOps·ML |
| Q7 | 판정 가능 검사·특징값·고개 돌림(0.15)·복귀 대기(3초/1초)·판정 불가 3초 규칙을 서버 어디에 누가 넣나. FE는 규칙 문서와 합성 시험 데이터(좌표 → 기대 결과)를 준다 | DevOps·ML |
| Q8 | 알림 시간당 상한을 세션 기준으로 셀지 사용자 최근 60분으로 셀지. **FE는 어느 쪽이든 같다**(서버가 보낸 `alert`만 띄운다). 서버가 정한다 | DevOps |
| Q9 | 유형 값(`deviation_type`)을 계약·추론에서 뺄지 | ML |
| Q10 | 아직 push하지 않은 작업이 있나. DevOps 현황 문서는 10/06이 마지막이다 | DevOps |

## 3. FE 제안: 게이트웨이

### 구조

Kafka는 서버 PC 안에서만 열려 있다(9092는 `127.0.0.1`, 9094는 GPU PC만). 그래서 게이트웨이도 **서버 PC의 Compose 네트워크 안**에서
`kafka:19092`로 붙고, 브라우저는 게이트웨이의 WebSocket 포트 하나만 본다. 코드는 FE가 쓰고 서버 PC 배치는 DevOps와 같이 한다.

```
브라우저 ──WebSocket──▶ 게이트웨이 ──produce──▶ posture.features.v1 ─▶ 추론 ─▶ 판정
   ▲                      │  consume ◀── posture.inference.v1 (관측: 화면 실시간 상태)
   └──────── push ────────┘  consume ◀── posture.episodes.v1 (decision·progress → alert)
```

게이트웨이가 하는 일: 로그인·세션 주인 확인(`hello`), 묶음 검사, 순번 중복 제거, Kafka 기록 뒤 `ack`, 세션별 결과 push,
`decision`에서 `alert` 만들기, 재연결 때 놓친 `decision` 재전송, 5초 진행 없음 → `stalled`. 계약은 [실시간 계약 v1](../../contracts/realtime/README.md) 그대로다.

### ① 코드 위치 (Q1·Q3과 함께 결정)

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A | 독립 서비스 `backend/realtime`(Spring Boot) | 팀 API 재작성과 독립. DevOps Compose에 컨테이너 하나 추가 | 로그인 확인을 따로 해야 한다(②) |
| B | 팀 API(`fcc8ef7`의 `/v1/realtime`) 안에서 판정 대신 Kafka로 보내고 받기 | 로그인·세션 시작/종료가 이미 같은 곳에 있다. 입구(G2)도 함께 해결된다 | 팀 API를 서버 PC에서 Kafka 옆에 띄워야 한다. ADR 0020의 "API 안 판정"을 바꿔야 한다 |

FE 의견: **G1·G2를 한 번에 푸는 B가 낫다.** 다만 ADR 0020을 바꾸는 일이라 DB(유진)·DevOps가 함께 정해야 한다. 합의가 늦어지면 A로 시작한다.

### ② 로그인 확인 (A안일 때)

브라우저는 팀 API의 로그인 쿠키(Spring Session, MySQL `SPRING_SESSION`)를 가진다. 게이트웨이가 연결을 받을 때 그 쿠키로 팀 API의 `GET /auth/me`를 불러
사용자를 확인하고, 세션 주인은 `GET /sessions/{id}/metadata`로 확인한다. 같은 출처로 붙이려면 Nginx가 `/api/v1/realtime`을 게이트웨이로 넘긴다.

### ③ 입력 형식 (Q2)

앱은 판정하지 않으므로 앱이 보낼 수 있는 것은 **좌표 프레임**이다. 지금 추론은 특징값을 받는다. 바뀌기 전까지 다리 놓는 방법:

| 안 | 내용 |
|---|---|
| ㉠ | 추론 서비스가 좌표를 받도록 먼저 바꾼다(v4 결정 그대로). 게이트웨이는 좌표를 그대로 넘긴다 |
| ㉡ | 그 전까지 게이트웨이가 좌표 → 특징 변화량·품질로 바꿔 `posture.features.v1`에 넣는다. 좌표 원본은 HDFS용 토픽에 따로 넣는다. 서버 쪽 계산이라 "앱은 판정하지 않는다"와 맞는다. 추론이 좌표를 받게 되면 게이트웨이 계산을 지운다 |

FE 의견: 일정이 맞으면 ㉠, 아니면 ㉡으로 먼저 붙인다. ㉡의 계산식은 FE가 넘길 규칙 문서와 같다.

### ④ 개발·시험 방법

- FE PC에는 Docker가 없다. 게이트웨이 단위 시험은 JVM 안에서 도는 임베디드 Kafka(`spring-kafka-test`)로 한다. Windows에서 도는지는 시작 전에 확인한다.
- 실제 왕복 시험은 서버 PC에서 한다. 시험용 입구 대신 게이트웨이로 합성 세션을 흘려 `decision`·`progress`가 앱까지 오는지 본다(T-13).

## 4. 다른 팀 요청

| 대상 | 요청 |
|---|---|
| DB | 좌표 수집 동의를 저장할 곳(`user_consent` 보류 해제). 가입 화면 동의문은 FE가 만든다 |
| DB | 민감도 3단계 회신: threshold 값 하나로 저장(느긋하게 0.80 · 보통 0.70 · 꼼꼼하게 0.60). 단계 컬럼은 필요 없다 |
| DB·DevOps | 제외 사유 대응은 DB 정의(BR-52 우선순위)를 따른다 |

## 5. FE 결정 공유 (2026-10-11)

- **앱은 판정하지 않는다.** 상태·유형 판정, 고개 돌림 제외·복귀 대기, ML용 CSV 판정 라벨을 모두 없앤다. 서버 없이 쓰는 로컬 모드도 없앤다.
  라벨 촬영 수집 화면은 BE·ML 요구를 다시 받아 만든다.
- 네트워크가 끊기면 "연결 끊김"을 화면을 막지 않게 띄우고, 정보는 쌓아 두었다가 다시 연결되면 순번 그대로 다시 보낸다.
- 소리 켜기는 저장하지 않는다(측정마다 꺼진 채 시작). 「자세 알림」 켜기·끄기만 `user_account.alert_enabled`에 저장한다.
- 카메라는 팀 카메라 전제로 640×480을 요청한다.
- 좌표 프레임 계약 이름은 `posture.frames.v1`.
