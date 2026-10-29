"""Representative offline secret, backup and restore safety regressions."""

import gzip
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tools.deploy.backup import backup_database
from tools.deploy.secrets import JWT_SECRET, SECRET_NAMES, create_secrets
from tools.deploy.restore import restore_database


class DeploymentConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="synthetic-deploy-tests-")
        self.folder = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_secret_initialization_is_idempotent_and_private_without_replacing_values(self):
        directory = create_secrets(self.folder / "secrets")
        original = {name: (directory / name).read_bytes() for name in SECRET_NAMES}
        create_secrets(directory)
        self.assertEqual(original, {name: (directory / name).read_bytes() for name in SECRET_NAMES})
        if os.name != "nt":
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all((directory / name).stat().st_mode & 0o777 == 0o444 for name in SECRET_NAMES))


    def test_login_signing_key_is_added_once_to_existing_directories_and_never_rotated(self):
        directory = create_secrets(self.folder / "secrets")
        key = (directory / JWT_SECRET).read_text()
        self.assertGreaterEqual(len(key), 32)
        self.assertNotIn("\n", key)
        (directory / JWT_SECRET).unlink()  # a directory made before the key existed
        create_secrets(directory)
        added = (directory / JWT_SECRET).read_text()
        self.assertNotEqual(added, key)
        create_secrets(directory)
        self.assertEqual((directory / JWT_SECRET).read_text(), added)
        if os.name != "nt":
            self.assertEqual((directory / JWT_SECRET).stat().st_mode & 0o777, 0o444)
        existing = {name: (directory / name).read_text() for name in SECRET_NAMES[:3]}
        create_secrets(directory, {**existing, JWT_SECRET: added})
        with self.assertRaisesRegex(ValueError, "rotation"):
            create_secrets(directory, {**existing, JWT_SECRET: "rotated_" + "k" * 40})
        self.assertEqual((directory / JWT_SECRET).read_text(), added)


    def test_backup_stream_is_gzipped_private_and_existing_output_is_preserved(self):
        destination = self.folder / "synthetic.sql.gz"
        process = Mock(stdout=io.BytesIO(b"-- explicitly synthetic SQL\n"), returncode=0)
        process.communicate.return_value = (None, None)
        with patch("tools.deploy.backup.command", return_value=["docker", "compose"]), \
                patch("tools.deploy.backup.subprocess.Popen", return_value=process):
            backup_database("synthetic-project", destination, {})
        with gzip.open(destination) as handle:
            self.assertEqual(handle.read(), b"-- explicitly synthetic SQL\n")
        if os.name != "nt":
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        before = destination.read_bytes()
        with self.assertRaises(FileExistsError):
            backup_database("synthetic-project", destination, {})
        self.assertEqual(destination.read_bytes(), before)


    def test_restore_rejects_existing_tables_before_any_dump_is_sent(self):
        with patch("tools.deploy.restore.run", return_value=Mock(stdout="[]")), \
                patch("tools.deploy.restore.query", return_value="12"), \
                patch("tools.deploy.restore.subprocess.Popen") as launch, self.assertRaisesRegex(ValueError, "empty"):
            restore_database("synthetic-project", self.folder / "missing.gz", {})
        launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
