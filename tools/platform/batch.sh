#!/usr/bin/env bash
# Spark 배치 실행기 (아키텍처 v5.3 ㉘ cron → Spark) — 서버 PC 저장소 루트에서 실행한다.
#   tools/platform/batch.sh j2 [--date YYYY-MM-DD] [--user 12,34] [--dry-run]     일별 통계 (D-05)
# 같은 잡이 겹쳐 돌지 않게 잠금(flock)을 잡고, 로그를 tools/platform/batch-logs/<잡>-<시각>.log에 남긴다(30일 보관).
# 잡 코드는 spark 컨테이너의 /opt/jobs(= bigdata/jobs 마운트), DB 접속 값은 컨테이너 환경(infra/compose/.env).
# 끝 코드: 잡의 끝 코드(0 성공). cron이 실패를 알 수 있게 그대로 돌려준다.
set -u

MYSQL_JDBC="${MYSQL_JDBC_PACKAGE:-com.mysql:mysql-connector-j:8.4.0}"
JOB="${1:-}"
case "$JOB" in
  j2) SCRIPT=/opt/jobs/j2_daily_stat.py ;;
  *) echo "사용법: $0 j2 [옵션...]" >&2; exit 2 ;;
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

docker exec spark /opt/spark/bin/spark-submit --master 'local[2]' \
  --packages "$MYSQL_JDBC" --conf spark.jars.ivy=/opt/spark-ivy \
  --conf spark.driver.extraJavaOptions=-Duser.timezone=Asia/Seoul \
  "$SCRIPT" "$@" >>"$LOG" 2>&1
CODE=$?
grep -E "^\[[0-9-]+ [0-9:]+\] $(echo "$JOB" | tr a-z A-Z) |^\{" "$LOG" | tail -5
echo "$(date '+%F %T') $JOB 끝 코드 $CODE — 로그 $LOG"
exit $CODE
