"""Private replay ingestion, service-compatible geometry, and causal windows."""

from collections import Counter, deque
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import statistics
import unicodedata


INDICES = (0, 2, 5, 7, 8, 9, 10, 11, 12)
FORMAT = "observation-keypoint-replay-v8"
PROTOCOL = "front-observation-base-hold-v7"


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def private_destination(path):
    """Keep identifying catalogs and learned artifacts outside any Git worktree."""
    target = Path(path).resolve()
    if any((p / ".git").exists() for p in (target, *target.parents)):
        raise ValueError("private output must be outside a Git worktree")
    return target


def read_replay(path):
    raw = Path(path).read_bytes()
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("invalid replay JSON") from exc
    if not isinstance(data, dict) or data.get("schema_version") != FORMAT or data.get("protocolId") != PROTOCOL:
        raise ValueError("only the v8 base-hold replay format is supported")
    if data.get("scope") != "reference_and_hold_phases" or data.get("labelKind") != "guided_task_not_ground_truth":
        raise ValueError("unexpected replay scope or label provenance")
    if data.get("source") not in ("camera", "synthetic") or data.get("mirrored") is not False:
        raise ValueError("unexpected replay source or mirroring")
    name, run, frames, markers = (data.get(k) for k in ("participant", "runId", "frames", "markers"))
    if not isinstance(name, str) or not name.strip() or not isinstance(run, str) or not run:
        raise ValueError("participant and run identity are required")
    if not isinstance(frames, list) or not frames or not isinstance(markers, list):
        raise ValueError("frames and markers are required")
    if data.get("pointIndices") != list(range(33)) or not isinstance(data.get("schedule"), list) or not data["schedule"]:
        raise ValueError("point indices and guided schedule are required")
    if not isinstance(data.get("droppedFrames"), int) or data["droppedFrames"] < 0:
        raise ValueError("invalid dropped frame count")
    last_time = -1
    last_observation = -1
    dimensions, models = set(), set()
    seen_hold = False
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("invalid frame")
        t, obs = frame.get("elapsedMs"), frame.get("observationTimeMs")
        if not finite(t) or t <= last_time:
            raise ValueError("frame time must be strictly increasing")
        last_time = t
        if obs is not None:
            if not finite(obs) or obs <= last_observation:
                raise ValueError("observation time must be strictly increasing")
            last_observation = obs
        width, height = frame.get("width"), frame.get("height")
        if (width, height) != (640, 480):
            raise ValueError("service comparison requires 640x480 frames")
        dimensions.add((width, height))
        models.add(frame.get("poseModelId"))
        if frame.get("measurable") not in (True, False, None):
            raise ValueError("invalid measurability flag")
        if not isinstance(frame.get("image"), list) or len(frame["image"]) != 33:
            raise ValueError("expected 33 image landmarks")
        if not isinstance(frame.get("world"), list) or len(frame["world"]) != 33:
            raise ValueError("expected 33 world landmarks")
        if frame.get("phase") == "registering":
            if seen_hold:
                raise ValueError("registration cannot resume after measurement")
            if frame.get("task") != "neutral" or frame.get("measurement") is not False:
                raise ValueError("invalid registration context")
        elif frame.get("phase") == "hold" and frame.get("measurement") is True:
            seen_hold = True
            if frame.get("task") not in ("neutral", "deviation"):
                raise ValueError("unsupported measurement task")
            if not all(isinstance(frame.get(k), int) and not isinstance(frame.get(k), bool) and frame[k] >= 1 for k in ("round", "trial", "attempt", "segment")):
                raise ValueError("invalid trial, attempt, or segment")
        else:
            raise ValueError("v8 contains an unexpected phase")
    if len(models) != 1 or None in models:
        raise ValueError("pose model changed or is missing")
    previous_marker = (-1, -1)
    for marker in markers:
        if not isinstance(marker, dict) or marker.get("reason") not in ("stopped", "hidden", "interrupted"):
            raise ValueError("invalid interruption marker")
        index, t = marker.get("afterFrame"), marker.get("elapsedMs")
        if not isinstance(index, int) or not 0 <= index < len(frames) or not finite(t) or t < frames[index]["elapsedMs"]:
            raise ValueError("invalid interruption location")
        if index < previous_marker[0] or t < previous_marker[1]:
            raise ValueError("interruption markers are out of order")
        if index + 1 < len(frames) and t > frames[index + 1]["elapsedMs"]:
            raise ValueError("interruption marker is after the next frame")
        previous_marker = (index, t)
    return data, hashlib.sha256(raw).hexdigest()


