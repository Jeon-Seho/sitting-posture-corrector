"""Build variable-length windows from real observed timestamps; no resampling."""

from bisect import bisect_left
from collections import Counter

from .captures import csv_number


def exclusion_reason(sample, mapping):
    row = sample.row
    if row["review_status"] != "accepted":
        return "review_" + row["review_status"]
    if row["measurement_quality"] != "good":
        return "poor_quality"
    if row["manual_label"] in ("unlabeled", "transition"):
        return row["manual_label"]
    if row["presence_label"] != "seated":
        return "presence_" + row["presence_label"]
    if row["pose_training_eligible"] != "1":
        return "not_pose_eligible"
    if row["label_source"] != "self_report_reviewed":
        return "unreviewed_label_source"
    if row["stop_reason"] != "completed":
        return "incomplete_capture"
    if row["manual_label"] not in mapping:
        return "unmapped_posture_label"
    return None


def observation(sample, feature_columns):
    return {
        "sample_index": sample.index,
        "elapsed_ms": sample.elapsed_ms,
        "video_time_ms": sample.video_time_ms,
        "features": [csv_number(sample.row[name], name) for name in feature_columns],
    }


def run_key(sample):
    row = sample.row
    return tuple(row[name] for name in (
        "capture_id", "segment_id", "calibration_id", "schema_version", "pose_model",
        "feature_version", "manual_label", "measurement_quality", "label_source",
        "task_id", "activity",
    ))


def continuous_runs(capture, config):
    runs, current = [], []
    excluded, breaks = Counter(), Counter()
    for sample in capture.samples:
        reason = exclusion_reason(sample, config.label_mapping)
        # An excluded row flushes the run before dropping it. Its two sides never reconnect.
        boundary = bool(sample.break_before) or (current and run_key(current[-1]) != run_key(sample))
        if reason or boundary:
            if current:
                runs.append(tuple(current))
                current = []
            if reason:
                excluded[reason] += 1
            if boundary:
                breaks.update(sample.break_before or ("metadata_boundary",))
        if reason is None:
            # Missing/nonfinite numeric features are corrupt input, never a filled normal sample.
            observation(sample, config.feature_columns)
            current.append(sample)
    if current:
        runs.append(tuple(current))
    return runs, dict(excluded), dict(breaks)


def windows_for_run(run, capture, config, role):
    times = [sample.elapsed_ms for sample in run]
    start_index = 0
    while start_index < len(run):
        start = times[start_index]
        end_index = bisect_left(times, start + config.window.duration_ms, lo=start_index)
        if end_index == len(run):
            break
        selected = run[start_index:end_index + 1]
        if len(selected) >= config.window.min_samples:
            row = selected[0].row
            yield {
                "participant_id": capture.spec.participant_id,
                "split_role": role,
                "capture_id": capture.spec.capture_id,
                "capture_sha256": capture.spec.sha256,
                "segment_id": int(row["segment_id"]),
                "calibration_id": row["calibration_id"],
                "schema_version": row["schema_version"],
                "pose_model": row["pose_model"],
                "feature_version": row["feature_version"],
                "manual_label": row["manual_label"],
                "label": config.label_mapping[row["manual_label"]],
                "start_ms": start,
                "end_ms": selected[-1].elapsed_ms,
                "target_duration_ms": config.window.duration_ms,
                "observations": [observation(sample, config.feature_columns) for sample in selected],
            }
        start_index = bisect_left(times, start + config.window.stride_ms, lo=start_index + 1)


def prepare_capture(capture, config, role):
    runs, excluded, breaks = continuous_runs(capture, config)
    windows = [window for run in runs for window in windows_for_run(run, capture, config, role)]
    return windows, {
        "capture_id": capture.spec.capture_id,
        "rows": len(capture.samples),
        "eligible_rows": sum(len(run) for run in runs),
        "continuous_runs": len(runs),
        "windows": len(windows),
        "excluded_rows": excluded,
        "breaks": breaks,
    }
