"""Synthetic HTTP and `/v2/realtime` checks against the real persistent service, without a camera.

Measurement input goes over `/v2/realtime` only: the REST feature input (S2), metadata (S5) and session delete (S6)
were removed on 2026-10-28 (plan 0062). Records are deleted with R3 (D-75).
"""

import hashlib
import http.cookiejar
import json
import secrets
import re
import time
import urllib.error
import urllib.request
import uuid

from .secrets import ROOT
from realtime_client import RealtimeClient  # tools/ is on sys.path (tools/compose_smoke.py)

# Synthetic baseline joints (nose, eyes, ears, mouth corners, shoulders) in image ratios — as tools/service_smoke.py.
JOINTS = [[0.5, 0.4], [0.52, 0.37], [0.48, 0.37], [0.56, 0.38], [0.44, 0.38],
          [0.515, 0.45], [0.485, 0.45], [0.65, 0.62], [0.35, 0.62]]
JOINT_NAMES = ("nose", "left_eye", "right_eye", "left_ear", "right_ear", "mouth_left", "mouth_right",
               "left_shoulder", "right_shoulder")


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.user_id = None
        self.access_token = None  # JWT from register/login (ADR 0031); the refresh token stays in the cookie jar

    def request(self, method, path, body=None, *, expected=200, csrf=True, identity=True, identity_override=None):
        # `csrf` is accepted for old callers; the token login has no CSRF step.
        headers = {"Content-Type": "application/json"}
        protected = path.startswith(("/v2/workspace", "/v2/records", "/v2/sessions", "/v2/baselines")) or path in (
            "/v2/auth/logout", "/v2/auth/password", "/v2/auth/account",
        )
        if protected and identity and (identity_override or self.user_id):
            headers["X-PoseGood-User-Id"] = identity_override or self.user_id
        if self.access_token:
            headers["Authorization"] = "Bearer " + self.access_token
        request = urllib.request.Request(
            self.base + path, method=method,
            data=None if body is None else json.dumps(body).encode(), headers=headers,
        )
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read()
            if response.status != expected:
                raise AssertionError(method + " " + path + " returned " + str(response.status) + ", expected " + str(expected))
            document = json.loads(payload) if payload else None
            if response.status == 200 and path in ("/v2/auth/register", "/v2/auth/login", "/v2/auth/me"):
                self.user_id = document["user_id"]
            if response.status == 200 and path in ("/v2/auth/register", "/v2/auth/login", "/v2/auth/refresh"):
                self.access_token = document["access_token"]
            if response.status == 204 and path in ("/v2/auth/logout", "/v2/auth/password", "/v2/auth/account"):
                self.user_id = None
                self.access_token = None
            return document


def verify_frontend(base):
    with urllib.request.urlopen(base + "/", timeout=10) as response:
        html = response.read().decode("utf-8")
    match = re.search(r'<script[^>]+src="([^"]+)"', html)
    if not match:
        raise AssertionError("Production frontend did not serve its compiled application entry")
    with urllib.request.urlopen(base + match.group(1), timeout=10) as response:
        javascript = response.read()
    if b"__POSEGOOD_SYNTHETIC_BROWSER_ONLY__" in javascript:
        raise AssertionError("Synthetic browser controls appeared in the production application")
    asset = json.loads((ROOT / "frontend/model-asset.json").read_text())
    with urllib.request.urlopen(base + "/mediapipe/" + asset["filename"], timeout=20) as response:
        if hashlib.sha256(response.read()).hexdigest() != asset["sha256"]:
            raise AssertionError("Container frontend served an unverified MediaPipe model asset")
    return 2


def register(client, tag):
    credentials = {
        "email": "synthetic-compose-" + tag + "@example.invalid",
        "password": secrets.token_urlsafe(24),
    }
    view = client.request("POST", "/v2/auth/register", {
        **credentials, "consents": [{"type": t, "document_version": "service-v2"} for t in ("TERMS", "ACCOUNT_INFO", "POSE_COORDINATES", "MEASUREMENT_RECORD", "AGE_14_OVER", "OPTIONAL_PROFILE")],
        "profile": {"name": "명시적 합성 Compose", "age": 30, "occupation": "synthetic regression"},
    })
    if not view.get("user_id") or view["email"] != credentials["email"]:
        raise AssertionError("Registration did not return a server-owned account identity")
    return credentials, view


