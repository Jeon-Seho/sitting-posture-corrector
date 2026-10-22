# 아키텍처 v5.2 변경 안내

> 최종 갱신: 2026-10-16 · DevOps/BE
> 구성도·연결표: [자세 분석 플랫폼 아키텍처 v5.2 외부 원본](https://claude.ai/artifact/ToNH9pTwBDWbjTsg3iZpVX)
> 저장소 문서: [스택별 역할](architecture_v5.2_stack_roles.md) · [아키텍처](../architecture.md) · [결정 이력](../decisions/) · [API 명세](api-spec.md) · [FE 연동 명세](api-ws-spec.md)
> 이 문서가 인용한 저장소 밖 원문은 아래 [외부 원본 참조](#외부-원본-참조)에서 구분한다.

**자세 분석 플랫폼 아키텍처를 v5.2로 갱신했습니다.** v5의 큰 틀(앱은 입출구 서버 하나와만, 서버 안은 Kafka로만, 학습은 CSV 수동)과 v5.1의 적재·분석 배치(cron → Spark → HDFS 사용자별 폴더)는 그대로입니다. v5.2는 10/13~10/14 FE·DB와 정한 API 명세를 반영해 **입출구 서버를 팀 `backend/api` 위에 만들고, 재연결을 없애고, 알림 판단과 자세 등록 경로를 확정**한 판입니다.
실시간 판정은 처음부터 **상태머신**입니다. CEP(Esper 등 복합 이벤트 처리 엔진)는 쓰지 않으며, v1 판정 경로에 남아 있던 `cep` 이름은 D-53(10/17)에서 `judge`로 바꿨습니다(운영 API `/judge/v1/*`, 그룹 `judge-v1`). `cep`는 옛 `posture.summary` 경로에만 남고 D-38에서 함께 지웁니다.

## v5.1 → v5.2 무엇이 바뀌었나 (10/14)

| 항목 | v5.1 | v5.2 | 이유 |
|---|---|---|---|
| 입출구 서버 | 새 Spring Boot 앱(`/api`, `/ws`) | **팀 `backend/api` 위에 만듦** — REST `/v2/**`, WebSocket `/v2/realtime`. 안의 메모리 판정을 빼고 `ws`가 Kafka로 발행·구독 | 계정·설정·기준 조회 REST가 이미 앱과 연결돼 있음 |
| 연결이 끊길 때 | 재연결(`hello last_event_id`), Redis에 최근 결과를 두고 다시 보냄(D-42) | **측정 중 끊기면 세션 종료, 재연결 없음**(ADR 0024). 서버가 마지막 `end_ms`로 끝냄(`DISCONNECTED`) | 재전송·중복 처리 없이 단순하게, FE 동의 |
| 입출구 서버 ⇄ Redis ⑱ | 최근 결과·시작 발행 표시 | **여러 대로 늘릴 때만**(로그인 세션 공유·인스턴스 라우팅) | 재연결이 없어 최근 결과 저장이 필요 없음 |
| 알림 표시·억제 | 검토 중(앱 / `ws` / 저장 서비스) | **판정 결과 저장이 판단 → `posture.alerts.v1` → `ws` → 앱**(새 연결 ㉙) | 화면 알림과 DB 기록이 같은 규칙 한 곳에서 나옴(N6) |
| 자세 등록 | 앱 계산 / 서버 계산 미정 | **등록 전용 WebSocket 연결**(`purpose: calibration`) → 추론이 관절 평균 좌표 18개 계산 → `ws` → `api`가 `baseline_posture` 새 행 | 측정과 분리, 앱·서버가 따로 계산하지 않음(N1) |
| 측정 종료 | WebSocket `end` 제안 | **확정**. 연결이 이미 끊겼으면 `api` 종료 요청 → `ws` 공개 인터페이스로 발행 | 세션 메시지 발행은 `ws` 한 곳 |
| 입력 본문 | 특징값 변화량(입력 v2) | **관절 9개 좌표 프레임**(`schema_version 3.0`, `keypoints-9-v1`), 메시지마다 구간 1개, 영상 크기 없음 | 판단은 전부 서버(FE 10/09 회신) |
| 서비스 DB | V2.1 | **V2.3**(팀 `backend/api` 기준) — `user_consent` 추가, `correction_alert` 키 변경, 기준 특징값은 저장 안 함 | 서버 DB가 이미 최신화됨, 우리 코드는 D-51에서 맞춤(10/16 완료) |
| 짧은 세션 | 5분 미만은 저장 안 함(10/12 회의) | **모두 저장**. 5분은 붕괴까지 시간 통계에서만 뺌 | 10/14 결정 |
| 적재 기록 삭제 | 정하지 않음 | 사용자가 지울 수 없음(`409 RECORD_ARCHIVED`), 탈퇴 J3 때만 | 적재 기록 삭제 배치를 만들지 않음 |
| Kafka 토픽 | `features`·`inference`·`episodes`·`dlq` | + `posture.alerts.v1` | 알림 판단 결과 |
| 연결 | 28개 | **29개** — ㉙ 판정 결과 저장 → `alerts.v1` | |

**담당별 영향**

| 담당 | 달라지는 것 | 할 일 |
|---|---|---|
| FE | 주소 `/api/v2/…`(중계가 `/v2/…`로), WebSocket `/api/v2/realtime`. `hello`에 `purpose`, `ready`를 받은 뒤 전송, 끊기면 재연결하지 않음, 등록은 따로 연결 | API 명세 #12·#13 회의, 계약 파일(`lee_app3`) 갱신(#15) |
| PM(`ws`) | 팀 `backend/api`의 `/v2/realtime`을 Kafka 중계로 — 세션 메시지 발행, 결과·알림 전달, 등록 연결 | 외부 `ws_구축가이드_PM.md`([참조 안내](#외부-원본-참조)), 저장소의 [Kafka 전환 계획](../plans/active/0031-realtime-kafka-transition.md) |
| DevOps/BE(입출구 REST·배포) | 팀 `backend/api`를 서버 compose에 배포(10/16 완료), `ws`가 쓸 공개 인터페이스(`MeasurementSessions`), REST를 Kafka 경로로 | D-48 2단계, D-43 |
| DevOps/BE(처리 서비스) | 판정 결과 저장에 알림 토픽 발행, 종료 사유 계약, 좌표 입력·등록 계산(추론), `cep` 이름 정리 | D-54·D-55·D-34·D-35·D-53 |
| DB | V2.3 기준. 배치 번호(J1 적재·J2 집계·J3 삭제)로 문서 최신화 | 문서 갱신 |
| ML | 추론 입력이 좌표 프레임, 등록 계산 추가 | 점수 방식(N3) 회신 |

## v5 → v5.1 무엇이 바뀌었나 (10/12)

**적재·분석을 v4 방식인 cron → Spark 배치 → HDFS로 되돌렸습니다.** 상주 적재 서비스가 없어지고, 서버 PC cron이 Spark 잡 3개를 정해진 시각에 실행합니다.

| 항목 | v5 | v5.1 | 이유 |
|---|---|---|---|
| 적재 | 적재 서비스(posture-sink, 상주 스트리밍) | cron → **Spark J1** 매시간(`availableNow`, 체크포인트) | 잡이 도는 동안만 메모리 사용, 실패해도 다음 실행이 이어 감 |
| 일별 통계 | Spark 집계(실행 주체 미정) | cron → **Spark J2** 매일 00:00(전날 KST) → `daily_stat` | 실행 시각·주체를 cron 한 곳에서 |
| 탈퇴 삭제 | 입출구 서버 `auth`의 삭제 배치 | cron → **Spark J3** 매일 04:00, `auth`는 탈퇴 접수만 | HDFS·DB를 함께 지우는 배치라 배치 층에 둠 |
| HDFS 구조 | 날짜 폴더, 세션별 파일 | **사용자별 폴더** `/data/users/{user_account_id}/{날짜}/{session_id}/`, 위치는 `feature_archive` | 탈퇴 때 폴더 하나만 지움 |
| 보존 주기 | 정하지 않음 | Kafka v1 3일, DLQ 7일, Redis TTL — 모두 30일보다 짧게 | Kafka는 사용자별로 지울 수 없음 |
| 연결 | 27개 | 28개 — ㉘ cron → Spark | |

## v4 → v5 무엇이 바뀌었나 (10/11)

| 항목 | v4 | v5 | 이유 |
|---|---|---|---|
| 앱 입구 | 게이트웨이 + user·realtime·report 서비스 | **입출구 서버** 하나(`auth`·`api`·`ws`) | 로그인 확인·세션 순서·측정 중 탈퇴를 한 앱에서 |
| 층 구조 | 서비스 나열 | 입출구 층(앱과 직접) / 처리 서비스 층(Kafka) / 빅데이터 / 운영 | 통신 방식이 한눈에 |
| 판정 | 별도 realtime-service | 처리 서비스(api-server) 상태머신(A안) | 1차 회의 |
| Kafka 토픽 | keypoints·inference·baselines·episodes·dlq | `features.v1`·`inference.v1`·`episodes.v1`·`posture.dlq`, 키 `session_id`, 0.5초 구간 1건 | 실시간 계약 v1 |
| 판정 결과 기록 | 판정이 DB에 직접 | 판정은 DB를 쓰지 않고 판정 결과 저장이 기록, 과정은 HDFS | 처리량, DB 장애에도 판정 계속 |
| 서비스 DB | `posture_app`·마트 | DB 담당 확정 스키마, 서비스별 DAO | 유지보수 |
| 학습 | HDFS → Spark J2 → GPU PC | CSV 수동, HDFS 연결 없음 | 구축·포트 줄임, 참여자 데이터 보호 |
| 운영 | — | 바깥 포트는 입출구 서버 하나, 운영 API는 SSH 터널 | 보안 |

## v5.2 구성 한눈에

| 층 | 구성요소 | 하는 일 | 담당 |
|---|---|---|---|
| 입출구 층 (앱과 직접) | 입출구 서버(팀 `backend/api`) `auth`·`api`·`ws` | 계정·설정·기준 조회·세션 행·기록·통계(`/v2`), 좌표 받기·등록·결과 보내기(`/v2/realtime`) | REST·배포 DevOps/BE, `ws` PM (D-48) |
| 처리 서비스 층 (Kafka) | 추론 서비스 (GPU PC) | 0.5초 좌표 구간 → 나쁜 자세 확률, 등록 평균 좌표 | ML(모델) · DevOps/BE(배포) |
| ″ | 판정 서비스 (`backend/processing`, 상태머신) | 붕괴 확정·재알림·복귀 사건 (3초·3초·60초) | DevOps/BE |
| ″ | 판정 결과 저장 (`backend/processing` `report`) | 사건·알림·세션 종료를 DB에, 표시할 알림을 `alerts.v1`로 | DevOps/BE |
| 빅데이터 · 실시간 | Kafka · Redis | 서비스 간 통로 · 판정 상태 | DevOps/BE |
| 빅데이터 · 적재·분석 | cron · Spark J1·J2·J3 · HDFS | 적재 매시간 · 일별 통계 00:00 · 탈퇴 삭제 04:00 · 사용자별 폴더 | DevOps/BE |
| 외부 | MySQL(.107, V2.3) · 학습 환경(GPU PC) | 계정·결과·통계 · CSV 수동 학습 | DB · ML |
| 운영 | Docker Compose · 운영 API · 통합 테스트 | 배포·확인 (SSH 터널) | DevOps/BE |

## 변경 이력

| 버전 | 날짜 | 주요 변경 |
|---|---|---|
| v4 | 10/02 | 팀 설계안 |
| v4.1 | 10/10 | 앱 통신은 입출구 API 하나, 입출구 → 서비스 → 빅데이터 층 구조, 학습은 CSV 수동 |
| v4.2 | 10/11 | 바깥은 API 명세(REST + WebSocket), Kafka는 서버 안. 연결 번호 ①~㉗ |
| v4.3 | 10/11 | 추론은 GPU PC에만(테스트는 서버 PC ㉓), 서비스별 DAO, 시나리오 21개로 확정 검토(R-1~R-11) |
| v4.4 | 10/11 | 입출구를 Spring Boot 앱 하나(`auth`·`api`·`ws`)로 통합 |
| v5 | 10/11 | 최종 검토, 층 이름(입출구 층·처리 서비스 층), 패키지끼리는 공개 인터페이스로만 |
| v5.1 | 10/12 | 적재·분석을 cron → Spark 배치 → HDFS 사용자별 폴더로, 삭제는 J3으로, 보존 주기, ㉘ |
| v5.1 수정 | 10/13 | 일별 통계 매일 00:00 전날 집계, 잡 이름 J1 적재·J2 집계·J3 삭제 |
| **v5.2** | **10/14** | 입출구 서버 = 팀 `backend/api`(`/v2`, `/v2/realtime`), 재연결 없음, 알림 토픽 ㉙, 등록 전용 연결, 좌표 입력 v3, DB V2.3, 5분 미만도 저장, 연결 29개 |
| v5.2 문서 | 10/16 | 구성 변경 없음. 문서 이름 영문화(`architecture_v5.2_change_notes.md`·`architecture_v5.2_stack_roles.md`), 판정은 상태머신·CEP 미사용 표현 통일, 상태 갱신(D-51·D-30 완료, 입출구 REST 배포, `ws`는 PM) |

외부 원문의 남은 안건은 `결정기록.md`의 "남은 안건" 절을 뜻합니다. 원문 접근 안내는 아래 표를, 저장소의 전환 작업은 [Kafka 전환 계획](../plans/active/0031-realtime-kafka-transition.md)을 확인합니다.

## 외부 원본 참조

아래 원문은 저장소에 포함되어 있지 않다. 문의 담당은 관련 작업의 담당이며, 작성자나 원문 내용의 동일성을 뜻하지 않는다. 저장소 문서는 위 링크에서 확인한다.

| 인용 원문 | 확인 가능한 판본 | 접근 안내·문의 담당 |
|---|---|---|
| `자세 분석 플랫폼 아키텍처 v5.2.html` | v5.2 | [기존에 공유된 원본 페이지](https://claude.ai/artifact/ToNH9pTwBDWbjTsg3iZpVX). DevOps/BE에 문의 |
| `사용자데이터_입출력시나리오_v5.2.md` | 파일명 기준 v5.2 | 공유 주소 미기재. DevOps/BE에 원문 위치 확인 |
| `결정기록.md` | 개별 판본·갱신일 미기재 | 공유 주소 미기재. DevOps/BE에 원문과 "남은 안건" 절 확인 |
| `FE_BE_API명세_2026-10-14.md` | 파일명 기준 2026-10-14판 | 공유 주소 미기재. BE에 원문 위치 확인. 현재 저장소의 API 설명은 [API 명세](api-spec.md)에서 확인 |
| `ws_구축가이드_PM.md` | 개별 판본·갱신일 미기재 | 공유 주소 미기재. PM(`ws` 담당)에 원문 위치 확인 |
