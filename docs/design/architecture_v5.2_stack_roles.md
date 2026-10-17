# 아키텍처 v5.2 스택별 역할

> 최종 갱신: 2026-10-16 · DevOps/BE · 연결 번호(①~㉙)는 `자세 분석 플랫폼 아키텍처 v5.2.html`의 연결표와 같습니다.
> 바꾼 점은 `architecture_v5.2_change_notes.md`.

바깥(앱·팀원 PC)과는 API로만, 서버 안 서비스끼리는 Kafka로만 주고받고, 각 서비스는 자기 담당 테이블만 DAO로 씁니다. 적재·분석은 cron이 Spark 배치(J1·J2·J3)를 실행해 HDFS 사용자별 폴더에 둡니다.
실시간 판정은 **상태머신**으로 합니다. CEP(Esper 등 복합 이벤트 처리 엔진)는 쓰지 않습니다.

## 한눈에

| 층 | 스택 | 한 줄 역할 | 상태 |
|---|---|---|---|
| 입출구 | 입출구 서버 (팀 `backend/api`, `auth`·`api`·`ws`) | 바깥 입구 하나 — 계정·설정·기록(`/v2`), 실시간·등록(`/v2/realtime`) | REST 서버 배포 완료(10/16, 점검 19개 PASS) · `ws`는 PM 구축 · D-48 |
| 처리 서비스 | 추론 서비스 | 0.5초 좌표 구간 → good/bad 확률, 등록 평균 좌표 | 규칙 기준 완료(서버 PC 테스트) · 좌표 입력 D-34 · GPU 이전 D-31 |
| 처리 서비스 | 판정 서비스 | 확률 흐름 → 붕괴 확정·재알림·복귀 사건 | 완료 · DN-39~41 |
| 처리 서비스 | 판정 결과 저장 | 사건·알림·세션 종료를 DB에, 표시할 알림 발행 | 저장 완료 · DN-46·47 · 알림 발행 D-54 |
| 실시간 | Kafka | 서비스 간 메시지 통로·버퍼 (보존 3일) | 완료 · DN-38 |
| 실시간 | Redis | 판정 상태 | 완료 · DN-41 |
| 적재·분석 | cron (서버 PC) | Spark 잡을 정해진 시각에 실행 | 안 함 · D-33·D-49 |
| 적재·분석 | Spark 배치 (J1·J2·J3) | J1 적재 매시간 · J2 일별 통계 00:00 · J3 탈퇴 삭제 04:00 | 안 함 · D-33·D-05·D-49 |
| 적재·분석 | HDFS | 판정 과정을 사용자별 폴더에 보관 | 동작 중 · 시험 적재분 정리 D-56 |
| 외부 | MySQL | 계정·결과·통계·파일 위치 영구 저장 (V2.3) | 서버 DB V2.3 · 우리 코드 맞춤 완료 DN-47 |
| 외부 | 학습 환경 | CSV로 수동 학습 → 모델 파일 | ML 담당 |
| 운영 | Docker Compose | 서버 PC 컨테이너 배치·설정 | 동작 중 · 환경 값 `.env`화 DN-48 |
| 운영 | 운영 API | 시험용 입구·판정·저장 확인 | 동작 중 · 노출 정리 D-43 · 이름 정리 D-53 |
| 운영 | 통합 테스트 | 앱 없이 처음부터 끝까지 확인 | 완료 · DN-34 |

## 입출구 층 (앱과 직접 통신)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 입출구 서버 (팀 `backend/api`, Spring Boot 1대) | `auth`: 가입·로그인·로그아웃·비밀번호·탈퇴 접수(삭제는 J3) / `api`: 설정·기준 조회·세션 행·끊긴 뒤 종료·기록·통계(`/v2`) / `ws`: 좌표 받기·등록 전용 연결·세션 메시지 발행·결과·알림 전달·로그인 1분 갱신(`/v2/realtime`) | 앱 HTTP(쿠키 세션 + CSRF, ①), WebSocket `hello`(`purpose`)·`features`(구간 1개, 약 2~7KB)·`end`(②), Kafka `inference.v1`·`episodes.v1`·`alerts.v1`(⑤⑥) | MySQL(③), Kafka `features.v1`에 `session_started`(기준 좌표 첨부)·`features`·`session_ended`·등록 프레임(④, `ws`만), 앱에 `ready`·`ack`·`observation`·`progress`·`decision`·`alert`·`stalled`·`calibration_result`·`closed` | 앱이 주소 하나만 알면 되고 바깥 포트도 하나(D-43). 같은 앱이라 WebSocket이 HTTP 로그인을 그대로 씀. 세션 메시지를 `ws` 한 곳에서만 내 순서가 지켜짐. 패키지끼리는 공개 인터페이스로만 불러 나중에 서비스로 분리 가능. 측정 중 끊기면 세션을 끝냄(재연결 없음) |

