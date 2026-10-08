"""Run real browser/service regression with explicit synthetic input and isolated Chrome."""

import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path


class DiagnosticStream:
    """Keep console output visible and preserve task-only server failure logs."""

    def __init__(self, console, log):
        self.console = console
        self.log = log

    def write(self, value):
        self.console.write(value)
        return self.log.write(value)

    def flush(self):
        self.console.flush()
        self.log.flush()


@contextmanager
def diagnostic_log(path):
    with path.open("w", encoding="utf-8") as log:
        with redirect_stdout(DiagnosticStream(sys.stdout, log)):
            with redirect_stderr(DiagnosticStream(sys.stderr, log)):
                yield

if __package__:
    from .frontend_proxy import running_frontend_proxy
    from .runtime import ROOT
    from .service_processes import (
        ServiceEndpoints, assert_ports_closed, free_port, running_services,
        service_commands, stop_processes, wait_ready,
    )
else:
    from frontend_proxy import running_frontend_proxy
    from runtime import ROOT
    from service_processes import (
        ServiceEndpoints, assert_ports_closed, free_port, running_services,
        service_commands, stop_processes, wait_ready,
    )


def chrome_executable():
    candidates = [os.environ.get("POSEGOOD_CHROME"), os.environ.get("CHROME_BIN")]
    candidates.extend(shutil.which(name) for name in (
        "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
    ))
    candidates.extend([
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        str(Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe"),
    ])
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    raise RuntimeError("Chrome이 필요합니다. 설치된 실행 파일을 POSEGOOD_CHROME으로 지정하세요. 브라우저 검증을 생략하지 않습니다.")


def verify_production_bundle():
    assets = ROOT / "frontend/dist/assets"
    scripts = list(assets.glob("*.js"))
    if not scripts:
        raise RuntimeError("프로덕션 프론트 빌드가 필요합니다. 먼저 make check-frontend를 실행하세요.")
    markers = ("__POSEGOOD_SYNTHETIC_BROWSER_ONLY__", "posegood.synthetic-browser-clock", "explicit-synthetic-device")
    for script in scripts:
        source = script.read_text(encoding="utf-8")
        if any(marker in source for marker in markers):
            raise RuntimeError("합성 브라우저 테스트 코드가 프로덕션 번들에 포함되었습니다.")
    print("PASS: synthetic browser entry and camera are absent from production bundles", flush=True)


def stop_browser_tree(process):
    # The Node launcher and Chrome descendants share a task-owned process group on POSIX.
    if os.name == "nt":
        if process.poll() is None:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, capture_output=True)
    else:
        def group_exists():
            try:
                os.killpg(process.pid, 0)
                return True
            except ProcessLookupError:
                return False

        for shutdown_signal in (signal.SIGTERM, signal.SIGKILL):
            if not group_exists():
                break
            try:
                os.killpg(process.pid, shutdown_signal)
            except ProcessLookupError:
                break
            deadline = time.monotonic() + 5
            while group_exists() and time.monotonic() < deadline:
                process.poll()  # Reap Node even when a descendant outlives it.
                time.sleep(0.05)
        if group_exists():
            raise RuntimeError("task-owned browser process group did not exit")
    if process.poll() is None:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if os.name != "nt":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.kill()
            process.wait(timeout=5)


def stream_browser(process, endpoints, services, api_log):
    lines = queue.Queue()

    def read_output():
        for line in process.stdout:
            lines.put(line.rstrip("\n"))
        lines.put(None)

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    deadline = time.monotonic() + 210
    while time.monotonic() < deadline:
        try:
            line = lines.get(timeout=1)
        except queue.Empty:
            continue
        if line is None:
            if process.wait(timeout=5):
                raise RuntimeError("브라우저 합성 회귀 검증에 실패했습니다.")
            return
        if line.startswith("CONTROL restart-api "):
            session_id = line.removeprefix("CONTROL restart-api ")
            stop_processes([services[1]])
            services[1] = subprocess.Popen(
                service_commands(endpoints)[1], cwd=ROOT, stdout=api_log, stderr=subprocess.STDOUT,
            )
            wait_ready(endpoints.api, "/v1/sessions/" + session_id, services)
            process.stdin.write("api-restarted\n")
            process.stdin.flush()
            print("PASS: task API restarted with empty memory on the same loopback port", flush=True)
        else:
            print(line, flush=True)
    raise RuntimeError("브라우저 검증 제한 시간 210초를 넘었습니다.")


def main():
    chrome = chrome_executable()
    node = shutil.which("node")
    if not node or int(subprocess.check_output([node, "-p", "process.versions.node.split('.')[0]"], text=True).strip()) < 24:
        raise RuntimeError("브라우저 검증은 기존 스택의 Node.js 24 이상이 필요합니다.")
    verify_production_bundle()
    artifacts = ROOT / ".cache/browser-smoke"
    artifacts.mkdir(parents=True, exist_ok=True)
    with diagnostic_log(artifacts / "browser-run.log"):
        run_browser(node, chrome, artifacts)


def run_browser(node, chrome, artifacts):
    endpoints = ServiceEndpoints.allocate()
    with tempfile.TemporaryDirectory(prefix="posegood-browser-") as folder:
        with (Path(folder) / "restarted-api.log").open("w") as api_log:
            with running_services(endpoints) as services:
                with running_frontend_proxy(endpoints.api, services, mode="browser-smoke") as base:
                    with running_frontend_proxy(endpoints.api, services) as ordinary_base:
                        # Allocate only after the service and proxy ports are bound.
                        debug_port = free_port()
                        options = {"start_new_session": True} if os.name != "nt" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                        process = subprocess.Popen([
                            node, str(ROOT / "tools/browser_smoke.mjs"), base, ordinary_base,
                            chrome, str(debug_port), str(Path(folder) / "chrome-profile"), str(artifacts),
                        ], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1, **options)
                        try:
                            stream_browser(process, endpoints, services, api_log)
                        finally:
                            try:
                                stop_browser_tree(process)
                            finally:
                                process.stdin.close()
                                process.stdout.close()
                                assert_ports_closed([debug_port])
                                print("PASS: isolated Chrome and debugging port stopped", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
