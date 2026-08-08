#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from aiciv_activity import ActivityStore, build_activity_routes


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "activity.jsonl"
        self.store = ActivityStore(self.path)
        app = Starlette(routes=build_activity_routes(
            check_auth=lambda request: request.headers.get("authorization") == "Bearer portal-token",
            store=self.store,
        ))
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer portal-token"}

    def tearDown(self):
        self.tmp.cleanup()

    def test_auth_required(self):
        self.assertEqual(self.client.get("/api/aiciv/activity").status_code, 401)

    def test_append_cursor_and_file_permissions(self):
        first = self.store.append(
            kind="project.created",
            object_kind="project",
            object_id="project_1",
            summary="Created project",
            actor="human",
        )
        second = self.store.append(
            kind="evidence.saved",
            object_kind="evidence",
            object_id="evidence_1",
            summary="Saved screenshot",
            actor="human",
        )

        listing = self.client.get("/api/aiciv/activity?limit=10", headers=self.headers).json()
        self.assertEqual(listing["count"], 2)
        self.assertEqual(listing["nextCursor"], second["eventId"])
        self.assertFalse(listing["reset"])
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

        after = self.client.get(
            f"/api/aiciv/activity?after={first['eventId']}&limit=10",
            headers=self.headers,
        ).json()
        self.assertEqual([event["eventId"] for event in after["events"]], [second["eventId"]])
        self.assertFalse(after["reset"])

    def test_unknown_cursor_returns_latest_with_reset_signal(self):
        self.store.append(
            kind="reaction.changed",
            object_kind="message",
            object_id="m1",
            summary="Updated reaction",
        )
        response = self.client.get(
            "/api/aiciv/activity?after=evt_missing&limit=10",
            headers=self.headers,
        ).json()
        self.assertTrue(response["reset"])
        self.assertEqual(response["count"], 1)

    def test_explicit_event_id_is_idempotent(self):
        first = self.store.append(
            kind="reference.saved",
            object_kind="message",
            object_id="m1",
            summary="Saved",
            event_id="evt_stable_0001",
        )
        second = self.store.append(
            kind="reference.saved",
            object_kind="message",
            object_id="m1",
            summary="Saved again but should dedupe",
            event_id="evt_stable_0001",
        )
        self.assertEqual(first["eventId"], second["eventId"])
        self.assertEqual(len(self.store.list(limit=100)[0]), 1)

    def test_metadata_is_shallow_and_bounded(self):
        item = self.store.append(
            kind="object.related",
            object_kind="project",
            object_id="p1",
            summary="Related",
            metadata={"safe": "x" * 2000, "nested": {"secret": "not copied"}},
        )
        self.assertEqual(len(item["metadata"]["safe"]), 1000)
        self.assertNotIn("nested", item["metadata"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
