"""Causal live windows using the same geometry and score as the replay pilot."""

from collections import deque
import math
import statistics

from model.analysis.replay_pilot.replay import baseline, feature_deltas, finite, geometry, image_points
from model.analysis.frame_pilot.frames import Reference, frame_features, model_points_usable, service_precision
from model.analysis.frame_pilot.replay import four_by_three
from model.inference.schemas import FeatureDeltas
from model.inference.service import (
    HEAD_GAP_SCALE, LATERAL_OFFSET_SCALE, MINIMUM_FEATURE_QUALITY,
    REFERENCE_SCORE_SCALE, SHOULDER_TILT_SCALE, score_feature_deltas,
)


FEATURE_NAMES = ("head_gap", "lateral_offset", "shoulder_tilt", "face_height",
                 "shoulder_height", "shoulder_width")
# Positions in replay.INDICES; a feature is only colored when all of its inputs
# are visible throughout the window. This does not change the original score.
FEATURE_POINTS = ((0, 7, 8), (3, 4, 7, 8), (7, 8), (1, 2, 5, 6, 7, 8), (7, 8), (7, 8))
RULE_SCALES = (HEAD_GAP_SCALE, LATERAL_OFFSET_SCALE, SHOULDER_TILT_SCALE)
MODEL_DISPLAY_EPSILON = .001  # Less than 0.1 displayed point is neutral.


def rule_explanation(values, ranges, visible):
    components = [abs(values[i]) / scale * REFERENCE_SCORE_SCALE
                  for i, scale in enumerate(RULE_SCALES)]
    maximum = max(components)
    result = []
    for i, component in enumerate(components):
        limit = ranges[i] if ranges is not None else None
        if not visible[i]:
            level = "unknown"
        elif component >= REFERENCE_SCORE_SCALE:
            level = "red"
        elif limit is not None and abs(values[i]) <= limit:
            level = "green"
        else:
            level = "yellow"
        result.append({"feature": FEATURE_NAMES[i], "value": values[i],
                       "reference_range": limit, "component_score": min(1., component),
                       "dominant": component == maximum, "level": level})
    return result


def model_explanation(values, span, score, corrector, corrected, visible):
    """One-at-a-time baseline replacements, rerunning both model stages."""
    try:
        candidates = [values.copy() for _ in FEATURE_NAMES]
        for i, row in enumerate(candidates):
            row[i] = 0.
        shifts = list(corrector.predict([row + [span] for row in candidates]))
        if len(shifts) != len(candidates) or not all(finite(v) for v in shifts):
            return None
        adjusted = [row.copy() for row in candidates]
        for row, shift in zip(adjusted, shifts):
            row[4] -= float(shift) / span
        probabilities = list(corrected.predict_proba(adjusted))
        if len(probabilities) != len(candidates):
            return None
        result = []
        for i, probability in enumerate(probabilities):
            alternative = float(probability[1])
            if not math.isfinite(alternative) or not 0 <= alternative <= 1:
                return None
            effect = score - alternative
            level = ("unknown" if not visible[i] else "red" if effect >= MODEL_DISPLAY_EPSILON
                     else "green" if effect <= -MODEL_DISPLAY_EPSILON else "yellow")
            result.append({"feature": FEATURE_NAMES[i], "value": values[i],
                           "counterfactual_score": alternative, "effect": effect, "level": level})
        return result
    except Exception:  # A failed explanation must not replace an otherwise valid measurement.
        return None


