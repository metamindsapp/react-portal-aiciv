#!/usr/bin/env python3
"""Focused tests for server-shared message bookmarks/reactions."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from aiciv_collaboration import CollaborationStore, register_collaboration_routes


class CollaborationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "collaboration.json"
        self.store = CollaborationStore(self.path)
        app = Starlette()

        def check_auth(request) -> bool:
            return request.headers.get("authorization") == "Bearer portal-token"

        register_collaboration_routes(app, check_auth=check_auth, store=self.store)
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer portal-token"}

    def tearDown(self):
        self.tmp.cleanup()

    def test_auth_is_required(self):
        self.assertEqual(self.client.get("/api/aiciv/collaboration").status_code, 401)
        self.assertEqual(self.client.post("/api/aiciv/bookmarks", json={}).status_code, 401)

    def test_bookmarks_are_shared_persisted_and_bounded(self):
        response = self.client.post(
            "/api/aiciv/bookmarks",
            headers=self.headers,
            json={
                "msgId": "message-123",
                "text": "important " + ("x" * 3000),
                "role": "user",
                "timestamp": 1700000000,
                "tags": ["voice", "decision"],
                "note": "Remember why we chose this.",
            },
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["semanticReceipt"], "shared_reference_saved")
        self.assertLessEqual(len(payload["bookmark"]["text"]), 2000)

        state = self.client.get("/api/aiciv/collaboration", headers=self.headers).json()
        self.assertEqual(len(state["bookmarks"]), 1)
        self.assertEqual(state["bookmarks"][0]["msgId"], "message-123")

        saved = json.loads(self.path.read_text())
        self.assertIn("message-123", saved["bookmarks"])
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_bookmark_delete_is_idempotent(self):
        self.client.post(
            "/api/aiciv/bookmarks",
            headers=self.headers,
            json={"msgId": "m1", "text": "hello", "role": "assistant", "timestamp": 1},
        )
        first = self.client.delete("/api/aiciv/bookmarks/m1", headers=self.headers).json()
        second = self.client.delete("/api/aiciv/bookmarks/m1", headers=self.headers).json()
        self.assertTrue(first["removed"])
        self.assertFalse(second["removed"])

    def test_reaction_summary_is_cross_device_state(self):
        response = self.client.put(
            "/api/aiciv/reactions/message-9",
            headers=self.headers,
            json={
                "reactions": [
                    {"emoji": "🔥", "count": 3, "mine": True},
                    {"emoji": "👍", "count": 2, "mine": False},
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        state = self.client.get("/api/aiciv/collaboration", headers=self.headers).json()
        self.assertEqual(state["reactions"]["message-9"][0]["emoji"], "🔥")
        self.assertTrue(state["reactions"]["message-9"][0]["mine"])

    def test_invalid_message_ids_fail_closed(self):
        response = self.client.post(
            "/api/aiciv/bookmarks",
            headers=self.headers,
            json={"msgId": "../../secret", "text": "x", "role": "user", "timestamp": 1},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_message_id")


if __name__ == "__main__":
    unittest.main(verbosity=2)
