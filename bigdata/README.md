# 빅데이터 배치 (Spark J1·J2·J3)

서버 PC의 cron이 Spark 배치를 정해진 시각에 실행한다(아키텍처 v5.3 ㉘). 실시간 경로가 아니라 멈추거나 느려도 판정·알림은 그대로다.
담당: DevOps/BE. 계획: [0085](../docs/plans/active/0085-spark-batch-jobs.md). DB 규칙: [database/README.md](../database/README.md) 「일별 통계」·「탈퇴 최종 삭제」.

| 잡 | 파일 | 언제 | 하는 일 | 상태 |
|---|---|---|---|---|
| J2 일별 통계 | `jobs/j2_daily_stat.py` | 매일 00:10 | 어제부터 7일 전까지(KST) 끝난 세션 → 사용자별 `daily_stat`, 바뀐 날만 다시 씀 | 서버 확인(D-05, 11/01) |
| J3 탈퇴 삭제 | `jobs/j3_withdrawal_delete.py` | 매일 04:00 | 유예 30일 지난 탈퇴 → HDFS 사용자 폴더 → DB 행 | 서버 확인(D-49, 11/01) |
| J1 적재 | `jobs/j1_hdfs_archive.py` | 매시간 20분 | Kafka v1 토픽(+ 좌표 구간 `posture.keypoints.v1`, D-92) → HDFS 임시 폴더 → 끝난 세션을 사용자별 폴더 + `feature_archive` | 서버 확인(D-33, 11/01) — 실제 세션은 D-57 뒤 |

## 실행 방식

- 코드는 저장소 `bigdata/jobs/`를 spark 컨테이너 `/opt/jobs`에 읽기 전용으로 마운트한다(`infra/compose/bigdata.yaml`). 코드를 바꾸면 이미지를 다시 빌드할 필요 없이 다음 실행부터 적용된다.
- 실행은 `tools/platform/batch.sh <잡> [옵션]` — `docker exec spark spark-submit --master local[2]`, 같은 잡이 겹치지 않게 잠금, 로그는 `tools/platform/batch-logs/`(30일 보관, Git 제외), 끝 코드는 잡의 끝 코드.
- DB 접속 값은 처리 서비스와 같은 `infra/compose/.env`(`DB_HOST`·`DB_PORT`·`DB_USER`·`DB_PASSWORD`·`SERVICE_DB_SCHEMA`)를 spark 컨테이너가 받는다. MySQL JDBC 드라이버는 `--packages com.mysql:mysql-connector-j:8.4.0`로 처음 한 번 받아 볼륨 `spark-ivy`에 둔다(서버 PC가 Maven Central에 닿아야 함).
- 시각: DB `DATETIME`은 KST다. 시간대 변환이 끼지 않게 시각 계산은 SQL에서 세션 시작 기준 밀리초로 끝내고 Spark에는 숫자만 넘긴다.

## J2 일별 통계

```bash
tools/platform/batch.sh j2                          # 어제(KST)
tools/platform/batch.sh j2 --date 2026-10-31        # 날짜 지정(다시 계산)
tools/platform/batch.sh j2 --date 2026-10-31 --dry-run   # 계산만, 쓰지 않음
tools/platform/batch.sh j2 --date 2026-10-31 --show      # 저장된 행만 보기
tools/platform/batch.sh j2 --days 7                      # 어제부터 7일 전까지 다시 계산 (cron, D-81)
tools/platform/batch.sh j2 --date 2026-10-31 --days 3 --dry-run   # 10/29~10/31, 바뀌는 날만 보기
```

- 대상: 시작 시각의 KST 날짜가 그날인 **끝난 세션**(`ended_at` 있음). 끝나지 않은 세션 행은 넣지 않는다. 날짜를 넘긴 세션은 시작 날짜에 넣는다.
- `valid_sec` = 세션마다 (길이 − 겹친 제외 구간)을 0.1초 아래 버려 더함 · `good_sec` = 세션 `good_sec` 합 · `event_count` · `alerted_event_count`(알림 켜진 세션에서 알림 행이 있는 이벤트) · `min/max_until_collapse_sec`(5분 이상 세션, 세션 시작·직전 붕괴 끝 → 다음 붕괴 시작·세션 끝, 겹친 제외 구간을 빼고 표본마다 버림, 없으면 NULL).
- 쓰기는 한 트랜잭션에서 그날(·지정 사용자)의 행을 지우고 다시 넣는다 — 다시 돌려도 같다. 세션이 없는 사용자는 행이 없다.
  계산한 행이 저장된 행과 같으면 쓰지 않는다(「변경 없음」, `computed_at` 그대로).
- **다시 계산(`--days N`, D-81)**: 끝 날짜(`--date`, 기본 어제)부터 N일 전까지 날짜마다 계산해 바뀐 날만 다시 쓴다. J2가 지나간 뒤에 닫힌 세션(저장 지연·나중에 닫힘)이나 지워진 세션(R3)이 그 날짜 통계에 반영된다. cron은 `--days 7` — 7일보다 늦게 닫힌 세션은 `--date`로 직접 돌린다. 한 날짜가 실패해도 나머지 날짜는 계속하고 끝 코드는 1. 처음 cron 전 날짜(10/29·10/30)는 11/04에 `--date`로 채웠다.
- 시각을 00:00이 아니라 **00:10**으로 둔다: 자정 직전에 끝난 세션의 저장이 끝나고, 자정 넘김(`session_rollover`)으로 끝난 세션이 저장될 시간을 둔다(FE 요청 BE-11).

