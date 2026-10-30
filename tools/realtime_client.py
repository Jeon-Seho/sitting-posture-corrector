"""Minimal loopback WebSocket client for `/v2/realtime` checks (RFC 6455 text frames, no TLS).

Only the standard library: the backend smoke runs from the dev venv without a WebSocket package.
Messages are JSON; only synthetic coordinates are sent.
"""

import base64
import json
import os
import socket
import struct
import time
from urllib.parse import urlsplit


class RealtimeClient:
    def __init__(self, api_base, timeout=10):
        parts = urlsplit(api_base)
        host, port = parts.hostname, parts.port or 80
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        origin = f"{parts.scheme}://{parts.netloc}"  # the server accepts same-origin pages only
        # A path in api_base is kept: through the frontend NGINX (http://host:port/api) the channel is /api/v2/realtime
        # (tools/deploy/smoke.py, D-75). A bare API address (service_smoke) still uses /v2/realtime.
        path = parts.path.rstrip("/") + "/v2/realtime"
        request = (f"GET {path} HTTP/1.1\r\nHost: {parts.netloc}\r\nUpgrade: websocket\r\n"
                   f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                   f"Origin: {origin}\r\n\r\n")
        self.sock.sendall(request.encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("closed during the WebSocket handshake")
            response += chunk
        head, self.buffer = response.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0].decode(errors="replace")
        if " 101 " not in status + " ":
            raise ConnectionError("WebSocket handshake failed: " + status)

    def send(self, message):
        payload = json.dumps(message, separators=(",", ":"), allow_nan=False).encode()
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x81, 0x80 | n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, n)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _read(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("WebSocket closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def _message(self):
        """The next text message; answers pings and raises when the server closes."""
        message = b""
        while True:
            b1, b2 = self._read(2)
            opcode, length = b1 & 0x0F, b2 & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read(8))[0]
            data = self._read(length)
            if opcode == 0x8:
                raise ConnectionError("WebSocket closed by the server")
            if opcode == 0x9:
                mask = os.urandom(4)
                self.sock.sendall(struct.pack("!BB", 0x8A, 0x80 | len(data)) + mask
                                  + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
                continue
            message += data
            if b1 & 0x80:
                return json.loads(message)

    def next(self, kind, event=None, timeout=10):
        """The next message of `kind` (and event kind, for `decision`); earlier other messages are skipped."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.sock.settimeout(max(0.1, deadline - time.monotonic()))
            message = self._message()
            if message.get("type") == kind and (event is None or message["event"]["kind"] == event):
                return message
        raise AssertionError("no " + kind + " message")

    def close(self):
        self.sock.close()
