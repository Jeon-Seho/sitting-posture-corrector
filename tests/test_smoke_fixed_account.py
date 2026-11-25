"""(D-108) 점검 도구의 고정 시험 계정 모드 — 가입 이메일 인증이 켜진 서버에서 매회 가입 대신 로그인한다."""

import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools", "platform"))

import io_api_smoke as smoke  # noqa: E402


class FakeClient:
    """정해 둔 응답을 차례로 돌려주고 받은 요청을 기록한다."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def call(self, path, method="GET", body=None):
        self.calls.append((path, method, body))
        return self.responses.pop(0)


class LoadAccountTest(unittest.TestCase):
    def write(self, text):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        handle.write(text)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_no_file_means_synthetic_signup(self):
        self.assertIsNone(smoke.load_account(None))

    def test_reads_email_and_password(self):
        path = self.write(json.dumps({"email": "a@b.c", "password": "pw"}))
        self.assertEqual(smoke.load_account(path), {"email": "a@b.c", "password": "pw"})

    def test_missing_field_stops_without_printing_values(self):
        path = self.write(json.dumps({"email": "a@b.c"}))
        with self.assertRaises(SystemExit) as stopped:
            smoke.load_account(path)
        self.assertNotIn("a@b.c", str(stopped.exception))


class CreateSessionTest(unittest.TestCase):
    def test_waits_out_the_previous_unconnected_session(self):
        busy = (409, {"code": "MEASUREMENT_IN_PROGRESS"})
        client = FakeClient([busy, busy, (200, {"ended": False})])
        with mock.patch.object(smoke.time, "sleep") as sleep:
            status, _ = smoke.create_session(client, "/sessions/x", {"policy": smoke.POLICY})
        self.assertEqual(status, 200)
        self.assertEqual(len(client.calls), 3)
        self.assertEqual(sleep.call_count, 2)

    def test_other_conflicts_return_at_once(self):
        client = FakeClient([(409, {"code": "CONFLICT"})])
        with mock.patch.object(smoke.time, "sleep") as sleep:
            status, _ = smoke.create_session(client, "/sessions/x", {})
        self.assertEqual(status, 409)
        sleep.assert_not_called()

    def test_gives_up_after_the_wait(self):
        busy = (409, {"code": "MEASUREMENT_IN_PROGRESS"})
        client = FakeClient([busy, busy])
        clock = iter([0.0, 10.0, 50.0])
        with mock.patch.object(smoke.time, "sleep"), mock.patch.object(smoke.time, "monotonic", lambda: next(clock)):
            status, _ = smoke.create_session(client, "/sessions/x", {}, wait_s=40)
        self.assertEqual(status, 409)
        self.assertEqual(len(client.calls), 2)


class FixedAccountScenarioTest(unittest.TestCase):
    def run_scenario(self, account):
        seen = []

        def call(self, path, method="GET", body=None):
            seen.append((method, path))
            return (200, {"status": "ok"}) if path == "/health" else (500, None)

        with mock.patch.object(smoke.Client, "call", call), mock.patch("builtins.print"):
            smoke.scenario("http://x", account)
        return seen

    def test_fixed_account_logs_in_instead_of_registering(self):
        seen = self.run_scenario({"email": "a@b.c", "password": "pw"})
        self.assertEqual(seen[1], ("POST", "/auth/login"))
        self.assertNotIn(("POST", "/auth/register"), seen)

    def test_without_account_registers_a_synthetic_account(self):
        seen = self.run_scenario(None)
        self.assertEqual(seen[1], ("POST", "/auth/register"))


class RealtimeFixedAccountErrorTest(unittest.TestCase):
    """(D-108) 고정 시험 계정 모드에서도 측정 중 예외가 main()까지 올라가 FAIL로 세져야 한다."""

    def setUp(self):
        import ws_realtime_smoke as ws  # noqa: E402 — io_api_smoke와 같은 경로에서 읽는다
        self.ws = ws

    def run_scenario(self, account):
        seen = []

        def call(client, path, method="GET", body=None):
            seen.append((method, path))
            if path in ("/auth/login", "/auth/register"):
                return 200, {"user_id": "u", "access_token": "t"}
            if path == "/baselines":
                return 200, {"baseline_id": "b"}
            if path == "/workspace":
                return 200, {"preferences": {"alerts_on": True}}
            if path == "/auth/account":
                return 204, None
            return 200, {}

        broken = mock.Mock(side_effect=RuntimeError("연결 끊김"))
        with mock.patch.object(self.ws.Client, "call", call), mock.patch.object(self.ws.Client, "sign_in"), \
                mock.patch.object(self.ws, "run_socket", broken), mock.patch("builtins.print"):
            with self.assertRaises(RuntimeError):
                self.ws.scenario("http://x", None, "local", account=account)
        return seen

    def test_fixed_account_keeps_the_error_and_does_not_close_the_account(self):
        seen = self.run_scenario({"email": "a@b.c", "password": "pw"})
        self.assertNotIn(("DELETE", "/auth/account"), seen)

    def test_synthetic_account_keeps_the_error_and_closes_the_account(self):
        seen = self.run_scenario(None)
        self.assertIn(("DELETE", "/auth/account"), seen)


if __name__ == "__main__":
    unittest.main()
