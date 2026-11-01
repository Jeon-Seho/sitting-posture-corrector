"""Stateless rule score; no temporal decisions, training or persistent storage.

Scores are not calibrated probabilities. Only normalized deltas belong here;
video, landmarks, request-body logs and external calls are outside this service.
"""

from typing import Tuple

from . import frames as frame_rules
from .schemas import (
    DeviationType, FeatureDeltas, Features, FrameObservation, FrameResult, InferenceRequest,
    InferenceRequestV2, InferenceRequestV3, Observation,
)


MODEL_VERSION = "baseline-feature-rule-v1"
REFERENCE_MODEL_VERSION = "reference-feature-rule-v1"

# Preserve the local referenceScore rule. These scales/quality limits are unvalidated.
MINIMUM_FEATURE_QUALITY = 0.65
HEAD_GAP_SCALE = 0.22
LATERAL_OFFSET_SCALE = 0.20
SHOULDER_TILT_SCALE = 0.03  # ADR 0020 (was 0.13)
REFERENCE_SCORE_SCALE = 0.7


def score_features(features: Features) -> Tuple[float, DeviationType]:
    forward_change = abs(features.forward_delta)
    lateral_change = abs(features.lateral_delta)
    score = max(forward_change, lateral_change)

    if score == 0:
        return score, "none"
    if forward_change >= lateral_change:
        return score, "forward_slouch"
    if features.lateral_delta < 0:
        return score, "left_lean"
    return score, "right_lean"


def predict_observation(request: InferenceRequest) -> Observation:
    valid = (
        request.phase == "running"
        and request.measurement_quality == "good"
        and request.features is not None
    )
    score, deviation_type = 0.0, "none"
    if valid and request.features is not None:
        score, deviation_type = score_features(request.features)

    return {
        "schema_version": "2.0",
        "sequence": request.sequence,
        "start_ms": request.start_ms,
        "end_ms": request.end_ms,
        "phase": request.phase,
        "valid": valid,
        "collapse_probability": score,
        "deviation_type": deviation_type,
        "model_version": MODEL_VERSION,
    }


def score_feature_deltas(features: FeatureDeltas) -> Tuple[float, DeviationType]:
    head_change = abs(features.head_gap_delta) / HEAD_GAP_SCALE
    lateral_change = abs(features.lateral_offset_delta) / LATERAL_OFFSET_SCALE
    shoulder_change = abs(features.shoulder_tilt_delta) / SHOULDER_TILT_SCALE
    score = min(1.0, max(head_change, lateral_change, shoulder_change) * REFERENCE_SCORE_SCALE)

    if score == 0:
        return score, "none"
    if lateral_change > head_change and lateral_change > shoulder_change:
        # The user's own side: the camera image is not mirrored, so a positive offset change
        # (nose toward larger image x) is a lean to the user's left. Checked 2026-10-08.
        kind = "left_lean" if features.lateral_offset_delta > 0 else "right_lean"
        return score, kind
    # Head height, shoulder tilt and ties do not establish forward slouch anatomy.
    return score, "unspecified"


def predict_feature_observation(request: InferenceRequestV2) -> Observation:
    features = request.features
    valid = (
        request.phase == "running"
        and request.measurement_quality == "good"
        and features is not None
        and features.current_quality >= MINIMUM_FEATURE_QUALITY
        and features.baseline_quality >= MINIMUM_FEATURE_QUALITY
    )
    score, deviation_type = 0.0, "none"
    if valid and features is not None:
        score, deviation_type = score_feature_deltas(features)

    return {
        "schema_version": "2.0",
        "sequence": request.sequence,
        "start_ms": request.start_ms,
        "end_ms": request.end_ms,
        "phase": request.phase,
        "valid": valid,
        "collapse_probability": score,
        "deviation_type": deviation_type,
        "model_version": REFERENCE_MODEL_VERSION,
    }


def _unjudged(t_ms: int, reason: str) -> FrameResult:
    return {
        "t_ms": t_ms,
        "valid": False,
        "collapse_probability": 0.0,
        "deviation_type": "none",
        "invalid_reason": reason,
    }


def predict_frames(request: InferenceRequestV3) -> FrameObservation:
    """Judge every frame on its own (plan 0084): no averaging, no timing rules.

    Frames the app marked valid:false, nobody tracked, or the judgeability check rejected are
    unmeasurable; a turned head is head_turn. The rest are scored like v2 feature deltas.
    """
    baseline = frame_rules.baseline_features(request.baseline)
    results = []
    for frame in request.frames:
        if baseline is None or frame.p is None or frame.valid is False:
            results.append(_unjudged(frame.t_ms, "unmeasurable"))
            continue
        current = frame_rules.features(frame.p)
        if current is None:
            results.append(_unjudged(frame.t_ms, "unmeasurable"))
            continue
        if frame_rules.head_turned(current, baseline):
            results.append(_unjudged(frame.t_ms, "head_turn"))
            continue
        change = frame_rules.deltas(current, baseline)
        if change is None:
            results.append(_unjudged(frame.t_ms, "unmeasurable"))
            continue
        head_gap, offset, tilt = change
        score, deviation_type = score_feature_deltas(FeatureDeltas(
            head_gap_delta=head_gap,
            lateral_offset_delta=offset,
            shoulder_tilt_delta=tilt,
            current_quality=current.quality,
            baseline_quality=baseline.quality,
        ))
        results.append({
            "t_ms": frame.t_ms,
            "valid": True,
            "collapse_probability": score,
            "deviation_type": deviation_type,
            "invalid_reason": None,
        })
    return {"schema_version": "3.0", "model_version": REFERENCE_MODEL_VERSION, "frames": results}
