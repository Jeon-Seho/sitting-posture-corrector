"""Read private v8 replays for the frame pilot without changing legacy inputs.

Frame dimensions are metadata: MediaPipe x/y are already normalized. The
existing 1-second pilot keeps its original strict-640x480 reader and code hash.
"""

import hashlib
import json
from pathlib import Path

from model.analysis.replay_pilot.replay import FORMAT, PROTOCOL, finite, normalized_name


def four_by_three(width, height):
    """Match the app's aspect-ratio tolerance without accepting missing sizes."""
    return (isinstance(width, int) and not isinstance(width, bool) and width > 0
            and isinstance(height, int) and not isinstance(height, bool) and height > 0
            and abs(width / height - 4 / 3) < 0.01)


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
    last_time = last_observation = -1
    dimensions, models = set(), set()
    seen_hold = False
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("invalid frame")
        t, observation = frame.get("elapsedMs"), frame.get("observationTimeMs")
        if not finite(t) or t <= last_time:
            raise ValueError("frame time must be strictly increasing")
        last_time = t
        if observation is not None:
            if not finite(observation) or observation <= last_observation:
                raise ValueError("observation time must be strictly increasing")
            last_observation = observation
        width, height = frame.get("width"), frame.get("height")
        if not four_by_three(width, height):
            raise ValueError("frame pilot requires 4:3 frames")
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
            if not all(isinstance(frame.get(k), int) and not isinstance(frame.get(k), bool) and frame[k] >= 1
                       for k in ("round", "trial", "attempt", "segment")):
                raise ValueError("invalid trial, attempt, or segment")
        else:
            raise ValueError("v8 contains an unexpected phase")
    if len(dimensions) != 1:
        raise ValueError("capture dimensions changed")
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
    if any(not isinstance(k, str) or not k or not isinstance(v, str) or not v.startswith("P") or not v[1:].isdigit()
           for k, v in names.items()):
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