분담: 일반 REST(`auth`·`api`)와 배포는 DevOps/BE, `ws`는 PM(`ws_구축가이드_PM.md`).

## 처리 서비스 층 (Kafka 비동기)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| 추론 서비스 (Python, GPU PC) | 0.5초 좌표 구간마다 판정 가능 검사·특징값·점수·고개 돌림·복귀 대기 계산, 등록 프레임으로 평균 좌표 18개. 지금 규칙 기준, 나중에 LSTM | `features.v1` (⑦, Kafka 9094) — 세션 시작 메시지의 기준 좌표로 기준 특징값 계산 | `inference.v1`: 확률·`valid_ms`·`invalid_reason`, `calibration_result` (⑧) | 모델 계산을 떼어 GPU에서 돌림. 모델이 바뀌어도 판정·서버는 그대로. 구현 전 테스트는 같은 서비스를 서버 PC에서(㉓) |
| 판정 서비스 (처리 서비스 `backend/processing`, 컨테이너 `api-server`의 상태머신) | 확률 흐름을 시간 규칙(3초 확정·3초 복귀·60초 재알림)으로 묶어 사건을 만듦. CEP 엔진을 쓰지 않음 | `inference.v1` (⑨), Redis 판정 상태(⑪) | `episodes.v1`: 사건 5종·`progress`·세션 요약 (⑩), 처리 못 한 메시지는 `posture.dlq` (⑲) | 이어지는 상태를 봐야 알림이 끝없이 울리지 않음. 규칙이 단순해 상태머신으로 충분하고 메모리를 아낌. DB에 쓰지 않아 DB가 느려도 판정 계속 |
| 판정 결과 저장 (처리 서비스 `report`) | 사건·알림 시도·세션 종료를 DB에 기록, 알림 표시 판단(세션 알림 꺼짐·10초 지난 사건 제외) | `episodes.v1` (⑫), `monitor_session`(시작 시각·`alert_enabled`·정책) | `collapse_event`·`correction_alert`·세션 종료 값(`ended_at`·`good_sec`) (⑬), 표시할 알림 `posture.alerts.v1` (㉙, D-54), DLQ (⑲) | 판정과 DB를 나눠 DB 장애 때 이 그룹만 기다림. 종료 값은 여기서만(C-1), 재전송에도 같은 행(C-3). 화면 알림과 기록이 같은 규칙 한 곳 |

## 빅데이터 플랫폼 · 실시간

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| Kafka (브로커 1대, KRaft) | 서비스 간 메시지를 토픽에 쌓아 두고 순서대로 나눠 줌. 키 `session_id`(등록은 `calibration_id`), 파티션 3 | `features.v1`·`inference.v1`·`episodes.v1`·`alerts.v1`·`posture.dlq` | 같은 메시지를 여러 소비자에게(예: `episodes.v1` → 저장·적재·입출구 서버) | 서비스끼리 주소를 몰라도 됨(MSA 대비). 추론이 느려도 입력이 쌓였다 이어서 처리. 보존 3일(DLQ 7일) — 사용자별로 지울 수 없어 30일보다 짧게 |
| Redis | 판정 상태(TTL 1시간), `ws`의 시작·종료 발행 표시와 마지막 발행 순번. 입출구 서버를 여러 대로 늘리면 로그인 세션·인스턴스 라우팅(⑱) | 판정 상태(⑪) | 재시작 때 판정 상태 복원 | 메모리에만 두면 재시작에 사라지는 상태를 지킴(DN-41). 재연결이 없어 최근 결과는 두지 않음 |

## 빅데이터 플랫폼 · 적재·분석

