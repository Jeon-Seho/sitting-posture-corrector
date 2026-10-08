"""Bounded loopback JSON requests; validation time is outside the HTTP latency sample."""

import json
import socket
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .measurement import Sample


@dataclass(frozen=True)
class Reply:
    sample: Sample
    value: object = None


class RejectRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class HttpClient:
    def __init__(self, timeout, opener=None, clock=time.perf_counter):
        self.timeout = timeout
        # Environmental proxies and redirects would change the measured route/request count.
        self.opener = opener or build_opener(ProxyHandler({}), RejectRedirect()).open
        self.clock = clock

    def request(self, base, path, method, body, validate):
        address = urlsplit(base)
        if address.scheme != "http" or address.hostname != "127.0.0.1" or address.username or address.password:
            raise ValueError("benchmark requests are restricted to task-owned HTTP loopback services")
        data = json.dumps(body, allow_nan=False, separators=(",", ":")).encode("utf-8")
        request = Request(base + path, data=data, method=method, headers={
            "Content-Type": "application/json", "Connection": "close",
        })
        started = self.clock()
        try:
            with self.opener(request, timeout=self.timeout) as response:
                status, raw = response.status, response.read()
                elapsed = (self.clock() - started) * 1000
        except HTTPError as error:
            error.close()
            return Reply(Sample("http_error", http_status=error.code))
        except (TimeoutError, socket.timeout):
            return Reply(Sample("timeout"))
        except URLError as error:
            category = "timeout" if isinstance(error.reason, (TimeoutError, socket.timeout)) else "unreachable"
            return Reply(Sample(category))
        except OSError:
            return Reply(Sample("transport_error"))
        if status != 200:
            return Reply(Sample("http_error", http_status=status))
        try:
            value = json.loads(raw)
            validate(value)
        except (ValueError, TypeError, KeyError, AssertionError):
            return Reply(Sample("contract_error", http_status=status))
        except Exception:
            # jsonschema.ValidationError does not inherit ValueError.
            # A rejected output must never contribute a successful latency sample.
            return Reply(Sample("contract_error", http_status=status))
        return Reply(Sample("success", latency_ms=elapsed, http_status=status), value)
