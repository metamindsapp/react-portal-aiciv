#!/usr/bin/env python3
"""Presence Gateway integration for the per-CIV React Portal.

This module deliberately does *not* know how the Portal finds Claude/tmux
sessions. Its job is narrower: expose a same-origin, Portal-authenticated route
that mints a short-lived realtime voice token from the AICIV Presence Gateway.

Trust boundary:

    Browser ──Portal bearer──▶ Portal
       │                       │
       │                       ├── holds PRESENCE_GATEWAY_API_KEY
       │                       ▼
       │                Presence Gateway
       │                       │
       │                       ├── holds ElevenLabs API key
       │                       ▼
       └──── short-lived token ─ ElevenLabs WebRTC

No ElevenLabs, OpenAI, Presence Gateway, or AICIV callback long-lived secret is
returned to browser code.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Awaitable, Callable

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


AuthChecker = Callable[[Request], bool]
HttpClientFactory = Callable[[], httpx.AsyncClient]


class PresenceBridgeConfig:
    """Server-side Presence configuration loaded from environment / ~/.env."""

    def __init__(self, gateway_url: str, gateway_api_key: str, timeout_seconds: float = 8.0):
        self.gateway_url = gateway_url.rstrip("/")
        self.gateway_api_key = gateway_api_key
        self.timeout_seconds = timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self.gateway_url and self.gateway_api_key)


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

    return PresenceBridgeConfig(
        gateway_url=value("PRESENCE_GATEWAY_URL"),
        gateway_api_key=value("PRESENCE_GATEWAY_API_KEY"),
        timeout_seconds=timeout_seconds,
    )


def _default_http_client_factory(timeout_seconds: float) -> HttpClientFactory:
    return lambda: httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds))


def build_presence_routes(
    *,
    check_auth: AuthChecker,
    civ_name: str,
    human_name: str,
    config: PresenceBridgeConfig | None = None,
    http_client_factory: HttpClientFactory | None = None,
) -> list[Route]:
    """Build isolated Presence routes for registration on an existing Portal app.

    Dependency injection for config/client makes this boundary deterministic in
    tests and prevents CI from making network calls.
    """

    bridge_config = config or load_presence_bridge_config()
    client_factory = http_client_factory or _default_http_client_factory(bridge_config.timeout_seconds)

    async def presence_status(request: Request) -> JSONResponse:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)

        return JSONResponse(
            {
                "configured": bridge_config.configured,
                "surface": "portal",
                "civ": civ_name,
                # Useful client-facing capability data only. Never expose the
                # gateway URL/key: the browser does not need either one.
                "voice": {"available": bridge_config.configured},
            }
        )

    async def presence_voice_token(request: Request) -> JSONResponse:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        if not bridge_config.configured:
            return JSONResponse({"error": "presence_not_configured"}, status_code=503)

        participant_name = f"{civ_name}:{human_name}:portal"
        try:
            body = await request.json()
            if isinstance(body, dict):
                supplied = body.get("participantName")
                if isinstance(supplied, str) and supplied.strip():
                    # Participant labels are metadata, not identity authority.
                    participant_name = supplied.strip()[:160]
        except Exception:
            # Empty request bodies are fine; use the stable Portal-derived name.
            pass

        try:
            async with client_factory() as client:
                response = await client.post(
                    f"{bridge_config.gateway_url}/v1/voice/token",
                    headers={
                        "Authorization": f"Bearer {bridge_config.gateway_api_key}",
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json={"participantName": participant_name},
                )
        except (httpx.TimeoutException, httpx.NetworkError):
            return JSONResponse({"error": "presence_gateway_unavailable"}, status_code=502)
        except Exception:
            # Keep unexpected provider/client internals out of the browser.
            return JSONResponse({"error": "presence_gateway_error"}, status_code=502)

        if response.status_code < 200 or response.status_code >= 300:
            # Do not proxy upstream bodies. They may contain diagnostic details
            # that are useful in gateway logs but should not cross this boundary.
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

        # This is the only voice credential the browser receives, and it is
        # intentionally short-lived / session-scoped.
        return JSONResponse({"token": token, "conversationId": conversation_id})

    return [
        Route("/api/presence/status", endpoint=presence_status, methods=["GET"]),
        Route("/api/presence/voice/token", endpoint=presence_voice_token, methods=["POST"]),
    ]


def register_presence_routes(
    app: Starlette,
    *,
    check_auth: AuthChecker,
    civ_name: str,
    human_name: str,
    config: PresenceBridgeConfig | None = None,
    http_client_factory: HttpClientFactory | None = None,
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
    ):
        if route.path not in existing_paths:
            app.router.routes.append(route)
            existing_paths.add(route.path)
