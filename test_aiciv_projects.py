#!/usr/bin/env python3
"""Focused tests for the shared AICIV project/workstream spine."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from aiciv_projects import AicivProjectStore, register_aiciv_project_routes


class AicivProjectTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "projects.json"
        self.store = AicivProjectStore(self.path)
        app = Starlette()

        def check_auth(request) -> bool:
            return request.headers.get("authorization") == "Bearer portal-token"

        register_aiciv_project_routes(app, check_auth=check_auth, store=self.store)
        register_aiciv_project_routes(app, check_auth=check_auth, store=self.store)
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer portal-token"}

    def tearDown(self):
        self.tempdir.cleanup()

    def create_project(self):
        response = self.client.post(
            "/api/aiciv/projects",
            headers=self.headers,
            json={
                "title": "Voice Presence Product",
                "goal": "Ship a product-level low-latency AICIV voice system",
                "summary": "Presence + durable cognition + Portal + Reachy",
                "tags": ["voice", "product", "voice"],
            },
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["project"]

    def test_routes_require_portal_auth(self):
        self.assertEqual(self.client.get("/api/aiciv/projects").status_code, 401)
        self.assertEqual(self.client.post("/api/aiciv/projects", json={}).status_code, 401)

    def test_create_update_and_persist_project(self):
        project = self.create_project()
        self.assertRegex(project["projectId"], r"^prj_[a-f0-9]{24}$")
        self.assertEqual(project["status"], "active")
        self.assertEqual(project["tags"], ["voice", "product"])
        self.assertEqual(project["links"], [])
        self.assertTrue(self.path.exists())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

        response = self.client.patch(
            f"/api/aiciv/projects/{project['projectId']}",
            headers=self.headers,
            json={"status": "paused", "summary": "Paused for a client eval."},
        )
        self.assertEqual(response.status_code, 200)
        updated = response.json()["project"]
        self.assertEqual(updated["status"], "paused")
        self.assertEqual(updated["summary"], "Paused for a client eval.")

        reloaded = AicivProjectStore(self.path).get(project["projectId"])
        self.assertEqual(reloaded["status"], "paused")

    def test_links_reference_authoritative_objects_without_copying_payloads(self):
        project = self.create_project()
        project_id = project["projectId"]
        job_id = "job_0123456789abcdef01234567"

        first = self.client.post(
            f"/api/aiciv/projects/{project_id}/links",
            headers=self.headers,
            json={"kind": "job", "objectId": job_id, "relation": "primary-work"},
        )
        self.assertEqual(first.status_code, 201)
        self.assertTrue(first.json()["created"])

        duplicate = self.client.post(
            f"/api/aiciv/projects/{project_id}/links",
            headers=self.headers,
            json={"kind": "job", "objectId": job_id, "relation": "primary-work"},
        )
        self.assertEqual(duplicate.status_code, 200)
        self.assertFalse(duplicate.json()["created"])

        linked = duplicate.json()["project"]["links"]
        self.assertEqual(len(linked), 1)
        self.assertEqual(linked[0]["objectId"], job_id)
        # The graph stores a reference edge only. It does not copy authoritative
        # job/result/receipt content into the project store.
        self.assertEqual(set(linked[0].keys()), {"kind", "objectId", "relation", "addedAt"})

        removed = self.client.post(
            f"/api/aiciv/projects/{project_id}/links/remove",
            headers=self.headers,
            json={"kind": "job", "objectId": job_id},
        )
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json()["removed"], 1)
        self.assertEqual(removed.json()["project"]["links"], [])

    def test_invalid_project_and_link_inputs_fail_closed(self):
        bad = self.client.post(
            "/api/aiciv/projects",
            headers=self.headers,
            json={"title": "", "goal": "x"},
        )
        self.assertEqual(bad.status_code, 400)

        project = self.create_project()
        bad_link = self.client.post(
            f"/api/aiciv/projects/{project['projectId']}/links",
            headers=self.headers,
            json={"kind": "database-dump", "objectId": "secret"},
        )
        self.assertEqual(bad_link.status_code, 400)

        invalid_id = self.client.get("/api/aiciv/projects/not-a-project", headers=self.headers)
        self.assertEqual(invalid_id.status_code, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
