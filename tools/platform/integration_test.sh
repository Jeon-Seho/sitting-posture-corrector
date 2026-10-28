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
#   0. 사전 확인   : docker, python3+requests, .env 형식·필수 값·주소/포트·이미지 태그(D-24)·허용 출처(D-71), compose 해석,
#                    JWT 서명 키 파일(D-71), 프로젝트·Kafka 볼륨(정보)
#   1. 컨테이너    : 7개 실행·healthy
#   2. Kafka       : 브로커, 토픽·파티션, 임시 토픽 produce→consume 왕복
#   3. Redis       : PING, SET/GET/TTL/DEL
#   4. HDFS        : DataNode 수, safemode, 파일 put→cat→rm
#   5. Spark       : Spark↔HDFS Parquet 왕복 (tests/hdfs_parquet_roundtrip.py, D-64)
#   6. 서비스      : api-server liveness/readiness(DB·Redis), inference /health, 확정 서비스 DB V2.6 준비(D-32·D-51·D-65)
#   7. (없음)      : 옛 posture.summary 경로 종단 시험(T-10)·posture-sink HDFS 적재는 옛 경로와 함께 지웠다(D-38, 10/21).
#                    단계 번호는 문서·기록과 맞추려고 그대로 둔다. 종단 판정은 8단계(v1)·11단계(저장)·12단계(WebSocket)
#   8. 계약 v1      : 시험용 입구 → posture.features.v1 → 추론 → posture.inference.v1 → v1 판정(D-22)
#                    → 확정·재알림·복귀(73.0s)·종료, posture.episodes.v1 발행, v1 lag 0, DLQ(D-36)
#   9. v1 상태 복원 : (--restart일 때만) 같은 세션을 앞 60건 → api-server 재시작 → 나머지로 나눠 보내고
#                    8단계와 같은 사건·요약(누락 0)인지, Redis posture:v1:judge:<id> 저장·삭제 확인(D-37)
#  10. 입출구 서버 : (io-api 컨테이너가 있을 때만 — compose --profile io) io-api·inference healthy·KST,
#                    REST 점검 tools/platform/io_api_smoke.py(가입·로그인·토큰 갱신 → 기준 → 세션 생성·구간·종료·조회 → 기록 → 삭제
#                    → 로그아웃 → 탈퇴, D-48·D-69 — 토큰 로그인 ADR 0031)
#                    합성 시험 계정(test-it-*@example.invalid)은 탈퇴 접수 상태로 남고 J3가 30일 뒤 지운다.
#  11. 결과 저장    : (REPORT_TEST_FIXTURES_ENABLED=true일 때) 시험 계정·기준 자세·세션 행 → v1 재생 → posture_service(V2.6)에
#                    세션 종료·이벤트·알림 저장 확인, 같은 decision 다시 넣기(멱등), 알림 토픽 2건(D-54), 시험 행 삭제(D-30·D-51). KEEP_D30=1이면 남김
#  12. WebSocket   : (io-api가 있을 때) tools/platform/ws_realtime_smoke.py — 앱처럼 /v2/realtime 왕복(D-57 3단계)
#  13. FE ↔ BE    : (web이 있을 때) FE 화면 컨테이너(nginx)가 화면을 내고, 그 /api로 REST 점검·WebSocket 왕복(T-13)
#  14. 공개 입구   : (D-43) 처리 서비스·추론 포트가 127.0.0.1에만, gateway(API 전용 nginx, 호스트 포트 없음)가 /api만 중계하고 /는 404,
#                    cloudflared(--profile edge)가 터널에 붙었는지, PUBLIC_API_URL이 있으면 밖(https)에서 /health·404·CORS·REST·wss 왕복
#
# 결과: tools/platform/it-results/<시각>/ 에 단계별 로그와 summary.txt. FAIL이 하나라도 있으면 종료 코드 1.
# 이 스크립트는 운영 데이터를 지우지 않는다. 만드는 것은 임시 토픽·HDFS 임시 파일·Redis 임시 키뿐이고
# 끝나면 지운다. 11단계 시험 행은 끝에서 지운다(KEEP_D30=1이면 남김), 10·12단계 합성 계정은 탈퇴 접수 상태로 남는다.
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
    -h|--help) sed -n "2,$(grep -n '^# =====' "$0" | sed -n 2p | cut -d: -f1)p" "$0"; exit 0 ;;
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