## J1 판정 과정·좌표 적재

```bash
tools/platform/batch.sh j1                                   # Kafka 받기 + 끝난 지 10분 지난 세션 정리
tools/platform/batch.sh j1 --dry-run                         # 받기는 하고, 정리할 세션만 보기
tools/platform/batch.sh j1 --session <uuid> --settle-sec 0   # 시험용 — 그 세션만, 기다리지 않음
```

1. **받기**: `posture.features.v1`·`posture.inference.v1`·`posture.episodes.v1`을 Structured Streaming `availableNow`로 지난번 위치부터 지금까지 읽어 `/data/staging/realtime-v1/topic=…/date=…`(Parquet — 봉투 몇 칸 + 원문 JSON)에 붙인다. 읽은 위치는 `/data/checkpoints/j1-realtime-v1`. 처음 실행은 토픽에 남은 가장 앞부터 읽는다(지워진 위치는 건너뜀). Kafka 소스 패키지(`spark-sql-kafka-0-10_2.13`, spark 이미지와 같은 판 — `batch.sh`가 이미지 태그에서 읽음)도 처음 한 번 받는다.
   (D-92) 좌표 구간 토픽 `posture.keypoints.v1`은 **별도 쿼리·체크포인트·임시 폴더**(`/data/checkpoints/j1-keypoints-v1`, `/data/staging/keypoints-v1/topic=…/date=…`)로 받는다 — 기존 체크포인트의 구독 목록을 바꾸면 Spark가 이어 읽기를 보장하지 않고, 두 쿼리가 같은 임시 폴더(같은 `_spark_metadata`)에 쓰면 뒤 쿼리의 배치가 「이미 쓴 배치」로 건너뛰어져 아무것도 쓰지 않은 채 읽은 위치만 넘어간다(11/13 서버에서 확인, 시험 `test_two_staging_streams_both_write`). 이 토픽은 kafka 경로에서 io-api 스위치 `POSEGOOD_ARCHIVE_KEYPOINTS=true`일 때만 쌓인다(기본 꺼짐 — 좌표 활용 동의 범위 확인 전).
   (D-93) **처음부터 다시 받으려고 체크포인트를 지우면** 그 임시 폴더의 `_spark_metadata`(쓴 배치 번호)가 남아 새 쿼리의 앞 배치들이 「이미 쓴 배치」로 건너뛰어진다(오류 없이 0건 — 11/13 서버). J1은 받기 전에 체크포인트가 없는데 메타데이터가 있으면 메타데이터를 지우고 로그를 남긴다(이미 받아 둔 Parquet은 그대로, 다시 받은 것과의 중복은 정리 단계가 뺀다). 손으로 정리할 때도 체크포인트와 그 임시 폴더의 `_spark_metadata`를 함께 지운다.
2. **정리**: DB에서 끝난 지 10분(`--settle-sec`) 지났고 `feature_archive`가 없는 세션(계정 ACTIVE, 7일 안)을 골라 임시 폴더의 메시지를 모은다. 중복은 하나만(구간·관측 `sequence`, 사건 `event_id`, 그 밖은 `message_id` — 가장 앞 offset). 세션 폴더 `/data/users/{user_account_id}/{시작일 KST}/{client_session_uuid}/`에 **파일 3개**(`features.jsonl`·`inference.jsonl`·`episodes.jsonl`, 토픽 원문 한 줄에 하나)와 좌표 구간이 있으면 `keypoints.jsonl`(D-92, 중복은 `sequence`로)을 쓰고 `feature_archive` 1행(`file_uri`, 첫·마지막 구간 시각 = 세션 시작 + `start_ms`/`end_ms`, 적재 시각)을 넣는다. 파일을 먼저 쓰고(덮어쓰기) 행을 넣어, 중간에 멈추면 다음 실행이 다시 쓴다.
3. **임시 폴더 정리**: 7일(`--keep-days`)보다 오래된 `date=` 폴더를 지운다.

- 임시 폴더에 메시지가 없는 세션은 건너뛴다(`missing`). **지금 앱 측정은 Kafka를 거치지 않는다**(API 안 판정, D-57 전) — 실제 사용자 세션은 D-57 전환 뒤부터 적재된다. 그 전에는 Kafka 시험 입구로 재생한 시험 세션만 적재된다.
- 탈퇴(CLOSED) 계정의 세션은 적재하지 않는다. 적재된 폴더·행은 J3가 사용자 폴더째 지운다. 임시 폴더의 그 사용자 메시지는 7일 뒤 정리로 사라진다(유예 30일보다 짧음).
- HDFS ↔ 학습 환경은 연결하지 않는다(D-33). 원문에는 좌표·이메일이 없다(features.v1 본문은 특징 변화량).

