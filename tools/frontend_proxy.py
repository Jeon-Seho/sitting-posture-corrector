"""Lifecycle of the same-origin development proxy; no browser or camera is opened."""

import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

if __package__:
    from .runtime import ROOT
    from .service_processes import assert_ports_closed, free_port, stop_processes, wait_ready
else:
    from runtime import ROOT
    from service_processes import assert_ports_closed, free_port, stop_processes, wait_ready


@contextmanager
def running_frontend_proxy(api_url, service_processes, *, on_started=None, mode=None):
    """Yield its URL; an optional observer can monitor the ready Vite process."""
    node = shutil.which("node")
    vite = ROOT / "frontend/node_modules/vite/bin/vite.js"
    if not node or not vite.is_file():
        raise RuntimeError("프론트 준비가 필요합니다. 먼저 make setup을 실행하세요.")
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    environment = dict(os.environ, POSEGOOD_API_URL=api_url, CHOKIDAR_USEPOLLING="1")
    with tempfile.TemporaryDirectory(prefix="posegood-frontend-proxy-") as folder:
        log_path = Path(folder) / "vite.log"
        command = [node, str(vite), "--host", "127.0.0.1", "--port", str(port), "--strictPort"]
        if mode is not None:
            command.extend(["--mode", mode])
        with log_path.open("w") as log:
            process = subprocess.Popen(
                command,
                cwd=ROOT / "frontend", env=environment, stdout=log, stderr=subprocess.STDOUT,
            )
            try:
                wait_ready(base, "/", [*service_processes, process])
                if on_started is not None:
                    on_started(process)
                yield base
            except Exception:
                log.flush()
                print(log_path.read_text(encoding="utf-8", errors="replace")[-3000:])
                raise
            finally:
                stop_processes([process])
                assert_ports_closed([port])
                print("PASS: task frontend proxy stopped")
