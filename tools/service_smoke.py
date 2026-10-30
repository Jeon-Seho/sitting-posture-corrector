"""Verify the loopback API with the real FastAPI inference on a disposable database.

Only explicit synthetic accounts and 9-joint coordinates are used; no camera or participant data.
Measurement goes through `/v2/realtime` (the HTTP feature input S2 was removed on 2026-10-28, plan 0062);
session views are checked against the versioned JSON Schemas in contracts/.
"""

import json
import sys
import uuid
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

if __package__:
    from .realtime_client import RealtimeClient
    from .service_contract import validate_view
    from .service_processes import ServiceEndpoints, running_services
    from .test_mysql import disposable_database, mysql_server, query
else:
    from realtime_client import RealtimeClient
    from service_contract import validate_view
    from service_processes import ServiceEndpoints, running_services
    from test_mysql import disposable_database, mysql_server, query

POLICY = {"hold_ms": 3000, "recovery_ms": 3000, "reminder_ms": 60000, "threshold": 0.7}
# Synthetic baseline joints (nose, eyes, ears, mouth corners, shoulders) in image ratios.
JOINTS = [[0.5, 0.4], [0.52, 0.37], [0.48, 0.37], [0.56, 0.38], [0.44, 0.38],
          [0.515, 0.45], [0.485, 0.45], [0.65, 0.62], [0.35, 0.62]]
JOINT_NAMES = ("nose", "left_eye", "right_eye", "left_ear", "right_ear", "mouth_left", "mouth_right",
               "left_shoulder", "right_shoulder")


class Account:
    """A browser-like client: Bearer access token, refresh cookie and the stale-tab user header (ADR 0031)."""

    def __init__(self, base):
        self.base = base
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        self.access_token = None
        self.user_id = None

    def headers(self, method="GET"):
        """Login headers for a client without this cookie jar (the server benchmark)."""
        headers = {}
        if self.access_token:
            headers["Authorization"] = "Bearer " + self.access_token
        if self.user_id:
            headers["X-PoseGood-User-Id"] = self.user_id
        return headers

    def cookie_header(self):
        return "; ".join(cookie.name + "=" + cookie.value for cookie in self.cookies)

    def request(self, path, method="GET", body=None, expected=200):
        headers = {"Content-Type": "application/json", **self.headers(method)}
        data = None if body is None else json.dumps(body, allow_nan=False).encode()
        try:
            with self.opener.open(Request(self.base + path, data=data, method=method, headers=headers), timeout=10) as response:
                status, raw = response.status, response.read()
        except HTTPError as error:
            status, raw = error.code, error.read()
        assert status == expected, (method, path, status, raw[:200])
        return json.loads(raw) if raw else None

    def register(self):
        user = self.request("/v2/auth/register", "POST", {
            "email": f"test-{uuid.uuid4()}@example.invalid",
            "password": "synthetic-password-1",
            "profile": {"name": "합성 사용자", "age": 30, "occupation": "합성 시험"},
            "consents": [{"type": t, "document_version": "service-v2"} for t in ("TERMS", "ACCOUNT_INFO", "POSE_COORDINATES", "MEASUREMENT_RECORD", "AGE_14_OVER", "OPTIONAL_PROFILE")],
        })
        self.user_id = user["user_id"]
        self.access_token = user["access_token"]
        return user


def register_baseline(account):
    """Register a synthetic 9-landmark baseline; sessions must name the account's current one.

    B1 takes the app's mean of the capture (ADR 0021 section 5): here the mean of JOINTS.
    """
    saved = account.request("/v2/baselines", "POST", {
        "registration_id": str(uuid.uuid4()),  # issued once per capture, repeated on retries (ADR 0028)
        "calibration_ms": 3000, "sample_count": 20,
        "landmarks": {name: {"x": x, "y": y} for name, (x, y) in zip(JOINT_NAMES, JOINTS)},
    })
    return saved["baseline_id"]


class Measurement:
    """Ordered synthetic 0.5 s coordinate intervals over `/v2/realtime`, judged in server batches by real inference v3."""

    def __init__(self, account, api_base):
        self.account = account
        self.api_base = api_base
        self.id = str(uuid.uuid4())
        self.baseline = None
        self.path = "/v2/sessions/" + self.id
        self.sequence = 0
        self.socket = None

    def create(self):
        self.baseline = register_baseline(self.account)
        view = self.account.request(self.path, "PUT", {"policy": POLICY, "baseline_id": self.baseline})
        validate_view(view)
        self.socket = RealtimeClient(self.api_base)
        self.socket.send({"type": "hello", "schema_version": "2.0", "purpose": "measure", "session_id": self.id,
                          "access_token": self.account.access_token})
        ready = self.socket.next("ready")
        assert ready["session_id"] == self.id, ready
        return view

    def feed(self, start, end, shift=0.0, phase="running", person=True):
        """Intervals in [start, end): the head (nose, eyes, ears, mouth) moved sideways by `shift`."""
        while start < end:
            frames = []
            if phase == "running":
                for t in range(start, start + 500, 125):
                    p = [[x + (shift if i < 7 else 0.0), y, 0.95] for i, (x, y) in enumerate(JOINTS)]
                    frames.append({"t_ms": t, "p": p if person else None})
            self.socket.send({"type": "features", "items": [{
                "schema_version": "3.0", "feature_version": "keypoints-9-v1", "sequence": self.sequence,
                "start_ms": start, "end_ms": start + 500, "phase": phase, "frames": frames,
            }]})
            self.sequence += 1
            start += 500
        last = self.sequence - 1
        while self.socket.next("ack")["last_sequence"] != last:
            pass
        # The server holds intervals for about 3 s of server time, then judges them (plan 0064): wait for that batch.
        while self.socket.next("progress")["last_sequence"] != last:
            pass
        view = self.account.request(self.path)
        validate_view(view)
        return view

    def end(self, end_ms):
        self.socket.send({"type": "end", "end_ms": end_ms})
        self.socket.next("decision", "session_ended")
        closed = self.socket.next("closed")
        assert closed["reason"] == "ended" and closed["ended_at"], closed
        self.socket.close()


