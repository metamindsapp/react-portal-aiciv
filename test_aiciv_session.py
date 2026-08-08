#!/usr/bin/env python3
from __future__ import annotations

import unittest

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocket

from aiciv_session import SESSION_COOKIE, SessionManager, install_session_auth

PORTAL_BEARER = "portal-long-lived-bootstrap-secret"


class FakeClock:
    def __init__(self):
        self.value = 1_700_000_000.0

    def __call__(self):
        return self.value

    def advance(self, seconds: float):
        self.value += seconds


def legacy_http_auth(request: Request) -> bool:
    return request.headers.get("authorization") == f"Bearer {PORTAL_BEARER}"


async def protected_http(request: Request):
    if not legacy_http_auth(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return JSONResponse({"ok": True})


async def legacy_ws(websocket: WebSocket):
    if websocket.query_params.get("token") != PORTAL_BEARER:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    await websocket.send_json({"ok": True})
    await websocket.close()


class SessionTests(unittest.TestCase):
    def build(self, ttl=3600):
        self.clock = FakeClock()
        manager = SessionManager(ttl_seconds=ttl, max_sessions=4, clock=self.clock)
        app = Starlette(routes=[
            Route("/api/protected", protected_http),
            WebSocketRoute("/ws/protected", legacy_ws),
        ])
        install_session_auth(app, portal_bearer=PORTAL_BEARER, manager=manager)
        return TestClient(app), manager

    def start(self, client: TestClient):
        return client.post(
            "/api/session/start",
            headers={"Authorization": f"Bearer {PORTAL_BEARER}"},
        )

    def test_bootstrap_exchange_sets_http_only_same_site_cookie(self):
        client, _ = self.build()
        response = self.start(client)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sessionMode"], "http_only_cookie")
        cookie = response.headers.get("set-cookie", "")
        self.assertIn(f"{SESSION_COOKIE}=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=strict", cookie)
        self.assertNotIn(PORTAL_BEARER, cookie)

    def test_cookie_auth_translates_to_legacy_http_and_websocket_contracts(self):
        client, _ = self.build()
        self.assertEqual(self.start(client).status_code, 200)

        response = client.get("/api/protected")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

        with client.websocket_connect("/ws/protected") as websocket:
            self.assertEqual(websocket.receive_json(), {"ok": True})

    def test_raw_long_lived_bearer_is_not_needed_after_exchange(self):
        client, _ = self.build()
        self.start(client)
        response = client.get("/api/session")
        self.assertTrue(response.json()["authenticated"])
        self.assertNotIn(PORTAL_BEARER, response.text)

    def test_logout_revokes_cookie_session(self):
        client, manager = self.build()
        self.start(client)
        self.assertEqual(manager.active_count, 1)
        response = client.delete("/api/session")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["revoked"])
        self.assertEqual(manager.active_count, 0)
        self.assertEqual(client.get("/api/protected").status_code, 401)

    def test_expired_session_fails_closed_for_http_and_websocket(self):
        client, manager = self.build(ttl=300)
        self.start(client)
        self.clock.advance(301)
        self.assertEqual(manager.active_count, 0)
        self.assertEqual(client.get("/api/protected").status_code, 401)
        with self.assertRaises(Exception):
            with client.websocket_connect("/ws/protected") as websocket:
                websocket.receive_json()

    def test_cross_site_fetch_does_not_receive_internal_auth_translation(self):
        client, _ = self.build()
        self.start(client)
        response = client.get("/api/protected", headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(response.status_code, 401)

    def test_bad_bootstrap_credential_never_creates_session(self):
        client, manager = self.build()
        response = client.post("/api/session/start", headers={"Authorization": "Bearer wrong"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(manager.active_count, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
