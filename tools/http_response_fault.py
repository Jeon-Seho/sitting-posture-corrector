"""Synthetic HTTP fault: suppress one successful CEP response after the upstream commits.

Only loopback development services are forwarded. Request bodies are not logged or retained;
observation digests and call counts demonstrate retry behavior without storing feature values.
"""

import hashlib
import json
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

if __package__:
    from .runtime import ROOT
    from .service_processes import (
        ServiceEndpoints, assert_ports_closed, free_port, service_commands, stop_processes, wait_ready,
    )
else:
    from runtime import ROOT
    from service_processes import (
        ServiceEndpoints, assert_ports_closed, free_port, service_commands, stop_processes, wait_ready,
    )


@dataclass
class ResponseFault:
    api: str = ""
    inference_calls: int = 0
    observation_digests: list[str] = field(default_factory=list)
    suppressed_responses: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


def read_request_body(handler):
    """Java's streaming RestClient uses chunked transfer; urllib uses Content-Length."""
    if handler.headers.get("Transfer-Encoding", "").lower() != "chunked":
        return handler.rfile.read(int(handler.headers.get("Content-Length", "0")))
    chunks = []
    while True:
        length = int(handler.rfile.readline().split(b";", 1)[0].strip(), 16)
        if length == 0:
            while handler.rfile.readline().strip():
                pass
            return b"".join(chunks)
        chunk = handler.rfile.read(length)
        if len(chunk) != length or handler.rfile.read(2) != b"\r\n":
            raise ValueError("invalid synthetic HTTP chunk")
        chunks.append(chunk)


def forwarding_handler(endpoints, state):
    class ForwardingHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.forward()

        def do_PUT(self):
            self.forward()

        def do_POST(self):
            self.forward()

        def log_message(self, format, *args):
            pass

        def forward(self):
            inference = self.path == "/v2/infer"
            if not inference and not self.path.startswith("/internal/sessions/"):
                self.send_error(404)
                return
            body = read_request_body(self)
            observation = self.command == "POST" and self.path.endswith("/observations")
            with state.lock:
                if inference and self.command == "POST":
                    state.inference_calls += 1
                if observation:
                    state.observation_digests.append(hashlib.sha256(body).hexdigest())
            upstream = endpoints.inference if inference else endpoints.cep
            request = Request(
                upstream + self.path, method=self.command,
                data=body if body else None,
                headers={"Content-Type": "application/json"},
            )
            try:
                with urlopen(request, timeout=5) as response:
                    status, result = response.status, response.read()
            except HTTPError as error:
                status, result = error.code, error.read()
            with state.lock:
                if (observation and status == 200 and state.suppressed_responses == 0
                        and len(state.observation_digests) == 3):
                    # The original 200 is lost. An explicit 502 prevents transparent HTTP retries.
                    state.suppressed_responses += 1
                    status = 502
                    result = json.dumps({"error": "synthetic response loss after commit"}).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)

    return ForwardingHandler


@contextmanager
def running_response_fault(endpoints):
    """Yield a temporary API using the forwarding proxy for both inference and CEP."""
    state = ResponseFault()
    server = ThreadingHTTPServer(("127.0.0.1", 0), forwarding_handler(endpoints, state))
    server.daemon_threads = True
    proxy_port = server.server_address[1]
    api_port = free_port()
    while api_port == proxy_port:
        api_port = free_port()
    state.api = f"http://127.0.0.1:{api_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    processes = []
    try:
        with tempfile.TemporaryDirectory(prefix="posegood-response-fault-") as folder:
            log_path = Path(folder) / "api.log"
            with log_path.open("w") as log:
                routes = ServiceEndpoints(proxy_port, api_port, proxy_port)
                processes.append(subprocess.Popen(
                    service_commands(routes)[1], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                ))
                try:
                    wait_ready(state.api, "/v1/sessions/11111111-1111-1111-1111-111111111111", processes)
                    yield state
                except Exception:
                    log.flush()
                    print(log_path.read_text(encoding="utf-8", errors="replace")[-3000:])
                    raise
                finally:
                    stop_processes(processes)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive(), "synthetic proxy thread still running"
        assert_ports_closed([proxy_port, api_port])
        print("PASS: synthetic response-fault API/proxy stopped")
