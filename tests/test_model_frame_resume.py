"""Portable private checkpoint handoff, exercised with synthetic captures only."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from model.analysis.frame_pilot.artifacts import load_models
from test_model_frame_pilot import short_capture


class FrameResumeTest(unittest.TestCase):
    def test_move_private_data_preserves_cached_models_and_detects_tampering(self):
        with tempfile.TemporaryDirectory(prefix="posegood-resume-synthetic-") as tmp:
            root = Path(tmp)
            source = root / "captures"
            source.mkdir()
            for i in range(1, 5):
                (source / f"{i}.json").write_text(json.dumps(short_capture(f"synthetic-{i}", .04 + .01 * i)),
                                                  encoding="utf-8")
            catalog, prior, result, checkpoint, bundle, session = (
                root / name for name in ("catalog.json", "prior", "result", "checkpoint", "bundle", "session"))
            commands = [
                ["-m", "model.analysis.frame_pilot", "catalog", "--input", str(source), "--output", str(catalog)],
                ["-m", "model.analysis.frame_pilot.holdout", "--catalog", str(catalog), "--output", str(prior),
                 "--allow-unverified-identities", "--workers", "2", "--classifier-trees", "2",
                 "--corrector-trees", "2"],
                ["-m", "model.analysis.frame_pilot.holdout_100", "--catalog", str(catalog), "--prior-dir", str(prior),
                 "--output", str(result), "--checkpoint-dir", str(checkpoint), "--allow-unverified-identities",
                 "--workers", "2"],
                ["tools/frame_resume.py", "pack", "--catalog", str(catalog), "--prior-dir", str(prior),
                 "--checkpoint-dir", str(checkpoint), "--output", str(bundle)],
                ["tools/frame_resume.py", "prepare", "--bundle", str(bundle), "--session", str(session)],
                ["tools/frame_resume.py", "run", "--session", str(session), "--workers", "2"],
            ]
            for command in commands:
                process = subprocess.run([sys.executable, *command], capture_output=True, text=True, check=False)
                self.assertEqual(process.returncode, 0, process.stderr)
            self.assertIn("correctors_cached: 10/10", process.stdout)
            self.assertIn("held_out_folds_cached: 4/4", process.stdout)
            _, _, original = load_models(result)
            _, _, moved = load_models(session / "result")
            self.assertEqual(original["summary"], moved["summary"])
            self.assertEqual(original["input_sha256"], moved["input_sha256"])
            self.assertNotEqual(original["catalog_sha256"], moved["catalog_sha256"])
            self.assertTrue(all(Path(row["path"]).parent == (bundle / "captures").resolve()
                                for row in json.loads((session / "catalog.json").read_text())["captures"]))
            capture = next((bundle / "captures").iterdir())
            capture.write_text("tampered synthetic data", encoding="utf-8")
            failed = subprocess.run([sys.executable, "tools/frame_resume.py", "prepare", "--bundle", str(bundle),
                                     "--session", str(root / "other-session")], capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("integrity mismatch", failed.stderr)
            self.assertFalse((root / "other-session").exists())


if __name__ == "__main__":
    unittest.main()
