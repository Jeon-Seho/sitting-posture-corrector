#!/usr/bin/env bash
# =====================================================================
# 빅데이터 플랫폼 통합 테스트 (ToDo T-12)
#
# 서버 PC에서 실행한다. 어디서 실행해도 저장소 루트로 옮겨 가서 돈다(D-50).
# compose 파일은 infra/compose/bigdata.yaml(프로젝트 이름 platform), 비밀값은 infra/compose/.env.
#   tools/platform/integration_test.sh            # 전체 (약 2~3분)
#   tools/platform/integration_test.sh --quick    # Spark 작업(왕복·적재 확인) 생략 (약 1분)
#   tools/platform/integration_test.sh --no-e2e   # 구성요소 점검만 (데이터 재생 없음)
#   tools/platform/integration_test.sh --restart  # 9단계(D-37)까지: 재생 도중 api-server를 재시작해 v1 판정 상태 복원 확인 (약 1분 추가)
#   EXPECT_PROJECT=platform tools/platform/integration_test.sh   # compose 프로젝트 이름까지 확인할 때
#
# 점검 순서
#   0. 사전 확인   : docker, python3+requests, .env 형식·필수 값·주소/포트·이미지 태그(D-24), compose 해석, 프로젝트·Kafka 볼륨(정보)
#   1. 컨테이너    : 7개 실행·healthy
#   2. Kafka       : 브로커, 토픽·파티션, 임시 토픽 produce→consume 왕복
#   3. Redis       : PING, SET/GET/TTL/DEL
#   4. HDFS        : DataNode 수, safemode, 파일 put→cat→rm
#   5. Spark       : Spark↔HDFS Parquet 왕복 (bigdata/tools/hdfs_parquet_roundtrip.py)
#   6. 서비스      : api-server liveness/readiness(DB·Redis), inference /health, 확정 서비스 DB V2.3 준비(D-32·D-51)
#   7. 종단(T-10)  : 합성 CSV 재생 → Kafka → 추론 → 판정 → 이벤트 73.1s·재알림 2회,
#                    컨슈머 lag 0, Redis 상태 키 정리, DB 쓰기 버퍼(D-18), MySQL 행, (선택) HDFS 적재
#   8. 계약 v1      : 시험용 입구 → posture.features.v1 → 추론 → posture.inference.v1 → v1 판정(D-22)
#                    → 확정·재알림·복귀(73.0s)·종료, posture.episodes.v1 발행, v1 lag 0, DLQ(D-36)
#   9. v1 상태 복원 : (--restart일 때만) 같은 세션을 앞 60건 → api-server 재시작 → 나머지로 나눠 보내고
#                    8단계와 같은 사건·요약(누락 0)인지, Redis posture:v1:judge:<id> 저장·삭제 확인(D-37)
#  10. 입출구 서버 : (io-api 컨테이너가 있을 때만 — compose --profile io) io-api·inference healthy·KST,
#                    REST 점검 tools/platform/io_api_smoke.py(가입 → 기준 → 세션 생성·구간·종료·조회 → 기록 → 삭제 → 탈퇴, D-48)
#                    합성 시험 계정(test-it-*@example.invalid)은 탈퇴 접수 상태로 남고 J3가 30일 뒤 지운다.
#  11. 결과 저장    : (REPORT_TEST_FIXTURES_ENABLED=true일 때) 시험 계정·기준 자세·세션 행 → v1 재생 → posture_service(V2.3)에
#                    세션 종료·이벤트·알림 저장 확인, 같은 decision 다시 넣기(멱등), 시험 행 삭제(D-30·D-51). KEEP_D30=1이면 남김
#
# 결과: tools/platform/it-results/<시각>/ 에 단계별 로그와 summary.txt. FAIL이 하나라도 있으면 종료 코드 1.
# 이 스크립트는 운영 데이터를 지우지 않는다. 만드는 것은 임시 토픽·HDFS 임시 파일·Redis 임시 키뿐이고
# 끝나면 지운다. 단, T-10·v1 재생은 실제 판정 경로를 타므로 sessions/collapse_events에 테스트 행이 남는다(userId=IT-<시각>, IT-V1-<시각>).
# =====================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# (D-50) 저장소 루트에서 돈다. compose·비밀값·도구 경로는 아래 변수로만 쓴다.
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT" || exit 1
COMPOSE_FILE_PATH="infra/compose/bigdata.yaml"
DC="docker compose -f $COMPOSE_FILE_PATH"
ENV_FILE="infra/compose/.env"
export IT_ENV_FILE="$ENV_FILE"
TOOLS="tools/platform"

QUICK=0; E2E=1; RESTART=0
for a in "$@"; do
  case "$a" in
    --quick) QUICK=1 ;;
    --no-e2e) E2E=0 ;;
    --restart) RESTART=1 ;;
    -h|--help) sed -n 2,35p "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션: $a (--help 참고)"; exit 2 ;;
  esac
done

# (D-24) .env 값 읽기 — 마지막 줄이 이긴다(compose와 같음). 따옴표는 벗긴다. 없으면 빈 값.
envval() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
envor() { local v; v="$(envval "$1")"; echo "${v:-$2}"; }
API="${API_URL:-http://localhost:$(envor API_SERVER_HOST_PORT 8080)}"
INFER="${INFERENCE_URL:-http://localhost:$(envor INFERENCE_HOST_PORT 8000)}"
# 기대 프로젝트 이름: 환경변수로 줄 때만 비교한다(없으면 정보로만 출력).
EXPECTED_PROJECT="${EXPECT_PROJECT:-}"
SOURCE_CSV="${SOURCE_CSV:-$TOOLS/posture-pilot-P01.csv}"
TS="$(date +%Y%m%d-%H%M%S)"
TS_EPOCH="$(date +%s)"
OUT="$TOOLS/it-results/$TS"
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

