"""D-97 단계 안내형 통신 시험 도구 — 로그 파싱·판정·단계 흐름(서버 없이, 합성 신호만)."""

import importlib.util
import json
import sys
import threading
import time
import unittest
from argparse import Namespace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("comm_test_guided", ROOT / "tools/platform/comm_test_guided.py")
ct = importlib.util.module_from_spec(SPEC)
sys.modules["comm_test_guided"] = ct
SPEC.loader.exec_module(ct)

SID = "3aad2fd2-1111-4222-8333-444455556666"
OTHER = "9bbe0000-1111-4222-8333-444455556666"


def gw(method, path, status):
    return ct.parse_gateway(f'172.18.0.1 - - [17/Nov/2026:10:00:00 +0900] "{method} {path} HTTP/1.1" {status} 12 "-" "ua"')


def kf(topic, kind, body=None, sid=SID):
    return ct.parse_kafka(topic, json.dumps({"session_id": sid, "kind": kind, "body": body or {}}))


def decision(kind, event_id, t, sid=SID):
    return kf("posture.episodes", "decision", {"event": {"kind": kind, "event_id": event_id, "timestamp_ms": t}},
              sid)


def alert(event_id, sid=SID):
    return kf("posture.alerts", "alert", {"kind": "collapse_confirmed", "event_id": event_id}, sid)


def started(hold=5000, reminder=30000, sid=SID):
    return kf("posture.features", "session_started", {"policy": {"hold_ms": hold, "reminder_ms": reminder}}, sid)


WS = gw("GET", "/api/realtime", 101)


class FakeOps:
    def __init__(self, counters=None):
        self.counter_values = list(counters or [])
        self.calls = []
        self.dry_run = False
        self.api_stopped = False

    def counters(self):
        return self.counter_values.pop(0) if self.counter_values else None

    def stop_api_server(self):
        self.calls.append("stop")
        self.api_stopped = True

    def start_api_server(self):
        self.calls.append("start")
        self.api_stopped = False


class FakeDb:
    def __init__(self, row=None):
        self.row = row

    def session(self, client):
        return self.row


def make_ctx(mode="kafka", ops=None, db=None, answers=None, wait=1.5):
    args = Namespace(mode=mode, login="both", api_prefix="/api", io_prefix="", hold_ms=5000,
                     reminder_ms=30000, wait_user=wait)
    lines = []
    replies = list(answers or [])
    ctx = ct.Ctx(args, ct.Bus(), ops or FakeOps(), db or FakeDb(), out=lines.append,
                 ask=lambda q: replies.pop(0) if replies else "y")
    ctx.result = ct.Result("T", "t", "-", "PASS")
    ctx.lines = lines
    return ctx


def feed(bus, events, delay=0.05):
    def run():
        for ev in events:
            time.sleep(delay)
            bus.add(ev)
    th = threading.Thread(target=run, daemon=True)
    th.start()
    return th


class ParsingTest(unittest.TestCase):
    def test_gateway_drops_query_and_masks_uuid(self):
        ev = gw("GET", "/api/auth/social/discord/callback?code=SECRET&state=XYZ", 302)
        self.assertEqual(ev.path, "/api/auth/social/discord/callback")
        self.assertEqual(ev.status, 302)
        self.assertNotIn("SECRET", ev.line())
        put = gw("PUT", f"/api/sessions/{SID}", 200)
        self.assertIn("3aad2fd2…", put.line())
        self.assertNotIn(SID, put.line())

    def test_gateway_ignores_health_and_non_requests(self):
        self.assertIsNone(gw("GET", "/health", 200))
        self.assertIsNone(ct.parse_gateway("2026/11/17 10:00:00 [notice] 1#1: signal process started"))

    def test_kafka_keeps_kind_and_ids_only(self):
        ev = kf("posture.features", "features", {"sequence": 7, "features": [0.1, 0.2], "points": [[1, 2]]})
        self.assertEqual(ev.extra, "seq=7")
        self.assertNotIn("0.1", ev.line())
        d = decision("collapse_confirmed", 3, 5065)
        self.assertEqual((d.event, d.event_id, d.ts_ms), ("collapse_confirmed", 3, 5065))
        self.assertEqual(started().ts_ms, (5000, 30000))
        self.assertEqual(ct.parse_kafka("posture.dlq", "not json").kind, "dead-letter")
        self.assertIsNone(ct.parse_kafka("posture.alerts", "not json"))

    def test_offsets_and_lag(self):
        self.assertEqual(ct.parse_offsets("posture.alerts:0:100\nposture.alerts:1:166\n"), 266)
        out = ("\nGROUP TOPIC PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG CONSUMER-ID HOST CLIENT-ID\n"
               "judge posture.inference 0 10 12 2 c1 /1 x\n"
               "judge posture.inference 1 5 5 0 c1 /1 x\n"
               "io-ws-io-api posture.episodes.v1 1 0 285 285 - - -\n")
        self.assertEqual(ct.parse_lag(out), 2)   # 옛 이름 토픽(.v1)의 남은 lag는 빼고
        self.assertIsNone(ct.parse_lag("Consumer group 'x' does not exist."))

    def test_counter_delta_and_reason(self):
        before = {"alertsPublished": 42, "alertsSkippedOff": 23, "alertsSkippedStale": 0}
        after = {"alertsPublished": 42, "alertsSkippedOff": 24, "alertsSkippedStale": 0}
        delta = ct.counter_delta(before, after)
        self.assertEqual(delta, {"alertsSkippedOff": 1})
        self.assertIn("D-96", ct._no_alert_reason(delta))
        self.assertIn("늦은", ct._no_alert_reason({"alertsSkippedStale": 2}))
        self.assertEqual(ct.alert_counters({"alertsPublished": 1, "alertsPublishEnabled": True, "x": 3}),
                         {"alertsPublished": 1})


