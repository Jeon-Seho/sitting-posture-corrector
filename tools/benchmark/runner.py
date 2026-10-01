"""Sequential requests per worker, with explicitly configured concurrency between workers."""

import copy
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from ..runtime import ROOT
from ..service_contract import (
    validate_feature_response, validate_inference_request_v2,
    validate_observation, validate_view,
)
from .http import HttpClient
from .manifest import sha256, utc_now
from .measurement import Sample, summarize


FIXTURE = ROOT / "contracts/examples/v2/synthetic-feature-request.json"
POLICY = {"hold_ms": 3000, "recovery_ms": 2000, "reminder_ms": 60000, "threshold": 0.7}
MODEL_VERSION = "reference-feature-rule-v1"


def load_fixture():
    raw = FIXTURE.read_bytes()
    fixture = json.loads(raw)
    validate_inference_request_v2(fixture)
    return fixture, {
        "path": "contracts/examples/v2/synthetic-feature-request.json",
        "sha256": sha256(raw),
        "data_kind": "explicit synthetic shoulder-relative feature deltas; no capture/participant data",
        "workload": "constant synthetic lateral delta; adjacent 1000ms intervals per worker",
        "generated_fields": ["sequence", "start_ms", "end_ms"],
        "seed": "none; fixed fixture with no random features",
    }


@dataclass
class Worker:
    index: int
    session_id: str
    sequence: int = 0
    end_ms: int = 0
    blocked: bool = False
    created: bool = False


def request_body(fixture, worker):
    body = copy.deepcopy(fixture)
    body.update(sequence=worker.sequence, start_ms=worker.end_ms, end_ms=worker.end_ms + 1000)
    return body


def validate_inferred(value, body):
    validate_observation(value)
    for field in ("sequence", "start_ms", "end_ms", "phase"):
        if value[field] != body[field]:
            raise ValueError("inference response must echo the exact synthetic interval")
    if value["model_version"] != MODEL_VERSION:
        raise ValueError("unexpected inference implementation")
    if not value["valid"] or value["deviation_type"] == "none":
        raise ValueError("this fixed good-quality nonzero synthetic fixture must be measurable")


def validate_session(value, worker, ended=False, initial=False):
    validate_view(value)
    if value["session_id"] != worker.session_id or value["policy"] != POLICY or value["ended"] != ended:
        raise ValueError("session identity, frozen policy or end state mismatch")
    if value["last_sequence"] != (-1 if initial else worker.sequence - 1):
        raise ValueError("session sequence mismatch")
    if value["summary"]["total_ms"] != worker.end_ms:
        raise ValueError("session interval accounting mismatch")


def validate_feature(value, body, worker):
    validate_feature_response(value, body)
    validate_inferred(value["observation"], body)
    session = value["session"]
    if session["session_id"] != worker.session_id or session["policy"] != POLICY or session["ended"]:
        raise ValueError("feature response session identity, frozen policy or end state mismatch")
    if session["last_sequence"] != body["sequence"] or session["summary"]["total_ms"] != body["end_ms"]:
        raise ValueError("feature response must acknowledge exactly this adjacent interval")


def allocation(count, offset, index, concurrency):
    """Continue round-robin allocation across warmup and measured phases."""
    return sum((offset + ordinal) % concurrency == index for ordinal in range(count))


def run_phase(name, count, offset, workers, fixture, target, endpoints, client, deadline, clock):
    started_at = utc_now()
    started = clock()
    counts = [allocation(count, offset, worker.index, len(workers)) for worker in workers]

    def run_worker(worker, scheduled):
        samples = []
        for _ in range(scheduled):
            if worker.blocked or clock() >= deadline:
                samples.append(Sample("skipped", skip_reason="session_unavailable" if worker.blocked else "duration_limit"))
                continue
            body = request_body(fixture, worker)
            if target == "infer":
                reply = client.request(endpoints.inference, "/v2/infer", "POST", body,
                                       lambda value: validate_inferred(value, body))
            else:
                reply = client.request(endpoints.api, "/v1/sessions/" + worker.session_id + "/features", "POST", body,
                                       lambda value: validate_feature(value, body, worker))
            samples.append(reply.sample)
            if reply.sample.outcome == "success" or target == "infer":
                worker.sequence += 1
                worker.end_ms += 1000
            else:
                # A timeout may have committed remotely; advancing/retrying would alter the workload.
                # Stop this session rather than conceal uncertainty in the latency sample.
                worker.blocked = True
        return samples

    with ThreadPoolExecutor(max_workers=len(workers)) as executor:
        futures = [executor.submit(run_worker, worker, scheduled) for worker, scheduled in zip(workers, counts)]
        samples = [sample for future in futures for sample in future.result()]
    elapsed = clock() - started
    return {
        "name": name, "started_at": started_at, "finished_at": utc_now(),
        "scheduled_requests_per_worker": counts,
        "active_workers": sum(value > 0 for value in counts),
        **summarize(samples, elapsed),
    }


def run_target(target, config, endpoints, fixture, run_id, client=None, clock=time.perf_counter):
    client = client or HttpClient(config.timeout)
    workers = [Worker(index, str(uuid.uuid5(uuid.UUID(run_id), "synthetic-worker-" + str(index)))) for index in range(config.concurrency)]
    deadline = clock() + config.max_duration
    lifecycle = {"create": [], "end": []}
    if target == "features":
        for worker in workers:
            if clock() >= deadline:
                lifecycle["create"].append(Sample("skipped", skip_reason="duration_limit"))
                worker.blocked = True
                continue
            reply = client.request(endpoints.api, "/v1/sessions/" + worker.session_id, "PUT", {"policy": POLICY},
                                   lambda value: validate_session(value, worker, initial=True))
            lifecycle["create"].append(reply.sample)
            worker.created = reply.sample.outcome == "success"
            worker.blocked = not worker.created
    warmup = run_phase("warmup", config.warmup, 0, workers, fixture, target, endpoints, client, deadline, clock)
    measurement = run_phase("measurement", config.repetitions, config.warmup, workers, fixture, target, endpoints, client, deadline, clock)
    if target == "features":
        for worker in workers:
            if worker.created:
                reply = client.request(endpoints.api, "/v1/sessions/" + worker.session_id + "/end", "POST", {"end_ms": worker.end_ms},
                                       lambda value: validate_session(value, worker, ended=True))
                lifecycle["end"].append(reply.sample)
    return {
        "target": target,
        "scope": "HTTP POST /v2/infer only" if target == "infer" else "HTTP API /features -> inference /v2/infer -> CEP observe -> API snapshot",
        "execution": "sequential" if config.concurrency == 1 else "concurrent independent sessions; sequential requests within each worker",
        "worker_count": len(workers),
        "warmup": warmup, "measurement": measurement,
        "lifecycle_excluded_from_measurement": {key: summarize(value, 0) for key, value in lifecycle.items()},
    }


def target_passed(target):
    stages = [target["warmup"], target["measurement"], *target["lifecycle_excluded_from_measurement"].values()]
    return all(stage["failed"] == 0 and stage["skipped"] == 0 for stage in stages)
