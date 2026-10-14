"""Lifecycle of the temporary loopback API and inference servers used by smoke tests.

The API needs a schema V2.2 database (tools/test_mysql.py); there is no memory mode (ADR 0020).
"""

import os
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

if __package__:
    from .runtime import ROOT, java_executable, service_jar, venv_python
else:
    from runtime import ROOT, java_executable, service_jar, venv_python


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@dataclass(frozen=True)
class ServiceEndpoints:
    api_port: int
    inference_port: int

    @property
    def api(self):
        return f"http://127.0.0.1:{self.api_port}"

    @property
    def inference(self):
        return f"http://127.0.0.1:{self.inference_port}"

    @property
    def ports(self):
        return self.api_port, self.inference_port

    @classmethod
    def allocate(cls):
        ports = []
        while len(ports) < 2:
            port = free_port()
            if port not in ports:
                ports.append(port)
        return cls(*ports)


def service_commands(endpoints):
    java = java_executable()
    return [
        [
            java, "-jar", str(service_jar("api", "session-api")),
            f"--server.port={endpoints.api_port}",
            f"--posegood.inference-url={endpoints.inference}",
        ],
        [
            str(venv_python()), "-m", "uvicorn", "model.inference.app:app",
            "--host", "127.0.0.1", "--port", str(endpoints.inference_port),
            "--no-access-log",
        ],
    ]


def api_environment(database):
    """Database connection of the API process; the password never appears on a command line."""
    return dict(
        os.environ,
        POSEGOOD_DATABASE_URL=database.jdbc_url,
        POSEGOOD_DATABASE_USER=database.server.user,
        POSEGOOD_DATABASE_PASSWORD=database.server.password,
    )


def wait_ready(base, path, processes):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError("service exited before ready")
        try:
            with urlopen(base + path, timeout=0.5):
                return
        except HTTPError as error:
            # A refused synthetic request still proves that the route is ready.
            if error.code in (401, 404):
                return
        except (URLError, TimeoutError, OSError):
            pass
        time.sleep(0.1)
    raise RuntimeError("service readiness timeout")


def stop_processes(processes):
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    for process in reversed(processes):
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def assert_ports_closed(ports):
    for port in ports:
        with socket.socket() as sock:
            sock.settimeout(0.5)
            assert sock.connect_ex(("127.0.0.1", port)) != 0, "test server still listening"


@contextmanager
def running_services(endpoints, database):
    processes, logs = [], []
    environments = [api_environment(database), dict(os.environ)]
    with tempfile.TemporaryDirectory(prefix="posegood-synthetic-http-") as folder:
        try:
            for index, command in enumerate(service_commands(endpoints)):
                path = Path(folder) / f"{index}.log"
                log = path.open("w")
                logs.append((path, log))
                processes.append(
                    subprocess.Popen(
                        command, cwd=ROOT, env=environments[index], stdout=log, stderr=subprocess.STDOUT,
                    )
                )
            wait_ready(endpoints.api, "/health", processes)
            wait_ready(endpoints.inference, "/health", processes)
            yield processes
        except Exception:
            for path, log in logs:
                log.flush()
                print(path.read_text(encoding="utf-8", errors="replace")[-3000:], file=sys.stderr)
            raise
        finally:
            stop_processes(processes)
            for _, log in logs:
                log.close()
            assert_ports_closed(endpoints.ports)
            print("PASS: task API and inference servers stopped")