# (D-62) 비밀값 파일이 저장소에 커밋돼 있지 않은지 — .env 사본(2.env 등)이 실제 비밀번호와 함께 올라간 일이 있었다(10/16)
if command -v git >/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  TRACKED="$(git ls-files | grep -E '(^|/)([^/]*\.env|\.env\.[^/]*|hadoop\.env)$' | grep -vE '(^|/)(\.env\.example|env\.example|hadoop\.env\.example)$' | tr '\n' ' ')"
  if [ -n "$TRACKED" ]; then fail "저장소에 비밀값 파일 없음" "커밋된 파일: $TRACKED — git rm 하고 비밀번호를 바꾼다"
  else pass "저장소에 비밀값 파일 없음 (.env·사본)"; fi
fi

# .env 형식 점검: 숫자여야 하는 값(…_SECONDS/_SIZE/_CONCURRENCY/_PORT)에 다른 글자가 붙어 있지 않은지,
# 파일 끝 줄바꿈이 있는지(없으면 echo >> 로 덧붙인 줄이 앞 줄에 붙음 — 2026-10-07 실제 장애 원인)
if [ -f "$ENV_FILE" ]; then
  BAD="$(grep -E '^[A-Z0-9_]+(_SECONDS|_SIZE|_CONCURRENCY|_PORT)=' "$ENV_FILE" | grep -vE '^[A-Z0-9_]+=[0-9]+[[:space:]]*$' | cut -d= -f1 | tr '\n' ' ')"
  if [ -n "$BAD" ]; then fail ".env 숫자 값 형식" "숫자가 아닌 값: $BAD"; else pass ".env 숫자 값 형식"; fi
  if [ -n "$(tail -c1 "$ENV_FILE")" ]; then fail ".env 마지막 줄바꿈" "파일 끝에 줄바꿈이 없음 — echo >> .env 로 추가하면 앞 줄에 붙는다"; else pass ".env 마지막 줄바꿈"; fi
  # (D-24) 필수 값 — 실행 환경마다 다른 값(env.example 1·2장). 하나라도 없으면 compose도 시작하지 않는다(SERVER_LAN_IP·SERVICE_DB_SCHEMA)
  MISSING=""
  # (D-38) DB_NAME(옛 posture_app)은 쓰지 않는다 — 처리 서비스 연결 풀의 기본 DB는 SERVICE_DB_SCHEMA
  for k in SERVER_LAN_IP DB_HOST DB_PORT DB_USER DB_PASSWORD SERVICE_DB_SCHEMA; do
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
  # (D-71) 다른 출처 화면 허용 출처 — 브라우저 Origin과 글자 그대로 비교하므로 끝 /·경로·*가 있으면 모든 요청이 거절된다
  BADO=""
  for k in POSEGOOD_CORS_ALLOWED_ORIGINS POSEGOOD_REALTIME_ALLOWED_ORIGINS; do
    v="$(envval "$k")"
    [ -z "$v" ] && continue
    for o in $(echo "$v" | tr ',' ' '); do
      echo "$o" | grep -qE '^https?://[^/*[:space:]]+$' || BADO="$BADO $k=$o"
    done
  done
  if [ -n "$BADO" ]; then fail ".env 허용 출처 형식" "https://호스트 형식(끝 /·경로·* 없이)이 아님:$BADO"
  else pass ".env 허용 출처 형식 (비었거나 끝 / 없음)"; fi
  # (D-71) 서명 키는 secrets 파일 하나에만 — .env에도 있으면 어느 값이 쓰이는지 헷갈린다
  if [ -n "$(envval POSEGOOD_JWT_SECRET)" ]; then
    fail ".env에 POSEGOOD_JWT_SECRET 없음" "서명 키는 infra/compose/secrets/posegood.auth.jwt-secret 파일로 — .env 줄을 지운다(값은 파일로 옮김)"
  fi
  if $DC config --quiet >>"$OUT/run.log" 2>&1; then pass "compose 설정 해석 (.env 값 치환)"
  else fail "compose 설정 해석" "$DC config 실패 — $OUT/run.log"; fi
else
  fail ".env 파일" "$ENV_FILE 없음 — cp infra/compose/env.example infra/compose/.env 후 값 채우기"
