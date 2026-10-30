"""Only explicit synthetic fixtures; no participant files or model training."""

import csv
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from model.analysis.dataset import load_config, prepare_dataset
from model.analysis.dataset.prepare import ROOT, build_dataset


FIXTURE = ROOT / "model/analysis/dataset/synthetic"


class DatasetPreparationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="posegood-synthetic-dataset-")
        self.folder = Path(self.temporary.name)
        self.source = self.folder / "synthetic"
        shutil.copytree(FIXTURE, self.source)
        self.config_path = self.source / "config.json"
        self.document = json.loads(self.config_path.read_text())
        self.output = self.folder / "prepared"

    def tearDown(self):
        self.temporary.cleanup()

    def save_config(self):
        self.config_path.write_text(json.dumps(self.document), encoding="utf-8")

    def read_rows(self, capture_index=1):
        path = self.source / self.document["captures"][capture_index]["path"]
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            return list(reader), reader.fieldnames

    def write_rows(self, rows, columns, capture_index=1, *, rehash=True):
        spec = self.document["captures"][capture_index]
        path = self.source / spec["path"]
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        if rehash:
            spec["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.save_config()

    def prepare(self):
        self.save_config()
        manifest = prepare_dataset(self.config_path, self.output)
        windows = [json.loads(line) for line in (self.output / "windows.jsonl").read_text().splitlines()]
        calibrations = json.loads((self.output / "calibrations.json").read_text())
        return manifest, windows, calibrations

    def rejected(self, message):
        self.save_config()
        with self.assertRaisesRegex(ValueError, message):
            prepare_dataset(self.config_path, self.output)
        self.assertFalse(self.output.exists())

    def regular_posture(self):
        original, columns = self.read_rows()
        rows = []
        for index in range(9):
            row = dict(original[0])
            row.update(sample_index=str(index), elapsed_ms=str(index * 100),
                       video_time_ms=str(5000 + index * 100), gap_ms="" if index == 0 else "100")
            rows.append(row)
        self.document["window"].update(duration_ms=200, stride_ms=100, min_samples=3)
        return rows, columns

    def test_explicit_split_precedes_windows_and_calibration_is_separate(self):
        manifest, windows, calibrations = self.prepare()
        self.assertEqual(manifest["window_counts"], {"train": 2, "validation": 2, "test": 2})
        self.assertEqual(manifest["split"]["fit_participants"], ["synthetic-P01"])
        self.assertTrue(all(window["split_role"] == manifest["split"]["participant_roles"][window["participant_id"]] for window in windows))
        calibration_ids = {item["capture_id"] for item in calibrations}
        self.assertFalse(calibration_ids.intersection(window["capture_id"] for window in windows))
        self.assertTrue(all(not item["global_fit_allowed"] and not item["evaluation_windows_allowed"] for item in calibrations))
        self.assertFalse(manifest["training_executed"])
        self.assertFalse(manifest["transforms_fitted"])
        self.assertFalse(manifest["derived_baseline_verified"])


    def test_cli_end_to_end_on_synthetic_fixture(self):
        result = subprocess.run([
            sys.executable, str(ROOT / "model/analysis/prepare_dataset.py"),
            "--config", str(self.config_path), "--output", str(self.output),
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("train=2, validation=2, test=2", result.stdout)
        self.assertTrue((self.output / "calibrations.json").is_file())

    def test_overlap_rejected_before_csv_is_read(self):
        self.document["split"]["assignments"]["train"].append("synthetic-P03")
        self.save_config()
        with patch("model.analysis.dataset.prepare.read_captures", side_effect=AssertionError("should not read frames")):
            with self.assertRaisesRegex(ValueError, "exactly one split"):
                build_dataset(load_config(self.config_path))

    def test_test_transform_fit_and_evaluation_only_tuning_are_rejected(self):
        self.document["fit_roles"] = ["test"]
        self.rejected("must never fit")
        self.document["fit_roles"] = ["train"]
        self.document["split"]["assignments"].update(validation=["synthetic-P03"], test=["synthetic-P02"])
        self.rejected("evaluation-only")


    def test_poor_row_never_reconnects_its_two_sides(self):
        rows, columns = self.regular_posture()
        rows[3]["measurement_quality"] = "poor"
        self.write_rows(rows, columns)
        manifest, windows, _ = self.prepare()
        own = [window for window in windows if window["capture_id"] == self.document["captures"][1]["capture_id"]]
        self.assertTrue(own)
        self.assertTrue(all(all(point["sample_index"] < 3 for point in window["observations"]) or all(point["sample_index"] > 3 for point in window["observations"]) for window in own))
        diagnostic = next(item for item in manifest["diagnostics"] if item["capture_id"] == own[0]["capture_id"])
        self.assertEqual(sum(diagnostic["excluded_rows"].values()), 1)


    def test_missing_indices_and_long_gaps_break_windows(self):
        for corruption in ("missing_sample_index", "observation_gap"):
            with self.subTest(corruption=corruption):
                rows, columns = self.regular_posture()
                for index, row in enumerate(rows[4:], start=4):
                    if corruption == "missing_sample_index":
                        row["sample_index"] = str(index + 1)
                    elif corruption == "observation_gap":
                        row["elapsed_ms"] = str(index * 100 + 1000)
                        row["video_time_ms"] = str(5000 + index * 100 + 1000)
                        if index == 4:
                            row["gap_ms"] = "1100"
                self.document["window"]["discontinuity_policy"] = "break"
                self.write_rows(rows, columns)
                manifest, windows, _ = self.prepare()
                self.assertEqual(manifest["diagnostics"][0]["breaks"][corruption], 1)
                own = [window for window in windows if window["capture_id"] == self.document["captures"][1]["capture_id"]]
                self.assertTrue(own)
                self.assertTrue(all(window["observations"][-1]["sample_index"] < 4 or window["observations"][0]["sample_index"] >= 4 for window in own))
                shutil.rmtree(self.output)


if __name__ == "__main__":
    unittest.main()
