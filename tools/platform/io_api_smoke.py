#!/usr/bin/env python3
"""입출구 서버(팀 backend/api, D-48) REST 점검 — 서버 PC에 띄운 io-api 컨테이너를 실제 DB(V2.6)로 확인한다.

통합 테스트 10단계(tools/platform/integration_test.sh)가 부른다. 혼자 실행해도 된다.
    python3 tools/platform/io_api_smoke.py --base http://127.0.0.1:8090

API 명세: 저장소 docs/design/api-spec.md. 앱은 /api 접두사를 붙이지만 io-api 컨테이너에는 접두사 없이 보낸다.
로그인은 access·refresh 토큰(ADR 0031, D-69): 보호 요청은 Authorization: Bearer, 로그인 유지는 쿠키 posegood_refresh(A8).
합성 시험 계정(test-it-<임의값>@example.invalid, DB 회신 DB-6의 시험 계정 형식)과 합성 구간만 쓴다.
끝에서 세션을 지우고 계정을 탈퇴 접수한다(CLOSED). 계정 행의 최종 삭제는 Spark J3(30일 뒤)가 한다.
표준 라이브러리만 쓴다(서버 PC에 jsonschema·requests가 없어도 된다).
"""

import argparse
import json
import re
import sys
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

# 새 계정의 기본 정책(DB 시드 DEFAULT_TEMP — threshold 0.7, 3초·3초·60초). 세션 생성 정책은 계정 현재 정책과 같아야 한다.
POLICY = {"hold_ms": 3000, "recovery_ms": 3000, "reminder_ms": 60000, "threshold": 0.7}
PASSWORD = "synthetic-password-1"
CONSENTS = ("TERMS", "ACCOUNT_INFO", "POSE_COORDINATES", "MEASUREMENT_RECORD", "AGE_14_OVER", "OPTIONAL_PROFILE")
LANDMARKS = {
    "nose": {"x": 0.5, "y": 0.4}, "left_eye": {"x": 0.52, "y": 0.37},
    "right_eye": {"x": 0.48, "y": 0.37}, "left_ear": {"x": 0.56, "y": 0.38},
    "right_ear": {"x": 0.44, "y": 0.38}, "mouth_left": {"x": 0.515, "y": 0.45},
    "mouth_right": {"x": 0.485, "y": 0.45}, "left_shoulder": {"x": 0.65, "y": 0.62},
    "right_shoulder": {"x": 0.35, "y": 0.62},
}

REFRESH_COOKIE = "posegood_refresh"
# (D-43) 터널 경유(Cloudflare)에서는 파이썬 기본 User-Agent(Python-urllib)가 봇으로 막힌다(403) — 이름을 밝힌 값을 쓴다
USER_AGENT = "PoseGood-IntegrationTest/1.0 (+tools/platform)"

PASSED = 0
FAILED = 0


def ok(name):
    global PASSED
    PASSED += 1
    print(f"PASS  {name}", flush=True)


def bad(name, detail=""):
    global FAILED
    FAILED += 1
    print(f"FAIL  {name}" + (f" — {detail}" if detail else ""), flush=True)


class Client:
    """앱처럼: access 토큰(Authorization: Bearer), 로그인 유지 쿠키(posegood_refresh), 계정 확인 헤더(X-PoseGood-User-Id).

    쿠키는 직접 다룬다 — 서버가 Secure 쿠키를 주어도(POSEGOOD_COOKIE_SECURE=true) http 시험 주소로 보낼 수 있게.
    """

    def __init__(self, base):
        self.base = base.rstrip("/")
        self.opener = build_opener()
        self.access_token = None
        self.refresh_cookie = None
        self.cookie_attributes = ""
        self.user_id = None

    def call(self, path, method="GET", body=None):
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        if self.access_token:
            headers["Authorization"] = "Bearer " + self.access_token
        if self.user_id:
            headers["X-PoseGood-User-Id"] = self.user_id
        if self.refresh_cookie:
            headers["Cookie"] = f"{REFRESH_COOKIE}={self.refresh_cookie}"
        data = None if body is None else json.dumps(body, allow_nan=False).encode()
        try:
            with self.opener.open(Request(self.base + path, data=data, method=method, headers=headers),
                                  timeout=15) as response:
                status, raw, received = response.status, response.read(), response.headers
        except HTTPError as error:
            status, raw, received = error.code, error.read(), error.headers
        self._remember(received.get_all("Set-Cookie") or [])
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = raw[:200]
        return status, payload

    def _remember(self, set_cookies):
        for header in set_cookies:
            first, _, attributes = header.partition(";")
            name, _, value = first.strip().partition("=")
            if name != REFRESH_COOKIE:
                continue
            gone = not value or re.search(r"max-age=0(?:;|$)", attributes.replace(" ", "").lower())
            self.refresh_cookie = None if gone else value
            self.cookie_attributes = attributes.lower()

    def sign_in(self, body):
        """A2·A3·A8 응답의 토큰을 쓴다."""
        self.access_token = body["access_token"]
        self.user_id = body["user_id"]


