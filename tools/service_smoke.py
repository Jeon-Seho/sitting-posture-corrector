"""Verify the loopback API with the real FastAPI inference on a disposable schema V2.3 database.

Only explicit synthetic accounts and feature intervals are used; no camera or participant data.
Every response is checked against the versioned JSON Schemas in contracts/.
"""

import json
import sys
import uuid
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

if __package__:
    from .service_contract import validate_feature_response, validate_inference_request_v2, validate_view
    from .service_processes import ServiceEndpoints, running_services
    from .test_mysql import disposable_database, mysql_server, query
else:
    from service_contract import validate_feature_response, validate_inference_request_v2, validate_view
    from service_processes import ServiceEndpoints, running_services
    from test_mysql import disposable_database, mysql_server, query

POLICY = {"hold_ms": 3000, "recovery_ms": 3000, "reminder_ms": 60000, "threshold": 0.7}


class Account:
    """A browser-like client: cookie login, CSRF header and the stale-tab user header."""

    def __init__(self, base):
        self.base = base
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        self.csrf = None
        self.user_id = None

    def headers(self, method="GET"):
        """Login headers for a client without this cookie jar (the server benchmark)."""
        headers = {}
        if self.csrf and method != "GET":
            headers["X-CSRF-TOKEN"] = self.csrf
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
        self.csrf = self.request("/v2/auth/csrf")["token"]
        user = self.request("/v2/auth/register", "POST", {
            "email": f"test-{uuid.uuid4()}@example.invalid",
            "password": "synthetic-password-1",
            "profile": {"name": "합성 사용자", "age": 30, "occupation": "합성 시험"},
            "consents": [{"type": t, "document_version": "service-v2"} for t in ("TERMS", "ACCOUNT_INFO", "POSE_COORDINATES", "MEASUREMENT_RECORD", "AGE_14_OVER", "OPTIONAL_PROFILE")],
        })
        self.user_id = user["user_id"]
        self.csrf = self.request("/v2/auth/csrf")["token"]
        return user


def register_baseline(account):
    """Register a synthetic 9-landmark baseline; sessions must name the account's current one."""
    from datetime import datetime, timezone
    saved = account.request("/v2/baselines", "POST", {
        "registered_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "calibration_ms": 3000, "sample_count": 20,
        "landmarks": {
            "nose": {"x": 0.5, "y": 0.4}, "left_eye": {"x": 0.52, "y": 0.37},
            "right_eye": {"x": 0.48, "y": 0.37}, "left_ear": {"x": 0.56, "y": 0.38},
            "right_ear": {"x": 0.44, "y": 0.38}, "mouth_left": {"x": 0.515, "y": 0.45},
            "mouth_right": {"x": 0.485, "y": 0.45}, "left_shoulder": {"x": 0.65, "y": 0.62},
            "right_shoulder": {"x": 0.35, "y": 0.62},
        },
    })
    return saved["baseline_id"]


class Measurement:
    """Ordered synthetic feature intervals through the API and the real inference service."""

    def __init__(self, account):
        self.account = account
        self.id = str(uuid.uuid4())
        self.baseline = str(uuid.uuid4())
        self.path = "/v2/sessions/" + self.id
        self.sequence = 0
        self.sent = []

    def create(self):
        self.baseline = register_baseline(self.account)
        view = self.account.request(self.path, "PUT", {"policy": POLICY, "baseline_id": self.baseline})
        validate_view(view)
        return view

    def interval(self, start, end, head=0.0, phase="running", quality="good"):
        return {
            "schema_version": "2.0", "feature_version": "shoulder-relative-deltas-v1",
            "baseline_id": self.baseline, "sequence": self.sequence, "start_ms": start, "end_ms": end,
            "phase": phase, "measurement_quality": quality,
            "features": None if phase != "running" or quality != "good" else {
                "head_gap_delta": head, "lateral_offset_delta": 0.0, "shoulder_tilt_delta": 0.0,
                "current_quality": 0.9, "baseline_quality": 0.9,
            },
        }

    def feed(self, start, end, **kind):
        result = None
        while start < end:
            body = self.interval(start, min(end, start + 1000), **kind)
            validate_inference_request_v2(body)
            result = self.account.request(self.path + "/features", "POST", body)
            validate_feature_response(result, body)
            self.sent.append(body)
            self.sequence += 1
            start = body["end_ms"]
        return result


def scenario(endpoints, database):
    owner = Account(endpoints.api)
    owner.register()
    stranger = Account(endpoints.api)
    stranger.register()
    anonymous = Account(endpoints.api)

    measurement = Measurement(owner)
    measurement.create()
    measurement.feed(0, 3000, head=0.3)
    collapsed = measurement.feed(3000, 6000, head=0.0)["session"]
    kinds = [event["kind"] for event in collapsed["events"]]
    assert kinds == ["collapse_confirmed", "recovery_confirmed"], kinds
    assert collapsed["events"][0]["timestamp_ms"] == 3000
    assert collapsed["events"][0]["deviation_type"] == "unspecified"
    print("PASS: real inference scores drive collapse at 3 s and recovery at 6 s", flush=True)

    measurement.feed(6000, 7000, phase="rest", quality="poor")
    measurement.feed(7000, 8000, quality="poor")
    retried = owner.request(measurement.path + "/features", "POST", measurement.sent[0])
    validate_feature_response(retried, measurement.sent[0])
    conflicting = dict(measurement.sent[0], features=dict(measurement.sent[0]["features"], head_gap_delta=0.01))
    owner.request(measurement.path + "/features", "POST", conflicting, expected=409)
    print("PASS: identical retry is idempotent; a changed duplicate is 409", flush=True)

    anonymous.request(measurement.path, expected=401)
    stranger.request(measurement.path, expected=404)
    print("PASS: missing login is 401; another account's session is 404", flush=True)

    ended = owner.request(measurement.path + "/end", "POST", {"end_ms": 9000})
    validate_view(ended)
    summary = ended["summary"]
    assert ended["ended"] and summary["total_ms"] == 9000, summary
    assert (summary["valid_ms"], summary["normal_ms"], summary["rest_ms"], summary["unknown_ms"],
            summary["missing_ms"]) == (6000, 3000, 1000, 1000, 1000), summary
    assert ended["events"][-1]["kind"] == "session_ended"
    owner.request(measurement.path + "/end", "POST", {"end_ms": 9500}, expected=409)

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
    print("PASS: schema V2.3 rows: baseline, session end, exclusions, episode and daily statistics", flush=True)

    records = owner.request("/v2/records")
    assert [record["id"] for record in records] == [measurement.id], records
    assert (records[0]["total"], records[0]["good"], records[0]["server"]["confirmed"]) == (9, 3, True), records[0]
    print("PASS: the record is rebuilt from the session tables", flush=True)

    owner.request(measurement.path, "DELETE", expected=204)
    owner.request(measurement.path, expected=404)
    assert query(database, "SELECT COUNT(*) FROM monitor_session WHERE client_session_uuid=%s",
                 measurement.id) == ((0,),)
    print("PASS: deleting a session removes its rows; daily statistics stay", flush=True)


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
