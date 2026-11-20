"""Strict request validation for baseline-feature deltas and frame coordinates."""

from typing import Annotated, Literal, Optional, TypedDict

from pydantic import BaseModel, ConfigDict, Field, model_validator


Phase = Literal["running", "rest", "away"]
DeviationType = Literal["none", "forward_slouch", "left_lean", "right_lean", "unspecified"]
InvalidReason = Literal["unmeasurable", "head_turn"]


class FeatureDeltas(BaseModel):
    """Signed shoulder-relative changes; neither angles nor trained probabilities."""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    head_gap_delta: float
    lateral_offset_delta: float
    shoulder_tilt_delta: float
    current_quality: float = Field(ge=0, le=1)
    baseline_quality: float = Field(ge=0, le=1)


class BaselineInterval(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    # A calibration identifier, not a participant identifier. Keep it out of output.
    baseline_id: str = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )
    sequence: int = Field(ge=0)
    start_ms: int = Field(ge=0, le=86400000)
    end_ms: int = Field(gt=0, le=86400000)
    phase: Phase

    @model_validator(mode="after")
    def interval(self):
        if not 0 < self.end_ms - self.start_ms <= 1500:
            raise ValueError("interval must be 1..1500ms")
        return self


class FeatureDeltaRequest(BaselineInterval):
    """Rule-feature input shared with the Kafka path parity cases; not served over HTTP."""

    schema_version: Literal["2.0"]
    feature_version: Literal["shoulder-relative-deltas-v1"]
    measurement_quality: Literal["good", "poor"]
    features: Optional[FeatureDeltas]


FrameCoordinate = Annotated[float, Field(ge=-1, le=2)]
UnitValue = Annotated[float, Field(ge=0, le=1)]
# JSON arrays are parsed as lists. Accept them as fixed-size tuples while keeping
# strict numeric validation for each element of the tuple.
FramePoint = Annotated[tuple[FrameCoordinate, FrameCoordinate, UnitValue], Field(strict=False)]
BaselinePoint = Annotated[tuple[UnitValue, UnitValue], Field(strict=False)]
Frame = Annotated[list[FramePoint], Field(min_length=9, max_length=9)]


class InferenceRequest(BaselineInterval):
    """POST /infer: nine raw keypoints per frame and the registered baseline points."""

    schema_version: Literal["3.0"]
    feature_version: Literal["keypoints-9-v1"]
    frames: list[Optional[Frame]] = Field(max_length=30)
    baseline: list[BaselinePoint] = Field(min_length=9, max_length=9)


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


class InferenceObservation(Observation):
    invalid_reason: Optional[InvalidReason]
