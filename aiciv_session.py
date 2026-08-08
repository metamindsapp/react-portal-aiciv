#!/usr/bin/env python3
"""Short-lived same-origin Portal sessions.

The historic Portal bearer remains the server bootstrap credential, but normal
browser operation should not keep that long-lived secret in localStorage or WebSocket
query strings.

This extension creates short-lived random browser sessions and installs an ASGI
compatibility layer:

Browser cookie -> validated session -> internal legacy auth injection -> core Portal

That lets the mature portal_server.py keep its existing auth checks while the raw
Portal bearer never needs to remain in the browser after login/magic-link exchange.

WebSocket compatibility is handled at the same boundary: a valid HttpOnly session
cookie is translated into the legacy `?token=` value only inside the ASGI scope
before the existing chat/terminal/browser handlers see it.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Callable
from urllib.parse import parse_qsl, urlencode

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

SESSION_COOKIE = "aiciv_session"
DEFAULT_TTL_SECONDS = 8 * 60 * 60
DEFAULT_MAX_SESSIONS = 64


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now() -> float:
    return time.time()


def _constant_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _cookie_value(headers: list[tuple[bytes, bytes]], name: str) -> str:
    cookie_header = ""
    for key, value in headers:
        if key.lower() == b"cookie":
            cookie_header = value.decode("latin-1", errors="ignore")
            break
    if not cookie_header:
        return ""
    jar = SimpleCookie()
    try:
        jar.load(cookie_header)
        morsel = jar.get(name)
        return morsel.value if morsel else ""
    except Exception:
        return ""


def _header_value(headers: list[tuple[bytes, bytes]], name: bytes) -> str:
    for key, value in headers:
        if key.lower() == name:
            return value.decode("latin-1", errors="ignore")
    return ""


def _secure_cookie(scope) -> bool:
    configured = os.environ.get("PORTAL_SESSION_COOKIE_SECURE", "auto").strip().lower()
    if configured in ("1", "true", "yes", "on"):
        return True
    if configured in ("0", "false", "no", "off"):
        return False
    headers = list(scope.get("headers") or [])
    forwarded = _header_value(headers, b"x-forwarded-proto").split(",", 1)[0].strip().lower()
    return scope.get("scheme") == "https" or forwarded == "https"


@dataclass(frozen=True)
class SessionRecord:
    digest: str
    created_at: float
    expires_at: float
    last_seen_at: float


class SessionManager:
    """Process-local short-lived browser sessions.

    Restart invalidates browser sessions, which is an acceptable fail-closed
    property for the current per-CIV Portal deployment. The user can exchange the
    server bootstrap bearer again; a future fleet identity service can replace
    this manager without changing browser/WebSocket contracts.
    """

    def __init__(
        self,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        max_sessions: int = DEFAULT_MAX_SESSIONS,
        clock: Callable[[], float] = _now,
    ):
        self.ttl_seconds = max(300, min(int(ttl_seconds), 7 * 24 * 60 * 60))
        self.max_sessions = max(1, min(int(max_sessions), 1000))
        self._clock = clock
        self._records: dict[str, SessionRecord] = {}
        self._lock = threading.Lock()

    def _prune_unlocked(self, now: float) -> None:
        expired = [key for key, record in self._records.items() if record.expires_at <= now]
        for key in expired:
            self._records.pop(key, None)
        if len(self._records) <= self.max_sessions:
            return
        ordered = sorted(self._records.items(), key=lambda item: item[1].last_seen_at)
        for key, _ in ordered[: len(self._records) - self.max_sessions]:
            self._records.pop(key, None)

    def create(self) -> tuple[str, SessionRecord]:
        now = self._clock()
        token = secrets.token_urlsafe(32)
        digest = _sha(token)
        record = SessionRecord(digest=digest, created_at=now, expires_at=now + self.ttl_seconds, last_seen_at=now)
        with self._lock:
            self._prune_unlocked(now)
            self._records[digest] = record
            self._prune_unlocked(now)
        return token, record

    def validate(self, token: str) -> SessionRecord | None:
        if not token:
            return None
        now = self._clock()
        digest = _sha(token)
        with self._lock:
            self._prune_unlocked(now)
            record = self._records.get(digest)
            if not record or record.expires_at <= now:
                self._records.pop(digest, None)
                return None
            refreshed = SessionRecord(
                digest=record.digest,
                created_at=record.created_at,
                expires_at=record.expires_at,
                last_seen_at=now,
            )
            self._records[digest] = refreshed
            return refreshed

    def revoke(self, token: str) -> bool:
        if not token:
            return False
        with self._lock:
            return self._records.pop(_sha(token), None) is not None

    @property
    def active_count(self) -> int:
        now = self._clock()
        with self._lock:
            self._prune_unlocked(now)
            return len(self._records)


def _ttl_from_env() -> int:
    try:
        return int(os.environ.get("PORTAL_SESSION_TTL_SECONDS", str(DEFAULT_TTL_SECONDS)))
    except ValueError:
        return DEFAULT_TTL_SECONDS


def _max_from_env() -> int:
    try:
        return int(os.environ.get("PORTAL_SESSION_MAX", str(DEFAULT_MAX_SESSIONS)))
    except ValueError:
        return DEFAULT_MAX_SESSIONS


def build_session_routes(*, manager: SessionManager, portal_bearer: str) -> list[Route]:
    async def start_session(request: Request) -> JSONResponse:
        auth = request.headers.get("authorization", "")
        supplied = auth[7:] if auth.startswith("Bearer ") else ""
        if not supplied or not _constant_equal(supplied, portal_bearer):
            return JSONResponse({"error": "invalid_portal_credential"}, status_code=401)

        token, record = manager.create()
        response = JSONResponse({
            "authenticated": True,
            "expiresAt": int(record.expires_at * 1000),
            "sessionMode": "http_only_cookie",
        })
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=manager.ttl_seconds,
            expires=manager.ttl_seconds,
            path="/",
            secure=_secure_cookie(request.scope),
            httponly=True,
            samesite="strict",
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    async def session_status(request: Request) -> JSONResponse:
        token = request.cookies.get(SESSION_COOKIE, "")
        record = manager.validate(token)
        response = JSONResponse({
            "authenticated": bool(record),
            "expiresAt": int(record.expires_at * 1000) if record else None,
            "sessionMode": "http_only_cookie" if record else None,
        })
        response.headers["Cache-Control"] = "no-store"
        return response

    async def end_session(request: Request) -> JSONResponse:
        token = request.cookies.get(SESSION_COOKIE, "")
        revoked = manager.revoke(token)
        response = JSONResponse({"authenticated": False, "revoked": revoked})
        response.delete_cookie(SESSION_COOKIE, path="/")
        response.headers["Cache-Control"] = "no-store"
        return response

    return [
        Route("/api/session/start", endpoint=start_session, methods=["POST"]),
        Route("/api/session", endpoint=session_status, methods=["GET"]),
        Route("/api/session", endpoint=end_session, methods=["DELETE"]),
    ]


class SessionCompatibilityMiddleware:
    """Translate a validated cookie into legacy core auth only inside ASGI."""

    def __init__(self, app, *, manager: SessionManager, portal_bearer: str):
        self.app = app
        self.manager = manager
        self.portal_bearer = portal_bearer

    async def __call__(self, scope, receive, send):
        scope_type = scope.get("type")
        if scope_type not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = list(scope.get("headers") or [])
        cookie_token = _cookie_value(headers, SESSION_COOKIE)
        record = self.manager.validate(cookie_token)
        if not record:
            await self.app(scope, receive, send)
            return

        # Browser cookie auth must not be usable from an explicit cross-site fetch.
        fetch_site = _header_value(headers, b"sec-fetch-site").lower()
        if scope_type == "http" and fetch_site == "cross-site":
            await self.app(scope, receive, send)
            return

        if scope_type == "http":
            headers = [(key, value) for key, value in headers if key.lower() != b"authorization"]
            headers.append((b"authorization", f"Bearer {self.portal_bearer}".encode("latin-1")))
            scope = {**scope, "headers": headers}
        else:
            # Existing websocket handlers read query_params['token']. Rewrite the
            # ASGI query only after cookie validation, keeping the long-lived
            # Portal bearer entirely server-side.
            raw_query = (scope.get("query_string") or b"").decode("latin-1", errors="ignore")
            pairs = [(key, value) for key, value in parse_qsl(raw_query, keep_blank_values=True) if key != "token"]
            pairs.append(("token", self.portal_bearer))
            scope = {**scope, "query_string": urlencode(pairs).encode("latin-1")}

        await self.app(scope, receive, send)


def install_session_auth(app: Starlette, *, portal_bearer: str, manager: SessionManager | None = None) -> SessionManager:
    existing = getattr(app.state, "aiciv_session_manager", None)
    if isinstance(existing, SessionManager):
        return existing

    sessions = manager or SessionManager(_ttl_from_env(), _max_from_env())
    for route in build_session_routes(manager=sessions, portal_bearer=portal_bearer):
        duplicate = any(
            getattr(existing_route, "path", None) == route.path
            and getattr(existing_route, "methods", None) == route.methods
            for existing_route in app.routes
        )
        if not duplicate:
            app.router.routes.append(route)

    app.add_middleware(SessionCompatibilityMiddleware, manager=sessions, portal_bearer=portal_bearer)
    app.state.aiciv_session_manager = sessions
    return sessions
