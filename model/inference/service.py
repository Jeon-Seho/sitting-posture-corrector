"""Stateless rule score; no temporal decisions, training or persistent storage.

Scores are not calibrated probabilities. Only normalized deltas belong here;
video, landmarks, request-body logs and external calls are outside this service.
"""

from typing import Tuple

from .schemas import (
    DeviationType, FeatureDeltas, Features, InferenceRequest,
    InferenceRequestV2, Observation,
)


MODEL_VERSION = "baseline-feature-rule-v1"
REFERENCE_MODEL_VERSION = "reference-feature-rule-v1"

# Preserve the local referenceScore rule. These scales/quality limits are unvalidated.
MINIMUM_FEATURE_QUALITY = 0.65
HEAD_GAP_SCALE = 0.22
LATERAL_OFFSET_SCALE = 0.20
SHOULDER_TILT_SCALE = 0.13
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
        # Raw positive offset appears on the left of the mirrored camera preview.
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