이 층은 실시간 경로에 들어가지 않아 멈추거나 느려도 판정과 알림은 그대로입니다.

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| cron (서버 PC) | `docker exec spark spark-submit`으로 J1 매시간, J2 매일 00:00, J3 매일 04:00 | 시간표 | 잡 실행 (㉘) | Spark가 상주하지 않아 잡이 도는 동안만 메모리 사용. 새 인프라 필요 없음 |
| Spark 배치 J1 적재 | v1 토픽 3개를 쌓인 만큼 읽고 끝남(`availableNow`, 체크포인트). 임시 폴더 → 끝난 세션을 사용자별 폴더의 세션 파일로. 5분 미만 세션도 적재 | `features.v1`·`inference.v1`·`episodes.v1` (⑭) | HDFS `/data/users/{user_account_id}/{날짜}/{session_id}/` (⑮), `feature_archive` 행 (⑯) | 판정을 재현·분석할 원본이 남음. 실패해도 보존 3일 안에 이어 감 |
| Spark 배치 J2 집계 | 매일 00:00 전날(KST) 결과를 사용자별 일별 통계로 | 결과 테이블(`monitor_session`·`collapse_event`·`correction_alert`·`excluded_interval`) (⑰) | `daily_stat` (⑰) | 대시보드가 미리 계산된 행만 읽음. 5분 미만 세션은 붕괴까지 시간 계산에서만 뺌 |
| Spark 배치 J3 삭제 | 탈퇴 30일 뒤 그 사용자의 폴더와 행을 지움 | `deletion_request` | 사용자 폴더 삭제 → `feature_archive.deleted_at` → 행 → 요청 완료 (⑳) | 개인정보를 정해진 순서로 빠짐없이. 적재된 기록은 사용자가 따로 지울 수 없어(`RECORD_ARCHIVED`) J3만 지움 |
| HDFS (NameNode·DataNode) | 판정 과정을 사용자별 폴더의 Parquet로 보관 | J1 (⑮) | J3이 지울 폴더 (⑳) | 하루 약 5GB(50명·8시간, FE 추정)의 시계열은 MySQL보다 파일 저장소가 맞음. 학습 환경과는 연결하지 않음 |

## 외부 (서버 PC 밖)

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| MySQL 8.0 (.107, `posture_service` V2.3) | 계정·동의·설정·기준 자세(등록마다 새 행), 세션·사건·알림, 파일 위치, 일별 통계 | 입출구 서버(③)·판정 결과 저장(⑬)·J1(⑯)·J2(⑰)·J3(⑳)·운영 API(㉗) | 기록·통계 조회, 세션 정보 | 관계형 데이터는 DB가 맞음. 서비스마다 자기 담당 테이블만. 외부 서버라 서버 PC를 재구성해도 남음 |
| 학습 환경 (GPU PC .108, ML) | 참가자 CSV로 수동 학습 | 앱에서 내보낸 CSV (㉑) | 모델 파일 → 추론 (㉒) | 라벨링이 필요해 수동이 맞음. 참가자 CSV는 저장소에 올리지 않음 |

## 운영

운영 스택은 바깥에 열지 않습니다(SSH 22만).

| 스택 | 역할 | 입력 | 출력 | 왜 필요한가 |
|---|---|---|---|---|
| Docker Compose | 서버 PC 컨테이너(api-server·추론·Kafka·Redis·HDFS·Spark, 프로필 `io`의 io-api·io-inference)를 한 파일로 | `infra/compose/bigdata.yaml`, `infra/compose/.env`(서버 주소·DB·포트·이미지 태그·비밀값) | 컨테이너·포트·볼륨·KST·메모리 제한·로그 회전 | 같은 구성 재현. 환경마다 다른 값은 `.env`로 두어 K8s ConfigMap·Secret으로 그대로 |
| 운영 API (api-server) | 시험용 입구, 판정(`/judge/v1/*`)·저장(`/report/*`) 조회, 시험 계정·세션 행 | SSH 터널(㉔), 통합 테스트(㉕) | `features.v1` 발행(㉖), MySQL 조회·시험 행(㉗) | 앱 없이 단계별 검증. 8080이 LAN에 열려 있어 정리 필요(D-43) |
| 통합 테스트 (`tools/platform/integration_test.sh`) | `.env`·컨테이너·Kafka·Redis·HDFS·Spark·서비스 DB·종단 판정·결과 저장·io-api REST 점검 | 재생 도구가 만든 시험 세션 | 단계별 PASS/FAIL, `tools/platform/it-results/` | "Done = 서버에서 확인"의 근거, 회귀 확인(DN-34) |

나중에 더할 것: CI/CD(D-09), K8s 이전, 서비스별 지연·lag 지표(T-14 뒤).
