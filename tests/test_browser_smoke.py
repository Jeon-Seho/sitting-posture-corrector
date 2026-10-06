"""Synthetic failure diagnostics remain after temporary server logs are cleaned."""

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from tools.browser_smoke import diagnostic_log


class BrowserDiagnosticsTest(unittest.TestCase):
    def test_failure_keeps_console_and_server_output_in_task_log(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic-browser-run.log"
            with redirect_stdout(stdout), redirect_stderr(stderr):
                with self.assertRaisesRegex(RuntimeError, "synthetic failure"):
                    with diagnostic_log(path):
                        print("synthetic browser failure")
                        print("synthetic gateway timeout", file=sys.stderr)
                        raise RuntimeError("synthetic failure")
            saved = path.read_text(encoding="utf-8")
            self.assertIn("synthetic browser failure", saved)
            self.assertIn("synthetic gateway timeout", saved)
            self.assertEqual(stdout.getvalue(), "synthetic browser failure\n")
            self.assertEqual(stderr.getvalue(), "synthetic gateway timeout\n")


if __name__ == "__main__":
    unittest.main()
