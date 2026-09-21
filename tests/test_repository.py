import subprocess
import tempfile
import unittest
from pathlib import Path

from tools.check_repository import artifact_problem, markdown_problems, repository_files
from tools.validate_contract import read_json, validate_payload


class RepositoryTests(unittest.TestCase):
    def test_links_detect_missing_and_external_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "exists.md").write_text("# Existing", encoding="utf-8")
            (root / "index.md").write_text(
                "[valid](exists.md#heading)\n[web](https://example.com)\n"
                "[missing](missing.md)\n[escape](../outside.md)\n"
                "```sh\n[not a link](placeholder.md)\n```\n", encoding="utf-8",
            )
            errors = markdown_problems(root, Path("index.md"))
            self.assertEqual(len(errors), 2)
            self.assertTrue(any("missing.md" in error for error in errors))
            self.assertTrue(any("escapes repository" in error for error in errors))

    def test_private_artifact_paths(self):
        for name in ("data/subject.csv", "model/person.npy", "model/weights.task",
                     "clip.MP4", "backend/.env.production", "artifacts/results.json",
                     "database/temp/analysis/report.md", "posture-pilot-P01-test.csv"):
            with self.subTest(name=name):
                self.assertIsNotNone(artifact_problem(Path(name)))
        for name in ("contracts/examples/normal.json", "backend/.env.example", "docs/product-spec.md"):
            with self.subTest(name=name):
                self.assertIsNone(artifact_problem(Path(name)))

    def test_tracked_ignored_files_are_still_checked(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / ".gitignore").write_text("*.mp4\n", encoding="utf-8")
            (root / "tracked.mp4").touch()
            (root / "ignored.mp4").touch()
            (root / "notes.md").touch()
            subprocess.run(["git", "add", "-f", "tracked.mp4"], cwd=root, check=True)
            paths = repository_files(root)
            self.assertIn(Path("tracked.mp4"), paths)
            self.assertIn(Path("notes.md"), paths)
            self.assertNotIn(Path("ignored.mp4"), paths)
            self.assertIsNotNone(artifact_problem(Path("tracked.mp4")))

    def test_nonstandard_json_numbers_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "payload.json"
            for value in ("NaN", "Infinity", "-Infinity", "1e999"):
                with self.subTest(value=value):
                    path.write_text('{"confidence": ' + value + '}', encoding="utf-8")
                    with self.assertRaises(ValueError):
                        validate_payload(read_json(path))


if __name__ == "__main__":
    unittest.main()
