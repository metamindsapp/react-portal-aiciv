#!/usr/bin/env python3
"""AICIV Portal HTTP boundary middleware.

Adds request correlation and stable outer-boundary failure semantics without
rewriting the mature portal_server.py endpoint implementations.

Responsibilities:
- generate/validate a request ID and expose it to endpoint code as x-request-id;
- echo X-Request-ID on every HTTP response;
- add baseline browser security headers;
- prevent an unhandled /api exception from becoming an HTML traceback response;
- log only a correlation ID + exception class/message, never request secrets.

This does not rewrite endpoint-specific non-2xx bodies. Frontend ApiError
normalization handles historical endpoints until they are extracted into domain
modules and given explicit error contracts.
"""

from __future__ import annotations

import re
import secrets
from typing import Awaitable, Callable

from starlette.applications import Starlette

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,120}$")


def _request_id(headers: list[tuple[bytes, bytes]]) -> str:
    for key, value in headers:
        if key.lower() == b"x-request-id":
            candidate = value.decode("latin-1", errors="ignore").strip()
            if _REQUEST_ID_RE.fullmatch(candidate):
                return candidate
    return "req_" + secrets.token_hex(12)


class RequestContextMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request_id = _request_id(list(scope.get("headers") or []))
        headers = [(k, v) for k, v in list(scope.get("headers") or []) if k.lower() != b"x-request-id"]
        headers.append((b"x-request-id", request_id.encode("ascii")))
        scope = {**scope, "headers": headers}

        async def send_with_context(message):
            if message.get("type") == "http.response.start":
                response_headers = list(message.get("headers") or [])
                response_headers.extend([
                    (b"x-request-id", request_id.encode("ascii")),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"same-origin"),
                    (b"permissions-policy", b"camera=(self), microphone=(self), geolocation=()"),
                ])
                message = {**message, "headers": response_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_context)
        except Exception as exc:
            path = str(scope.get("path") or "")
            print(f"[portal] request failed request_id={request_id} path={path} error={type(exc).__name__}: {exc}")
            if not path.startswith("/api/"):
                raise
            body = (
                '{"error":"internal_error","requestId":"'
                + request_id
                + '"}'
            ).encode("utf-8")
            await send({
                "type": "http.response.start",
                "status": 500,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"x-request-id", request_id.encode("ascii")),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"same-origin"),
                ],
            })
            await send({"type": "http.response.body", "body": body})


def install_http_boundary(app: Starlette) -> None:
    """Install once before Uvicorn starts accepting requests."""
    if getattr(app.state, "aiciv_http_boundary_installed", False):
        return
    app.add_middleware(RequestContextMiddleware)
    app.state.aiciv_http_boundary_installed = True
