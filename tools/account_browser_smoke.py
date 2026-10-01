"""Run real account UI with synthetic camera input against an isolated Compose stack."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from browser_smoke import chrome_executable, stop_browser_tree
from frontend_proxy import running_frontend_proxy
from runtime import ROOT
from service_processes import assert_ports_closed, free_port


def verify_account_browser(frontend_base):
    chrome = chrome_executable()
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Account browser verification requires Node.js 24 or newer")
    artifacts = ROOT / ".cache/account-browser-smoke"
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="posegood-account-browser-") as temporary:
        with running_frontend_proxy(frontend_base, [], mode="browser-smoke",
                                    server_accounts=True, api_prefix="/api") as base:
            port = free_port()
            options = {"start_new_session": True} if os.name != "nt" else {
                "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP,
            }
            with (artifacts / "browser-run.log").open("w") as log:
                process = subprocess.Popen([
                    node, str(ROOT / "tools/account_browser_smoke.mjs"), base, chrome,
                    str(port), str(Path(temporary) / "profile"), str(artifacts),
                ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, **options)
                try:
                    code = process.wait(timeout=150)
                    log.flush()
                    output = (artifacts / "browser-run.log").read_text()
                    print(output, end="", flush=True)
                    if code:
                        raise RuntimeError("Actual account browser verification failed")
                    # Count is emitted only after every assertion and browser shutdown succeeds.
                    marker = "PASS: account browser checks "
                    counts = [line[len(marker):] for line in output.splitlines() if line.startswith(marker)]
                    if len(counts) != 1 or not counts[0].isdigit():
                        raise RuntimeError("Account browser verification did not report its completed checks")
                    return int(counts[0])
                finally:
                    stop_browser_tree(process)
                    assert_ports_closed([port])
                    print("PASS: account browser and task debugging port stopped", flush=True)