## J3 탈퇴 최종 삭제

```bash
tools/platform/batch.sh j3 --dry-run                     # 대상만 보기
tools/platform/batch.sh j3                               # 유예 30일 지난 탈퇴 모두
tools/platform/batch.sh j3 --user 12 --grace-days 0      # 시험용 — 유예 일수는 --user와 함께만
```

- 대상: `deletion_request`의 `ACCOUNT_ALL` 요청 중 `account_closed_at + 30일 ≤ 지금(KST)`이고 상태가 `REQUESTED`·`FAILED`(재시도)·`PROCESSING`(앞 실행이 중간에 멈춘 것 — 잠금으로 한 번에 하나만 돈다).
- 사용자 한 명씩: ① 요청을 `PROCESSING`으로 확정 ② HDFS 사용자 폴더 `/data/users/{id}`(와 그 밖에 기록된 세션 폴더)를 지우고 `feature_archive.deleted_at`을 채워 확정(재시도 지점) ③ 한 트랜잭션에서 적재 기록 → 세션(이벤트·알림·제외 구간 CASCADE) → 일별 통계 → 기준 자세 → 삭제 요청 → 계정(동의·로그인 유지 토큰 CASCADE).
- ③이 실패하면 되돌리고 요청을 `FAILED`·`failure_reason`으로 둔다 — 다음 날 다시 한다. 한 사용자의 실패가 다른 사용자를 막지 않는다. 실패가 있으면 끝 코드 1.
- 성공하면 요청 행도 지워져 그 사용자에 대해 남는 것이 없다(DB README 순서). 통합 테스트·점검 도구가 만든 시험 계정(`test-…@example.invalid`, 탈퇴 접수 상태)도 같은 방식으로 30일 뒤 지워진다.
- 다른 사용자 폴더나 `/data/users` 자체를 가리키는 적재 기록은 지우지 않고 그 사용자를 실패로 남긴다.
- 지금 하지 않는 것: `RECORDS_ONLY`(기록만 삭제 — 입출구 서버가 만들지 않음, 개수만 로그), 완료 안내 발송(수단 미정 — 자리만, 이메일을 읽지 않음), 보존 주기(Kafka·Redis는 각자 설정, HDFS 임시 폴더 정리는 J1과 함께).

## cron (서버 PC, 사용자 crontab)

서버 PC 시간대가 KST(`timedatectl` → `Asia/Seoul`)라 cron 시각은 그대로 KST다(`CRON_TZ`는 Ubuntu cron이 무시할 수 있어 쓰지 않음).

```cron
10 0 * * * cd /home/bdp/sitting-posture-corrector && tools/platform/batch.sh j2 --days 7 >/dev/null 2>&1
0 4 * * * cd /home/bdp/sitting-posture-corrector && tools/platform/batch.sh j3 >/dev/null 2>&1
20 * * * * cd /home/bdp/sitting-posture-corrector && tools/platform/batch.sh j1 >/dev/null 2>&1
```

J1은 매시간 20분 — 00:10 J2·04:00 J3와 겹치지 않게(잡마다 잠금은 따로라 겹쳐도 돌지만 메모리 2GB 안에서 Spark 두 개는 피함).

등록: `( crontab -l 2>/dev/null; echo '<줄>' ) | crontab -` → `crontab -l`로 확인(2026-11-01 J2·J3·J1 등록, J2는 D-81로 `--days 7`).

로그는 `tools/platform/batch-logs/<잡>-*.log`. 통합 테스트 15단계(J2)·16단계(J3)·17단계(J1)가 시험 계정으로 실제 DB·HDFS에 돌려 확인한다.

## 시험

- 계산: `python -m pytest tests/test_batch_j2_daily_stat.py` — 합성 세션, 로컬 Spark(pyspark가 없으면 건너뜀). 다시 계산(날짜 목록·비교·바뀐 날만 쓰기·실패한 날 뒤 계속)은 Spark 없이.
- J3 흐름: `python -m pytest tests/test_batch_j3_withdrawal_delete.py` — 가짜 DB·HDFS(순서·실패 되돌림·재시도·다른 사용자 폴더 거부).
- J1: `python -m pytest tests/test_batch_j1_hdfs_archive.py` — 로컬 Spark·로컬 파일(임시 폴더 열·중복 빼기·파일 3개·좌표 파일·행·dry-run·오래된 임시 폴더). Kafka 받기는 통합 테스트로.
- 서버: `tools/platform/integration_test.sh` 15단계(시험 계정 세션 2개 → J2 → 저장 행 확인 → 재실행 변경 없음 → `--days 2` dry-run → 삭제 뒤 CASCADE), 16단계(시험 계정 C 탈퇴 31일·D 29일 → `tests/batch_testkit.py`로 준비 → J3 → C 행·HDFS 폴더 전부 삭제·D 그대로 → 재실행 0 → D 정리), 17단계(시험 세션 E를 Kafka v1로 재생 + 합성 좌표 구간 170개 → J1 → 세션 폴더 파일 4개·`feature_archive` → 재실행 새 메시지 0 → J3로 정리).
