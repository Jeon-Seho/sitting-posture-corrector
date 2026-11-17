"""Test 100-view comparisons using synthetic captures and trusted temporary files."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from model.analysis.frame_pilot import holdout, holdout_100
from model.analysis.frame_pilot.artifacts import load_models
from model.analysis.frame_pilot.checkpoint import Checkpoint
from test_model_frame_holdout import SMALL_CLASSIFIER, SMALL_CORRECTOR, synthetic_captures
from test_model_frame_pilot import short_capture


class FrameHoldout100Test(unittest.TestCase):
    def prior(self):
        loaded = synthetic_captures()
        report, corrector, classifier = holdout.experiment(
            loaded, False, "synthetic", workers=2, config=SMALL_CLASSIFIER,
            corrector_config=SMALL_CORRECTOR, shifts=(-6., 0., 6.))
        report.update(catalog_sha256="c" * 64, source_integrity_rechecked=True,
                      model_artifact_sha256={"synthetic": "d" * 64})
        return loaded, report, corrector, classifier

    def test_checkpoint_integrity_and_fingerprint(self):
        with tempfile.TemporaryDirectory(prefix="posegood-checkpoint-synthetic-") as tmp:
            folder = Path(tmp) / "checkpoint"
            saved = Checkpoint(folder, "a" * 64)
            saved.save_json("fold", "P001", {"value": 123})
            loaded = Checkpoint(folder, "a" * 64)
            self.assertEqual(loaded.load_json("fold", "P001"), {"value": 123})
            with self.assertRaisesRegex(ValueError, "different"):
                Checkpoint(folder, "b" * 64)
            path, digest = saved._paths("fold", "P001", "json")
            path.write_text('{"value": 456}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "integrity"):
                loaded.load_json("fold", "P001")
            digest.unlink()
            self.assertIsNone(loaded.load_json("fold", "P001"))

    def test_holdout_excludes_people_compares_same_frames_and_resumes(self):
        loaded, prior, corrector, classifier = self.prior()
        with tempfile.TemporaryDirectory(prefix="posegood-holdout100-synthetic-") as tmp:
            checkpoint = Checkpoint(Path(tmp) / "checkpoint", "a" * 64)
            with patch.object(holdout_100, "fit_corrector", wraps=holdout_100.fit_corrector) as correctors, \
                 patch.object(holdout_100, "fit_100_views", wraps=holdout_100.fit_100_views) as classifiers:
                report, saved_corrector, saved_classifier = holdout_100.experiment(
                    loaded, False, prior, corrector, classifier, "c" * 64, "d" * 64,
                    workers=2, checkpoint=checkpoint)
            self.assertIs(saved_corrector, corrector)
            self.assertEqual(list(saved_classifier.classes_), [0, 1])
            self.assertEqual(report["summary"]["augmented_25x"], prior["summary"]["augmented_25x"])
            self.assertEqual(report["summary"]["augmented_100x"]["frame"]["complete_groups"], 3)
            self.assertEqual(report["summary"]["augmented_100x"]["frame"]["single_class_groups"], 1)
            for call in correctors.call_args_list:
                self.assertFalse({s.participant for s in call.args[0]} & set(call.args[4]))
                self.assertTrue(all(s.label == 0 for s in call.args[0]))
            for call in classifiers.call_args_list:
                forbidden = set(call.args[2]) if len(call.args) > 2 else set()
                self.assertFalse({s.participant for s in call.args[0]} & forbidden)
            for fold in report["folds"]:
                self.assertNotIn(fold["test_participant"], fold["training_participants"])
                self.assertFalse(fold["test_frames_augmented"])
                self.assertEqual(fold["training_views_100x"], fold["training_frames"] * 100)
                for label in ("reference_support", "deviation_support"):
                    self.assertEqual(fold["methods"]["augmented_100x"]["frame"][label],
                                     fold["methods"]["augmented_25x"]["frame"][label])
            with patch.object(holdout_100, "fit_corrector", side_effect=AssertionError("unexpected fit")), \
                 patch.object(holdout_100, "fit_100_views", side_effect=AssertionError("unexpected fit")):
                resumed, _, _ = holdout_100.experiment(
                    loaded, False, prior, corrector, classifier, "c" * 64, "d" * 64,
                    workers=2, checkpoint=checkpoint)
            self.assertEqual(resumed["summary"], report["summary"])
            self.assertEqual(resumed["all_data_candidate"]["threshold_status"],
                             "display_only_not_selected_or_validated")

    def test_prior_mismatch_is_rejected_before_training(self):
        loaded, prior, corrector, classifier = self.prior()
        for changed in ("catalog", "threshold", "test_frames"):
            bad = copy.deepcopy(prior)
            catalog = "c" * 64
            if changed == "catalog":
                catalog = "f" * 64
            elif changed == "threshold":
                bad["settings"]["threshold"] = .7
            else:
                bad["folds"][0]["test_frames_augmented"] = True
            with self.subTest(changed=changed), patch.object(
                    holdout_100, "fit_corrector", side_effect=AssertionError("unexpected fit")):
                with self.assertRaises(ValueError):
                    holdout_100.experiment(loaded, False, bad, corrector, classifier,
                                           catalog, "d" * 64, workers=2)

    def test_cli_saves_and_reloads_synthetic_results(self):
        with tempfile.TemporaryDirectory(prefix="posegood-holdout100-cli-") as tmp:
            root = Path(tmp)
            source = root / "captures"
            source.mkdir()
            for i in range(1, 5):
                (source / f"{i}.json").write_text(json.dumps(short_capture(f"synthetic-{i}", .04 + .01 * i)),
                                                  encoding="utf-8")
            catalog, prior, output, checkpoint = (root / name for name in ("catalog.json", "prior", "result", "cache"))
            commands = [
                ["model.analysis.frame_pilot", "catalog", "--input", str(source), "--output", str(catalog)],
                ["model.analysis.frame_pilot.holdout", "--catalog", str(catalog), "--output", str(prior),
                 "--allow-unverified-identities", "--workers", "2", "--classifier-trees", "2",
                 "--corrector-trees", "2"],
                ["model.analysis.frame_pilot.holdout_100", "--catalog", str(catalog), "--prior-dir", str(prior),
                 "--output", str(output), "--checkpoint-dir", str(checkpoint),
                 "--allow-unverified-identities", "--workers", "2"],
            ]
            for command in commands:
                process = subprocess.run([sys.executable, "-m", *command], capture_output=True, text=True, check=False)
                self.assertEqual(process.returncode, 0, process.stderr)
            corrector, classifier, report = load_models(output)
            self.assertTrue(report["source_integrity_rechecked"])
            self.assertEqual(report["all_data_candidate"]["training_views"],
                             100 * report["all_data_candidate"]["frames"])
            self.assertEqual(len(corrector.estimators_), 2)
            self.assertEqual(len(classifier.estimators_), 2)
            self.assertIn("augmented_100x", report["summary"])


if __name__ == "__main__":
    unittest.main()
