"""Explicitly synthetic captures only; exercise actual training and leakage boundaries."""

import csv
import json
import math
import tempfile
import unittest
from pathlib import Path

from model.analysis.personal.data import catalog_folder, load_config, prepare, sha256
from model.analysis.personal.run import ROOT, build_experiment, run_experiment


class PersonalTrainingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="posegood-explicit-synthetic-personal-")
        self.folder = Path(self.temp.name)
        self.output = self.folder / "result"
        fixture = ROOT / "model/analysis/dataset/synthetic/synthetic-P01-posture.csv"
        with fixture.open(encoding="utf-8-sig") as file:
            row = next(csv.DictReader(file))
        row.update(participant_code="synthetic-person", camera_view="front", repetition="1", calibration_id="synthetic-baseline")
        for label in ("upright", "lean_left"):
            for repetition in (1, 2, 3):
                rows = []
                for i in range(31):
                    sample = dict(row)
                    sample.update(capture_id=f"synthetic-{label}-{repetition}", manual_label=label, task_id="neutral" if label == "upright" else label,
                                  activity="reference" if label == "upright" else "posed", repetition=str(repetition),
                                  sample_index=str(i), elapsed_ms=str(i * 100), video_time_ms=str(10000 + i * 100),
                                  gap_ms="" if i == 0 else "100", delta_offset=str((0 if label == "upright" else .5) + .001 * math.sin(i)),
                                  delta_head_gap=str(.001 * math.cos(i)), delta_tilt="0")
                    rows.append(sample)
                self.write_csv(self.folder / f"synthetic-{label}-{repetition}.csv", rows)
        self.document = {
            "schema_version": "posture-personal-experiment-v1", "purpose": "same_person_feasibility", "data_kind": "synthetic",
            "participant_code": "synthetic-person", "captures": catalog_folder(self.folder),
            "roles_by_repetition": {"1": "train", "2": "validation", "3": "holdout"},
            "labels": ["upright", "lean_left"], "pose_model": "explicit-synthetic-pose-v0",
            "feature_version": "reference-rules-v0.1", "camera_view": "front",
            "window": {"duration_ms": 500, "stride_ms": 600, "max_gap_ms": 200, "min_samples": 4},
            "augmentation": {"copies": 2, "scale_sd": .03, "offset_sd": .02, "jitter_sd": .03},
            "optimizer": {"epochs": 60, "learning_rate": .05, "l2": .01}, "seed": 42,
        }
        self.config_path = self.folder / "config.json"
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.config_path.write_text(json.dumps(self.document), encoding="utf-8")

    @staticmethod
    def write_csv(path, rows):
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def mutate(self, index, operation):
        spec = self.document["captures"][index]
        path = Path(spec["path"])
        with path.open(encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        operation(rows)
        self.write_csv(path, rows)
        spec["sha256"] = sha256(path)
        self.save()

    def test_synthetic_training_produces_models_and_report(self):
        report = run_experiment(self.config_path, self.output)
        self.assertEqual(report["holdout"]["accuracy"], 1)
        self.assertEqual(report["selected_model"], "original")
        manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertTrue(manifest["training_executed"])
        self.assertTrue(manifest["selection_before_holdout"])
        self.assertTrue((self.output / "models.json").is_file())

    def test_capture_roles_and_windows_have_no_shared_observations(self):
        groups, _ = prepare(load_config(self.config_path))
        ids = [{w["capture_id"] for w in groups[role]} for role in groups]
        self.assertFalse(ids[0] & ids[1] or ids[0] & ids[2] or ids[1] & ids[2])
        for windows in groups.values():
            observations = [(w["capture_id"], o["sample_index"]) for w in windows for o in w["observations"]]
            self.assertEqual(len(observations), len(set(observations)))

    def test_holdout_change_cannot_change_fitted_models_or_selection(self):
        first = build_experiment(load_config(self.config_path))
        for index, spec in enumerate(self.document["captures"]):
            if spec["repetition"] == 3:
                self.mutate(index, lambda rows: [r.update(delta_offset="999") for r in rows])
        second = build_experiment(load_config(self.config_path))
        self.assertEqual(first[0], second[0])
        self.assertEqual(first[1]["selected_model"], second[1]["selected_model"])
        self.assertEqual(first[1]["augmentation"], second[1]["augmentation"])
        self.assertNotEqual(first[1]["holdout"]["accuracy"], second[1]["holdout"]["accuracy"])

    def test_validation_change_cannot_change_scaler_or_weights(self):
        first = build_experiment(load_config(self.config_path))[0]
        for index, spec in enumerate(self.document["captures"]):
            if spec["repetition"] == 2:
                self.mutate(index, lambda rows: [r.update(delta_head_gap="42") for r in rows])
        second = build_experiment(load_config(self.config_path))[0]
        self.assertEqual(first["scaler"], second["scaler"])
        for name in first["candidates"]:
            self.assertEqual(first["candidates"][name]["weights"], second["candidates"][name]["weights"])

    def test_poor_row_breaks_window_without_joining_both_sides(self):
        self.mutate(0, lambda rows: rows[10].update(measurement_quality="poor", pose_training_eligible="0"))
        groups, diagnostics = prepare(load_config(self.config_path))
        capture = self.document["captures"][0]["capture_id"]
        for window in groups["train"]:
            if window["capture_id"] == capture:
                indices = [o["sample_index"] for o in window["observations"]]
                self.assertFalse(min(indices) < 10 < max(indices))
        self.assertEqual(diagnostics[0]["excluded_rows"], {"poor_quality": 1})


if __name__ == "__main__":
    unittest.main()
