"""Protect container inference calls without handling user accounts or tokens."""

import hmac
import os
import re
from pathlib import Path
from typing import Mapping, Optional

from starlette.responses import JSONResponse


TOKEN_HEADER = b"x-posegood-internal-token"


def load_internal_token(environment: Mapping[str, str]) -> Optional[bytes]:
    """A configured secret must be usable; absence is allowed only in local dev."""
    required = environment.get("POSEGOOD_REQUIRE_INTERNAL_TOKEN", "false").lower()
    if required not in {"true", "false", "1", "0"}:
        raise ValueError("invalid inference authentication configuration")

    filename = environment.get("POSEGOOD_INTERNAL_TOKEN_FILE")
    if not filename:
        if required in {"true", "1"}:
            raise ValueError("inference internal authentication secret is required")
        return None

    try:
        with Path(filename).open("rb") as source:
            contents = source.read(515)
    except OSError:
        raise ValueError("inference internal authentication secret is unavailable") from None

    token = contents.rstrip(b"\r\n")
    if len(contents) > 514 or not re.fullmatch(rb"[A-Za-z0-9_-]{32,512}", token):
        raise ValueError("invalid inference internal authentication secret")
    return token


class InternalTokenMiddleware:
    """Check one service credential before parsing any inference request body."""

    def __init__(self, app, token: Optional[bytes]):
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        is_health = scope.get("path") == "/health" and scope.get("method") in {"GET", "HEAD"}
        if scope["type"] != "http" or self.token is None or is_health:
            await self.app(scope, receive, send)
            return

        credentials = [
            value for name, value in scope.get("headers", [])
            if name.lower() == TOKEN_HEADER
        ]
        if len(credentials) == 1 and hmac.compare_digest(credentials[0], self.token):
            await self.app(scope, receive, send)
            return

        response = JSONResponse(status_code=401, content={"error": "unauthorized_internal_call"})
        await response(scope, receive, send)


def configured_token() -> Optional[bytes]:
    return load_internal_token(os.environ)
