# FE 제안: DevOps 서버 연동 확인과 게이트웨이

> 작성: 2026-10-11 · FE · 대상: DevOps(홍규), DB(유진), ML(지성)
> 확인 기준: `DevOps` 브랜치 `f27f778`(2026-10-10), `feature/repo-backend-db-v2` `fcc8ef7`(2026-10-11, 미병합), [실시간 계약 v1 초안](../../contracts/realtime/README.md), [FE 회신: v4 회의](v4-meeting-fe-reply.md), [DB V2.1 FE 검토](db-v21-fe-review.md)

## FE 전제

1. **판정과 라벨링은 서버가 한다.** 점수·상태·유형 판정과 학습용 정답 라벨 생성은 모두 서버(추론·판정·ML)가 맡는다. 앱은 판정하지 않고 라벨도 붙이지 않는다.
2. **데이터는 Kafka로 전달한다.** 앱 → 게이트웨이 → Kafka → 추론 → 판정 → Kafka → 게이트웨이 → 앱.
   **보낼 좌표의 관절·형식은 BE·ML이 요구하는 대로 따른다.** FE 초안(`posture.frames.v1`, 관절 9개, [FE 회신](v4-meeting-fe-reply.md) 안건 2)은 출발점일 뿐이다.
3. **서버는 거의 구축됐다고 보고, FE는 연결에 필요한 부분만 맞춘다.** Kafka 뒤쪽은 그대로 쓰고, 비어 있는 앱 쪽 끝(게이트웨이)은 FE가 만든다.

## 요약

- DevOps 서버의 **Kafka 뒤쪽(추론 → 판정 → `posture.episodes.v1`)은 실시간 계약 v1대로 동작한다.** 이 부분은 바꾸지 않고 그대로 붙는다.
- **연결에 필요한데 아직 없는 것은 두 가지다.** 브라우저가 붙을 게이트웨이(WebSocket)와, 세션 시작·종료(`session_started`·`session_ended`)를 Kafka에 넣는 입구다.
- **게이트웨이는 10/06 역할 나누기(Q1 C안)대로 FE가 만든다.** 서버 PC에서 Kafka 옆에 띄우는 서비스다. 배치·인증을 아래(3장)에서 정해 주면 바로 시작한다.
- 지금 서버 입력은 앱이 계산한 특징값·품질이다. v4 결정과 앱 판정 제거(5장)대로 **추론이 좌표를 받도록 바꿔야 한다**(Q2).

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
| G2 | 세션 시작·종료 → Kafka | C안에서 입구 API(팀 `develop`)가 `session_started`·`session_ended`를 넣는다. 지금 다시 만드는 팀 API(`fcc8ef7`)에는 이 Kafka 연결이 없다 | 판정기가 세션을 모르고 특징 메시지를 DLQ로 보낸다 |
| G3 | 입력 형식 | 입구 검사가 특징 변화량 3개·품질만 받고 모르는 필드를 거부한다. 추론은 앱이 보낸 `measurement_quality`로 판정 가능 여부를 정한다 | 앱이 특징값·판정 가능 검사를 계속 해야 한다 |
| G4 | 결과 저장 (D-30) | 서비스 DB는 준비 확인만 한다 | 기록 화면에 쌓일 데이터가 없다 |
| G5 | 유형 값 | 추론이 `deviation_type`(`left_lean` 등)을 낸다 | 앱은 표시하지 않는다(5장). 서버·ML이 라벨용으로 유지할지는 ML이 정한다(Q9) |

## 2. 확인 요청

