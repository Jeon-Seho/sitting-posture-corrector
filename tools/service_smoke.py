"""Verify the three loopback services using only explicit synthetic inputs.

No camera, credentials, accounts, databases or participant data are used.
Server startup and cleanup live in service_processes; this module owns scenarios.
"""

import json
import sys
import uuid
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen

if __package__:
    from .frontend_proxy import running_frontend_proxy
    from .http_response_fault import running_response_fault
    from .service_contract import (
        validate_feature_response,
        validate_inference_request_v2,
        validate_observation,
        validate_view,
    )
    from .service_processes import ServiceEndpoints, running_services
else:
    from frontend_proxy import running_frontend_proxy
    from http_response_fault import running_response_fault
    from service_contract import (
        validate_feature_response,
        validate_inference_request_v2,
        validate_observation,
        validate_view,
    )
    from service_processes import ServiceEndpoints, running_services


def request(base, path, method="GET", body=None, expected=200):
    data = None if body is None else json.dumps(body, allow_nan=False).encode()
    http_request = Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(http_request, timeout=10) as response:
            status, raw = response.status, response.read()
    except HTTPError as error:
        status, raw = error.code, error.read()
    assert status == expected, (path, status, raw[:200])
    return json.loads(raw) if raw else None


class SyntheticSession:
    """Feed ordered feature intervals through inference and API contract checks."""

    def __init__(self, endpoints):
        self.endpoints = endpoints
        self.path = "/v1/sessions/" + str(uuid.uuid4())
        self.sequence = 0
        self.observations = []

    def query(self):
        return request(self.endpoints.api, self.path)

    def submit(self, observation, expected=200):
        return request(
            self.endpoints.api,
            self.path + "/observations",
            "POST",
            observation,
            expected=expected,
        )

    def feed(self, start, end, forward, phase="running", quality="good"):
        result = None
        while start < end:
            next_end = min(end, start + 1000)
            features = {
                "schema_version": "1.0",
                "sequence": self.sequence,
                "start_ms": start,
                "end_ms": next_end,
                "phase": phase,
                "measurement_quality": quality,
                "features": {"forward_delta": forward, "lateral_delta": 0.0},
            }
            observation = request(self.endpoints.inference, "/v1/infer", "POST", features)
            validate_observation(observation)
            self.observations.append(observation)
            result = self.submit(observation)
            validate_view(result)
            self.sequence += 1
            start = next_end
        return result


class SyntheticFeatureSession(SyntheticSession):
    """Exercise the browser-facing API using hand-written synthetic feature windows."""

    def __init__(self, endpoints):
        super().__init__(endpoints)
        self.baseline_id = str(uuid.uuid4())
        self.feature_requests = []

    def feature_request(self, start, end, delta, phase="running", quality="good"):
        return {
            "schema_version": "2.0",
            "feature_version": "shoulder-relative-deltas-v1",
            "baseline_id": self.baseline_id,
            "sequence": self.sequence,
            "start_ms": start,
            "end_ms": end,
            "phase": phase,
            "measurement_quality": quality,
            "features": (
                None if phase != "running" else {
                    "head_gap_delta": delta,
                    "lateral_offset_delta": 0.0,
                    "shoulder_tilt_delta": 0.0,
                    "current_quality": 0.9,
                    "baseline_quality": 0.9,
                }
            ),
        }

    def submit_features(self, body, expected=200):
        return request(self.endpoints.api, self.path + "/features", "POST", body, expected)

    def feed_features(self, start, end, delta, phase="running", quality="good"):
        result = None
        while start < end:
            next_end = min(end, start + 1000)
            body = self.feature_request(start, next_end, delta, phase, quality)
            validate_inference_request_v2(body)
            result = self.submit_features(body)
            validate_feature_response(result, body)
            self.feature_requests.append(body)
            self.observations.append(result["observation"])
            self.sequence += 1
            start = next_end
        return result["session"]


