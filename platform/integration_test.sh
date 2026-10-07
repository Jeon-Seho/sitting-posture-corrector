#!/usr/bin/env bash
# =====================================================================
# 빅데이터 플랫폼 통합 테스트 (ToDo T-12)
#
# 서버 PC에서 platform/ 폴더 기준으로 실행한다.
#   ./integration_test.sh            # 전체 (약 2~3분)
#   ./integration_test.sh --quick    # Spark 작업(왕복·적재 확인) 생략 (약 1분)
#   ./integration_test.sh --no-e2e   # 구성요소 점검만 (데이터 재생 없음)
#   EXPECT_PROJECT=platform ./integration_test.sh   # compose 프로젝트 이름까지 확인할 때
#
# 점검 순서
#   0. 사전 확인   : docker, python3+requests, .env 형식, compose 프로젝트·Kafka 볼륨(정보)
#   1. 컨테이너    : 7개 실행·healthy
#   2. Kafka       : 브로커, 토픽·파티션, 임시 토픽 produce→consume 왕복
#   3. Redis       : PING, SET/GET/TTL/DEL
#   4. HDFS        : DataNode 수, safemode, 파일 put→cat→rm
#   5. Spark       : Spark↔HDFS Parquet 왕복 (hdfs_parquet_roundtrip.py)
#   6. 서비스      : api-server liveness/readiness(DB·Redis), inference /health
#   7. 종단(T-10)  : 합성 CSV 재생 → Kafka → 추론 → 판정 → 이벤트 73.1s·재알림 2회,
#                    컨슈머 lag 0, Redis 상태 키 정리, DB 쓰기 버퍼(D-18), MySQL 행, (선택) HDFS 적재
#
# 결과: it-results/<시각>/ 에 단계별 로그와 summary.txt. FAIL이 하나라도 있으면 종료 코드 1.
# 이 스크립트는 운영 데이터를 지우지 않는다. 만드는 것은 임시 토픽·HDFS 임시 파일·Redis 임시 키뿐이고
# 끝나면 지운다. 단, T-10 재생은 실제 판정 경로를 타므로 sessions/collapse_events에 테스트 행 1개씩이 남는다(userId=IT-<시각>).
# =====================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

QUICK=0; E2E=1
for a in "$@"; do
  case "$a" in
    --quick) QUICK=1 ;;
    --no-e2e) E2E=0 ;;
    -h|--help) sed -n 2,24p "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션: $a (--help 참고)"; exit 2 ;;
  esac
done

API="${API_URL:-http://localhost:8080}"
INFER="${INFERENCE_URL:-http://localhost:8000}"
# 기대 프로젝트 이름: 환경변수로 줄 때만 비교한다(없으면 정보로만 출력).
EXPECTED_PROJECT="${EXPECT_PROJECT:-}"
SOURCE_CSV="${SOURCE_CSV:-mysql/posture-pilot-P01.csv}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="it-results/$TS"
mkdir -p "$OUT"
KT="docker exec kafka /opt/kafka/bin"
BS="--bootstrap-server localhost:9092"

