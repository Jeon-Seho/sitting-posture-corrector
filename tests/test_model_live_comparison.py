"""Synthetic tests for the local webcam comparison; no participant recordings."""

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import joblib
import numpy as np
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestClassifier
from fastapi.testclient import TestClient

from model.analysis.live_comparison.engine import LiveComparison
from model.analysis.replay_pilot.replay import rule_score


POINTS = ((.5, .4), (.52, .38), (.48, .38), (.54, .4), (.46, .4),
          (.51, .43), (.49, .43), (.6, .6), (.4, .6))
INDICES = (0, 2, 5, 7, 8, 9, 10, 11, 12)


def points(nose_shift=0):
    result = [{"x": .5, "y": .5, "visibility": .99} for _ in range(33)]
    for i, (x, y) in zip(INDICES, POINTS):
        result[i] = {"x": x, "y": y + (nose_shift if i == 0 else 0), "visibility": .99}
    return result


def models():
    x = np.asarray([[0.] * 6, [.25] * 6, [.05] * 6, [.5] * 6])
    classifier = RandomForestClassifier(n_estimators=5, random_state=1).fit(x, [0, 1, 0, 1])
    corrector = DummyRegressor(strategy="constant", constant=0.).fit(np.zeros((2, 7)), [0., 0.])
    return classifier, corrector


class LiveComparisonTest(unittest.TestCase):
    def setUp(self):
        model, corrector = models()
        self.session = LiveComparison(model, corrector, model, .5)

    def send(self, t, sample=None, width=640, height=480):
        return self.session.observe(t, points() if sample is None else sample, width, height)

    def register(self):
        for i in range(31):
            result = self.send(i * 100)
        self.assertEqual(result["status"], "ready")

    def test_registration_and_shared_window_scores(self):
        self.register()
        for i in range(11):
            result = self.send(3100 + i * 100, points(.06))
        self.assertEqual(result["status"], "measured")
        self.assertAlmostEqual(result["rule"]["score"], rule_score(result["features"]))
        self.assertEqual(result["model"]["score"], result["model_uncorrected"]["score"])
        self.assertEqual(result["model"]["deviation"], result["model"]["score"] >= .5)

    def test_invalid_frame_clears_window_and_never_becomes_normal(self):
        self.register()
        for i in range(10):
            self.send(3100 + i * 100, points(.06))
        invalid = self.send(4100, [])
        self.assertEqual(invalid["status"], "unmeasurable")
        self.assertNotIn("rule", invalid)
        self.assertEqual(self.send(4200)["status"], "warming")

    def test_gap_clears_window_and_timestamp_reversal_rejected(self):
        self.register()
        for i in range(10):
            self.send(3100 + i * 100)
        self.assertEqual(self.send(5000)["status"], "warming")
        with self.assertRaises(ValueError):
            self.send(4999)

    def test_wrong_resolution_and_head_turn_are_unmeasurable(self):
        self.register()
        self.assertEqual(self.send(3100, width=1280, height=720)["status"], "unmeasurable")
        turned = points()
        turned[0]["x"] += .15
        self.assertEqual(self.send(3200, turned)["status"], "unmeasurable")

    def test_reset_requires_new_registration(self):
        self.register()
        self.session.reset()
        self.assertEqual(self.send(0)["status"], "registering")


class LocalServerTest(unittest.TestCase):
    def setUp(self):
        from model.analysis.live_comparison.server import create_app
        model, corrector = models()
        self.client = TestClient(create_app(model, corrector, model, .5), base_url="http://127.0.0.1:8765")
        self.origin = {"Origin": "http://127.0.0.1:8765"}

    def test_static_and_local_session(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        response = self.client.post("/api/session", headers=self.origin)
        self.assertEqual(response.status_code, 200)
        token = response.json()["session"]
        frame = {"session": token, "time_ms": 0, "width": 640, "height": 480, "landmarks": points()}
        self.assertEqual(self.client.post("/api/frame", json=frame, headers=self.origin).json()["status"], "registering")
        frame["time_ms"] = 0
        self.assertEqual(self.client.post("/api/frame", json=frame, headers=self.origin).status_code, 400)

    def test_other_origins_and_unknown_sessions_are_rejected(self):
        self.assertEqual(self.client.post("/api/session", headers={"Origin": "https://example.org"}).status_code, 403)
        self.assertEqual(self.client.post("/api/session").status_code, 403)
        frame = {"session": "unknown", "time_ms": 0, "width": 640, "height": 480, "landmarks": points()}
        self.assertEqual(self.client.post("/api/frame", json=frame, headers=self.origin).status_code, 404)
        self.assertEqual(self.client.get("/../AGENTS.md").status_code, 404)

    def test_only_report_matching_artifacts_are_loaded(self):
        from model.analysis.live_comparison.server import ARTIFACTS, load_artifacts
        model, corrector = models()
        with tempfile.TemporaryDirectory(prefix="posegood-live-synthetic-") as folder:
            root = Path(folder)
            hashes = {}
            for name, value in zip(ARTIFACTS, (model, corrector, model)):
                joblib.dump(value, root / name)
                hashes[name] = hashlib.sha256((root / name).read_bytes()).hexdigest()
            report = {"schema_version": "replay-two-stage-synthetic-translation-v1",
                      "model_artifact_sha256": hashes, "all_data_candidate": {"threshold": .6}}
            (root / "report.json").write_text(json.dumps(report), encoding="utf-8")
            loaded = load_artifacts(root)
            self.assertEqual(loaded[3], .6)
            with (root / ARTIFACTS[0]).open("ab") as stream:
                stream.write(b"changed")
            with self.assertRaisesRegex(ValueError, "does not match"):
                load_artifacts(root)

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for the browser state test")
    def test_browser_camera_cancellation_and_stale_score(self):
        result = subprocess.run(["node", "--test", "tests/live_comparison_ui.test.cjs"],
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
