"""Only explicit synthetic fixtures; no participant files or model training."""

import copy
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from model.analysis.dataset import load_config, prepare_dataset
from model.analysis.dataset.prepare import ROOT, assert_sources_unchanged, build_dataset
from model.analysis.dataset.splits import participant_split


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

    def test_irregular_observations_are_preserved_and_endpoint_overshoot_is_explicit(self):
        _, windows, _ = self.prepare()
        window = windows[0]
        self.assertEqual([point["elapsed_ms"] for point in window["observations"]], [0, 140, 350, 520])
        self.assertEqual((window["start_ms"], window["end_ms"], window["target_duration_ms"]), (0, 520, 500))
        self.assertEqual(len(window["observations"]), 4)

    def test_reproducible_outputs_and_private_permissions(self):
        manifest, windows, _ = self.prepare()
        second = self.folder / "second"
        repeated = prepare_dataset(self.config_path, second)
        self.assertEqual(manifest, repeated)
        self.assertEqual((self.output / "windows.jsonl").read_bytes(), (second / "windows.jsonl").read_bytes())
        self.assertEqual(len({window["window_id"] for window in windows}), len(windows))
        if os.name != "nt":
            self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.output / "manifest.json").stat().st_mode & 0o777, 0o600)

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

    def test_loso_and_seeded_group_folds_keep_participants_disjoint(self):
        self.document["split"] = {"method": "loso", "fold": "synthetic-P03", "seed": 7, "validation_participants": ["synthetic-P02"]}
        self.save_config()
        loso = participant_split(load_config(self.config_path))
        self.assertEqual(loso["assignments"]["train"], ["synthetic-P01"])
        self.document["participants"][2]["evaluation_only"] = False
        self.document["split"] = {"method": "group_kfold", "fold": 0, "seed": 7, "fold_count": 3, "validation_fold": 1}
        self.save_config()
        grouped = participant_split(load_config(self.config_path))
        self.assertEqual(grouped, participant_split(load_config(self.config_path)))
        self.assertEqual({len(group) for group in grouped["all_group_folds"]}, {1})
        self.assertEqual(len(set(grouped["fit_participants"]).intersection(grouped["assignments"]["test"])), 0)

    def test_required_research_parameters_and_invalid_folds_are_rejected(self):
        del self.document["window"]["stride_ms"]
        self.rejected("missing")
        self.document = json.loads((FIXTURE / "config.json").read_text())
        self.document["split"] = {"method": "group_kfold", "fold": 0, "seed": 7, "fold_count": 3, "validation_fold": 0}
        self.rejected("distinct test/validation")

    def test_participant_alias_and_csv_ownership_conflicts_are_rejected(self):
        self.document["participants"][1]["source_codes"].append("P01")
        self.rejected("ownership is duplicated")
        self.document["participants"][1]["source_codes"] = ["P02"]
        rows, columns = self.read_rows()
        rows[2]["participant_code"] = "P02"
        self.write_rows(rows, columns)
        self.rejected("ownership does not match")

    def test_hash_changes_duplicate_files_and_duplicate_capture_ids_are_rejected(self):
        rows, columns = self.read_rows()
        rows[2]["delta_offset"] = "0.123"
        self.write_rows(rows, columns, rehash=False)
        self.rejected("SHA-256 changed")
        self.document = json.loads((FIXTURE / "config.json").read_text())
        self.document["captures"][1]["path"] = self.document["captures"][0]["path"]
        self.rejected("Duplicate file/path/hash/capture")
        self.document = json.loads((FIXTURE / "config.json").read_text())
        self.document["captures"][1]["capture_id"] = self.document["captures"][0]["capture_id"]
        self.rejected("Duplicate file/path/hash/capture")

    def test_exclusion_rows_never_reconnect_their_two_sides(self):
        changes = [
            ("measurement_quality", "poor"), ("review_status", "pending"),
            ("review_status", "excluded"), ("manual_label", "transition"),
            ("manual_label", "unlabeled"), ("presence_label", "away"),
            ("pose_training_eligible", "0"), ("label_source", "none"),
            ("stop_reason", "manual_stop"),
        ]
        for field, value in changes:
            with self.subTest(field=field, value=value):
                rows, columns = self.regular_posture()
                rows[3][field] = value
                self.write_rows(rows, columns)
                manifest, windows, _ = self.prepare()
                own = [window for window in windows if window["capture_id"] == self.document["captures"][1]["capture_id"]]
                self.assertTrue(own)
                self.assertTrue(all(all(point["sample_index"] < 3 for point in window["observations"]) or all(point["sample_index"] > 3 for point in window["observations"]) for window in own))
                diagnostic = next(item for item in manifest["diagnostics"] if item["capture_id"] == own[0]["capture_id"])
                self.assertEqual(sum(diagnostic["excluded_rows"].values()), 1)
                shutil.rmtree(self.output)

    def test_label_segment_and_model_changes_break_even_if_mapped_class_matches(self):
        for field, value in [("manual_label", "lean_right"), ("segment_id", "1"), ("pose_model", "explicit-synthetic-other-v0"), ("feature_version", "explicit-synthetic-other-feature-v0")]:
            with self.subTest(field=field):
                rows, columns = self.regular_posture()
                for row in rows[4:]:
                    row[field] = value
                self.document["pose_models"] = ["explicit-synthetic-pose-v0", "explicit-synthetic-other-v0"]
                self.document["feature_versions"] = ["reference-rules-v0.1", "explicit-synthetic-other-feature-v0"]
                self.document["label_mapping"].update(lean_left="same_explicit_class", lean_right="same_explicit_class")
                self.write_rows(rows, columns)
                _, windows, _ = self.prepare()
                own = [window for window in windows if window["capture_id"] == self.document["captures"][1]["capture_id"]]
                self.assertTrue(all(window["observations"][0]["sample_index"] >= 4 or window["observations"][-1]["sample_index"] < 4 for window in own))
                shutil.rmtree(self.output)

    def test_missing_indices_long_gaps_and_video_reset_break_or_reject_explicitly(self):
        for corruption in ("missing_sample_index", "observation_gap", "video_time_reset"):
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
                    else:
                        row["video_time_ms"] = str((index - 4) * 100)
                self.document["window"]["discontinuity_policy"] = "break"
                self.write_rows(rows, columns)
                manifest, _, _ = self.prepare()
                self.assertEqual(manifest["diagnostics"][0]["breaks"][corruption], 1)
                shutil.rmtree(self.output)
                self.document["window"]["discontinuity_policy"] = "reject"
                self.rejected("discontinuity rejection")

    def test_timestamp_reversal_duplicate_indices_v1_and_nonfinite_features_are_rejected(self):
        changes = [("elapsed_ms", "140"), ("sample_index", "1"), ("schema_version", "posture-pilot-v1"), ("delta_offset", "nan"), ("gap_ms", "999")]
        original, columns = self.read_rows()
        for field, value in changes:
            with self.subTest(field=field):
                rows = copy.deepcopy(original)
                rows[2][field] = value
                self.write_rows(rows, columns)
                self.rejected("strictly increase|v1 labels|finite|gap_ms")

    def test_calibration_is_owner_specific_and_requires_good_reviewed_reference_rows(self):
        self.document["captures"][5]["calibration_ids"] = self.document["captures"][0]["calibration_ids"]
        self.rejected("different participants")
        self.document = json.loads((FIXTURE / "config.json").read_text())
        original, columns = self.read_rows(0)
        for field, value in [("measurement_quality", "poor"), ("review_status", "pending"), ("review_status", "excluded")]:
            rows = copy.deepcopy(original)
            for row in rows:
                row[field] = value
            self.write_rows(rows, columns, 0)
            self.rejected("no reviewed, good")
        rows = copy.deepcopy(original)
        rows[0]["manual_label"] = "lean_left"
        self.write_rows(rows, columns, 0)
        self.rejected("never deviation data")

    def test_same_calibration_baseline_changes_are_rejected_across_captures(self):
        rows, columns = self.read_rows()
        rows[2]["baseline_head_gap"] = "0.8"
        self.write_rows(rows, columns)
        self.rejected("Baseline columns changed")

    def test_missing_reference_and_unapproved_versions_and_rule_features_are_rejected(self):
        self.document["captures"] = self.document["captures"][1:]
        self.rejected("separately cataloged calibration")
        self.document = json.loads((FIXTURE / "config.json").read_text())
        rows, columns = self.read_rows()
        rows[2]["pose_model"] = "unapproved-model"
        self.write_rows(rows, columns)
        self.rejected("not explicitly approved")
        self.document["feature_columns"] = ["rule_score"]
        self.rejected("predictions/task cues")

    def test_output_cannot_overwrite_a_run_or_publish_private_metadata_in_repo(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, "never overwrites"):
            prepare_dataset(self.config_path, self.output)
        with self.assertRaisesRegex(ValueError, "Git-ignored"):
            prepare_dataset(self.config_path, ROOT / "model/analysis/dataset/leaky-output")

    def test_capture_changed_during_preparation_is_rejected_without_output(self):
        path = self.source / self.document["captures"][1]["path"]
        def alter_source():
            path.write_bytes(path.read_bytes() + b"\n")
            return {}
        with patch("model.analysis.dataset.prepare.code_metadata", side_effect=alter_source):
            self.rejected("changed during preparation")

    def test_concurrently_created_empty_target_is_preserved(self):
        checks = 0
        def concurrent_creation(config):
            nonlocal checks
            checks += 1
            if checks == 2:
                self.output.mkdir()
            assert_sources_unchanged(config)
        with patch("model.analysis.dataset.prepare.assert_sources_unchanged", side_effect=concurrent_creation):
            with self.assertRaises(FileExistsError):
                prepare_dataset(self.config_path, self.output)
        self.assertTrue(self.output.is_dir())
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertFalse(list(self.folder.glob(".dataset-preparation-*")))

    def test_failed_publication_never_overwrites_or_removes_a_foreign_file(self):
        original_copy = shutil.copyfileobj
        def concurrent_file(source, destination):
            original_copy(source, destination)
            (self.output / "windows.jsonl").write_text("foreign writer", encoding="utf-8")
        with patch("model.analysis.dataset.prepare.shutil.copyfileobj", side_effect=concurrent_file):
            with self.assertRaises(FileExistsError):
                prepare_dataset(self.config_path, self.output)
        self.assertEqual((self.output / "windows.jsonl").read_text(), "foreign writer")
        self.assertEqual({path.name for path in self.output.iterdir()}, {"windows.jsonl"})
        self.assertFalse(list(self.folder.glob(".dataset-preparation-*")))

    def test_calibration_changes_make_separate_windows(self):
        rows, columns = self.regular_posture()
        calibration_rows, calibration_columns = self.read_rows(0)
        second = dict(self.document["captures"][0])
        second.update(path="explicit-synthetic-second-calibration.csv", capture_id="synthetic-second-calibration", calibration_ids=["synthetic-second-baseline"])
        for row in calibration_rows:
            row["capture_id"] = second["capture_id"]
            row["calibration_id"] = second["calibration_ids"][0]
        self.document["captures"].append(second)
        self.write_rows(calibration_rows, calibration_columns, 6)
        self.document["captures"][1]["calibration_ids"].append(second["calibration_ids"][0])
        for row in rows[4:]:
            row["calibration_id"] = second["calibration_ids"][0]
        self.write_rows(rows, columns)
        _, windows, calibrations = self.prepare()
        own = [window for window in windows if window["capture_id"] == self.document["captures"][1]["capture_id"]]
        self.assertEqual({window["calibration_id"] for window in own}, set(self.document["captures"][1]["calibration_ids"]))
        self.assertTrue(all(window["observations"][0]["sample_index"] >= 4 or window["observations"][-1]["sample_index"] < 4 for window in own))
        self.assertEqual(len(calibrations), 4)

    def test_partial_poor_calibration_rows_remain_separate_and_never_become_baseline_input(self):
        rows, columns = self.read_rows(0)
        rows[3]["measurement_quality"] = "poor"
        self.write_rows(rows, columns, 0)
        _, _, calibrations = self.prepare()
        reference = calibrations[0]
        self.assertEqual(reference["excluded_rows"], {"poor_quality": 1})
        self.assertEqual(len(reference["observed_runs"]), 2)
        self.assertFalse(any(point["sample_index"] == 3 for run in reference["observed_runs"] for point in run["observations"]))


if __name__ == "__main__":
    unittest.main()