fi
# (D-71) 로그인 토큰 서명 키(ADR 0031) — io-api가 /run/secrets/에서 읽는다(configtree). 파일 없이 io-api를 띄우면
# docker가 그 자리에 빈 폴더를 만들고 API는 시작할 때마다 새 키를 써서, 다시 시작할 때마다 모든 사용자가 로그아웃된다.
JWT_FILE="infra/compose/secrets/posegood.auth.jwt-secret"
if [ -d "$JWT_FILE" ]; then
  fail "JWT 서명 키 파일" "$JWT_FILE 이 폴더임(파일 없이 io-api를 띄움) — rmdir 뒤 파일로 만들고 io-api 다시 만들기(infra/README.md 입출구 서버)"
elif [ -f "$JWT_FILE" ]; then
  n="$(wc -c <"$JWT_FILE" | tr -d ' ')"; nl="$(grep -c '' "$JWT_FILE")"
  if [ "$n" -ge 32 ] && [ "$nl" -le 1 ]; then pass "JWT 서명 키 파일 (32바이트 이상·한 줄, 값은 출력 안 함)"
  else fail "JWT 서명 키 파일" "${n}바이트·${nl}줄 — 32바이트 이상 한 줄이어야 함"; fi
elif docker inspect io-api >/dev/null 2>&1; then
  fail "JWT 서명 키 파일" "$JWT_FILE 없음 — infra/README.md 입출구 서버 절로 만든 뒤 io-api 다시 만들기"
else
  skip "JWT 서명 키 파일" "io-api 없음(compose --profile io를 쓰지 않음)"
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
# (D-38) 옛 경로 토픽·컨슈머 그룹이 서버에 남아 있으면 안내만 한다 — 지우는 법은 infra/README.md "옛 경로 정리"
OLD_T="$(echo "$TOPICS" | grep -xE 'posture\.summary|posture\.inference' | tr '\n' ' ')"
[ -n "$OLD_T" ] && log "  (안내) 옛 경로 토픽이 남아 있음: $OLD_T— 쓰는 서비스 없음(D-38), infra/README.md 절차로 지운다"
OLD_G="$($KT/kafka-consumer-groups.sh $BS --list 2>/dev/null | grep -xE 'api-server-cep|inference-service' | tr '\n' ' ')"
[ -n "$OLD_G" ] && log "  (안내) 옛 경로 컨슈머 그룹이 남아 있음: $OLD_G— infra/README.md 절차로 지운다"
# (D-21) 계약 v1 토픽 — api-server가 시작할 때 만든다(파티션 3)
# (D-54) 알림 토픽 posture.alerts.v1도 같은 방식(파티션 3, 보존 3일)
for t in posture.features.v1 posture.inference.v1 posture.episodes.v1 posture.alerts.v1 posture.dlq; do
  PC="$($KT/kafka-topics.sh $BS --describe --topic "$t" 2>/dev/null | grep -oE 'PartitionCount: *[0-9]+' | grep -oE '[0-9]+')"
  if [ -z "$PC" ]; then fail "토픽 $t" "없음 — D-21 적용 후 api-server 재빌드·재생성 필요"
  elif [ "$PC" -ge 3 ] || { [ "$t" = posture.dlq ] && [ "$PC" -ge 1 ]; }; then pass "토픽 $t (파티션 $PC개)"
  else fail "토픽 $t 파티션" "$PC개 (3개 필요)"; fi
done
RET="$($KT/kafka-configs.sh $BS --describe --entity-type topics --entity-name posture.alerts.v1 2>/dev/null | grep -oE 'retention.ms=[0-9]+' | head -1)"
if [ "$RET" = "retention.ms=259200000" ]; then pass "토픽 posture.alerts.v1 보존 3일 (D-54)"
else fail "토픽 posture.alerts.v1 보존" "${RET:-설정 없음} (기대 259200000 = 3일 — 토픽을 새로 만들 때만 들어감)"; fi
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
# (D-61) 단일 DataNode라 복제 수는 1이어야 한다 — 3으로 쓴 파일이 있으면 복제 부족 블록으로 남는다
UNDER="$(echo "$REPORT" | grep -m1 -oE 'Under replicated blocks: [0-9]+' | grep -oE '[0-9]+$')"
if [ "${UNDER:-0}" = "0" ]; then pass "복제 부족 블록 0"
else fail "복제 부족 블록" "${UNDER}개 — Spark가 복제 3으로 쓴 파일: docker exec hdfs-namenode hdfs dfs -setrep -R 1 / (infra/README.md D-61)"; fi

