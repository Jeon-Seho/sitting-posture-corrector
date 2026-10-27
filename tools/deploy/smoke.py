"""Synthetic HTTP checks against the real persistent service, without a camera."""

import copy
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


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.user_id = None

    def request(self, method, path, body=None, *, expected=200, csrf=True, identity=True, identity_override=None):
        headers = {"Content-Type": "application/json"}
        protected = path.startswith(("/v2/workspace", "/v2/records", "/v2/sessions", "/v2/baselines")) or path in (
            "/v2/auth/logout", "/v2/auth/password", "/v2/auth/account",
        )
        if protected and identity and (identity_override or self.user_id):
            headers["X-PoseGood-User-Id"] = identity_override or self.user_id
        if csrf and method not in ("GET", "HEAD"):
            token = self.request("GET", "/v2/auth/csrf")
            headers[token["header_name"]] = token["token"]
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
            if response.status == 204 and path in ("/v2/auth/logout", "/v2/auth/password", "/v2/auth/account"):
                self.user_id = None
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


def synthetic_setup(baseline_id):
    """Explicitly synthetic mean landmark coordinates for the schema V2.1 baseline."""
    point = {"x": 0.5, "y": 0.5}
    names = ("nose", "left_eye", "right_eye", "left_ear", "right_ear", "mouth_left", "mouth_right",
             "left_shoulder", "right_shoulder")
    return {
        "device": {"key": "synthetic-compose-device", "label": "synthetic camera"},
        "frame": {"width": 640, "height": 480},
        "baseline": {
            "baseline_id": baseline_id, "calibration_ms": 3000, "sample_count": 20,
            "landmarks": {name: dict(point) for name in names},
        },
    }


def exercise_accounts(base):
    checks = 0
    anonymous = Client(base)
    anonymous.request("GET", "/v2/auth/me", expected=401)
    anonymous.request("POST", "/v2/auth/login", {"email": "synthetic@example.invalid", "password": "wrong"}, expected=403, csrf=False)
    checks += 2
    owner = Client(base)
    credentials, account = register(owner, uuid.uuid4().hex)
    if owner.request("GET", "/v2/auth/me") != account:
        raise AssertionError("Cookie authentication did not preserve the registered account")
    checks += 2
    session_id = str(uuid.uuid4())
    registration = {
        "registration_id": str(uuid.uuid4()),  # issued once per capture, repeated on retries (ADR 0028)
            "calibration_ms": 3000, "sample_count": 20,
        "landmarks": synthetic_setup(None)["baseline"]["landmarks"],
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
    feature = json.loads((ROOT / "contracts/examples/v2/synthetic-feature-request.json").read_text())
    feature["baseline_id"] = baseline_id
    for sequence in range(3):
        feature.update(sequence=sequence, start_ms=sequence * 1000, end_ms=(sequence + 1) * 1000)
        reply = owner.request("POST", "/v2/sessions/" + session_id + "/features", feature)
    view = reply["session"]
    if view["summary"]["collapse_count"] != 1 or view["summary"]["valid_ms"] != 3000:
        raise AssertionError("Actual inference and the API decision engine did not confirm the synthetic 3-second deviation")
    repeated = owner.request("POST", "/v2/sessions/" + session_id + "/features", feature)
    if repeated != reply:
        raise AssertionError("Exact feature retry did not preserve the original committed result")
    ended = owner.request("POST", "/v2/sessions/" + session_id + "/end", {"end_ms": 3000})
    if not ended["ended"] or ended["summary"]["valid_ms"] != 3000:
        raise AssertionError("Termination did not retain acknowledged valid time")
    checks += 4
    other = Client(base)
    register(other, uuid.uuid4().hex)
    other.request("GET", "/v2/sessions/" + session_id, expected=404)
    checks += 1
    return {"owner": owner, "other": other, "credentials": credentials, "account": account,
            "session_id": session_id, "feature": copy.deepcopy(feature), "reply": reply, "checks": checks}


def verify_restart_and_finish(base, state):
    """Schema V2.3 keeps logins and finished sessions, not live decision state (ADR 0020)."""
    owner = state["owner"]
    owner.request("POST", "/v2/auth/login", state["credentials"])
    if owner.request("GET", "/v2/auth/me")["user_id"] != state["account"]["user_id"]:
        raise AssertionError("Account identity was lost after service restart")
    metadata = owner.request("GET", "/v2/sessions/" + state["session_id"] + "/metadata")
    if metadata["ended_at"] is None or metadata["started_at"] is None:
        raise AssertionError("The finished session row was not kept across the restart")
    lost = owner.request("GET", "/v2/sessions/" + state["session_id"], expected=404)
    if lost["code"] != "SESSION_LOST":
        raise AssertionError("A session without live state must be reported as SESSION_LOST")
    owner.request("POST", "/v2/sessions/" + state["session_id"] + "/features", state["feature"], expected=404)
    return state["checks"] + 4
