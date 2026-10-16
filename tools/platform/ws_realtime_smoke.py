#!/usr/bin/env python3
"""실시간 WebSocket 왕복 점검(계획 0031 3단계, D-57) — 앱처럼 /v2/realtime으로 좌표를 보내고 결과·저장을 확인한다.

판정 경로가 API 안(POSEGOOD_REALTIME_PIPELINE=local, 지금)이든 Kafka(kafka, 1단계 뒤)든 앱이 받는 메시지와 DB 기록은
같아야 한다. 두 경로에서 이 점검을 한 번씩 돌려 결과를 비교하는 것이 전환 시험이다.
통합 테스트 12단계(tools/platform/integration_test.sh)가 부른다. 혼자 실행해도 된다.

    python3 tools/platform/ws_realtime_smoke.py --base http://127.0.0.1:8090 --report http://127.0.0.1:8080

시나리오(합성 좌표, 0.5초 구간 167개, 정책 3000/3000/60000/0.7):
    정상 5s → 고개 숙임 70s → 정상 4s → 휴식(rest) 2.5s → 정상 2s → 1.5s 공백 뒤 end(85000)
기대값:
    decision  collapse_confirmed 8000(시작 5000) → reminder 68000 → recovery_confirmed 78000 → session_ended 85000
              (Kafka 경로는 제외 구간 사건 excluded_started·excluded_ended가 섞여 온다 — 그것은 따로 센다)
    alert     2개(collapse_confirmed·reminder, 새 계정은 알림 켜짐)
    closed    ended
    요약      total 85000 · valid 81000 · normal 11000 · deviation 70000 · rest 2500 · missing 1500 · 붕괴 1 · 알림 2
    DB        (--report가 있으면 처리 서비스 GET /report/sessions/{id}로) 종료 85000, good_sec 11.0, 붕괴 1(5000 → 8000 → 회복 78000),
              알림 8000·68000, 제외 구간 PAUSE 79000~81500 · MISSING 83500~85000
끝에서 세션을 지우고 계정을 탈퇴 접수한다(io_api_smoke.py와 같은 합성 시험 계정 test-it-*@example.invalid).
표준 라이브러리만 쓴다(WebSocket 클라이언트도 직접 — 서버 PC에 websockets 패키지가 없어도 된다). 좌표는 로그에 남기지 않는다.
"""

import argparse
import base64
import json
import os
import socket
import struct
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from io_api_smoke import CONSENTS, LANDMARKS, PASSWORD, POLICY, Client  # noqa: E402

PASSED = 0
FAILED = 0
SEGMENT_MS = 500
END_MS = 85000

# 관절 순서: 코·왼눈·오른눈·왼귀·오른귀·입 왼쪽·입 오른쪽·왼어깨·오른어깨 (FrameInterval.JOINTS)
ORDER = ("nose", "left_eye", "right_eye", "left_ear", "right_ear", "mouth_left", "mouth_right",
         "left_shoulder", "right_shoulder")


def ok(name):
    global PASSED
    PASSED += 1
    print(f"PASS  {name}", flush=True)


def bad(name, detail=""):
    global FAILED
    FAILED += 1
    print(f"FAIL  {name}" + (f" — {detail}" if detail else ""), flush=True)


def check(name, condition, detail=""):
    ok(name) if condition else bad(name, detail)
    return condition


# ---------------------------------------------------------------------------
# 최소 WebSocket 클라이언트(RFC 6455, 텍스트 프레임·ping/pong·close만, TLS 없음 — 서버 PC 안 127.0.0.1용)