class PlanTest(unittest.TestCase):
    def test_login_and_mode(self):
        self.assertEqual(ct.plan_steps("local", "basic", None, None, [])[:3], ["S0", "S1a", "S2"])
        self.assertNotIn("S9", ct.plan_steps("local", "basic", None, None, []))
        kafka = ct.plan_steps("kafka", "both", None, None, [])
        self.assertEqual(kafka[:4], ["S0", "S1a", "S1b", "S2"])
        self.assertIn("S9", kafka)
        self.assertEqual(ct.plan_steps("kafka", "both", "S4", None, [])[:2], ["S0", "S4"])
        self.assertEqual(ct.plan_steps("kafka", "both", None, "S9", []), ["S0", "S9"])
        self.assertNotIn("S2", ct.plan_steps("kafka", "both", None, None, ["S2"]))


class StepTest(unittest.TestCase):
    def test_s1a_waits_past_a_failed_login(self):
        c = make_ctx()
        feed(c.bus, [gw("POST", "/api/auth/login", 401), gw("POST", "/api/auth/login", 200),
                     gw("GET", "/api/workspace", 200)])
        ct.step_s1a(c)
        self.assertIn("POST /auth/login 200 (앞선 실패 1번)", c.result.evidence)

    def test_s1a_stops_when_the_app_still_calls_versioned_paths(self):
        c = make_ctx()
        feed(c.bus, [gw("GET", "/api/v2/auth/me", 200), gw("POST", "/api/v2/auth/login", 200)])
        with self.assertRaises(ct.Fail) as err:
            ct.step_s1a(c)
        self.assertIn("버전 붙은 주소(/api/v2/auth/me)", str(err.exception))

    def test_s1b_stops_when_an_email_login_comes_instead_of_discord(self):
        c = make_ctx()
        feed(c.bus, [gw("POST", "/api/auth/logout", 204), gw("POST", "/api/auth/login", 200)])
        with self.assertRaises(ct.Fail) as err:
            ct.step_s1b(c)
        self.assertIn("Discord 대신 이메일 로그인", str(err.exception))

    def test_expect_reports_what_it_is_waiting_for(self):
        c = make_ctx()
        with self.assertRaises(ct.Fail):
            c.cursor().expect(lambda e: False, 0.5, "무언가", heartbeat=0.2)
        self.assertTrue(any("기다리는 중: 무언가" in line for line in c.lines))

    def test_s2_fails_when_settings_never_reach_the_server(self):
        c = make_ctx(wait=0.5)
        feed(c.bus, [gw("GET", "/api/workspace", 200)])
        with self.assertRaises(ct.Fail) as err:
            ct.step_s2(c)
        self.assertIn("D-96", str(err.exception))

    def test_s3_takes_the_kafka_session_and_checks_policy_and_alert_flag(self):
        c = make_ctx(db=FakeDb({"alert_enabled": 1, "ended": 0, "events": 0, "alerts": 0}))
        feed(c.bus, [gw("PUT", f"/api/sessions/{SID}", 200), started(sid=SID), WS])
        ct.step_s3(c)
        self.assertEqual(c.session, SID)

        off = make_ctx(db=FakeDb({"alert_enabled": 0, "ended": 0, "events": 0, "alerts": 0}))
        feed(off.bus, [gw("PUT", f"/api/sessions/{SID}", 200), started(sid=SID), WS])
        with self.assertRaises(ct.Fail) as err:
            ct.step_s3(off)
        self.assertIn("alert_enabled = 0", str(err.exception))

        wrong = make_ctx()
        feed(wrong.bus, [gw("PUT", f"/api/sessions/{SID}", 200), started(reminder=60000), WS])
        with self.assertRaises(ct.Fail) as err:
            ct.step_s3(wrong)
        self.assertIn("reminder 60000", str(err.exception))

    def test_s4_passes_on_confirm_then_alert_of_the_same_event(self):
        ops = FakeOps([{"alertsPublished": 0}, {"alertsPublished": 1}])
        c = make_ctx(ops=ops)
        c.session = SID
        feed(c.bus, [decision("collapse_confirmed", 1, 5065, sid=OTHER), decision("collapse_confirmed", 1, 5065),
                     alert(1)])
        ct.step_s4(c)
        self.assertEqual(c.last_confirm_ms, 5065)
        self.assertEqual(c.result.answers, ["앱에 자세 알림이 떴나요? → y"])

    def test_s4_explains_a_missing_alert(self):
        ops = FakeOps([{"alertsPublished": 0, "alertsSkippedOff": 0}, {"alertsPublished": 0, "alertsSkippedOff": 1}])
        c = make_ctx(ops=ops)
        c.session = SID
        feed(c.bus, [decision("collapse_confirmed", 1, 5065)])
        with self.assertRaises(ct.Fail) as err:
            ct.step_s4(c)
        self.assertIn("알림 꺼짐", str(err.exception))

    def test_screen_answer_no_fails_and_q_aborts(self):
        c = make_ctx(mode="local", answers=["n"])
        with self.assertRaises(ct.Fail):
            ct.step_s4(c)
        c = make_ctx(mode="local", answers=["q"])
        with self.assertRaises(ct.Abort):
            ct.step_s4(c)

    def test_s5_checks_reminder_interval(self):
        c = make_ctx(ops=FakeOps([{}, {}]), wait=0.5)
        c.args.reminder_ms = 1000          # 제한 시간(reminder+20초)을 줄이려고 작게
        c.session, c.last_confirm_ms = SID, 10000
        feed(c.bus, [decision("reminder", 2, 16000), alert(2)])
        with self.assertRaises(ct.Fail) as err:
            ct.step_s5(c)
        self.assertIn("재알림 간격 6.0초", str(err.exception))

    def test_s9_stops_and_restarts_api_server_and_needs_an_s4_query(self):
        ops = FakeOps()
        c = make_ctx(ops=ops, wait=3)
        events = [gw("PUT", f"/api/sessions/{SID}", 200), started()]
        orig_sleep, orig_drain = ct.time.sleep, ct.Cursor.drain
        ct.time.sleep = lambda s: orig_sleep(min(s, 0.05))
        ct.Cursor.drain = lambda self, s: orig_drain(self, min(s, 0.1))

        def stored_after_start():
            while "stop" not in ops.calls:   # 「지금 종료」 안내 뒤 종료
                orig_sleep(0.02)
            c.bus.add(kf("posture.features", "session_ended", {"end_ms": 9000}))
            c.bus.add(gw("GET", f"/api/sessions/{SID}", 200))
            while "start" not in ops.calls:
                orig_sleep(0.02)
            c.bus.add(kf("posture.stored", "session_stored", {"end_ms": 9000}))
            orig_sleep(0.05)
            c.bus.add(gw("GET", f"/api/sessions/{SID}", 200))
        try:
            feed(c.bus, events)
            threading.Thread(target=stored_after_start, daemon=True).start()
            ct.step_s9(c)
        finally:
            ct.time.sleep, ct.Cursor.drain = orig_sleep, orig_drain
        self.assertEqual(ops.calls, ["stop", "start"])
        self.assertFalse(ops.api_stopped)

    def test_s9_rejects_an_end_before_api_server_stopped(self):
        ops = FakeOps()
        c = make_ctx(ops=ops, wait=3)
        orig_sleep = ct.time.sleep
        ct.time.sleep = lambda s: orig_sleep(min(s, 0.05))
        orig_stop = ops.stop_api_server

        def slow_stop():
            orig_sleep(0.3)  # 멈추는 동안(compose stop) 앱이 먼저 종료
            orig_stop()
        ops.stop_api_server = slow_stop
        try:
            feed(c.bus, [gw("PUT", f"/api/sessions/{SID}", 200), started(),
                         kf("posture.features", "session_ended", {"end_ms": 9000})], delay=0.05)
            with self.assertRaises(ct.Fail) as err:
                ct.step_s9(c)
        finally:
            ct.time.sleep = orig_sleep
        self.assertIn("다 멈추기 전에 종료", str(err.exception))

    def test_s9_is_skipped_in_local_mode(self):
        ops = FakeOps()
        ct.step_s9(make_ctx(mode="local", ops=ops))
        self.assertEqual(ops.calls, [])