PASS=0; FAIL=0; SKIP=0
RESULTS=()
log()  { echo "$*" | tee -a "$OUT/run.log"; }
pass() { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); log "  ✅ PASS  $1"; }
fail() { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1${2:+ — $2}"); log "  ❌ FAIL  $1${2:+ — $2}"; }
skip() { SKIP=$((SKIP+1)); RESULTS+=("SKIP  $1${2:+ — $2}"); log "  ⏭  SKIP  $1${2:+ — $2}"; }
step() { log ""; log "== $* =="; }
# check "이름" 명령...  : 명령이 성공하면 PASS
check() { local name="$1"; shift; if "$@" >>"$OUT/run.log" 2>&1; then pass "$name"; else fail "$name"; fi; }

log "통합 테스트 시작: $TS (quick=$QUICK, e2e=$E2E)"

# ---------------------------------------------------------------------
step "0. 사전 확인"
if ! command -v docker >/dev/null; then fail "docker 명령"; echo "docker가 없습니다."; exit 1; fi
pass "docker 명령"
if python3 -c "import requests" 2>/dev/null; then pass "python3 + requests"
else fail "python3 + requests" "pip install -r mysql/requirements.txt"; fi

# .env 형식 점검: 숫자여야 하는 값(…_SECONDS/_SIZE/_CONCURRENCY/_PORT)에 다른 글자가 붙어 있지 않은지,
# 파일 끝 줄바꿈이 있는지(없으면 echo >> 로 덧붙인 줄이 앞 줄에 붙음 — 2026-10-07 실제 장애 원인)
if [ -f .env ]; then
  BAD="$(grep -E '^[A-Z0-9_]+(_SECONDS|_SIZE|_CONCURRENCY|_PORT)=' .env | grep -vE '^[A-Z0-9_]+=[0-9]+[[:space:]]*$' | cut -d= -f1 | tr '\n' ' ')"
  if [ -n "$BAD" ]; then fail ".env 숫자 값 형식" "숫자가 아닌 값: $BAD"; else pass ".env 숫자 값 형식"; fi
  if [ -n "$(tail -c1 .env)" ]; then fail ".env 마지막 줄바꿈" "파일 끝에 줄바꿈이 없음 — echo >> .env 로 추가하면 앞 줄에 붙는다"; else pass ".env 마지막 줄바꿈"; fi
else
  fail ".env 파일" "platform/.env 없음"
fi
PROJ="$(docker inspect kafka --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
log "  compose 프로젝트: ${PROJ:-?} (docker compose ps/down은 이 프로젝트 이름으로 동작)"
if [ -n "$EXPECTED_PROJECT" ]; then
  if [ "$PROJ" = "$EXPECTED_PROJECT" ]; then pass "compose 프로젝트 이름 = $PROJ"
  else fail "compose 프로젝트 이름" "실제='$PROJ', 기대='$EXPECTED_PROJECT'"; fi
fi
VOL="$(docker inspect kafka --format '{{range .Mounts}}{{if eq .Destination "/var/lib/kafka/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
log "  Kafka 볼륨: ${VOL:-?}"
STRAY="$(docker volume ls --format '{{.Name}}' | grep -E '_(kafka-data|hdfs-namenode-data|hdfs-datanode-data)$' | grep -v "^${PROJ:-__none__}_" | tr '\n' ' ')"
[ -n "$STRAY" ] && log "  참고: 쓰이지 않는 볼륨 후보: $STRAY (확인 후 docker volume rm으로 정리 가능)"

# ---------------------------------------------------------------------
step "1. 컨테이너 상태"
for c in kafka redis hdfs-namenode hdfs-datanode spark api-server inference-service; do
  st="$(docker inspect "$c" --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' 2>/dev/null || echo "없음 -")"
  run="${st%% *}"; health="${st##* }"
  if [ "$run" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "-" ]; }; then pass "$c ($st)"
  else fail "$c" "상태=$st"; fi
done

# ---------------------------------------------------------------------
step "2. Kafka"
check "브로커 응답" $KT/kafka-broker-api-versions.sh $BS
TOPICS="$($KT/kafka-topics.sh $BS --list 2>/dev/null)"
echo "$TOPICS" >>"$OUT/run.log"
for t in posture.summary posture.inference; do
  if echo "$TOPICS" | grep -qx "$t"; then pass "토픽 $t 존재"
  else skip "토픽 $t" "아직 없음(첫 메시지 때 자동 생성) — 7단계 후 다시 확인"; fi
done
PC="$($KT/kafka-topics.sh $BS --describe --topic posture.inference 2>/dev/null | grep -oE 'PartitionCount: *[0-9]+' | grep -oE '[0-9]+')"
if [ -n "$PC" ]; then
  if [ "$PC" -ge 3 ]; then pass "posture.inference 파티션 $PC개"
  else fail "posture.inference 파티션" "$PC개 (3개 필요: kafka-topics.sh --alter --partitions 3)"; fi