log "통합 테스트 시작: $TS (quick=$QUICK, e2e=$E2E, restart=$RESTART)"

# ---------------------------------------------------------------------
step "0. 사전 확인"
if ! command -v docker >/dev/null; then fail "docker 명령"; echo "docker가 없습니다."; exit 1; fi
pass "docker 명령"
if python3 -c "import requests" 2>/dev/null; then pass "python3 + requests"
else fail "python3 + requests" "pip install -r $TOOLS/requirements.txt"; fi

# .env 형식 점검: 숫자여야 하는 값(…_SECONDS/_SIZE/_CONCURRENCY/_PORT)에 다른 글자가 붙어 있지 않은지,
# 파일 끝 줄바꿈이 있는지(없으면 echo >> 로 덧붙인 줄이 앞 줄에 붙음 — 2026-10-07 실제 장애 원인)
if [ -f "$ENV_FILE" ]; then
  BAD="$(grep -E '^[A-Z0-9_]+(_SECONDS|_SIZE|_CONCURRENCY|_PORT)=' "$ENV_FILE" | grep -vE '^[A-Z0-9_]+=[0-9]+[[:space:]]*$' | cut -d= -f1 | tr '\n' ' ')"
  if [ -n "$BAD" ]; then fail ".env 숫자 값 형식" "숫자가 아닌 값: $BAD"; else pass ".env 숫자 값 형식"; fi
  if [ -n "$(tail -c1 "$ENV_FILE")" ]; then fail ".env 마지막 줄바꿈" "파일 끝에 줄바꿈이 없음 — echo >> .env 로 추가하면 앞 줄에 붙는다"; else pass ".env 마지막 줄바꿈"; fi
  # (D-24) 필수 값 — 실행 환경마다 다른 값(env.example 1·2장). 하나라도 없으면 compose도 시작하지 않는다(SERVER_LAN_IP·SERVICE_DB_SCHEMA)
  MISSING=""
  for k in SERVER_LAN_IP DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD SERVICE_DB_SCHEMA; do
    [ -n "$(envval "$k")" ] || MISSING="$MISSING $k"
  done
  if [ -n "$MISSING" ]; then fail ".env 필수 값" "없음:$MISSING (infra/compose/env.example 1·2장)"; else pass ".env 필수 값 (서버 주소·DB)"; fi
  # IP·바인딩 주소 형식(IPv4)과 포트 범위
  BADV=""
  for k in SERVER_LAN_IP GPU_PC_IP API_SERVER_BIND INFERENCE_BIND IO_API_BIND; do
    v="$(envval "$k")"
    [ -z "$v" ] && continue
    echo "$v" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || BADV="$BADV $k=$v"
  done
  for k in $(grep -oE '^[A-Z0-9_]+_PORT=' "$ENV_FILE" | tr -d = | sort -u); do
    v="$(envval "$k")"
    [ -z "$v" ] && continue
    { [ "$v" -ge 1 ] && [ "$v" -le 65535 ]; } 2>/dev/null || BADV="$BADV $k=$v"
  done
  if [ -n "$BADV" ]; then fail ".env 주소·포트 형식" "$BADV"; else pass ".env 주소·포트 형식"; fi
  # 이미지 태그 고정(latest 금지, CLAUDE.md 고정 결정)
  LATEST="$(grep -E '^[A-Z0-9_]+_IMAGE=' "$ENV_FILE" | grep -E ':latest[[:space:]]*$|=[^:]*$' | cut -d= -f1 | tr '\n' ' ')"
  if [ -n "$LATEST" ]; then fail ".env 이미지 태그" "latest이거나 태그 없음: $LATEST"; else pass ".env 이미지 태그 고정"; fi
  if $DC config --quiet >>"$OUT/run.log" 2>&1; then pass "compose 설정 해석 (.env 값 치환)"
  else fail "compose 설정 해석" "$DC config 실패 — $OUT/run.log"; fi
else
  fail ".env 파일" "$ENV_FILE 없음 — cp infra/compose/env.example infra/compose/.env 후 값 채우기"
fi
PROJ="$(docker inspect kafka --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
log "  compose 프로젝트: ${PROJ:-?} ($DC ps/down은 이 프로젝트 이름으로 동작)"
if [ -n "$EXPECTED_PROJECT" ]; then
  if [ "$PROJ" = "$EXPECTED_PROJECT" ]; then pass "compose 프로젝트 이름 = $PROJ"
  else fail "compose 프로젝트 이름" "실제='$PROJ', 기대='$EXPECTED_PROJECT'"; fi
fi
VOL="$(docker inspect kafka --format '{{range .Mounts}}{{if eq .Destination "/var/lib/kafka/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
log "  Kafka 볼륨: ${VOL:-?}"
STRAY="$(docker volume ls --format '{{.Name}}' | grep -E '_(kafka-data|redis-data|hdfs-namenode-data|hdfs-datanode-data)$' | grep -v "^${PROJ:-__none__}_" | tr '\n' ' ')"
[ -n "$STRAY" ] && log "  참고: 쓰이지 않는 볼륨 후보: $STRAY (확인 후 docker volume rm으로 정리 가능)"

