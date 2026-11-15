"""Synthetic checks for labeled-frame and trial exclusion accounting."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from model.analysis.frame_pilot.coverage import coverage
from test_model_frame_pilot import short_capture


class FrameCoverageTest(unittest.TestCase):
    def test_exclusions_count_frames_and_trials_separately_by_label(self):
        data = short_capture("synthetic-coverage")
        for frame in data["frames"]:
            if frame["phase"] == "hold" and frame["task"] == "deviation":
                frame["image"][0]["x"] += .2
        neutral = next(frame for frame in data["frames"]
                       if frame["phase"] == "hold" and frame["task"] == "neutral")
        neutral["image"][9]["visibility"] = .2
        original = copy.deepcopy(data)
        report = coverage([("P001", "a" * 64, data)], False)
        normal, deviation = report["counts"]["neutral"], report["counts"]["deviation"]
        self.assertEqual((normal["source_frames"], normal["usable_frames"], normal["excluded_unmeasurable"]),
                         (11, 10, 1))
        self.assertEqual((normal["trials"], normal["trials_partly_excluded"], normal["trials_without_usable_frames"]),
                         (1, 1, 0))
        self.assertEqual((deviation["source_frames"], deviation["usable_frames"], deviation["excluded_head_turn"]),
                         (11, 0, 11))
        self.assertEqual((deviation["trials"], deviation["trials_without_usable_frames"]), (1, 1))
        self.assertEqual(data, original)
        self.assertNotIn("synthetic-coverage", json.dumps(report))

    def test_cli_writes_only_aggregate_private_report(self):
        with tempfile.TemporaryDirectory(prefix="posegood-coverage-synthetic-") as tmp:
            root = Path(tmp)
            source = root / "captures"
            source.mkdir()
            (source / "synthetic.json").write_text(json.dumps(short_capture("synthetic-person")), encoding="utf-8")
            catalog, output = root / "catalog.json", root / "coverage.json"
            created = subprocess.run([sys.executable, "-m", "model.analysis.frame_pilot", "catalog",
                                      "--input", str(source), "--output", str(catalog)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(created.returncode, 0, created.stderr)
            result = subprocess.run([sys.executable, "-m", "model.analysis.frame_pilot.coverage",
                                     "--catalog", str(catalog), "--output", str(output),
                                     "--allow-unverified-identities"],
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(output.read_text(encoding="utf-8"))
            self.assertTrue(report["source_integrity_rechecked"])
            self.assertEqual(report["counts"]["neutral"]["source_frames"], 11)
            self.assertEqual(report["counts"]["deviation"]["source_frames"], 11)
            self.assertNotIn("synthetic-person", output.read_text(encoding="utf-8"))
            self.assertNotIn("synthetic-person", result.stdout)


if __name__ == "__main__":
    unittest.main()