class WatcherTest(unittest.TestCase):
    def test_child_processes_never_read_the_terminal(self):
        """하위 프로세스가 stdin을 받으면 y/n 입력을 먼저 가져가 질문에서 멈춘다(11/17 S1a 뒤 멈춤)."""
        calls = []

        class FakeProc:
            stdout = iter(())

            def poll(self):
                return 0

        orig = ct.subprocess.Popen
        ct.subprocess.Popen = lambda args, **kw: calls.append((args, kw)) or FakeProc()
        try:
            ct.Watchers(ct.Bus(), ["posture.alerts"], False).start()
        finally:
            ct.subprocess.Popen = orig
        self.assertEqual(len(calls), 2)
        for args, kw in calls:
            self.assertIs(kw.get("stdin"), ct.subprocess.DEVNULL)
            self.assertNotIn("-i", args)
        self.assertIn(f"client.id={ct.CONSUMER_TAG}", calls[1][0])

    def test_kill_script_does_not_match_itself(self):
        self.assertNotIn(ct.CONSUMER_TAG, ct.KILL_CONSUMERS)


def fake_step(outcomes):
    """부를 때마다 outcomes에서 하나씩: None이면 통과, 예외면 던짐."""
    def step(ctx):
        item = outcomes.pop(0)
        if item is not None:
            raise item
    return step


