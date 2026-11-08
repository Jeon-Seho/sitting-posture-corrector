"""Synthetic v8 replay and leakage regression tests; no real participant data."""

import copy
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from model.analysis.replay_pilot.replay import (
    Window, baseline, feature_deltas, geometry, load_catalog, make_catalog, prepare_capture,
    private_destination, read_replay, rule_score,
)
from model.analysis.replay_pilot.evaluate import experiment, scores_and_metrics


ROOT = Path(__file__).resolve().parents[1]
JOINTS = (0, 2, 5, 7, 8, 9, 10, 11, 12)
POINTS = ((.5, .4), (.52, .38), (.48, .38), (.54, .4), (.46, .4),
          (.51, .43), (.49, .43), (.6, .6), (.4, .6))


def frame(t, phase, task, trial, segment, offset=0):
    image = [{"x": .5, "y": .5, "z": 0, "visibility": .99} for _ in range(33)]
    for i, (x, y) in zip(JOINTS, POINTS):
        image[i] = {"x": x, "y": y + (offset if i == 0 else 0), "z": 0, "visibility": .99}
    return {"phase": phase, "task": task, "round": 1, "trial": trial, "attempt": 1,
            "segment": segment, "measurement": phase == "hold", "elapsedMs": t,
            "observationTimeMs": t, "width": 640, "height": 480,
            "poseModelId": "synthetic-pose", "measurable": True,
            "image": image, "world": copy.deepcopy(image)}


def capture(person="synthetic-a", shift=.06):
    frames = [frame(i * 100, "registering", "neutral", None, 1) for i in range(81)]
    frames += [frame(9000 + i * 100, "hold", "deviation", 1, 2, shift) for i in range(71)]
    frames += [frame(17000 + i * 100, "hold", "neutral", 1, 3) for i in range(71)]
    return {"schema_version": "observation-keypoint-replay-v8", "protocolId": "front-observation-base-hold-v7",
            "scope": "reference_and_hold_phases", "labelKind": "guided_task_not_ground_truth",
            "source": "synthetic", "mirrored": False, "participant": person, "runId": person,
            "pointIndices": list(range(33)), "droppedFrames": 0, "markers": [], "frames": frames,
            "schedule": [{"round": 1, "trial": 1, "action": "deviation", "phase": "hold"},
                         {"round": 1, "trial": 1, "action": "neutral", "phase": "hold"}]}


class ReplayPilotTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="posegood-replay-synthetic-")
        self.folder = Path(self.temp.name)
        self.data = capture()
        self.path = self.folder / "synthetic.json"
        self.write(self.data)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, value):
        self.path.write_text(json.dumps(value), encoding="utf-8")

    def test_service_geometry_and_rule_match_shared_synthetic_cases(self):
        path = ROOT / "contracts/examples/frames/reference-rule-cases.json"
        cases = json.loads(path.read_text(encoding="utf-8"))
        reference = geometry([tuple(p) for p in cases["baseline"]["p"]])
        checked = 0
        for case in cases["frame_cases"]:
            if case["p"] is None:
                self.assertIsNone(case["expected"]["score"])
                continue
            points = [tuple(p) for p in case["p"]]
            expected = case["expected"]
            actual = geometry(points)
            if expected["features"] is None:
                self.assertIsNone(actual, case["name"])
                continue
            for i, key in enumerate(("head_gap", "lateral_offset", "shoulder_tilt", "quality", "head_turn_offset")):
                self.assertAlmostEqual(actual[i], expected["features"][key], places=10, msg=case["name"])
            deltas = feature_deltas(points, reference)
            if expected["score"] is None:
                self.assertIsNone(deltas, case["name"])
            else:
                self.assertAlmostEqual(rule_score(deltas), expected["score"], places=10, msg=case["name"])
            checked += 1
        self.assertGreater(checked, 5)

    def test_weak_labels_format_and_time_are_validated(self):
        for mutation in ("format", "time", "observation", "context", "model"):
            d = copy.deepcopy(self.data)
            if mutation == "format": d["labelKind"] = "verified"
            if mutation == "time": d["frames"][5]["elapsedMs"] = d["frames"][4]["elapsedMs"]
            if mutation == "observation": d["frames"][5]["observationTimeMs"] = 0
            if mutation == "context": d["frames"][-1]["trial"] = None
            if mutation == "model": d["frames"][-1]["poseModelId"] = "another"
            self.write(d)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                read_replay(self.path)

    def test_registration_is_separate_and_needs_time_and_samples(self):
        ref = baseline(self.data["frames"])
        self.assertAlmostEqual(ref[0], .75)
        fewer = [f for f in self.data["frames"] if f["phase"] == "registering"][:20]
        with self.assertRaises(ValueError):
            baseline(fewer)
        # A marker prevents using samples from both sides to build a reference.
        with self.assertRaises(ValueError):
            baseline(fewer, [{"afterFrame": 10}])

    def test_unsupported_post_registration_is_rejected(self):
        self.data["frames"][-1]["phase"] = "registering"
        self.data["frames"][-1]["measurement"] = False
        self.write(self.data)
        with self.assertRaisesRegex(ValueError, "registration"):
            read_replay(self.path)

    def test_invalid_landmark_breaks_window_and_is_not_normal(self):
        self.data["frames"][115]["image"][0]["visibility"] = .1
        windows, counts = prepare_capture("P001", "synthetic", self.data)
        t = self.data["frames"][115]["elapsedMs"]
        self.assertEqual(counts["invalid_frames"], 1)
        self.assertTrue(windows)
        self.assertTrue(all(not (w.start_ms < t < w.time_ms) for w in windows))

    def test_gap_retry_and_marker_break_window(self):
        for kind in ("gap", "retry", "marker"):
            d = copy.deepcopy(self.data)
            index = 110
            if kind == "gap":
                for f in d["frames"][index:]:
                    f["elapsedMs"] += 1000
                    f["observationTimeMs"] += 1000
            elif kind == "retry":
                for f in d["frames"][index:152]: f["attempt"] = 2
            else:
                d["markers"] = [{"afterFrame": index - 1, "elapsedMs": d["frames"][index - 1]["elapsedMs"], "reason": "interrupted"}]
            boundary = d["frames"][index]["elapsedMs"]
            windows, _ = prepare_capture("P001", "synthetic", d)
            with self.subTest(kind=kind):
                self.assertTrue(windows)
                self.assertTrue(all(not (w.start_ms < boundary <= w.time_ms) for w in windows))

    def test_missing_landmark_and_short_windows_produce_no_score(self):
        d = copy.deepcopy(self.data)
        for f in d["frames"]:
            if f["phase"] == "hold": f["image"][0] = None
        windows, counts = prepare_capture("P001", "synthetic", d)
        self.assertEqual(windows, [])
        self.assertGreater(counts["invalid_frames"], 0)
        self.assertEqual(counts["trials_without_windows"], 2)

    def test_schedule_mismatch_is_rejected(self):
        self.data["schedule"] = []
        with self.assertRaisesRegex(ValueError, "schedule"):
            prepare_capture("P001", "synthetic", self.data)

    def test_catalog_review_and_duplicate_protection(self):
        catalog = make_catalog(self.folder)
        path = self.folder / "catalog.txt"
        path.write_text(json.dumps(catalog), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "review"):
            load_catalog(path)
        _, loaded = load_catalog(path, allow_unverified=True)
        self.assertEqual(len(loaded), 1)
        catalog["captures"].append(catalog["captures"][0])
        path.write_text(json.dumps(catalog), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            load_catalog(path, allow_unverified=True)

    def test_changed_capture_is_rejected(self):
        catalog = make_catalog(self.folder)
        path = self.folder / "catalog.txt"
        path.write_text(json.dumps(catalog), encoding="utf-8")
        self.data["droppedFrames"] = 1
        self.write(self.data)
        with self.assertRaisesRegex(ValueError, "changed"):
            load_catalog(path, allow_unverified=True)

    def test_report_has_group_held_out_and_no_names_or_coordinates(self):
        loaded = []
        for i in range(3):
            d = capture("synthetic-person-" + str(i), .05 + i * .01)
            loaded.append((f"P{i + 1:03d}", str(i) * 64, d))
        report, models = experiment(loaded, False, "synthetic-revision")
        self.assertEqual(len(report["folds"]), 3)
        for fold in report["folds"]:
            self.assertNotIn(fold["test_participant"], fold["training_participants"])
            self.assertEqual(len(fold["training_participants"]), 2)
        serialized = json.dumps((report, models))
        self.assertNotIn("synthetic-person", serialized)
        self.assertNotIn('"image"', serialized)
        self.assertEqual(set(report["summary"]), {"B0_fixed", "B0_tuned", "B1_three", "B1_extended"})

    def test_three_second_detection_and_invalid_boundary(self):
        windows = [Window("P001", "capture", (1, 1, "deviation", 1, 1), 1,
                          t, t - 800, 1, (0,) * 6) for t in (1000, 2000, 3000, 4000)]
        result = scores_and_metrics(windows, [.9] * 4, .7)
        self.assertEqual(result["three_second_exploratory"]["deviation"]["detected_trials"], 1)
        broken = windows[:2] + [Window(w.participant, w.capture, w.trial, 2, w.time_ms,
                                      w.start_ms, w.label, w.features) for w in windows[2:]]
        result = scores_and_metrics(broken, [.9] * 4, .7)
        self.assertEqual(result["three_second_exploratory"]["deviation"]["detected_trials"], 0)

    def test_synthetic_cli_catalog_and_evaluate(self):
        source = self.folder / "input"
        source.mkdir()
        for i in range(3):
            (source / f"synthetic-{i}.json").write_text(json.dumps(capture(f"synthetic-{i}", .05 + .01 * i)), encoding="utf-8")
        catalog, output = self.folder / "catalog.txt", self.folder / "results"
        base = [sys.executable, "-m", "model.analysis.replay_pilot"]
        command = subprocess.run(base + ["catalog", "--input", str(source), "--output", str(catalog)],
                                 cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(command.returncode, 0, command.stderr)
        command = subprocess.run(base + ["evaluate", "--catalog", str(catalog), "--output", str(output),
                                         "--allow-unverified-identities"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(command.returncode, 0, command.stderr)
        report = json.loads((output / "report.json").read_text(encoding="utf-8"))
        self.assertFalse(report["identity_reviewed"])
        self.assertTrue((output / "fold-models.json").is_file())
        self.assertNotIn("synthetic-0", command.stdout)

    def test_output_outside_git_is_required(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            private_destination(ROOT / "private-output")


if __name__ == "__main__":
    unittest.main()
