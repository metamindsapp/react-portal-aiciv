#!/usr/bin/env python3
"""Shared project/workstream spine for the per-CIV Portal.

Projects intentionally store *relationships*, not copies of authoritative
objects. A Presence job remains owned by Presence, a Doc by Docs, a Sheet by
Sheets, etc. The project spine supplies the durable graph that says those
objects belong to the same human/AICIV workstream.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


AuthChecker = Callable[[Request], bool]
_PROJECT_ID_RE = re.compile(r"^prj_[a-f0-9]{24}$")
_ALLOWED_STATUSES = {"active", "paused", "completed", "archived"}
_ALLOWED_LINK_KINDS = {
    "job",
    "doc",
    "sheet",
    "thread",
    "agent",
    "calendar",
    "mail",
    "browser",
    "artifact",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _clean_text(value, *, max_length: int, required: bool = False) -> str | None:
    if value is None:
        if required:
            raise ValueError("required")
        return None
    if not isinstance(value, str):
        raise ValueError("must be a string")
    clean = value.strip()
    if required and not clean:
        raise ValueError("required")
    if len(clean) > max_length:
        raise ValueError("too long")
    return clean


def _clean_tags(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("tags must be an array")
    tags: list[str] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, str):
            raise ValueError("tags must be strings")
        tag = raw.strip()
        if not tag:
            continue
        if len(tag) > 80:
            raise ValueError("tag too long")
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
        if len(tags) >= 30:
            break
    return tags


class AicivProjectStore:
    """Atomic JSON project graph store with serialized writes."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _empty(self) -> dict:
        return {"version": 1, "projects": {}}

    def _read_unlocked(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("projects"), dict):
                return self._empty()
            return data
        except (OSError, json.JSONDecodeError):
            return self._empty()

    def _write_unlocked(self, state: dict) -> None:
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

    def list_projects(self) -> list[dict]:
        with self._lock:
            state = self._read_unlocked()
            projects = list(state["projects"].values())
        return sorted(projects, key=lambda item: item.get("updatedAt", ""), reverse=True)

    def get(self, project_id: str) -> dict | None:
        with self._lock:
            project = self._read_unlocked()["projects"].get(project_id)
            return project.copy() if isinstance(project, dict) else None

    def create(self, *, title: str, goal: str, summary: str = "", tags: list[str] | None = None) -> dict:
        now = _utc_now()
        with self._lock:
            state = self._read_unlocked()
            project_id = f"prj_{secrets.token_hex(12)}"
            while project_id in state["projects"]:
                project_id = f"prj_{secrets.token_hex(12)}"
            project = {
                "projectId": project_id,
                "title": title,
                "goal": goal,
                "summary": summary,
                "status": "active",
                "tags": tags or [],
                "links": [],
                "createdAt": now,
                "updatedAt": now,
            }
            state["projects"][project_id] = project
            self._write_unlocked(state)
            return project.copy()

    def update(self, project_id: str, changes: dict) -> dict | None:
        with self._lock:
            state = self._read_unlocked()
            project = state["projects"].get(project_id)
            if not isinstance(project, dict):
                return None
            for key, value in changes.items():
                project[key] = value
            project["updatedAt"] = _utc_now()
            self._write_unlocked(state)
            return project.copy()

    def add_link(self, project_id: str, *, kind: str, object_id: str, relation: str = "related") -> tuple[dict | None, bool]:
        now = _utc_now()
        with self._lock:
            state = self._read_unlocked()
            project = state["projects"].get(project_id)
            if not isinstance(project, dict):
                return None, False
            links = project.setdefault("links", [])
            for link in links:
                if (
                    isinstance(link, dict)
                    and link.get("kind") == kind
                    and link.get("objectId") == object_id
                    and link.get("relation", "related") == relation
                ):
                    return project.copy(), False
            links.append({
                "kind": kind,
                "objectId": object_id,
                "relation": relation,
                "addedAt": now,
            })
            project["updatedAt"] = now
            self._write_unlocked(state)
            return project.copy(), True

    def remove_link(self, project_id: str, *, kind: str, object_id: str) -> tuple[dict | None, int]:
        with self._lock:
            state = self._read_unlocked()
            project = state["projects"].get(project_id)
            if not isinstance(project, dict):
                return None, 0
            links = project.setdefault("links", [])
            kept = [
                link for link in links
                if not (
                    isinstance(link, dict)
                    and link.get("kind") == kind
                    and link.get("objectId") == object_id
                )
            ]
            removed = len(links) - len(kept)
            if removed:
                project["links"] = kept
                project["updatedAt"] = _utc_now()
                self._write_unlocked(state)
            return project.copy(), removed


def default_project_store() -> AicivProjectStore:
    configured = os.environ.get("AICIV_PROJECTS_STATE_FILE", "").strip()
    path = Path(configured) if configured else Path(__file__).parent / ".aiciv-projects.json"
    return AicivProjectStore(path)


