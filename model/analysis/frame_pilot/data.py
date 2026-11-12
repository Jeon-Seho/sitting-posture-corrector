"""Prepare independent frame examples from participant-grouped v8 replays."""

from collections import Counter
from dataclasses import dataclass

from model.analysis.replay_pilot.replay import image_points

from .frames import MIN_VISIBILITY, frame_features, reference_from_capture


@dataclass(frozen=True)
class FrameSample:
    participant: str
    capture: str
    trial: tuple
    chunk: int
    time_ms: float
    label: int
    features: tuple


def prepare_capture(participant, capture, data, *, min_visibility=MIN_VISIBILITY):
    """Make one example per valid frame, preserving task and interruption boundaries.

    The caller must validate the replay first and assign whole participants to
    folds before using these examples for training or model selection.
    """
    reference = reference_from_capture(data["frames"], data["markers"], min_visibility)
    samples, counts = [], Counter()
    last_context = last_time = None
    breaks = {m["afterFrame"] for m in data["markers"]}
    schedule = {(s.get("round"), s.get("trial"), s.get("action"), s.get("phase"))
                for s in data["schedule"] if isinstance(s, dict)}
    pending_break = False
    chunk = 0
    trials = set()
    for index, frame in enumerate(data["frames"]):
        if frame["phase"] == "registering":
            pending_break |= index in breaks
            continue
        task = frame["task"]
        context = (frame["round"], frame["trial"], task, frame["attempt"], frame["segment"])
        if (frame["round"], frame["trial"], task, "hold") not in schedule:
            raise ValueError("measurement does not match the guided schedule")
        trials.add(context)
        t = frame["elapsedMs"]
        points = image_points(frame)
        features, reason = frame_features(points, reference, measurable=frame.get("measurable"),
                                          min_visibility=min_visibility)
        broken = (pending_break or context != last_context
                  or last_time is not None and t - last_time > 500 or reason is not None)
        if broken:
            chunk += 1
            counts["discontinuities"] += 1
        pending_break = index in breaks
        last_context, last_time = context, t
        if reason is not None:
            counts["excluded_" + reason] += 1
            counts["excluded_" + task + "_" + reason] += 1
            continue
        samples.append(FrameSample(participant, capture, context, chunk, t,
                                   int(task == "deviation"), features))
        counts["valid_" + task] += 1
    counts["dropped_frames_declared"] = data["droppedFrames"]
    counts["frames"] = len(samples)
    counts["observed_trials"] = len(trials)
    counts["trials_without_frames"] = len(trials - {sample.trial for sample in samples})
    return samples, dict(counts), reference