| # | 질문 | 대상 |
|---|---|---|
| Q1 | **세션 시작·종료를 Kafka에 넣는 입구를 언제 붙이나.** C안(입구 = 팀 `develop`, Kafka 뒤 = DevOps, 게이트웨이 = FE)대로 팀 API가 `session_started`·`session_ended`를 Kafka에 넣어야 한다. 지금 다시 만드는 팀 API(`feature/repo-backend-db-v2`)에 이 연결을 넣는 일정과 담당 | DevOps·DB |
| Q2 | **보낼 좌표의 관절·형식을 정해 달라**(BE·ML 요구를 따른다). FE 초안은 `posture.frames.v1`(관절 9개 `[x, y, visibility]`, 0.5초 1건). 추론이 좌표를 언제부터 받을 수 있는지 | DevOps·ML |
| Q3 | 게이트웨이를 서버 PC의 Compose에 넣어도 되나. 포트, Kafka 내부 주소(`kafka:19092`), 토픽 생성 방식 | DevOps |
| Q4 | 게이트웨이의 로그인 확인 방식(3장 ②) | DevOps·DB |
| Q5 | D-30(결과 저장) 일정과 저장 서비스 위치 | DevOps |
| Q6 | 관측 v2 `observation`에 판정 불가 이유 **`invalid_reason`** 추가(아래 표). 없으면 앱이 "고개를 돌린 동안은 판정하지 않아요" 같은 안내를 못 띄운다 | DevOps·ML |
| Q7 | 판정 가능 검사·특징값·고개 돌림(0.15)·복귀 대기(3초/1초)·판정 불가 3초 규칙을 서버 어디에 누가 넣나. FE는 규칙 문서와 합성 시험 데이터(좌표 → 기대 결과)를 준다 | DevOps·ML |
| Q8 | 알림 시간당 상한을 세션 기준으로 셀지 사용자 최근 60분으로 셀지. **FE는 어느 쪽이든 같다**(서버가 보낸 `alert`만 띄운다). 서버가 정한다 | DevOps |
| Q9 | 유형 값(`deviation_type`)을 라벨용으로 서버·계약에 남길지. 앱은 표시하지 않으므로 남겨도 FE에는 영향이 없다 | ML |
| Q10 | 아직 push하지 않은 작업이 있나. DevOps 현황 문서는 10/06이 마지막이다 | DevOps |

### Q6 `invalid_reason` 제안

`observation.valid`가 `false`일 때만 채우고, `true`면 `null`이다.

| 값 | 뜻 | 앱 안내 |
|---|---|---|
| `unmeasurable` | 판정 불가(가림·visibility 부족·화면 밖·사람 없음) | "자세를 확인할 수 없어요" |
| `head_turn` | 고개 돌림(기준 대비 0.15 초과) | "고개를 돌린 동안은 판정하지 않아요" |
| `settling` | 판정 불가·고개 돌림 직후 복귀 대기(3초/1초) | "자세를 다시 잡는 중이에요" |

DB의 `excluded_interval.exclusion_reason`(`PAUSE`·`MISSING`·`ABSENCE`·`UNMEASURABLE`)은 저장용 구간 사유이고, 이 값은 화면 안내용 프레임 사유라 따로 둔다.
`head_turn`·`settling` 구간은 DB에 `UNMEASURABLE`로 저장한다([DB V2.1 FE 검토](db-v21-fe-review.md) 1장 FE-1).

## 3. FE 제안: 게이트웨이

### 구조

Kafka는 서버 PC 안에서만 열려 있다(9092는 `127.0.0.1`, 9094는 GPU PC만). 그래서 게이트웨이도 **서버 PC의 Compose 네트워크 안**에서
`kafka:19092`로 붙고, 브라우저는 게이트웨이의 WebSocket 포트 하나만 본다. 코드는 FE가 쓰고 서버 PC 배치는 DevOps와 같이 한다.

```
브라우저 ──WebSocket──▶ 게이트웨이 ──produce──▶ 좌표 토픽(Q2) ─▶ 추론 ─▶ 판정
   ▲                      │  consume ◀── posture.inference.v1 (관측: 화면 실시간 상태)
   └──────── push ────────┘  consume ◀── posture.episodes.v1 (decision·progress → alert)
```