# ---------------------------------------------------------------------
step "1. 컨테이너 상태"
for c in kafka redis hdfs-namenode hdfs-datanode spark api-server inference-service; do
  st="$(docker inspect "$c" --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' 2>/dev/null || echo "없음 -")"
  run="${st%% *}"; health="${st##* }"
  if [ "$run" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "-" ]; }; then pass "$c ($st)"
  else fail "$c" "상태=$st"; fi
done
# (D-20) 컨테이너 시간대 = 한국 시각(+0900)
TZ_BAD=""
for c in kafka redis hdfs-namenode hdfs-datanode spark api-server inference-service; do
  z="$(docker exec "$c" date +%z 2>/dev/null || echo '?')"
  [ "$z" = "+0900" ] || TZ_BAD="$TZ_BAD $c($z)"
done
if [ -z "$TZ_BAD" ]; then pass "컨테이너 시간대 KST(+0900) 7개 (D-20)"
else fail "컨테이너 시간대" "KST 아님:$TZ_BAD — $DC up -d --force-recreate 필요(D-20)"; fi

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
# (D-21) 계약 v1 토픽 — api-server가 시작할 때 만든다(파티션 3)
for t in posture.features.v1 posture.inference.v1 posture.episodes.v1 posture.dlq; do
  PC="$($KT/kafka-topics.sh $BS --describe --topic "$t" 2>/dev/null | grep -oE 'PartitionCount: *[0-9]+' | grep -oE '[0-9]+')"
  if [ -z "$PC" ]; then fail "토픽 $t" "없음 — D-21 적용 후 api-server 재빌드·재생성 필요"
  elif [ "$PC" -ge 3 ] || { [ "$t" = posture.dlq ] && [ "$PC" -ge 1 ]; }; then pass "토픽 $t (파티션 $PC개)"
  else fail "토픽 $t 파티션" "$PC개 (3개 필요)"; fi
done
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
elif [ ! -f bigdata/tools/hdfs_parquet_roundtrip.py ]; then skip "Parquet 왕복" "bigdata/tools/hdfs_parquet_roundtrip.py 없음"
else
  docker cp bigdata/tools/hdfs_parquet_roundtrip.py spark:/opt/spark/it_roundtrip.py >>"$OUT/run.log" 2>&1
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
# (D-32·D-51) 확정 서비스 DB(posture_service V2.3) — 테이블 13개·판정 결과 컬럼·지운 컬럼 없음·기본 정책(값 4개)·계정 권한
SDB="$(curl -s -m 15 "$API/cep/service-db")"
echo "서비스 DB: ${SDB:-응답 없음}" >>"$OUT/run.log"
if [ -z "$SDB" ] || ! echo "$SDB" | python3 -c "import json,sys;json.load(sys.stdin)" 2>/dev/null; then
  fail "서비스 DB (D-32·D-51)" "GET /cep/service-db 응답 없음 — api-server 재빌드 확인"
elif echo "$SDB" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('enabled') is False else 1)"; then
  skip "서비스 DB (D-32·D-51)" "SERVICE_DB_ENABLED=false"
elif echo "$SDB" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('ok') else 1)"; then
  pass "서비스 DB 준비 (D-32·D-51: $(echo "$SDB" | python3 -c "import json,sys;d=json.load(sys.stdin);w=d.get('warnings') or [];print(d['schema'],d.get('specVersion'),'테이블',d.get('tableCount'),'· 기본 정책 id',d.get('defaultPolicyId'),('· 경고: '+'; '.join(w)) if w else '')"))"
else
  fail "서비스 DB (D-32·D-51)" "$(echo "$SDB" | python3 -c "import json,sys;print('; '.join(json.load(sys.stdin).get('problems',[])))")"
fi
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
  python3 $TOOLS/generate_collapse_test_csv.py --input "$SOURCE_CSV" --output "$T10" >"$OUT/t10-generate.log" 2>&1
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
    python3 $TOOLS/replay_posture_pilot_csv.py --file "$T10" --pace fast >"$OUT/t10-replay.log" 2>&1
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
      # (D-21) 상태 키 = session_id
      RK="$(docker exec redis redis-cli EXISTS "posture:state:$SID" 2>/dev/null)"
      if [ "$RK" = "0" ]; then pass "Redis 상태 키 정리 (회복 후 삭제, D-04)"; else fail "Redis 상태 키" "posture:state:$SID 가 남아 있음"; fi
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

    # MySQL 직접 확인 — mysql 클라이언트가 없으면 python mysql-connector(tools/platform/requirements.txt)로 확인
    if [ -f "$ENV_FILE" ] && python3 -c "import mysql.connector" 2>/dev/null; then
      ROW="$(python3 - "$SID" <<'PY2' 2>>"$OUT/run.log"
import sys, mysql.connector
env = dict(l.rstrip("\n").split("=", 1) for l in open(__import__("os").environ["IT_ENV_FILE"], encoding="utf-8") if "=" in l and not l.lstrip().startswith("#"))
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
      # (D-20) 저장 기준 KST 확인: 방금 만든 세션의 started_at(=지금 시각)이 DB NOW()(KST)와 몇 초 차이인지
      LAG_S="$(python3 - "$SID" <<'PY3' 2>>"$OUT/run.log"
import sys, mysql.connector
env = dict(l.rstrip("\n").split("=", 1) for l in open(__import__("os").environ["IT_ENV_FILE"], encoding="utf-8") if "=" in l and not l.lstrip().startswith("#"))
c = mysql.connector.connect(host=env["DB_HOST"], port=int(env.get("DB_PORT", "3306")), user=env["DB_USER"],
                            password=env["DB_PASSWORD"], database=env.get("DB_NAME", "posture_app"), connection_timeout=5)
