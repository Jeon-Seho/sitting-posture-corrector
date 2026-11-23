# 아키텍처 v5.5 변경 안내

> 최종 갱신: 2026-11-22 · DevOps/BE (v5.5 — D-57 develop 병합(#134), 주소·토픽·그룹·경로의 버전 삭제(#138), 계정당 한 측정·D-98, DB V2.7)
> 구성도·연결표: [자세 분석 플랫폼 아키텍처 외부 원본](https://claude.ai/artifact/ToNH9pTwBDWbjTsg3iZpVX)(11/22 v5.5로 다시 게시)
> 저장소 문서: [스택별 역할](architecture_v5.5_stack_roles.md) · [아키텍처](../architecture.md) · [결정 이력](../decisions/) · [API 명세](api-spec.md) · [FE 연동 명세](fe/api-ws-spec.md) · [Kafka 명세](kafka-spec.md) · [실시간 계약](../../contracts/realtime/README.md) · [Spark 배치](../../bigdata/README.md)
> 이 문서가 인용한 저장소 밖 원문(`결정기록.md`·`파이프라인_구축현황.md` 등)은 아래 [외부 원본 참조](#외부-원본-참조)에서 확인한다.

**자세 분석 플랫폼 아키텍처 v5.5입니다.** 목표 구조는 v5.2와 같습니다. 앱은 입출구 서버 하나와만 통신하고, 서버 안은 Kafka로만 주고받습니다. 적재·분석은 cron → Spark → HDFS 사용자별 폴더로 합니다.
**v5.5(11/22)는 앱 경로의 Kafka 연결(D-57)이 develop에 들어가고(11/17, #134), 주소·토픽·컨슈머 그룹·Redis 키·HDFS 경로에서 버전 꼬리를 뺀 것(11/20, #138)을 반영한 판입니다.** 층·스택·연결 29개 번호는 그대로입니다. 운영의 판정 경로 기본값은 아직 **local**(입출구 서버 안 판정)이고, kafka로 바꿀지는 별도 결정입니다.

실시간 판정은 상태머신이며 CEP 엔진은 쓰지 않습니다.

## v5.4 → v5.5 무엇이 바뀌었나 (11/13 ~ 11/22)

| 항목 | v5.4(11/02 · 11/13 개정) | v5.5(11/22) | 근거 |
|---|---|---|---|
| `ws` Kafka 연결 ④⑤⑥ | DevOps/BE 브랜치(서버 확인, 병합 전) | **develop 병합(11/17, #134)** — `POSEGOOD_REALTIME_PIPELINE=kafka`면 `ws`가 프레임마다 `posture.features`를 내고 결과를 구독(그룹 `io-ws-io-api`)해 앱에 `observation`·`decision`·`progress`·`alert`를 보냄. 정상 종료(`closed(ended)`)는 저장 완료 `posture.stored`를 받은 뒤. **운영 기본값은 local 그대로** | DN-81(D-57) · 통신 시험 11/16·11/17 |
| 이름의 버전 | REST `/v2/**`, WebSocket `/v2/realtime`, 추론 `/v2/infer`, 토픽 `*.v1`, 그룹 `*-v1`, Redis `posture:v1:judge:*`, HDFS `*-v1` | **모두 버전 없음(11/20, #138, ADR 0049)** — REST `/auth/…`·`/workspace`·`/sessions/{id}`·`/records`…, WebSocket `/realtime`(공개 주소 `https://api.posegood.site/api/…`·`/api/realtime`), 추론 `/infer`, 토픽 `posture.features`·`inference`·`episodes`·`alerts`·`stored`·`keypoints`·`posture.dlq`, 그룹 `inference-service`·`judge`·`report-store`(`io-ws-io-api`는 그대로), Redis `posture:judge:{session_id}`, HDFS `/data/staging/realtime`·`/data/staging/keypoints`, 체크포인트 `j1-realtime`·`j1-keypoints`, 계약 파일 `contracts/realtime/kafka-*.schema.json`·`realtime-ws.schema.json`. 옛 `.v1` 토픽·옛 그룹·옛 임시 폴더는 되돌리기에 대비해 남겨 두고 나중에 정리 | D-94 · 저장소 계획 0097 |
| 공개 입구 전환 | — | 서버를 새 판으로 바꾼 뒤 Vercel 앱이 새 주소로 배포될 때까지 `gateway`에 **임시 별칭**(`/api/v2/…` → 새 주소)을 둠(11/18, #135). FE 배포·확인 뒤 서버에서 별칭 삭제(11/22), 저장소 `gateway.conf`의 별칭 블록·옛 Discord Redirect 정리는 남음 | D-94 |
| 저장 완료 토픽 | `posture.stored.v1`(브랜치) | `posture.stored`(kind `session_stored`, 키 `session_id`, 보존 3일) — 판정 결과 저장이 종료 값을 DB에 쓴 뒤 발행, `ws`가 받은 뒤 `closed(ended)`. 연결 번호는 ⑤에 포함 | D-57 ⑦ |
| 좌표 적재 토픽 | `posture.keypoints.v1`(브랜치) | `posture.keypoints` — `ws`가 features 뒤 같은 구간을 비동기 발행, 스위치 `POSEGOOD_ARCHIVE_KEYPOINTS` **기본 꺼짐**(좌표 활용 동의 범위 PM 확인 전). J1이 별도 쿼리·체크포인트·임시 폴더로 받아 세션 폴더 `keypoints.jsonl`. 연결 번호는 ④(발행)·⑭(J1 읽기)에 포함 | DN-83(D-92) |
| S4 세션 조회 | 안 A 공지(DB 먼저) | 구현 — ① 엔진이 끝낸 결과(local만) → ② DB에 끝난 값 → ③ 메모리(kafka는 받은 마지막 결과를 덧씌움) → ④ 404. kafka 모드는 `end` 뒤 저장 완료가 3초 없으면 `stalled` 한 번(측정 중은 5초) | DN-82(D-85) · DB/BE #119 |
| REST S3·R3 | 제거 결정 | **삭제(#121)**. 점검 도구도 뺌(REST 점검 20개) | DN-79(D-88) |
| 계정당 한 측정 | — | 같은 계정이 이미 측정 중이면 새 측정 시작이 409 `MEASUREMENT_IN_PROGRESS`(#127, DB/BE). kafka 모드에서 끝낸 세션이 「측정 중」으로 남던 문제는 종료 발행 뒤 「끝남」 표시로 고침(D-98, #136) | DN-86(D-98) |
| 로그인 | 토큰(ADR 0031) | 그대로 + **Discord 로그인**(#113 — 서버 `.env` Client ID·Redirect·`APP_URL`, Secret은 secrets 파일). 비밀번호 재설정 메일은 기본 꺼짐. 탈퇴는 비밀번호 없이 확인만(#131) | DN-78(D-87) |
| 서비스 DB | 운영 V2.6 · develop V2.7 | **운영 V2.7**(테이블 16 — `social_identity`·`password_reset_token`, migration 017). develop에는 V2.8 파일(018·019, 비밀번호 표 분리·이메일 인증)만 있고 V2.8용 API는 아직 없음 — 처리 서비스 확인 코드도 V2.7. 서버 DB에 016의 알림 기본값 변경이 빠져 새 계정 알림이 꺼짐으로 생기는 문제는 DB/BE 조치 대기(D-96) | DN-80(D-89) · D-96 |
| 앱이 받는 메시지 | `ack`가 먼저 오고 결과가 뒤따름(kafka) | 서버는 `ack`를 그대로 보내지만 **앱은 무시**(FE 요구 4, #137). 응답의 `schema_version`은 앱이 검사하지 않음, `calibration` 단계·고개 돌림 전용 안내 삭제 | FE #137 · ADR 0051 |
| 시험 | 통합 테스트 0~17단계 + `--kafka` | 그대로 + **단계 안내형 통신 시험 도구** `tools/platform/comm_test_guided.py` — 앱으로 할 일을 안내하고 gateway·Kafka·카운터·DB로 단계마다 판정(kafka·local). 11/20 `--quick --kafka` **PASS 104 / FAIL 0 / SKIP 2**, `--quick` **99 / 0 / 2**, 운영 앱 kafka 통신 시험 S0~S12 PASS(Discord 포함) | DN-85(D-97) |
| 연결 | 29개 | **29개 그대로.** ④⑤⑥이 「진행 중」 → 「완료」(운영 기본값은 local) | |

**연결 상태가 바뀐 곳 (11/22)**

| # | v5.4(11/13) | v5.5(11/22) | 메모 |
|---|---|---|---|
| ② 앱 ⇄ `/realtime` | 진행 중 | **완료** | local·kafka 두 모드 모두 공개 주소 wss 통과. 운영 기본값 local |
| ④ `ws` → `posture.features`(+ `posture.keypoints`) | 진행 중 | **완료** | develop 병합(#134). 좌표 적재는 스위치 꺼짐 |
| ⑤ 결과(`observation`·`posture.stored`) → `ws` | 진행 중 | **완료** | 그룹 `io-ws-io-api` |
| ⑥ `posture.episodes`·`posture.alerts` → `ws` | 진행 중 | **완료** | 알림 0.0~0.1초, 재알림 30초 간격(통신 시험) |

**담당별 영향 (11/22)**

| 담당 | 달라지는 것 | 할 일 |
|---|---|---|
| DB/BE | 주소·계약 이름에 버전 없음, S3·R3 없음, 계정당 한 측정 | V2.8 API(계획 0096)와 migration 018·019를 같은 점검 시간에, 알림 기본값(D-96), D-86 #4(local 열린 세션 닫기) |
| FE | 새 주소로 배포 완료, `ack` 무시 | 데스크톱 exe도 새 판으로, D-86 요청 회의 |
| PM | — | 운영 kafka 전환 결정, 좌표 적재 범위(D-92 스위치) |
| DevOps/BE | `ws` Kafka 연결·이름 변경·전환 별칭 끝 | 저장소 별칭 블록·옛 Redirect 정리(D-94), 옛 토픽·그룹·HDFS 경로 정리와 보존 주기(D-82), 운영 kafka 전환 뒤 J1 실제 세션(D-77)·4단계(API 안 판정·io-inference 삭제) |
| ML | 추론 주소 `/infer`(local 경로의 io-inference) | 모델이 나오면 교체 절차(㉒), GPU PC 이전(D-31) |

## v5.5 구성 한눈에 (11/22)

| 층 | 구성요소 | 하는 일 | 상태 (11/22) | 담당 |
|---|---|---|---|---|
| 바깥 | 화면(Vercel `app.posegood.site`) · Cloudflare(`api.posegood.site`, HTTPS·요청 제한·터널) | 사용자 화면 · 인터넷 입구 | 동작 · 새 주소로 배포(11/20) | FE |
| 입출구 층 (앱과 직접) | `cloudflared`(프로필 `edge`) · API 전용 `gateway`(nginx) | 터널 연결 · `/api/`·`/api/realtime`만 io-api로(`/api` 떼고), 그 밖 404 | 동작 · 호스트 포트 없음. 전환 별칭은 서버에서 삭제(저장소 정리 남음, D-94) | DevOps/BE |
| ″ | 입출구 서버 io-api(팀 `backend/api`) `auth`·`api`·`ws` | 계정·Discord 로그인·설정·기준·세션 행·S4·기록(`/auth`·`/workspace`·`/baselines`·`/sessions`·`/records`), 좌표 받기·결과 보내기(`/realtime`), 계정당 한 측정 | 동작 · 판정 경로 `local`(기본) / `kafka`(병합·시험 끝, 운영 전환은 별도 결정) | REST DB/BE · `ws` Kafka 연결·배포 DevOps/BE |
| ″ (서버 안 시험) | 화면 컨테이너 `web`(nginx) | 화면 + 같은 API(127.0.0.1:8088, SSH `-L`) | 동작 · REST도 포트 포함 Host 전달(D-94) | 배포 DevOps/BE · 화면 FE |
| ″ (전환 중) | io-inference(FastAPI `/infer`) | local 경로의 점수 계산 | 운영 kafka 전환 뒤 4단계에서 삭제 | DB/BE |
| 처리 서비스 층 (Kafka) | 추론 서비스(지금 서버 PC, 목표 GPU PC) | 0.5초 구간 → 나쁜 자세 확률(규칙 점수), 그룹 `inference-service` | 동작 · GPU 이전 D-31 | ML(모델) · DevOps/BE(배포) |
| ″ | 판정 서비스(`backend/processing` `judge`, 상태머신) | 붕괴 확정·재알림·복귀·제외 구간 사건·구간마다 관측, 그룹 `judge` | 동작 | DevOps/BE |
| ″ | 판정 결과 저장(`backend/processing` `report`) | 사건·알림·제외 구간·세션 종료를 DB에, 표시할 알림 `posture.alerts`, 저장 완료 `posture.stored`, 그룹 `report-store` | 동작 | DevOps/BE |
| 빅데이터 · 실시간 | Kafka · Redis | 서비스 간 통로(토픽 7개) · 판정 상태 `posture:judge:{session_id}` | 동작 · 옛 `.v1` 토픽 정리·보존 주기 D-82 | DevOps/BE |
| 빅데이터 · 적재·분석 | cron · `batch.sh` · Spark J1·J2·J3 · HDFS | 적재 매시간 20분(+ 좌표, 스위치 꺼짐) · 일별 통계 매일 00:10(최근 7일) · 탈퇴 삭제 매일 04:00(유예 30일) · 사용자별 폴더 | 동작 · J1 실제 세션은 운영 kafka 전환 뒤(D-77) | DevOps/BE |
| 외부 | MySQL(.107, `posture_service` 운영 V2.7 · develop V2.8 파일만) · 학습 환경(GPU PC) | 계정·결과·통계 · CSV 수동 학습 | 동작 · 알림 기본값 D-96 | DB · ML |
| 운영 | Docker Compose · 운영 API · 통합 테스트 · 통신 시험 도구 | 배포·확인(SSH 터널) | 동작 · 11/20 `--kafka` 104 / 0, local 99 / 0 | DevOps/BE |

## 지난 판의 변경 (이력)

아래 절은 그때의 이름(`/v2`·`.v1`·`-v1` 등)과 그때의 상태로 적혀 있습니다. 지금 이름과 상태는 위 「v5.4 → v5.5」 표와 「v5.5 구성 한눈에」를 보세요.

## v5.4 개정 무엇이 바뀌었나 (11/03 ~ 11/13)

구성(층·스택·연결 29개 번호)은 그대로입니다. **실시간 판정 Kafka 전환(D-57) 1단계가 브랜치에서 끝났고, 병합 조건과 남은 정리가 정해졌습니다.** 운영 기본값은 아직 local입니다.

| 항목 | v5.4(11/02) | v5.4 개정(11/11) | 근거 |
|---|---|---|---|
| J2 일별 통계 ⑰ | 매일 00:10, 전날만 | **매일 00:10, 어제~7일 전을 날짜마다 다시 계산해 바뀐 날만 다시 씀**(`batch.sh j2 --days 7`). 늦게 닫힌 세션도 그 날짜에 들어감. 7일보다 늦으면 `--date`로 직접 | DN-74(D-81, PR #100) |
| 배치 시각 (정리) | J1 매시간 20분 · J2 00:10 · J3 04:00 | 그대로 — **J1 `20 * * * *` · J2 `10 0 * * * … --days 7` · J3 `0 4 * * *`**(KST). J3의 30일은 실행 주기가 아니라 탈퇴 유예 기간. 저장소 일부 문서의 「J2 00:00」은 v5.1 시절 값 | 서버 crontab · D-90 |
| `ws` Kafka 연결(D-57 1단계) ④⑤⑥ | PM 대기 | **DevOps/BE가 브랜치에서 구현(11/10 사용자 결정)** — 측정 경로 분리(`local`/`kafka`), 프레임마다 `features.v1` 발행(묶지 않음), 브로커 확인 뒤 `ack`, 결과 구독(그룹 `io-ws-io-api`)으로 `observation`·`decision`·`progress`·`alert`, 결과 5초 없으면 `stalled`, 측정불가 30분 종료, 끊김·로그아웃·서버 종료 때도 `session_ended`. 서버 통합 테스트 `--kafka` **PASS 99 / FAIL 0 / SKIP 2**(직접·화면·터널 WebSocket 17/0, lag 0, DLQ 증가 0) | D-57 ①~⑥ |
| 관측 4.0 재료 | 추론 `inference.v1` → `ws` | **판정기가 구간마다 `episodes.v1` kind `observation`**(자세·`hold_ms`·`recovery_ms`)으로 내고 `ws`는 전달만. 판정 결과 저장은 이 kind를 건너뜀 | D-57 ③ |
| 저장 완료 이벤트(D-67) | 설계 전 | **새 토픽 `posture.stored.v1`**(kind `session_stored`, 키 `session_id`, 보존 3일) — 판정 결과 저장이 종료 값을 DB에 쓴 뒤 발행, `ws`는 이것을 받은 뒤 `decision(session_ended)` → `closed(ended)` | D-57 ⑦ |
| HDFS 좌표 적재 ⑭⑮ (11/13 추가) | J1이 v1 토픽 3개 원문만(특징 변화량·확률·판정 — **좌표 없음**) | **적재 전용 토픽 `posture.keypoints.v1`**(앱 좌표 구간 그대로, 보존 3일) — `ws`가 features 뒤 같은 구간을 비동기 발행(실패해도 측정 계속), 스위치 `POSEGOOD_ARCHIVE_KEYPOINTS` 기본 꺼짐(좌표 활용 동의 범위 확인 전). J1은 별도 쿼리·체크포인트·임시 폴더(`/data/staging/keypoints-v1`)로 받아 세션 폴더 `keypoints.jsonl`. 설계 의도(학습용 좌표 보관, 이번엔 저장만)에 맞춤 | D-92 · D-57 ⑩·⑩b |
| 병합 조건 | — | **FE 포함 전체 서비스 API·WS·Kafka 통신 시험 통과 뒤 develop 병합**(11/11 사용자). 그 전에 S4·FE 요청을 회의로 정리 | D-85·D-86 |
| S4 세션 조회 | 메모리만 | **DB에 끝난 세션이 있으면 DB 값, 없으면 메모리(kafka 모드는 `ws`가 받은 마지막 `progress`), 둘 다 없으면 404**(안 A, DB/BE 공지 11/11). 앱은 `end` 뒤 **5초**에 S4(10초 → 5초) | D-85 |
| REST S3·R3 | 있음(앱은 S3를 쓰지 않음) | **제거 결정(11/11 PM 의견)** — S3(연결 없이 종료)는 실제 서비스에서 쓰지 않고, 기록 삭제(R3)는 고려 대상이 아님. API 삭제는 DB/BE, 점검 도구는 DevOps/BE | D-88 |
| 자정 끊기 | 자정 넘김 설정 기본 꺼짐 | 그대로 꺼짐(운영 local·kafka 모두 자정에 끊지 않음). kafka 모드는 설정을 켜도 무시 → FE 요청: 00:00에 서버가 끝내고 `closed(day_changed)` | D-86 #6 |
| 서비스 DB | V2.6 | 운영 V2.6 · **develop V2.7**(PR #114: `social_identity`·`password_reset_token` — Discord 로그인·비밀번호 재설정, 기본 꺼짐). 운영 DB에 migration 017 적용 뒤 켬 | D-87·D-89 |
| io-inference 이미지 | — | Dockerfile이 `requirements-dev.txt`의 `-r` 줄을 빼고 설치(빌드 실패 수정) | DN-76(PR #104) |
| 통합 테스트 | 0~17단계, 11/01 94 / 0 | 0~17단계 + `--kafka`(io-api를 잠시 kafka로, lag·DLQ 확인 뒤 되돌림). 11/10 local **PASS 95 / FAIL 0 / SKIP 2** | DN-75·D-57 ⑥ |

**연결 상태가 바뀐 곳 (11/11)**

| # | 11/02 | 11/11 | 메모 |
|---|---|---|---|
| ④ `ws` → `features.v1` | 대기(PM) | **진행 중** | 브랜치 서버 확인, develop 병합 전 |
| ⑤ 결과 → `ws` | 대기(PM) | **진행 중** | 판정기 `observation`(episodes.v1)·`stored.v1` 포함 |
| ⑥ `episodes.v1`·`alerts.v1` → `ws` | 대기(PM) | **진행 중** | 그룹 `io-ws-io-api` |

**담당별 영향 (11/11)**

| 담당 | 달라지는 것 | 할 일 |
|---|---|---|
| DB/BE | S4를 DB 먼저(안 A), S3·R3 삭제 | develop에서 S4 변경, S3·R3 API·명세 삭제, 열린 채 남는 세션 닫는 규칙(S3 삭제 대체), 운영 DB migration 017 |
| FE | kafka 모드에서 `ack`가 먼저 오고 결과가 뒤따름, `progress` 약 1초, `closed`는 DB 저장 뒤 | FE 포함 통신 시험, S4 5초 대체 경로, Discord·재설정 빌드 변수 |
| PM | `ws` Kafka 연결은 DevOps/BE가 맡음 | — (가이드 `ws_구축가이드_PM.md`는 참고용) |
| DevOps/BE | D-57 브랜치 ①~⑦ | S4용 마지막 `progress` 보관·종료 뒤 `stalled` 3초(⑧ 제안), 통신 시험, 병합 뒤 운영 kafka 전환·보존 주기(D-82)·J1 실제 세션(D-77) |

## v5.3 → v5.4 무엇이 바뀌었나 (11/01 구축 · 11/02 문서)

구성(층·스택·연결 29개 번호)은 그대로이고, **적재·분석 층이 「계획」에서 「동작」으로** 바뀌었습니다. 이미 있던 `spark` 컨테이너에 잡 코드(`bigdata/jobs/`)를 읽기 전용으로 마운트하고, 서버 PC cron이 실행기 `tools/platform/batch.sh`를 불러 `docker exec spark spark-submit`으로 돌립니다(새 컨테이너·이미지 빌드 없음). 사용법은 저장소 `bigdata/README.md`, 결정·검증은 계획 0085, 팀 공유 안내는 「Spark 배치 J1·J2·J3 구축 안내」입니다.

| 항목 | v5.3 | v5.4 | 근거 |
|---|---|---|---|
| J2 일별 통계 ⑰ | 계획 — 매일 00:00 | **동작 — 매일 00:10**(자정 직전·자정 넘김 세션 저장 대기, FE BE-11). 전날(KST) **끝난 세션만** 시작 날짜에 넣고, 그날 행을 지우고 다시 넣기(한 트랜잭션). `ended_at` 빈 세션은 넣지 않음 | DN-70 · 통합 테스트 15단계 |
| J3 탈퇴 최종 삭제 ⑳ | 계획 — 매일 04:00 | **동작 — 매일 04:00.** 유예 30일 지난 `ACCOUNT_ALL`(`REQUESTED`·`FAILED`·멈춘 `PROCESSING`) → 사용자 폴더·`deleted_at` 확정 → 한 트랜잭션에서 적재 기록·세션·일별 통계·기준 자세·요청·계정 삭제. 실패는 되돌리고 `FAILED`. 성공하면 요청 행도 지워 `DONE`은 남지 않음 | DN-71 · 통합 테스트 16단계 |
| J1 HDFS 적재 ⑭⑮⑯ | 계획 — 매시간, Parquet 세션 파일 | **동작 — 매시간 20분.** Structured Streaming `availableNow` + 체크포인트 → 임시 폴더 `/data/staging/realtime-v1/topic=/date=`(Parquet, 7일) → 끝난 지 10분 지난 세션을 중복 빼고 `/data/users/{user_account_id}/{시작일}/{client_session_uuid}/`에 **파일 3개(토픽별 JSON Lines)** + `feature_archive` 1행. 지금 앱 측정은 Kafka를 거치지 않아 **실제 세션은 D-57 뒤부터** | D-33 · 통합 테스트 17단계 |
| cron ㉘ | 계획 | **등록(11/01)** — J2 `10 0 * * *`, J3 `0 4 * * *`, J1 `20 * * * *`(서버 시간대 KST). `batch.sh`가 잠금·로그 30일(`tools/platform/batch-logs/`)·끝 코드 | DN-70·71 |
| HDFS 폴더 | `/data/staging/{토픽}/date=/hour=` · `*.parquet` 세션 파일 | `/data/staging/realtime-v1/topic=/date=` · 세션 파일 `features`·`inference`·`episodes.jsonl` | 계획 0085 |
| 보존 주기 | Kafka v1 3일·DLQ 7일 | 그대로 목표. **토픽 설정은 아직 기본값**(D-49 남은 일). HDFS 임시 폴더 7일 정리는 J1이 함 | D-49 |
| 통합 테스트 | 0~14단계, PASS 80 / 0 | **0~17단계**(15 J2·16 J3·17 J1, 시험 계정 `test-*@example.invalid`만) — 11/01 PASS 94 / FAIL 0 / SKIP 2 | |
| 연결 | 29개 | **29개 그대로.** ⑭⑮⑯⑰⑳㉘이 「안 함」 → 「완료」 | |

**연결 상태가 바뀐 곳 (11/02)**

| # | v5.3 | v5.4 | 메모 |
|---|---|---|---|
| ⑭ v1 토픽 → J1 | 안 함 | **완료** | 첫 받기 10,104건. 실제 세션은 D-57 뒤 |
| ⑮ J1 → HDFS | 안 함 | **완료** | 시험 세션 파일 3개(172·172·90줄) |
| ⑯ J1 ⇄ MySQL | 안 함 | **완료** | `feature_archive` 1행 |
| ⑰ J2 ⇄ MySQL | 안 함 | **완료** | DN-70 |
| ⑳ J3 → HDFS·MySQL | 안 함 | **완료** | DN-71 |
| ㉘ cron → Spark | 안 함 | **완료** | 11/01 등록 |

**담당별 영향 (11/02)**

| 담당 | 달라지는 것 | 할 일 |
|---|---|---|
| DB/BE | `daily_stat`이 매일 00:10 뒤 어제까지 채워짐. J3가 탈퇴 최종 삭제를 맡음 | 통계 조회 API(T1)가 `daily_stat`을 읽음, DB README 「구현 상태」 갱신, J3의 `PROCESSING` 재처리·`DONE` 미기록 확인 |
| PM | J1 실제 적재가 `ws` Kafka 연결(D-57 1단계)에 달림 | 1단계 끝나면 알림 → 우리가 전환 시험과 함께 J1 재확인. 사용자 폴더 보존 기간·탈퇴 완료 안내 수단 결정 |
| ML | HDFS 세션 폴더 = 토픽별 JSON Lines 3개(좌표 없음) | HDFS ↔ 학습 환경은 연결 안 함. 쓰려면 형식·전달 방식을 같이 정하기 |
| FE | 변경 없음 | 기간 화면의 어제까지 값은 00:10 뒤 서버에 생김 |
| DevOps/BE | 배치 3개 운영 시작 | 첫 자동 실행 확인, 실패 알림(지금은 로그만), 토픽 보존 설정(D-49), D-57 3단계 |

## v5.3 개정 무엇이 바뀌었나 (10/27 ~ 10/31)

| 항목 | v5.3 처음 판(10/26) | v5.3 개정(10/31) | 근거 |
|---|---|---|---|
| 인터넷 공개 입구 | 보류(D-43) — 다른 PC는 SSH 포트 포워딩으로만 | **개통(10/29).** 화면 = Vercel `https://app.posegood.site`. API = `https://api.posegood.site` → Cloudflare 터널(`cloudflared` 컨테이너, compose 프로필 `edge`) → **API 전용 `gateway`(nginx, 호스트 포트 없음)** → io-api. `gateway`는 `/api/`·`/api/v2/realtime`만 넘기고 그 밖은 404. 출처는 REST·WebSocket 모두 `https://app.posegood.site` 하나(CORS는 io-api가 답함) | DN-66 · 결정기록 10-28·10-29 |
| 처리 서비스·추론 포트 | 8080·8000이 LAN에 열림 | **127.0.0.1만.** 다른 PC에서 볼 때는 SSH `-L` | DN-66 |
| 화면 컨테이너 `web` | 앱 입구(①② 앞 구간) | **서버 안 시험용**으로 남김(127.0.0.1:8088, SSH `-L 8088`). 사용자 입구는 Vercel + `gateway` | DN-66 |
| 로그인 | 쿠키 세션 + CSRF(`SPRING_SESSION`) | **토큰(ADR 0031)** — access 30분(`Authorization: Bearer`), refresh 쿠키 `posegood_refresh` 14일(HttpOnly·Secure), A8 `POST /v2/auth/refresh`, CSRF·A1 삭제. WebSocket은 `hello.access_token`을 연결 때 한 번 확인. 서명 키는 secrets 파일 | DN-63·64 · 결정기록 10-27 |
| 서비스 DB | V2.3(코드는 V2.4) | **V2.6** — `refresh_token`, 기준 자세 등록 식별자(`client_registration_uuid`) 등. 새 계정 알림 기본값 켜짐 | DN-65 |
| 자세 등록 | 목표: 등록 전용 WebSocket → 추론 계산(D-35) | **WebSocket 등록 삭제(10/27).** 앱이 3초 평균을 내 REST B1 `POST /v2/baselines`(`registration_id`)로 저장, 등록 시각은 서버. 캘리브레이션 파이프라인·Kafka 키 `calibration_id`·`calibration_result` 없음 | DB/BE · D-35 폐기 |
| REST | S1~S6·R1~R3 | **S2(구간 입력)·R2(기록 저장)·S5(메타데이터)·S6(세션 삭제) 삭제(10/28, 계획 0062).** 측정 입력은 `/v2/realtime`만, 기록 삭제는 R3 | DB/BE PR #77 · DN-67(점검 도구) |
| 앱 → 서버 좌표 | 메시지마다 0.5초 구간 1개 | **프레임마다 구간 1개(초당 약 10개, 10/27 팀장 결정).** Kafka 계약은 여전히 「1건 = 0.5초 구간」 — kafka 경로에서 `ws`가 묶을지는 1단계에서 정함 | FE 제안서 BE-8 · `ws_구축가이드_PM.md` 11장 |
| 측정 종료 사유 | `closed` 8개, 최대 측정 5000초 | **10개** — `unmeasurable_timeout`(측정불가 30분 자동 종료, 기본 켬)·`day_changed`(자정 넘김) 추가. 최대 측정 24시간 | DB/BE |
| 자정 넘김 | 없음 | KST 자정에 같은 연결에서 서버가 새 세션으로 이음(`session_rollover`, 설정 `POSEGOOD_MIDNIGHT_ROLLOVER`, 기본 꺼짐). FE 처리 완료(10/31) | DB/BE BE-6 · FE PR #88 |
| Kafka 전환(D-57) | PM 1단계 대기 | **10/30 회의: 1단계는 PM이 구현.** 저장 완료 이벤트(D-67)는 DevOps/BE가 1단계 뒤. `session_ended` 종료 사유(D-55) 폐기 | 결정기록 10-30 |
| 외부 추론 통신 | Kafka 9094 직접(입출구 경유안 검토 중) | **Kafka 유지(10/30 회의), 담당 DB/BE.** WebSocket안은 채택 안 함 | 결정기록 10-30 |
| DLQ | 있음 | 그대로(DevOps, 보류 — 제거 여부는 나중에) | 결정기록 10-30 |
| 통합 테스트 | 0~13단계, PASS 62 / 0 | **0~14단계**(14 = `gateway`·터널·공개 주소 경유 REST·wss) — 10/30 PASS 80 / FAIL 0 / SKIP 2 | DN-66·67 |
| 연결 | 29개 | **29개 그대로.** ①②는 앱 → Cloudflare → `gateway` → io-api(서버 안 시험은 `web`). ⑱은 토큰 방식이라 「로그인 세션 공유」가 빠지고 여러 대 라우팅만(보류). 캘리브레이션용 연결 내용은 지움 | |

**연결 상태가 바뀐 곳 (10/31)**

| # | 10/26 | 10/31 | 메모 |
|---|---|---|---|
| ① 앱 → `/v2/**` | 완료(`web` 경유) | **완료(공개 입구)** | 터널 경유 REST 26/0, FE 브라우저 10항목 OK(DN-66) |
| ② 앱 ⇄ `/v2/realtime` | 진행 중 | **진행 중** | 공개 주소 wss 17/0, 판정은 local. Kafka 중계는 PM(D-57 1단계) |
| ③ 입출구 서버 ⇄ MySQL | 완료(V2.3) | **완료(V2.6)** | DN-65 |
| ㉔ 팀원 PC → 서버 PC | 완료(SSH) | **완료** | 처리 서비스·추론은 SSH `-L`로만(DN-66) |

**담당별 영향 (10/31)**

| 담당 | 달라지는 것 | 할 일 |
|---|---|---|
| PM(`ws`) | 1단계 담당 확정. 앱은 프레임마다 보내고, 측정불가 자동 종료·자정 넘김이 생김 | `ws_구축가이드_PM.md`(10/30 개정) — 시작 전 11장 「정해야 할 것」 확인 |
| DB/BE | API·계약은 DB/BE 명세가 확정본 | D-57 2단계(kafka 모드에서 결과 쓰기 중단·REST 정리), 외부 추론 Kafka 통신, local 저장 실패 때 `stalled`(D-67 local 쪽), `/v1/realtime` 정리(D-72 이관) |
| FE | 화면은 Vercel, API는 공개 주소 | Cloudflare 요청 제한 값, 계획 0059(측정 중 WS 메시지 줄이기) |
| DevOps/BE | 공개 입구·토큰 설정·V2.6·점검 도구 대응 끝(DN-63~67) | J2 → J3 → J1(D-05·D-49·D-33), 1단계 뒤 D-67·D-57 3단계 |
| ML | 추론은 규칙 점수만 | 모델이 나오면 교체 절차(㉒), GPU PC 이전(D-31) |

## v5.2 → v5.3 무엇이 바뀌었나 (10/16 ~ 10/26, 처음 판)

| 항목 | v5.2 | v5.3 | 근거 |
|---|---|---|---|
| 옛 경로 | 운영 층에 "기존 경로(검토 중)" — `/api/v1/posture/summary` → `posture.summary` → 옛 추론·판정 → `posture_app`, posture-sink → HDFS | **삭제**. 처리 서비스 `cep` 패키지·`/summary`, 추론 옛 컨슈머, posture-sink, 옛 토픽 2개·그룹 2개를 지웠습니다. 처리 서비스 연결 풀 기본 DB는 `posture_service`입니다. 토픽은 v1 4개(`features`·`inference`·`episodes`·`alerts`)와 `posture.dlq`만 남았습니다 | DN-61 (10/21) |
| 앱 입구 | 앱 → 입출구 서버(중계는 미정) | **화면 컨테이너 `web`**(팀 `frontend.Dockerfile` = 화면 + nginx, `127.0.0.1:8088`)이 화면과 `/api` 중계를 같은 출처로 제공합니다. nginx가 `/api/v2/**`·`/api/v2/realtime`을 io-api(`api:8090`)로 넘깁니다. 다른 PC는 SSH 포트 포워딩 → `http://localhost:8088`로 접속합니다(카메라 허용). 연결 ①② 앞에 들어가고, 번호는 그대로입니다 | DN-58 (10/21) · DN-62 (10/26) · DN-51(nginx `/api/v2/realtime`) |
| 앱 경로 판정 (지금) | 목표 경로만 표시(`ws` → Kafka) | **전환 중으로 표시.** 지금 앱 측정은 io-api 안에서 판정합니다(`POSEGOOD_REALTIME_PIPELINE=local`, ADR 0020). 흐름은 `RealtimeHandlerV2` → `FrameFeatures` → **io-inference**(FastAPI) → `SessionEngine`(메모리) → 결과 테이블 직접 쓰기입니다. Kafka 경로(추론 → 판정 → 저장)는 완성돼 시험용 입구로 서버에서 확인했고, 두 경로가 같은 결과를 내는 것도 확인했습니다(T-15). `ws`가 Kafka에 붙으면(PM, D-57 1단계) `kafka`로 바꾸고, API 안 판정과 io-inference를 지웁니다(D-57 4단계) | DN-49 · DN-53 · D-57 |
| 알림 토픽 ㉙ | 계획(D-54) | **구현** — 판정 결과 저장이 알림 행을 새로 쓰고, 세션 알림이 켜져 있고 판정 뒤 10초 안의 사건만 `posture.alerts.v1`로 냅니다. 재전송·알림 꺼짐·오래된 사건은 기록만 합니다. 파티션 3, 보존 3일, 계약 `kafka-alerts.v1`. `ws` 구독(⑥)은 PM 몫입니다 | DN-57 (10/18) |
| 제외 구간 | 계획(D-39) | **구현** — 판정기가 `excluded_started`·`excluded_ended`를 내고, 판정 결과 저장이 `excluded_interval`에 기록합니다(PAUSE·MISSING). 일별 통계의 유효 시간 계산 재료가 생겼습니다 | DN-50 (10/16) |
| 판정 서비스 이름 | `cep`(패키지·`/cep/*`·그룹 `api-server-cep-v1`) | **`judge`** — 패키지 `posture.judge`, 운영 API `/judge/v1/*`, 그룹 `judge-v1`, 설정 `JUDGE_*`. 서비스 DB 확인은 `/store/service-db` | DN-55 (10/18) |
| 추론 서비스 | 규칙 기준 + 시험 LSTM(합성 데이터 모델) | **규칙 점수만** — 시험 LSTM·학습 스크립트·torch를 지우고 `features.v1` → `inference.v1` 컨슈머(DLQ 포함)만 남겼습니다. 실제 모델은 ML이 만든 뒤 넣습니다(㉒) | DN-59 (10/21) |
| 판정 결과 저장 값 | `good_sec` 반올림 | 0.1초 아래 **버림**(팀 API와 같게) | DN-56 (10/18) |
| HDFS | Spark가 쓰는 파일 복제 3(DataNode 1개라 복제 부족) | Spark 쓰기 **복제 1**(`spark-defaults.conf`). 옛 시험 적재분은 옛 경로와 함께 정리했습니다 | DN-54 (10/18) · DN-61 |
| `bigdata/` | 점검 코드·posture-sink | Spark 배치(J1·J2·J3) 자리만 남겼습니다. 점검 코드는 루트 `tests/`로 옮겼습니다 | DN-60 (10/21) |
| 서버 실행 | `feat/backend-data-platform-architecture` 브랜치 | 그 브랜치는 **develop에 병합**했습니다(PR #63). 서버는 `/home/bdp/sitting-posture-corrector`(develop)에서만 compose를 돌리고 `up`은 `--no-build`로 합니다. 다른 브랜치 화면은 작업 트리에서 이미지만 빌드합니다. diff는 작업마다 새 브랜치에서 만듭니다 | 결정기록 10-24 |
| 서비스 DB | V2.3 | 서버 확인은 V2.3까지입니다. develop 코드(io-api)는 **V2.4**(`feature_archive.row_count` 삭제)를 요구하므로 서버 DB 버전과 io-api 이미지 버전을 맞춰야 합니다 | D-65 |
| 연결 | 29개 | **29개 그대로.** ①②가 `web`을 거치고, ㉙가 완료로 바뀌었습니다. 전환 중 연결(io-api ⇄ io-inference)과 보류 중 연결(인터넷 공개 입구)은 연결표 아래 "전환·검토 중인 연결"에 둡니다 | |

**연결 상태가 바뀐 곳**

| # | v5.2 | v5.3 | 메모 |
|---|---|---|---|
| ① 앱 → `/v2/**` | 안 함 | **완료** | `web` 경유 REST 19개 PASS, 실제 화면 가입·로그인·기록(DN-58·62) |
| ② 앱 ⇄ `/v2/realtime` | 안 함 | **진행 중** | 연결·측정은 동작(local 경로, WebSocket 16개 PASS). Kafka 중계는 PM |
| ③ 입출구 서버 ⇄ MySQL | 안 함 | **완료** | io-api REST가 V2.3 DB에서 동작(DN-53) |
| ④⑤⑥ `ws` ⇄ Kafka | 안 함 | **대기** | PM `ws` Kafka 연결(D-57 1단계) |
| ⑫⑬ 판정 결과 저장 | 진행 중 | **완료** | DN-46·47 |
| ㉗ 운영 API ⇄ MySQL | 진행 중 | **완료** | 시험 행·`/report/sessions` |
| ㉙ `alerts.v1` | 안 함 | **완료** | DN-57 (`ws` 구독은 ⑥) |

**담당별 영향**

| 담당 | 달라지는 것 | 할 일 |
|---|---|---|
| PM(`ws`) | Kafka 쪽(판정·저장·알림 토픽)이 모두 준비됐습니다. `alerts.v1`이 생겨 `ws`의 임시 알림 규칙이 필요 없습니다 | `ws` Kafka 연결 — `ws_구축가이드_PM.md` 7장 1~4단계(D-57 1단계) |
| DB/BE | 지금은 API 안 판정이 결과 테이블에 직접 씁니다(전환 중) | Kafka 모드에서 결과 쓰기 중단·세션 REST 정리(D-57 2단계), ADR 0020 대체 합의, V2.4 migration 013·014 서버 적용(D-65), `posture_app` 스키마 삭제 |
| FE | 서버 `web`이 V3 화면으로 빌드돼 있습니다(develop 병합 전) | V3 develop 병합 → 서버 web을 develop 기준으로 다시 빌드 |
| DevOps/BE | 옛 경로가 사라지고, 처리 서비스·운영 API 이름이 `judge`·`store`·`report`로 바뀌었습니다 | D-57 3·4단계(전환 시험·기본값 kafka), D-65, D-33·D-05·D-49(배치), T-14, D-43(보류) |
| ML | 추론 서비스는 규칙 점수만 냅니다 | 모델이 나오면 교체 절차(㉒), 점수 방식(N3) |

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
| 측정 중 로그인 | 30분 비활동 만료 | `ws`가 열린 연결의 로그인을 1분마다 갱신 | 만료로 닫히면 재연결이 없어 측정이 끊김 |
| Kafka 토픽 | `features`·`inference`·`episodes`·`dlq` | + `posture.alerts.v1` | 알림 판단 결과 |
| 연결 | 28개 | **29개** — ㉙ 판정 결과 저장 → `alerts.v1` | |

## v5 → v5.1 무엇이 바뀌었나 (10/12)

**적재·분석을 v4 방식인 cron → Spark 배치 → HDFS로 되돌렸습니다.** 상주 적재 서비스가 없어지고, 서버 PC cron이 Spark 잡 3개를 정해진 시각에 실행합니다.

| 항목 | v5 | v5.1 | 이유 |
|---|---|---|---|
| 적재 | 적재 서비스(posture-sink, 상주 스트리밍) | cron → **Spark J1** 매시간(`availableNow`, 체크포인트) | 잡이 도는 동안만 메모리 사용, 실패해도 다음 실행이 이어 감 |
| 일별 통계 | Spark 집계(실행 주체 미정) | cron → **Spark J2** 매일 00:00(전날 KST) → `daily_stat` — v5.4에서 00:10, 11/08부터 최근 7일 다시 계산 | 실행 시각·주체를 cron 한 곳에서 |
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
| v5.1 수정 | 10/13 | 일별 통계 매일 00:00 전날 집계(v5.4에서 00:10), 잡 이름 J1 적재·J2 집계·J3 삭제 |
| v5.2 | 10/14 | 입출구 서버 = 팀 `backend/api`(`/v2`, `/v2/realtime`), 재연결 없음, 알림 토픽 ㉙, 등록 전용 연결, 좌표 입력 v3, DB V2.3, 5분 미만도 저장, 연결 29개 |
| v5.2 문서 | 10/16 | 구성 변경 없음. 문서 이름 영문화, 판정은 상태머신·CEP 미사용 표현 통일, 상태 갱신(D-51·D-30 완료, 입출구 REST 배포, `ws`는 PM) |
| v5.3 | 10/26 | 옛 경로 삭제(DN-61), 화면 컨테이너 `web`(nginx) 추가·실제 화면 시험 통과(DN-58·62), 앱 경로 판정은 전환 중(local, D-57)으로 표시, 알림 토픽 ㉙ 구현(DN-57), 제외 구간 저장(DN-50), 판정 이름 `judge`(DN-55), 추론 규칙 점수만(DN-59), HDFS 복제 1(DN-54), DB V2.4 대응(D-65), 연결 29개 그대로 |
| v5.3 개정 | 10/31 | 인터넷 공개 입구(Vercel + Cloudflare 터널 → `gateway`, DN-66), 처리 서비스 포트 127.0.0.1, 토큰 로그인(ADR 0031)·DB V2.6, WebSocket 자세 등록 삭제(D-35 폐기), REST S2·R2·S5·S6 삭제, 프레임마다 전송, `closed` 10개·자정 넘김, 10/30 회의(1단계 PM·외부 추론 Kafka·D-55 폐기), 통합 테스트 0~14단계 |
| v5.4 | 11/02 | Spark 배치 구축(11/01): J2 일별 통계 매일 00:10(DN-70), J3 탈퇴 최종 삭제 04:00(DN-71), J1 HDFS 적재 매시간 20분(D-33, 세션 파일 JSON Lines 3개·임시 폴더 7일), cron·`batch.sh`, 연결 ⑭⑮⑯⑰⑳㉘ 완료, 통합 테스트 0~17단계 |
| v5.4 개정 | 11/11 | J2 최근 7일 다시 계산(DN-74), `ws` Kafka 연결 1단계를 DevOps/BE가 브랜치 구현(D-57 ①~⑦: 프레임마다 발행·결과 구독·판정기 `observation`·저장 완료 `posture.stored.v1`, `--kafka` 99/0), 병합 조건 = FE 포함 통신 시험, S4 DB 먼저(안 A), S3·R3 제거 결정, DB V2.7(develop), 연결 ④⑤⑥ 진행 중 |

| v5.4 개정 보완 | 11/13 | HDFS 좌표 적재(D-92, D-57 ⑩·⑩b): 적재 전용 토픽 `posture.keypoints.v1` → J1 `keypoints.jsonl`(사용자 폴더), 스위치 기본 꺼짐. 임시 폴더 실제 보존 약 8일, 토픽 `segment.ms` 기본 7일 확인(D-82) |
| **v5.5** | **11/22** | `ws` Kafka 연결 develop 병합(D-57, #134 — 연결 ②④⑤⑥ 완료, 운영 기본값 local 유지), 주소·토픽·그룹·Redis 키·HDFS 경로·계약 파일의 버전 삭제(#138, ADR 0049 — `/api/…`·`/api/realtime`·`posture.features` 등), 전환 기간 gateway 별칭(서버에서는 삭제), 저장 완료 `posture.stored`·좌표 적재 `posture.keypoints`, S4 DB 먼저·S3·R3 삭제, 계정당 한 측정·D-98, Discord 로그인, 운영 DB V2.7(develop V2.8 파일만), 통신 시험 도구, 연결 29개 그대로 |

남은 안건은 `결정기록.md` 맨 아래 "남은 안건"에 있습니다.

## 외부 원본 참조

아래 원문은 저장소에 포함되어 있지 않다. 문의 담당은 관련 작업의 담당이며, 작성자나 원문 내용의 동일성을 뜻하지 않는다. 저장소 문서는 위 링크에서 확인한다.

| 인용 원문 | 확인 가능한 판본 | 접근 안내·문의 담당 |
|---|---|---|
| `자세 분석 플랫폼 아키텍처 v5.5.html` | v5.5(11/22) | [기존에 공유된 원본 페이지](https://claude.ai/artifact/ToNH9pTwBDWbjTsg3iZpVX)(같은 주소를 v5.5로 다시 게시), 노션 첨부. DevOps/BE |
| `사용자데이터_입출력시나리오_v5.5.md` | 파일명 기준 v5.5(11/22) | 노션 첨부. DevOps/BE에 문의 |
| `결정기록.md` | 2026-11-22 갱신 | 공유 주소 미기재. DevOps/BE에 원문과 "남은 안건" 절 확인 |
| `파이프라인_구축현황.md` | 2026-11-22 갱신 | 공유 주소 미기재. DevOps/BE에 문의 |
| `ws_구축가이드_PM.md` | 10/30판(설계 참고용) | `ws` Kafka 연결은 D-57로 develop 병합(#134) — 지금 동작은 저장소 코드·[Kafka 명세](kafka-spec.md) |
| `FE_BE_API명세_2026-10-14.md` | 파일명 기준 2026-10-14판(옛 판) | 현재 API는 [API 명세](api-spec.md)(DB/BE 확정본) |