게이트웨이가 하는 일: 로그인·세션 주인 확인(`hello`), 묶음 검사, 순번 중복 제거, Kafka 기록 뒤 `ack`, 세션별 결과 push,
`decision`에서 `alert` 만들기, 재연결 때 놓친 `decision` 재전송, 5초 진행 없음 → `stalled`.
WebSocket 메시지와 봉투는 [실시간 계약 v1](../../contracts/realtime/README.md)을 따르고, 본문만 좌표로 바뀐다(Q2).
**게이트웨이는 판정하지 않는다.** 좌표를 바꾸거나 거르지 않고 그대로 Kafka에 넣는다.

### ① 코드 위치 (Q3과 함께 결정)

C안대로 **독립 서비스 `backend/realtime`(Spring Boot)** 로 만든다. DevOps Compose에 컨테이너 하나를 더한다. 팀 API와 따로 배포한다.

### ② 로그인 확인

브라우저는 팀 API의 로그인 쿠키(Spring Session, MySQL `SPRING_SESSION`)를 가진다. 게이트웨이가 연결을 받을 때 그 쿠키로 팀 API의 `GET /auth/me`를 불러
사용자를 확인하고, 세션 주인은 `GET /sessions/{id}/metadata`로 확인한다. 같은 출처로 붙이려면 Nginx가 `/api/v1/realtime`을 게이트웨이로 넘긴다.

### ③ 입력 형식 (Q2)

v4 결정대로 앱은 **좌표 프레임**을 보내고, 게이트웨이는 그대로 Kafka에 넣으며, 판정 가능 검사·특징값·점수는 **추론 서비스**가 계산한다.
지금 추론은 특징값을 받으므로 추론이 좌표를 받도록 바뀌어야 끝까지 이어진다. 그 전에는 게이트웨이 시험에 지금 형식(`posture.features.v1`)의 합성 메시지를 쓴다.
추론이 앱과 같은 결과를 내는지는 [규칙 문서](server-rule-spec.md)와 합성 시험 데이터로 확인한다.

### ④ 개발·시험 방법

- FE PC에도 Docker Desktop을 설치했다(10/11). 게이트웨이 단위 시험은 임베디드 Kafka(`spring-kafka-test`)로, 왕복 시험은 로컬 Docker의 Kafka로 먼저 한다.
- 실제 왕복 시험은 서버 PC에서 한다. 시험용 입구 대신 게이트웨이로 합성 세션을 흘려 `decision`·`progress`가 앱까지 오는지 본다(T-13).

## 4. 다른 팀 요청

| 대상 | 요청 |
|---|---|
| DB | 좌표 수집 동의를 저장할 곳(`user_consent` 보류 해제). 가입 화면 동의문은 FE가 만든다 |
| DB | 민감도 3단계 회신: threshold 값 하나로 저장(느긋하게 0.80 · 보통 0.70 · 꼼꼼하게 0.60). 단계 컬럼은 필요 없다 |
| DB·DevOps | 제외 사유 대응은 DB 정의(BR-52 우선순위)를 따른다 |

## 5. FE 결정 공유 (2026-10-11)

- **앱은 판정하지 않는다**([ADR 0021](../decisions/0021-app-sends-information-server-judges.md)). 상태·유형 판정, 고개 돌림 제외·복귀 대기, ML용 CSV 판정 라벨을 모두 없앤다.
  서버 없이 쓰는 로컬 모드도 없앤다. 학습용 라벨은 서버·ML이 만든다. 라벨 촬영 수집 화면은 BE·ML 요구를 다시 받아 만든다.
- 앱 판정 규칙을 서버로 옮길 때 쓸 자료: [규칙 문서](server-rule-spec.md), [합성 시험 데이터](../../contracts/examples/frames/reference-rule-cases.json).
- 네트워크가 끊기면 "연결 끊김"을 화면을 막지 않게 띄우고, 정보는 쌓아 두었다가 다시 연결되면 순번 그대로 다시 보낸다.
- 소리 켜기는 저장하지 않는다(측정마다 꺼진 채 시작). 「자세 알림」 켜기·끄기만 `user_account.alert_enabled`에 저장한다.
- 카메라는 팀 카메라 전제로 640×480을 요청한다.
- 좌표 프레임 계약 이름은 `posture.frames.v1`.
