#!/usr/bin/env python3
"""AICIV-native client protocol and canonical object graph.

This module gives non-React bodies (mobile, Reachy, future desktop/watch clients)
a stable way to discover Portal capabilities, enumerate shared object references,
and create relationships without learning which subsystem owns each object.

The graph stores references/relationships only. Authoritative content remains in
its source system (Presence jobs, Docs, Sheets, Mail, HUB, conversation, etc.).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from pathlib import Path
from typing import Callable

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from aiciv_activity import record_activity, register_activity_routes
from aiciv_collaboration import default_collaboration_store
from aiciv_evidence import default_evidence_store
from aiciv_inbox import AicivInboxStore, default_inbox_store
from aiciv_projects import AicivProjectStore, default_project_store

AuthChecker = Callable[[Request], bool]
_OBJECT_REF_RE = re.compile(r"^[a-z][a-z0-9_-]{0,39}:[^\s]{1,500}$")


def canonical_ref(kind: str, object_id: str) -> str:
    kind = str(kind).strip().lower()
    object_id = str(object_id).strip()
    ref = f"{kind}:{object_id}"
    if not _OBJECT_REF_RE.fullmatch(ref):
        raise ValueError("invalid canonical object reference")
    return ref


class RelationshipStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _empty(self):
        return {"version": 1, "relationships": []}

    def _read_unlocked(self):
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("relationships"), list):
                return self._empty()
            return data
        except (OSError, json.JSONDecodeError):
            return self._empty()

    def _write_unlocked(self, state):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            tmp.chmod(0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def list(self):
        with self._lock:
            return list(self._read_unlocked()["relationships"])

    def add(self, source_ref: str, relation: str, target_ref: str) -> tuple[dict, bool]:
        source_ref = canonical_ref(*source_ref.split(":", 1))
        target_ref = canonical_ref(*target_ref.split(":", 1))
        relation = str(relation).strip().lower().replace(" ", "_")[:100]
        if not relation or not re.fullmatch(r"[a-z][a-z0-9_.-]{0,99}", relation):
            raise ValueError("invalid relation")
        relationship_id = "rel_" + hashlib.sha256(f"{source_ref}|{relation}|{target_ref}".encode()).hexdigest()[:20]
        item = {"id": relationship_id, "sourceRef": source_ref, "relation": relation, "targetRef": target_ref}
        with self._lock:
            state = self._read_unlocked()
            for existing in state["relationships"]:
                if existing.get("id") == relationship_id:
                    return existing, False
            state["relationships"].append(item)
            state["relationships"] = state["relationships"][-5000:]
            self._write_unlocked(state)
        return item, True

    def remove(self, relationship_id: str) -> bool:
        with self._lock:
            state = self._read_unlocked()
            before = len(state["relationships"])
            state["relationships"] = [item for item in state["relationships"] if item.get("id") != relationship_id]
            removed = len(state["relationships"]) != before
            if removed:
                self._write_unlocked(state)
            return removed


def default_relationship_store() -> RelationshipStore:
    configured = os.environ.get("AICIV_RELATIONSHIPS_FILE", "").strip()
    path = Path(configured) if configured else Path(__file__).parent / ".aiciv-relationships.json"
    return RelationshipStore(path)


class ActivityProjectStore(AicivProjectStore):
    def create(self, **kwargs):
        project = super().create(**kwargs)
        record_activity(kind="project.created", object_kind="project", object_id=project["id"], summary=f"Created project {project['title']}", actor="human")
        return project

    def update(self, project_id: str, changes: dict):
        project = super().update(project_id, changes)
        if project:
            record_activity(kind="project.updated", object_kind="project", object_id=project_id, summary=f"Updated project {project['title']}", actor="human", metadata={"status": project.get("status")})
        return project

    def add_link(self, project_id: str, *, kind: str, object_id: str, relation: str):
        project, created = super().add_link(project_id, kind=kind, object_id=object_id, relation=relation)
        if project and created:
            record_activity(kind="project.linked", object_kind=kind, object_id=object_id, summary=f"Linked {kind} to project {project['title']}", actor="human", metadata={"projectId": project_id, "relation": relation})
        return project, created

    def remove_link(self, project_id: str, *, kind: str, object_id: str):
        project, removed = super().remove_link(project_id, kind=kind, object_id=object_id)
        if project and removed:
            record_activity(kind="project.unlinked", object_kind=kind, object_id=object_id, summary=f"Removed {kind} link from project {project['title']}", actor="human", metadata={"projectId": project_id})
        return project, removed


class ActivityInboxStore(AicivInboxStore):
    def mark_seen(self, job_id: str):
        state = super().mark_seen(job_id)
        record_activity(kind="inbox.seen", object_kind="job", object_id=job_id, summary="Marked AICIV result/decision as seen", actor="human")
        return state

    def set_archived(self, job_id: str, archived: bool):
        state = super().set_archived(job_id, archived)
        record_activity(kind="inbox.archived" if archived else "inbox.restored", object_kind="job", object_id=job_id, summary="Archived AICIV inbox item" if archived else "Restored AICIV inbox item", actor="human")
        return state

    def record_decision_response(self, job_id: str, decision_id: str, option_id: str, label=None, message=None):
        response = super().record_decision_response(job_id, decision_id, option_id, label, message)
        record_activity(kind="decision.responded", object_kind="decision", object_id=f"{job_id}:{decision_id}", summary=f"Responded to AICIV decision: {label or option_id}", actor="human", metadata={"jobId": job_id, "optionId": option_id})
        return response


def activity_project_store() -> ActivityProjectStore:
    return ActivityProjectStore(default_project_store().path)


def activity_inbox_store() -> ActivityInboxStore:
    return ActivityInboxStore(default_inbox_store().path)


def _object_catalog(relationships: RelationshipStore) -> list[dict]:
    objects: dict[str, dict] = {}

    def add(kind: str, object_id: str, label: str, **metadata):
        try:
            ref = canonical_ref(kind, object_id)
        except ValueError:
            return
        current = objects.setdefault(ref, {"ref": ref, "kind": kind, "id": object_id, "label": label[:500]})
        for key, value in metadata.items():
            if value is not None:
                current[key] = value

    project_snapshot = default_project_store().snapshot()
    for project in project_snapshot.get("projects", []):
        if not isinstance(project, dict):
            continue
        add("project", project.get("id", ""), project.get("title", "Project"), status=project.get("status"), route="/projects")
        for link in project.get("links", []):
            if not isinstance(link, dict):
                continue
            kind = str(link.get("kind") or "")
            object_id = str(link.get("objectId") or "")
            add(kind, object_id, f"{kind}: {object_id}", route={"job": "/inbox", "doc": "/docs", "sheet": "/sheets", "mail": "/mail", "hub": "/hub", "calendar": "/calendar", "message": "/"}.get(kind))
            ref = f"{kind}:{object_id}"
            if ref in objects:
                objects[ref].setdefault("projectRelationships", []).append({"projectId": project.get("id"), "relation": link.get("relation", "related")})

    collaboration = default_collaboration_store().snapshot()
    for bookmark in collaboration.get("bookmarks", {}).values():
        if isinstance(bookmark, dict):
            add("message", bookmark.get("msgId", ""), str(bookmark.get("text") or "Shared reference")[:160], role=bookmark.get("role"), route="/")

    for evidence in default_evidence_store().list(500):
        if isinstance(evidence, dict):
            add("evidence", evidence.get("id", ""), evidence.get("title") or evidence.get("pageUrl") or "Evidence", route="/browser", semanticReceipt=evidence.get("semanticReceipt"))

    inbox = default_inbox_store().snapshot()
    for job_id, annotation in inbox.get("jobs", {}).items():
        add("job", job_id, f"AICIV job {job_id}", route="/inbox", archived=bool(annotation.get("archivedAt")) if isinstance(annotation, dict) else False)

    for relation in relationships.list():
        for ref in (relation.get("sourceRef"), relation.get("targetRef")):
            if isinstance(ref, str) and ref not in objects and ":" in ref:
                kind, object_id = ref.split(":", 1)
                add(kind, object_id, ref)
        source = objects.get(relation.get("sourceRef"))
        target = objects.get(relation.get("targetRef"))
        if source is not None:
            source.setdefault("relationships", []).append({"id": relation.get("id"), "relation": relation.get("relation"), "targetRef": relation.get("targetRef")})
        if target is not None:
            target.setdefault("relationships", []).append({"id": relation.get("id"), "relation": f"inverse:{relation.get('relation')}", "targetRef": relation.get("sourceRef")})

    return sorted(objects.values(), key=lambda item: (item.get("kind", ""), item.get("label", "")))


def build_protocol_routes(*, check_auth: AuthChecker, civ_name: str, human_name: str, relationships: RelationshipStore | None = None) -> list[Route]:
    graph = relationships or default_relationship_store()

    def auth(request: Request):
        return None if check_auth(request) else JSONResponse({"error": "unauthorized"}, status_code=401)

    async def manifest(request: Request):
        if (error := auth(request)):
            return error
        return JSONResponse({
            "protocol": "aiciv-portal",
            "protocolVersion": "2026-08-08.v1",
            "identity": {"civId": civ_name, "humanName": human_name},
            "recommendedMobileNavigation": ["/now", "/", "/inbox", "/mail"],
            "endpoints": {
                "activity": "/api/aiciv/activity",
                "objects": "/api/aiciv/objects",
                "relationships": "/api/aiciv/relationships",
                "projects": "/api/aiciv/projects",
                "inboxState": "/api/aiciv/inbox/state",
                "evidence": "/api/aiciv/evidence",
                "conversation": "/api/chat/history",
                "presenceJobs": "/api/presence/jobs",
                "voiceToken": "/api/presence/voice/token",
            },
            "realtime": {
                "chat": "/ws/chat",
                "terminal": "/ws/terminal",
                "browser": "/ws/browser",
                "auth": "short-lived same-origin HttpOnly Portal session",
            },
            "principles": {
                "presenceIsGlobal": True,
                "durableJobTruthLivesInPresence": True,
                "objectsAreReferencesNotCopies": True,
                "manyBodiesOneAiciv": True,
            },
        })

    async def objects(request: Request):
        if (error := auth(request)):
            return error
        kind = request.query_params.get("kind", "").strip().lower()
        catalog = _object_catalog(graph)
        if kind:
            catalog = [item for item in catalog if item.get("kind") == kind]
        try:
            limit = max(1, min(int(request.query_params.get("limit", "500")), 1000))
        except ValueError:
            return JSONResponse({"error": "invalid_limit"}, status_code=400)
        return JSONResponse({"objects": catalog[:limit], "count": min(len(catalog), limit), "relationshipCount": len(graph.list())})

    async def add_relationship(request: Request):
        if (error := auth(request)):
            return error
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("body")
            item, created = graph.add(str(body.get("sourceRef") or ""), str(body.get("relation") or ""), str(body.get("targetRef") or ""))
        except (ValueError, TypeError) as exc:
            return JSONResponse({"error": "invalid_relationship", "detail": str(exc)}, status_code=400)
        if created:
            source_kind, source_id = item["sourceRef"].split(":", 1)
            record_activity(kind="object.related", object_kind=source_kind, object_id=source_id, summary=f"Related {item['sourceRef']} {item['relation']} {item['targetRef']}", actor="human", metadata={"relationshipId": item["id"], "targetRef": item["targetRef"]})
        return JSONResponse({"relationship": item, "created": created}, status_code=201 if created else 200)

    async def remove_relationship(request: Request):
        if (error := auth(request)):
            return error
        relationship_id = str(request.path_params.get("relationship_id") or "")
        if not re.fullmatch(r"rel_[a-f0-9]{20}", relationship_id):
            return JSONResponse({"error": "invalid_relationship_id"}, status_code=400)
        removed = graph.remove(relationship_id)
        return JSONResponse({"relationshipId": relationship_id, "removed": removed})

    return [
        Route("/api/aiciv/client-manifest", endpoint=manifest, methods=["GET"]),
        Route("/api/aiciv/objects", endpoint=objects, methods=["GET"]),
        Route("/api/aiciv/relationships", endpoint=add_relationship, methods=["POST"]),
        Route("/api/aiciv/relationships/{relationship_id}", endpoint=remove_relationship, methods=["DELETE"]),
    ]


def register_protocol_routes(app: Starlette, *, check_auth: AuthChecker, civ_name: str, human_name: str, relationships: RelationshipStore | None = None) -> None:
    register_activity_routes(app, check_auth=check_auth)
    for route in build_protocol_routes(check_auth=check_auth, civ_name=civ_name, human_name=human_name, relationships=relationships):
        duplicate = any(getattr(existing, "path", None) == route.path and getattr(existing, "methods", None) == route.methods for existing in app.routes)
        if not duplicate:
            app.router.routes.append(route)
