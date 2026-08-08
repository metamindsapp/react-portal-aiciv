#!/usr/bin/env python3
"""Presence Gateway integration for the per-CIV React Portal.

This module deliberately does *not* know how the Portal finds Claude/tmux
sessions. Its job is narrower: expose same-origin, Portal-authenticated Presence
capabilities while keeping every long-lived Presence/provider credential on the
server side.

Trust boundary:

    Browser ──Portal session──▶ Portal
       │                       │
       │                       ├── holds PRESENCE_GATEWAY_API_KEY
       │                       ▼
       │                Presence Gateway
       │                  │            │
       │                  │            └── durable jobs / receipts
       │                  └── holds ElevenLabs + OpenAI secrets
       │
       └──── short-lived WebRTC token / sanitized job state

No ElevenLabs, OpenAI, Presence Gateway, Portal bootstrap bearer, or AICIV
callback long-lived secret is returned to browser code.
"""

from __future__ import annotations

import math
import os
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


AuthChecker = Callable[[Request], bool]
HttpClientFactory = Callable[[], httpx.AsyncClient]
Clock = Callable[[], float]

_JOB_ID_RE = re.compile(r"^job_[a-f0-9]{24}$")
_ALLOWED_JOB_STATUSES = {
    "queued",
    "accepted",
    "running",
    "waiting",
    "cancel_requested",
    "succeeded",
    "failed",
    "cancelled",
}


class PresenceBridgeConfig:
    """Server-side Presence configuration loaded from environment / ~/.env."""

    def __init__(
        self,
        gateway_url: str,
        gateway_api_key: str,
        timeout_seconds: float = 8.0,
        token_limit: int = 12,
        token_window_seconds: float = 60.0,
    ):
        self.gateway_url = gateway_url.rstrip("/")
        self.gateway_api_key = gateway_api_key
        self.timeout_seconds = timeout_seconds
        self.token_limit = max(1, min(int(token_limit), 1_000))
        self.token_window_seconds = max(1.0, min(float(token_window_seconds), 3_600.0))

    @property
    def configured(self) -> bool:
        return bool(self.gateway_url and self.gateway_api_key)


