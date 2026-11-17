#!/usr/bin/env python3
"""D-97 단계 안내형 통신 시험 — 할 일을 안내하고 서버 신호(gateway·Kafka·카운터·DB)로 단계마다 판정한다.

    cd /home/bdp/sitting-posture-corrector
    python3 tools/platform/comm_test_guided.py                  # kafka 모드(기본 + Discord 로그인)
    python3 tools/platform/comm_test_guided.py --mode local     # 운영 경로(local) — 기본 로그인
    python3 tools/platform/comm_test_guided.py --from S4        # 중간부터(로그인·측정이 이미 된 상태)
    python3 tools/platform/comm_test_guided.py --only S9        # 한 단계만
    python3 tools/platform/comm_test_guided.py --dry-run        # 서버 조작(전환·정지) 없이 안내·감시만
    python3 tools/platform/comm_test_guided.py --list           # 단계 목록

흐름: 안내 → 기다림(제한 시간) → 근거 출력 → PASS면 다음. FAIL이면 이유를 보이고 r(그 단계 다시)·c(실패로 적고
계속)·q(멈춤) 중 고른다 — 화면 확인을 놓쳐 n으로 답한 경우도 같다. 결과 파일은 기본 tests/comm-test-results/
(저장소에 올리지 않음 — 그 폴더의 .gitignore).
화면에서만 보이는 것(알림 표시·안내 문구·삭제 버튼)은 y/n으로 묻는다. 끝나면(실패·Ctrl+C 포함)
api-server를 켜 두고 io-api를 local로 되돌린다.

보안: Kafka 본문(좌표·특징·점수)은 읽지 않고 종류·순번·사건 id만 쓴다. gateway 경로의 쿼리 문자열(Discord
code·state)은 버리고 세션 UUID는 앞 8자만 보인다. DB는 개수·0/1만 조회하고, 접속 정보(.env)는 출력하지 않는다.
결과 파일에는 세션 ID 앞 8자 외 식별 정보를 쓰지 않는다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

TOPICS = {
    "posture.features.v1": "FEAT", "posture.inference.v1": "INFR", "posture.episodes.v1": "EPIS",
    "posture.alerts.v1": "ALRT", "posture.stored.v1": "STOR", "posture.dlq": "DLQ",
    "posture.keypoints.v1": "KEYP",
}
WATCHED_TOPICS = ["posture.features.v1", "posture.episodes.v1", "posture.alerts.v1",
                  "posture.stored.v1", "posture.dlq"]
GROUPS = ["inference-service-v1", "judge-v1", "report-store-v1", "io-ws-io-api"]
PER_INTERVAL = {"features", "observation", "keypoints", "progress"}

UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
REQUEST_RE = re.compile(r'"([A-Z]+) (\S+) HTTP/[0-9.]+" (\d{3})')
QUIET_PATHS = ("/health", "/actuator", "/assets/", "/favicon")


# ───────────────────────────── 신호 ─────────────────────────────

@dataclass
class Event:
    source: str                 # "GW" 또는 토픽 약칭(FEAT·EPIS·ALRT·STOR·DLQ)
    clock: str = ""
    t: float = 0.0              # time.monotonic()
    method: str = ""
    path: str = ""              # 쿼리 문자열 없음, UUID 그대로(내부 비교용)
    status: int = 0
    sid: str = ""               # 세션 id 전체(내부 비교용, 화면에는 앞 8자)
    kind: str = ""
    event: str = ""             # decision 사건 종류 / alert 종류
    event_id: object = None
    ts_ms: object = None
    extra: str = ""

    def line(self) -> str:
        if self.source == "GW":
            return f"{self.clock} GW   {self.method:<7} {mask(self.path)} {self.status}"
        detail = self.extra
        return f"{self.clock} {self.source:<4} {self.sid[:8] or '-':<8} {self.kind:<16} {detail}".rstrip()


def mask(path: str) -> str:
    return UUID_RE.sub(lambda m: m.group(0)[:8] + "…", path)


def now_clock() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:12]


def parse_gateway(line: str) -> Optional[Event]:
    """nginx 접근 로그 한 줄 → Event. 요청 줄이 없거나 조용히 둘 경로면 None."""
    m = REQUEST_RE.search(line)
    if not m:
        return None
    method, target, status = m.group(1), m.group(2), int(m.group(3))
    path = target.split("?", 1)[0]
    if any(q in path for q in QUIET_PATHS):
        return None
    return Event("GW", now_clock(), time.monotonic(), method=method, path=path, status=status)


def parse_kafka(topic: str, value: str) -> Optional[Event]:
    """Kafka 봉투 → Event(종류·순번·사건 id만). 좌표·특징·점수 값은 꺼내지 않는다."""
    short = TOPICS.get(topic, "?")
    ev = Event(short, now_clock(), time.monotonic())
    if topic == "posture.dlq":
        ev.kind = "dead-letter"
        return ev
    try:
        m = json.loads(value)
    except ValueError:
        return None
    if not isinstance(m, dict):
        return None
    ev.sid = str(m.get("session_id") or "")
    ev.kind = str(m.get("kind") or "?")
    b = m.get("body") or {}
    if ev.kind in ("features", "observation", "keypoints"):
        ev.extra = f"seq={b.get('sequence')}"
    elif ev.kind == "decision":
        e = b.get("event") or {}
        ev.event, ev.event_id, ev.ts_ms = str(e.get("kind")), e.get("event_id"), e.get("timestamp_ms")
        ev.extra = f"{ev.event} id={ev.event_id} t={ev.ts_ms}"
    elif ev.kind == "progress":
        s = b.get("summary") or {}
        ev.extra = f"last_seq={b.get('last_sequence')} collapse={s.get('collapse_count')}"
    elif ev.kind == "alert":
        ev.event, ev.event_id = str(b.get("kind")), b.get("event_id")
        ev.extra = f"{ev.event} id={ev.event_id}"
    elif ev.kind in ("session_ended", "session_stored"):
        ev.extra = f"end_ms={b.get('end_ms')}"
    elif ev.kind == "session_started":
        p = b.get("policy") or {}
        ev.extra = f"hold={p.get('hold_ms')} reminder={p.get('reminder_ms')}"
        ev.ts_ms = (p.get("hold_ms"), p.get("reminder_ms"))
    return ev


class Bus:
    """감시 스레드가 신호를 넣고, 단계가 커서로 읽는다(단계 시작 뒤 신호만 본다)."""

    def __init__(self) -> None:
        self.events: List[Event] = []
        self.cond = threading.Condition()

    def add(self, ev: Event) -> None:
        with self.cond:
            self.events.append(ev)
            self.cond.notify_all()

    def mark(self) -> int:
        with self.cond:
            return len(self.events)


def default_show(ev: Event) -> bool:
    if ev.source == "GW":
        return True
    return ev.kind not in PER_INTERVAL


class Fail(Exception):
    pass


class Abort(Exception):
    pass


class Cursor:
    """한 단계의 읽기 위치. expect는 조건을 만족하는 신호가 올 때까지 보이는 신호를 출력하며 기다린다."""

    def __init__(self, bus: Bus, show: Callable[[Event], bool] = default_show, out=print) -> None:
        self.bus = bus
        self.pos = bus.mark()
        self.show = show
        self.out = out
        self.seen: List[Event] = []

    def _next(self, deadline: float) -> Optional[Event]:
        with self.bus.cond:
            while self.pos >= len(self.bus.events):
                left = deadline - time.monotonic()
                if left <= 0:
                    return None
                self.bus.cond.wait(min(left, 0.5))
            ev = self.bus.events[self.pos]
            self.pos += 1
        self.seen.append(ev)
        if self.show(ev):
            self.out("    " + ev.line())
        return ev

    def expect(self, pred: Callable[[Event], bool], timeout: float, missing: str,
               heartbeat: float = 15) -> Event:
        """조건이 맞는 신호를 기다린다. heartbeat초마다 무엇을 기다리는지 보인다(멈춘 것처럼 보이지 않게)."""
        deadline = time.monotonic() + timeout
        beat = time.monotonic() + heartbeat
        while True:
            ev = self._next(min(deadline, beat))
            if ev is None:
                now = time.monotonic()
                if now >= deadline:
                    raise Fail(f"{missing} ({timeout:.0f}초 안에 없음)")
                if missing:
                    self.out(f"    … 기다리는 중: {missing} (남은 {deadline - now:.0f}초)")
                beat = now + heartbeat
                continue
            if pred(ev):
                return ev

    def find(self, pred: Callable[[Event], bool], timeout: float) -> Optional[Event]:
        try:
            return self.expect(pred, timeout, "")
        except Fail:
            return None

    def none_within(self, pred: Callable[[Event], bool], seconds: float) -> Optional[Event]:
        """seconds 동안 pred가 맞는 신호가 없으면 None, 있으면 그 신호."""
        return self.find(pred, seconds)

    def drain(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while self._next(deadline) is not None:
            pass


# ───────────────────────────── 감시 ─────────────────────────────

CONSUMER_TAG = "comm-test-guided"
# 컨테이너 안의 이 도구 컨슈머(JVM)를 찾아 끝낸다. docker exec 클라이언트를 끝내도 컨테이너 안 프로세스는 남기 때문.
# 찾는 패턴을 [d]로 감싸 이 sh·grep 자신(명령줄에 패턴 문자열이 있음)은 맞지 않게 한다.
KILL_CONSUMERS = ("n=0; for p in /proc/[0-9]*; do if tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q '"
                  + CONSUMER_TAG[:-1] + "[" + CONSUMER_TAG[-1] + "]'; then "
                  "kill ${p#/proc/} 2>/dev/null && n=$((n+1)); fi; done; echo $n")


def kill_consumers() -> int:
    """kafka 컨테이너 안에 남은 이 도구의 컨슈머 수를 끝내고 그 수를 돌려준다(못 하면 -1)."""
    try:
        r = subprocess.run(["docker", "exec", "kafka", "sh", "-c", KILL_CONSUMERS], stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=30)
        return int(r.stdout.strip() or 0)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return -1


class Watchers:
    def __init__(self, bus: Bus, topics: List[str], dry_run: bool) -> None:
        self.bus = bus
        self.topics = topics
        self.procs: List[subprocess.Popen] = []
        self.dry_run = dry_run
        self.started = False

    def _pump(self, proc: subprocess.Popen, parse: Callable[[str], Optional[Event]]) -> None:
        assert proc.stdout is not None
        for raw in proc.stdout:
            ev = parse(raw.rstrip("\n"))
            if ev is not None:
                self.bus.add(ev)

    def start(self) -> None:
        if self.started:  # S0을 다시 할 때 감시를 두 번 띄우지 않는다(신호가 두 번씩 들어옴)
            return
        self.started = True
        since = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        # stdin은 넘기지 않는다 — 넘기면 y/n 입력을 하위 프로세스가 먼저 읽어 질문에서 멈춘다
        gw = subprocess.Popen(["docker", "logs", "-f", "--since", since, "gateway"], stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.procs.append(gw)
        threading.Thread(target=self._pump, args=(gw, parse_gateway), daemon=True).start()
        for topic in self.topics:
            p = subprocess.Popen(["docker", "exec", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
                                  "--bootstrap-server", "localhost:9092", "--topic", topic,
                                  "--consumer-property", f"client.id={CONSUMER_TAG}"],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 text=True, bufsize=1)
            self.procs.append(p)
            threading.Thread(target=self._pump, args=(p, lambda v, t=topic: parse_kafka(t, v)),
                             daemon=True).start()

    def stop(self) -> None:
        for p in self.procs:
            if p.poll() is None:
                p.terminate()
        for p in self.procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        if self.topics and self.procs:
            kill_consumers()


# ───────────────────────────── 서버 조작·조회 ─────────────────────────────

def http_json(url: str, method: str = "GET", timeout: float = 5) -> Optional[dict]:
    req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def alert_counters(body: Optional[dict]) -> Optional[Dict[str, int]]:
    if not body:
        return None
    return {k: int(v) for k, v in body.items() if k.startswith("alerts") and isinstance(v, (int, float))
            and not isinstance(v, bool)}


def counter_delta(before: Optional[Dict[str, int]], after: Optional[Dict[str, int]]) -> Dict[str, int]:
    if not before or not after:
        return {}
    return {k: after.get(k, 0) - before.get(k, 0) for k in after if after.get(k, 0) != before.get(k, 0)}


def parse_offsets(text: str) -> int:
    total = 0
    for line in text.splitlines():
        parts = line.strip().split(":")
        if len(parts) >= 3 and parts[-1].isdigit():
            total += int(parts[-1])
    return total


def parse_lag(text: str) -> Optional[int]:
    """kafka-consumer-groups --describe 출력 → LAG 합계(LAG 열이 없으면 None)."""
    lag_col, total, found = None, 0, False
    for line in text.splitlines():
        cols = line.split()
        if "LAG" in cols and "TOPIC" in cols:
            lag_col = cols.index("LAG")
            continue
        if lag_col is not None and len(cols) > lag_col and cols[lag_col].isdigit():
            total += int(cols[lag_col])
            found = True
    return total if found or lag_col is not None else None


def load_env(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            values[k.strip()] = v.strip().strip('"').strip("'")
    return values


class Ops:
    """compose 조작. dry-run이면 명령만 보이고 실행하지 않는다."""

    def __init__(self, repo: Path, dry_run: bool, out=print) -> None:
        self.repo = repo
        self.dry_run = dry_run
        self.out = out
        self.switched = False
        self.api_stopped = False
        self.dc = ["docker", "compose", "-f", "infra/compose/bigdata.yaml"]

    def _run(self, args: List[str], env_extra: Optional[Dict[str, str]] = None, show: bool = True,
             change: bool = True, timeout: float = 180) -> Tuple[int, str]:
        if show:
            prefix = " ".join(f"{k}={v}" for k, v in (env_extra or {}).items())
            self.out(f"    $ {(prefix + ' ') if prefix else ''}{' '.join(args)}")
        if change and self.dry_run:
            return 0, ""
        env = dict(os.environ)
        env.pop("POSEGOOD_REALTIME_PIPELINE", None)
        env.pop("POSEGOOD_ARCHIVE_KEYPOINTS", None)
        env.update(env_extra or {})
        r = subprocess.run(args, cwd=self.repo, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT,
                           text=True, timeout=timeout)
        return r.returncode, r.stdout

    def query(self, args: List[str], timeout: float = 60) -> Tuple[int, str]:
        return self._run(args, show=False, change=False, timeout=timeout)

    def pipeline(self) -> str:
        _, out = self.query(["docker", "exec", "io-api", "printenv", "POSEGOOD_REALTIME_PIPELINE"])
        return out.strip() or "local"

    def io_health(self, wait: float = 60) -> bool:
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            body = http_json("http://127.0.0.1:8090/health", timeout=3)
            if body and str(body.get("status", "")).lower() in ("ok", "up"):
                return True
            time.sleep(2)
        return False

    def recreate_io_api(self, mode: str) -> None:
        extra = {"POSEGOOD_REALTIME_PIPELINE": "kafka"} if mode == "kafka" else None
        code, out = self._run(self.dc + ["--profile", "io", "--profile", "edge", "up", "-d", "--no-deps",
                                         "--no-build", "--force-recreate", "io-api"], extra)
        if code != 0:
            raise Fail(f"io-api 재생성 실패: {out.strip().splitlines()[-1:] or ''}")
        if self.dry_run:
            return
        if not self.io_health():
            raise Fail("io-api health가 60초 안에 ok가 아님")
        got = self.pipeline()
        if got != mode:
            raise Fail(f"io-api 경로가 {mode}가 아님(지금 {got})")

    def switch_kafka(self) -> None:
        self.switched = not self.dry_run
        self.recreate_io_api("kafka")

    def restore_local(self) -> None:
        self.recreate_io_api("local")
        self.switched = False

    def stop_api_server(self) -> None:
        self.api_stopped = not self.dry_run
        code, out = self._run(self.dc + ["stop", "api-server"])
        if code != 0:
            raise Fail(f"api-server 정지 실패: {out.strip()[-200:]}")

    def start_api_server(self) -> None:
        code, out = self._run(self.dc + ["up", "-d", "--no-deps", "--no-build", "api-server"])
        if code != 0:
            raise Fail(f"api-server 시작 실패: {out.strip()[-200:]}")
        self.api_stopped = False

    def offsets(self, topics: List[str]) -> Dict[str, int]:
        result = {}
        for t in topics:
            _, out = self.query(["docker", "exec", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                                 "--bootstrap-server", "localhost:9092", "--topic", t])
            result[t] = parse_offsets(out)
        return result

    def lag(self, group: str) -> Optional[int]:
        _, out = self.query(["docker", "exec", "kafka", "/opt/kafka/bin/kafka-consumer-groups.sh",
                             "--bootstrap-server", "localhost:9092", "--describe", "--group", group])
        return parse_lag(out)

    def counters(self) -> Optional[Dict[str, int]]:
        return alert_counters(http_json("http://127.0.0.1:8080/report/store"))


class Db:
    """서비스 DB 읽기 전용 조회(개수·0/1). mysql-connector가 없거나 접속이 안 되면 쓰지 않는다."""

    def __init__(self, env: Dict[str, str]) -> None:
        self.env = env
        self.conn = None
        self.reason = ""

    def connect(self) -> bool:
        try:
            import mysql.connector  # type: ignore
        except ImportError:
            self.reason = "mysql-connector-python 없음(pip install -r tools/platform/requirements.txt)"
            return False
        if not self.env.get("DB_HOST"):
            self.reason = ".env에 DB_HOST 없음"
            return False
        try:
            self.conn = mysql.connector.connect(
                host=self.env["DB_HOST"], port=int(self.env.get("DB_PORT", "3306")),
                user=self.env.get("DB_USER", ""), password=self.env.get("DB_PASSWORD", ""),
                database=self.env.get("SERVICE_DB_SCHEMA", "posture_service"), connection_timeout=5,
                autocommit=True)
            return True
        except Exception as exc:  # noqa: BLE001 — 접속 실패 이유만(비밀번호 없음) 보인다
            self.reason = f"접속 실패: {type(exc).__name__}"
            return False

    def session(self, client_uuid: str) -> Optional[Dict[str, int]]:
        if self.conn is None:
            return None
        try:
            return self._session(client_uuid)
        except Exception as exc:  # noqa: BLE001 — 연결이 끊겨도 시험은 계속(DB 확인만 빠짐)
            self.reason = f"조회 실패: {type(exc).__name__}"
            self.conn = None
            return None

    def _session(self, client_uuid: str) -> Optional[Dict[str, int]]:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT m.alert_enabled, (m.ended_at IS NOT NULL),"
            " (SELECT COUNT(*) FROM collapse_event e WHERE e.monitor_session_id = m.monitor_session_id),"
            " (SELECT COUNT(*) FROM correction_alert a WHERE a.monitor_session_id = m.monitor_session_id)"
            " FROM monitor_session m WHERE m.client_session_uuid = %s", (client_uuid,))
        row = cur.fetchone()
        cur.close()
        if row is None:
            return None
        return {"alert_enabled": int(row[0]), "ended": int(row[1]), "events": int(row[2]), "alerts": int(row[3])}


SUMMARY_SQL = """SELECT m.monitor_session_id, m.alert_enabled, m.started_at, m.ended_at,
       (SELECT COUNT(*) FROM collapse_event e   WHERE e.monitor_session_id = m.monitor_session_id) AS events,
       (SELECT COUNT(*) FROM correction_alert a WHERE a.monitor_session_id = m.monitor_session_id) AS alerts