def signed_in(client):
    """가입·로그인 응답 검사: 사용자, access 토큰(Bearer, 남은 초), HttpOnly 로그인 유지 쿠키."""
    def check(body):
        if not body.get("user_id"):
            return "user_id 없음"
        if not body.get("access_token") or body.get("token_type") != "Bearer" or not body.get("expires_in", 0) > 0:
            return f"토큰 형식 다름(token_type={body.get('token_type')}, expires_in={body.get('expires_in')})"
        if not client.refresh_cookie or "httponly" not in client.cookie_attributes:
            return f"로그인 유지 쿠키 {REFRESH_COOKIE}(HttpOnly) 없음"
        return None
    return check


def expect(name, result, status, check=None):
    """응답 상태(와 선택 검사)가 맞으면 PASS. 본문을 돌려준다."""
    got, body = result
    if got != status:
        code = body.get("code") if isinstance(body, dict) else None
        bad(name, f"HTTP {got}{' ' + code if code else ''} (기대 {status})")
        return None
    if check is not None:
        try:
            detail = check(body)
        except (KeyError, TypeError, IndexError) as error:
            detail = f"응답 형식 다름: {error!r}"
        if detail:
            bad(name, detail)
            return None
    ok(name)
    return body


def interval(baseline, sequence, start, end, head):
    """특징 입력 v2 구간 하나(S2, 지금 코드 기준 — /v2/realtime 전환 때 바뀐다)."""
    return {
        "schema_version": "2.0", "feature_version": "shoulder-relative-deltas-v1",
        "baseline_id": baseline, "sequence": sequence, "start_ms": start, "end_ms": end,
        "phase": "running", "measurement_quality": "good",
        "features": {"head_gap_delta": head, "lateral_offset_delta": 0.0, "shoulder_tilt_delta": 0.0,
                     "current_quality": 0.9, "baseline_quality": 0.9},
    }