def scenario(endpoints, database):
    owner = Account(endpoints.api)
    owner.register()
    stranger = Account(endpoints.api)
    stranger.register()
    anonymous = Account(endpoints.api)

    measurement = Measurement(owner, endpoints.api)
    measurement.create()
    measurement.feed(0, 3000, shift=0.09)
    collapsed = measurement.feed(3000, 6000)
    kinds = [event["kind"] for event in collapsed["events"]]
    assert kinds == ["collapse_confirmed", "recovery_confirmed"], kinds
    assert collapsed["events"][0]["timestamp_ms"] == 3000
    assert collapsed["events"][0]["deviation_type"] == "left_lean"
    print("PASS: real inference scores of /v2/realtime coordinates drive collapse at 3 s and recovery at 6 s",
          flush=True)

    measurement.feed(6000, 7000, phase="rest")
    measurement.feed(7000, 8000, person=False)
    anonymous.request(measurement.path, expected=401)
    stranger.request(measurement.path, expected=404)
    print("PASS: missing login is 401; another account's session is 404", flush=True)

    measurement.end(9000)
    ended = owner.request(measurement.path)
    validate_view(ended)
    summary = ended["summary"]
    assert ended["ended"] and summary["total_ms"] == 9000, summary
    assert (summary["valid_ms"], summary["normal_ms"], summary["rest_ms"], summary["unknown_ms"],
            summary["missing_ms"]) == (6000, 3000, 1000, 1000, 1000), summary
    assert ended["events"][-1]["kind"] == "session_ended"
    assert owner.request(measurement.path + "/end", "POST", {"end_ms": 9000}) == ended
    owner.request(measurement.path + "/end", "POST", {"end_ms": 9500}, expected=409)
    print("PASS: end over the connection stores the session; S3 with the same end is idempotent, another is 409",
          flush=True)

    session = query(database, "SELECT monitor_session_id, ended_at, good_sec FROM monitor_session"
                              " WHERE client_session_uuid=%s", measurement.id)
    key, ended_at, good = session[0]
    assert ended_at is not None and str(good) == "3.0", session
    excluded = query(database, "SELECT exclusion_reason FROM excluded_interval WHERE monitor_session_id=%s"
                               " ORDER BY started_at", key)
    assert [row[0] for row in excluded] == ["PAUSE", "UNMEASURABLE", "MISSING"], excluded
    episodes = query(database, "SELECT recovered_at IS NOT NULL FROM collapse_event WHERE monitor_session_id=%s", key)
    assert episodes == ((1,),), episodes
    # The API never writes daily_stat (architecture v5.2): Spark J2 aggregates the previous KST day at 00:00.
    # A row here would mean the API accumulates again and J2 would count the session twice.
    daily = query(database, "SELECT COUNT(*) FROM daily_stat WHERE user_account_id=%s", int(owner.user_id))
    assert daily == ((0,),), daily
    baseline = query(database, "SELECT COUNT(*) FROM baseline_posture WHERE user_account_id=%s",
                     int(owner.user_id))
    assert baseline == ((1,),), baseline
    assert owner.request("/v2/baselines/current")["baseline_id"] == measurement.baseline
    print("PASS: schema rows: baseline, session end, exclusions, episode and daily statistics", flush=True)

    listed = owner.request("/v2/records")
    assert len(listed["today"]) == 10, listed
    records = listed["records"]
    assert [record["id"] for record in records] == [measurement.id], records
    assert (records[0]["total"], records[0]["good"], records[0]["server"]["confirmed"]) == (9, 3, True), records[0]
    print("PASS: the record is rebuilt from the session tables", flush=True)

    owner.request("/v2/records/" + measurement.id, "DELETE", expected=204)
    owner.request(measurement.path, expected=404)
    assert query(database, "SELECT COUNT(*) FROM monitor_session WHERE client_session_uuid=%s",
                 measurement.id) == ((0,),)
    print("PASS: deleting a record (R3) removes its session rows", flush=True)


def main():
    endpoints = ServiceEndpoints.allocate()
    with mysql_server() as server, disposable_database(server) as database:
        with running_services(endpoints, database):
            scenario(endpoints, database)


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, RuntimeError, OSError) as error:
        sys.exit(f"FAIL: {error!r}")
