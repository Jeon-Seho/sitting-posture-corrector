"""Benchmark safety/statistics/sequencing regression with explicitly synthetic fixtures only."""

import copy
import io
import json
import subprocess
import tempfile
import threading
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from tools.benchmark.config import BenchmarkConfig
from tools.benchmark.http import HttpClient, RejectRedirect, Reply
from tools.benchmark.manifest import is_source_path, source_revision
from tools.benchmark.measurement import Sample, summarize
from tools.benchmark.runner import POLICY, load_fixture, run_target, target_passed
from tools.server_benchmark import benchmark, output_path, write_report


ENDPOINTS = SimpleNamespace(api="http://127.0.0.1:8001", inference="http://127.0.0.1:8002")
EXAMPLES = Path(__file__).resolve().parents[1] / "contracts/examples/v2"
RUN_ID = "11111111-1111-4111-8111-111111111111"


class Response(io.BytesIO):
    status = 200


class FakeFeatureServices:
    """Contract-valid synthetic HTTP stand-in; asserts adjacent ordering within each session."""

    def __init__(self, fail_feature=False):
        self.template = json.loads((EXAMPLES / "synthetic-feature-response.json").read_text())
        self.sessions = {}
        self.feature_sequences = {}
        self.calls = []
        self.lock = threading.Lock()
        self.fail_feature = fail_feature

    def view(self, session_id, sequence, end_ms, ended=False):
        value = copy.deepcopy(self.template["session"])
        value.update(session_id=session_id, last_sequence=sequence, ended=ended)
        value["summary"].update(total_ms=end_ms, valid_ms=end_ms, deviation_ms=end_ms,
                                events_per_hour=0 if end_ms else None, keep_rate=0 if end_ms else None)
        return value

    def request(self, base, path, method, body, validate):
        with self.lock:
            self.calls.append((path, copy.deepcopy(body)))
            session_id = path.split("/")[3] if path.startswith("/v1/sessions/") else None
            if method == "PUT":
                self.sessions[session_id] = (-1, 0)
                self.feature_sequences[session_id] = []
                value = self.view(session_id, -1, 0)
            elif path.endswith("/end"):
                sequence, end_ms = self.sessions[session_id]
                self.assert_end(body, end_ms)
                value = self.view(session_id, sequence, end_ms, ended=True)
            else:
                observation = dict(self.template["observation"])
                for field in ("sequence", "start_ms", "end_ms", "phase"):
                    observation[field] = body[field]
                if path == "/v2/infer":
                    value = observation
                else:
                    sequence, end_ms = self.sessions[session_id]
                    if body["sequence"] != sequence + 1 or body["start_ms"] != end_ms:
                        raise AssertionError("synthetic benchmark reorders a session")
                    if self.fail_feature:
                        self.fail_feature = False
                        return Reply(Sample("timeout"))
                    self.sessions[session_id] = (body["sequence"], body["end_ms"])
                    self.feature_sequences[session_id].append(body["sequence"])
                    value = {"schema_version": "1.0", "observation": observation,
                             "session": self.view(session_id, body["sequence"], body["end_ms"])}
            validate(value)
            return Reply(Sample("success", 2.0, 200), value)

    @staticmethod
    def assert_end(body, accepted_end):
        if body["end_ms"] != accepted_end:
            raise AssertionError("synthetic benchmark ends unacknowledged time")