class SlidingWindowLimiter:
    """Small process-local limiter for expensive credential mint operations.

    Portal currently has one authenticated human surface per CIV, so a
    per-process bucket is the correct first boundary: it catches accidental
    reconnect storms and malicious browser loops without trusting spoofable
    forwarded-IP headers. Fleet/tenant-wide quotas belong at the Presence
    Gateway once multi-tenant auth lands there.
    """

    def __init__(self, limit: int, window_seconds: float, clock: Clock = time.monotonic):
        self.limit = max(1, int(limit))
        self.window_seconds = max(1.0, float(window_seconds))
        self._clock = clock
        self._events: deque[float] = deque()
        self._lock = threading.Lock()

    def consume(self) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds)."""
        now = self._clock()
        cutoff = now - self.window_seconds
        with self._lock:
            while self._events and self._events[0] <= cutoff:
                self._events.popleft()

            if len(self._events) >= self.limit:
                retry_after = max(1, math.ceil(self.window_seconds - (now - self._events[0])))
                return False, retry_after

            self._events.append(now)
            return True, 0


def _read_dotenv(path: Path | None = None) -> dict[str, str]:
    """Read simple KEY=value entries without executing shell syntax."""
    env_path = path or (Path.home() / ".env")
    values: dict[str, str] = {}
    if not env_path.exists():
        return values

    try:
        for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            values[key] = value
    except OSError:
        pass
    return values


def load_presence_bridge_config() -> PresenceBridgeConfig:
    """Load Presence credentials server-side, preferring process environment."""
    dotenv = _read_dotenv()

    def value(name: str) -> str:
        return os.environ.get(name, "").strip() or dotenv.get(name, "").strip()

    timeout_raw = value("PRESENCE_GATEWAY_TIMEOUT_SECONDS")
    try:
        timeout_seconds = float(timeout_raw) if timeout_raw else 8.0
    except ValueError:
        timeout_seconds = 8.0
    timeout_seconds = max(1.0, min(timeout_seconds, 30.0))

    token_limit_raw = value("PRESENCE_VOICE_TOKEN_LIMIT")
    try:
        token_limit = int(token_limit_raw) if token_limit_raw else 12
    except ValueError:
        token_limit = 12

    token_window_raw = value("PRESENCE_VOICE_TOKEN_WINDOW_SECONDS")
    try:
        token_window_seconds = float(token_window_raw) if token_window_raw else 60.0
    except ValueError:
        token_window_seconds = 60.0

    return PresenceBridgeConfig(
        gateway_url=value("PRESENCE_GATEWAY_URL"),
        gateway_api_key=value("PRESENCE_GATEWAY_API_KEY"),
        timeout_seconds=timeout_seconds,
        token_limit=token_limit,
        token_window_seconds=token_window_seconds,
    )


def _default_http_client_factory(timeout_seconds: float) -> HttpClientFactory:
    return lambda: httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds))


def _gateway_headers(config: PresenceBridgeConfig) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {config.gateway_api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _stable_gateway_error(status_code: int) -> JSONResponse:
    """Do not proxy upstream error bodies across the Portal trust boundary."""
    if status_code == 404:
        return JSONResponse({"error": "presence_job_not_found"}, status_code=404)
    if status_code == 409:
        return JSONResponse({"error": "presence_job_conflict"}, status_code=409)
    if status_code in (401, 403):
        return JSONResponse({"error": "presence_gateway_auth_failed"}, status_code=502)
    return JSONResponse({"error": "presence_gateway_unavailable"}, status_code=502)


def build_presence_routes(
    *,
    check_auth: AuthChecker,
    civ_name: str,
    human_name: str,
    config: PresenceBridgeConfig | None = None,
    http_client_factory: HttpClientFactory | None = None,
    token_limiter: SlidingWindowLimiter | None = None,
) -> list[Route]:
    """Build isolated Presence routes for registration on an existing Portal app."""

    bridge_config = config or load_presence_bridge_config()
    client_factory = http_client_factory or _default_http_client_factory(bridge_config.timeout_seconds)
    limiter = token_limiter or SlidingWindowLimiter(
        bridge_config.token_limit,
        bridge_config.token_window_seconds,
    )

    def require_portal_auth(request: Request) -> JSONResponse | None:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        if not bridge_config.configured:
            return JSONResponse({"error": "presence_not_configured"}, status_code=503)
        return None

    async def presence_status(request: Request) -> JSONResponse:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)

        return JSONResponse(
            {
                "configured": bridge_config.configured,
                "surface": "portal",
                "civ": civ_name,
                "voice": {"available": bridge_config.configured},
                "jobs": {"available": bridge_config.configured},
            }
        )

    async def presence_voice_token(request: Request) -> JSONResponse:
        auth_error = require_portal_auth(request)
        if auth_error:
            return auth_error

        allowed, retry_after = limiter.consume()
        if not allowed:
            return JSONResponse(
                {"error": "voice_token_rate_limited"},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )

        # All identity metadata is derived from authenticated Portal state. The
        # participant label identifies this realtime body/session; continuity_key
        # deliberately excludes the surface so Portal/phone/Reachy/watch can map
        # to one durable human↔AICIV relationship in Presence.
        participant_name = f"{civ_name}:{human_name}:portal"[:160]
        continuity_key = f"{civ_name}:{human_name}"[:300]

        try:
            async with client_factory() as client:
                response = await client.post(
                    f"{bridge_config.gateway_url}/v1/voice/token",
                    headers=_gateway_headers(bridge_config),
                    json={
                        "participantName": participant_name,
                        "continuityKey": continuity_key,
                        "surface": "portal",
                    },
                )
        except (httpx.TimeoutException, httpx.NetworkError):
            return JSONResponse({"error": "presence_gateway_unavailable"}, status_code=502)
        except Exception:
            return JSONResponse({"error": "presence_gateway_error"}, status_code=502)

        if response.status_code < 200 or response.status_code >= 300:
            return JSONResponse({"error": "voice_token_unavailable"}, status_code=502)

        try:
            payload = response.json()
        except Exception:
            return JSONResponse({"error": "invalid_voice_token_response"}, status_code=502)

        if not isinstance(payload, dict):
            return JSONResponse({"error": "invalid_voice_token_response"}, status_code=502)
        token = payload.get("token")
        conversation_id = payload.get("conversationId")
        if not isinstance(token, str) or not token:
            return JSONResponse({"error": "invalid_voice_token_response"}, status_code=502)
        if not isinstance(conversation_id, str) or not conversation_id:
            return JSONResponse({"error": "invalid_voice_token_response"}, status_code=502)

        return JSONResponse({"token": token, "conversationId": conversation_id})

    async def presence_jobs(request: Request) -> JSONResponse:
        """Expose recent durable Presence jobs as shared Portal work objects."""
        auth_error = require_portal_auth(request)
        if auth_error:
            return auth_error

        try:
            limit = int(request.query_params.get("limit", "50"))
        except ValueError:
            limit = 50
        limit = max(1, min(limit, 100))

        params: dict[str, str] = {"limit": str(limit)}
        status = request.query_params.get("status", "").strip()
        if status:
            if status not in _ALLOWED_JOB_STATUSES:
                return JSONResponse({"error": "invalid_presence_job_status"}, status_code=400)
            params["status"] = status

        try:
            async with client_factory() as client:
                response = await client.get(
                    f"{bridge_config.gateway_url}/v1/delegations",
                    headers=_gateway_headers(bridge_config),
                    params=params,
                )
        except (httpx.TimeoutException, httpx.NetworkError):
            return JSONResponse({"error": "presence_gateway_unavailable"}, status_code=502)
        except Exception:
            return JSONResponse({"error": "presence_gateway_error"}, status_code=502)

        if not (200 <= response.status_code < 300):
            return _stable_gateway_error(response.status_code)

        try:
            payload = response.json()
        except Exception:
            return JSONResponse({"error": "invalid_presence_jobs_response"}, status_code=502)
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
            return JSONResponse({"error": "invalid_presence_jobs_response"}, status_code=502)

        jobs = payload["jobs"][:limit]
        return JSONResponse({"jobs": jobs, "count": len(jobs)})

    async def presence_job(request: Request) -> JSONResponse:
        """Read one authoritative durable job/result/receipt object."""
        auth_error = require_portal_auth(request)
        if auth_error:
            return auth_error

        job_id = request.path_params.get("job_id", "")
        if not _JOB_ID_RE.fullmatch(job_id):
            return JSONResponse({"error": "invalid_presence_job_id"}, status_code=400)

        try:
            async with client_factory() as client:
                response = await client.get(
                    f"{bridge_config.gateway_url}/v1/delegations/{job_id}",
                    headers=_gateway_headers(bridge_config),
                )
        except (httpx.TimeoutException, httpx.NetworkError):
            return JSONResponse({"error": "presence_gateway_unavailable"}, status_code=502)
        except Exception:
            return JSONResponse({"error": "presence_gateway_error"}, status_code=502)

        if not (200 <= response.status_code < 300):
            return _stable_gateway_error(response.status_code)

        try:
            payload = response.json()
        except Exception:
            return JSONResponse({"error": "invalid_presence_job_response"}, status_code=502)
        if not isinstance(payload, dict) or not isinstance(payload.get("job"), dict):
            return JSONResponse({"error": "invalid_presence_job_response"}, status_code=502)
        return JSONResponse({"job": payload["job"]})

    async def presence_cancel_job(request: Request) -> JSONResponse:
        """Request cancellation without pretending cancellation is complete."""
        auth_error = require_portal_auth(request)
        if auth_error:
            return auth_error

        job_id = request.path_params.get("job_id", "")
        if not _JOB_ID_RE.fullmatch(job_id):
            return JSONResponse({"error": "invalid_presence_job_id"}, status_code=400)

        try:
            async with client_factory() as client:
                response = await client.post(
                    f"{bridge_config.gateway_url}/v1/delegations/{job_id}/cancel",
                    headers=_gateway_headers(bridge_config),
                    json={},
                )
        except (httpx.TimeoutException, httpx.NetworkError):
            return JSONResponse({"error": "presence_gateway_unavailable"}, status_code=502)
        except Exception:
            return JSONResponse({"error": "presence_gateway_error"}, status_code=502)

        if not (200 <= response.status_code < 300):
            return _stable_gateway_error(response.status_code)

        try:
            payload = response.json()
        except Exception:
            return JSONResponse({"error": "invalid_presence_job_response"}, status_code=502)
        if not isinstance(payload, dict) or not isinstance(payload.get("job"), dict):
            return JSONResponse({"error": "invalid_presence_job_response"}, status_code=502)
        return JSONResponse({"job": payload["job"]}, status_code=202)

    return [
        Route("/api/presence/status", endpoint=presence_status, methods=["GET"]),
        Route("/api/presence/voice/token", endpoint=presence_voice_token, methods=["POST"]),
        Route("/api/presence/jobs", endpoint=presence_jobs, methods=["GET"]),
        Route("/api/presence/jobs/{job_id}", endpoint=presence_job, methods=["GET"]),
        Route("/api/presence/jobs/{job_id}/cancel", endpoint=presence_cancel_job, methods=["POST"]),
    ]


def register_presence_routes(
    app: Starlette,
    *,
    check_auth: AuthChecker,
    civ_name: str,
    human_name: str,
    config: PresenceBridgeConfig | None = None,
    http_client_factory: HttpClientFactory | None = None,
    token_limiter: SlidingWindowLimiter | None = None,
) -> None:
    """Append Presence routes once to an existing Starlette Portal application."""
    existing_paths = {
        getattr(route, "path", None)
        for route in app.routes
        if getattr(route, "path", None)
    }

    for route in build_presence_routes(
        check_auth=check_auth,
        civ_name=civ_name,
        human_name=human_name,
        config=config,
        http_client_factory=http_client_factory,
        token_limiter=token_limiter,
    ):
        if route.path not in existing_paths:
            app.router.routes.append(route)
            existing_paths.add(route.path)