class RunnerTest(unittest.TestCase):
    def run_with(self, steps, answers, ops=None):
        c = make_ctx(ops=ops, answers=answers)
        table = {sid: (sid, f"단계 {sid}", "F", fn) for sid, fn in steps}
        lines = []
        results, final = ct.run_steps(c, [sid for sid, _ in steps], table, out=lines.append)
        return results, final, lines

    def test_retry_replaces_the_failed_attempt(self):
        results, final, _ = self.run_with([("S4", fake_step([ct.Fail("화면 확인 실패"), None]))], ["r"])
        self.assertEqual(final, "PASS")
        self.assertEqual([(r.step, r.status, r.attempts) for r in results], [("S4", "PASS", 2)])

    def test_continue_records_the_failure_and_runs_the_next_step(self):
        results, final, _ = self.run_with([("S4", fake_step([ct.Fail("x")])), ("S5", fake_step([None]))], ["c"])
        self.assertEqual([r.status for r in results], ["FAIL", "PASS"])
        self.assertEqual(final, "FAIL (S4)")

    def test_s0_cannot_be_continued_past(self):
        results, final, _ = self.run_with([("S0", fake_step([ct.Fail("x")])), ("S1a", fake_step([None]))],
                                          ["c", "q"])
        self.assertEqual(len(results), 1)
        self.assertTrue(final.startswith("멈춤 (S0)"))
        self.assertIn("FAIL S0", final)

    def test_tool_errors_are_failures_not_passes(self):
        results, final, _ = self.run_with([("S8", fake_step([RuntimeError("connection lost")]))], ["c"])
        self.assertEqual(results[0].status, "FAIL")
        self.assertIn("도구 오류 RuntimeError", results[0].reason)
        self.assertEqual(final, "FAIL (S8)")

    def test_api_server_is_restarted_before_asking(self):
        ops = FakeOps()

        def stops_then_fails(ctx):
            ctx.ops.stop_api_server()
            raise ct.Fail("x")
        self.run_with([("S9", stops_then_fails)], ["c"], ops=ops)
        self.assertEqual(ops.calls, ["stop", "start"])


class ReportTest(unittest.TestCase):
    def test_report_has_short_session_ids_only(self):
        c = make_ctx()
        c.sessions = [SID]
        r = ct.Result("S4", "확정·알림", "F2·F3", "FAIL", ["확정 id=1", "a|b"], [], "알림 없음", attempts=2)
        out = ROOT / "tests" / "_comm_test_report.md"
        try:
            ct.write_report(out, Namespace(mode="kafka", login="both"), [r], c, "FAIL (S4)")
            text = out.read_text(encoding="utf-8")
        finally:
            out.unlink(missing_ok=True)
        self.assertIn("3aad2fd2", text)
        self.assertNotIn(SID, text)
        self.assertIn("FAIL (시도 2) — 알림 없음", text)
        self.assertIn("a\\|b", text)


if __name__ == "__main__":
    unittest.main()
