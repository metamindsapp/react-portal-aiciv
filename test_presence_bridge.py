#!/usr/bin/env python3
"""Focused tests for the Portal ↔ Presence Gateway trust boundary."""

from __future__ import annotations

import json
import unittest
from typing import Any

import httpx
from starlette.applications import Starlette
from starlette.testclient import TestClient

from presence_bridge import PresenceBridgeConfig, SlidingWindowLimiter, register_presence_routes


class FakeAsyncClient:
    def __init__(self, *, response: httpx.Response | None = None, error: Exception | None = None):
        self.response = response
        self.error = error
        self.requests: list[dict[str, Any]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]):
        self.requests.append({"url": url, "headers": headers, "json": json})
        if self.error:
            raise self.error
        if self.response is None:
            raise RuntimeError("fake client has no response")
        return self.response


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class PresenceBridgeTests(unittest.TestCase):
    def build_client(
        self,
        *,
        configured: bool = True,
        upstream_response: httpx.Response | None = None,
        upstream_error: Exception | None = None,
        token_limiter: SlidingWindowLimiter | None = None,
    ) -> tuple[TestClient, FakeAsyncClient]:
        config = PresenceBridgeConfig(
            gateway_url="https://presence.internal.example" if configured else "",
            gateway_api_key="gateway-super-secret-do-not-leak" if configured else "",
        )
        fake_http = FakeAsyncClient(response=upstream_response, error=upstream_error)
        app = Starlette()

        def check_auth(request) -> bool:
            return request.headers.get("authorization") == "Bearer portal-user-token"

        register_presence_routes(
            app,
            check_auth=check_auth,
            civ_name="synth",
            human_name="Corey",
            config=config,
            http_client_factory=lambda: fake_http,
            token_limiter=token_limiter,
        )
        # Double registration must remain a no-op; wrapper imports/reloads should
        # never create duplicate matching routes.
        register_presence_routes(
            app,
            check_auth=check_auth,
            civ_name="synth",
            human_name="Corey",
            config=config,
            http_client_factory=lambda: fake_http,
            token_limiter=token_limiter,
        )
        return TestClient(app), fake_http

    def test_status_requires_portal_auth_and_never_returns_gateway_secret(self):
        client, _ = self.build_client()
        self.assertEqual(client.get("/api/presence/status").status_code, 401)

        response = client.get(
            "/api/presence/status",
            headers={"Authorization": "Bearer portal-user-token"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["configured"], True)
        self.assertEqual(payload["civ"], "synth")
        encoded = json.dumps(payload)
        self.assertNotIn("gateway-super-secret", encoded)
        self.assertNotIn("presence.internal.example", encoded)

    def test_token_route_proxies_only_server_side_gateway_auth(self):
        upstream = httpx.Response(
            200,
            json={"token": "short-lived-conversation-token", "conversationId": "conv_123"},
        )
        client, fake_http = self.build_client(upstream_response=upstream)

        response = client.post(
            "/api/presence/voice/token",
            headers={"Authorization": "Bearer portal-user-token"},
            json={},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"token": "short-lived-conversation-token", "conversationId": "conv_123"},
        )
        self.assertEqual(len(fake_http.requests), 1)
        sent = fake_http.requests[0]
        self.assertEqual(sent["url"], "https://presence.internal.example/v1/voice/token")
        self.assertEqual(
            sent["headers"]["Authorization"],
            "Bearer gateway-super-secret-do-not-leak",
        )
        self.assertEqual(sent["json"]["participantName"], "synth:Corey:portal")

        # Long-lived gateway auth must never appear in the response body.
        self.assertNotIn("gateway-super-secret", response.text)

    def test_browser_participant_label_is_ignored_in_favor_of_portal_identity(self):
        upstream = httpx.Response(
            200,
            json={"token": "voice-token", "conversationId": "conv_custom"},
        )
        client, fake_http = self.build_client(upstream_response=upstream)

        response = client.post(
            "/api/presence/voice/token",
            headers={"Authorization": "Bearer portal-user-token"},
            json={"participantName": "I-am-definitely-someone-else"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake_http.requests[0]["json"]["participantName"], "synth:Corey:portal")

    def test_unconfigured_bridge_fails_closed_without_network_call(self):
        client, fake_http = self.build_client(configured=False)
        response = client.post(
            "/api/presence/voice/token",
            headers={"Authorization": "Bearer portal-user-token"},
            json={},
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"error": "presence_not_configured"})
        self.assertEqual(fake_http.requests, [])

    def test_upstream_failure_returns_stable_error_not_upstream_body(self):
        upstream = httpx.Response(
            500,
            json={"secret_diagnostic": "provider internals should not leak"},
        )
        client, _ = self.build_client(upstream_response=upstream)
        response = client.post(
            "/api/presence/voice/token",
            headers={"Authorization": "Bearer portal-user-token"},
            json={},
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"error": "voice_token_unavailable"})
        self.assertNotIn("secret_diagnostic", response.text)

    def test_invalid_upstream_token_shape_is_rejected(self):
        upstream = httpx.Response(200, json={"token": "", "conversationId": None})
        client, _ = self.build_client(upstream_response=upstream)
        response = client.post(
            "/api/presence/voice/token",
            headers={"Authorization": "Bearer portal-user-token"},
            json={},
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"error": "invalid_voice_token_response"})

    def test_authenticated_token_minting_is_rate_limited_before_upstream_call(self):
        upstream = httpx.Response(200, json={"token": "voice-token", "conversationId": "conv_rate"})
        clock = FakeClock()
        limiter = SlidingWindowLimiter(limit=2, window_seconds=60, clock=clock)
        client, fake_http = self.build_client(upstream_response=upstream, token_limiter=limiter)
        headers = {"Authorization": "Bearer portal-user-token"}

        self.assertEqual(client.post("/api/presence/voice/token", headers=headers).status_code, 200)
        self.assertEqual(client.post("/api/presence/voice/token", headers=headers).status_code, 200)
        limited = client.post("/api/presence/voice/token", headers=headers)

        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json(), {"error": "voice_token_rate_limited"})
        self.assertEqual(limited.headers.get("Retry-After"), "60")
        self.assertEqual(len(fake_http.requests), 2)

        clock.advance(60)
        self.assertEqual(client.post("/api/presence/voice/token", headers=headers).status_code, 200)
        self.assertEqual(len(fake_http.requests), 3)

    def test_unauthenticated_requests_do_not_consume_rate_limit(self):
        upstream = httpx.Response(200, json={"token": "voice-token", "conversationId": "conv_auth"})
        limiter = SlidingWindowLimiter(limit=1, window_seconds=60, clock=FakeClock())
        client, fake_http = self.build_client(upstream_response=upstream, token_limiter=limiter)

        for _ in range(5):
            self.assertEqual(client.post("/api/presence/voice/token").status_code, 401)

        allowed = client.post(
            "/api/presence/voice/token",
            headers={"Authorization": "Bearer portal-user-token"},
        )
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(len(fake_http.requests), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
