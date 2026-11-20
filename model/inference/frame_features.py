"""Frame-level geometry on the same 640x480 scale as the replay and RF training code."""

import math
from typing import NamedTuple, Optional, Tuple

from .schemas import BaselinePoint, FramePoint, InvalidReason


MIN_VISIBILITY = 0.65
HEAD_TURN_LIMIT = 0.15
FrameFeatures = Tuple[float, float, float, float, float, float]


class Geometry(NamedTuple):
    head_gap: float
    lateral_offset: float
    shoulder_tilt: float
    quality: float
    turn: float
    face_length: Optional[float]
    shoulder_height: float
    shoulder_span: float


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def geometry(points) -> Optional[Geometry]:
    """Match replay geometry, with the Java rule gate in the first five values."""
    if len(points) != 9 or any(not finite(points[i][j]) for i in (0, 3, 4, 7, 8) for j in (0, 1)):
        return None
    nose, left, right = points[0], points[7], points[8]
    for point in (nose, left, right):
        x, y, visibility = point
        if not finite(visibility) or not MIN_VISIBILITY <= visibility <= 1 or not (0.02 <= x <= 0.98 and 0.02 <= y <= 0.98):
            return None
    span = math.hypot((left[0] - right[0]) * 640, (left[1] - right[1]) * 480)
    if span < 64:
        return None
    cx, cy = (left[0] + right[0]) / 2, (left[1] + right[1]) / 2
    head = (points[3][0] + points[4][0]) / 2
    face = (((points[5][1] + points[6][1]) - (points[1][1] + points[2][1])) / 2 * 480
            if all(finite(points[i][1]) for i in (1, 2, 5, 6)) else None)
    return Geometry(
        (cy - nose[1]) * 480 / span, (head - cx) * 640 / span,
        (left[1] - right[1]) * 480 / span, min(nose[2], left[2], right[2]),
        (nose[0] - head) * 640 / span, face, cy * 480, span,
    )


def baseline_geometry(points: list[BaselinePoint]) -> Optional[Geometry]:
    # Registration stores only the [x, y] means.
    reference = geometry([(x, y, 1.0) for x, y in points])
    return reference if reference is not None and reference.face_length is not None else None


def head_turned(current: Geometry, reference: Geometry) -> bool:
    return abs(current.turn - reference.turn) > HEAD_TURN_LIMIT


def model_points_usable(points, min_visibility=MIN_VISIBILITY) -> bool:
    if not isinstance(points, (tuple, list)) or len(points) != 9:
        return False
    for point in points:
        if (not isinstance(point, (tuple, list)) or len(point) != 3
                or not all(finite(value) for value in point)):
            return False
        x, y, visibility = point
        if not (0 <= x <= 1 and 0 <= y <= 1 and min_visibility <= visibility <= 1):
            return False
    return True


def service_precision(points) -> list[FramePoint]:
    def rounded(value, places):
        scale = 10 ** places
        return math.floor(value * scale + 0.5) / scale

    return [(rounded(x, 5), rounded(y, 5), rounded(visibility, 2)) for x, y, visibility in points]


def frame_features(points, reference: Geometry) -> tuple[Optional[FrameFeatures], Optional[InvalidReason]]:
    """Match the RF training input for a frame, including FE rounding."""
    if not model_points_usable(points, 0):
        return None, "unmeasurable"
    points = service_precision(points)
    if not model_points_usable(points):
        return None, "unmeasurable"
    current = geometry(points)
    if current is None or current.face_length is None or reference.face_length is None:
        return None, "unmeasurable"
    if head_turned(current, reference):
        return None, "head_turn"
    span = reference.shoulder_span
    values = (
        current.head_gap - reference.head_gap,
        current.lateral_offset - reference.lateral_offset,
        current.shoulder_tilt - reference.shoulder_tilt,
        (current.face_length - reference.face_length) / span,
        (current.shoulder_height - reference.shoulder_height) / span,
        current.shoulder_span / span - 1,
    )
    if not all(math.isfinite(value) for value in values):
        return None, "unmeasurable"
    return values, None