cur = c.cursor()
cur.execute("SELECT TIMESTAMPDIFF(SECOND, started_at, NOW(3)) FROM sessions WHERE session_id=%s", (sys.argv[1],))
r = cur.fetchone()
print("" if r is None else int(r[0]))
PY3
)"
      if [ -n "$LAG_S" ] && [ "${LAG_S#-}" -lt 1800 ]; then pass "DB 시각 기준 KST (세션 시작 ↔ DB NOW() ${LAG_S}초, D-20)"
      else fail "DB 시각 기준" "세션 시작과 DB NOW() 차이 '${LAG_S:-행 없음}'초 — 약 ±32400초면 9시간 어긋남(D-20)"; fi
    elif command -v mysql >/dev/null && [ -f "$ENV_FILE" ]; then
      DBH="$(grep -E '^DB_HOST=' "$ENV_FILE" | cut -d= -f2-)"; DBP="$(grep -E '^DB_PORT=' "$ENV_FILE" | cut -d= -f2-)"
      DBU="$(grep -E '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)"; DBN="$(grep -E '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)"
      ROW="$(MYSQL_PWD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)" mysql -h "$DBH" -P "${DBP:-3306}" -u "$DBU" "${DBN:-posture_app}" -N -e \
        "SELECT duration_seconds, alert_count, recovered FROM collapse_events WHERE session_id='$SID'" 2>>"$OUT/run.log")"
      if echo "$ROW" | grep -qE '^73\.1[0-9]*\s+2\s+1$'; then pass "MySQL collapse_events 행 (73.1 / 2 / 1)"
      else fail "MySQL collapse_events 행" "'$ROW'"; fi
    else
      skip "MySQL 직접 확인" "mysql 클라이언트·mysql-connector 없음 — pip install -r $TOOLS/requirements.txt"
    fi

    # (선택) posture-sink → HDFS 적재 확인
    if [ "$QUICK" = 1 ]; then skip "HDFS 적재(posture-sink)" "--quick"
    elif ! docker exec spark pgrep -f posture_sink_stream.py >/dev/null 2>&1; then
      skip "HDFS 적재(posture-sink)" "posture-sink 미실행 — bigdata/legacy/run_posture_sink.sh 로 시작 후 다시 실행"
    elif [ ! -f bigdata/legacy/check_session.py ]; then skip "HDFS 적재(posture-sink)" "bigdata/legacy/check_session.py 없음"
    else
      log "  posture-sink 마이크로배치(10초) 대기 25초..."
      sleep 25
      docker cp bigdata/legacy/check_session.py spark:/opt/spark/it_check_session.py >>"$OUT/run.log" 2>&1
      timeout 300 docker exec spark /opt/spark/bin/spark-submit --master 'local[2]' /opt/spark/it_check_session.py "$SID" >"$OUT/hdfs-sink-check.log" 2>&1
      N="$(grep -oE '로 [0-9]+건 발견' "$OUT/hdfs-sink-check.log" | grep -oE '[0-9]+')"
      if [ "${N:-0}" -ge 850 ]; then pass "HDFS 적재: posture.summary ${N}건 (Kafka → Spark → HDFS)"
      elif [ "${N:-0}" -gt 0 ]; then fail "HDFS 적재" "${N}건 / 850건 (일부만 적재 — 잠시 후 재확인)"
      else fail "HDFS 적재" "0건 — $OUT/hdfs-sink-check.log, docker exec spark tail /tmp/posture-sink.log"; fi
    fi
  fi
fi

