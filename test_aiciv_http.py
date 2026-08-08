#!/usr/bin/env python3
from __future__ import annotations

import unittest

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from aiciv_http import install_http_boundary


class HttpBoundaryTests(unittest.TestCase):
    def build_client(self) -> TestClient:
        async def ok(request):
            return JSONResponse({"request_id": request.headers.get("x-request-id")})

        async def boom(request):
            raise RuntimeError("provider secret body must not cross boundary")

        app = Starlette(routes=[
            Route("/api/ok", ok),
            Route("/api/boom", boom),
        ])
        install_http_boundary(app)
        install_http_boundary(app)
        return TestClient(app)

    def test_request_id_is_validated_echoed_and_visible_to_endpoint(self):
        client = self.build_client()
        response = client.get("/api/ok", headers={"X-Request-ID": "web_valid-1234"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-request-id"], "web_valid-1234")
        self.assertEqual(response.json()["request_id"], "web_valid-1234")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertIn("microphone=(self)", response.headers["permissions-policy"])

        generated = client.get("/api/ok", headers={"X-Request-ID": "bad id"})
        self.assertTrue(generated.headers["x-request-id"].startswith("req_"))
        self.assertNotEqual(generated.headers["x-request-id"], "bad id")

    def test_unhandled_api_exception_becomes_stable_correlated_json(self):
        client = self.build_client()
        response = client.get("/api/boom")
        self.assertEqual(response.status_code, 500)
        payload = response.json()
        self.assertEqual(payload["error"], "internal_error")
        self.assertEqual(payload["requestId"], response.headers["x-request-id"])
        self.assertNotIn("provider secret", response.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
