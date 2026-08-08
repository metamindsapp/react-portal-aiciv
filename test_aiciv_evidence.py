#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from aiciv_evidence import EvidenceStore, register_evidence_routes


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "evidence.json"
        app = Starlette()
        self.store = EvidenceStore(self.path)

        def check_auth(request) -> bool:
            return request.headers.get("authorization") == "Bearer portal-token"

        register_evidence_routes(app, check_auth=check_auth, store=self.store)
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer portal-token"}

    def tearDown(self):
        self.tmp.cleanup()

    def test_auth_required(self):
        self.assertEqual(self.client.get("/api/aiciv/evidence").status_code, 401)
        self.assertEqual(self.client.post("/api/aiciv/evidence", json={}).status_code, 401)

    def test_capture_is_evidence_not_completion_receipt(self):
        response = self.client.post(
            "/api/aiciv/evidence",
            headers=self.headers,
            json={
                "artifactUrl": "/api/chat/uploads/browser.png",
                "pageUrl": "https://example.com/research",
                "title": "Research",
                "note": "Important chart",
                "projectId": "project_123",
            },
        )
        self.assertEqual(response.status_code, 201)
        item = response.json()["evidence"]
        self.assertTrue(item["id"].startswith("evidence_"))
        self.assertEqual(item["semanticReceipt"], "evidence_saved_not_job_completion")
        self.assertEqual(item["projectId"], "project_123")
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

        listing = self.client.get("/api/aiciv/evidence", headers=self.headers).json()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["evidence"][0]["id"], item["id"])

    def test_requires_portal_owned_upload_reference(self):
        response = self.client.post(
            "/api/aiciv/evidence",
            headers=self.headers,
            json={"artifactUrl": "https://evil.example/x", "pageUrl": "https://example.com"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_artifact_url")

    def test_invalid_limit_fails_cleanly(self):
        response = self.client.get("/api/aiciv/evidence?limit=nope", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_limit")


if __name__ == "__main__":
    unittest.main(verbosity=2)