class BenchmarkConfigAndStatisticsTests(unittest.TestCase):
    def test_rejects_capacity_overrun_nonfinite_timeout_and_ambiguous_concurrency(self):
        for settings in (
            {"warmup": -1}, {"repetitions": 0}, {"concurrency": 65},
            {"concurrency": 2, "repetitions": 1}, {"warmup": 1, "repetitions": 10000},
            {"timeout": float("nan")}, {"timeout": 61}, {"max_duration": float("inf")},
        ):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                BenchmarkConfig(**settings).validate()
        self.assertEqual(BenchmarkConfig(warmup=0, repetitions=10000, concurrency=64).validate().repetitions, 10000)

    def test_failed_and_skipped_requests_never_enter_success_percentiles(self):
        samples = [Sample("success", value, 200) for value in (1, 2, 3, 4, 5)]
        samples.extend([Sample("timeout", 9999), Sample("contract_error", 9999, 200), Sample("skipped", skip_reason="duration_limit")])
        summary = summarize(samples, 2)
        self.assertEqual(summary["success_latency_ms"]["median"], 3)
        self.assertEqual(summary["success_latency_ms"]["p95"], 5)
        self.assertEqual((summary["successful"], summary["failed"], summary["skipped"]), (5, 2, 1))
        self.assertEqual(summary["successful_requests_per_second"], 2.5)
        self.assertEqual(summary["attempted_requests_per_second"], 3.5)
        self.assertEqual(summary["skip_counts"], {"duration_limit": 1})

    def test_all_failures_report_unavailable_latency_instead_of_zero(self):
        summary = summarize([Sample("unreachable")], 1)
        self.assertIsNone(summary["success_latency_ms"]["median"])
        self.assertIsNone(summary["success_latency_ms"]["p95"])
        self.assertEqual(summary["successful_requests_per_second"], 0)


class BenchmarkHttpTests(unittest.TestCase):
    def test_measures_body_completion_before_contract_validation(self):
        times = iter((1.0, 1.125))
        calls = []

        def opener(request, timeout):
            calls.append((request, timeout))
            return Response(b'{"explicit_synthetic":true}')

        reply = HttpClient(5, opener=opener, clock=lambda: next(times)).request(
            ENDPOINTS.inference, "/v2/infer", "POST", {}, lambda value: self.assertTrue(value["explicit_synthetic"]),
        )
        self.assertEqual(reply.sample.latency_ms, 125)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], 5)

    def test_malformed_or_mismatched_success_body_is_a_contract_failure(self):
        for raw in (b"not-json", b'{"sequence":999}'):
            with self.subTest(raw=raw):
                client = HttpClient(5, opener=lambda *args, **kwargs: Response(raw))
                reply = client.request(ENDPOINTS.api, "/synthetic", "POST", {}, lambda value: self.assertEqual(value["sequence"], 0))
                self.assertEqual(reply.sample.outcome, "contract_error")
                self.assertIsNone(reply.sample.latency_ms)

    def test_timeout_unreachable_and_http_error_are_separate_and_not_retried(self):
        for error, expected in (
            (TimeoutError(), "timeout"), (URLError(TimeoutError()), "timeout"),
            (URLError(ConnectionRefusedError()), "unreachable"),
            (HTTPError(ENDPOINTS.api, 502, "synthetic", {}, io.BytesIO(b"synthetic error")), "http_error"),
            (OSError("synthetic transport failure"), "transport_error"),
        ):
            with self.subTest(expected=expected):
                with patch("tools.benchmark.http.build_opener") as builder:
                    opener = builder.return_value.open
                    opener.side_effect = error
                    reply = HttpClient(1, opener=opener).request(ENDPOINTS.api, "/synthetic", "POST", {}, lambda value: None)
                    self.assertEqual(reply.sample.outcome, expected)
                    self.assertIsNone(reply.sample.latency_ms)
                    opener.assert_called_once()

    def test_remote_or_authenticated_address_is_rejected_before_io(self):
        for base in ("https://127.0.0.1:8001", "http://example.invalid", "http://user:password@127.0.0.1:8001"):
            with self.subTest(base=base), self.assertRaises(ValueError):
                HttpClient(1).request(base, "/synthetic", "POST", {}, lambda value: None)

    def test_default_transport_disables_environment_proxies_and_redirects(self):
        with patch("tools.benchmark.http.build_opener") as builder:
            client = HttpClient(1)
            handlers = builder.call_args.args
            self.assertEqual(handlers[0].proxies, {})
            self.assertIsInstance(handlers[1], RejectRedirect)
            self.assertIsNone(handlers[1].redirect_request(None, None, 302, "synthetic", {}, "http://example.invalid"))
            self.assertEqual(client.opener, builder.return_value.open)