def verify_browser_facing_features(endpoints, policy):
    session = SyntheticFeatureSession(endpoints)
    create_session(session, policy)
    assert session.feed_features(0, 2999, -0.22)["summary"]["collapse_count"] == 0
    confirmed = session.feed_features(2999, 3000, -0.22)
    assert confirmed["summary"]["alert_count"] == 1
    assert confirmed["events"][0]["deviation_type"] == "unspecified"
    duplicate = session.submit_features(session.feature_requests[-1])
    validate_feature_response(duplicate)
    assert duplicate["session"] == confirmed

    assert session.feed_features(3000, 5000, 0.0)["summary"]["mean_recovery_ms"] == 2000
    session.feed_features(5000, 15000, 0.0, phase="rest")
    after_rest = session.feed_features(15000, 18000, -0.22)
    assert after_rest["summary"]["valid_ms"] == 8000
    assert after_rest["summary"]["rest_ms"] == 10000
    assert after_rest["summary"]["collapse_count"] == 2
    assert after_rest["summary"]["alert_count"] == 2
    assert after_rest["summary"]["mean_interval_ms"] == 5000

    changed_baseline = dict(session.feature_requests[-1], baseline_id=str(uuid.uuid4()))
    session.submit_features(changed_baseline, expected=409)
    changed_body = dict(session.feature_requests[-1], measurement_quality="poor")
    session.submit_features(changed_body, expected=409)
    assert session.query() == after_rest

    # The skipped second and low quality interrupt the episode, never add normal time.
    session.feed_features(19000, 20000, -0.22, quality="poor")
    after_missing = session.feed_features(20000, 23000, -0.22)
    assert after_missing["summary"]["missing_ms"] == 1000
    assert after_missing["summary"]["unknown_ms"] == 1000
    assert after_missing["summary"]["collapse_count"] == 3

    ended = request(endpoints.api, session.path + "/end", "POST", {"end_ms": 23000})
    validate_view(ended)
    assert ended["ended"]
    assert request(endpoints.api, session.path + "/end", "POST", {"end_ms": 23000}) == ended
    session.submit_features(session.feature_request(23000, 24000, -0.22), expected=409)
    print(
        "PASS: API feature input -> FastAPI v2 -> CEP; frozen baseline, exact retry, "
        "interruption and final acknowledgement"
    )


def verify_inference_dependency_loss(endpoints, policy, inference_process):
    session = SyntheticFeatureSession(endpoints)
    create_session(session, policy)
    saved = session.query()
    inference_process.terminate()
    inference_process.wait(timeout=5)
    session.submit_features(session.feature_request(0, 1000, -0.22), expected=502)
    assert session.query() == saved
    print("PASS: inference failure preserves the last acknowledged API snapshot")


def verify_feature_reminder_boundary(endpoints, policy):
    session = SyntheticFeatureSession(endpoints)
    create_session(session, policy)
    before = session.feed_features(0, 62999, -0.22)
    assert before["summary"]["alert_count"] == 1
    assert before["events"][0]["timestamp_ms"] == 3000
    exact = session.feed_features(62999, 63000, -0.22)
    assert exact["summary"]["alert_count"] == 2
    assert [event["kind"] for event in exact["events"]] == ["collapse_confirmed", "reminder"]
    assert exact["events"][-1]["timestamp_ms"] == 63000
    duplicate = session.submit_features(session.feature_requests[-1])
    validate_feature_response(duplicate, session.feature_requests[-1])
    assert duplicate["session"] == exact
    after = session.feed_features(63000, 63001, -0.22)
    assert after["summary"]["alert_count"] == 2
    ended = request(endpoints.api, session.path + "/end", "POST", {"end_ms": 63001})
    validate_view(ended)
    print("PASS: feature HTTP reminder before/exact/after 60s since first alert; exact retry once")


def verify_custom_feature_policy(endpoints):
    policy = {"policy": {
        "hold_ms": 4000, "recovery_ms": 3500, "reminder_ms": 7000, "threshold": 0.8,
    }}
    session = SyntheticFeatureSession(endpoints)
    create_session(session, policy)
    assert session.feed_features(0, 3999, -0.44)["summary"]["collapse_count"] == 0
    assert session.feed_features(3999, 4000, -0.44)["summary"]["collapse_count"] == 1
    assert session.feed_features(4000, 10999, -0.44)["summary"]["alert_count"] == 1
    exact = session.feed_features(10999, 11000, -0.44)
    assert exact["summary"]["alert_count"] == 2
    assert session.submit_features(session.feature_requests[-1])["session"] == exact
    assert session.feed_features(11000, 14499, 0)["summary"]["mean_recovery_ms"] is None
    recovered = session.feed_features(14499, 14500, 0)
    assert recovered["summary"]["mean_recovery_ms"] == 10500
    assert recovered["events"][-1]["kind"] == "recovery_confirmed"
    changed = {"policy": dict(policy["policy"], hold_ms=3000)}
    request(endpoints.api, session.path, "PUT", changed, expected=409)
    assert session.query() == recovered
    assert recovered["policy"] == policy["policy"]
    ended = request(endpoints.api, session.path + "/end", "POST", {"end_ms": 14500})
    validate_view(ended)
    print("PASS: feature HTTP custom hold/recovery/reminder boundaries and frozen policy")


