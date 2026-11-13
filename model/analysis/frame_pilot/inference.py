"""Score one valid frame at a time; alert timing belongs to the judge."""

import math

from model.analysis.replay_pilot.replay import finite

from .frames import MIN_VISIBILITY, Reference, frame_features


class FramePredictor:
    """A two-stage frame-RF candidate and one reference, with no temporal state."""

    def __init__(self, corrector, classifier, reference, *, min_visibility=MIN_VISIBILITY):
        if not isinstance(reference, Reference):
            raise ValueError("a registered reference is required")
        if list(getattr(classifier, "classes_", ())) != [0, 1]:
            raise ValueError("classifier must have reference and deviation classes")
        if getattr(classifier, "n_features_in_", None) != 6:
            raise ValueError("classifier must accept the six frame features")
        if getattr(corrector, "n_features_in_", None) != 7:
            raise ValueError("corrector must accept six frame features and baseline shoulder width")
        if not finite(min_visibility) or not 0 <= min_visibility <= 1:
            raise ValueError("visibility cutoff must be between 0 and 1")
        self.corrector = corrector
        self.classifier = classifier
        self.reference = reference
        self.min_visibility = min_visibility

    def predict(self, points, *, measurable=True):
        """Return an uncalibrated deviation score or no score for this frame."""
        features, reason = frame_features(points, self.reference, measurable=measurable,
                                          min_visibility=self.min_visibility)
        if reason is not None:
            return {"valid": False, "score": None, "reason": reason}
        span = self.reference.geometry[7]
        correction = self.corrector.predict([list(features) + [span]])
        if len(correction) != 1 or not math.isfinite(float(correction[0])):
            raise ValueError("corrector returned an invalid output")
        adjusted = list(features)
        adjusted[4] -= float(correction[0]) / span
        output = self.classifier.predict_proba([adjusted])
        if len(output) != 1 or len(output[0]) != 2:
            raise ValueError("classifier returned an invalid score shape")
        score = float(output[0][1])
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("classifier returned an invalid score")
        return {"valid": True, "score": score, "reason": None}