def scenario(base):
    owner = Client(base)
    expect("H1 GET /health (DB 연결)", owner.call("/health"), 200,
           lambda b: None if b.get("status") == "ok" else f"status={b.get('status')}")

    # --- 계정 (A2·A3·A4·A8, 토큰 로그인 ADR 0031) ---
    email = f"test-it-{uuid.uuid4().hex[:12]}@example.invalid"
    user = expect("A2 가입 → access 토큰·로그인 유지 쿠키 (합성 시험 계정)", owner.call("/v2/auth/register", "POST", {
        "email": email, "password": PASSWORD,
        "profile": {"name": "합성 사용자", "age": 30, "occupation": "합성 시험"},
        "consents": [{"type": t, "document_version": "service-v2"} for t in CONSENTS],
    }), 200, signed_in(owner))
    if user is None:
        return
    owner.sign_in(user)
    secure = "secure" in [a.strip() for a in owner.cookie_attributes.split(";")]
    print(f"  참고: 로그인 유지 쿠키 Secure={'예' if secure else '아니요'} (POSEGOOD_COOKIE_SECURE)", flush=True)
    expect("A4 GET /v2/auth/me (Bearer)", owner.call("/v2/auth/me"), 200,
           lambda b: None if b["user_id"] == owner.user_id else "다른 계정")
    expect("토큰 없는 요청은 401", Client(base).call("/v2/auth/me"), 401)

    device = Client(base)  # 다른 기기: A3 로그인 → 아래에서 A5 로그아웃
    signed = expect("A3 로그인 (다른 기기)", device.call("/v2/auth/login", "POST", {"email": email, "password": PASSWORD}),
                    200, signed_in(device))
    if signed is not None:
        device.sign_in(signed)

    old_cookie = owner.refresh_cookie
    refreshed = expect("A8 POST /v2/auth/refresh → 새 access 토큰, 쿠키 교체", owner.call("/v2/auth/refresh", "POST"), 200,
                       lambda b: None if b.get("access_token") and b.get("user_id") == owner.user_id
                       and owner.refresh_cookie and owner.refresh_cookie != old_cookie else "토큰·쿠키가 바뀌지 않음")
    if refreshed is not None:
        owner.sign_in(refreshed)
        expect("A8 새 토큰으로 A4", owner.call("/v2/auth/me"), 200)
    expect("A8 쿠키 없이는 401", Client(base).call("/v2/auth/refresh", "POST"), 401)

    # --- 설정·기준 자세 (W1, B1, B2) ---
    expect("W1 GET /v2/workspace", owner.call("/v2/workspace"), 200)
    saved = expect("B1 기준 자세 등록 (관절 9개 평균 좌표)", owner.call("/v2/baselines", "POST", {
        "registration_id": str(uuid.uuid4()),  # issued once per capture, repeated on retries (ADR 0028)
        "calibration_ms": 3000, "sample_count": 20, "landmarks": LANDMARKS,
    }), 200, lambda b: None if b.get("baseline_id") else "baseline_id 없음")
    if saved is None:
        return
    baseline = saved["baseline_id"]
    expect("B2 현재 기준 자세 조회", owner.call("/v2/baselines/current"), 200,
           lambda b: None if b["baseline_id"] == baseline else "등록한 기준과 다름")

    # --- 세션 (S1~S6) ---
    sid = str(uuid.uuid4())
    path = "/v2/sessions/" + sid
    expect("S1 세션 생성 (200 SessionView)", owner.call(path, "PUT", {"policy": POLICY, "baseline_id": baseline}),
           200, lambda b: None if b["last_sequence"] == -1 and not b["ended"] else "새 세션 상태 아님")
    expect("S1 같은 요청 재시도는 멱등", owner.call(path, "PUT", {"policy": POLICY, "baseline_id": baseline}), 200)

    # 추론 연결(io-api → inference 컨테이너 /v2/infer)과 판정: 이탈 3초 → 확정, 정상 3초 → 회복
    seq, last = 0, None
    for start in range(0, 6000, 1000):
        head = 0.3 if start < 3000 else 0.0
        last = owner.call(path + "/features", "POST", interval(baseline, seq, start, start + 1000, head))
        if last[0] != 200:
            break
        seq += 1
    expect("S2 구간 입력 6개 → 추론 → 판정 (확정·회복)", last, 200, lambda b: (
        None if [e["kind"] for e in b["session"]["events"]] == ["collapse_confirmed", "recovery_confirmed"]
        else f"사건={[e['kind'] for e in b['session']['events']]}"))

    expect("S3 세션 종료 (200 SessionView)", owner.call(path + "/end", "POST", {"end_ms": 6000}), 200, lambda b: (
        None if b["ended"] and b["summary"]["total_ms"] == 6000 and b["events"][-1]["kind"] == "session_ended"
        else f"ended={b.get('ended')} total={b['summary'].get('total_ms')}"))
    expect("S3 다른 end_ms 재요청은 409", owner.call(path + "/end", "POST", {"end_ms": 6500}), 409)
    expect("S4 세션 조회", owner.call(path), 200, lambda b: None if b["ended"] else "종료 안 됨")
    expect("S5 세션 메타데이터", owner.call(path + "/metadata"), 200)
    expect("R1 기록 목록 {today, records}에 방금 세션", owner.call("/v2/records"), 200,
           lambda b: None if re.fullmatch(r"\d{4}-\d{2}-\d{2}", b["today"]) and sid in [r.get("id") for r in b["records"]]
           else f"today={b.get('today')} / 목록에 없음")
    expect("S6 세션 삭제 (204)", owner.call(path, "DELETE"), 204)
    expect("S6 삭제 뒤 조회는 404", owner.call(path), 404)

    # --- 로그아웃 (A5): 이 기기의 로그인 유지만 끊는다 ---
    if signed is not None:
        revoked = device.refresh_cookie
        expect("A5 로그아웃 (204, 쿠키 지움)", device.call("/v2/auth/logout", "POST"), 204,
               lambda _: None if device.refresh_cookie is None else "쿠키가 남음")
        device.refresh_cookie = revoked
        expect("A5 로그아웃한 쿠키로 A8은 401", device.call("/v2/auth/refresh", "POST"), 401)

    # --- 탈퇴 접수 (A7, 철회 없음 — 최종 삭제는 J3) ---
    expect("A7 탈퇴 접수 (204)", owner.call("/v2/auth/account", "DELETE", {"password": PASSWORD}), 204)
    expect("탈퇴 뒤 남은 access 토큰도 401", owner.call("/v2/auth/me"), 401)
    again = Client(base)
    expect("탈퇴한 계정 로그인은 403 ACCOUNT_CLOSED",
           again.call("/v2/auth/login", "POST", {"email": email, "password": PASSWORD}), 403,
           lambda b: None if b.get("code") == "ACCOUNT_CLOSED" else f"code={b.get('code')}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://127.0.0.1:8090", help="io-api 주소 (기본 %(default)s)")
    args = parser.parse_args()
    try:
        scenario(args.base)
    except (RuntimeError, URLError, OSError) as error:
        bad("입출구 서버 접속", repr(error))
    print(f"io-api REST: PASS {PASSED} / FAIL {FAILED}", flush=True)
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