# ---------------------------------------------------------------------
step "5. Spark ↔ HDFS"
if [ "$QUICK" = 1 ]; then skip "Parquet 왕복" "--quick"
elif [ ! -f tests/hdfs_parquet_roundtrip.py ]; then skip "Parquet 왕복" "tests/hdfs_parquet_roundtrip.py 없음"
else
  docker cp tests/hdfs_parquet_roundtrip.py spark:/opt/spark/it_roundtrip.py >>"$OUT/run.log" 2>&1
  timeout 300 docker exec spark /opt/spark/bin/spark-submit --master 'local[2]' /opt/spark/it_roundtrip.py >"$OUT/spark-roundtrip.log" 2>&1
  if grep -q "왕복 테스트 성공" "$OUT/spark-roundtrip.log"; then pass "Parquet 쓰기→읽기 (spark-submit)"
  else fail "Parquet 왕복" "$OUT/spark-roundtrip.log 확인"; fi
  # (D-61) Spark가 쓴 파일의 복제 수 — spark-defaults.conf(spark.hadoop.dfs.replication 1)가 적용됐는지
  REPS="$($H hdfs dfs -ls -R /posture/features/roundtrip-test 2>/dev/null | awk '$1 ~ /^-/ {print $2}' | sort -u | tr '\n' ' ')"
  if [ "$REPS" = "1 " ]; then pass "Spark 쓰기 복제 수 1"
  else fail "Spark 쓰기 복제 수" "복제 수 ${REPS:-없음} — infra/compose/spark-defaults.conf 마운트 확인(spark 컨테이너 다시 만들기)"; fi
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
# (D-32·D-51·D-65) 확정 서비스 DB(posture_service V2.6) — 판(V2.3~V2.6이면 적용할 migration)·필요한 테이블·판정 결과 컬럼·지운 컬럼 없음·
# 기본 정책(값 4개)·계정 권한
SDB="$(curl -s -m 15 "$API/store/service-db")"
echo "서비스 DB: ${SDB:-응답 없음}" >>"$OUT/run.log"
if [ -z "$SDB" ] || ! echo "$SDB" | python3 -c "import json,sys;json.load(sys.stdin)" 2>/dev/null; then
  fail "서비스 DB (D-32·D-51)" "GET /store/service-db 응답 없음 — api-server 재빌드 확인"
elif echo "$SDB" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('enabled') is False else 1)"; then
  skip "서비스 DB (D-32·D-51)" "SERVICE_DB_ENABLED=false"
elif echo "$SDB" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('ok') else 1)"; then
  pass "서비스 DB 준비 (D-32·D-51: $(echo "$SDB" | python3 -c "import json,sys;d=json.load(sys.stdin);w=d.get('warnings') or [];print(d['schema'],d.get('specVersion'),'테이블',d.get('tableCount'),'· 기본 정책 id',d.get('defaultPolicyId'),('· 경고: '+'; '.join(w)) if w else '')"))"
else
  fail "서비스 DB (D-32·D-51)" "$(echo "$SDB" | python3 -c "import json,sys;print('; '.join(json.load(sys.stdin).get('problems',[])))")"
fi
IH="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$INFER/health")"
if [ "$IH" = "200" ]; then pass "inference-service /health"; else fail "inference-service /health" "HTTP $IH"; fi
GRP="$($KT/kafka-consumer-groups.sh $BS --describe --group judge-v1 2>/dev/null)"
echo "$GRP" >>"$OUT/run.log"
NC="$(echo "$GRP" | awk '$2=="posture.inference.v1" && $7 ~ /consumer/ {print $7}' | sort -u | wc -l)"
if [ "$NC" -ge 1 ]; then pass "v1 판정 컨슈머 그룹 judge-v1 참여 (${NC}개 스레드)"; else skip "v1 판정 컨슈머 그룹" "아직 할당 없음(처음 기동 직후일 수 있음)"; fi

# ---------------------------------------------------------------------
# (D-38) 7단계(옛 posture.summary 경로 T-10·posture-sink HDFS 적재)는 옛 경로와 함께 지웠다.
if ! echo "$RD" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin)['components']['db']['status']=='UP' else 1)" 2>/dev/null; then
  log "  주의: readiness db가 DOWN — 11단계 판정 결과 저장이 DB 대기로 멈출 수 있다. docker logs api-server 의 'Caused by' 확인"
fi

