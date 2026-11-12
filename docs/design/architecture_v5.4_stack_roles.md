# 아키텍처 v5.4 스택별 역할

> 최종 갱신: 2026-11-11 · DevOps/BE (v5.4 개정 — `ws` Kafka 연결 브랜치 구현·J2 최근 7일·S3·R3 제거 결정·DB V2.7 / 11/02 v5.4 — Spark 배치 J1·J2·J3 구축) · 연결 번호(①~㉙)는 [아키텍처 v5.4 외부 원본](https://claude.ai/artifact/ToNH9pTwBDWbjTsg3iZpVX)의 연결표와 같습니다.
> 바꾼 점은 [변경 안내](architecture_v5.4_change_notes.md), 저장소 밖 원문은 [외부 원본 참조](architecture_v5.4_change_notes.md#외부-원본-참조)를 확인합니다. `ws` Kafka 연결은 D-57 브랜치(DevOps/BE)이고, `ws_구축가이드_PM.md`는 설계 참고용입니다. 이 파일은 `architecture_v5.2_stack_roles.md`(10/16판)를 대신합니다(11/11, D-90).

바깥(앱·팀원 PC)과는 API로만, 서버 안 서비스끼리는 Kafka로만 주고받습니다. 각 서비스는 자기 담당 테이블만 DAO로 씁니다. 적재·분석은 cron이 Spark 배치(J1·J2·J3)를 실행해 HDFS 사용자별 폴더에 둡니다.
실시간 판정은 **상태머신**으로 합니다. CEP(Esper 등 복합 이벤트 처리 엔진)는 쓰지 않습니다.
**사용자는 인터넷으로 들어옵니다(10/29).** 화면은 Vercel, API는 Cloudflare 터널 → 서버의 API 전용 `gateway` → 입출구 서버입니다.
**지금(11/11) 앱 경로는 전환 중입니다.** 운영의 앱 측정 판정은 아직 입출구 서버 안에서 돕니다(local — io-inference를 부름). `ws`를 Kafka에 붙이는 1단계는 11/10부터 DevOps/BE가 맡아 브랜치에서 구현했고, 서버에서 kafka 모드로 앱 → `ws` → 추론 → 판정 → 저장 → 저장 완료 → `ws` → 앱 왕복을 확인했습니다(통합 테스트 `--kafka` PASS 99 / FAIL 0, D-57). develop 병합은 FE 포함 통신 시험을 통과한 뒤입니다.

## 한눈에 (스택 16개)

| 층 | 스택 | 한 줄 역할 | 상태 (11/11) |
|---|---|---|---|
| 입출구 | 공개 입구 (`cloudflared` + `gateway` nginx) | 인터넷 → 터널 → API 경로만 io-api로 | 동작 · DN-66(10/29) |
| 입출구 | 입출구 서버 (팀 `backend/api`, `auth`·`api`·`ws`) | 바깥 입구 하나 — 계정·설정·기록(`/auth`·`/workspace`·`/records` 등), 실시간(`/realtime`) | REST·WebSocket 동작(공개 주소 REST 26/0·wss 17/0) · 운영 판정은 API 안(local) · `ws` Kafka 연결 D-57 브랜치(DevOps/BE, 서버 확인·병합 전) |
| 입출구 | 화면 컨테이너 `web` (nginx) | 서버 안 시험용 화면 + 같은 API(127.0.0.1:8088) | 동작 · DN-58·62 |
| 처리 서비스 | 추론 서비스 | 0.5초 구간 → good/bad 확률(규칙 점수) | 동작(서버 PC) · 모델 코드 제거 DN-59 · GPU 이전 D-31(통신 Kafka, 담당 DB/BE) |
| 처리 서비스 | 판정 서비스 (`judge`) | 확률 흐름 → 붕괴 확정·재알림·복귀·제외 구간 사건 | 완료 · DN-39~41·50·55 |
| 처리 서비스 | 판정 결과 저장 (`report`) | 사건·알림·제외 구간·세션 종료를 DB에, 표시할 알림 발행 | 완료 · DN-46·47·50·56·57 · 저장 완료 `posture.stored.v1`은 D-57 브랜치 ⑦ |
| 실시간 | Kafka | 서비스 간 메시지 통로·버퍼 (보존 3일) | 완료 · 토픽 v1 4개 + DLQ (`posture.stored.v1`은 D-57 브랜치) |
| 실시간 | Redis | 판정 상태 | 완료 · DN-41 |
| 적재·분석 | cron (서버 PC) | Spark 잡을 정해진 시각에 실행 | 동작(11/01 등록) · `batch.sh` |
| 적재·분석 | Spark 배치 (J1·J2·J3) | J1 적재 매시간 20분 · J2 일별 통계 매일 00:10(최근 7일 다시 계산) · J3 탈퇴 삭제 매일 04:00(유예 30일) | 동작(11/01) · J2 DN-70·74 · J3 DN-71 · J1 D-33(실제 세션은 운영 kafka 전환 뒤) |
| 적재·분석 | HDFS | 판정 과정을 사용자별 폴더에 보관 | 동작 · Spark 쓰기 복제 1(DN-54) |
| 외부 | 화면 (Vercel) · Cloudflare | 사용자 화면 · HTTPS·요청 제한·터널 | 동작 · FE 관리 |
| 외부 | MySQL | 계정·결과·통계·파일 위치 영구 저장 | 운영 V2.6 · develop V2.7(PR #114, migration 017 운영 적용 전) · DN-65 |
| 외부 | 학습 환경 | CSV로 수동 학습 → 모델 파일 | ML 담당 |
| 운영 | Docker Compose | 서버 PC 컨테이너 배치·설정 | 동작 · `.env`화 DN-48 · 프로필 `io`(io-api·io-inference·web·gateway)·`edge`(cloudflared) |
| 운영 | 운영 API · 통합 테스트 | 시험용 입구·판정·저장 확인 · 앱 없이 처음부터 끝까지 확인 | 동작 · 127.0.0.1만 · 0~17단계 + `--kafka`, 11/10 PASS 95 / 0(kafka 99 / 0) |

## 입출구 층 (앱과 직접 통신)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 공개 입구 — `cloudflared`(compose 프로필 `edge`, `cloudflare/cloudflared:2026.10.1`) + `gateway`(nginx, compose 프로필 `io`, 호스트 포트 없음) | `cloudflared`가 Cloudflare 터널(`api.posegood.site`)을 서버에서 바깥으로 연결하고 받은 요청을 `http://gateway:80`으로. `gateway`는 `/api/`(REST)·`/api/realtime`(WebSocket)만 io-api(`api:8090`)로 넘기고(`/api` 접두어를 뗌), 그 밖은 404. `X-Forwarded-Proto: https`, 실제 사용자 IP(`CF-Connecting-IP`), 내부 토큰 헤더는 지움 | 인터넷 요청(①②의 앞 구간) | io-api로 넘긴 요청·WebSocket | 서버 포트를 열지 않고 인터넷에 내보냄(터널은 안에서 바깥으로). 인터넷에 열린 것을 API 경로 하나로 줄임. 터널 토큰은 서버 파일(600)에만, FE가 관리 |
| 입출구 서버 (팀 `backend/api`, Spring Boot 1대, 컨테이너 `io-api` `127.0.0.1:8090`) | `auth`: 가입·로그인(access·refresh 토큰)·토큰 갱신·로그아웃·비밀번호·탈퇴 접수(삭제는 J3) / `api`: 설정·기준 자세 등록·조회·세션 행·세션 조회(S4)·기록 조회(`/workspace`·`/baselines`·`/sessions`·`/records`, S3·R3는 제거 결정 11/11) / `ws`: 좌표 받기·결과·알림 전달·자정 넘김(`/realtime`) | 앱 HTTP(`Authorization: Bearer`, refresh 쿠키 — ①), WebSocket `hello`(`access_token`)·`features`(프레임마다 구간 1개)·`end`(②), Kafka `episodes.v1`(관측·사건·진행)·`alerts.v1`·`stored.v1`(⑤⑥, kafka 모드) | MySQL(③), Kafka `features.v1`에 `session_started`·`features`(프레임마다)·`session_ended`(④, `ws`만, kafka 모드), 앱에 `ready`·`ack`·`observation`·`progress`·`decision`·`alert`·`stalled`·`session_rollover`·`closed`(사유 10개) | 앱이 주소 하나만 알면 됨. 세션 메시지를 `ws` 한 곳에서만 내 순서가 지켜짐. 측정 중 끊기면 세션을 끝냄(재연결 없음, ADR 0024). 출처는 `https://app.posegood.site` 하나(CORS·WebSocket 출처 검사) |
| 화면 컨테이너 `web` (팀 `infra/docker/frontend.Dockerfile` = 화면 빌드 + nginx, `127.0.0.1:8088`) | 서버 안 시험용 — 화면 파일과 `/api` → io-api 중계를 같은 출처로 | 팀원 브라우저(SSH `-L 8088:127.0.0.1:8088` → `http://localhost:8088`) | io-api로 넘긴 요청·WebSocket | 공개 입구와 별도로 서버 안에서 화면까지 시험(통합 테스트 13단계). 카메라는 안전한 출처에서만 열려서 localhost로 접속 |

- **지금(local, `POSEGOOD_REALTIME_PIPELINE=local`)**: `RealtimeHandlerV2` → `FrameFeatures`(좌표 → 특징) → **io-inference**(FastAPI, 내부 토큰) → `SessionEngine`(메모리 판정, 측정불가 30분 자동 종료 포함) → 결과 테이블에 직접 씀(ADR 0020). 그래서 지금은 `collapse_event`·`correction_alert`·`excluded_interval`·세션 종료 값을 io-api도 씁니다. Kafka 경로로 전환한 뒤에는 판정 결과 저장만 씁니다(C-1).
- 자세 등록: 앱이 3초 평균 좌표를 내 REST B1 `POST /baselines`(`registration_id`)로 보냅니다. WebSocket 등록(`purpose: calibration`)은 10/27 지웠습니다.
- REST S2·R2·S5·S6는 10/28 지웠습니다(계획 0062). 측정 입력은 `/realtime`뿐입니다.
- REST S2·R2·S5·S6는 10/28 지웠고, S3(연결 없이 종료)·R3(기록 삭제)도 11/11 제거로 정했고 11/12 C1(선택 정보 동의·철회)과 함께 지웠습니다(D-88, 계획 0062 2단계). S4는 DB에 끝난 세션이 있으면 DB 값으로 답합니다(안 A, DB/BE, D-85).
- 분담: API·계약은 DB/BE(명세 `docs/design/api-spec.md`가 확정본), 배포·공개 입구·점검은 DevOps/BE, `ws` Kafka 연결(D-57 1단계)은 11/10부터 DevOps/BE(10/30 회의의 PM 담당을 바꿈), 전환 시험·compose 변수도 DevOps/BE.
- kafka 모드(`POSEGOOD_REALTIME_PIPELINE=kafka`, D-57 브랜치): `KafkaPipeline`이 구간마다 `features.v1`을 내고 브로커 확인 뒤 `ack`, `KafkaResults`(그룹 `io-ws-io-api`)가 결과를 받아 앱 메시지로 바꿉니다. 종료 사건은 `stored.v1`(저장 완료)이 온 뒤 보냅니다. 한 번 보냄 표시·쥐고 있는 종료 사건은 서버 메모리(한 대 운영, 6시간 뒤 정리)이고, 여러 대로 늘릴 때 Redis로 옮깁니다.

## 처리 서비스 층 (Kafka 비동기)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 추론 서비스 (`backend/inference`, Python, 지금 서버 PC 컨테이너 `inference-service` 127.0.0.1:8000, 목표 GPU PC) | 0.5초 구간마다 규칙 점수로 나쁜 자세 확률 계산(그룹 `inference-service-v1`). 시험 LSTM은 지움(DN-59) | `features.v1` (⑦, 목표 Kafka 9094 / 지금 ㉓ 내부 19092) | `inference.v1`: 확률·`valid` (⑧), 처리 못 한 메시지는 `posture.dlq` | 모델 계산을 떼어 GPU에서 돌림. 모델이 바뀌어도 판정·서버는 그대로. GPU PC로 옮겨도 Kafka 통신 그대로(10/30 회의, 담당 DB/BE). GPU PC 장애 때 서버 PC CPU로 대체 실행 |
| 판정 서비스 (`backend/processing` 패키지 `posture.judge`, 컨테이너 `api-server` 127.0.0.1:8080) | 확률 흐름을 시간 규칙(3초 확정·3초 복귀·60초 재알림)으로 묶어 사건 5종과 제외 구간 사건(`excluded_started`·`excluded_ended`)을 만듦(그룹 `judge-v1`). CEP 엔진을 쓰지 않음 | `inference.v1` (⑨), Redis 판정 상태(⑪) | `episodes.v1`: 사건·`progress`·세션 요약 (⑩), DLQ (⑲) | 이어지는 상태를 봐야 알림이 끝없이 울리지 않음. 규칙이 단순해 상태머신으로 충분. DB에 쓰지 않아 DB가 느려도 판정 계속. 팀 API 판정과 같은 결과(T-15, DN-49) |
| 판정 결과 저장 (`backend/processing` 패키지 `report`·`store`) | 사건·알림 시도·제외 구간·세션 종료를 DB에 기록(그룹 `report-store-v1`), 알림 표시 판단(세션 알림 꺼짐·판정 뒤 10초 지난 사건·재전송은 기록만). 종료 값 저장 뒤 「저장 완료」를 `posture.stored.v1`로(D-67, D-57 브랜치 ⑦) | `episodes.v1` (⑫), `monitor_session`(시작 시각·`alert_enabled`·정책) | `collapse_event`·`correction_alert`·`excluded_interval`·세션 종료 값(`ended_at`·`good_sec`, 0.1초 아래 버림) (⑬), 표시할 알림 `posture.alerts.v1` (㉙), 저장 완료 `posture.stored.v1`, DLQ (⑲) | 판정과 DB를 나눠 DB 장애 때 이 그룹만 기다림. 종료 값은 여기서만(C-1), 재전송에도 같은 행(C-3). 화면 알림과 기록이 같은 규칙 한 곳 |

## 빅데이터 플랫폼 · 실시간

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| Kafka (`apache/kafka:4.3.1`, 브로커 1대, KRaft) | 서비스 간 메시지를 토픽에 쌓아 두고 순서대로 나눠 줌. 키 `session_id`, 파티션 3, 메시지 1건 = 앱 구간 1개(지금 앱은 프레임마다) | `posture.features.v1`·`inference.v1`·`episodes.v1`·`alerts.v1`·`posture.dlq` (+ `stored.v1`, D-57 브랜치) | 같은 메시지를 여러 소비자에게(예: `episodes.v1` → 저장·적재·입출구 서버) | 서비스끼리 주소를 몰라도 됨(MSA 대비). 추론이 느려도 입력이 쌓였다 이어서 처리. 보존 3일(DLQ 7일) — 사용자별로 지울 수 없어 30일보다 짧게 |
| Redis (`redis:7.4.11-alpine`, 127.0.0.1) | 판정 상태(`posture:v1:judge:{session_id}`, TTL 1시간). `ws`의 한 번 보냄 표시는 한 대 운영 동안 메모리(11/10 결정) — 입출구 서버를 여러 대로 늘리면 그 표시와 인스턴스 라우팅(⑱, D-47 보류) | 판정 상태(⑪) | 재시작 때 판정 상태 복원 | 메모리에만 두면 재시작에 사라지는 상태를 지킴(DN-41). 토큰 로그인이라 로그인 세션 공유는 필요 없음 |

## 빅데이터 플랫폼 · 적재·분석

이 층은 실시간 경로에 들어가지 않아 멈추거나 느려도 판정과 알림은 그대로입니다. 잡 코드는 저장소 `bigdata/jobs/`이고 spark 컨테이너 `/opt/jobs`에 읽기 전용으로 마운트됩니다(재빌드 없음). 11/01 J2 → J3 → J1 순서로 구축해 서버에서 확인하고 cron에 등록했습니다(사용법 저장소 `bigdata/README.md`, 계획 0085).

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| cron (서버 PC) + 실행기 `tools/platform/batch.sh` | crontab(KST): J1 `20 * * * *`(매시간 20분), J2 `10 0 * * * … j2 --days 7`(매일 00:10), J3 `0 4 * * *`(매일 04:00). `batch.sh`가 같은 잡 겹침을 막고(잠금) `docker exec spark spark-submit`으로 실행, 로그 30일 보관, 끝 코드 전달 | 시간표 | 잡 실행 (㉘) | Spark가 상주하지 않아 잡이 도는 동안만 메모리 사용. 새 인프라 필요 없음. J1을 20분에 둬 J2·J3와 겹치지 않음 |
| Spark 배치 J1 적재 (`apache/spark:4.2.0`, `j1_hdfs_archive.py`) | v1 토픽 3개를 Structured Streaming `availableNow`로 쌓인 만큼 읽고 끝남(체크포인트 HDFS). 임시 폴더(Parquet, 7일) → 끝난 지 10분 지난 세션을 중복 빼고 사용자별 폴더에 파일 3개(토픽별 JSON Lines). 5분 미만 세션도 적재, 탈퇴 계정은 안 함 | `features.v1`·`inference.v1`·`episodes.v1` (⑭), 대상 세션(DB) | HDFS `/data/users/{user_account_id}/{시작일}/{client_session_uuid}/` (⑮), `feature_archive` 세션 폴더 1행 (⑯) | 판정을 재현·분석할 원본이 남음. 실패해도 보존 3일 안에 이어 감. **실제 측정 데이터는 운영을 kafka 경로로 바꾼 뒤에 들어옴**(D-57·D-77) — 그 전에는 시험 데이터로 확인 |
| Spark 배치 J2 집계 (`j2_daily_stat.py`) | 매일 00:10 어제~7일 전(KST) 날짜마다 끝난 세션을 사용자별 일별 통계로 다시 계산해 바뀐 날만 다시 씀(시작 날짜 귀속, D-81). 유효 시간 = 세션마다 (길이 − 제외 구간)을 0.1초 아래 버려 더함. 바뀐 날은 그날 행을 지우고 다시 넣기(한 트랜잭션) | 결과 테이블(`monitor_session`·`collapse_event`·`correction_alert`·`excluded_interval`) (⑰) | `daily_stat` (⑰) | 서버 통계(T1)는 어제까지. 오늘 화면은 앱이 측정 중 받은 서버 결과를 모아 집계. `ended_at`이 비어 있는 세션은 넣지 않음(끝난 세션만) |
| Spark 배치 J3 삭제 (`j3_withdrawal_delete.py`) | 탈퇴 30일 뒤 그 사용자의 폴더와 행을 사용자 한 명씩 지움. 통합 테스트 합성 계정도 대상(10/29). 실패하면 되돌리고 `FAILED`, 다음 날 다시 | `deletion_request`(`REQUESTED`·`FAILED`·`PROCESSING`) | 사용자 폴더 삭제 → `feature_archive.deleted_at` → 행(한 트랜잭션, 요청 행·계정까지) (⑳) | 개인정보를 정해진 순서로 빠짐없이. DB 계정 삭제는 J3 하나(원칙) |
| HDFS (NameNode·DataNode 1개) | 판정 과정을 사용자별 폴더에 보관(세션 파일은 JSON Lines, 임시 폴더는 Parquet). Spark가 쓰는 파일도 복제 1(DN-54) | J1 (⑮) | J3이 지울 폴더 (⑳) | 시계열은 MySQL보다 파일 저장소가 맞음. 학습 환경과는 연결하지 않음 |

## 외부 (서버 PC 밖)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 화면 (Vercel `https://app.posegood.site`) · Cloudflare(`posegood.site` DNS·HTTPS·요청 제한·터널 `posegood-api`) | 사용자 화면 배포 · 인터넷 입구 | 사용자 브라우저 | API 요청 → 터널 → 서버 `cloudflared` | 서버에 화면을 두지 않음. 로그인·가입 요청 제한은 Cloudflare에서. FE 관리 |
| MySQL 8.0 (.107, `posture_service` 운영 **V2.6** · develop V2.7) | 계정·동의·설정·기준 자세(등록마다 새 행)·refresh 토큰(V2.7: 소셜 연결·비밀번호 재설정 토큰 — 기능은 기본 꺼짐), 세션·사건·알림·제외 구간, 파일 위치, 일별 통계 | 입출구 서버(③)·판정 결과 저장(⑬)·J1(⑯)·J2(⑰)·J3(⑳)·운영 API(㉗) | 기록·통계 조회, 세션 정보 | 관계형 데이터는 DB가 맞음. 서비스마다 자기 담당 테이블만. DB PC가 꺼지면 io-api가 뜨지 않음(상시 가동은 DB 담당) |
| 학습 환경 (GPU PC .108, ML) | 참가자 CSV로 수동 학습 | 앱에서 내보낸 CSV (㉑) | 모델 파일 → 추론 (㉒) | 라벨링이 필요해 수동이 맞음. 참가자 CSV는 저장소에 올리지 않음 |

## 운영

운영 스택은 바깥에 열지 않습니다(SSH 22만). 처리 서비스(8080)·추론(8000)·io-api(8090)·web(8088)·Redis·Kafka(9092)는 127.0.0.1, 9094는 GPU PC 전용입니다(DN-66).

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| Docker Compose | 서버 PC 컨테이너(api-server·inference-service·Kafka·Redis·HDFS·Spark, 프로필 `io`의 io-api·io-inference·web·gateway, 프로필 `edge`의 cloudflared)를 한 파일로. 서버에서는 원래 저장소에서만 실행, `up`은 `--no-build` | `infra/compose/bigdata.yaml`, `infra/compose/.env`(서버 주소·DB·포트·이미지 태그·공개 출처), `secrets/`(JWT 서명 키·터널 토큰) | 컨테이너·포트·볼륨·KST·메모리 제한·로그 회전 | 같은 구성 재현. 환경마다 다른 값은 `.env`·`secrets/`로 두어 K8s ConfigMap·Secret으로 그대로 |
| 운영 API (api-server) | 시험용 입구(`POST /api/v1/realtime/features`), 판정(`/judge/v1/*`)·서비스 DB 확인(`/store/service-db`)·저장(`/report/*`) 조회, 시험 행 | SSH 터널(㉔), 통합 테스트(㉕) | `features.v1` 발행(㉖), MySQL 조회·시험 행(㉗) | 앱 없이 단계별 검증 |
| 통합 테스트 (`tools/platform/integration_test.sh`) | `.env`·비밀값·컨테이너·Kafka·Redis·HDFS·Spark·서비스 DB·v1 판정·DLQ·재시작 복원·결과 저장·io-api REST·WebSocket 왕복·화면 경유·공개 입구(`gateway`·터널·공개 주소) 점검(0~17단계, 7단계 없음 — 15~17은 Spark 배치) | 재생 도구·`io_api_smoke.py`·`ws_realtime_smoke.py`가 만든 합성 계정·세션 | 단계별 PASS/FAIL, `tools/platform/it-results/` | "Done = 서버에서 확인"의 근거, 회귀 확인. 11/10 `--quick` PASS 95 / FAIL 0 / SKIP 2, `--kafka`(io-api를 잠시 kafka로) PASS 99 / FAIL 0 / SKIP 2 |

나중에 더할 것: D-57 병합(FE 포함 통신 시험 뒤) → 운영 기본값 kafka → API 안 판정·io-inference 삭제(4단계), 보존 주기(D-82), CI/CD(D-09), MSA·K8s 이전(D-83).