fi
IT_TOPIC="it.smoke.$TS"
MSG="it-$TS-$RANDOM"
if $KT/kafka-topics.sh $BS --create --topic "$IT_TOPIC" --partitions 1 --replication-factor 1 >>"$OUT/run.log" 2>&1 \
   && echo "$MSG" | docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh $BS --topic "$IT_TOPIC" >>"$OUT/run.log" 2>&1; then
  GOT="$($KT/kafka-console-consumer.sh $BS --topic "$IT_TOPIC" --from-beginning --max-messages 1 --timeout-ms 15000 2>>"$OUT/run.log")"
  if [ "$GOT" = "$MSG" ]; then pass "임시 토픽 produce→consume 왕복"; else fail "임시 토픽 왕복" "받은 값='$GOT'"; fi
else
  fail "임시 토픽 생성/발행"
fi
$KT/kafka-topics.sh $BS --delete --topic "$IT_TOPIC" >>"$OUT/run.log" 2>&1 || true

# ---------------------------------------------------------------------
step "3. Redis"
R="docker exec redis redis-cli"
if [ "$($R PING 2>/dev/null)" = "PONG" ]; then pass "PING"; else fail "PING"; fi
K="it:smoke:$TS"
$R SET "$K" ok EX 60 >/dev/null 2>&1
V="$($R GET "$K" 2>/dev/null)"; TTL="$($R TTL "$K" 2>/dev/null)"
if [ "$V" = "ok" ] && [ "${TTL:-0}" -gt 0 ] 2>/dev/null; then pass "SET/GET/TTL"; else fail "SET/GET/TTL" "값='$V' TTL='$TTL'"; fi
$R DEL "$K" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------
step "4. HDFS"
H="docker exec hdfs-namenode"
REPORT="$($H hdfs dfsadmin -report 2>/dev/null)"
echo "$REPORT" | head -20 >>"$OUT/run.log"
LIVE="$(echo "$REPORT" | grep -oE 'Live datanodes \([0-9]+\)' | grep -oE '[0-9]+')"
if [ "${LIVE:-0}" -ge 1 ]; then pass "DataNode ${LIVE}개 연결"; else fail "DataNode 연결" "Live datanodes=${LIVE:-?}"; fi
SM="$($H hdfs dfsadmin -safemode get 2>/dev/null)"
if echo "$SM" | grep -q "OFF"; then pass "safemode OFF"; else fail "safemode" "$SM"; fi
HP="/tmp/it-smoke-$TS.txt"
if $H bash -c "echo '$MSG' > /tmp/it.txt && hdfs dfs -mkdir -p /tmp && hdfs dfs -put -f /tmp/it.txt $HP" >>"$OUT/run.log" 2>&1 \
   && [ "$($H hdfs dfs -cat "$HP" 2>/dev/null)" = "$MSG" ]; then pass "파일 put→cat"
else fail "파일 put→cat"; fi
$H hdfs dfs -rm -skipTrash "$HP" >>"$OUT/run.log" 2>&1 || true

# ---------------------------------------------------------------------
step "5. Spark ↔ HDFS"
if [ "$QUICK" = 1 ]; then skip "Parquet 왕복" "--quick"
elif [ ! -f hdfs_parquet_roundtrip.py ]; then skip "Parquet 왕복" "hdfs_parquet_roundtrip.py 없음"
else
  docker cp hdfs_parquet_roundtrip.py spark:/opt/spark/it_roundtrip.py >>"$OUT/run.log" 2>&1
  timeout 300 docker exec spark /opt/spark/bin/spark-submit --master 'local[2]' /opt/spark/it_roundtrip.py >"$OUT/spark-roundtrip.log" 2>&1
  if grep -q "왕복 테스트 성공" "$OUT/spark-roundtrip.log"; then pass "Parquet 쓰기→읽기 (spark-submit)"
  else fail "Parquet 왕복" "$OUT/spark-roundtrip.log 확인"; fi
fi