# ---------------------------------------------------------------------
step "8. 실시간 계약 v1 (D-21·D-22·D-36)"
# v1 판정기 결과(GET /judge/v1/sessions/<id>)가 T-10 기대값인지 — 8단계·9단계 공통 (누락 구간 0까지 확인)
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
      V1VIEW="$(curl -s -m 5 "$API/judge/v1/sessions/$V1_SID")"
      echo "$V1VIEW" | python3 -c "import json,sys;sys.exit(0 if json.load(sys.stdin).get('ended') else 1)" 2>/dev/null && break
      V1VIEW=""; sleep 2
    done
  fi
  echo "v1 판정: ${V1VIEW:-없음}" >>"$OUT/run.log"
  if [ -z "$V1VIEW" ]; then fail "v1 판정 결과" "60초 안에 session_id=${V1_SID:-?} 종료 안 됨 (curl $API/judge/v1/sessions/<id>, docker logs inference-service / api-server)"
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
  for g in inference-service-v1 judge-v1; do
    L="$($KT/kafka-consumer-groups.sh $BS --describe --group "$g" 2>/dev/null | awk '$6 ~ /^[0-9]+$/ {s+=$6; n++} END{if(n) print s+0}')"
    if [ "$L" = "0" ]; then pass "v1 컨슈머 $g lag 0"
    elif [ -z "$L" ]; then fail "v1 컨슈머 $g" "그룹 없음 — 서비스 재빌드·재생성 확인"
    else fail "v1 컨슈머 $g lag" "$L"; fi
  done
  # (D-53) 옛 판정 그룹 이름(api-server-cep-v1)이 남아 있으면 안내만 한다 — 지우는 법은 infra/README.md
  if $KT/kafka-consumer-groups.sh $BS --list 2>/dev/null | grep -qx api-server-cep-v1; then
    log "  (안내) 옛 컨슈머 그룹 api-server-cep-v1이 남아 있음 — 판정 그룹은 judge-v1(D-53), infra/README.md 절차로 지운다"
  fi

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
    R1="$(curl -s -m 5 "$API/judge/v1/sessions/$R_SID")"
    echo "$R1" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get('last_sequence')==58 and d.get('active') else 1)" 2>/dev/null && break
    R1=""; sleep 2
  done
  echo "재시작 전 v1 판정: ${R1:-없음}" >>"$OUT/run.log"
  if [ -n "$R1" ]; then pass "재시작 전: 사건 진행 중(확정 8.0s), last_sequence 58"
  else fail "재시작 전 판정" "60초 안에 last_sequence 58·active 안 됨 (curl $API/judge/v1/sessions/$R_SID)"; fi
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
    R2="$(curl -s -m 5 "$API/judge/v1/sessions/$R_SID")"
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
step "11. 판정 결과 저장 (D-30·D-51·D-39·D-54)"
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

  # (D-54) 알림 토픽 — 알림 켜진 시험 세션: 확정·재알림 2건만, 위의 다시 넣기(재전송)는 다시 내지 않는다
  timeout 40 $KT/kafka-console-consumer.sh $BS --topic posture.alerts.v1 --from-beginning --timeout-ms 10000 \
    2>/dev/null | grep -F "$D_SID" >"$OUT/d54-alerts.jsonl" || true
  ALERTS="$(python3 - "$OUT/d54-alerts.jsonl" "$D_SID" <<'PYA'
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
ok=all(r.get('schema_version')=='1.0' and r.get('kind')=='alert' and r.get('session_id')==sys.argv[2]
       and set(r.get('body',{}))=={'event_id','kind','deviation_type','timestamp_ms','onset_ms'} for r in rows)
print(('ok ' if ok else 'bad ')+' '.join(f"{r['body']['kind']}@{r['body']['timestamp_ms']}" for r in rows if 'body' in r))
PYA
)"
  echo "알림 토픽: $ALERTS" >>"$OUT/run.log"
  if [ "$ALERTS" = "ok collapse_confirmed@8000 reminder@68000" ]; then pass "알림 토픽 posture.alerts.v1: 확정 8.0s·재알림 68.0s 2건, 재전송은 다시 안 냄 (D-54)"
  else fail "알림 토픽 posture.alerts.v1" "${ALERTS:-없음} (기대: collapse_confirmed@8000 reminder@68000 — $OUT/d54-alerts.jsonl, GET /report/store alertsPublished)"; fi

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
step "13. FE ↔ BE 연동 — 화면 nginx(web) 경유 (T-13)"
# (T-13 1단계) 서버 PC 안에서 FE 화면 컨테이너(팀 frontend.Dockerfile = 화면 + infra/nginx/default.conf)와 io-api를 함께 띄우고,
#   브라우저가 쓰는 같은 경로(/api/…, /api/v2/realtime)로 REST 점검·WebSocket 왕복이 io-api 직접(10·12단계)과 같은지 본다.
WEB="http://127.0.0.1:$(envor WEB_HOST_PORT 8088)"
if ! docker inspect web >/dev/null 2>&1; then
  skip "FE ↔ BE 연동" "web 컨테이너 없음 — $DC --profile io up -d --build web"
