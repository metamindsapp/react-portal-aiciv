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

    async def __aenter__(self): return self
    async def __aexit__(self, exc_type, exc, tb): return False

    def _respond(self):
        if self.error: raise self.error
        if self.response is None: raise RuntimeError("fake client has no response")
        return self.response

    async def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]):
        self.requests.append({"method": "POST", "url": url, "headers": headers, "json": json})
        return self._respond()

    async def get(self, url: str, *, headers: dict[str, str], params: dict[str, str] | None = None):
        self.requests.append({"method": "GET", "url": url, "headers": headers, "params": params or {}})
        return self._respond()


class FakeClock:
    def __init__(self, start: float = 1000.0): self.now = start
    def __call__(self) -> float: return self.now
    def advance(self, seconds: float) -> None: self.now += seconds


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

    @staticmethod
    def auth_headers() -> dict[str, str]:
        return {"Authorization": "Bearer portal-user-token"}

    def test_status_requires_portal_auth_and_never_returns_gateway_secret(self):
        client, _ = self.build_client()
        self.assertEqual(client.get("/api/presence/status").status_code, 401)
        response = client.get("/api/presence/status", headers=self.auth_headers())
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["configured"], True)
        self.assertEqual(payload["civ"], "synth")
        self.assertEqual(payload["jobs"]["available"], True)
        encoded = json.dumps(payload)
        self.assertNotIn("gateway-super-secret", encoded)
        self.assertNotIn("presence.internal.example", encoded)

    def test_token_route_sends_surface_and_stable_relationship_continuity(self):
        upstream = httpx.Response(200, json={"token": "short-lived-conversation-token", "conversationId": "conv_123"})
        client, fake_http = self.build_client(upstream_response=upstream)

        response = client.post("/api/presence/voice/token", headers=self.auth_headers(), json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"token": "short-lived-conversation-token", "conversationId": "conv_123"})
        self.assertEqual(len(fake_http.requests), 1)
        sent = fake_http.requests[0]
        self.assertEqual(sent["url"], "https://presence.internal.example/v1/voice/token")
        self.assertEqual(sent["headers"]["Authorization"], "Bearer gateway-super-secret-do-not-leak")
        self.assertEqual(sent["json"], {
            "participantName": "synth:Corey:portal",
            "continuityKey": "synth:Corey",
            "surface": "portal",
        })
        self.assertNotIn("gateway-super-secret", response.text)

    def test_browser_identity_metadata_is_ignored_in_favor_of_authenticated_portal_state(self):
        upstream = httpx.Response(200, json={"token": "voice-token", "conversationId": "conv_custom"})
        client, fake_http = self.build_client(upstream_response=upstream)

        response = client.post(
            "/api/presence/voice/token",
            headers=self.auth_headers(),
            json={
                "participantName": "I-am-definitely-someone-else",
                "continuityKey": "other-human:other-civ",
                "surface": "evil-browser",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake_http.requests[0]["json"], {
            "participantName": "synth:Corey:portal",
            "continuityKey": "synth:Corey",
            "surface": "portal",
        })

    def test_unconfigured_bridge_fails_closed_without_network_call(self):
        client, fake_http = self.build_client(configured=False)
        response = client.post("/api/presence/voice/token", headers=self.auth_headers(), json={})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"error": "presence_not_configured"})
        self.assertEqual(fake_http.requests, [])

    def test_upstream_failure_returns_stable_error_not_upstream_body(self):
        upstream = httpx.Response(500, json={"secret_diagnostic": "provider internals should not leak"})
        client, _ = self.build_client(upstream_response=upstream)
        response = client.post("/api/presence/voice/token", headers=self.auth_headers(), json={})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"error": "voice_token_unavailable"})
        self.assertNotIn("secret_diagnostic", response.text)

    def test_invalid_upstream_token_shape_is_rejected(self):
        client, _ = self.build_client(upstream_response=httpx.Response(200, json={"token": "", "conversationId": None}))
        response = client.post("/api/presence/voice/token", headers=self.auth_headers(), json={})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"error": "invalid_voice_token_response"})

    def test_authenticated_token_minting_is_rate_limited_before_upstream_call(self):
        upstream = httpx.Response(200, json={"token": "voice-token", "conversationId": "conv_rate"})
        clock = FakeClock()
        limiter = SlidingWindowLimiter(limit=2, window_seconds=60, clock=clock)
        client, fake_http = self.build_client(upstream_response=upstream, token_limiter=limiter)
        headers = self.auth_headers()
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
        for _ in range(5): self.assertEqual(client.post("/api/presence/voice/token").status_code, 401)
        allowed = client.post("/api/presence/voice/token", headers=self.auth_headers())
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(len(fake_http.requests), 1)

    def test_recent_jobs_are_exposed_without_gateway_credentials(self):
        job = {
            "jobId": "job_0123456789abcdef01234567",
            "goal": "Compare provider latency",
            "status": "running",
            "receipts": [],
            "events": [],
            "createdAt": "2026-08-08T12:00:00.000Z",
            "updatedAt": "2026-08-08T12:01:00.000Z",
        }
        upstream = httpx.Response(200, json={"jobs": [job], "count": 1})
        client, fake_http = self.build_client(upstream_response=upstream)
        response = client.get("/api/presence/jobs?limit=12&status=running", headers=self.auth_headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["jobs"][0]["jobId"], job["jobId"])
        self.assertEqual(fake_http.requests[0]["method"], "GET")
        self.assertEqual(fake_http.requests[0]["url"], "https://presence.internal.example/v1/delegations")
        self.assertEqual(fake_http.requests[0]["params"], {"limit": "12", "status": "running"})
        self.assertNotIn("gateway-super-secret", response.text)

    def test_job_cancel_returns_cancel_requested_state_not_fake_completion(self):
        job_id = "job_0123456789abcdef01234567"
        upstream = httpx.Response(202, json={"job": {"jobId": job_id, "goal": "Long research", "status": "cancel_requested", "receipts": [], "events": []}})
        client, fake_http = self.build_client(upstream_response=upstream)
        response = client.post(f"/api/presence/jobs/{job_id}/cancel", headers=self.auth_headers())
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["job"]["status"], "cancel_requested")
        self.assertEqual(fake_http.requests[0]["method"], "POST")
        self.assertTrue(fake_http.requests[0]["url"].endswith(f"/v1/delegations/{job_id}/cancel"))

    def test_invalid_job_ids_never_reach_gateway(self):
        client, fake_http = self.build_client(upstream_response=httpx.Response(200, json={}))
        response = client.get("/api/presence/jobs/not-a-job", headers=self.auth_headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(fake_http.requests, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
