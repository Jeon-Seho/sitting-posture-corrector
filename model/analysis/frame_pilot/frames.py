"""Canonical 4:3 geometry and frame-level model quality checks.

The 640x480 coordinate system is a reference scale, not the camera's physical
pixel size. Visibility is a model estimate: this gate cannot prove that a
high-confidence landmark was actually unobscured.
"""

from dataclasses import dataclass
import math

from model.analysis.replay_pilot.replay import baseline, feature_deltas, finite, geometry, image_points


# Existing service/display cutoff, reused as an exploratory starting point.
MIN_VISIBILITY = 0.65


@dataclass(frozen=True)
class Reference:
    """Geometry derived from the nine 2D baseline points in canonical pixels."""

    geometry: tuple


def model_points_usable(points, min_visibility=MIN_VISIBILITY):
    """Every point used by the six features must have a visible 2D location."""
    if not finite(min_visibility) or not 0 <= min_visibility <= 1:
        raise ValueError("visibility cutoff must be between 0 and 1")
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


def service_precision(points):
    """Match FE's coordinate and visibility precision for live model input."""
    def rounded(value, places):
        scale = 10 ** places
        return math.floor(value * scale + 0.5) / scale

    return [(rounded(p[0], 5), rounded(p[1], 5), rounded(p[2], 2)) for p in points]


def reference_from_points(points, *, quality_verified=False):
    """Convert nine already-registered [x, y] means into a reference.

    The service currently stores no visibility for the baseline. Callers must
    ensure registration quality before saving it; this function cannot recover it.
    Callers must explicitly confirm that all nine model inputs were checked.
    """
    if quality_verified is not True:
        raise ValueError("baseline visibility must be verified before creating a reference")
    if not isinstance(points, (tuple, list)) or len(points) != 9:
        raise ValueError("nine baseline points are required")
    if any(not isinstance(p, (tuple, list)) or len(p) != 2
           or not all(finite(v) and 0 <= v <= 1 for v in p) for p in points):
        raise ValueError("baseline coordinates must be finite normalized points")
    values = geometry([(p[0], p[1], 1.0) for p in points])
    if values is None or values[5] is None:
        raise ValueError("baseline geometry is not measurable")
    return Reference(tuple(values))


def reference_from_capture(frames, markers=(), min_visibility=MIN_VISIBILITY):
    """Recreate 3s/20-frame registration, rejecting low-quality model inputs."""
    safe = []
    for frame in frames:
        if frame.get("phase") == "registering":
            points = image_points(frame)
            if not model_points_usable(points, min_visibility):
                frame = {**frame, "measurable": False}
        safe.append(frame)
    return Reference(tuple(baseline(safe, markers)))


def frame_features(points, reference, *, measurable=True, min_visibility=MIN_VISIBILITY):
    """Return six per-frame features or a reason to abstain, with no timer."""
    if not isinstance(reference, Reference):
        raise ValueError("a registered reference is required")
    # Check shape and finite values before rounding. Quality is then checked at
    # the same two-decimal visibility precision the service transmits.
    if measurable is not True or not model_points_usable(points, 0):
        return None, "unmeasurable"
    points = service_precision(points)
    if not model_points_usable(points, min_visibility):
        return None, "unmeasurable"
    current = geometry(points)
    if current is None or current[5] is None:
        return None, "unmeasurable"
    if abs(current[4] - reference.geometry[4]) > 0.15:
        return None, "head_turn"
    values = feature_deltas(points, reference.geometry)
    if values is None or len(values) != 6 or not all(math.isfinite(v) for v in values):
        return None, "unmeasurable"
    return tuple(values), None