# ---------------------------------------------------------------------
step "8. 실시간 계약 v1 (D-21·D-22·D-36)"
# v1 판정기 결과(GET /cep/v1/sessions/<id>)가 T-10 기대값인지 — 8단계·9단계 공통 (누락 구간 0까지 확인)
v1_expected() {
  python3 -c "
import json,sys
v=json.load(sys.stdin); ev=v['events']; s=v['summary']
k=[e['kind'] for e in ev]; t=[e['timestamp_ms'] for e in ev]
ok=(k==['collapse_confirmed','reminder','recovery_confirmed','session_ended'] and t[:3]==[8000,68000,78000]
    and [e['event_id'] for e in ev]==[1,2,3,4] and ev[2]['timestamp_ms']-ev[2]['onset_ms']==73000
    and s['collapse_count']==1 and s['alert_count']==2 and s['valid_ms']==85000 and s['mean_recovery_ms']==70000
    and s['missing_ms']==0 and v['last_sequence']==169)
sys.exit(0 if ok else 1)"
}
if [ "$E2E" = 0 ]; then skip "v1 종단 시험" "--no-e2e"
elif [ ! -f $TOOLS/replay_realtime_v1.py ]; then skip "v1 종단 시험" "$TOOLS/replay_realtime_v1.py 없음"
else
  V1_USER="IT-V1-$TS"
  python3 $TOOLS/replay_realtime_v1.py --api "$API/api/v1/realtime/features" --user-id "$V1_USER" --dump "$OUT/v1-messages.jsonl" >"$OUT/v1-replay.log" 2>&1
  V1_SID="$(grep -oE 'session_id = [0-9a-f-]+' "$OUT/v1-replay.log" | awk '{print $3}')"
  if grep -qE '성공\(202\) 172 / 실패 0' "$OUT/v1-replay.log"; then pass "v1 재생 172건 전송 (시작 1 + 0.5초 구간 170 + 종료 1, HTTP 202)"
  else fail "v1 재생 전송" "$OUT/v1-replay.log 확인 (404면 REALTIME_TEST_ENTRY_ENABLED·재빌드 확인)"; fi

  # (D-22) v1 판정기 결과 — 세션이 끝나면(session_ended) 최근 종료 목록에서 조회된다
  V1VIEW=""
  if [ -n "$V1_SID" ]; then
    for _ in $(seq 1 30); do
      V1VIEW="$(curl -s -m 5 "$API/cep/v1/sessions/$V1_SID")"
      echo "$V1VIEW" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('ended') else 1)" 2>/dev/null && break
      V1VIEW=""; sleep 2
    done
  fi
  echo "v1 판정: ${V1VIEW:-없음}" >>"$OUT/run.log"
  if [ -z "$V1VIEW" ]; then fail "v1 판정 결과" "60초 안에 session_id=${V1_SID:-?} 종료 안 됨 (curl $API/cep/v1/sessions/<id>, docker logs inference-service / api-server)"
  elif echo "$V1VIEW" | v1_expected; then pass "v1 판정: 확정(8.0s) → 재알림(68.0s) → 복귀(78.0s, 지속 73.0s) → 세션 종료, event_id 1~4, 요약 일치"
  else fail "v1 판정 결과" "$(echo "$V1VIEW" | head -c 600) (기대: 확정 8000·재알림 68000·복귀 78000·종료, 붕괴 1·알림 2)"; fi

  # (D-37) 세션이 끝나면 Redis의 v1 판정 상태 키를 지운다
  if [ -n "$V1_SID" ]; then
    RK1="$(docker exec redis redis-cli EXISTS "posture:v1:judge:$V1_SID" 2>/dev/null)"
    if [ "$RK1" = "0" ]; then pass "v1 판정 상태 키 정리 (종료 후 삭제, D-37)"
    else fail "v1 판정 상태 키 정리" "posture:v1:judge:$V1_SID EXISTS=${RK1:-?}"; fi
  fi

  # (D-22) posture.episodes.v1 발행 — 이 세션의 decision 4건, progress 1건 이상
  timeout 40 $KT/kafka-console-consumer.sh $BS --topic posture.episodes.v1 --from-beginning --timeout-ms 15000 \
    2>/dev/null | grep -F "$V1_SID" >"$OUT/v1-episodes.jsonl" || true
  ND="$(grep -c '"kind":"decision"' "$OUT/v1-episodes.jsonl" 2>/dev/null || true)"
  NP="$(grep -c '"kind":"progress"' "$OUT/v1-episodes.jsonl" 2>/dev/null || true)"
  if [ "${ND:-0}" = "4" ] && [ "${NP:-0}" -ge 1 ]; then pass "posture.episodes.v1 발행: decision ${ND}건, progress ${NP}건"
  else fail "posture.episodes.v1 발행" "decision ${ND:-0}건(기대 4), progress ${NP:-0}건 — $OUT/v1-episodes.jsonl"; fi

  sleep 3
  for g in inference-service-v1 api-server-cep-v1; do
    L="$($KT/kafka-consumer-groups.sh $BS --describe --group "$g" 2>/dev/null | awk '$6 ~ /^[0-9]+$/ {s+=$6; n++} END{if(n) print s+0}')"
    if [ "$L" = "0" ]; then pass "v1 컨슈머 $g lag 0"
    elif [ -z "$L" ]; then fail "v1 컨슈머 $g" "그룹 없음 — 서비스 재빌드·재생성 확인"
    else fail "v1 컨슈머 $g lag" "$L"; fi
  done

  # (D-36) DLQ — 깨진 메시지를 features.v1에 직접 넣으면 추론이 posture.dlq로 넘기고 계속 처리해야 한다
  DLQ_MARK="it-dlq-$TS-$RANDOM"
  echo "$DLQ_MARK" | docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh $BS --topic posture.features.v1 >>"$OUT/run.log" 2>&1
  GOTDLQ=""
  for _ in $(seq 1 10); do
    GOTDLQ="$(timeout 30 $KT/kafka-console-consumer.sh $BS --topic posture.dlq --from-beginning --timeout-ms 5000 2>/dev/null | grep -F "$DLQ_MARK" | head -1)"
    [ -n "$GOTDLQ" ] && break; sleep 2
  done
  echo "DLQ: ${GOTDLQ:-없음}" >>"$OUT/run.log"
  if echo "$GOTDLQ" | grep -q '"source_topic": *"posture.features.v1"'; then pass "DLQ: 깨진 메시지 → posture.dlq (D-36)"
  else fail "DLQ" "posture.dlq에 $DLQ_MARK 없음 — docker logs inference-service 확인"; fi
fi

