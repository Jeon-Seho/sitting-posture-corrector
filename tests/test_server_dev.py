"""Development lifecycle tests use fake processes and never request a camera."""

import io
import unittest
from contextlib import contextmanager, redirect_stdout
from unittest.mock import MagicMock, patch

from tools import frontend_proxy, server_dev
from tools.service_processes import ServiceEndpoints


class ServerDevTests(unittest.TestCase):
    def setUp(self):
        self.endpoints = ServiceEndpoints(18001, 18002, 18003)
        self.services = [MagicMock(), MagicMock(), MagicMock()]
        self.vite = MagicMock()
        for process in [*self.services, self.vite]:
            process.poll.return_value = None
        self.cleaned = []

    @contextmanager
    def running_services(self, endpoints):
        self.assertEqual(endpoints, self.endpoints)
        try:
            yield self.services
        finally:
            self.cleaned.append("services")

    @contextmanager
    def running_frontend(self, api, services, *, on_started):
        self.assertEqual(api, self.endpoints.api)
        self.assertIs(services, self.services)
        on_started(self.vite)
        try:
            yield "http://127.0.0.1:18004"
        finally:
            self.cleaned.append("frontend")

    def run_dev(self, sleep):
        with patch.object(server_dev.ServiceEndpoints, "allocate", return_value=self.endpoints), \
                patch.object(server_dev, "running_services", self.running_services), \
                patch.object(server_dev, "running_frontend_proxy", self.running_frontend), \
                patch.object(server_dev.time, "sleep", sleep), redirect_stdout(io.StringIO()):
            server_dev.dev_server()

    def test_vite_death_is_detected_and_both_contexts_are_cleaned(self):
        self.vite.poll.return_value = 1
        sleep = MagicMock()
        with self.assertRaisesRegex(RuntimeError, "프론트"):
            self.run_dev(sleep)
        sleep.assert_not_called()
        self.vite.poll.assert_called_once()
        self.assertEqual(self.cleaned, ["frontend", "services"])

    def test_backend_death_is_detected_and_both_contexts_are_cleaned(self):
        self.services[1].poll.return_value = 1
        with self.assertRaises(RuntimeError):
            self.run_dev(MagicMock())
        self.assertEqual(self.cleaned, ["frontend", "services"])

    def test_ctrl_c_unwinds_frontend_and_service_contexts(self):
        sleep = MagicMock(side_effect=KeyboardInterrupt)
        with self.assertRaises(KeyboardInterrupt):
            self.run_dev(sleep)
        sleep.assert_called_once_with(0.25)
        self.assertEqual(self.cleaned, ["frontend", "services"])

    def test_proxy_keeps_url_interface_and_reports_ready_process_to_observer(self):
        for observer in (None, MagicMock()):
            with self.subTest(observer=observer is not None):
                process = MagicMock()
                with patch.object(frontend_proxy.shutil, "which", return_value="/synthetic/node"), \
                        patch.object(frontend_proxy.Path, "is_file", return_value=True), \
                        patch.object(frontend_proxy, "free_port", return_value=18004), \
                        patch.object(frontend_proxy.subprocess, "Popen", return_value=process), \
                        patch.object(frontend_proxy, "wait_ready") as ready, \
                        patch.object(frontend_proxy, "stop_processes") as stop, \
                        patch.object(frontend_proxy, "assert_ports_closed") as closed, \
                        redirect_stdout(io.StringIO()):
                    kwargs = {} if observer is None else {"on_started": observer}
                    with frontend_proxy.running_frontend_proxy(self.endpoints.api, self.services, **kwargs) as url:
                        self.assertEqual(url, "http://127.0.0.1:18004")
                        ready.assert_called_once_with(url, "/", [*self.services, process])
                        if observer is not None:
                            observer.assert_called_once_with(process)
                    stop.assert_called_once_with([process])
                    closed.assert_called_once_with([18004])

    def test_proxy_readiness_failure_stops_process_and_does_not_notify_observer(self):
        process = MagicMock()
        observer = MagicMock()
        with patch.object(frontend_proxy.shutil, "which", return_value="/synthetic/node"), \
                patch.object(frontend_proxy.Path, "is_file", return_value=True), \
                patch.object(frontend_proxy, "free_port", return_value=18004), \
                patch.object(frontend_proxy.subprocess, "Popen", return_value=process), \
                patch.object(frontend_proxy, "wait_ready", side_effect=RuntimeError("synthetic Vite readiness failure")), \
                patch.object(frontend_proxy, "stop_processes") as stop, \
                patch.object(frontend_proxy, "assert_ports_closed") as closed, \
                redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "Vite readiness failure"):
                with frontend_proxy.running_frontend_proxy(self.endpoints.api, self.services, on_started=observer):
                    self.fail("unready frontend was yielded")
            observer.assert_not_called()
            stop.assert_called_once_with([process])
            closed.assert_called_once_with([18004])


if __name__ == "__main__":
    unittest.main()
