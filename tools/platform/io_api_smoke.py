#!/usr/bin/env python3
"""입출구 서버(팀 backend/api, D-48) REST 점검 — 서버 PC에 띄운 io-api 컨테이너를 실제 DB(V2.3)로 확인한다.

통합 테스트 10단계(tools/platform/integration_test.sh)가 부른다. 혼자 실행해도 된다.
    python3 tools/platform/io_api_smoke.py --base http://127.0.0.1:8090

API 명세: DB/BE 「PoseGood API 명세서」(dc2de48). 앱은 /api 접두사를 붙이지만 io-api 컨테이너에는 접두사 없이 보낸다.
합성 시험 계정(test-it-<임의값>@example.invalid, DB 회신 DB-6의 시험 계정 형식)과 합성 구간만 쓴다.
끝에서 세션을 지우고 계정을 탈퇴 접수한다(CLOSED). 계정 행의 최종 삭제는 Spark J3(30일 뒤)가 한다.
표준 라이브러리만 쓴다(서버 PC에 jsonschema·requests가 없어도 된다).
"""

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

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
    """브라우저처럼: 로그인 쿠키, CSRF 헤더, 계정 확인 헤더(X-PoseGood-User-Id)."""

    def __init__(self, base):
        self.base = base.rstrip("/")
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))
        self.csrf = None
        self.user_id = None

    def call(self, path, method="GET", body=None):
        headers = {"Content-Type": "application/json"}
        if self.csrf and method != "GET":
            headers["X-CSRF-TOKEN"] = self.csrf
        if self.user_id:
            headers["X-PoseGood-User-Id"] = self.user_id
        data = None if body is None else json.dumps(body, allow_nan=False).encode()
        try:
            with self.opener.open(Request(self.base + path, data=data, method=method, headers=headers),
                                  timeout=15) as response:
                status, raw = response.status, response.read()
        except HTTPError as error:
            status, raw = error.code, error.read()
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = raw[:200]
        return status, payload

    def refresh_csrf(self):
        status, body = self.call("/v2/auth/csrf")
        if status != 200 or not isinstance(body, dict) or "token" not in body:
            raise RuntimeError(f"CSRF 토큰을 받지 못함 (HTTP {status})")
        self.csrf = body["token"]


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

    # --- 계정 (A1~A4) ---
    owner.refresh_csrf()
    email = f"test-it-{uuid.uuid4().hex[:12]}@example.invalid"
    user = expect("A2 가입 (합성 시험 계정)", owner.call("/v2/auth/register", "POST", {
        "email": email, "password": PASSWORD,
        "profile": {"name": "합성 사용자", "age": 30, "occupation": "합성 시험"},
        "consents": [{"type": t, "document_version": "service-v2"} for t in CONSENTS],
    }), 200, lambda b: None if b.get("user_id") else "user_id 없음")
    if user is None:
        return
    owner.user_id = user["user_id"]
    owner.refresh_csrf()
    expect("A4 GET /v2/auth/me", owner.call("/v2/auth/me"), 200,
           lambda b: None if b["user_id"] == owner.user_id else "다른 계정")
    expect("인증 없는 요청은 401", Client(base).call("/v2/auth/me"), 401)

    # --- 설정·기준 자세 (W1, B1, B2) ---
    expect("W1 GET /v2/workspace", owner.call("/v2/workspace"), 200)
    saved = expect("B1 기준 자세 등록 (관절 9개 평균 좌표)", owner.call("/v2/baselines", "POST", {
        "registered_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
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
    expect("R1 기록 목록에 방금 세션", owner.call("/v2/records"), 200,
           lambda b: None if sid in [r.get("id") for r in b] else "목록에 없음")
    expect("S6 세션 삭제 (204)", owner.call(path, "DELETE"), 204)
    expect("S6 삭제 뒤 조회는 404", owner.call(path), 404)

    # --- 탈퇴 접수 (A7, 철회 없음 — 최종 삭제는 J3) ---
    expect("A7 탈퇴 접수 (204)", owner.call("/v2/auth/account", "DELETE", {"password": PASSWORD}), 204)
    again = Client(base)
    again.refresh_csrf()
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