# ---------------------------------------------------------------------
step "6. 서비스"
LV="$(curl -s -m 5 "$API/actuator/health/liveness")"
if echo "$LV" | grep -q '"status":"UP"'; then pass "api-server liveness"; else fail "api-server liveness" "${LV:-응답 없음}"; fi
RD="$(curl -s -m 10 "$API/actuator/health/readiness")"
echo "$RD" >>"$OUT/run.log"
for comp in db redis; do
  if echo "$RD" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d['components']['$comp']['status']=='UP' else 1)" 2>/dev/null
  then pass "readiness: $comp UP"; else fail "readiness: $comp" "$RD"; fi
done
IH="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$INFER/health")"
if [ "$IH" = "200" ]; then pass "inference-service /health"; else fail "inference-service /health" "HTTP $IH"; fi
GRP="$($KT/kafka-consumer-groups.sh $BS --describe --group api-server-cep 2>/dev/null)"
echo "$GRP" >>"$OUT/run.log"
NC="$(echo "$GRP" | awk '$2=="posture.inference" && $7 ~ /consumer/ {print $7}' | sort -u | wc -l)"
if [ "$NC" -ge 1 ]; then pass "판정 컨슈머 그룹 참여 (${NC}개 스레드)"; else skip "판정 컨슈머 그룹" "아직 할당 없음(토픽 생성 전일 수 있음)"; fi

# ---------------------------------------------------------------------
step "7. 종단 시험 (T-10)"
if ! echo "$RD" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin)['components']['db']['status']=='UP' else 1)" 2>/dev/null; then
  log "  주의: readiness db가 DOWN — 판정 컨슈머가 DB 대기로 멈춰 종단 시험이 실패할 수 있다(D-18). docker logs api-server 의 'Caused by' 확인"
fi
if [ "$E2E" = 0 ]; then skip "T-10 종단 시험" "--no-e2e"
elif [ ! -f "$SOURCE_CSV" ]; then skip "T-10 종단 시험" "$SOURCE_CSV 없음(저장소 밖 파일 — 기존 클론에서 복사하거나 SOURCE_CSV=경로 지정)"
else
  T10="$OUT/t10.csv"
  python3 mysql/generate_collapse_test_csv.py --input "$SOURCE_CSV" --output "$T10" >"$OUT/t10-generate.log" 2>&1
  SID="$(grep -oE 'session_id\(capture_id\) = [0-9a-f-]+' "$OUT/t10-generate.log" | awk '{print $3}')"
  if [ -z "$SID" ]; then fail "T-10 CSV 생성" "$OUT/t10-generate.log 확인"
  else
    pass "T-10 CSV 생성 (sessionId=$SID)"
    # 테스트용 사용자 ID로 바꿔 실제 사용자(P01) 상태와 섞이지 않게 한다
    IT_USER="IT-$TS"
    python3 - "$T10" "$IT_USER" <<'PY'
import csv,sys
p,u=sys.argv[1],sys.argv[2]
rows=list(csv.reader(open(p,encoding="utf-8-sig")))
h=rows[0]; i=h.index("participant_code")
for r in rows[1:]: r[i]=u
w=csv.writer(open(p,"w",newline="",encoding="utf-8")); w.writerows(rows)
PY
    python3 mysql/replay_posture_pilot_csv.py --file "$T10" --pace fast >"$OUT/t10-replay.log" 2>&1
    if grep -qE '성공\(202\): 850 / 실패: 0' "$OUT/t10-replay.log"; then pass "재생 850건 전송 (HTTP 202)"
    else fail "재생 전송" "$OUT/t10-replay.log 확인"; fi

    # 판정 결과 대기 (최대 60초)
    EV=""
    for _ in $(seq 1 30); do
      EV="$(curl -s -m 5 "$API/cep/events/recent" | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=[e for e in d.get('events',[]) if e.get('sessionId')=='$SID' and not e.get('ongoing')]
print(json.dumps(m[-1]) if m else '')" 2>/dev/null)"
      [ -n "$EV" ] && break; sleep 2
    done
    echo "이벤트: ${EV:-없음}" >>"$OUT/run.log"
    if [ -z "$EV" ]; then fail "판정 이벤트" "60초 안에 sessionId=$SID 종료 이벤트 없음 (docker logs api-server 확인)"
    else
      if echo "$EV" | python3 -c "
