"""Stateless inference without temporal decisions, training or persistent storage."""

from dataclasses import dataclass
from typing import Optional, Tuple

from .frame_features import (
    FrameFeatures, Geometry, baseline_geometry, frame_features, geometry,
    head_turned, model_points_usable,
)
from .frame_model import RF_MODEL_VERSION, FrameRandomForest
from .schemas import (
    DeviationType, FeatureDeltaRequest, FeatureDeltas, InferenceObservation, InferenceRequest,
    InvalidReason, Observation,
)


MODEL_VERSION = "baseline-feature-rule-v1"
REFERENCE_MODEL_VERSION = "reference-feature-rule-v1"

# Preserve the local referenceScore rule. These scales/quality limits are unvalidated.
MINIMUM_FEATURE_QUALITY = 0.65
HEAD_GAP_SCALE = 0.22
LATERAL_OFFSET_SCALE = 0.20
SHOULDER_TILT_SCALE = 0.03  # ADR 0020 (was 0.13)
REFERENCE_SCORE_SCALE = 0.7


def feature_change_ratios(head_gap: float, lateral: float, tilt: float) -> Tuple[float, float, float]:
    return abs(head_gap) / HEAD_GAP_SCALE, abs(lateral) / LATERAL_OFFSET_SCALE, abs(tilt) / SHOULDER_TILT_SCALE


def deviation_direction(ratios: Tuple[float, float, float], lateral: float) -> DeviationType:
    head_change, lateral_change, shoulder_change = ratios
    if lateral_change > head_change and lateral_change > shoulder_change:
        # The user's own side: the camera image is not mirrored, so a positive offset change
        # (nose toward larger image x) is a lean to the user's left. Checked 2026-10-08.
        return "left_lean" if lateral > 0 else "right_lean"
    # Head height, shoulder tilt and ties do not establish forward slouch anatomy.
    return "unspecified"


def score_feature_deltas(features: FeatureDeltas) -> Tuple[float, DeviationType]:
    ratios = feature_change_ratios(
        features.head_gap_delta, features.lateral_offset_delta, features.shoulder_tilt_delta,
    )
    score = min(1.0, max(ratios) * REFERENCE_SCORE_SCALE)
    return score, deviation_direction(ratios, features.lateral_offset_delta) if score else "none"


def predict_feature_observation(request: FeatureDeltaRequest) -> Observation:
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


class InvalidBaseline(Exception):
    pass


def transform_probability(probability: float) -> float:
    """Map the RF threshold 0.5 to the service threshold 0.7."""
    return 1.4 * probability if probability <= 0.5 else 0.4 + 0.6 * probability


@dataclass(frozen=True)
class FrameInference:
    rf: Optional[FrameRandomForest] = None

    @property
    def model_version(self) -> str:
        return RF_MODEL_VERSION if self.rf is not None else REFERENCE_MODEL_VERSION

    def predict(self, request: InferenceRequest) -> InferenceObservation:
        reference = baseline_geometry(request.baseline)
        if reference is None:
            raise InvalidBaseline

        result: InferenceObservation = {
            "schema_version": "2.0",
            "sequence": request.sequence,
            "start_ms": request.start_ms,
            "end_ms": request.end_ms,
            "phase": request.phase,
            "valid": False,
            "collapse_probability": 0.0,
            "deviation_type": "none",
            "model_version": self.model_version,
            "invalid_reason": None,
        }
        if request.phase != "running":
            return result

        samples: list[Geometry] = []
        rf_features: list[FrameFeatures] = []
        invalid_reason: InvalidReason = "unmeasurable"
        for frame in request.frames:
            if frame is None:
                continue
            if self.rf is None:
                current = geometry(frame)
                if current is None:
                    continue
                if head_turned(current, reference):
                    invalid_reason = "head_turn"
                else:
                    samples.append(current)
            elif model_points_usable(frame):
                # Enforce the visibility cutoff on the transmitted points as well.
                features, reason = frame_features(frame, reference)
                if reason == "head_turn":
                    invalid_reason = reason
                if features is not None:
                    rf_features.append(features)

        if samples:
            head_gap, lateral, tilt, quality = (
                sum(frame[index] for frame in samples) / len(samples) for index in range(4)
            )
            score, direction = score_feature_deltas(FeatureDeltas(
                head_gap_delta=head_gap - reference.head_gap,
                lateral_offset_delta=lateral - reference.lateral_offset,
                shoulder_tilt_delta=tilt - reference.shoulder_tilt,
                current_quality=quality,
                baseline_quality=reference.quality,
            ))
        elif self.rf is not None and rf_features:
            probabilities = self.rf.predict_probabilities(rf_features, reference.shoulder_span)
            score = transform_probability(sum(probabilities) / len(probabilities))
            head_gap, lateral, tilt = (
                sum(frame[index] for frame in rf_features) / len(rf_features) for index in range(3)
            )
            ratios = feature_change_ratios(head_gap, lateral, tilt)
            direction = deviation_direction(ratios, lateral) if score else "none"
        else:
            result["invalid_reason"] = invalid_reason
            return result

        result["valid"] = True
        result["collapse_probability"] = score
        result["deviation_type"] = direction
        return result
