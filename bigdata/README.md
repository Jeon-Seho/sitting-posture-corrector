# 빅데이터 배치 (Spark J1·J2·J3)

서버 PC의 cron이 Spark 배치를 정해진 시각에 실행한다(아키텍처 v5.3 ㉘). 실시간 경로가 아니라 멈추거나 느려도 판정·알림은 그대로다.
담당: DevOps/BE. 계획: [0085](../docs/plans/active/0085-spark-batch-jobs.md). DB 규칙: [database/README.md](../database/README.md) 「일별 통계」·「탈퇴 최종 삭제」.

| 잡 | 파일 | 언제 | 하는 일 | 상태 |
|---|---|---|---|---|
| J2 일별 통계 | `jobs/j2_daily_stat.py` | 매일 00:10 | 전날(KST) 끝난 세션 → 사용자별 `daily_stat` | 서버 확인(D-05, 11/01) |
| J3 탈퇴 삭제 | — | 매일 04:00 | 유예 30일 지난 탈퇴 → HDFS 사용자 폴더 → DB 행 | 다음(D-49) |
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

## cron (서버 PC, 사용자 crontab)

```cron
CRON_TZ=Asia/Seoul
10 0 * * * cd /home/bdp/sitting-posture-corrector && tools/platform/batch.sh j2 >/dev/null 2>&1
```

로그는 `tools/platform/batch-logs/j2-*.log`. 통합 테스트 15단계가 시험 계정으로 J2를 실제 DB에 돌려 확인한다.

## 시험

- 계산: `python -m pytest tests/test_batch_j2_daily_stat.py` — 합성 세션, 로컬 Spark(pyspark가 없으면 건너뜀).
- 서버: `tools/platform/integration_test.sh` 15단계(시험 계정 세션 2개 → J2 → 저장 행 확인 → 재실행 멱등 → 삭제 뒤 CASCADE).
