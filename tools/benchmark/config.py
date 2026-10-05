"""Explicit workload settings and limits for the current in-memory development services."""

import math
from dataclasses import asdict, dataclass


MAX_CONCURRENCY = 64
MAX_REQUESTS_PER_TARGET = 10000


@dataclass(frozen=True)
class BenchmarkConfig:
    target: str = "both"
    warmup: int = 10
    repetitions: int = 100
    concurrency: int = 1
    timeout: float = 5.0
    max_duration: float = 300.0

    def validate(self):
        if self.target not in ("both", "infer", "features"):
            raise ValueError("target must be both, infer or features")
        if self.warmup < 0 or self.repetitions < 1:
            raise ValueError("warmup must be >=0 and repetitions must be >=1")
        if not 1 <= self.concurrency <= MAX_CONCURRENCY:
            raise ValueError("concurrency must be 1..64 (retained session limit)")
        if self.concurrency > self.repetitions:
            raise ValueError("concurrency cannot exceed measured repetitions")
        if self.warmup + self.repetitions > MAX_REQUESTS_PER_TARGET:
            raise ValueError("warmup + repetitions must be <=10000 per target; no automatic session rotation")
        if not math.isfinite(self.timeout) or not 0 < self.timeout <= 60:
            raise ValueError("timeout must be finite and in (0, 60] seconds")
        if not math.isfinite(self.max_duration) or not 0 < self.max_duration <= 3600:
            raise ValueError("max-duration must be finite and in (0, 3600] seconds")
        return self

    def manifest(self):
        return {
            **asdict(self),
            "count_unit": "total requests per target, not requests per worker",
            "limits": {
                "retained_sessions": MAX_CONCURRENCY,
                "accepted_observations_per_session": 10000,
                "tool_requests_per_target_including_warmup": MAX_REQUESTS_PER_TARGET,
            },
            "interval_ms": 1000,
            "warmup_is_excluded_from_measurement": True,
        }
