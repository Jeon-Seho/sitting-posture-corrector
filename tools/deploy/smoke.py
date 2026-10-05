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
        protected = path.startswith(("/v1/workspace", "/v1/records", "/v1/sessions")) or path in (
            "/v1/auth/logout", "/v1/auth/password", "/v1/auth/account",
        )
        if protected and identity and (identity_override or self.user_id):
            headers["X-PoseGood-User-Id"] = identity_override or self.user_id
        if csrf and method not in ("GET", "HEAD"):
            token = self.request("GET", "/v1/auth/csrf")
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
            if response.status == 200 and path in ("/v1/auth/register", "/v1/auth/login", "/v1/auth/me"):
                self.user_id = document["user_id"]
            if response.status == 204 and path in ("/v1/auth/logout", "/v1/auth/password", "/v1/auth/account"):
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
    view = client.request("POST", "/v1/auth/register", {
        **credentials, "consent_version": "service-v1",
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


def exercise_accounts(base):
    checks = 0
    anonymous = Client(base)
    anonymous.request("GET", "/v1/auth/me", expected=401)
    anonymous.request("POST", "/v1/auth/login", {"email": "synthetic@example.invalid", "password": "wrong"}, expected=403, csrf=False)
    checks += 2
    owner = Client(base)
    credentials, account = register(owner, uuid.uuid4().hex)
    if owner.request("GET", "/v1/auth/me") != account:
        raise AssertionError("Cookie authentication did not preserve the registered account")
    checks += 2
    session_id = str(uuid.uuid4())
    created = owner.request("PUT", "/v1/sessions/" + session_id, {
        "policy": {"hold_ms": 3000, "recovery_ms": 2000, "reminder_ms": 60000, "threshold": 0.7},
    })
    if created["session_id"] != session_id:
        raise AssertionError("Persistent session identity does not match its requested UUID")
    owner.request("GET", "/v1/sessions/" + session_id, expected=409, identity=False)
    owner.request("GET", "/v1/sessions/" + session_id, expected=409, identity_override=str(uuid.uuid4()))
    checks += 2
    feature = json.loads((ROOT / "contracts/examples/v2/synthetic-feature-request.json").read_text())
    feature["baseline_id"] = str(uuid.uuid4())
    for sequence in range(3):
        feature.update(sequence=sequence, start_ms=sequence * 1000, end_ms=(sequence + 1) * 1000)
        reply = owner.request("POST", "/v1/sessions/" + session_id + "/features", feature)
    view = reply["session"]
    if view["summary"]["collapse_count"] != 1 or view["summary"]["valid_ms"] != 3000:
        raise AssertionError("Actual inference/CEP did not confirm the synthetic 3-second deviation")
    repeated = owner.request("POST", "/v1/sessions/" + session_id + "/features", feature)
    if repeated != reply:
        raise AssertionError("Exact feature retry did not preserve the original committed result")
    checks += 3
    other = Client(base)
    register(other, uuid.uuid4().hex)
    other.request("GET", "/v1/sessions/" + session_id, expected=404)
    checks += 1
    return {"owner": owner, "other": other, "credentials": credentials, "account": account,
            "session_id": session_id, "feature": copy.deepcopy(feature), "reply": reply, "checks": checks}


def verify_restart_and_finish(base, state):
    owner = state["owner"]
    owner.request("POST", "/v1/auth/login", state["credentials"])
    if owner.request("GET", "/v1/auth/me")["user_id"] != state["account"]["user_id"]:
        raise AssertionError("Account identity was lost after service restart")
    view = owner.request("GET", "/v1/sessions/" + state["session_id"])
    if view != state["reply"]["session"]:
        raise AssertionError("Committed events/statistics changed after API/CEP restart")
    retry = owner.request("POST", "/v1/sessions/" + state["session_id"] + "/features", state["feature"])
    if retry != state["reply"]:
        raise AssertionError("Persisted feature retry lost its original inference output")
    ended = owner.request("POST", "/v1/sessions/" + state["session_id"] + "/end", {"end_ms": 3000})
    if not ended["ended"] or ended["summary"]["valid_ms"] != 3000:
        raise AssertionError("Persistent termination did not retain acknowledged valid time")
    return state["checks"] + 4