import json,sys;e=json.load(sys.stdin)
ok=abs(e['durationSeconds']-73.1)<0.05 and e['alertCount']==2 and e['recovered'] is True
sys.exit(0 if ok else 1)"; then pass "판정 결과: 지속 73.1s, 재알림 2회, 회복 (DN-24 기대값)"
      else fail "판정 결과" "$EV (기대: 73.1s / alertCount 2 / recovered true)"; fi
    fi

    sleep 3
    LAG="$($KT/kafka-consumer-groups.sh $BS --describe --group api-server-cep 2>/dev/null | awk '$2=="posture.inference" && $6 ~ /^[0-9]+$/ {s+=$6} END{print s+0}')"
    if [ "$LAG" = "0" ]; then pass "판정 컨슈머 lag 0"; else fail "판정 컨슈머 lag" "$LAG"; fi
    ILAG="$($KT/kafka-consumer-groups.sh $BS --list 2>/dev/null | grep -i inference | head -1)"
    [ -n "$ILAG" ] && log "  참고: 추론 컨슈머 그룹 $ILAG lag=$($KT/kafka-consumer-groups.sh $BS --describe --group "$ILAG" 2>/dev/null | awk '$6 ~ /^[0-9]+$/ {s+=$6} END{print s+0}')"

    # 판정이 끝났을 때만 의미가 있다(판정이 안 돌았으면 키가 처음부터 없어서 0이 나온다)
    if [ -n "$EV" ]; then
      RK="$(docker exec redis redis-cli EXISTS "posture:state:$IT_USER" 2>/dev/null)"
      if [ "$RK" = "0" ]; then pass "Redis 상태 키 정리 (회복 후 삭제, D-04)"; else fail "Redis 상태 키" "posture:state:$IT_USER 가 남아 있음"; fi
    else
      skip "Redis 상태 키 정리" "판정 이벤트가 없어 확인 의미 없음"
    fi

    # DB 쓰기 버퍼(D-18) — 적용된 서버에서만. 보관분이 모두 DB에 반영됐는지 확인한다(최대 15초 대기).
    DW_CODE="$(curl -s -m 5 -o "$OUT/db-writer.json" -w '%{http_code}' "$API/cep/db-writer")"
    if [ "$DW_CODE" = "200" ]; then
      DW_OK=1
      for _ in $(seq 1 15); do
        if python3 -c "
import json,sys
d=json.load(open('$OUT/db-writer.json'))
sys.exit(0 if d['pendingSessions']==0 and d['pendingEvents']==0 and d['consecutiveFailures']==0 else 1)" 2>/dev/null; then DW_OK=0; break; fi
        sleep 1; curl -s -m 5 -o "$OUT/db-writer.json" "$API/cep/db-writer"
      done
      if [ "$DW_OK" = 0 ]; then pass "DB 쓰기 버퍼 비움 (D-18: 보관 0, 연속 실패 0)"
      else fail "DB 쓰기 버퍼" "$(cat "$OUT/db-writer.json")"; fi
    else
      skip "DB 쓰기 버퍼" "/cep/db-writer 없음(HTTP $DW_CODE) — D-18 적용 전 서버"
    fi

    # MySQL 직접 확인 — mysql 클라이언트가 없으면 python mysql-connector(mysql/requirements.txt)로 확인
    if [ -f .env ] && python3 -c "import mysql.connector" 2>/dev/null; then
      ROW="$(python3 - "$SID" <<'PY2' 2>>"$OUT/run.log"
import sys, mysql.connector
env = dict(l.rstrip("\n").split("=", 1) for l in open(".env", encoding="utf-8") if "=" in l and not l.lstrip().startswith("#"))
c = mysql.connector.connect(host=env["DB_HOST"], port=int(env.get("DB_PORT", "3306")), user=env["DB_USER"],
                            password=env["DB_PASSWORD"], database=env.get("DB_NAME", "posture_app"), connection_timeout=5)