class LiveComparison:
    """One volatile camera session; no video or landmarks are persisted."""

    def __init__(self, uncorrected, corrector, corrected, threshold, *, input_mode="window",
                 min_visibility=MINIMUM_FEATURE_QUALITY):
        if not finite(threshold) or not 0 <= threshold <= 1:
            raise ValueError("invalid model threshold")
        if list(uncorrected.classes_) != [0, 1] or list(corrected.classes_) != [0, 1]:
            raise ValueError("classifiers must use reference and deviation classes")
        if input_mode not in ("window", "frame"):
            raise ValueError("invalid input mode")
        if not finite(min_visibility) or not 0 <= min_visibility <= 1:
            raise ValueError("invalid visibility cutoff")
        self.uncorrected, self.corrector, self.corrected = uncorrected, corrector, corrected
        self.threshold = float(threshold)
        self.input_mode, self.min_visibility = input_mode, float(min_visibility)
        self.reset()

    def reset(self):
        self.reference = None
        self.reference_ranges = None
        self.registration = []
        self.history = deque()
        self.last_time = None
        self.last_emit = None
        self.last_result = None
        self.frame_size = None

    def observe(self, time_ms, landmarks, width, height):
        if not finite(time_ms) or time_ms < 0 or (self.last_time is not None and time_ms <= self.last_time):
            raise ValueError("timestamps must be strictly increasing")
        gap = None if self.last_time is None else time_ms - self.last_time
        self.last_time = time_ms
        valid_image = isinstance(landmarks, list) and len(landmarks) == 33 and four_by_three(width, height)
        if valid_image:
            if self.frame_size is None:
                self.frame_size = (width, height)
            elif self.frame_size != (width, height):
                valid_image = False
        frame = {"image": landmarks if valid_image else [], "measurable": valid_image,
                 "observationTimeMs": time_ms, "elapsedMs": time_ms, "phase": "registering"}
        pts = image_points(frame)
        if self.input_mode == "frame" and self.reference is not None and model_points_usable(pts, 0):
            pts = service_precision(pts)
        current = geometry(pts) if pts is not None else None
        if current is None or current[5] is None or not model_points_usable(pts, self.min_visibility):
            self.history.clear()
            self.last_emit = self.last_result = None
            if self.reference is None:
                self.registration.clear()
            return {"status": "unmeasurable"}

        if self.reference is None:
            if gap is not None and gap > 1000:
                self.registration.clear()
            self.registration.append(frame)
            elapsed = time_ms - self.registration[0]["elapsedMs"]
            if elapsed >= 3000 and len(self.registration) >= 20:
                try:
                    self.reference = baseline(self.registration)
                except ValueError:
                    self.registration.clear()
                    return {"status": "unmeasurable"}
                registration_values = []
                for sample in self.registration:
                    sample_points = image_points(sample)
                    deltas = feature_deltas(sample_points, self.reference)
                    if deltas is not None:
                        quality = [all(finite(sample_points[j][2]) and self.min_visibility <= sample_points[j][2] <= 1
                                       for j in group) for group in FEATURE_POINTS[:3]]
                        registration_values.append((deltas, quality))
                self.reference_ranges = []
                for i in range(3):
                    eligible = [abs(row[i]) for row, quality in registration_values if quality[i]]
                    self.reference_ranges.append(max(eligible) if eligible else None)
                self.registration.clear()
                return {"status": "ready"}
            return {"status": "registering", "progress": min(1., elapsed / 3000)}

        values = (frame_features(pts, Reference(self.reference), min_visibility=self.min_visibility)[0]
                  if self.input_mode == "frame" else feature_deltas(pts, self.reference))
        if values is None:
            self.history.clear()
            self.last_emit = self.last_result = None
            return {"status": "unmeasurable"}
        if gap is not None and gap > 500:
            self.history.clear()
            self.last_emit = self.last_result = None
        visible = [all(finite(pts[j][2]) and self.min_visibility <= pts[j][2] <= 1
                       for j in group) for group in FEATURE_POINTS]
        if self.input_mode == "window":
            self.history.append((time_ms, values, visible))
            while self.history and time_ms - self.history[0][0] > 1000:
                self.history.popleft()
            if len(self.history) < 5 or time_ms - self.history[0][0] < 800:
                return {"status": "warming"}
            if self.last_emit is not None and time_ms - self.last_emit < 500:
                visible = [all(row[2][i] for row in self.history) for i in range(6)]
                explanation = self.last_result["explanation"]
                filtered = {"schema_version": explanation["schema_version"]}
                for name in ("rule", "model"):
                    rows = explanation[name]
                    filtered[name] = ([{**row, "level": row["level"] if visible[i] else "unknown"}
                                       for i, row in enumerate(rows)] if rows is not None else None)
                return {**self.last_result, "explanation": filtered}
            values = [statistics.median(row[1][i] for row in self.history) for i in range(6)]
            visible = [all(row[2][i] for row in self.history) for i in range(6)]
        values = list(values)
        span = self.reference[7]
        raw = float(self.uncorrected.predict_proba([values])[0][1])
        shift = float(self.corrector.predict([values + [span]])[0])
        adjusted = values.copy()
        adjusted[4] -= shift / span
        learned = float(self.corrected.predict_proba([adjusted])[0][1])
        if not all(math.isfinite(x) for x in (raw, shift, learned)) or not (0 <= raw <= 1 and 0 <= learned <= 1):
            raise ValueError("model returned invalid scores")
        rule, _ = score_feature_deltas(FeatureDeltas(head_gap_delta=values[0], lateral_offset_delta=values[1],
                                                    shoulder_tilt_delta=values[2], current_quality=1., baseline_quality=1.))
        explanation = {"schema_version": "1.0",
                       "rule": rule_explanation(values, self.reference_ranges, visible),
                       "model": model_explanation(values, span, learned, self.corrector, self.corrected, visible)}
        self.last_emit = time_ms
        self.last_result = {"status": "measured", "features": values,
                            "rule": {"score": rule, "threshold": .7, "deviation": rule >= .7},
                            "model": {"score": learned, "threshold": self.threshold,
                                      "deviation": learned >= self.threshold},
                            "model_uncorrected": {"score": raw, "threshold": self.threshold,
                                                  "deviation": raw >= self.threshold},
                            "correction_px": shift, "explanation": explanation}
        return self.last_result