FROM monitor_session m WHERE m.started_at >= '{start}' ORDER BY m.started_at;"""


# ───────────────────────────── 단계 ─────────────────────────────

@dataclass
class Result:
    step: str
    title: str
    f: str
    status: str
    evidence: List[str] = field(default_factory=list)
    answers: List[str] = field(default_factory=list)
    reason: str = ""
    attempts: int = 1


class Ctx:
    def __init__(self, args, bus: Bus, ops: Ops, db: Db, out=print, ask=input) -> None:
        self.args = args
        self.bus = bus
        self.ops = ops
        self.db = db
        self.out = out
        self._ask = ask
        self.api = args.api_prefix.rstrip("/")
        self.session: str = ""          # 지금 시험 중인 세션의 Kafka session_id(화면에는 앞 8자)
        self.client: str = ""           # 같은 세션의 앱 UUID(PUT /sessions/{id}, DB client_session_uuid)
        self.sessions: List[str] = []
        self.last_confirm_ms: Optional[int] = None
        self.policy: Tuple[object, object] = (None, None)
        self.offsets_before: Dict[str, int] = {}
        self.started_at = datetime.now()
        self.result: Optional[Result] = None
        self.watchers: Optional["Watchers"] = None

    # 출력·질문
    def say(self, text: str) -> None:
        self.out(f"  ▶ {text}")

    def note(self, text: str) -> None:
        self.out(f"    · {text}")
        if self.result is not None:
            self.result.evidence.append(text)

    def yes(self, question: str) -> None:
        """화면 확인. n이면 이 단계를 FAIL로 올리고, 실행기가 다시·계속·멈춤을 묻는다."""
        while True:
            a = self._ask(f"  ? {question} [y/n/q] ").strip().lower()
            if a in ("y", "n", "q"):
                break
        if self.result is not None:
            self.result.answers.append(f"{question} → {a}")
        if a == "q":
            raise Abort("사용자가 멈춤")
        if a == "n":
            raise Fail(f"화면 확인 실패: {question}")

    def choose_after_fail(self, allow_continue: bool) -> str:
        """실패한 단계 뒤: r 다시, c 실패로 적고 계속, q 멈춤."""
        options = "r/c/q" if allow_continue else "r/q"
        help_text = "r: 이 단계 다시 · c: 실패로 적고 다음 단계 · q: 멈춤" if allow_continue else "r: 다시 · q: 멈춤"
        while True:
            a = self._ask(f"  ? {help_text} [{options}] ").strip().lower()
            if a in options.split("/"):
                return a

    def cursor(self) -> Cursor:
        return Cursor(self.bus, out=self.out)

    # 조건
    def gw(self, method: str, suffix: str, ok: Callable[[int], bool] = lambda s: 200 <= s < 400):
        """gateway 요청 조건. suffix의 {id}는 UUID 자리."""
        pattern = re.compile("^" + re.escape(self.api + suffix).replace(re.escape("{id}"), UUID_RE.pattern) + "$")

        def pred(ev: Event) -> bool:
            return ev.source == "GW" and ev.method == method and bool(pattern.match(ev.path)) and ok(ev.status)
        return pred

    def gw_any_status(self, method: str, suffix: str):
        return self.gw(method, suffix, ok=lambda s: True)

    def kafka(self, source: str, kind: str, event: Optional[str] = None, same_session: bool = True):
        def pred(ev: Event) -> bool:
            if ev.source != source or ev.kind != kind:
                return False
            if event is not None and ev.event != event:
                return False
            return not same_session or not self.session or ev.sid == self.session
        return pred

    @property
    def kafka_mode(self) -> bool:
        return self.args.mode == "kafka"


def status_ok(s: int) -> bool:
    return 200 <= s < 300


def step_s0(c: Ctx) -> None:
    ops = c.ops
    _, head = ops.query(["git", "log", "--oneline", "-1"])
    _, branch = ops.query(["git", "branch", "--show-current"])
    c.note(f"저장소 {branch.strip()} · {head.strip()[:60]}")
    names = ["api-server", "inference-service", "kafka", "redis", "hdfs-namenode", "hdfs-datanode", "spark",
             "io-api", "io-inference", "web", "gateway", "cloudflared"]
    bad = []
    for n in names:
        _, st = ops.query(["docker", "inspect", "-f", "{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}"
                           "{{else}}none{{end}}", n])
        st = st.strip()
        if not st.startswith("running") or st.endswith("unhealthy") or st.endswith("starting"):
            bad.append(f"{n}={st or '없음'}")
    if bad:
        raise Fail("컨테이너 상태: " + ", ".join(bad))
    c.note(f"컨테이너 {len(names)}개 running")
    if ops.pipeline() != "local":
        raise Fail(f"시작 전 io-api가 local이 아님({ops.pipeline()}) — 이전 시험이 되돌려지지 않음")
    c.note("io-api local")
    if c.kafka_mode:
        left = kill_consumers()
        if left > 0:
            c.note(f"이전 실행이 남긴 컨슈머 {left}개 정리")
        code, tl = ops.query(["docker", "exec", "kafka", "/opt/kafka/bin/kafka-topics.sh", "--bootstrap-server",
                              "localhost:9092", "--list"])
        missing = [t for t in TOPICS if t not in tl.split()]
        if code != 0 or len(missing) == len(TOPICS):
            raise Fail(f"Kafka 토픽 목록을 못 읽음(종료 코드 {code}): {tl.strip().splitlines()[-1:] or ['출력 없음']}")
        if missing:
            raise Fail("토픽 없음: " + ", ".join(missing))
        c.note(f"토픽 {len(TOPICS)}개")
        for g in GROUPS[:3]:
            lag = ops.lag(g)
            if lag:
                raise Fail(f"{g} lag {lag} — 밀린 메시지가 있으면 시험 신호가 섞임")
        c.note("lag 0 (inference·judge·report-store)")
    if c.args.login in ("discord", "both"):
        body = http_json("http://127.0.0.1:8090" + c.args.io_prefix + "/auth/social/discord/login", method="POST")
        url = next((v for v in (body or {}).values() if isinstance(v, str) and v.startswith("http")), "")
        from urllib.parse import parse_qs, urlparse
        p = urlparse(url)
        redirect = parse_qs(p.query).get("redirect_uri", [""])[0]
        if p.netloc != "discord.com" or not redirect.endswith("/auth/social/discord/callback"):
            raise Fail(f"Discord 설정 — host {p.netloc or '없음'}, redirect_uri 일치 "
                       f"{redirect.endswith('/auth/social/discord/callback')} (.env Client ID·Redirect 확인)")
        c.note("Discord 로그인 시작 주소 discord.com, redirect 일치")
    if c.db.connect():
        c.note("DB 읽기 조회 사용")
    else:
        c.note(f"DB 조회 안 함 — {c.db.reason}. 알림 켜짐은 " +
               ("저장 서비스 카운터로" if c.kafka_mode else "화면 확인으로") + " 대신 보고, 끝에 확인 SQL을 보임")
    c.offsets_before = ops.offsets(list(TOPICS)) if c.kafka_mode else {}
    if c.kafka_mode:
        c.say("io-api를 kafka 경로로 바꿉니다(좌표 적재 스위치는 끈 채)")
        ops.switch_kafka()
        c.note("io-api kafka · health ok" if not ops.dry_run else "dry-run — 전환 안 함")
    c.say("감시 준비 중(약 8초)")
    if c.watchers is not None:
        c.watchers.start()
    time.sleep(8)


def step_s1a(c: Ctx) -> None:
    cur = c.cursor()
    c.say("앱(app.posegood.site)에서 이메일 계정으로 로그인하세요. 이미 로그인돼 있으면 먼저 로그아웃하세요")
    deadline = time.monotonic() + c.args.wait_user
    failed = 0
    while True:
        left = max(deadline - time.monotonic(), 0.1)
        login = cur.expect(c.gw_any_status("POST", "/auth/login"), left, "로그인 요청(POST /auth/login)")
        if status_ok(login.status):
            break
        failed += 1
        c.note(f"POST /auth/login {login.status} — 로그인 실패, 다시 시도를 기다림")
    c.note(f"POST /auth/login {login.status}" + (f" (앞선 실패 {failed}번)" if failed else ""))
    ws = cur.find(c.gw("GET", "/workspace"), 20)
    c.note("GET /workspace " + (str(ws.status) if ws else "없음(화면 확인으로 대신)"))
    c.yes("메인 화면이 떴나요?")


def step_s1b(c: Ctx) -> None:
    cur = c.cursor()
    c.say("로그아웃한 뒤 「Discord로 로그인」으로 로그인하세요")
    discord = c.gw_any_status("POST", "/auth/social/discord/login")
    basic = c.gw("POST", "/auth/login")
    start = cur.expect(lambda e: discord(e) or basic(e), c.args.wait_user,
                       "Discord 로그인 시작(POST /auth/social/discord/login)")
    if basic(start):
        raise Fail("Discord 대신 이메일 로그인(POST /auth/login)이 들어옴 — 앱 로그인 화면에 「Discord로 로그인」이 "
                   "보이는지(FE 배포의 VITE_DISCORD_LOGIN_ENABLED) 확인. Discord 없이 진행하려면 --login basic")
    if not status_ok(start.status):
        raise Fail(f"Discord 로그인 시작 응답 {start.status}")
    cb = cur.expect(c.gw_any_status("GET", "/auth/social/discord/callback"), c.args.wait_user,
                    "Discord 콜백(GET /auth/social/discord/callback)")
    if cb.status not in (302, 303):
        raise Fail(f"Discord 콜백 응답 {cb.status}(302 기대)")
    c.note(f"Discord 로그인 시작 {start.status} → 콜백 {cb.status}")
    c.yes("가입·연결 화면 없이(또는 마친 뒤) 메인 화면이 떴나요?")


def step_s2(c: Ctx) -> None:
    cur = c.cursor()
    c.say(f"설정(W2)에서 「자세 알림」을 켜고 확정 {c.args.hold_ms // 1000}초·재알림 "
          f"{c.args.reminder_ms // 1000}초로 바꿔 저장하세요(이미 그 값이면 한 번 껐다 켜서 저장)")
    put = cur.find(c.gw_any_status("PUT", "/workspace"), c.args.wait_user)
    if put is None:
        raise Fail("설정 저장 요청(PUT /workspace)이 서버에 오지 않음 — 앱의 알림·규칙 변경이 서버에 저장되지 "
                   "않음(D-96). 이 상태로 측정하면 세션 알림이 계정 값(꺼짐)으로 시작한다")
    if not status_ok(put.status):
        raise Fail(f"설정 저장 응답 {put.status}")
    c.note(f"PUT /workspace {put.status}")


def _start_session(c: Ctx, cur: Cursor) -> None:
    """측정 시작 요청을 잡고, kafka 모드면 그 뒤 첫 session_started의 session_id를 이 세션으로 삼는다."""
    start = cur.expect(c.gw_any_status("PUT", "/sessions/{id}"), c.args.wait_user, "측정 시작(PUT /sessions/{id})")
    if not status_ok(start.status):
        raise Fail(f"측정 시작 응답 {start.status}")
    m = UUID_RE.search(start.path)
    c.client = m.group(0) if m else ""
    c.session = ""
    c.note(f"PUT /sessions/{c.client[:8]}… {start.status}")
    if c.kafka_mode:
        st = cur.expect(c.kafka("FEAT", "session_started", same_session=False), 20, "Kafka session_started")
        c.session = st.sid
        if c.client and st.sid != c.client:
            c.note(f"Kafka session_id {st.sid[:8]}가 앱 UUID와 다름 — Kafka 신호는 session_id로 거름")
        hold, reminder = st.ts_ms if isinstance(st.ts_ms, tuple) else (None, None)
        c.note(f"session_started hold={hold} reminder={reminder}")
        c.policy = (hold, reminder)
    c.sessions.append(c.session or c.client)


def step_s3(c: Ctx) -> None:
    cur = c.cursor()
    c.say("기준 자세를 확인(필요하면 등록)하고 측정을 시작하세요. 측정 화면이 뜨면 바른 자세로 앉아 기다리세요")
    _start_session(c, cur)
    if c.kafka_mode:
        hold, reminder = c.policy
        if hold != c.args.hold_ms or reminder != c.args.reminder_ms:
            raise Fail(f"측정 규칙이 설정과 다름 — hold {hold}·reminder {reminder}, 기대 {c.args.hold_ms}·"
                       f"{c.args.reminder_ms} (S2 저장이 세션에 반영되지 않음)")
    row = c.db.session(c.client) if c.client else None
    if row is not None:
        c.note(f"DB 세션 alert_enabled={row['alert_enabled']}")
        if row["alert_enabled"] != 1:
            raise Fail("DB 세션 alert_enabled = 0 — 앱 「자세 알림」이 측정 시작 전에 서버에 저장되지 않음(D-96)")


def _no_alert_reason(delta: Dict[str, int]) -> str:
    if delta.get("alertsSkippedOff", 0) > 0:
        return "저장 서비스가 「알림 꺼짐」으로 건너뜀(alertsSkippedOff +%d) — 세션 alert_enabled 0(D-96)" % \
            delta["alertsSkippedOff"]
    if delta.get("alertsSkippedStale", 0) > 0:
        return "저장 서비스가 「늦은 사건」으로 건너뜀(alertsSkippedStale +%d) — 판정 지연 확인" % \
            delta["alertsSkippedStale"]
    if delta.get("alertsPublished", 0) > 0:
        return "카운터는 발행했는데 토픽에 안 보임 — 발행 경로·감시 확인"
    return "카운터 변화 없음 — 저장 서비스가 사건을 받지 못함(lag·api-server 로그 확인)"


def _note_unbound(c: Ctx) -> None:
    if c.kafka_mode and not c.session:
        c.note("S3를 건너뛰어 세션을 정하지 않음 — 모든 세션의 신호를 봄(시험 중 다른 측정 금지)")


def step_s4(c: Ctx) -> None:
    cur = c.cursor()
    _note_unbound(c)
    before = c.ops.counters() if c.kafka_mode else None
    c.say(f"나쁜 자세(고개 숙이기 등)를 {c.args.hold_ms // 1000 + 5}초 이상 유지하세요")
    if c.kafka_mode:
        conf = cur.expect(c.kafka("EPIS", "decision", "collapse_confirmed"), c.args.wait_user,
                          "확정 사건(collapse_confirmed)")
        c.last_confirm_ms = conf.ts_ms if isinstance(conf.ts_ms, int) else None
        alert = cur.find(lambda e: c.kafka("ALRT", "alert")(e) and e.event_id == conf.event_id, 5)
        delta = counter_delta(before, c.ops.counters())
        if alert is None:
            raise Fail(f"확정 id={conf.event_id} 뒤 5초 안 알림 없음 — {_no_alert_reason(delta)}")
        c.note(f"확정 id={conf.event_id} → 알림 {alert.t - conf.t:.1f}초 뒤 · 카운터 {delta or '변화 없음'}")
    c.yes("앱에 자세 알림이 떴나요?")


def step_s5(c: Ctx) -> None:
    cur = c.cursor()
    c.say(f"그 자세를 그대로 {c.args.reminder_ms // 1000 + 8}초 더 유지하세요(재알림을 기다림)")
    if c.kafka_mode:
        before = c.ops.counters()
        rem = cur.expect(c.kafka("EPIS", "decision", "reminder"), c.args.reminder_ms / 1000 + 20,
                         "재알림 사건(reminder)")
        alert = cur.find(lambda e: c.kafka("ALRT", "alert")(e) and e.event_id == rem.event_id, 5)
        if alert is None:
            raise Fail(f"재알림 id={rem.event_id} 뒤 5초 안 알림 없음 — "
                       f"{_no_alert_reason(counter_delta(before, c.ops.counters()))}")
        gap = (rem.ts_ms - c.last_confirm_ms) if isinstance(rem.ts_ms, int) and c.last_confirm_ms else None
        c.note(f"재알림 id={rem.event_id} → 알림 · 확정과 간격 {gap / 1000 if gap else '?'}초")
        if gap is not None and abs(gap - c.args.reminder_ms) > 3000:
            raise Fail(f"재알림 간격 {gap / 1000:.1f}초 — 기대 {c.args.reminder_ms / 1000:.0f}초 ±3초")
    c.yes("재알림이 한 번 더 떴나요?")


def step_s6(c: Ctx) -> None:
    cur = c.cursor()
    c.say("바른 자세로 바꿔 20초 앉아 있으세요")
    time.sleep(5)  # 바로 앉는 동안의 신호는 판정에서 뺀다
    cur.drain(0)
    if c.kafka_mode:
        late = cur.none_within(lambda e: c.kafka("ALRT", "alert")(e) or
                               c.kafka("EPIS", "decision", "collapse_confirmed")(e), 15)
        if late is not None:
            raise Fail(f"바른 자세 중 {late.kind} {late.event} id={late.event_id} — 늦은 알림·확정")
        c.note("15초 동안 새 확정·알림 0")
    else:
        time.sleep(15)
    c.yes("바른 자세로 바꾼 뒤 알림이 더 오지 않았나요?")


def step_s7(c: Ctx) -> None:
    cur = c.cursor()
    c.say("고개를 옆으로 돌려 5초 → 자리를 비워 5초(화면 밖) → 돌아와 바른 자세로 앉으세요")
    if c.kafka_mode:
        a = cur.expect(c.kafka("EPIS", "decision", "excluded_started"), c.args.wait_user, "측정 제외 시작")
        b = cur.expect(c.kafka("EPIS", "decision", "excluded_ended"), c.args.wait_user, "측정 제외 끝")
        c.note(f"excluded_started id={a.event_id} → excluded_ended id={b.event_id}")
    c.yes("고개 돌림·자리 비움 표시가 나오고 돌아온 뒤 측정이 이어졌나요?")


def _end_and_store(c: Ctx, cur: Cursor, end_wait: float) -> Tuple[Event, Optional[Event]]:
    end = cur.expect(c.kafka("FEAT", "session_ended"), end_wait, "측정 종료(Kafka session_ended)")
    stored = cur.find(c.kafka("STOR", "session_stored"), 5)
    return end, stored


def step_s8(c: Ctx) -> None:
    cur = c.cursor()
    c.say("측정을 종료하고 결과 화면을 보세요")
    if c.kafka_mode:
        end, stored = _end_and_store(c, cur, c.args.wait_user)
        if stored is None:
            raise Fail("종료 뒤 5초 안 저장 완료(session_stored) 없음")
        c.note(f"session_ended → session_stored {stored.t - end.t:.1f}초")
        if stored.t - end.t > 3:
            raise Fail(f"저장까지 {stored.t - end.t:.1f}초 — 3초 안 기대")
    # nginx는 요청이 끝날 때 접근 로그를 쓴다 — WebSocket은 측정이 끝나 연결이 닫힐 때 한 줄(101)
    ws = cur.find(lambda e: e.source == "GW" and e.path.startswith(c.api + "/realtime"), 10)
    c.note("WebSocket 연결 종료 " + (f"{ws.status}" if ws else "접근 로그에 없음"))
    c.say("기록 목록(R1)을 여세요")
    rec = cur.find(c.gw("GET", "/records"), c.args.wait_user)
    c.note("GET /records " + (str(rec.status) if rec else "없음"))
    row = c.db.session(c.client) if c.client else None
    if row is not None:
        c.note(f"DB 세션 끝남={row['ended']} 사건 {row['events']} 알림 {row['alerts']}")
        if row["ended"] != 1:
            raise Fail("DB 세션 ended_at 없음")
    c.yes("결과 화면이 나오고 기록 목록에 방금 측정이 있나요?")


def step_s9(c: Ctx) -> None:
    if not c.kafka_mode:
        c.note("local 모드 — 저장 지연 경로 없음, 건너뜀")
        return
    cur = c.cursor()
    c.say("새 측정을 시작하고 측정 화면이 뜰 때까지 기다리세요")
    _start_session(c, cur)
    time.sleep(5)
    c.say("api-server(판정·저장)를 멈춥니다 — 아직 종료하지 마세요(멈추는 데 최대 10초)")
    c.ops.stop_api_server()
    stopped_at = time.monotonic()
    c.say("지금 측정을 종료하세요")
    end = cur.expect(c.kafka("FEAT", "session_ended"), c.args.wait_user, "측정 종료(Kafka session_ended)")
    if end.t < stopped_at:
        raise Fail(f"api-server가 다 멈추기 전에 종료됨({stopped_at - end.t:.0f}초 먼저) — r로 다시, 「지금 종료」 안내 뒤 종료")
    early = [e for e in cur.seen if c.kafka("STOR", "session_stored")(e)]
    if early:
        raise Fail("api-server가 멈췄는데 저장 완료가 옴 — 정지가 안 됨")
    c.note(f"api-server 정지 중 종료 (정지 {end.t - stopped_at:.0f}초 뒤)")
    c.yes("약 3초 뒤 「저장 지연」 안내가 떴나요?")
    asked_before = cur.find(c.gw_any_status("GET", "/sessions/{id}"), 10)
    c.note("저장 전 S4 조회 " + (f"{asked_before.status}" if asked_before else "없음"))
    left = 15 - (time.monotonic() - end.t)
    if left > 0:
        cur.drain(left)
    c.say("api-server를 다시 켭니다")
    c.ops.start_api_server()
    stored = cur.expect(c.kafka("STOR", "session_stored"), 60, "재시작 뒤 저장 완료(session_stored)")
    c.note(f"다시 켠 뒤 저장 완료 (종료부터 {stored.t - end.t:.0f}초)")
    asked_after = cur.find(c.gw("GET", "/sessions/{id}"), 20)
    c.note("저장 뒤 S4 조회 " + (f"{asked_after.status}" if asked_after else "없음"))
    if asked_before is None and asked_after is None:
        raise Fail("앱이 S4(GET /sessions/{id})를 한 번도 묻지 않음 — F8 대체 경로가 쓰이지 않음(FE 확인)")
    c.yes("기록 목록(R1)에 이 측정이 보이나요?")


def step_s10(c: Ctx) -> None:
    cur = c.cursor()
    c.say("새 측정을 시작하고 측정 화면이 뜬 뒤 20초 지나면 브라우저 탭(창)을 닫으세요")
    _start_session(c, cur)
    if c.kafka_mode:
        end = cur.expect(c.kafka("FEAT", "session_ended"), c.args.wait_user + 60, "창을 닫은 뒤 측정 종료")
        stored = cur.find(c.kafka("STOR", "session_stored"), 10)
        if stored is None:
            raise Fail("창을 닫은 뒤 저장 완료 없음")
        c.note(f"창 닫음 → session_ended → stored {stored.t - end.t:.1f}초")
    c.say("앱을 다시 열어 기록 목록(R1)을 보세요")
    rec = cur.find(c.gw("GET", "/records"), c.args.wait_user)
    c.note("GET /records " + (str(rec.status) if rec else "없음"))
    c.yes("방금 닫은 측정이 기록 목록에 있나요?")


def step_s11(c: Ctx) -> None:
    cur = c.cursor()
    c.say("기록 목록(R1)과 기록 하나를 여세요")
    rec = cur.expect(c.gw("GET", "/records"), c.args.wait_user, "기록 목록(GET /records)")
    c.note(f"GET /records {rec.status}")
    c.yes("목록이 정상이고 삭제 버튼이 없나요?")


def step_s12(c: Ctx) -> None:
    ops = c.ops
    if c.kafka_mode:
        after = ops.offsets(list(TOPICS))
        diff = {t: after.get(t, 0) - c.offsets_before.get(t, 0) for t in after}
        c.note("오프셋 " + " ".join(f"{TOPICS[t]}+{d}" for t, d in diff.items()))
        if diff.get("posture.dlq", 0) != 0:
            raise Fail(f"DLQ +{diff['posture.dlq']}")
        if diff.get("posture.keypoints.v1", 0) != 0:
            raise Fail(f"keypoints +{diff['posture.keypoints.v1']} — 좌표 적재 스위치가 켜져 있음")
        for _ in range(4):  # 마지막 메시지를 처리하는 중이면 잠깐 lag가 남는다 — 최대 15초 다시 봄
            lags = {g: ops.lag(g) for g in GROUPS}
            if not any(v for v in lags.values()):
                break
            time.sleep(5)
        c.note("lag " + " ".join(f"{g}={v}" for g, v in lags.items()))
        if any(v for v in lags.values()):
            raise Fail("lag 0 아님(15초 뒤에도)")
    since = c.started_at.strftime("%Y-%m-%dT%H:%M:%S")
    _, logs = ops.query(["docker", "logs", "--since", since, "io-api"])
    warns = [ln for ln in logs.splitlines() if re.search(r"\b(WARN|ERROR)\b", ln) and "deprecat" not in ln.lower()]
    c.note(f"io-api 경고·오류 {len(warns)}줄")
    if warns:
        raise Fail(f"io-api 경고·오류 {len(warns)}줄 — docker logs --since {since} io-api 로 확인")


STEPS: List[Tuple[str, str, str, Callable[[Ctx], None]]] = [
    ("S0", "준비·전환", "-", step_s0),
    ("S1a", "기본 로그인", "F1", step_s1a),
    ("S1b", "Discord 로그인", "F1", step_s1b),
    ("S2", "알림·규칙 저장", "F2", step_s2),
    ("S3", "측정 시작", "F1·F2", step_s3),
    ("S4", "확정·알림", "F2·F3", step_s4),
    ("S5", "재알림", "F2·F3", step_s5),
    ("S6", "늦은 알림 없음", "F3", step_s6),
    ("S7", "고개 돌림·자리 비움", "F4", step_s7),
    ("S8", "정상 종료", "F5", step_s8),
    ("S9", "저장 지연·S4 대체 경로", "F6·F8", step_s9),
    ("S10", "창 닫기", "F7", step_s10),
    ("S11", "기록 화면", "F9", step_s11),
    ("S12", "오프셋·lag·경고", "K1·K2", step_s12),
]


def plan_steps(mode: str, login: str, start: Optional[str], only: Optional[str], skip: List[str]) -> List[str]:
    ids = [s[0] for s in STEPS]
    if login == "basic":
        ids.remove("S1b")
    elif login == "discord":
        ids.remove("S1a")
    if mode == "local":
        ids.remove("S9")
    if only:
        return ["S0", only] if only != "S0" else ["S0"]
    if start:
        if start not in ids:
            raise SystemExit(f"--from {start}: 이 모드에 없는 단계")
        ids = ["S0"] + ids[ids.index(start):] if start != "S0" else ids
    return [i for i in ids if i not in skip]


def write_report(path: Path, args, results: List[Result], ctx: Ctx, final: str) -> None:
    lines = [f"# 통신 시험 결과 — {ctx.started_at:%Y-%m-%d %H:%M} ({args.mode} 모드, 로그인 {args.login})", "",
             f"- 최종: **{final}**",
             f"- 세션: {', '.join(s[:8] for s in ctx.sessions if s) or '-'}", "",
             "| 단계 | 확인 | F | 결과 | 근거 | 화면 확인 |", "|---|---|---|---|---|---|"]

    def esc(text: str) -> str:
        return text.replace("|", "\\|")

    def cell(items: List[str]) -> str:
        return "<br>".join(esc(i) for i in items) or "-"

    for r in results:
        ev, ans = cell(r.evidence), cell(r.answers)
        res = r.status + (f" (시도 {r.attempts})" if r.attempts > 1 else "")
        res += f" — {esc(r.reason)}" if r.reason else ""
        lines.append(f"| {r.step} | {r.title} | {r.f} | {res} | {ev} | {ans} |")
    lines += ["", "DB 확인(필요하면 DB PC에서 실행, 개수만 옮김):", "", "```sql",
              SUMMARY_SQL.format(start=ctx.started_at.strftime("%Y-%m-%d %H:%M:%S")), "```", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def run_steps(ctx: Ctx, order: List[str], steps: Dict[str, Tuple[str, str, str, Callable[[Ctx], None]]],
              out=print) -> Tuple[List[Result], str]:
    """단계를 차례로 돌린다. 실패하면 다시(r)·계속(c)·멈춤(q)을 묻는다. (결과, 최종) — 최종은 PASS·FAIL (…)·멈춤 …"""
    results: List[Result] = []
    stopped = ""
    try:
        for sid in order:
            _, title, f, fn = steps[sid]
            attempt = 0
            while True:
                attempt += 1
                out(f"\n[{sid}] {title} ({f})" + (f" — 시도 {attempt}" if attempt > 1 else ""))
                res = Result(sid, title, f, "PASS", attempts=attempt)
                ctx.result = res
                if results and results[-1].step == sid:
                    results[-1] = res
                else:
                    results.append(res)
                try:
                    fn(ctx)
                    out(f"[{sid}] PASS")
                    break
                except Fail as exc:
                    res.status, res.reason = "FAIL", str(exc)
                except Abort:
                    raise
                except Exception as exc:  # noqa: BLE001 — 도구 오류도 실패로 적고 고르게 한다(PASS로 남지 않게)
                    res.status, res.reason = "FAIL", f"도구 오류 {type(exc).__name__}: {exc}"
                out(f"[{sid}] FAIL — {res.reason}")
                if ctx.ops.api_stopped:
                    try:
                        ctx.ops.start_api_server()
                        out("    · api-server 다시 켬")
                    except Fail as exc:
                        out(f"    · api-server 다시 켜기 실패: {exc} — 끝날 때 한 번 더 시도")
                choice = ctx.choose_after_fail(allow_continue=sid != "S0")
                if choice == "r":
                    continue
                if choice == "q":
                    raise Abort("실패 뒤 멈춤")
                break
    except (Abort, KeyboardInterrupt) as exc:
        stopped = f"멈춤 ({results[-1].step if results else '-'}): {str(exc) or 'Ctrl+C'}"
        if results and results[-1].status == "PASS":
            results[-1].status = "멈춤"
        out(f"\n{stopped}")
    failed = [r.step for r in results if r.status == "FAIL"]
    if stopped:
        final = stopped + (f" · FAIL {', '.join(failed)}" if failed else "")
    else:
        final = f"FAIL ({', '.join(failed)})" if failed else "PASS"
    return results, final


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["kafka", "local"], default="kafka")
    ap.add_argument("--login", choices=["basic", "discord", "both"], default=None,
                    help="기본값: local → basic, kafka → both")
    ap.add_argument("--from", dest="start", help="이 단계부터(S0는 항상 먼저)")
    ap.add_argument("--only", help="이 단계만(S0 뒤)")
    ap.add_argument("--skip", action="append", default=[], help="건너뛸 단계(여러 번)")
    ap.add_argument("--dry-run", action="store_true", help="서버 조작(전환·정지) 없이 안내·감시만")
    ap.add_argument("--list", action="store_true", help="단계 목록만 보이고 끝")
    ap.add_argument("--repo", default=".", help="저장소 경로(compose 실행 위치)")
    ap.add_argument("--env-file", default="infra/compose/.env")
    ap.add_argument("--out", default=None,
                    help="결과 파일 폴더(기본: 저장소 tests/comm-test-results — 저장소에 올리지 않음)")
    ap.add_argument("--api-prefix", default="/api/v2", help="gateway 기준 API 경로(D-94 뒤 바꿈)")
    ap.add_argument("--io-prefix", default="/v2", help="io-api 직접 호출 경로(127.0.0.1:8090)")
    ap.add_argument("--hold-ms", type=int, default=5000)
    ap.add_argument("--reminder-ms", type=int, default=30000)
    ap.add_argument("--wait-user", type=float, default=120, help="사용자 동작을 기다리는 시간(초)")
    args = ap.parse_args(argv)
    if args.login is None:
        args.login = "basic" if args.mode == "local" else "both"
    if args.only and args.start:
        ap.error("--only와 --from은 함께 쓰지 않는다")

    order = plan_steps(args.mode, args.login, args.start, args.only, args.skip)
    titles = {s[0]: s for s in STEPS}
    if args.list:
        for i in order:
            print(f"{i:<4} {titles[i][2]:<6} {titles[i][1]}")
        return 0

    repo = Path(args.repo).resolve()
    if not (repo / "infra/compose/bigdata.yaml").is_file():
        print(f"저장소 루트에서 실행하세요(--repo): {repo}", file=sys.stderr)
        return 2
    env = load_env(repo / args.env_file)
    bus = Bus()
    ops = Ops(repo, args.dry_run)
    ctx = Ctx(args, bus, ops, Db(env))
    watchers = Watchers(bus, WATCHED_TOPICS if args.mode == "kafka" else [], args.dry_run)
    ctx.watchers = watchers
    results: List[Result] = []
    final = "멈춤 (-): 정리 중 오류"
    print(f"통신 시험 — {args.mode} 모드, 로그인 {args.login}, 단계 {' '.join(order)}"
          + (" (dry-run)" if args.dry_run else ""))
    try:
        results, final = run_steps(ctx, order, titles)
    finally:
        print("\n[정리]")
        cleanup = []
        try:
            if ops.api_stopped:
                ops.start_api_server()
                cleanup.append("api-server 다시 켬")
            if ops.switched or (args.mode == "kafka" and not args.dry_run and ops.pipeline() != "local"):
                ops.restore_local()
                cleanup.append("io-api local 복원")
            if not args.dry_run:
                cleanup.append(f"io-api {ops.pipeline()}")
        except Exception as exc:  # noqa: BLE001 — 정리 실패는 반드시 보이게
            cleanup.append(f"정리 실패: {exc} — 수동으로 api-server up·io-api local 복원")
            final += " / 정리 실패"
        watchers.stop()
        print("    " + " · ".join(cleanup or ["바꾼 것 없음"]))
        out_dir = Path(args.out) if args.out else repo / "tests" / "comm-test-results"
        out_dir.mkdir(parents=True, exist_ok=True)
        report = out_dir / f"comm-test-{ctx.started_at:%Y%m%d-%H%M%S}-{args.mode}.md"
        write_report(report, args, results, ctx, final)
        print(f"\n최종: {final}\n결과 파일: {report}")
    return 0 if final == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