else
  st="$(docker inspect web --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' 2>/dev/null)"
  if [ "$st" = "running healthy" ]; then pass "web (FE 화면 + nginx, $st)"; else fail "web" "상태=$st (docker logs web)"; fi
  b="$(docker port web 2>/dev/null | awk '{print $3}' | grep -vE '^127\.0\.0\.1:' | tr '\n' ' ')"
  if [ -z "$b" ]; then pass "web 포트는 서버 PC 안(127.0.0.1)에만"; else fail "web 포트" "$b — .env WEB_BIND=127.0.0.1"; fi
  if curl -s -m 10 "$WEB/" | grep -qi '<div id="root"'; then pass "화면 $WEB/ (index.html)"
  else fail "화면 $WEB/" "index.html이 아님 (docker logs web)"; fi
  if python3 "$TOOLS/io_api_smoke.py" --base "$WEB/api" >"$OUT/web-rest.log" 2>&1; then
    pass "화면 경유 REST 점검 $WEB/api ($(tail -1 "$OUT/web-rest.log"))"
  else
    fail "화면 경유 REST 점검" "$(grep -m3 '^FAIL' "$OUT/web-rest.log" | tr '\n' ' ')(상세 $OUT/web-rest.log)"
  fi
  if [ "$E2E" = 1 ]; then
    if python3 "$TOOLS/ws_realtime_smoke.py" --base "$WEB/api" --report "$API" >"$OUT/web-ws.log" 2>&1; then
      pass "화면 경유 WebSocket 왕복 /api/v2/realtime ($(tail -1 "$OUT/web-ws.log"))"
    else
      fail "화면 경유 WebSocket 왕복" "$(grep -m3 '^FAIL' "$OUT/web-ws.log" | tr '\n' ' ')(상세 $OUT/web-ws.log)"
    fi
  fi
fi

# ---------------------------------------------------------------------
step "14. 인터넷 공개 입구 — gateway·Cloudflare 터널 (D-43)"
# 화면은 Vercel, 서버는 API 전용 gateway만 터널로 공개한다. 인증 없는 처리 서비스·추론 포트는 서버 PC 안에서만.
for pair in api-server:API_SERVER_BIND inference-service:INFERENCE_BIND; do
  c="${pair%%:*}"; var="${pair#*:}"
  docker inspect "$c" >/dev/null 2>&1 || continue
  b="$(docker port "$c" 2>/dev/null | awk '{print $3}' | grep -vE '^127\.0\.0\.1:' | tr '\n' ' ')"
  if [ -z "$b" ]; then pass "$c 포트는 서버 PC 안(127.0.0.1)에만"
  else fail "$c 포트" "$b — .env $var=127.0.0.1 뒤 $DC up -d --no-build $c (env.example 3장)"; fi
done
if ! docker inspect gateway >/dev/null 2>&1; then
  skip "gateway (API 전용 nginx)" "gateway 컨테이너 없음 — $DC --profile io up -d --no-build gateway"
else
  st="$(docker inspect gateway --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' 2>/dev/null)"
  if [ "$st" = "running healthy" ]; then pass "gateway ($st)"; else fail "gateway" "상태=$st (docker logs gateway)"; fi
  if [ -z "$(docker port gateway 2>/dev/null)" ]; then pass "gateway 호스트 포트 없음 (cloudflared만 같은 망에서)"
  else fail "gateway 포트" "$(docker port gateway | tr '\n' ' ') — gateway는 포트를 열지 않는다"; fi
  if docker exec gateway wget -q -O - http://127.0.0.1/api/health 2>>"$OUT/run.log" | grep -q '"status":"ok"'; then
    pass "gateway → io-api /api/health"
  else fail "gateway → io-api" "/api/health 실패 — io-api 별칭 api·app-network (docker logs gateway)"; fi
  for path in / /actuator/health /index.html; do
    if docker exec gateway wget -q -S -O /dev/null "http://127.0.0.1$path" 2>&1 | grep -q ' 404'; then pass "gateway $path 는 404 (화면·운영 경로 없음)"
    else fail "gateway $path" "404가 아님 — infra/nginx/gateway.conf"; fi
  done