# ---------------------------------------------------------------------
step "9. v1 판정 상태 복원 (D-37)"
if [ "$RESTART" = 0 ]; then skip "v1 재시작 복원" "--restart 옵션으로 실행(api-server를 재시작함)"
elif [ "$E2E" = 0 ]; then skip "v1 재시작 복원" "--no-e2e"
elif [ ! -f $TOOLS/replay_realtime_v1.py ]; then skip "v1 재시작 복원" "$TOOLS/replay_realtime_v1.py 없음"
else
  R_SID="$(python3 -c 'import uuid;print(uuid.uuid4())')"
  R_USER="IT-V1R-$TS"
  RP="python3 $TOOLS/replay_realtime_v1.py --api $API/api/v1/realtime/features --user-id $R_USER --session-id $R_SID"
  $RP --range 0:60 >"$OUT/v1-restart-1.log" 2>&1
  if grep -qE '성공\(202\) 60 / 실패 0' "$OUT/v1-restart-1.log"; then pass "재시작 전 전송 60건 (시작 1 + 구간 sequence 0~58)"
  else fail "재시작 전 전송" "$OUT/v1-restart-1.log"; fi

  # 판정기가 sequence 58까지 반영하고 사건(확정 8.0s)이 진행 중이어야 한다
  R1=""
  for _ in $(seq 1 30); do
    R1="$(curl -s -m 5 "$API/cep/v1/sessions/$R_SID")"
    echo "$R1" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get('last_sequence')==58 and d.get('active') else 1)" 2>/dev/null && break
    R1=""; sleep 2
  done
  echo "재시작 전 v1 판정: ${R1:-없음}" >>"$OUT/run.log"
  if [ -n "$R1" ]; then pass "재시작 전: 사건 진행 중(확정 8.0s), last_sequence 58"
  else fail "재시작 전 판정" "60초 안에 last_sequence 58·active 안 됨 (curl $API/cep/v1/sessions/$R_SID)"; fi
  RK2="$(docker exec redis redis-cli EXISTS "posture:v1:judge:$R_SID" 2>/dev/null)"
  if [ "$RK2" = "1" ]; then pass "Redis에 v1 판정 상태 저장 (posture:v1:judge:<session_id>)"
  else fail "Redis v1 판정 상태 저장" "EXISTS=${RK2:-?}"; fi

  RESTART_AT="$(date +%s)"
  $DC restart api-server >>"$OUT/run.log" 2>&1
  UP=0
  for _ in $(seq 1 60); do
    if curl -s -m 3 "$API/actuator/health/readiness" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('status')=='UP' else 1)" 2>/dev/null; then UP=1; break; fi
    sleep 2
  done
  if [ "$UP" = 1 ]; then pass "api-server 재시작 → readiness UP"; else fail "api-server 재시작" "120초 안에 readiness UP 안 됨"; fi

  $RP --range 60: >"$OUT/v1-restart-2.log" 2>&1
  if grep -qE '성공\(202\) 112 / 실패 0' "$OUT/v1-restart-2.log"; then pass "재시작 후 전송 112건 (구간 sequence 59~169 + 종료)"
  else fail "재시작 후 전송" "$OUT/v1-restart-2.log"; fi

  R2=""
  for _ in $(seq 1 45); do
    R2="$(curl -s -m 5 "$API/cep/v1/sessions/$R_SID")"
    echo "$R2" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('ended') else 1)" 2>/dev/null && break
    R2=""; sleep 2
  done
  echo "재시작 후 v1 판정: ${R2:-없음}" >>"$OUT/run.log"
  if [ -z "$R2" ]; then fail "재시작 후 v1 판정" "90초 안에 종료 안 됨 (docker logs api-server)"
  elif echo "$R2" | v1_expected; then pass "재시작을 넘어 같은 결과: 확정 8.0s → 재알림 68.0s → 복귀 78.0s → 종료, event_id 1~4, 누락 0"
  else fail "재시작 후 v1 판정" "$(echo "$R2" | head -c 600) (복원 안 됐으면 event_id가 1부터 다시·missing_ms 30000)"; fi

  if docker logs --since "$RESTART_AT" api-server 2>&1 | grep -q "v1 판정 상태 복원 (sessionId=$R_SID"; then pass "api-server 로그: v1 판정 상태 복원"
  else fail "v1 판정 상태 복원 로그" "docker logs api-server | grep 'v1 판정 상태 복원'"; fi
  RK3="$(docker exec redis redis-cli EXISTS "posture:v1:judge:$R_SID" 2>/dev/null)"
  if [ "$RK3" = "0" ]; then pass "종료 후 v1 판정 상태 키 삭제"; else fail "종료 후 v1 판정 상태 키" "EXISTS=${RK3:-?}"; fi
fi

# 7단계 뒤 토픽 재확인 (처음에 없었던 경우)
for t in posture.summary posture.inference; do
  if ! echo "$TOPICS" | grep -qx "$t" && $KT/kafka-topics.sh $BS --list 2>/dev/null | grep -qx "$t"; then
    pass "토픽 $t 생성됨(재생 후)"
  fi
done

# ---------------------------------------------------------------------
step "10. 입출구 서버 (io-api, D-48)"
IO_API="${IO_API_URL:-http://127.0.0.1:$(envor IO_API_HOST_PORT 8090)}"
if ! docker inspect io-api >/dev/null 2>&1; then
  skip "입출구 서버" "io-api 컨테이너 없음 — $DC --profile io up -d --build (infra/README.md)"
else
  for c in inference io-api; do
    name="$c"; [ "$c" = inference ] && name="io-inference"
    st="$(docker inspect "$name" --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' 2>/dev/null || echo "없음 -")"
    if [ "$st" = "running healthy" ]; then pass "$name ($st)"; else fail "$name" "상태=$st (docker logs $name)"; fi
    z="$(docker exec "$name" date +%z 2>/dev/null || echo '?')"
    if [ "$z" = "+0900" ]; then pass "$name 시간대 KST"; else fail "$name 시간대" "$z"; fi
  done
  if python3 "$TOOLS/io_api_smoke.py" --base "$IO_API" >"$OUT/io-api.log" 2>&1; then
    pass "io-api REST 점검 ($(tail -1 "$OUT/io-api.log"))"
  else
    fail "io-api REST 점검" "$(grep -m3 '^FAIL' "$OUT/io-api.log" | tr '\n' ' ')(상세 $OUT/io-api.log)"
  fi
  if docker logs --since "$TS_EPOCH" io-api 2>&1 | grep -qE ' ERROR |Exception'; then
    log "  참고: io-api 로그에 ERROR/Exception — docker logs io-api 확인"
  fi