class WebSocket:
    def __init__(self, url, headers, timeout=15):
        parts = urlsplit(url)
        if parts.scheme != "ws":
            raise ValueError("ws:// 주소만 지원")
        host, port = parts.hostname, parts.port or 80
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        lines = [f"GET {parts.path or '/'} HTTP/1.1", f"Host: {host}:{port}", "Upgrade: websocket",
                 "Connection: Upgrade", f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13"]
        lines += [f"{k}: {v}" for k, v in headers.items()]
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("핸드셰이크 중 연결이 닫힘")
            response += chunk
        head, self.buffer = response.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0].decode(errors="replace")
        if " 101 " not in status + " ":
            raise ConnectionError(f"핸드셰이크 실패: {status}")
        self.closed = False

    def send(self, message):
        payload = json.dumps(message, separators=(",", ":"), allow_nan=False).encode()
        self._frame(0x1, payload)

    def _frame(self, opcode, payload):
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x80 | opcode, 0x80 | n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, n)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def _read(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("연결이 닫힘")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def recv(self, timeout):
        """다음 텍스트 메시지(JSON). 시간 안에 없으면 None, 서버가 닫으면 ConnectionError."""
        self.sock.settimeout(timeout)
        try:
            message = b""
            while True:
                b1, b2 = self._read(2)
                opcode, length = b1 & 0x0F, b2 & 0x7F
                if length == 126:
                    length = struct.unpack("!H", self._read(2))[0]
                elif length == 127:
                    length = struct.unpack("!Q", self._read(8))[0]
                if b2 & 0x80:
                    mask = self._read(4)
                    data = bytes(b ^ mask[i % 4] for i, b in enumerate(self._read(length)))
                else:
                    data = self._read(length)
                if opcode == 0x8:
                    self.closed = True
                    raise ConnectionError("서버가 닫음")
                if opcode == 0x9:
                    self._frame(0xA, data)
                    continue
                if opcode in (0x1, 0x0, 0x2):
                    message += data
                    if b1 & 0x80:
                        return json.loads(message)
        except socket.timeout:
            return None

    def close(self):
        if not self.closed:
            try:
                self._frame(0x8, struct.pack("!H", 1000))
            except OSError:
                pass
        self.sock.close()


# ---------------------------------------------------------------------------
# 합성 좌표

def frame(t_ms, head_drop):
    """프레임 하나. head_drop만큼 얼굴 점을 아래로 — 기준(LANDMARKS) 대비 머리 높이 변화량 −head_drop×480/192."""
    points = []
    for name in ORDER:
        p = LANDMARKS[name]
        face = not name.endswith("shoulder")
        points.append([round(p["x"], 5), round(p["y"] + (head_drop if face else 0.0), 5), 0.95])
    return {"t_ms": t_ms, "p": points}


def plan():
    """(phase, head_drop) 구간 목록과 끝 시각. 0.1 숙임 → 변화량 −0.25 → 점수 0.795(≥ 0.7, unspecified)."""
    parts = [(5000, "running", 0.0), (70000, "running", 0.1), (4000, "running", 0.0),
             (2500, "rest", None), (2000, "running", 0.0)]
    items, t, seq = [], 0, 0
    for length, phase, drop in parts:
        for _ in range(length // SEGMENT_MS):
            frames = [] if drop is None else [frame(t + k * 100, drop) for k in range(5)]
            items.append({"schema_version": "3.0", "feature_version": "keypoints-9-v1", "sequence": seq,
                          "start_ms": t, "end_ms": t + SEGMENT_MS, "phase": phase, "frames": frames})
            seq += 1
            t += SEGMENT_MS
    return items, END_MS


# ---------------------------------------------------------------------------

def get_json(url):
    try:
        with urlopen(Request(url), timeout=10) as response:
            return response.status, json.loads(response.read() or b"null")
    except URLError as error:
        return getattr(error, "code", 0), None


def scenario(base, report, pipeline):
    owner = Client(base)
    owner.refresh_csrf()
    email = f"test-it-{uuid.uuid4().hex[:12]}@example.invalid"
    status, user = owner.call("/v2/auth/register", "POST", {
        "email": email, "password": PASSWORD,
        "profile": {"name": "합성 사용자", "age": 30, "occupation": "합성 시험"},
        "consents": [{"type": t, "document_version": "service-v2"} for t in CONSENTS],
    })
    if not check("가입 (합성 시험 계정)", status == 200 and isinstance(user, dict) and user.get("user_id"), f"HTTP {status}"):
        return
    owner.user_id = user["user_id"]
    owner.refresh_csrf()
    status, saved = owner.call("/v2/baselines", "POST", {
        "registered_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "calibration_ms": 3000, "sample_count": 20, "landmarks": LANDMARKS})
    if not check("기준 자세 등록", status == 200 and saved.get("baseline_id"), f"HTTP {status}"):
        return
    sid = str(uuid.uuid4())
    path = "/v2/sessions/" + sid
    status, _ = owner.call(path, "PUT", {"policy": POLICY, "baseline_id": saved["baseline_id"]})
    if not check("세션 생성", status == 200, f"HTTP {status}"):
        return

    try:
        run_socket(base, owner, sid, pipeline)
        check_records(owner, path, report, sid)
    finally:
        owner.call(path, "DELETE")
        owner.call("/v2/auth/account", "DELETE", {"password": PASSWORD})


def run_socket(base, owner, sid, pipeline):
    parts = urlsplit(base)
    jar = next(h.cookiejar for h in owner.opener.handlers if isinstance(h, HTTPCookieProcessor))
    cookies = "; ".join(f"{c.name}={c.value}" for c in jar)
    ws = WebSocket(f"ws://{parts.hostname}:{parts.port or 80}/v2/realtime",
                   {"Origin": f"{parts.scheme}://{parts.netloc}", "Cookie": cookies})
    received = []

    def until(predicate, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = ws.recv(max(0.1, deadline - time.monotonic()))
            if message is None:
                continue
            received.append(message)
            if predicate(message):
                return message
        return None

    try:
        ws.send({"type": "hello", "schema_version": "2.0", "purpose": "measure", "session_id": sid})
        ready = until(lambda m: m.get("type") in ("ready", "closed"), 6)
        if not check("hello → ready", ready is not None and ready.get("type") == "ready", f"받음={ready}"):
            return
        items, end_ms = plan()
        t0 = time.monotonic()
        acked = 0
        for item in items:
            ws.send({"type": "features", "items": [item]})
            seq = item["sequence"]
            got = until(lambda m: (m.get("type") == "ack" and m.get("last_sequence", -1) >= seq)
                        or m.get("type") == "closed", 10)
            if got is None or got.get("type") != "ack":
                bad("구간 ack", f"sequence {seq}에서 {got}")
                return
            acked += 1
        check(f"구간 {len(items)}개 보내고 ack {acked}개 ({time.monotonic() - t0:.1f}초)", acked == len(items))
        ws.send({"type": "end", "end_ms": end_ms})
        closed = until(lambda m: m.get("type") == "closed", 30)
    except (ConnectionError, OSError) as error:
        closed = None
        bad("WebSocket 연결", repr(error))
    finally:
        ws.close()

    kinds = [m.get("type") for m in received]
    decided = [m for m in received if m.get("type") == "decision"]
    decisions = [m["event"] for m in decided]
    main = [(e["kind"], e["timestamp_ms"], e["onset_ms"]) for e in decisions if not e["kind"].startswith("excluded_")]
    excluded = [(e["onset_ms"], e["timestamp_ms"], e["reason"]) for e in decisions if e["kind"] == "excluded_ended"]
    alerts = [(m["kind"], m["event_id"]) for m in received if m.get("type") == "alert"]
    observations = sum(1 for k in kinds if k == "observation")
    print("  받은 메시지: " + ", ".join(f"{k} {kinds.count(k)}" for k in sorted(set(kinds))), flush=True)
    check("closed(ended)", closed is not None and closed.get("reason") == "ended", f"받음={closed}")
    check("decision: 확정 8.0s → 재알림 68.0s → 회복 78.0s → 세션 종료 85.0s",
          main == [("collapse_confirmed", 8000, 5000), ("reminder", 68000, 5000),
                   ("recovery_confirmed", 78000, 5000), ("session_ended", 85000, 85000)], f"받음={main}")
    if pipeline == "kafka" or excluded:
        check("decision 제외 구간: PAUSE 79.0~81.5s · MISSING 83.5~85.0s (Kafka 경로, D-39)",
              excluded == [(79000, 81500, "rest"), (83500, 85000, "missing")], f"받음={excluded}")
    check("alert 2개 (확정·재알림)", [k for k, _ in alerts] == ["collapse_confirmed", "reminder"], f"받음={alerts}")
    check("observation 받음", observations > 0, "0개")
    final = decided[-1]["summary"] if decided else {}
    want = {"total_ms": 85000, "valid_ms": 81000, "normal_ms": 11000, "deviation_ms": 70000, "rest_ms": 2500,
            "missing_ms": 1500, "collapse_count": 1, "alert_count": 2}
    check("마지막 요약(전체·유효·바른·이탈·휴식·누락·붕괴·알림)", all(final.get(k) == v for k, v in want.items()),
          f"받음={ {k: final.get(k) for k in want} }")
    stalled = kinds.count("stalled")
    if stalled:
        print(f"  참고: stalled {stalled}개", flush=True)


def check_records(owner, path, report, sid):
    status, view = owner.call(path)
    check("REST 세션 조회: 종료됨", status == 200 and isinstance(view, dict) and view.get("ended"), f"HTTP {status}")
    if not report:
        return
    stored = None
    for _ in range(15):
        status, stored = get_json(report.rstrip("/") + "/report/sessions/" + sid)
        if status == 200 and stored and stored.get("ended_ms") is not None:
            break
        time.sleep(1)
    if not check("DB 기록 조회(처리 서비스 /report/sessions)", status == 200 and stored, f"HTTP {status}"):
        return
    events = [(e["started_ms"], e["confirmed_ms"], e.get("recovered_ms")) for e in stored.get("events") or []]
    alerts = [a["attempted_ms"] for a in stored.get("alerts") or []]
    spans = [(x["started_ms"], x["ended_ms"], x["exclusion_reason"]) for x in stored.get("excluded") or []]
    check("DB: 종료 85.0s · good_sec 11.0", stored.get("ended_ms") == 85000 and float(stored.get("good_sec") or -1) == 11.0,
          f"ended_ms={stored.get('ended_ms')} good_sec={stored.get('good_sec')}")
    check("DB: 붕괴 1(5.0 → 8.0 → 회복 78.0) · 알림 8.0·68.0", events == [(5000, 8000, 78000)] and alerts == [8000, 68000],
          f"events={events} alerts={alerts}")
    check("DB: 제외 구간 PAUSE 79.0~81.5s · MISSING 83.5~85.0s",
          spans == [(79000, 81500, "PAUSE"), (83500, 85000, "MISSING")], f"받음={spans}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://127.0.0.1:8090", help="io-api 주소 (기본 %(default)s)")
    parser.add_argument("--report", default=None,
                        help="처리 서비스(api-server) 주소 — 주면 DB 기록까지 확인 (예: http://127.0.0.1:8080)")
    parser.add_argument("--pipeline", choices=["local", "kafka"], default="local",
                        help="io-api의 POSEGOOD_REALTIME_PIPELINE (kafka면 제외 구간 사건도 기대)")
    args = parser.parse_args()
    try:
        scenario(args.base, args.report, args.pipeline)
    except (RuntimeError, URLError, OSError) as error:
        bad("입출구 서버 접속", repr(error))
    print(f"ws realtime ({args.pipeline}): PASS {PASSED} / FAIL {FAILED}", flush=True)
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
