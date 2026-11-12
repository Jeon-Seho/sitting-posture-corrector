"""Loopback-only web interface for explicitly selected research artifacts."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import threading
import time
from typing import Literal, Optional
from urllib.parse import urlsplit

import joblib
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from model.analysis.live_comparison.engine import LiveComparison
from model.analysis.replay_pilot.replay import private_destination


ROOT = Path(__file__).resolve().parents[3]
WEB = Path(__file__).parent / "web"
FRONTEND = ROOT / "frontend"
ARTIFACTS = ("all-data-posture.joblib", "all-data-synthetic-vertical-corrector.joblib",
             "all-data-posture-after-correction.joblib")
SCENARIOS = {
    "baseline": "기준 자세",
    "chair_left": "의자 왼쪽 이동",
    "chair_right": "의자 오른쪽 이동",
    "head_left": "얼굴 왼쪽 이동",
    "head_right": "얼굴 오른쪽 이동",
    "head_down": "머리 앞으로 숙이기",
    "shoulder_left": "왼쪽 어깨 올리기",
    "shoulder_right": "오른쪽 어깨 올리기",
    "expression": "표정 바꾸기",
    "brief_change": "1초 숙였다가 복귀",
}


def load_artifacts(directory):
    """Only load locally trusted joblib files recorded in the experiment report."""
    directory = private_destination(directory)
    report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
    if report.get("schema_version") != "replay-two-stage-synthetic-translation-v1":
        raise ValueError("expected a two-stage pilot report")
    hashes = report["model_artifact_sha256"]
    for filename in ARTIFACTS:
        if hashlib.sha256((directory / filename).read_bytes()).hexdigest() != hashes.get(filename):
            raise ValueError("model artifact does not match report")
    threshold = report["all_data_candidate"]["threshold"]
    return *(joblib.load(directory / name) for name in ARTIFACTS), threshold


class Frame(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    session: str = Field(max_length=100)
    time_ms: float = Field(ge=0)
    width: int
    height: int
    landmarks: list[dict] = Field(max_length=33)


class PrivateRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


Feature = Literal["head_gap", "lateral_offset", "shoulder_tilt", "face_height",
                  "shoulder_height", "shoulder_width"]
Level = Literal["red", "yellow", "green", "unknown"]


class RuleFeature(PrivateRecord):
    feature: Feature
    value: float
    reference_range: Optional[float] = Field(ge=0)
    component_score: float = Field(ge=0, le=1)
    dominant: bool
    level: Level


class ModelFeature(PrivateRecord):
    feature: Feature
    value: float
    counterfactual_score: float = Field(ge=0, le=1)
    effect: float = Field(ge=-1, le=1)
    level: Level


class Explanation(PrivateRecord):
    schema_version: Literal["1.0"]
    rule: list[RuleFeature] = Field(min_length=3, max_length=3)
    model: Optional[list[ModelFeature]] = Field(min_length=6, max_length=6)


class DecisionSnapshot(PrivateRecord):
    raw_score: float = Field(ge=0, le=1)
    threshold: float = Field(ge=0, le=1)
    deviation: bool
    alert_count: int = Field(ge=0, le=100000)


class CaptureSnapshot(PrivateRecord):
    captured_at: datetime
    baseline_index: int = Field(ge=1, le=100000)
    rule: DecisionSnapshot
    model: DecisionSnapshot
    model_uncorrected_raw: float = Field(ge=0, le=1)
    correction_px: float
    explanation: Optional[Explanation] = None


class ScenarioRecord(PrivateRecord):
    id: Literal["baseline", "chair_left", "chair_right", "head_left", "head_right",
                "head_down", "shoulder_left", "shoulder_right", "expression", "brief_change"]
    source: Literal["automatic", "manual"]
    rule_score: Optional[float] = Field(default=None, ge=0, le=100)
    model_score: Optional[float] = Field(default=None, ge=0, le=100)
    snapshot: Optional[CaptureSnapshot] = None

    @model_validator(mode="after")
    def validate_record(self):
        if self.rule_score is None and self.model_score is None:
            raise ValueError("at least one score is required")
        if self.source == "manual" and self.snapshot is not None:
            raise ValueError("manual scores cannot include an automatic snapshot")
        if self.source == "automatic" and (self.snapshot is None or self.rule_score is None or self.model_score is None):
            raise ValueError("automatic records require both scores and a snapshot")
        return self


class ScenarioSave(PrivateRecord):
    records: list[ScenarioRecord] = Field(min_length=1, max_length=len(SCENARIOS))

    @model_validator(mode="after")
    def unique_scenarios(self):
        if len({row.id for row in self.records}) != len(self.records):
            raise ValueError("each scenario can appear only once")
        return self


def save_scenarios(directory, request):
    """Write only explicit score records; filenames are generated locally."""
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    saved_at = datetime.now(timezone.utc)
    name = f"scenario-{saved_at.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(4)}.json"
    path = directory / name
    records = request.model_dump(mode="json")["records"]
    for row in records:
        row["label"] = SCENARIOS[row["id"]]
    content = {"schema_version": "live-comparison-scenario-v1",
               "saved_at": saved_at.isoformat(), "records": records}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(content, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.write("\n")
    except (OSError, ValueError, TypeError):
        path.unlink(missing_ok=True)
        raise
    return {"filename": name, "directory": str(directory), "records": len(records)}


def create_app(uncorrected, corrector, corrected, threshold, *, scenario_dir=None):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    scenario_dir = Path(scenario_dir if scenario_dir is not None else ROOT / "model/test/senario").resolve()
    sessions = {}
    lock = threading.Lock()

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        host = request.headers.get("host", "")
        try:
            parsed = urlsplit("http://" + host)
            safe_host = parsed.hostname in ("127.0.0.1", "localhost") and not parsed.username and not parsed.password
            _ = parsed.port
        except ValueError:
            safe_host = False
        if not safe_host or "/" in host or "@" in host:
            return JSONResponse({"detail": "local host required"}, status_code=403)
        if request.method == "POST":
            if request.headers.get("origin") != "http://" + host:
                return JSONResponse({"detail": "local origin required"}, status_code=403)
            try:
                size = int(request.headers.get("content-length", "0"))
            except ValueError:
                size = -1
            if size < 0 or size > 32768:
                return JSONResponse({"detail": "invalid request size"}, status_code=413)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
            "style-src 'self'; connect-src 'self'; img-src 'self' data:; "
            "media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        return response

    def file_response(path, media_type=None):
        if not path.is_file():
            raise HTTPException(503, "필요한 로컬 자산이 없습니다. 실행 안내를 확인하세요.")
        return FileResponse(path, media_type=media_type)

    @app.get("/")
    def index():
        return file_response(WEB / "index.html", "text/html; charset=utf-8")

    @app.get("/app.js")
    def javascript():
        return file_response(WEB / "app.js", "text/javascript; charset=utf-8")

    @app.get("/style.css")
    def stylesheet():
        return file_response(WEB / "style.css", "text/css; charset=utf-8")

    @app.get("/vendor/vision.mjs")
    def vision_module():
        return file_response(FRONTEND / "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs", "text/javascript")

    @app.get("/mediapipe/pose_landmarker_heavy.task")
    def pose_model():
        return file_response(FRONTEND / "public/mediapipe/pose_landmarker_heavy.task", "application/octet-stream")

    @app.get("/mediapipe/wasm/{filename}")
    def wasm(filename: str):
        allowed = {"vision_wasm_internal.js", "vision_wasm_internal.wasm",
                   "vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm",
                   "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"}
        if filename not in allowed:
            raise HTTPException(404)
        return file_response(FRONTEND / "public/mediapipe/wasm" / filename,
                             "application/wasm" if filename.endswith(".wasm") else "text/javascript")

    @app.post("/api/session")
    def new_session():
        with lock:
            now = time.monotonic()
            for key in list(sessions):
                if now - sessions[key][1] > 1800:
                    del sessions[key]
            if len(sessions) >= 16:
                raise HTTPException(429, "too many sessions")
            key = secrets.token_urlsafe(24)
            sessions[key] = (LiveComparison(uncorrected, corrector, corrected, threshold), now)
        return {"session": key, "threshold": threshold}

    @app.post("/api/frame")
    def frame(data: Frame):
        with lock:
            saved = sessions.get(data.session)
            if saved is None or time.monotonic() - saved[1] > 1800:
                sessions.pop(data.session, None)
                raise HTTPException(404, "session expired")
            try:
                result = saved[0].observe(data.time_ms, data.landmarks, data.width, data.height)
            except (ValueError, TypeError, KeyError, IndexError):
                raise HTTPException(400, "invalid observation") from None
            sessions[data.session] = (saved[0], time.monotonic())
            return result

    @app.post("/api/end")
    def end(data: dict):
        key = data.get("session")
        with lock:
            if isinstance(key, str):
                sessions.pop(key, None)
        return {"ended": True}

    @app.post("/api/scenarios/save")
    def save_results(data: ScenarioSave):
        try:
            return save_scenarios(scenario_dir, data)
        except (OSError, ValueError, TypeError):
            raise HTTPException(500, "시나리오 파일을 저장하지 못했습니다.") from None

    return app


def main():
    parser = argparse.ArgumentParser(description="Run a local exploratory camera comparison")
    parser.add_argument("--artifacts-dir", required=True, help="trusted two-stage output directory outside Git")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--scenario-dir", default=str(ROOT / "model/test/senario"),
                        help="local directory for explicitly saved scenario results")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be in 1024..65535")
    try:
        artifacts = load_artifacts(args.artifacts_dir)
        app = create_app(*artifacts, scenario_dir=args.scenario_dir)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(2, f"Cannot load trusted model artifacts: {type(exc).__name__}\n")
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
