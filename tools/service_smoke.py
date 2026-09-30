"""Run only this project's three loopback services with synthetic inputs, then stop all.

No camera, credentials, accounts, databases or participant data are used.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if __package__:
    from .service_contract import validate_observation, validate_view
else:
    from service_contract import validate_observation, validate_view

ROOT = Path(__file__).resolve().parents[1]


def java_executable():
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        path = Path(java_home) / "bin" / ("java.exe" if os.name == "nt" else "java")
        if path.is_file():
            return str(path)
    path = shutil.which("java")
    if path is None:
        raise RuntimeError("Java 21 is required")
    return path


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(base, path, method="GET", body=None, expected=200):
    data = None if body is None else json.dumps(body, allow_nan=False).encode()
    req = Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as response:
            status, raw = response.status, response.read()
    except HTTPError as error:
        status, raw = error.code, error.read()
    assert status == expected, (path, status, raw[:200])
    return json.loads(raw) if raw else None


def wait_ready(base, path, processes):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError("service exited before ready")
        try:
            with urlopen(base + path, timeout=.5):
                return
        except HTTPError as error:
            if error.code == 404:
                return
        except (URLError, TimeoutError, OSError):
            pass
        time.sleep(.1)
    raise RuntimeError("service readiness timeout")


def main():
    ports = []
    while len(ports) < 3:
        port = free_port()
        if port not in ports:
            ports.append(port)
    cep_port, api_port, inference_port = ports
    java = java_executable()
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    cep = "http://127.0.0.1:" + str(cep_port)
    api = "http://127.0.0.1:" + str(api_port)
    inference = "http://127.0.0.1:" + str(inference_port)
    commands = [
        [java, "-jar", str(ROOT / "backend/cep/target/cep-service-0.1.0-SNAPSHOT.jar"), "--server.port=" + str(cep_port)],
        [java, "-jar", str(ROOT / "backend/api/target/session-api-0.1.0-SNAPSHOT.jar"), "--server.port=" + str(api_port), "--posegood.cep-url=" + cep],
        [str(python), "-m", "uvicorn", "model.inference.app:app", "--host", "127.0.0.1", "--port", str(inference_port), "--no-access-log"],
    ]
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix="posegood-synthetic-http-") as folder:
        try:
            for i, command in enumerate(commands):
                path = Path(folder) / (str(i) + ".log")
                log = path.open("w")
                logs.append((path, log))
                processes.append(subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
            wait_ready(cep, "/internal/sessions/" + str(uuid.uuid4()), processes)
            wait_ready(api, "/v1/sessions/" + str(uuid.uuid4()), processes)
            wait_ready(inference, "/health", processes)
            session = "/v1/sessions/" + str(uuid.uuid4())
            policy = {"policy": {"hold_ms": 3000, "recovery_ms": 2000, "reminder_ms": 60000, "threshold": .7}}
            initial = request(api, session, "PUT", policy)
            validate_view(initial)
            assert initial["summary"]["keep_rate"] is None
            assert request(api, session, "PUT", policy) == initial
            sequence = 0
            observations = []

            def feed(start, end, forward, phase="running", quality="good"):
                nonlocal sequence
                result = None
                while start < end:
                    next_end = min(end, start + 1000)
                    features = {"schema_version": "1.0", "sequence": sequence, "start_ms": start, "end_ms": next_end,
                                "phase": phase, "measurement_quality": quality,
                                "features": {"forward_delta": forward, "lateral_delta": 0.}}
                    observation = request(inference, "/v1/infer", "POST", features)
                    validate_observation(observation)
                    observations.append(observation)
                    result = request(api, session + "/observations", "POST", observation)
                    validate_view(result)
                    sequence += 1
                    start = next_end
                return result

            assert feed(0, 2999, .9)["summary"]["collapse_count"] == 0
            assert feed(2999, 3000, .9)["summary"]["alert_count"] == 1
            assert request(api, session + "/observations", "POST", observations[-1])["summary"]["alert_count"] == 1
            assert feed(3000, 5000, .1)["summary"]["mean_recovery_ms"] == 2000
            feed(5000, 15000, .9, phase="rest")
            feed(15000, 18000, .9)
            result = request(api, session)
            assert result["summary"]["valid_ms"] == 8000
            assert result["summary"]["rest_ms"] == 10000
            assert result["summary"]["mean_interval_ms"] == 5000
            assert result["summary"]["collapse_count"] == 2
            conflicting = dict(observations[-1], collapse_probability=.1)
            request(api, session + "/observations", "POST", conflicting, expected=409)
            reversed_input = dict(observations[-1], sequence=sequence, start_ms=0, end_ms=1000)
            request(api, session + "/observations", "POST", reversed_input, expected=409)
            assert request(api, session) == result
            other_session = "/v1/sessions/" + str(uuid.uuid4())
            assert request(api, other_session, "PUT", policy)["summary"]["interval_count"] == 0
            ended = request(api, session + "/end", "POST", {"end_ms": 18000})
            validate_view(ended)
            assert ended["ended"]
            assert request(api, session + "/end", "POST", {"end_ms": 18000}) == ended
            request(api, session + "/observations", "POST", dict(observations[-1], sequence=sequence, start_ms=18000, end_ms=19000), expected=409)
            assert request(api, session) == ended
            # Dependency loss is visible and never erases the last saved API snapshot.
            processes[0].terminate()
            processes[0].wait(timeout=5)
            request(api, other_session + "/end", "POST", {"end_ms": 0}, expected=502)
            assert request(api, other_session)["ended"] is False
            print("PASS: synthetic FastAPI -> API -> Esper -> stored query; boundaries, rest exclusion, idempotency, sessions, dependency failure")
        except Exception:
            for path, log in logs:
                log.flush()
                print(path.read_text(encoding="utf-8", errors="replace")[-3000:], file=sys.stderr)
            raise
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
            for process in reversed(processes):
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            for _, log in logs:
                log.close()
            for port in ports:
                with socket.socket() as sock:
                    sock.settimeout(.5)
                    assert sock.connect_ex(("127.0.0.1", port)) != 0, "test server still listening"
            print("PASS: all three task test servers stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
