"""Synthetic tests for the local webcam comparison; no participant recordings."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import unittest

import joblib
import numpy as np
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestClassifier
from fastapi.testclient import TestClient

from model.analysis.live_comparison.engine import LiveComparison, model_explanation, rule_explanation
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


class SyntheticCorrector:
    def predict(self, rows):
        return np.asarray([100 * row[0] for row in rows])


class SyntheticClassifier:
    classes_ = [0, 1]

    def predict_proba(self, rows):
        scores = [0.5 + .2 * row[0] - .3 * row[1] + .1 * row[4] for row in rows]
        return np.asarray([[1 - score, score] for score in scores])


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
        self.assertEqual(result["explanation"]["schema_version"], "1.0")
        self.assertEqual(len(result["explanation"]["rule"]), 3)
        self.assertEqual(len(result["explanation"]["model"]), 6)

    def test_rule_explanation_uses_registration_range_and_existing_threshold(self):
        rows = rule_explanation([.11, .02, .03], [.01, .02, .01], [True] * 6)
        self.assertEqual([row["level"] for row in rows], ["yellow", "green", "red"])
        self.assertEqual([row["dominant"] for row in rows], [False, False, True])
        self.assertAlmostEqual(rows[2]["component_score"], .7)
        self.assertEqual(rule_explanation([0.] * 3, None, [True] * 6)[0]["level"], "yellow")
        self.assertEqual(rule_explanation([.1] * 3, [.1] * 3, [False] * 6)[0]["level"], "unknown")

    def test_registration_range_only_uses_visible_calibration_samples(self):
        for i in range(36):
            sample = points(.001 if i % 2 else -.001)
            if i < 5:
                sample[7]["visibility"] = .2
                sample[8]["visibility"] = .2
            result = self.send(i * 100, sample)
        self.assertEqual(result["status"], "ready")
        self.assertGreater(self.session.reference_ranges[0], 0.)
        self.assertIsNotNone(self.session.reference_ranges[1])
        for i in range(11):
            result = self.send(3600 + i * 100, points())
        self.assertEqual(result["explanation"]["rule"][0]["level"], "green")
        self.assertEqual(result["explanation"]["rule"][1]["level"], "green")

    def test_model_explanation_recomputes_corrector_for_each_baseline_replacement(self):
        corrector, classifier = SyntheticCorrector(), SyntheticClassifier()
        values, span = [.2, .3, 0., 0., .1, 0.], 100.
        original = .44  # Includes the -0.2 corrected shoulder-height input.
        rows = model_explanation(values, span, original, corrector, classifier, [True] * 6)
        self.assertAlmostEqual(rows[0]["counterfactual_score"], .42)
        self.assertAlmostEqual(rows[0]["effect"], .02)
        self.assertEqual(rows[0]["level"], "red")
        self.assertAlmostEqual(rows[1]["effect"], -.09)
        self.assertEqual(rows[1]["level"], "green")
        self.assertEqual(rows[2]["level"], "yellow")
        self.assertEqual(model_explanation(values, span, original, corrector, classifier, [False] * 6)[0]["level"], "unknown")

    def test_low_visibility_discards_cached_score_and_breaks_the_window(self):
        self.register()
        for i in range(10):
            result = self.send(3100 + i * 100)
        self.assertEqual(result["status"], "measured")
        hidden = points()
        hidden[9]["visibility"] = .2
        result = self.send(4100, hidden)
        self.assertEqual(result["status"], "unmeasurable")
        self.assertNotIn("model", result)
        self.assertEqual(self.send(4200)["status"], "warming")

    def test_frame_mode_scores_every_valid_frame_and_rejects_occlusion(self):
        model, corrector = models()
        self.session = LiveComparison(model, corrector, model, .5, input_mode="frame")
        self.register()
        self.assertEqual(self.send(3100)["status"], "measured")
        self.assertEqual(self.send(3200, points(.04))["status"], "measured")
        hidden = points()
        hidden[9]["visibility"] = .2
        self.assertEqual(self.send(3300, hidden)["status"], "unmeasurable")
        self.assertEqual(self.send(3400)["status"], "measured")
        near_cutoff = points()
        near_cutoff[9]["visibility"] = .649
        self.assertEqual(self.send(3500, near_cutoff)["status"], "measured")
        near_cutoff[9]["visibility"] = .644
        self.assertEqual(self.send(3600, near_cutoff)["status"], "unmeasurable")

    def test_4_by_3_larger_input_is_accepted_but_size_changes_are_not(self):
        model, corrector = models()
        self.session = LiveComparison(model, corrector, model, .5, input_mode="frame")
        for i in range(31):
            result = self.send(i * 100, width=1280, height=960)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(self.send(3100, width=1280, height=960)["status"], "measured")
        self.assertEqual(self.send(3200, width=640, height=480)["status"], "unmeasurable")

    def test_explanation_failure_keeps_original_score_but_never_invents_colors(self):
        class BatchFails(SyntheticCorrector):
            def predict(self, rows):
                if len(rows) > 1:
                    raise ValueError("synthetic batch failure")
                return super().predict(rows)
        classifier = SyntheticClassifier()
        self.session = LiveComparison(classifier, BatchFails(), classifier, .5)
        self.register()
        for i in range(11):
            result = self.send(3100 + i * 100)
        self.assertEqual(result["status"], "measured")
        self.assertIsNone(result["explanation"]["model"])
        self.assertEqual(len(result["explanation"]["rule"]), 3)

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
        temporary = tempfile.TemporaryDirectory(prefix="posegood-scenario-synthetic-")
        self.addCleanup(temporary.cleanup)
        self.scenario_dir = Path(temporary.name) / "model/test/senario"
        self.client = TestClient(create_app(model, corrector, model, .5, scenario_dir=self.scenario_dir),
                                 base_url="http://127.0.0.1:8765")
        self.origin = {"Origin": "http://127.0.0.1:8765"}

    def test_static_and_local_session(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        response = self.client.post("/api/session", headers=self.origin)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["visibility_minimum"], .65)
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

    def test_frame_artifacts_drive_the_local_camera_endpoint_per_frame(self):
        from model.analysis.frame_pilot.artifacts import REPORT_SCHEMA
        from model.analysis.frame_pilot.train import save
        from model.analysis.live_comparison.server import create_app, load_comparison_artifacts
        model, corrector = models()
        with tempfile.TemporaryDirectory(prefix="posegood-frame-live-synthetic-") as folder:
            output = Path(folder) / "frame-candidate"
            report = {"schema_version": REPORT_SCHEMA, "settings": {"input": "one_frame", "visibility_minimum": .73},
                      "all_data_candidate": {"threshold": .5, "threshold_status": "display_only_not_selected_or_validated"}}
            save(output, report, corrector, model)
            uncorrected, loaded_corrector, classifier, threshold, mode, visibility, threshold_status = load_comparison_artifacts(output)
            self.assertEqual(mode, "frame")
            client = TestClient(create_app(uncorrected, loaded_corrector, classifier, threshold,
                                           input_mode=mode, min_visibility=visibility, threshold_status=threshold_status),
                                base_url="http://127.0.0.1:8765")
            session = client.post("/api/session", headers=self.origin).json()
            self.assertEqual(session["input_mode"], "frame")
            self.assertEqual(session["threshold_status"], "display_only_not_selected_or_validated")
            self.assertEqual(session["visibility_minimum"], .73)
            body = {"session": session["session"], "width": 1280, "height": 960, "landmarks": points()}
            for i in range(31):
                body["time_ms"] = i * 100
                response = client.post("/api/frame", json=body, headers=self.origin)
            self.assertEqual(response.json()["status"], "ready")
            for timestamp in (3100, 3200):
                body["time_ms"] = timestamp
                response = client.post("/api/frame", json=body, headers=self.origin)
                self.assertEqual(response.json()["status"], "measured")
            body["time_ms"] = 3300
            body["landmarks"][9]["visibility"] = .2
            self.assertEqual(client.post("/api/frame", json=body, headers=self.origin).json(),
                             {"status": "unmeasurable"})
            body["time_ms"] = 3400
            body["landmarks"] = points()
            self.assertEqual(client.post("/api/frame", json=body, headers=self.origin).json()["status"], "measured")

    def test_manual_scenario_save_is_private_unique_and_keeps_both_scores(self):
        body = {"records": [{"id": "chair_left", "source": "manual", "rule_score": 0, "model_score": 75.5}]}
        response = self.client.post("/api/scenarios/save", json=body, headers=self.origin)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["records"], 1)
        self.assertEqual(Path(result["directory"]), self.scenario_dir.resolve())
        path = self.scenario_dir / result["filename"]
        self.assertTrue(path.name.startswith("scenario-") and path.suffix == ".json")
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(saved["schema_version"], "live-comparison-scenario-v1")
        self.assertEqual(saved["records"][0]["label"], "의자 왼쪽 이동")
        self.assertEqual(saved["records"][0]["rule_score"], 0)
        self.assertEqual(saved["records"][0]["model_score"], 75.5)
        self.assertIsNone(saved["records"][0]["snapshot"])
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        again = self.client.post("/api/scenarios/save", json=body, headers=self.origin)
        self.assertEqual(again.status_code, 200)
        self.assertNotEqual(again.json()["filename"], result["filename"])
        self.assertEqual(len(list(self.scenario_dir.glob("*.json"))), 2)

    def test_automatic_snapshot_saves_scores_and_explanations_without_landmarks(self):
        token = self.client.post("/api/session", headers=self.origin).json()["session"]
        for i in range(41):
            frame = {"session": token, "time_ms": i * 100, "width": 640, "height": 480, "landmarks": points()}
            result = self.client.post("/api/frame", json=frame, headers=self.origin).json()
        self.assertEqual(result["status"], "measured")
        decision = lambda name: {"raw_score": result[name]["score"], "threshold": result[name]["threshold"],
                                 "deviation": result[name]["deviation"], "alert_count": 0}
        snapshot = {"captured_at": "2026-11-10T00:00:00Z", "baseline_index": 1,
                    "rule": decision("rule"), "model": decision("model"),
                    "model_uncorrected_raw": result["model_uncorrected"]["score"],
                    "correction_px": result["correction_px"], "explanation": result["explanation"]}
        body = {"records": [{"id": "baseline", "source": "automatic", "rule_score": 100,
                             "model_score": 80, "snapshot": snapshot}]}
        response = self.client.post("/api/scenarios/save", json=body, headers=self.origin)
        self.assertEqual(response.status_code, 200, response.text)
        saved = json.loads((self.scenario_dir / response.json()["filename"]).read_text(encoding="utf-8"))
        row = saved["records"][0]
        self.assertEqual(row["snapshot"]["baseline_index"], 1)
        self.assertEqual(len(row["snapshot"]["explanation"]["model"]), 6)
        self.assertEqual(row["snapshot"]["rule"]["raw_score"], result["rule"]["score"])
        content = json.dumps(saved)
        for forbidden in ("landmarks", '"image"', '"world"', '"session"', '"participant"'):
            self.assertNotIn(forbidden, content)
        snapshot["explanation"]["model"] = None  # Explanation failure must not prevent saving scores.
        self.assertEqual(self.client.post("/api/scenarios/save", json=body, headers=self.origin).status_code, 200)
        snapshot["explanation"] = None
        self.assertEqual(self.client.post("/api/scenarios/save", json=body, headers=self.origin).status_code, 200)

    def test_scenario_save_rejects_wrong_origin_extra_data_invalid_scores_and_duplicate_ids(self):
        valid = {"id": "head_left", "source": "manual", "rule_score": 42, "model_score": None}
        cases = [
            {"records": []},
            {"records": [{**valid, "id": "../../escape"}]},
            {"records": [{**valid, "rule_score": 101}]},
            {"records": [{**valid, "rule_score": None}]},
            {"records": [valid, valid]},
            {"records": [{**valid, "landmarks": points()}]},
            {"records": [{**valid, "source": "automatic"}]},
        ]
        for case in cases:
            with self.subTest(case=case):
                response = self.client.post("/api/scenarios/save", json=case, headers=self.origin)
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.post("/api/scenarios/save", json={"records": [valid]}).status_code, 403)
        self.assertFalse(self.scenario_dir.exists())

    def test_scenario_save_failure_does_not_report_success_or_overwrite(self):
        from model.analysis.live_comparison.server import create_app
        blocked = self.scenario_dir.parent / "existing-file"
        blocked.parent.mkdir(parents=True)
        blocked.write_text("keep", encoding="utf-8")
        model, corrector = models()
        client = TestClient(create_app(model, corrector, model, .5, scenario_dir=blocked),
                            base_url="http://127.0.0.1:8765")
        body = {"records": [{"id": "baseline", "source": "manual", "model_score": 50}]}
        self.assertEqual(client.post("/api/scenarios/save", json=body, headers=self.origin).status_code, 500)
        self.assertEqual(blocked.read_text(encoding="utf-8"), "keep")

    def test_frontend_and_server_use_the_same_scenario_ids(self):
        from model.analysis.live_comparison.server import SCENARIOS
        js = Path("model/analysis/live_comparison/web/app.js").read_text(encoding="utf-8")
        self.assertEqual(set(re.findall(r"\{ id: '([a-z_]+)'", js)), set(SCENARIOS))

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for the browser state test")
    def test_browser_camera_cancellation_and_stale_score(self):
        result = subprocess.run(["node", "--test", "tests/live_comparison_ui.test.cjs"],
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
