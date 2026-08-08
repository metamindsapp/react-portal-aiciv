#!/usr/bin/env python3
"""Focused tests for server-shared Result / Decision inbox annotations."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from aiciv_inbox import AicivInboxStore, register_aiciv_inbox_routes


JOB_ID = "job_0123456789abcdef01234567"


class AicivInboxTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "inbox.json"
        self.store = AicivInboxStore(self.path)
        app = Starlette()

        def check_auth(request) -> bool:
            return request.headers.get("authorization") == "Bearer portal-token"

        register_aiciv_inbox_routes(app, check_auth=check_auth, store=self.store)
        register_aiciv_inbox_routes(app, check_auth=check_auth, store=self.store)
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer portal-token"}

    def tearDown(self):
        self.tempdir.cleanup()

    def test_state_requires_portal_auth(self):
        self.assertEqual(self.client.get("/api/aiciv/inbox/state").status_code, 401)
        response = self.client.get("/api/aiciv/inbox/state", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"version": 1, "jobs": {}})

    def test_seen_and_archive_are_shared_server_state(self):
        seen = self.client.post(f"/api/aiciv/inbox/{JOB_ID}/seen", headers=self.headers)
        self.assertEqual(seen.status_code, 200)
        self.assertIn("seenAt", seen.json()["state"])

        archived = self.client.post(f"/api/aiciv/inbox/{JOB_ID}/archive", headers=self.headers)
        self.assertEqual(archived.status_code, 200)
        self.assertIn("archivedAt", archived.json()["state"])

        state = self.client.get("/api/aiciv/inbox/state", headers=self.headers).json()
        self.assertIn("archivedAt", state["jobs"][JOB_ID])
        self.assertTrue(self.path.exists())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

        restored = self.client.post(f"/api/aiciv/inbox/{JOB_ID}/restore", headers=self.headers)
        self.assertEqual(restored.status_code, 200)
        self.assertNotIn("archivedAt", restored.json()["state"])

    def test_decision_response_records_delivery_semantics_not_execution(self):
        response = self.client.post(
            f"/api/aiciv/inbox/{JOB_ID}/decisions/dec_provider/respond",
            headers=self.headers,
            json={
                "optionId": "option_b",
                "label": "Use provider B",
                "message": "Proceed with B for the next test cohort",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["response"]["optionId"], "option_b")
        self.assertEqual(
            payload["semanticReceipt"],
            "response_recorded_after_portal_delivery_not_execution",
        )
        self.assertNotIn("executed", payload)

        state = self.store.snapshot()
        recorded = state["jobs"][JOB_ID]["decisionResponses"]["dec_provider"]
        self.assertEqual(recorded["label"], "Use provider B")

    def test_invalid_job_id_fails_closed_without_file_write(self):
        response = self.client.post("/api/aiciv/inbox/not-a-job/seen", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
