"""Stateless baseline-feature adapter. Scores are not calibrated probabilities.

Only authorized normalized deltas belong here. No temporal/event rules, training,
video/landmarks, persistent storage, external calls or logs of request bodies.
"""
from typing import Literal, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Features(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    forward_delta: float = Field(ge=-1, le=1)
    lateral_delta: float = Field(ge=-1, le=1)


class InferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    schema_version: Literal["1.0"]
    sequence: int = Field(ge=0)
    start_ms: int = Field(ge=0, le=86400000)
    end_ms: int = Field(gt=0, le=86400000)
    phase: Literal["running", "rest", "away"]
    measurement_quality: Literal["good", "poor"]
    features: Optional[Features]

    @model_validator(mode="after")
    def interval(self):
        if not 0 < self.end_ms - self.start_ms <= 1500:
            raise ValueError("interval must be 1..1500ms")
        return self


app = FastAPI(title="PoseGood development inference", version="0.1.0")


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    # Do not reflect feature values (including NaN) in errors.
    return JSONResponse(status_code=422, content={"error": "invalid_contract"})


@app.get("/health")
def health():
    return {"status": "ok", "model_version": "baseline-feature-rule-v1", "learned": False}


@app.post("/v1/infer")
def infer(request: InferenceRequest):
    valid = request.phase == "running" and request.measurement_quality == "good" and request.features is not None
    probability, kind = 0.0, "none"
    if valid:
        forward, lateral = abs(request.features.forward_delta), abs(request.features.lateral_delta)
        probability = max(forward, lateral)
        if probability > 0:
            kind = "forward_slouch" if forward >= lateral else ("left_lean" if request.features.lateral_delta < 0 else "right_lean")
    return {
        "schema_version": "2.0", "sequence": request.sequence,
        "start_ms": request.start_ms, "end_ms": request.end_ms, "phase": request.phase,
        "valid": valid, "collapse_probability": probability, "deviation_type": kind,
        "model_version": "baseline-feature-rule-v1",
    }
