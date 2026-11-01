# 빅데이터 배치 (Spark J1·J2·J3)

서버 PC의 cron이 Spark 배치를 정해진 시각에 실행한다(아키텍처 v5.3 ㉘). 실시간 경로가 아니라 멈추거나 느려도 판정·알림은 그대로다.
담당: DevOps/BE. 계획: [0085](../docs/plans/active/0085-spark-batch-jobs.md). DB 규칙: [database/README.md](../database/README.md) 「일별 통계」·「탈퇴 최종 삭제」.

| 잡 | 파일 | 언제 | 하는 일 | 상태 |
|---|---|---|---|---|
| J2 일별 통계 | `jobs/j2_daily_stat.py` | 매일 00:10 | 전날(KST) 끝난 세션 → 사용자별 `daily_stat` | 서버 확인(D-05, 11/01) |
| J3 탈퇴 삭제 | `jobs/j3_withdrawal_delete.py` | 매일 04:00 | 유예 30일 지난 탈퇴 → HDFS 사용자 폴더 → DB 행 | 서버 확인(D-49, 11/01) |
| J1 적재 | — | 매시간 | Kafka v1 토픽 → HDFS 사용자별 폴더 + `feature_archive` | 그다음(D-33) |

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
```

- 대상: 시작 시각의 KST 날짜가 그날인 **끝난 세션**(`ended_at` 있음). 끝나지 않은 세션 행은 넣지 않는다. 날짜를 넘긴 세션은 시작 날짜에 넣는다.
- `valid_sec` = 세션마다 (길이 − 겹친 제외 구간)을 0.1초 아래 버려 더함 · `good_sec` = 세션 `good_sec` 합 · `event_count` · `alerted_event_count`(알림 켜진 세션에서 알림 행이 있는 이벤트) · `min/max_until_collapse_sec`(5분 이상 세션, 세션 시작·직전 붕괴 끝 → 다음 붕괴 시작·세션 끝, 겹친 제외 구간을 빼고 표본마다 버림, 없으면 NULL).
- 쓰기는 한 트랜잭션에서 그날(·지정 사용자)의 행을 지우고 다시 넣는다 — 다시 돌려도 같다. 세션이 없는 사용자는 행이 없다.
- 시각을 00:00이 아니라 **00:10**으로 둔다: 자정 직전에 끝난 세션의 저장이 끝나고, 자정 넘김(`session_rollover`)으로 끝난 세션이 저장될 시간을 둔다(FE 요청 BE-11).

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
10 0 * * * cd /home/bdp/sitting-posture-corrector && tools/platform/batch.sh j2 >/dev/null 2>&1
0 4 * * * cd /home/bdp/sitting-posture-corrector && tools/platform/batch.sh j3 >/dev/null 2>&1
```

등록: `( crontab -l 2>/dev/null; echo '<줄>' ) | crontab -` → `crontab -l`로 확인(2026-11-01 J2·J3 등록).

로그는 `tools/platform/batch-logs/<잡>-*.log`. 통합 테스트 15단계(J2)·16단계(J3)가 시험 계정으로 실제 DB·HDFS에 돌려 확인한다.

## 시험

- 계산: `python -m pytest tests/test_batch_j2_daily_stat.py` — 합성 세션, 로컬 Spark(pyspark가 없으면 건너뜀).
- J3 흐름: `python -m pytest tests/test_batch_j3_withdrawal_delete.py` — 가짜 DB·HDFS(순서·실패 되돌림·재시도·다른 사용자 폴더 거부).
- 서버: `tools/platform/integration_test.sh` 15단계(시험 계정 세션 2개 → J2 → 저장 행 확인 → 재실행 멱등 → 삭제 뒤 CASCADE), 16단계(시험 계정 C 탈퇴 31일·D 29일 → `tests/j3_testkit.py`로 준비 → J3 → C 행·HDFS 폴더 전부 삭제·D 그대로 → 재실행 0 → D 정리).
