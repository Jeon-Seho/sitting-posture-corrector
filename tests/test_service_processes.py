"""Process lifecycle regressions with mocks only; no servers, cameras or real data."""

import io
import subprocess
import unittest
from contextlib import redirect_stderr, redirect_stdout
from urllib.error import HTTPError
from unittest.mock import MagicMock, call, patch

from tools import service_processes as services


class ServiceProcessTests(unittest.TestCase):
    def setUp(self):
        self.endpoints = services.ServiceEndpoints(18001, 18002, 18003)
        self.commands = [["synthetic-cep"], ["synthetic-api"], ["synthetic-inference"]]

    def test_readiness_failure_stops_all_started_processes_and_closes_logs(self):
        processes = [MagicMock(), MagicMock(), MagicMock()]
        for process in processes:
            process.poll.return_value = None
        with patch.object(services, "service_commands", return_value=self.commands), \
                patch.object(services.subprocess, "Popen", side_effect=processes) as launch, \
                patch.object(services, "wait_ready", side_effect=RuntimeError("synthetic readiness failure")), \
                patch.object(services, "assert_ports_closed") as closed, \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "readiness failure"):
                with services.running_services(self.endpoints):
                    self.fail("unready services were yielded")
            for process in processes:
                process.terminate.assert_called_once()
                process.wait.assert_called_once_with(timeout=5)
            self.assertTrue(all(item.kwargs["stdout"].closed for item in launch.call_args_list))
            closed.assert_called_once_with(self.endpoints.ports)

    def test_partial_launch_failure_cleans_only_processes_that_started(self):
        first = MagicMock()
        first.poll.return_value = None
        with patch.object(services, "service_commands", return_value=self.commands), \
                patch.object(services.subprocess, "Popen", side_effect=[first, OSError("synthetic launch failure")]) as launch, \
                patch.object(services, "wait_ready") as ready, \
                patch.object(services, "assert_ports_closed") as closed, \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(OSError, "launch failure"):
                with services.running_services(self.endpoints):
                    self.fail("partial launch was yielded")
            first.terminate.assert_called_once()
            first.wait.assert_called_once_with(timeout=5)
            ready.assert_not_called()
            self.assertTrue(all(item.kwargs["stdout"].closed for item in launch.call_args_list))
            closed.assert_called_once_with(self.endpoints.ports)

    def test_body_interruption_still_cleans_all_processes(self):
        processes = [MagicMock(), MagicMock(), MagicMock()]
        for process in processes:
            process.poll.return_value = None
        with patch.object(services, "service_commands", return_value=self.commands), \
                patch.object(services.subprocess, "Popen", side_effect=processes), \
                patch.object(services, "wait_ready"), \
                patch.object(services, "assert_ports_closed") as closed, \
                redirect_stdout(io.StringIO()):
            with self.assertRaises(KeyboardInterrupt):
                with services.running_services(self.endpoints):
                    raise KeyboardInterrupt
            for process in processes:
                process.terminate.assert_called_once()
                process.wait.assert_called_once_with(timeout=5)
            closed.assert_called_once_with(self.endpoints.ports)

    def test_wait_timeout_kills_the_process_then_waits_again(self):
        process = MagicMock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("synthetic", 5), 0]
        services.stop_processes([process])
        process.terminate.assert_called_once()
        process.kill.assert_called_once()
        self.assertEqual(process.wait.call_args_list, [call(timeout=5), call(timeout=5)])

    def test_already_exited_process_is_reaped_without_termination(self):
        process = MagicMock()
        process.poll.return_value = 0
        services.stop_processes([process])
        process.terminate.assert_not_called()
        process.kill.assert_not_called()
        process.wait.assert_called_once_with(timeout=5)

    def test_missing_session_404_proves_readiness(self):
        process = MagicMock()
        process.poll.return_value = None
        missing = HTTPError("http://127.0.0.1:18002/v1/sessions/synthetic", 404, "missing", {}, None)
        with patch.object(services, "urlopen", side_effect=missing), \
                patch.object(services.time, "sleep") as sleep:
            services.wait_ready(self.endpoints.api, "/v1/sessions/synthetic", [process])
            sleep.assert_not_called()

    def test_process_exit_and_readiness_timeout_are_explicit_failures(self):
        process = MagicMock()
        process.poll.return_value = 1
        with patch.object(services, "urlopen") as request:
            with self.assertRaisesRegex(RuntimeError, "exited before ready"):
                services.wait_ready(self.endpoints.api, "/", [process])
            request.assert_not_called()
        with patch.object(services.time, "monotonic", side_effect=[0, 31]), \
                patch.object(services, "urlopen") as request:
            with self.assertRaisesRegex(RuntimeError, "readiness timeout"):
                services.wait_ready(self.endpoints.api, "/", [])
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
