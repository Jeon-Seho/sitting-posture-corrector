"""Aggregate successful body-completion latency separately from failed/skipped requests."""

import math
import statistics
from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Sample:
    outcome: str
    latency_ms: float = None
    http_status: int = None
    skip_reason: str = None


def summarize(samples, elapsed_seconds):
    successes = [sample.latency_ms for sample in samples if sample.outcome == "success"]
    failures = Counter(sample.outcome for sample in samples if sample.outcome not in ("success", "skipped"))
    statuses = Counter(str(sample.http_status) for sample in samples if sample.http_status is not None)
    ordered = sorted(successes)
    p95 = ordered[math.ceil(0.95 * len(ordered)) - 1] if ordered else None
    skipped = sum(sample.outcome == "skipped" for sample in samples)
    skip_reasons = Counter(sample.skip_reason for sample in samples if sample.outcome == "skipped")
    attempted = len(samples) - skipped
    return {
        "scheduled": len(samples),
        "attempted": attempted,
        "successful": len(successes),
        "failed": sum(failures.values()),
        "skipped": skipped,
        "skip_counts": dict(sorted(skip_reasons.items())),
        "failure_counts": dict(sorted(failures.items())),
        "http_status_counts": dict(sorted(statuses.items())),
        "success_latency_ms": {
            "samples": len(successes),
            "median": statistics.median(successes) if successes else None,
            "p95": p95,
            "p95_method": "nearest rank: sorted[ceil(0.95*n)-1]",
        },
        "phase_elapsed_seconds": elapsed_seconds,
        "successful_requests_per_second": len(successes) / elapsed_seconds if elapsed_seconds > 0 else None,
        "attempted_requests_per_second": attempted / elapsed_seconds if elapsed_seconds > 0 else None,
    }