def wait_health(base, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(base + "/health", timeout=3) as response:
                if response.status == 200 and json.load(response)["storage"] == "mysql":
                    return
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(0.5)
    raise TimeoutError("Persistent API health did not recover within its deadline")


def feed(socket, sequence, start, end, shift=0.0):
    """0.5 s coordinate intervals in [start, end) (realtime-ws.v2 frames); the head moved sideways by `shift`."""
    while start < end:
        frames = [{"t_ms": t, "p": [[x + (shift if i < 7 else 0.0), y, 0.95] for i, (x, y) in enumerate(JOINTS)]}
                  for t in range(start, start + 500, 125)]
        socket.send({"type": "features", "items": [{
            "schema_version": "3.0", "feature_version": "keypoints-9-v1", "sequence": sequence,
            "start_ms": start, "end_ms": start + 500, "phase": "running", "frames": frames,
        }]})
        sequence += 1
        start += 500
    while socket.next("ack")["last_sequence"] != sequence - 1:
        pass
    return sequence


def exercise_accounts(base):
    checks = 0
    anonymous = Client(base)
    anonymous.request("GET", "/v2/auth/me", expected=401)
    anonymous.request("POST", "/v2/auth/login", {"email": "synthetic@example.invalid", "password": "wrong"}, expected=403, csrf=False)
    checks += 2
    owner = Client(base)
    credentials, account = register(owner, uuid.uuid4().hex)
    me = owner.request("GET", "/v2/auth/me")
    if any(me[key] != account[key] for key in ("user_id", "email", "profile")):
        raise AssertionError("Token authentication did not preserve the registered account")
    checks += 2
    session_id = str(uuid.uuid4())
    registration = {
        "registration_id": str(uuid.uuid4()),  # issued once per capture, repeated on retries (ADR 0028)
            "calibration_ms": 3000, "sample_count": 20,
        "landmarks": {name: {"x": x, "y": y} for name, (x, y) in zip(JOINT_NAMES, JOINTS)},
    }
    baseline_id = owner.request("POST", "/v2/baselines", registration)["baseline_id"]
    created = owner.request("PUT", "/v2/sessions/" + session_id, {
        "policy": {"hold_ms": 3000, "recovery_ms": 3000, "reminder_ms": 60000, "threshold": 0.7},
        "baseline_id": baseline_id,
    })
    if created["session_id"] != session_id:
        raise AssertionError("Persistent session identity does not match its requested UUID")
    owner.request("GET", "/v2/sessions/" + session_id, expected=409, identity=False)
    owner.request("GET", "/v2/sessions/" + session_id, expected=409, identity_override=str(uuid.uuid4()))
    checks += 2
    # Measurement through the frontend NGINX (/api/v2/realtime), real inference and the API decision engine:
    # 3 s leaning → confirmed at 3 s, 3 s upright → recovered at 6 s (tools/service_smoke.py uses the same coordinates).
    socket = RealtimeClient(base)
    try:
        socket.send({"type": "hello", "schema_version": "2.0", "purpose": "measure", "session_id": session_id,
                     "access_token": owner.access_token})
        if socket.next("ready")["session_id"] != session_id:
            raise AssertionError("The realtime channel opened a different session")
        sequence = feed(socket, 0, 0, 3000, shift=0.09)
        feed(socket, sequence, 3000, 6000)
        view = owner.request("GET", "/v2/sessions/" + session_id)
        if [event["kind"] for event in view["events"]] != ["collapse_confirmed", "recovery_confirmed"]:
            raise AssertionError("Actual inference and the API decision engine did not confirm and recover the synthetic deviation")
        socket.send({"type": "end", "end_ms": 6000})
        socket.next("decision", "session_ended")
        if socket.next("closed")["reason"] != "ended":
            raise AssertionError("Ending over the realtime channel did not close it as ended")
    finally:
        socket.close()
    ended = owner.request("GET", "/v2/sessions/" + session_id)
    if not ended["ended"] or ended["summary"]["valid_ms"] != 6000:
        raise AssertionError("Termination did not retain acknowledged valid time")
    if owner.request("POST", "/v2/sessions/" + session_id + "/end", {"end_ms": 6000}) != ended:
        raise AssertionError("S3 with the same end did not return the stored session unchanged")
    owner.request("POST", "/v2/sessions/" + session_id + "/end", {"end_ms": 6500}, expected=409)
    checks += 4
    other = Client(base)
    register(other, uuid.uuid4().hex)
    other.request("GET", "/v2/sessions/" + session_id, expected=404)
    checks += 1
    return {"owner": owner, "other": other, "credentials": credentials, "account": account,
            "session_id": session_id, "checks": checks}


def verify_restart_and_finish(base, state):
    """Schema V2.3 keeps logins and finished sessions, not live decision state (ADR 0020)."""
    owner = state["owner"]
    owner.request("POST", "/v2/auth/login", state["credentials"])
    if owner.request("GET", "/v2/auth/me")["user_id"] != state["account"]["user_id"]:
        raise AssertionError("Account identity was lost after service restart")
    records = owner.request("GET", "/v2/records")["records"]
    if state["session_id"] not in [record["id"] for record in records]:
        raise AssertionError("The finished session row was not kept across the restart")
    lost = owner.request("GET", "/v2/sessions/" + state["session_id"], expected=404)
    if lost["code"] != "SESSION_LOST":
        raise AssertionError("A session without live state must be reported as SESSION_LOST")
    owner.request("DELETE", "/v2/records/" + state["session_id"], expected=204)
    if state["session_id"] in [record["id"] for record in owner.request("GET", "/v2/records")["records"]]:
        raise AssertionError("Deleting the record (R3) left the stored session in the list")
    return state["checks"] + 4