fi

# ---------------------------------------------------------------------
step "11. 판정 결과 저장 (D-30·D-51·D-39)"
# 저장 결과(GET /report/sessions/<id>)가 T-10 v1 기대값인지 — 세션 시작 기준 ms. V2.3은 종료 사유 컬럼이 없어
# 이벤트 종료 방식은 시각으로 판정한 end_kind(RECOVERED·SESSION_END·EXCLUDED), 알림은 시각만(표시 여부 = 세션 alert_enabled).
d30_expected() {
  python3 -c "
import json,sys
v=json.load(sys.stdin); ev=v.get('events') or []; al=v.get('alerts') or []
e=ev[0] if len(ev)==1 else {}
ok=(v.get('ended_ms')==85000 and float(v.get('good_sec') or -1)==15.0 and v.get('baseline_posture_id')
    and e.get('event_seq')==1 and e.get('started_ms')==5000 and e.get('confirmed_ms')==8000
    and e.get('ended_ms')==78000 and e.get('end_kind')=='RECOVERED' and e.get('recovered_ms')==78000
    and [(a['event_seq'],a['attempted_ms'],bool(a['displayed'])) for a in al]==[(1,8000,True),(1,68000,True)])
sys.exit(0 if ok else 1)"
}
STORE="$(curl -s -m 5 "$API/report/store")"
echo "report/store: ${STORE:-없음}" >>"$OUT/run.log"
if [ "$E2E" = 0 ]; then skip "판정 결과 저장" "--no-e2e"
elif ! echo "$STORE" | python3 -c "import json,sys;json.load(sys.stdin)" 2>/dev/null; then
  fail "판정 결과 저장 (D-30)" "GET /report/store 응답 없음 — api-server 재빌드 확인"
elif ! echo "$STORE" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('testFixturesEnabled') else 1)"; then
  skip "판정 결과 저장 (D-30)" "REPORT_TEST_FIXTURES_ENABLED=false — 시험 서버 .env에 true로 켜면 시험 계정·세션 행을 만들어 확인"
elif [ ! -f $TOOLS/replay_realtime_v1.py ]; then skip "판정 결과 저장 (D-30)" "$TOOLS/replay_realtime_v1.py 없음"
else
  D_SID="$(python3 -c 'import uuid;print(uuid.uuid4())')"
  CR="$(curl -s -m 10 -X POST "$API/report/test/sessions/$D_SID")"
  echo "시험 세션 생성: $CR" >>"$OUT/run.log"
  if echo "$CR" | grep -q '"baseline_posture_id"'; then pass "시험 계정·기준 자세·세션 행 생성 (DB-6, $D_SID)"
  else fail "시험 계정·세션 행 생성" "$(echo "$CR" | head -c 300)"; fi

  python3 $TOOLS/replay_realtime_v1.py --api "$API/api/v1/realtime/features" --user-id "IT-D30-$TS" --session-id "$D_SID" \
    >"$OUT/d30-replay.log" 2>&1
  DV=""
  for _ in $(seq 1 30); do
    DV="$(curl -s -m 5 "$API/report/sessions/$D_SID")"
    echo "$DV" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('ended_ms') is not None else 1)" 2>/dev/null && break
    DV=""; sleep 2
  done
  echo "저장 결과: ${DV:-없음}" >>"$OUT/run.log"
  if [ -z "$DV" ]; then fail "판정 결과 저장" "60초 안에 세션 종료가 저장되지 않음 (curl $API/report/store, docker logs api-server | grep 판정 결과 저장)"
  elif echo "$DV" | d30_expected; then pass "저장: 세션 종료(85.0s, good_sec 15.0) · 붕괴 1(시작 5.0s → 확정 8.0s → 회복 78.0s) · 알림 2(8.0s·68.0s, 표시)"
  else fail "판정 결과 저장" "$(echo "$DV" | head -c 700) (기대: 이벤트 1·알림 2·종료 85.0s)"; fi

  # 재전송 시험(C-3) — 같은 decision을 다시 넣어도 행·순번이 그대로여야 한다
  timeout 40 $KT/kafka-console-consumer.sh $BS --topic posture.episodes.v1 --from-beginning --timeout-ms 15000 \
    2>/dev/null | grep -F "$D_SID" | grep -F '"kind":"decision"' >"$OUT/d30-decisions.jsonl" || true
  NDD="$(wc -l <"$OUT/d30-decisions.jsonl" | tr -d ' ')"
  AP="$(curl -s -m 20 -X POST -H 'Content-Type: text/plain' --data-binary @"$OUT/d30-decisions.jsonl" "$API/report/test/apply")"
  echo "다시 넣기: $AP" >>"$OUT/run.log"
  DV2="$(curl -s -m 5 "$API/report/sessions/$D_SID")"
  SAME="$(python3 - "$DV" "$DV2" "$AP" <<'PYD'
