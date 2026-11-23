# 아키텍처 v5.5 스택별 역할

> 최종 갱신: 2026-11-22 · DevOps/BE (v5.5 — `ws` Kafka 연결 develop 병합 D-57·#134, 주소·토픽·그룹·경로의 버전 삭제 #138, 계정당 한 측정·D-98, DB V2.7) · 연결 번호(①~㉙)는 [아키텍처 v5.5 외부 원본](https://claude.ai/artifact/ToNH9pTwBDWbjTsg3iZpVX)의 연결표와 같습니다.
> 바꾼 점은 [변경 안내](architecture_v5.5_change_notes.md), 저장소 밖 원문은 [외부 원본 참조](architecture_v5.5_change_notes.md#외부-원본-참조)를 확인합니다. 지금 동작은 저장소 코드와 [Kafka 명세](kafka-spec.md)·[실시간 계약](../../contracts/realtime/README.md)이고, `ws_구축가이드_PM.md`는 설계 참고용입니다. 이 파일은 `architecture_v5.4_stack_roles.md`(11/11판)를 대신합니다(11/22).

바깥(앱·팀원 PC)과는 API로만, 서버 안 서비스끼리는 Kafka로만 주고받습니다. 각 서비스는 자기 담당 테이블만 DAO로 씁니다. 적재·분석은 cron이 Spark 배치(J1·J2·J3)를 실행해 HDFS 사용자별 폴더에 둡니다.
실시간 판정은 **상태머신**으로 합니다. CEP(Esper 등 복합 이벤트 처리 엔진)는 쓰지 않습니다.
**사용자는 인터넷으로 들어옵니다(10/29).** 화면은 Vercel, API는 Cloudflare 터널 → 서버의 API 전용 `gateway` → 입출구 서버입니다.
**이름에 버전을 붙이지 않습니다(#138, 11/20 병합).** 주소 `/api/…`·`/api/realtime`, 토픽 `posture.features` 등, 그룹 `judge` 등, Redis 키 `posture:judge:{session_id}`, HDFS 임시 폴더 `/data/staging/realtime`. 바뀌는 내용은 계약 파일(`contracts/realtime/`)과 명세로 관리합니다.
**`ws` Kafka 연결은 develop에 병합됐습니다(D-57, #134).** 서버에서 kafka 모드로 앱 → `ws` → 추론 → 판정 → 저장 → 저장 완료 → `ws` → 앱 왕복을 확인했습니다(11/20 통합 테스트 `--kafka` PASS 104 / FAIL 0, 통신 시험 S0~S12 PASS). **운영 기본값은 아직 local입니다**(`POSEGOOD_REALTIME_PIPELINE=local` — io-api 안에서 판정, io-inference를 부름). 운영을 kafka로 바꾸는 것은 별도 결정입니다.

## 한눈에 (스택 16개)

| 층 | 스택 | 한 줄 역할 | 상태 (11/22) |
|---|---|---|---|
| 입출구 | 공개 입구 (`cloudflared` + `gateway` nginx) | 인터넷 → 터널 → API 경로만 io-api로 | 동작 · DN-66(10/29) · 전환 별칭(`/api/v2/…`)은 서버에서 삭제, 저장소 정리 남음(D-94) |
| 입출구 | 입출구 서버 (팀 `backend/api`, `auth`·`api`·`ws`) | 바깥 입구 하나 — 계정·Discord 로그인·설정·기록(`/api/…`), 실시간(`/api/realtime`) | 동작 · 판정 경로 local(운영)·kafka(병합·시험 끝) · 계정당 한 측정(#127, D-98 #136) |
| 입출구 | 화면 컨테이너 `web` (nginx) | 서버 안 시험용 화면 + 같은 API(127.0.0.1:8088) | 동작 · DN-58·62 · 포트 포함 Host 전달(D-94) |
| 처리 서비스 | 추론 서비스 | 0.5초 구간 → good/bad 확률(규칙 점수) | 동작(서버 PC) · 모델 코드 제거 DN-59 · GPU 이전 D-31(통신 Kafka, 담당 DB/BE) |
| 처리 서비스 | 판정 서비스 (`judge`) | 확률 흐름 → 붕괴 확정·재알림·복귀·제외 구간 사건 | 완료 · DN-39~41·50·55 |
| 처리 서비스 | 판정 결과 저장 (`report`) | 사건·알림·제외 구간·세션 종료를 DB에, 표시할 알림·저장 완료 발행 | 완료 · DN-46·47·50·56·57 · 저장 완료 `posture.stored`(D-67, #134) |
| 실시간 | Kafka | 서비스 간 메시지 통로·버퍼 (보존 3일) | 완료 · 토픽 6개 + DLQ · 옛 `.v1` 토픽 정리·보존 주기 D-82 |
| 실시간 | Redis | 판정 상태 | 완료 · DN-41 · 키 `posture:judge:{session_id}` |
| 적재·분석 | cron (서버 PC) | Spark 잡을 정해진 시각에 실행 | 동작(11/01 등록) · `batch.sh` |
| 적재·분석 | Spark 배치 (J1·J2·J3) | J1 적재 매시간 20분 · J2 일별 통계 매일 00:10(최근 7일 다시 계산) · J3 탈퇴 삭제 매일 04:00(유예 30일) | 동작(11/01) · J2 DN-70·74 · J3 DN-71 · J1 D-33(실제 세션은 운영 kafka 전환 뒤, D-77) · 좌표 적재 D-92(스위치 꺼짐) |
| 적재·분석 | HDFS | 판정 과정을 사용자별 폴더에 보관 | 동작 · Spark 쓰기 복제 1(DN-54) |
| 외부 | 화면 (Vercel) · Cloudflare | 사용자 화면 · HTTPS·요청 제한·터널 | 동작 · FE 관리 · 새 주소로 배포(11/20) |
| 외부 | MySQL | 계정·결과·통계·파일 위치 영구 저장 | 운영 V2.7(16개 테이블) · develop V2.8 파일만(018·019, API 대기 — 계획 0096) · 알림 기본값 D-96 |
| 외부 | 학습 환경 | CSV로 수동 학습 → 모델 파일 | ML 담당 |
| 운영 | Docker Compose | 서버 PC 컨테이너 배치·설정 | 동작 · `.env`화 DN-48 · 프로필 `io`(io-api·io-inference·web·gateway)·`edge`(cloudflared) |
| 운영 | 운영 API · 통합 테스트 · 통신 시험 도구 | 시험용 입구·판정·저장 확인 · 앱 없이 처음부터 끝까지 · FE 화면과 같은 순서로 통신 확인 | 동작 · 127.0.0.1만 · 11/20 `--quick` PASS 99 / 0, `--kafka` 104 / 0 · 통신 시험 S0~S12 PASS |

## 입출구 층 (앱과 직접 통신)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 공개 입구 — `cloudflared`(compose 프로필 `edge`, `cloudflare/cloudflared:2026.10.1`) + `gateway`(nginx, compose 프로필 `io`, 호스트 포트 없음) | `cloudflared`가 Cloudflare 터널(`api.posegood.site`)을 서버에서 바깥으로 연결하고 받은 요청을 `http://gateway:80`으로. `gateway`는 `/api/`(REST)·`/api/realtime`(WebSocket)만 io-api(`api:8090`)로 넘기고(`/api` 접두어를 뗌), 그 밖은 404. `X-Forwarded-Proto: https`, 실제 사용자 IP(`CF-Connecting-IP`), 내부 토큰 헤더는 지움 | 인터넷 요청(①②의 앞 구간) | io-api로 넘긴 요청·WebSocket | 서버 포트를 열지 않고 인터넷에 내보냄(터널은 안에서 바깥으로). 인터넷에 열린 것을 API 경로 하나로 줄임. 터널 토큰은 서버 파일(600)에만, FE가 관리 |
| 입출구 서버 (팀 `backend/api`, Spring Boot 1대, 컨테이너 `io-api` `127.0.0.1:8090`) | `auth`: 가입·로그인(access·refresh 토큰)·Discord 로그인(#113)·토큰 갱신·로그아웃·비밀번호·탈퇴 접수(비밀번호 없이, #131 — 삭제는 J3) / `api`: 설정(`/workspace`)·기준 자세 등록·조회(`/baselines`)·세션 행·세션 조회(S4, `/sessions/{id}`)·기록 조회(`/records`) / `ws`: 좌표 받기·결과·알림 전달·자정 넘김(`/realtime`). 계정당 한 측정 — 다른 기기가 측정 중이면 409 `MEASUREMENT_IN_PROGRESS`(#127, D-98 #136) | 앱 HTTP(`Authorization: Bearer`, refresh 쿠키 — ①), WebSocket `hello`(`access_token`)·`features`(메시지마다 구간 1개)·`end`(②), Kafka `posture.episodes`(관측·사건·진행)·`posture.alerts`·`posture.stored`(⑤⑥, kafka 모드) | MySQL(③), Kafka `posture.features`에 `session_started`·`features`·`session_ended`(④, `ws`만, kafka 모드), `posture.keypoints`(④, 스위치 켤 때만), 앱에 `ready`·`ack`·`observation`·`progress`·`decision`·`alert`·`stalled`·`session_rollover`·`closed`(사유 10개) | 앱이 주소 하나만 알면 됨. 세션 메시지를 `ws` 한 곳에서만 내 순서가 지켜짐. 측정 중 끊기면 세션을 끝냄(재연결 없음, ADR 0024). 출처는 `https://app.posegood.site` 하나(CORS·WebSocket 출처 검사) |
| 화면 컨테이너 `web` (팀 `infra/docker/frontend.Dockerfile` = 화면 빌드 + nginx, `127.0.0.1:8088`) | 서버 안 시험용 — 화면 파일과 `/api` → io-api 중계를 같은 출처로(REST도 포트 포함 Host 전달, D-94) | 팀원 브라우저(SSH `-L 8088:127.0.0.1:8088` → `http://localhost:8088`) | io-api로 넘긴 요청·WebSocket | 공개 입구와 별도로 서버 안에서 화면까지 시험(통합 테스트 13단계). 카메라는 안전한 출처에서만 열려서 localhost로 접속 |

- **운영 지금(local, `POSEGOOD_REALTIME_PIPELINE=local`)**: `ws` → `FrameFeatures`(좌표 → 특징) → **io-inference**(FastAPI `/infer`, 내부 토큰) → `SessionEngine`(메모리 판정, 측정불가 30분 자동 종료 포함) → 결과 테이블에 직접 씀(ADR 0020). 그래서 local에서는 `collapse_event`·`correction_alert`·`excluded_interval`·세션 종료 값을 io-api도 씁니다. 운영을 kafka로 바꾼 뒤에는 판정 결과 저장만 씁니다(C-1).
- **kafka 모드(`POSEGOOD_REALTIME_PIPELINE=kafka`, develop 병합 #134)**: `KafkaPipeline`이 구간마다 `posture.features`를 내고 브로커 확인 뒤 `ack`, `KafkaResults`(그룹 `io-ws-${HOSTNAME}`, 서버에서는 `io-ws-io-api`)가 결과를 받아 앱 메시지로 바꿉니다. 종료 사건은 `posture.stored`(저장 완료)가 온 뒤 보냅니다. 한 번 보냄 표시·쥐고 있는 종료 사건은 서버 메모리(한 대 운영, 6시간 뒤 정리)이고, 여러 대로 늘릴 때 Redis로 옮깁니다(D-47).
- 자세 등록: 앱이 3초 평균 좌표를 REST B1 `POST /baselines`(`registration_id`)로 보냅니다. WebSocket 등록은 10/27 지웠습니다.
- 지운 API: S2·R2·S5·S6(10/28, 계획 0062), S3(연결 없이 종료)·R3(기록 삭제)(#121). 측정 입력은 `/realtime`뿐입니다. S4는 DB에 끝난 세션이 있으면 DB 값으로 답합니다(#119, D-85).
- 분담: API·계약은 DB/BE(명세 [api-spec.md](api-spec.md)가 확정본), 배포·공개 입구·점검·`ws` Kafka 연결·전환 시험·compose 변수는 DevOps/BE.

## 처리 서비스 층 (Kafka 비동기)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 추론 서비스 (`backend/inference`, Python, 지금 서버 PC 컨테이너 `inference-service` 127.0.0.1:8000, 목표 GPU PC) | 0.5초 구간마다 규칙 점수로 나쁜 자세 확률 계산(그룹 `inference-service`). 시험 LSTM은 지움(DN-59) | `posture.features` (⑦, 목표 Kafka 9094 / 지금 ㉓ 내부 19092) | `posture.inference`: 확률·`valid` (⑧), 처리 못 한 메시지는 `posture.dlq` | 모델 계산을 떼어 GPU에서 돌림. 모델이 바뀌어도 판정·서버는 그대로. GPU PC로 옮겨도 Kafka 통신 그대로(10/30 회의, 담당 DB/BE). GPU PC 장애 때 서버 PC CPU로 대체 실행 |
| 판정 서비스 (`backend/processing` 패키지 `posture.judge`, 컨테이너 `api-server` 127.0.0.1:8080) | 확률 흐름을 시간 규칙(3초 확정·3초 복귀·60초 재알림)으로 묶어 사건 5종과 제외 구간 사건(`excluded_started`·`excluded_ended`)을 만듦(그룹 `judge`). CEP 엔진을 쓰지 않음 | `posture.inference` (⑨), Redis 판정 상태(⑪) | `posture.episodes`: 사건·`progress`·세션 요약 (⑩), DLQ (⑲) | 이어지는 상태를 봐야 알림이 끝없이 울리지 않음. 규칙이 단순해 상태머신으로 충분. DB에 쓰지 않아 DB가 느려도 판정 계속. 팀 API 판정과 같은 결과(T-15, DN-49) |
| 판정 결과 저장 (`backend/processing` 패키지 `report`·`store`) | 사건·알림 시도·제외 구간·세션 종료를 DB에 기록(그룹 `report-store`), 알림 표시 판단(세션 알림 꺼짐·판정 뒤 10초 지난 사건·재전송은 기록만). 종료 값 저장 뒤 「저장 완료」를 `posture.stored`로(D-67) | `posture.episodes` (⑫), `monitor_session`(시작 시각·`alert_enabled`·정책) | `collapse_event`·`correction_alert`·`excluded_interval`·세션 종료 값(`ended_at`·`good_sec`, 0.1초 아래 버림) (⑬), 표시할 알림 `posture.alerts` (㉙), 저장 완료 `posture.stored`(⑤), DLQ (⑲) | 판정과 DB를 나눠 DB 장애 때 이 그룹만 기다림. 종료 값은 여기서만(C-1), 재전송에도 같은 행(C-3). 화면 알림과 기록이 같은 규칙 한 곳 |

## 빅데이터 플랫폼 · 실시간

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| Kafka (`apache/kafka:4.3.1`, 브로커 1대, KRaft) | 서비스 간 메시지를 토픽에 쌓아 두고 순서대로 나눠 줌. 키 `session_id`, 파티션 3, 메시지 1건 = 앱 구간 1개 | `posture.features`·`posture.inference`·`posture.episodes`·`posture.alerts`·`posture.stored`·`posture.keypoints`·`posture.dlq` | 같은 메시지를 여러 소비자에게(예: `posture.episodes` → 저장·적재·입출구 서버) | 서비스끼리 주소를 몰라도 됨(MSA 대비). 추론이 느려도 입력이 쌓였다 이어서 처리. 보존 3일(DLQ 7일) — 사용자별로 지울 수 없어 30일보다 짧게. 옛 `.v1` 토픽은 비운 뒤 지움(D-82) |
| Redis (`redis:7.4.11-alpine`, 127.0.0.1) | 판정 상태(`posture:judge:{session_id}`, TTL 1시간). `ws`의 한 번 보냄 표시는 한 대 운영 동안 메모리(11/10 결정) — 입출구 서버를 여러 대로 늘리면 그 표시와 인스턴스 라우팅(⑱, D-47 보류) | 판정 상태(⑪) | 재시작 때 판정 상태 복원 | 메모리에만 두면 재시작에 사라지는 상태를 지킴(DN-41). 토큰 로그인이라 로그인 세션 공유는 필요 없음 |

## 빅데이터 플랫폼 · 적재·분석

이 층은 실시간 경로에 들어가지 않아 멈추거나 느려도 판정과 알림은 그대로입니다. 잡 코드는 저장소 `bigdata/jobs/`이고 spark 컨테이너 `/opt/jobs`에 읽기 전용으로 마운트됩니다(재빌드 없음). 11/01 J2 → J3 → J1 순서로 구축해 서버에서 확인하고 cron에 등록했습니다(사용법 저장소 `bigdata/README.md`, 계획 0085).

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| cron (서버 PC) + 실행기 `tools/platform/batch.sh` | crontab(KST): J1 `20 * * * *`(매시간 20분), J2 `10 0 * * * … j2 --days 7`(매일 00:10), J3 `0 4 * * *`(매일 04:00). `batch.sh`가 같은 잡 겹침을 막고(잠금) `docker exec spark spark-submit`으로 실행, 로그 30일 보관, 끝 코드 전달 | 시간표 | 잡 실행 (㉘) | Spark가 상주하지 않아 잡이 도는 동안만 메모리 사용. 새 인프라 필요 없음. J1을 20분에 둬 J2·J3와 겹치지 않음 |
| Spark 배치 J1 적재 (`apache/spark:4.2.0`, `j1_hdfs_archive.py`) | 토픽 3개(`posture.features`·`posture.inference`·`posture.episodes`)를 Structured Streaming `availableNow`로 쌓인 만큼 읽고 끝남(체크포인트 `j1-realtime`). 임시 폴더 `/data/staging/realtime`(Parquet) → 끝난 지 10분 지난 세션을 중복 빼고 사용자별 폴더에 파일 3개(토픽별 JSON Lines). 좌표(`posture.keypoints`)는 별도 쿼리·체크포인트 `j1-keypoints`·임시 폴더 `/data/staging/keypoints`로 `keypoints.jsonl`(D-92, 스위치 `POSEGOOD_ARCHIVE_KEYPOINTS` 기본 꺼짐). 5분 미만 세션도 적재, 탈퇴 계정은 안 함 | `posture.features`·`posture.inference`·`posture.episodes`(+ `posture.keypoints`) (⑭), 대상 세션(DB) | HDFS `/data/users/{user_account_id}/{시작일}/{client_session_uuid}/` (⑮), `feature_archive` 세션 폴더 1행 (⑯) | 판정을 재현·분석할 원본이 남음. 실패해도 보존 3일 안에 이어 감. **실제 측정 데이터는 운영을 kafka 경로로 바꾼 뒤에 들어옴**(D-77) — 그 전에는 시험 데이터로 확인 |
| Spark 배치 J2 집계 (`j2_daily_stat.py`) | 매일 00:10 어제~7일 전(KST) 날짜마다 끝난 세션을 사용자별 일별 통계로 다시 계산해 바뀐 날만 다시 씀(시작 날짜 귀속, D-81). 유효 시간 = 세션마다 (길이 − 제외 구간)을 0.1초 아래 버려 더함. 바뀐 날은 그날 행을 지우고 다시 넣기(한 트랜잭션) | 결과 테이블(`monitor_session`·`collapse_event`·`correction_alert`·`excluded_interval`) (⑰) | `daily_stat` (⑰) | 서버 통계(T1)는 어제까지. 오늘 화면은 앱이 측정 중 받은 서버 결과를 모아 집계. `ended_at`이 비어 있는 세션은 넣지 않음(끝난 세션만) |
| Spark 배치 J3 삭제 (`j3_withdrawal_delete.py`) | 탈퇴 30일 뒤 그 사용자의 폴더와 행을 사용자 한 명씩 지움. 통합 테스트 합성 계정도 대상(10/29). 실패하면 되돌리고 `FAILED`, 다음 날 다시 | `deletion_request`(`REQUESTED`·`FAILED`·`PROCESSING`) | 사용자 폴더 삭제 → `feature_archive.deleted_at` → 행(한 트랜잭션, 요청 행·계정까지) (⑳) | 개인정보를 정해진 순서로 빠짐없이. DB 계정 삭제는 J3 하나(원칙) |
| HDFS (NameNode·DataNode 1개) | 판정 과정을 사용자별 폴더에 보관(세션 파일은 JSON Lines, 임시 폴더는 Parquet). Spark가 쓰는 파일도 복제 1(DN-54). 임시 폴더 보존 주기는 D-82 | J1 (⑮) | J3이 지울 폴더 (⑳) | 시계열은 MySQL보다 파일 저장소가 맞음. 학습 환경과는 연결하지 않음 |

## 외부 (서버 PC 밖)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 화면 (Vercel `https://app.posegood.site`, develop 배포) · Cloudflare(`posegood.site` DNS·HTTPS·요청 제한·터널 `posegood-api`) | 사용자 화면 배포 · 인터넷 입구 | 사용자 브라우저 | API 요청 → 터널 → 서버 `cloudflared` | 서버에 화면을 두지 않음. 로그인·가입 요청 제한은 Cloudflare에서. FE 관리 |
| MySQL 8.0 (.107, `posture_service` 운영 **V2.7** · develop V2.8 파일만) | 계정·동의·설정·기준 자세(등록마다 새 행)·refresh 토큰·소셜 연결(Discord)·비밀번호 재설정 토큰, 세션·사건·알림·제외 구간, 파일 위치, 일별 통계(16개 테이블). V2.8(018·019)은 API와 함께 반영(계획 0096). 서버 DB 알림 기본값은 D-96 | 입출구 서버(③)·판정 결과 저장(⑬)·J1(⑯)·J2(⑰)·J3(⑳)·운영 API(㉗) | 기록·통계 조회, 세션 정보 | 관계형 데이터는 DB가 맞음. 서비스마다 자기 담당 테이블만. DB PC가 꺼지면 io-api가 뜨지 않음(상시 가동은 DB 담당) |
| 학습 환경 (GPU PC .108, ML) | 참가자 CSV로 수동 학습 | 앱에서 내보낸 CSV (㉑) | 모델 파일 → 추론 (㉒) | 라벨링이 필요해 수동이 맞음. 참가자 CSV는 저장소에 올리지 않음 |

## 운영

운영 스택은 바깥에 열지 않습니다(SSH 22만). 처리 서비스(8080)·추론(8000)·io-api(8090)·web(8088)·Redis·Kafka(9092)는 127.0.0.1, 9094는 GPU PC 전용입니다(DN-66).

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| Docker Compose | 서버 PC 컨테이너(api-server·inference-service·Kafka·Redis·HDFS·Spark, 프로필 `io`의 io-api·io-inference·web·gateway, 프로필 `edge`의 cloudflared)를 한 파일로. 서버에서는 원래 저장소에서만 실행, `up`은 `--no-build` | `infra/compose/bigdata.yaml`, `infra/compose/.env`(서버 주소·DB·포트·이미지 태그·공개 출처·판정 경로), `secrets/`(JWT 서명 키·터널 토큰·Discord 비밀값) | 컨테이너·포트·볼륨·KST·메모리 제한·로그 회전 | 같은 구성 재현. 환경마다 다른 값은 `.env`·`secrets/`로 두어 K8s ConfigMap·Secret으로 그대로 |
| 운영 API (api-server) | 시험용 입구(`POST /api/realtime/features`), 판정(`/judge/*`)·서비스 DB 확인(`/store/service-db`)·저장(`/report/*`) 조회, 시험 행 | SSH 터널(㉔), 통합 테스트(㉕) | `posture.features` 발행(㉖), MySQL 조회·시험 행(㉗) | 앱 없이 단계별 검증 |
| 통합 테스트 (`tools/platform/integration_test.sh`) | `.env`·비밀값·컨테이너·Kafka·Redis·HDFS·Spark·서비스 DB·판정·DLQ·재시작 복원·결과 저장·io-api REST·WebSocket 왕복·화면 경유·공개 입구(`gateway`·터널·공개 주소) 점검(0~17단계, 7단계 없음 — 15~17은 Spark 배치) | 재생 도구·`io_api_smoke.py`·`ws_realtime_smoke.py`가 만든 합성 계정·세션 | 단계별 PASS/FAIL, `tools/platform/it-results/` | "Done = 서버에서 확인"의 근거, 회귀 확인. 11/20 `--quick` PASS 99 / FAIL 0 / SKIP 2, `--kafka`(io-api를 잠시 kafka로) PASS 104 / FAIL 0 / SKIP 2 |
| 통신 시험 도구 (`tools/platform/comm_test_guided.py`) | 사용자 흐름 순서(S0~S12: 준비·로그인·Discord 로그인·알림 설정·측정 시작·확정·재알림·늦은 알림 없음·고개 돌림·정상 종료·저장 지연과 S4·창 닫기·기록 화면·Kafka lag)로 `gateway`를 거쳐 통신과 Kafka 신호를 하나씩 확인, 실패하면 다시·계속·끝 선택 | 시험 계정, `--mode`·`--login`·`--api-prefix` | 결과 파일 `tests/comm-test-results/`(저장소 제외) | FE와 같은 흐름을 서버에서 재현. 11/20 develop 기본 명령 S0~S12 PASS |

나중에 더할 것: 운영 기본값 kafka(별도 결정) → API 안 판정·io-inference 삭제(4단계), 저장소 전환 별칭 정리(D-94), 옛 토픽·보존 주기(D-82), CI/CD(D-09), MSA·K8s 이전(D-83).