def build_aiciv_project_routes(*, check_auth: AuthChecker, store: AicivProjectStore | None = None) -> list[Route]:
    projects = store or default_project_store()

    def require_auth(request: Request) -> JSONResponse | None:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return None

    def get_project_id(request: Request) -> tuple[str | None, JSONResponse | None]:
        project_id = request.path_params.get("project_id", "")
        if not _PROJECT_ID_RE.fullmatch(project_id):
            return None, JSONResponse({"error": "invalid_project_id"}, status_code=400)
        return project_id, None

    async def list_projects(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        items = projects.list_projects()
        status = request.query_params.get("status", "").strip()
        if status:
            if status not in _ALLOWED_STATUSES:
                return JSONResponse({"error": "invalid_project_status"}, status_code=400)
            items = [item for item in items if item.get("status") == status]
        return JSONResponse({"projects": items, "count": len(items)})

    async def create_project(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        try:
            title = _clean_text(body.get("title"), max_length=240, required=True)
            goal = _clean_text(body.get("goal"), max_length=8000, required=True)
            summary = _clean_text(body.get("summary", ""), max_length=12000) or ""
            tags = _clean_tags(body.get("tags"))
        except ValueError as exc:
            return JSONResponse({"error": "invalid_project", "detail": str(exc)}, status_code=400)
        project = projects.create(title=title, goal=goal, summary=summary, tags=tags)
        return JSONResponse({"project": project}, status_code=201)

    async def get_project(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        project_id, id_error = get_project_id(request)
        if id_error:
            return id_error
        project = projects.get(project_id)
        if not project:
            return JSONResponse({"error": "project_not_found"}, status_code=404)
        return JSONResponse({"project": project})

    async def update_project(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        project_id, id_error = get_project_id(request)
        if id_error:
            return id_error
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        changes: dict = {}
        try:
            if "title" in body:
                changes["title"] = _clean_text(body.get("title"), max_length=240, required=True)
            if "goal" in body:
                changes["goal"] = _clean_text(body.get("goal"), max_length=8000, required=True)
            if "summary" in body:
                changes["summary"] = _clean_text(body.get("summary"), max_length=12000) or ""
            if "tags" in body:
                changes["tags"] = _clean_tags(body.get("tags"))
            if "status" in body:
                status = body.get("status")
                if not isinstance(status, str) or status not in _ALLOWED_STATUSES:
                    raise ValueError("invalid status")
                changes["status"] = status
        except ValueError as exc:
            return JSONResponse({"error": "invalid_project", "detail": str(exc)}, status_code=400)
        if not changes:
            return JSONResponse({"error": "no_changes"}, status_code=400)
        project = projects.update(project_id, changes)
        if not project:
            return JSONResponse({"error": "project_not_found"}, status_code=404)
        return JSONResponse({"project": project})

    async def add_link(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        project_id, id_error = get_project_id(request)
        if id_error:
            return id_error
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        kind = body.get("kind")
        object_id = body.get("objectId")
        relation = body.get("relation", "related")
        if not isinstance(kind, str) or kind not in _ALLOWED_LINK_KINDS:
            return JSONResponse({"error": "invalid_link_kind"}, status_code=400)
        try:
            object_id = _clean_text(object_id, max_length=500, required=True)
            relation = _clean_text(relation, max_length=100, required=True)
        except ValueError as exc:
            return JSONResponse({"error": "invalid_link", "detail": str(exc)}, status_code=400)
        project, created = projects.add_link(project_id, kind=kind, object_id=object_id, relation=relation)
        if not project:
            return JSONResponse({"error": "project_not_found"}, status_code=404)
        return JSONResponse({"project": project, "created": created}, status_code=201 if created else 200)

    async def remove_link(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        project_id, id_error = get_project_id(request)
        if id_error:
            return id_error
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        kind = body.get("kind")
        object_id = body.get("objectId")
        if not isinstance(kind, str) or kind not in _ALLOWED_LINK_KINDS:
            return JSONResponse({"error": "invalid_link_kind"}, status_code=400)
        try:
            object_id = _clean_text(object_id, max_length=500, required=True)
        except ValueError as exc:
            return JSONResponse({"error": "invalid_link", "detail": str(exc)}, status_code=400)
        project, removed = projects.remove_link(project_id, kind=kind, object_id=object_id)
        if not project:
            return JSONResponse({"error": "project_not_found"}, status_code=404)
        return JSONResponse({"project": project, "removed": removed})

    return [
        Route("/api/aiciv/projects", endpoint=list_projects, methods=["GET"]),
        Route("/api/aiciv/projects", endpoint=create_project, methods=["POST"]),
        Route("/api/aiciv/projects/{project_id}", endpoint=get_project, methods=["GET"]),
        Route("/api/aiciv/projects/{project_id}", endpoint=update_project, methods=["PATCH"]),
        Route("/api/aiciv/projects/{project_id}/links", endpoint=add_link, methods=["POST"]),
        Route("/api/aiciv/projects/{project_id}/links/remove", endpoint=remove_link, methods=["POST"]),
    ]


def register_aiciv_project_routes(app: Starlette, *, check_auth: AuthChecker, store: AicivProjectStore | None = None) -> None:
    existing = {(getattr(route, "path", None), tuple(sorted(getattr(route, "methods", []) or []))) for route in app.routes}
    for route in build_aiciv_project_routes(check_auth=check_auth, store=store):
        key = (route.path, tuple(sorted(route.methods or [])))
        if key not in existing:
            app.router.routes.append(route)
            existing.add(key)