def verify_response_loss_after_commit(endpoints, policy):
    with running_response_fault(endpoints) as fault:
        session = SyntheticFeatureSession(SimpleNamespace(api=fault.api))
        create_session(session, policy)
        session.feed_features(0, 2000, -0.22)
        saved = session.query()
        body = session.feature_request(2000, 3000, -0.22)
        session.submit_features(body, expected=502)
        assert session.query() == saved
        committed = request(endpoints.cep, session.path.replace("/v1", "/internal"))
        validate_view(committed)
        assert committed["last_sequence"] == 2
        assert committed["summary"]["valid_ms"] == 3000
        assert committed["summary"]["collapse_count"] == 1
        assert committed["summary"]["alert_count"] == 1
        request(fault.api, session.path + "/end", "POST", {"end_ms": 3000}, expected=409)
        session.submit_features(dict(body, sequence=3, start_ms=3000, end_ms=4000), expected=409)
        retry = session.submit_features(body)
        validate_feature_response(retry, body)
        assert retry["session"] == committed
        assert fault.inference_calls == 3
        assert fault.suppressed_responses == 1
        assert len(fault.observation_digests) == 4
        assert fault.observation_digests[-2] == fault.observation_digests[-1]
        assert session.submit_features(body)["session"] == committed
        assert fault.inference_calls == 3
        ended = request(fault.api, session.path + "/end", "POST", {"end_ms": 3000})
        assert ended["ended"]
        assert ended["summary"]["valid_ms"] == 3000
        assert ended["summary"]["collapse_count"] == 1
        assert ended["summary"]["alert_count"] == 1
        validate_view(ended)
        print("PASS: CEP committed but 200 response lost; faulted frame inferred once, identical CEP retry")


def create_session(session, policy):
    initial = request(session.endpoints.api, session.path, "PUT", policy)
    validate_view(initial)
    assert initial["summary"]["keep_rate"] is None
    assert request(session.endpoints.api, session.path, "PUT", policy) == initial


def verify_thresholds_and_statistics(session):
    assert session.feed(0, 2999, 0.9)["summary"]["collapse_count"] == 0
    assert session.feed(2999, 3000, 0.9)["summary"]["alert_count"] == 1
    assert session.submit(session.observations[-1])["summary"]["alert_count"] == 1
    assert session.feed(3000, 5000, 0.1)["summary"]["mean_recovery_ms"] == 2000
    session.feed(5000, 15000, 0.9, phase="rest")
    session.feed(15000, 18000, 0.9)

    result = session.query()
    assert result["summary"]["valid_ms"] == 8000
    assert result["summary"]["rest_ms"] == 10000
    assert result["summary"]["mean_interval_ms"] == 5000
    assert result["summary"]["collapse_count"] == 2
    return result


def verify_rejected_inputs_preserve_snapshot(session, snapshot):
    conflicting = dict(session.observations[-1], collapse_probability=0.1)
    session.submit(conflicting, expected=409)
    reversed_input = dict(
        session.observations[-1],
        sequence=session.sequence,
        start_ms=0,
        end_ms=1000,
    )
    session.submit(reversed_input, expected=409)
    assert session.query() == snapshot


def verify_end_is_idempotent(session):
    ended = request(session.endpoints.api, session.path + "/end", "POST", {"end_ms": 18000})
    validate_view(ended)
    assert ended["ended"]
    assert request(
        session.endpoints.api, session.path + "/end", "POST", {"end_ms": 18000}
    ) == ended
    after_end = dict(
        session.observations[-1],
        sequence=session.sequence,
        start_ms=18000,
        end_ms=19000,
    )
    session.submit(after_end, expected=409)
    assert session.query() == ended


def verify_dependency_loss(endpoints, other_session, cep_process):
    # Dependency loss is visible and never erases the last saved API snapshot.
    cep_process.terminate()
    cep_process.wait(timeout=5)
    request(endpoints.api, other_session + "/end", "POST", {"end_ms": 0}, expected=502)
    assert request(endpoints.api, other_session)["ended"] is False


def verify_service_flow(endpoints, processes):
    policy = {
        "policy": {
            "hold_ms": 3000,
            "recovery_ms": 2000,
            "reminder_ms": 60000,
            "threshold": 0.7,
        }
    }
    session = SyntheticSession(endpoints)
    create_session(session, policy)
    snapshot = verify_thresholds_and_statistics(session)
    verify_rejected_inputs_preserve_snapshot(session, snapshot)

    other_session = "/v1/sessions/" + str(uuid.uuid4())
    assert request(endpoints.api, other_session, "PUT", policy)["summary"]["interval_count"] == 0
    verify_end_is_idempotent(session)
    with running_frontend_proxy(endpoints.api, processes) as frontend:
        verify_browser_facing_features(SimpleNamespace(api=frontend + "/api"), policy)
        verify_feature_reminder_boundary(SimpleNamespace(api=frontend + "/api"), policy)
        verify_custom_feature_policy(SimpleNamespace(api=frontend + "/api"))
        print("PASS: same-origin Vite proxy -> API feature route -> FastAPI v2 -> CEP")
    verify_response_loss_after_commit(endpoints, policy)
    verify_inference_dependency_loss(endpoints, policy, processes[2])
    verify_dependency_loss(endpoints, other_session, processes[0])
    print(
        "PASS: synthetic FastAPI -> API -> Esper -> stored query; boundaries, "
        "rest exclusion, idempotency, sessions, dependency failure"
    )


def main():
    endpoints = ServiceEndpoints.allocate()
    with running_services(endpoints) as processes:
        verify_service_flow(endpoints, processes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
