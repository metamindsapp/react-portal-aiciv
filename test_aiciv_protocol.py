#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.testclient import TestClient

from aiciv_collaboration import CollaborationStore
from aiciv_evidence import EvidenceStore
from aiciv_inbox import AicivInboxStore
from aiciv_projects import AicivProjectStore
from aiciv_protocol import RelationshipStore, build_protocol_routes, canonical_ref


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.projects = AicivProjectStore(root / "projects.json")
        self.inbox = AicivInboxStore(root / "inbox.json")
        self.collaboration = CollaborationStore(root / "collaboration.json")
        self.evidence = EvidenceStore(root / "evidence.json")
        self.relationships = RelationshipStore(root / "relationships.json")

        app = Starlette(routes=build_protocol_routes(
            check_auth=lambda request: request.headers.get("authorization") == "Bearer portal-token",
            civ_name="synth",
            human_name="Corey",
            relationships=self.relationships,
            project_store=self.projects,
            inbox_store=self.inbox,
            collaboration_store=self.collaboration,
            evidence_store=self.evidence,
        ))
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer portal-token"}

    def tearDown(self):
        self.tmp.cleanup()

    def seed_objects(self):
        project = self.projects.create(
            title="Presence rollout",
            goal="Ship one persistent intelligence across bodies",
            tags=["presence", "reachy"],
        )
        self.projects.add_link(
            project["projectId"],
            kind="job",
            object_id="job_0123456789abcdef01234567",
            relation="execution",
        )
        self.collaboration.put_bookmark(
            "message-1",
            {"text": "Remember this decision", "role": "user", "timestamp": 1},
        )
        evidence = self.evidence.create({
            "artifactUrl": "/api/chat/uploads/reachy.png",
            "pageUrl": "https://example.com/reachy",
            "title": "Reachy evidence",
        })
        self.inbox.mark_seen("job_0123456789abcdef01234567")
        return project, evidence

    def test_auth_required(self):
        self.assertEqual(self.client.get("/api/aiciv/client-manifest").status_code, 401)
        self.assertEqual(self.client.get("/api/aiciv/objects").status_code, 401)

    def test_manifest_is_small_client_contract_not_react_page_map(self):
        response = self.client.get("/api/aiciv/client-manifest", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["protocol"], "aiciv-portal")
        self.assertEqual(body["identity"], {"civId": "synth", "humanName": "Corey"})
        self.assertEqual(body["realtime"]["auth"], "short-lived same-origin HttpOnly Portal session")
        self.assertTrue(body["principles"]["manyBodiesOneAiciv"])
        self.assertEqual(body["endpoints"]["presenceJobs"], "/api/presence/jobs")

    def test_object_catalog_projects_authoritative_references_without_copying_content(self):
        project, evidence = self.seed_objects()
        response = self.client.get("/api/aiciv/objects?limit=100", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        objects = {item["ref"]: item for item in response.json()["objects"]}

        self.assertIn(f"project:{project['projectId']}", objects)
        self.assertIn("job:job_0123456789abcdef01234567", objects)
        self.assertIn("message:message-1", objects)
        self.assertIn(f"evidence:{evidence['id']}", objects)
        self.assertEqual(objects[f"project:{project['projectId']}"]["route"], "/projects")
        self.assertNotIn("goal", objects["job:job_0123456789abcdef01234567"])

    def test_generic_relationships_are_idempotent_and_visible_on_both_objects(self):
        project, evidence = self.seed_objects()
        source = f"project:{project['projectId']}"
        target = f"evidence:{evidence['id']}"
        payload = {"sourceRef": source, "relation": "supported_by", "targetRef": target}

        first = self.client.post("/api/aiciv/relationships", headers=self.headers, json=payload)
        second = self.client.post("/api/aiciv/relationships", headers=self.headers, json=payload)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.json()["created"])
        relationship_id = first.json()["relationship"]["id"]
        self.assertEqual(self.relationships.path.stat().st_mode & 0o777, 0o600)

        objects = {item["ref"]: item for item in self.client.get("/api/aiciv/objects", headers=self.headers).json()["objects"]}
        self.assertTrue(any(rel["targetRef"] == target for rel in objects[source]["relationships"]))
        self.assertTrue(any(rel["targetRef"] == source for rel in objects[target]["relationships"]))

        removed = self.client.delete(f"/api/aiciv/relationships/{relationship_id}", headers=self.headers)
        self.assertTrue(removed.json()["removed"])

    def test_canonical_ref_rejects_ambiguous_or_whitespace_refs(self):
        self.assertEqual(canonical_ref("project", "project_123"), "project:project_123")
        with self.assertRaises(ValueError):
            canonical_ref("Bad Kind", "x")
        with self.assertRaises(ValueError):
            canonical_ref("project", "has whitespace")

    def test_kind_filter_and_bad_limits_are_explicit(self):
        self.seed_objects()
        jobs = self.client.get("/api/aiciv/objects?kind=job", headers=self.headers).json()["objects"]
        self.assertTrue(jobs)
        self.assertTrue(all(item["kind"] == "job" for item in jobs))
        bad = self.client.get("/api/aiciv/objects?limit=nope", headers=self.headers)
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["error"], "invalid_limit")


if __name__ == "__main__":
    unittest.main(verbosity=2)