cur = c.cursor()
cur.execute("SELECT duration_seconds, alert_count, recovered FROM collapse_events WHERE session_id=%s", (sys.argv[1],))
r = cur.fetchone()
print("" if r is None else f"{float(r[0]):.1f} {int(r[1])} {int(r[2])}")
PY2
)"
      if [ "$ROW" = "73.1 2 1" ]; then pass "MySQL collapse_events 행 (73.1 / 2 / 1)"
      else fail "MySQL collapse_events 행" "'${ROW:-행 없음}' (기대: 73.1 2 1)"; fi
    elif command -v mysql >/dev/null && [ -f .env ]; then
      DBH="$(grep -E '^DB_HOST=' .env | cut -d= -f2-)"; DBP="$(grep -E '^DB_PORT=' .env | cut -d= -f2-)"
      DBU="$(grep -E '^DB_USER=' .env | cut -d= -f2-)"; DBN="$(grep -E '^DB_NAME=' .env | cut -d= -f2-)"
      ROW="$(MYSQL_PWD="$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2-)" mysql -h "$DBH" -P "${DBP:-3306}" -u "$DBU" "${DBN:-posture_app}" -N -e \
        "SELECT duration_seconds, alert_count, recovered FROM collapse_events WHERE session_id='$SID'" 2>>"$OUT/run.log")"
      if echo "$ROW" | grep -qE '^73\.1[0-9]*\s+2\s+1$'; then pass "MySQL collapse_events 행 (73.1 / 2 / 1)"
      else fail "MySQL collapse_events 행" "'$ROW'"; fi
    else
      skip "MySQL 직접 확인" "mysql 클라이언트·mysql-connector 없음 — pip install -r mysql/requirements.txt"
    fi

    # (선택) posture-sink → HDFS 적재 확인
    if [ "$QUICK" = 1 ]; then skip "HDFS 적재(posture-sink)" "--quick"
    elif ! docker exec spark pgrep -f posture_sink_stream.py >/dev/null 2>&1; then
      skip "HDFS 적재(posture-sink)" "posture-sink 미실행 — ./run_posture_sink.sh 로 시작 후 다시 실행"
    elif [ ! -f check_session.py ]; then skip "HDFS 적재(posture-sink)" "check_session.py 없음"
    else
      log "  posture-sink 마이크로배치(10초) 대기 25초..."
      sleep 25
      docker cp check_session.py spark:/opt/spark/it_check_session.py >>"$OUT/run.log" 2>&1
      timeout 300 docker exec spark /opt/spark/bin/spark-submit --master 'local[2]' /opt/spark/it_check_session.py "$SID" >"$OUT/hdfs-sink-check.log" 2>&1
      N="$(grep -oE '로 [0-9]+건 발견' "$OUT/hdfs-sink-check.log" | grep -oE '[0-9]+')"
      if [ "${N:-0}" -ge 850 ]; then pass "HDFS 적재: posture.summary ${N}건 (Kafka → Spark → HDFS)"
      elif [ "${N:-0}" -gt 0 ]; then fail "HDFS 적재" "${N}건 / 850건 (일부만 적재 — 잠시 후 재확인)"
      else fail "HDFS 적재" "0건 — $OUT/hdfs-sink-check.log, docker exec spark tail /tmp/posture-sink.log"; fi
    fi
  fi
fi

# 7단계 뒤 토픽 재확인 (처음에 없었던 경우)
for t in posture.summary posture.inference; do
  if ! echo "$TOPICS" | grep -qx "$t" && $KT/kafka-topics.sh $BS --list 2>/dev/null | grep -qx "$t"; then
    pass "토픽 $t 생성됨(재생 후)"
  fi
done

# ---------------------------------------------------------------------
{
  echo "통합 테스트 결과: $TS"
  echo "PASS $PASS / FAIL $FAIL / SKIP $SKIP"
  echo
  printf '%s\n' "${RESULTS[@]}"
} > "$OUT/summary.txt"
log ""
log "== 요약 =="
cat "$OUT/summary.txt" | tee -a "$OUT/run.log" >/dev/null
echo "PASS $PASS / FAIL $FAIL / SKIP $SKIP   (상세: $OUT/)"
[ "$FAIL" -eq 0 ]
