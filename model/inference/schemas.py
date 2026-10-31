"""Strict request validation for normalized baseline-feature deltas and coordinate frames."""

from typing import Annotated, List, Literal, Optional, TypedDict

from pydantic import BaseModel, ConfigDict, Field, model_validator


Phase = Literal["running", "rest", "away"]
DeviationType = Literal["none", "forward_slouch", "left_lean", "right_lean", "unspecified"]


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
    phase: Phase
    measurement_quality: Literal["good", "poor"]
    features: Optional[Features]

    @model_validator(mode="after")
    def interval(self):
        if not 0 < self.end_ms - self.start_ms <= 1500:
            raise ValueError("interval must be 1..1500ms")
        return self


class FeatureDeltas(BaseModel):
    """Signed shoulder-relative changes; neither angles nor trained probabilities."""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    head_gap_delta: float
    lateral_offset_delta: float
    shoulder_tilt_delta: float
    current_quality: float = Field(ge=0, le=1)
    baseline_quality: float = Field(ge=0, le=1)


class InferenceRequestV2(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    schema_version: Literal["2.0"]
    feature_version: Literal["shoulder-relative-deltas-v1"]
    # A calibration identifier, not a participant identifier. Keep it out of output.
    baseline_id: str = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )
    sequence: int = Field(ge=0)
    start_ms: int = Field(ge=0, le=86400000)
    end_ms: int = Field(gt=0, le=86400000)
    phase: Phase
    measurement_quality: Literal["good", "poor"]
    features: Optional[FeatureDeltas]

    @model_validator(mode="after")
    def interval(self):
        if not 0 < self.end_ms - self.start_ms <= 1500:
            raise ValueError("interval must be 1..1500ms")
        return self


Ratio = Annotated[float, Field(ge=0, le=1)]
Joint = Annotated[List[float], Field(min_length=3, max_length=3)]
BaselineJoint = Annotated[List[Ratio], Field(min_length=2, max_length=2)]


class Frame(BaseModel):
    """posture.frames.v1 frame as the API received it (plan 0084)."""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    t_ms: int = Field(ge=0, le=86400000)
    p: Optional[Annotated[List[Joint], Field(min_length=9, max_length=9)]]
    valid: Optional[Literal[False]] = None

    @model_validator(mode="after")
    def joints(self):
        for x, y, visibility in self.p or []:
            if not (-1 <= x <= 2 and -1 <= y <= 2 and 0 <= visibility <= 1):
                raise ValueError("joint out of range")
        return self


class InferenceRequestV3(BaseModel):
    """Frames of one interval the API received, with the session baseline (HTTP or Kafka body)."""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    schema_version: Literal["3.0"]
    feature_version: Literal["keypoints-9-v1"]
    baseline: Annotated[List[BaselineJoint], Field(min_length=9, max_length=9)]
    frames: Annotated[List[Frame], Field(min_length=1, max_length=240)]


class FrameResult(TypedDict):
    t_ms: int
    valid: bool
    collapse_probability: float
    deviation_type: DeviationType
    invalid_reason: Optional[Literal["unmeasurable", "head_turn"]]


class FrameObservation(TypedDict):
    schema_version: Literal["3.0"]
    model_version: str
    frames: List[FrameResult]


class Observation(TypedDict):
    schema_version: Literal["2.0"]
    sequence: int
    start_ms: int
    end_ms: int
    phase: Phase
    valid: bool
    collapse_probability: float
    deviation_type: DeviationType
    model_version: str
