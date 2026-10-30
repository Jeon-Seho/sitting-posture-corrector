"""Per-frame features from the 9 coordinate joints (plan 0064, ADR 0020 section 3).

Moved from the API (backend/api FrameFeatures.java), which keeps the same rule for its baseline
check at hello. Both are checked against contracts/examples/frames/reference-rule-cases.json.
Values are normalized by shoulder width. 0.65, 0.02, 0.1 and 0.15 are unvalidated prototype
values; the camera is fixed at 640x480. Experimental rule, not a medical measurement.
"""

import math
from typing import NamedTuple, Optional, Sequence

WIDTH = 640.0
HEIGHT = 480.0
MIN_QUALITY = 0.65
EDGE = 0.02
MIN_SPAN = 0.1
# A nose to ear-midpoint change above this (shoulder widths) is a turned head: not judged.
HEAD_TURN_LIMIT = 0.15

NOSE = 0
LEFT_EAR = 3
RIGHT_EAR = 4
LEFT_SHOULDER = 7
RIGHT_SHOULDER = 8


class FrameFeatures(NamedTuple):
    head_gap: float
    offset: float
    tilt: float
    quality: float
    turn: float


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def features(points: Sequence[Sequence[Optional[float]]]) -> Optional[FrameFeatures]:
    """Features of one frame of 9 joints [x, y, visibility], or None when it cannot be judged.

    Nose and both shoulders: visibility 0.65-1 and coordinates 0.02-0.98; shoulder width at least
    10% of the frame width. Both ears only need coordinates.
    """
    nose, left, right = points[NOSE], points[LEFT_SHOULDER], points[RIGHT_SHOULDER]
    for p in (nose, left, right):
        if not all(_finite(v) for v in p[:3]):
            return None
        if p[2] < MIN_QUALITY or p[2] > 1:
            return None
        if p[0] < EDGE or p[0] > 1 - EDGE or p[1] < EDGE or p[1] > 1 - EDGE:
            return None
    span = math.hypot((left[0] - right[0]) * WIDTH, (left[1] - right[1]) * HEIGHT)
    if span < WIDTH * MIN_SPAN:
        return None
    cx, cy = (left[0] + right[0]) / 2, (left[1] + right[1]) / 2
    left_ear, right_ear = points[LEFT_EAR], points[RIGHT_EAR]
    if not all(_finite(v) for v in (left_ear[0], left_ear[1], right_ear[0], right_ear[1])):
        return None
    head = (left_ear[0] + right_ear[0]) / 2
    result = FrameFeatures(
        (cy - nose[1]) * HEIGHT / span,
        (head - cx) * WIDTH / span,
        (left[1] - right[1]) * HEIGHT / span,
        min(nose[2], left[2], right[2]),
        (nose[0] - head) * WIDTH / span,
    )
    return result if _valid(result) else None


def baseline_features(points: Sequence[Sequence[float]]) -> Optional[FrameFeatures]:
    """Features of the stored baseline (9 joints [x, y]). The DB keeps no visibility, so it is 1."""
    return features([[p[0], p[1], 1.0] for p in points])


def head_turned(current: FrameFeatures, baseline: FrameFeatures) -> bool:
    return abs(current.turn - baseline.turn) > HEAD_TURN_LIMIT


def deltas(current: FrameFeatures, baseline: FrameFeatures):
    """Current minus baseline (head gap, lateral offset, shoulder tilt), or None when not finite."""
    if not _valid(current) or not _valid(baseline):
        return None
    values = (
        current.head_gap - baseline.head_gap,
        current.offset - baseline.offset,
        current.tilt - baseline.tilt,
    )
    if not all(math.isfinite(v) for v in values):
        return None
    return values


def _valid(value: Optional[FrameFeatures]) -> bool:
    return (
        value is not None
        and all(math.isfinite(v) for v in value)
        and MIN_QUALITY <= value.quality <= 1
    )