def normalized_name(name):
    return unicodedata.normalize("NFKC", name).strip().casefold()


def make_catalog(folder):
    files = sorted(Path(folder).glob("*.json"))
    if not files:
        raise ValueError("no replay JSON files found")
    captures, groups, digests, runs = [], {}, set(), set()
    for path in files:
        data, digest = read_replay(path)
        if digest in digests or data["runId"] in runs:
            raise ValueError("duplicate replay or run ID")
        digests.add(digest)
        runs.add(data["runId"])
        name = data["participant"].strip()
        groups.setdefault(normalized_name(name), set()).add(name)
        captures.append({"path": str(path.resolve()), "sha256": digest})
    names = {}
    for index, key in enumerate(sorted(groups), 1):
        for name in sorted(groups[key]):
            names[name] = f"P{index:03d}"
    return {"schema_version": "replay-pilot-catalog-v1", "identity_reviewed": False,
            "name_to_id": names, "captures": captures}


def load_catalog(path, allow_unverified=False):
    catalog = json.loads(Path(path).read_text(encoding="utf-8"))
    if catalog.get("schema_version") != "replay-pilot-catalog-v1":
        raise ValueError("invalid private catalog")
    if catalog.get("identity_reviewed") is not True and not allow_unverified:
        raise ValueError("review participant identities or explicitly allow an exploratory run")
    names, captures = catalog.get("name_to_id"), catalog.get("captures")
    if not isinstance(names, dict) or not names or not isinstance(captures, list) or not captures:
        raise ValueError("catalog is incomplete")
    if any(not isinstance(k, str) or not k or not isinstance(v, str) or not v.startswith("P") or not v[1:].isdigit() for k, v in names.items()):
        raise ValueError("catalog participant IDs must be anonymous P-numbers")
    loaded, digests, runs, paths, used = [], set(), set(), set(), set()
    for spec in captures:
        path = Path(spec["path"]).resolve()
        if path in paths:
            raise ValueError("duplicate replay path")
        paths.add(path)
        data, digest = read_replay(path)
        if digest != spec.get("sha256") or digest in digests or data["runId"] in runs:
            raise ValueError("replay changed or duplicated since cataloging")
        digests.add(digest)
        runs.add(data["runId"])
        name = data["participant"].strip()
        if name not in names:
            raise ValueError("capture participant is absent from the catalog")
        used.add(name)
        loaded.append((names[name], digest, data))
    if used != set(names):
        raise ValueError("catalog contains unused participant names")
    return catalog, loaded


def image_points(frame):
    if frame.get("measurable") is not True or frame.get("observationTimeMs") is None:
        return None
    result = []
    for i in INDICES:
        p = frame["image"][i]
        if not isinstance(p, dict) or not finite(p.get("x")) or not finite(p.get("y")):
            return None
        v = p.get("visibility")
        result.append((p["x"], p["y"], v if finite(v) else None))
    return result


def geometry(points):
    """Equivalent to backend FrameFeatures for the first five returned values."""
    if len(points) != 9 or any(not finite(points[i][j]) for i in (0, 3, 4, 7, 8) for j in (0, 1)):
        return None
    nose, left, right = points[0], points[7], points[8]
    for p in (nose, left, right):
        if not finite(p[2]) or not 0.65 <= p[2] <= 1 or not 0.02 <= p[0] <= 0.98 or not 0.02 <= p[1] <= 0.98:
            return None
    span = math.hypot((left[0] - right[0]) * 640, (left[1] - right[1]) * 480)
    if span < 64:
        return None
    cx, cy = (left[0] + right[0]) / 2, (left[1] + right[1]) / 2
    head = (points[3][0] + points[4][0]) / 2
    face = (((points[5][1] + points[6][1]) - (points[1][1] + points[2][1])) / 2 * 480
            if all(finite(points[i][1]) for i in (1, 2, 5, 6)) else None)
    return ((cy - nose[1]) * 480 / span, (head - cx) * 640 / span,
            (left[1] - right[1]) * 480 / span, min(nose[2], left[2], right[2]),
            (nose[0] - head) * 640 / span, face, cy * 480, span)


