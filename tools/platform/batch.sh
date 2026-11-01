#!/usr/bin/env bash
# Spark 배치 실행기 (아키텍처 v5.3 ㉘ cron → Spark) — 서버 PC 저장소 루트에서 실행한다.
#   tools/platform/batch.sh j2 [--date YYYY-MM-DD] [--user 12,34] [--dry-run] [--show]   일별 통계 (D-05)
#   tools/platform/batch.sh j3 [--user 12,34] [--dry-run] [--grace-days N]               탈퇴 최종 삭제 (D-49)
#   tools/platform/batch.sh j1 [--session UUID] [--settle-sec N] [--dry-run]             HDFS 적재 (D-33)
# 같은 잡이 겹쳐 돌지 않게 잠금(flock)을 잡고, 로그를 tools/platform/batch-logs/<잡>-<시각>.log에 남긴다(30일 보관).
# 잡 코드는 spark 컨테이너의 /opt/jobs(= bigdata/jobs 마운트), DB 접속 값은 컨테이너 환경(infra/compose/.env).
# 끝 코드: 잡의 끝 코드(0 성공). cron이 실패를 알 수 있게 그대로 돌려준다.
set -u

MYSQL_JDBC="${MYSQL_JDBC_PACKAGE:-com.mysql:mysql-connector-j:8.4.0}"
JOB="${1:-}"
case "$JOB" in
  j2) SCRIPT=/opt/jobs/j2_daily_stat.py ;;
  j3) SCRIPT=/opt/jobs/j3_withdrawal_delete.py ;;
  j1) SCRIPT=/opt/jobs/j1_hdfs_archive.py ;;
  *) echo "사용법: $0 j1|j2|j3 [옵션...]" >&2; exit 2 ;;
esac
shift

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGDIR="$ROOT/tools/platform/batch-logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$JOB-$(date +%Y%m%d-%H%M%S).log"
find "$LOGDIR" -name '*.log' -mtime +30 -delete 2>/dev/null || true

exec 9>"/tmp/posegood-batch-$JOB.lock"
if ! flock -n 9; then
  echo "$(date '+%F %T') $JOB 이미 실행 중 — 건너뜀" | tee -a "$LOG" >&2
  exit 3
fi

if ! docker inspect -f '{{.State.Running}}' spark 2>/dev/null | grep -q true; then
  echo "$(date '+%F %T') $JOB spark 컨테이너가 실행 중이 아님" | tee -a "$LOG" >&2
  exit 4
fi

PACKAGES="$MYSQL_JDBC"
if [ "$JOB" = j1 ]; then
  # Kafka 소스는 spark 이미지 버전과 같은 판이어야 한다(Spark 4 = Scala 2.13). 이미지 태그에서 읽는다
  SPARK_VER="${SPARK_VERSION:-$(docker inspect -f '{{.Config.Image}}' spark | sed -n 's/.*:\([0-9][0-9.]*\).*/\1/p')}"
  if [ -z "$SPARK_VER" ]; then
    echo "$(date '+%F %T') $JOB spark 이미지 태그에서 버전을 못 읽음 — SPARK_VERSION=4.2.0 처럼 지정" | tee -a "$LOG" >&2
    exit 4
  fi
  PACKAGES="$PACKAGES,org.apache.spark:spark-sql-kafka-0-10_2.13:$SPARK_VER"
fi

docker exec spark /opt/spark/bin/spark-submit --master 'local[2]' \
  --packages "$PACKAGES" --conf spark.jars.ivy=/opt/spark-ivy \
  --conf spark.driver.extraJavaOptions=-Duser.timezone=Asia/Seoul \
  "$SCRIPT" "$@" >>"$LOG" 2>&1
CODE=$?
grep -E "^\[[0-9-]+ [0-9:]+\] $(echo "$JOB" | tr a-z A-Z) |^\{" "$LOG" | tail -5
echo "$(date '+%F %T') $JOB 끝 코드 $CODE — 로그 $LOG"
exit $CODE
