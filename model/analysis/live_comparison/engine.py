"""Causal live windows using the same geometry and score as the replay pilot."""

from collections import deque
import math
import statistics

from model.analysis.replay_pilot.replay import baseline, feature_deltas, finite, geometry, image_points
from model.inference.schemas import FeatureDeltas
from model.inference.service import score_feature_deltas


class LiveComparison:
    """One volatile camera session; no video or landmarks are persisted."""

    def __init__(self, uncorrected, corrector, corrected, threshold):
        if not finite(threshold) or not 0 <= threshold <= 1:
            raise ValueError("invalid model threshold")
        if list(uncorrected.classes_) != [0, 1] or list(corrected.classes_) != [0, 1]:
            raise ValueError("classifiers must use reference and deviation classes")
        self.uncorrected, self.corrector, self.corrected = uncorrected, corrector, corrected
        self.threshold = float(threshold)
        self.reset()

    def reset(self):
        self.reference = None
        self.registration = []
        self.history = deque()
        self.last_time = None
        self.last_emit = None
        self.last_result = None

    def observe(self, time_ms, landmarks, width, height):
        if not finite(time_ms) or time_ms < 0 or (self.last_time is not None and time_ms <= self.last_time):
            raise ValueError("timestamps must be strictly increasing")
        gap = None if self.last_time is None else time_ms - self.last_time
        self.last_time = time_ms
        valid_image = isinstance(landmarks, list) and len(landmarks) == 33 and width == 640 and height == 480
        frame = {"image": landmarks if valid_image else [], "measurable": valid_image,
                 "observationTimeMs": time_ms, "elapsedMs": time_ms, "phase": "registering"}
        pts = image_points(frame)
        current = geometry(pts) if pts is not None else None
        if current is None or current[5] is None:
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
                self.registration.clear()
                return {"status": "ready"}
            return {"status": "registering", "progress": min(1., elapsed / 3000)}

        values = feature_deltas(pts, self.reference)
        if values is None:
            self.history.clear()
            self.last_emit = self.last_result = None
            return {"status": "unmeasurable"}
        if gap is not None and gap > 500:
            self.history.clear()
            self.last_emit = self.last_result = None
        self.history.append((time_ms, values))
        while self.history and time_ms - self.history[0][0] > 1000:
            self.history.popleft()
        if len(self.history) < 5 or time_ms - self.history[0][0] < 800:
            return {"status": "warming"}
        if self.last_emit is not None and time_ms - self.last_emit < 500:
            return self.last_result

        values = [statistics.median(row[1][i] for row in self.history) for i in range(6)]
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
        self.last_emit = time_ms
        self.last_result = {"status": "measured", "features": values,
                            "rule": {"score": rule, "threshold": .7, "deviation": rule >= .7},
                            "model": {"score": learned, "threshold": self.threshold,
                                      "deviation": learned >= self.threshold},
                            "model_uncorrected": {"score": raw, "threshold": self.threshold,
                                                  "deviation": raw >= self.threshold},
                            "correction_px": shift}
        return self.last_result