def baseline(frames, markers=()):
    """Reproduce the app's 3s/20-sample mean using registration frames only."""
    samples = []
    last = None
    break_after = {m["afterFrame"] for m in markers}
    for index, frame in enumerate(frames):
        if frame["phase"] != "registering":
            continue
        if index - 1 in break_after:
            samples = []
            last = None
        points, t = image_points(frame), frame["elapsedMs"]
        if points is None or last is not None and t - last > 1000:
            samples = []
        last = t
        if points is None:
            continue
        samples.append((t, points))
        if t - samples[0][0] < 3000 or len(samples) < 20:
            continue
        # JavaScript Math.round(v * 1e5) / 1e5 on nonnegative valid coordinates.
        mean = [(math.floor(sum(p[i][j] for _, p in samples) / len(samples) * 1e5 + 0.5) / 1e5)
                for i in range(9) for j in range(2)]
        if any(v < 0 or v > 1 for v in mean):
            continue
        pts = [(mean[i * 2], mean[i * 2 + 1], 1.0) for i in range(9)]
        result = geometry(pts)
        if result is None:
            raise ValueError("registered baseline does not meet service quality rules")
        return result
    raise ValueError("no valid 3-second, 20-sample registration")


def feature_deltas(points, reference):
    current = geometry(points)
    if current is None or current[5] is None or reference[5] is None or abs(current[4] - reference[4]) > 0.15:
        return None
    return (current[0] - reference[0], current[1] - reference[1], current[2] - reference[2],
            (current[5] - reference[5]) / reference[7],
            (current[6] - reference[6]) / reference[7], current[7] / reference[7] - 1)


def rule_score(values):
    return min(1.0, max(abs(values[0]) / 0.22, abs(values[1]) / 0.20, abs(values[2]) / 0.03) * 0.7)


@dataclass(frozen=True)
class Window:
    participant: str
    capture: str
    trial: tuple
    chunk: int
    time_ms: float
    start_ms: float
    label: int
    features: tuple


def prepare_capture(participant, capture, data):
    reference = baseline(data["frames"], data["markers"])
    windows, counts = [], Counter()
    history = deque()
    last_context, last_time, last_emit = None, None, None
    chunk = 0
    break_after = {m["afterFrame"] for m in data["markers"]}
    schedule = {(s.get("round"), s.get("trial"), s.get("action"), s.get("phase")) for s in data["schedule"] if isinstance(s, dict)}
    pending_break = False
    observed_trials = set()
    for index, frame in enumerate(data["frames"]):
        if frame["phase"] == "registering":
            pending_break |= index in break_after
            continue
        task = frame["task"]
        context = (frame["round"], frame["trial"], task, frame["attempt"], frame["segment"])
        observed_trials.add(context)
        if (frame["round"], frame["trial"], task, "hold") not in schedule:
            raise ValueError("measurement does not match the guided schedule")
        t = frame["elapsedMs"]
        points = image_points(frame)
        current = geometry(points) if points is not None else None
        if points is None:
            reason = "missing_or_unmeasurable"
        elif current is None:
            reason = "service_quality"
        elif abs(current[4] - reference[4]) > 0.15:
            reason = "head_turn"
        else:
            reason = None
        values = feature_deltas(points, reference) if reason is None else None
        broken = pending_break or context != last_context or last_time is not None and t - last_time > 500 or values is None
        if broken:
            history.clear()
            last_emit = None
            chunk += 1
            counts["discontinuities"] += 1
        pending_break = index in break_after
        last_context, last_time = context, t
        if values is None:
            counts["invalid_frames"] += 1
            counts["excluded_" + (reason or "missing_feature")] += 1
            continue
        history.append((t, values))
        while history and t - history[0][0] > 1000:
            history.popleft()
        if len(history) < 5 or t - history[0][0] < 800 or last_emit is not None and t - last_emit < 500:
            continue
        features = tuple(statistics.median(row[1][i] for row in history) for i in range(6))
        windows.append(Window(participant, capture, context, chunk, t, history[0][0],
                              int(task == "deviation"), features))
        last_emit = t
    counts["dropped_frames_declared"] = data["droppedFrames"]
    counts["windows"] = len(windows)
    counts["observed_trials"] = len(observed_trials)
    counts["trials_without_windows"] = len(observed_trials - {w.trial for w in windows})
    return windows, dict(counts)