fi
if docker inspect cloudflared >/dev/null 2>&1; then
  st="$(docker inspect cloudflared --format '{{.State.Status}}' 2>/dev/null)"
  if [ "$st" = "running" ] && docker logs cloudflared 2>&1 | grep -q 'Registered tunnel connection'; then
    pass "cloudflared 터널 연결 (Registered tunnel connection)"
  else fail "cloudflared" "상태=$st, 터널 연결 기록 없음 — docker logs cloudflared(토큰 값은 출력하지 않는다)"; fi
  TOKF="infra/compose/secrets/cloudflared.env"
  if [ -f "$TOKF" ] && [ "$(stat -c %a "$TOKF")" = "600" ] && [ -s "$TOKF" ]; then pass "터널 토큰 파일 (비어 있지 않음·600, 값은 출력 안 함)"
  else fail "터널 토큰 파일" "$TOKF 가 없거나 비었거나 권한이 600이 아님"; fi
else
  skip "Cloudflare 터널" "cloudflared 없음 — 공개할 때만 $DC --profile io --profile edge up -d --no-build cloudflared"
fi
PUB="$(envval PUBLIC_API_URL)"; PUB="${PUB%/}"
if [ -z "$PUB" ] || ! docker inspect cloudflared >/dev/null 2>&1; then
  skip "터널 경유 확인" "PUBLIC_API_URL이 비었거나 cloudflared 없음"
else
  if curl -s -m 15 "$PUB/health" | grep -q '"status":"ok"'; then pass "터널 경유 $PUB/health"
  else fail "터널 경유 $PUB/health" "530이면 cloudflared 미연결, 502면 gateway 연결(config.yml)"; fi
  for path in / /actuator/health; do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$PUB$path")"
    if [ "$code" = "404" ]; then pass "터널 경유 $path 는 404"; else fail "터널 경유 $path" "HTTP $code (기대 404)"; fi
  done
  ORIG="$(envval POSEGOOD_CORS_ALLOWED_ORIGINS | cut -d, -f1)"
  if [ -z "$ORIG" ]; then skip "CORS 사전 확인" "POSEGOOD_CORS_ALLOWED_ORIGINS 비어 있음"
  else
    HDR="$(curl -s -m 15 -o /dev/null -D - -X OPTIONS "$PUB/api/v2/auth/login" -H "Origin: $ORIG" \
      -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" | tr -d '\r')"
    if echo "$HDR" | grep -qi "^access-control-allow-origin: $ORIG\$" && echo "$HDR" | grep -qi '^access-control-allow-credentials: true'; then
      pass "CORS 사전 확인 OPTIONS /api/v2/auth/login (Origin $ORIG, credentials)"
    else fail "CORS 사전 확인" "허용 헤더 없음 — 끝 /·오타, docker exec io-api printenv POSEGOOD_CORS_ALLOWED_ORIGINS"; fi
  fi
  if python3 "$TOOLS/io_api_smoke.py" --base "$PUB/api" >"$OUT/public-rest.log" 2>&1; then
    pass "터널 경유 REST 점검 $PUB/api ($(tail -1 "$OUT/public-rest.log"))"
  else fail "터널 경유 REST 점검" "$(grep -m3 '^FAIL' "$OUT/public-rest.log" | tr '\n' ' ')(상세 $OUT/public-rest.log)"; fi
  if [ "$E2E" = 1 ]; then
    WSO="$(envval POSEGOOD_REALTIME_ALLOWED_ORIGINS | cut -d, -f1)"
    if python3 "$TOOLS/ws_realtime_smoke.py" --base "$PUB/api" --report "$API" ${WSO:+--origin "$WSO"} >"$OUT/public-ws.log" 2>&1; then
      pass "터널 경유 wss 왕복 /api/v2/realtime (Origin ${WSO:-같은 출처}, $(tail -1 "$OUT/public-ws.log"))"
    else fail "터널 경유 wss 왕복" "$(grep -m3 '^FAIL' "$OUT/public-ws.log" | tr '\n' ' ')(상세 $OUT/public-ws.log)"; fi
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