import json,sys
a,b,ap=(json.loads(x) for x in sys.argv[1:4])
keys=('events','alerts','ended_ms','good_sec')
print('same' if all(a.get(k)==b.get(k) for k in keys) and not ap.get('errors') and ap.get('applied',0)>0 else 'diff')
PYD
)"
  if [ "$NDD" = "4" ] && [ "$SAME" = "same" ]; then pass "재전송 멱등: decision 4건을 다시 넣어도 행·순번 그대로 (C-3)"
  else fail "재전송 멱등" "decision ${NDD}건(기대 4), 결과 $SAME — $OUT/run.log"; fi

  sleep 2
  L="$($KT/kafka-consumer-groups.sh $BS --describe --group report-store-v1 2>/dev/null | awk '$6 ~ /^[0-9]+$/ {s+=$6; n++} END{if(n) print s+0}')"
  if [ "$L" = "0" ]; then pass "저장 컨슈머 report-store-v1 lag 0"
  elif [ -z "$L" ]; then fail "저장 컨슈머 report-store-v1" "그룹 없음 — REPORT_STORE_ENABLED·재빌드 확인"
  else fail "저장 컨슈머 report-store-v1 lag" "$L"; fi

  # (D-39) 제외 구간: 정상 2s → 휴식 2.5s → 정상 2s, 마지막 구간 뒤 1.5s 공백으로 종료
  #   기대 excluded_interval = PAUSE [2000, 4500) · MISSING [6500, 8000), 세션 종료 8000, good_sec 4.0
  X_SID="$(python3 -c 'import uuid;print(uuid.uuid4())')"
  XC="$(curl -s -m 10 -X POST "$API/report/test/sessions/$X_SID")"
  echo "제외 구간 시험 세션: $XC" >>"$OUT/run.log"
  python3 $TOOLS/replay_realtime_v1.py --api "$API/api/v1/realtime/features" --user-id "IT-D39-$TS" --session-id "$X_SID" \
    --normal-sec 2 --rest-sec 2.5 --bad-sec 0 --recover-sec 2 --end-gap-ms 1500 >"$OUT/d39-replay.log" 2>&1
  XV=""
  for _ in $(seq 1 30); do
    XV="$(curl -s -m 5 "$API/report/sessions/$X_SID")"
    echo "$XV" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('ended_ms') is not None else 1)" 2>/dev/null && break
    XV=""; sleep 2
  done
  echo "제외 구간 저장 결과: ${XV:-없음}" >>"$OUT/run.log"
  if [ -z "$XV" ]; then fail "제외 구간 저장 (D-39)" "60초 안에 세션 종료가 저장되지 않음 — $OUT/d39-replay.log"
  elif echo "$XV" | python3 -c "
import json,sys
v=json.load(sys.stdin)
x=[(r['started_ms'],r['ended_ms'],r['exclusion_reason']) for r in v.get('excluded') or []]
sys.exit(0 if x==[(2000,4500,'PAUSE'),(6500,8000,'MISSING')] and v.get('ended_ms')==8000 and float(v.get('good_sec') or -1)==4.0 else 1)"
  then pass "제외 구간 저장: PAUSE 2.0~4.5s · MISSING 6.5~8.0s, 종료 8.0s·good_sec 4.0 (D-39)"
  else fail "제외 구간 저장 (D-39)" "$(echo "$XV" | head -c 500) (기대: PAUSE 2000~4500·MISSING 6500~8000)"; fi

  if [ "${KEEP_D30:-0}" = 1 ]; then skip "시험 세션 삭제" "KEEP_D30=1 — $D_SID·$X_SID 남겨 둠"
  else
    DEL="$(curl -s -m 10 -X DELETE "$API/report/test/sessions/$D_SID")"
    DEL2="$(curl -s -m 10 -X DELETE "$API/report/test/sessions/$X_SID")"
    if echo "$DEL" | grep -q '"deletedSessions": *1' && echo "$DEL2" | grep -q '"deletedSessions": *1'; then
      pass "시험 세션·계정 삭제 2개 (이벤트·알림·제외 구간·기준 자세는 CASCADE)"
    else fail "시험 세션 삭제" "$DEL / $DEL2"; fi
  fi
fi

# ---------------------------------------------------------------------
step "12. 실시간 WebSocket 왕복 (D-57 3단계)"
# 앱처럼 io-api /v2/realtime에 좌표 167구간을 보내고 decision·alert·closed와 DB 기록(처리 서비스 /report/sessions)을 확인한다.
# 판정 경로(io-api POSEGOOD_REALTIME_PIPELINE)가 local이든 kafka든 같은 결과여야 한다 — 두 값으로 한 번씩 돌려 비교(계획 0031).
if [ "$E2E" = 0 ]; then skip "실시간 WebSocket 왕복" "--no-e2e"
elif ! docker inspect io-api >/dev/null 2>&1; then skip "실시간 WebSocket 왕복" "io-api 컨테이너 없음"
elif [ ! -f "$TOOLS/ws_realtime_smoke.py" ]; then skip "실시간 WebSocket 왕복" "$TOOLS/ws_realtime_smoke.py 없음"
else
  PIPE="$(docker exec io-api printenv POSEGOOD_REALTIME_PIPELINE 2>/dev/null || true)"
  PIPE="${PIPE:-local}"
  if python3 "$TOOLS/ws_realtime_smoke.py" --base "$IO_API" --report "$API" --pipeline "$PIPE" >"$OUT/ws-realtime.log" 2>&1; then
    pass "WebSocket 왕복 [$PIPE] — 확정 8.0s·재알림 68.0s·회복 78.0s·종료 85.0s, 알림 2, closed(ended), DB 제외 구간 2 ($(tail -1 "$OUT/ws-realtime.log"))"
  else
    fail "WebSocket 왕복 [$PIPE]" "$(grep -m3 '^FAIL' "$OUT/ws-realtime.log" | tr '\n' ' ')(상세 $OUT/ws-realtime.log)"
  fi
fi

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