class BenchmarkRunnerTests(unittest.TestCase):
    def test_warmup_and_measurement_share_ordered_worker_sessions_but_separate_statistics(self):
        fixture, _ = load_fixture()
        services = FakeFeatureServices()
        config = BenchmarkConfig(warmup=2, repetitions=5, concurrency=2).validate()
        result = run_target("features", config, ENDPOINTS, fixture, RUN_ID, client=services)
        self.assertEqual(result["warmup"]["successful"], 2)
        self.assertEqual(result["measurement"]["successful"], 5)
        self.assertEqual(result["measurement"]["scheduled_requests_per_worker"], [3, 2])
        self.assertEqual(sorted(services.feature_sequences.values()), [[0, 1, 2], [0, 1, 2, 3]])
        self.assertEqual(result["lifecycle_excluded_from_measurement"]["end"]["successful"], 2)
        self.assertTrue(target_passed(result))

    def test_uncertain_feature_failure_stops_that_session_instead_of_reordering_or_retrying(self):
        fixture, _ = load_fixture()
        services = FakeFeatureServices(fail_feature=True)
        result = run_target("features", BenchmarkConfig(warmup=0, repetitions=3), ENDPOINTS, fixture, RUN_ID, client=services)
        self.assertEqual(result["measurement"]["failure_counts"], {"timeout": 1})
        self.assertEqual(result["measurement"]["skipped"], 2)
        self.assertEqual(sum(path.endswith("/features") for path, _ in services.calls), 1)
        self.assertFalse(target_passed(result))

    def test_inference_failures_do_not_block_independent_later_requests(self):
        fixture, _ = load_fixture()
        calls = []

        def request(base, path, method, body, validate):
            calls.append(body["sequence"])
            return Reply(Sample("unreachable"))

        client = SimpleNamespace(request=request)
        result = run_target("infer", BenchmarkConfig(warmup=1, repetitions=3), ENDPOINTS, fixture, RUN_ID, client=client)
        self.assertEqual(calls, [0, 1, 2, 3])
        self.assertEqual(result["measurement"]["failure_counts"], {"unreachable": 3})
        self.assertFalse(target_passed(result))

    def test_duration_limit_is_explicitly_skipped_and_cannot_pass(self):
        fixture, _ = load_fixture()
        ticks = iter(range(100))
        client = SimpleNamespace(request=lambda *args: self.fail("no request after deadline"))
        result = run_target("infer", BenchmarkConfig(warmup=0, repetitions=3, max_duration=0.01),
                            ENDPOINTS, fixture, RUN_ID, client=client, clock=lambda: next(ticks))
        self.assertEqual(result["measurement"]["skip_counts"], {"duration_limit": 3})
        self.assertFalse(target_passed(result))


class BenchmarkManifestAndOutputTests(unittest.TestCase):
    def test_source_allowlist_includes_analysis_code_and_settings_but_excludes_private_data(self):
        for name in ("model/analysis/dataset/captures.py", "backend/api/src/main/resources/application.properties", "model/analysis/requirements.txt", "tools/benchmark/manifest.py"):
            with self.subTest(name=name):
                self.assertTrue(is_source_path(name))
        for name in ("docs/references/temp.md", "private/example.py", "model/analysis/private/example.py", "model/data/participant.csv", "frontend/dist/main.js", "backend/api/target/example.java"):
            with self.subTest(name=name):
                self.assertFalse(is_source_path(name))

    def test_dirty_hash_covers_new_source_without_opening_private_documents_or_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / "tools").mkdir()
            (root / "tools/example.py").write_text("# explicit synthetic v1\n")
            subprocess.run(["git", "add", "tools/example.py"], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=Synthetic Test", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "synthetic source"], cwd=root, check=True)
            baseline = source_revision(root)
            (root / "tools/new.py").write_text("# explicit synthetic new\n")
            (root / "private").mkdir()
            (root / "private/never-read.py").write_text("# synthetic private sentinel\n")
            try:
                (root / "tools/external.py").symlink_to(root / "private/never-read.py")
            except (OSError, NotImplementedError):
                # Windows may require privileges for symlinks; the hashing/private guard still runs.
                pass
            original_read = Path.read_bytes

            def checked_read(path):
                self.assertNotIn("private", path.parts)
                return original_read(path)

            with patch.object(Path, "read_bytes", checked_read):
                changed = source_revision(root)
            self.assertNotEqual(changed["dirty_source_patch_sha256"], baseline["dirty_source_patch_sha256"])
            self.assertEqual(changed["head"], baseline["head"])
            self.assertEqual([item["path"] for item in changed["untracked_sources"]], ["tools/new.py"])
            (root / "tools/new.py").write_text("# explicit synthetic changed\n")
            self.assertNotEqual(source_revision(root)["dirty_source_patch_sha256"], changed["dirty_source_patch_sha256"])

    def test_output_refuses_tracked_repository_paths_and_existing_external_files(self):
        with self.assertRaises(ValueError):
            output_path("tools/synthetic-benchmark.json", "synthetic")
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "synthetic-report.json"
            write_report(destination, {"explicit_synthetic": True})
            with self.assertRaises(ValueError):
                output_path(str(destination), "synthetic")
            self.assertEqual(json.loads(destination.read_text()), {"explicit_synthetic": True})

    def test_output_refuses_file_and_nested_cache_parent_symlinks_before_resolving(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            cache = root / ".cache/benchmarks"
            destination = cache / "other"
            destination.mkdir(parents=True)
            (destination / "synthetic.json").write_text("{}")
            try:
                (cache / "file.json").symlink_to(destination / "synthetic.json")
                (cache / "parent").symlink_to(destination, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("symlink creation is unavailable on this developer environment")
            with patch("tools.server_benchmark.ROOT", root), patch("tools.server_benchmark.CACHE_OUTPUT", cache):
                for path in (cache / "file.json", cache / "parent/nested/synthetic.json"):
                    with self.subTest(path=path), self.assertRaises(ValueError):
                        output_path(str(path), "synthetic")

    def test_setup_failure_writes_failure_manifest_instead_of_zero_sample_success(self):
        @contextmanager
        def failing_services(endpoints):
            raise RuntimeError("synthetic readiness failure")
            yield

        with tempfile.TemporaryDirectory() as folder, \
                patch("tools.server_benchmark.source_revision", return_value={"head": "synthetic", "dirty_source_patch_sha256": "synthetic"}), \
                patch("tools.server_benchmark.artifact_hashes", return_value={}), \
                patch("tools.server_benchmark.runtime_manifest", return_value={}), \
                patch("tools.server_benchmark.ServiceEndpoints.allocate", return_value=ENDPOINTS), \
                patch("tools.server_benchmark.running_services", failing_services):
            destination = Path(folder) / "synthetic-failed.json"
            report = benchmark(BenchmarkConfig(warmup=0, repetitions=1), destination)
            self.assertFalse(report["all_requested_contract_checks_succeeded"])
            self.assertEqual(report["targets"], [])
            self.assertEqual(report["run_error"]["exception_type"], "RuntimeError")
            self.assertFalse(report["interpretation"]["camera_fps_measured"])
            self.assertIsNone(report["interpretation"]["performance_pass_cutoff"])
            self.assertEqual(json.loads(destination.read_text()), report)

    def test_port_allocation_failure_also_writes_a_failed_manifest_without_starting_services(self):
        with tempfile.TemporaryDirectory() as folder, \
                patch("tools.server_benchmark.source_revision", return_value={"head": "synthetic", "dirty_source_patch_sha256": "synthetic"}), \
                patch("tools.server_benchmark.artifact_hashes", return_value={}), \
                patch("tools.server_benchmark.runtime_manifest", return_value={}), \
                patch("tools.server_benchmark.ServiceEndpoints.allocate", side_effect=OSError("synthetic bind refusal")), \
                patch("tools.server_benchmark.running_services") as services:
            report = benchmark(BenchmarkConfig(warmup=0, repetitions=1), Path(folder) / "synthetic-allocation.json")
            services.assert_not_called()
            self.assertFalse(report["all_requested_contract_checks_succeeded"])
            self.assertEqual(report["run_error"]["exception_type"], "OSError")

    def test_ignored_cache_report_can_be_atomically_replaced_for_repeatable_gate_runs(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder).resolve() / "benchmarks"
            destination = cache / "synthetic-smoke.json"
            with patch("tools.server_benchmark.CACHE_OUTPUT", cache):
                write_report(destination, {"explicit_synthetic": True, "run": 1})
                write_report(destination, {"explicit_synthetic": True, "run": 2})
            self.assertEqual(json.loads(destination.read_text())["run"], 2)
            self.assertEqual(list(cache.iterdir()), [destination])


if __name__ == "__main__":
    unittest.main()
