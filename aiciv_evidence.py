#!/usr/bin/env python3
"""Shared evidence objects captured from human/AICIV co-control surfaces.

Evidence metadata is small and durable. Binary screenshots remain owned by the
existing Portal upload subsystem; this store records the reference, source page,
optional project/job relationship hints, and a human note.

A saved evidence object is NOT automatically a Presence job completion receipt.
The durable AICIV may later cite it in a callback receipt after verifying that it
supports the work being reported.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

AuthChecker = Callable[[Request], bool]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class EvidenceStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _empty(self) -> dict:
        return {"version": 1, "evidence": []}

    def _read_unlocked(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("evidence"), list):
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

    def list(self, limit: int = 100) -> list[dict]:
        with self._lock:
            items = list(self._read_unlocked()["evidence"])
        return list(reversed(items[-max(1, min(limit, 500)):]))

    def create(self, payload: dict) -> dict:
        created_at = _utc_now()
        seed = "|".join([
            str(payload.get("artifactUrl") or ""),
            str(payload.get("pageUrl") or ""),
            created_at,
        ])
        evidence_id = "evidence_" + hashlib.sha256(seed.encode()).hexdigest()[:20]
        item = {
            "id": evidence_id,
            "kind": "browser_screenshot",
            "artifactUrl": str(payload.get("artifactUrl") or "")[:4000],
            "pageUrl": str(payload.get("pageUrl") or "")[:4000],
            "title": str(payload.get("title") or "")[:500],
            "note": str(payload.get("note") or "")[:2000],
            "createdAt": created_at,
            "semanticReceipt": "evidence_saved_not_job_completion",
        }
        for key in ("jobId", "projectId"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                item[key] = value.strip()[:300]

        with self._lock:
            state = self._read_unlocked()
            state["evidence"].append(item)
            state["evidence"] = state["evidence"][-2000:]
            self._write_unlocked(state)
        return item.copy()


def default_evidence_store() -> EvidenceStore:
    configured = os.environ.get("AICIV_EVIDENCE_STATE_FILE", "").strip()
    path = Path(configured) if configured else Path(__file__).parent / ".aiciv-evidence.json"
    return EvidenceStore(path)


def build_evidence_routes(*, check_auth: AuthChecker, store: EvidenceStore | None = None) -> list[Route]:
    evidence = store or default_evidence_store()

    def require_auth(request: Request) -> JSONResponse | None:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return None

    async def list_evidence(request: Request) -> JSONResponse:
        if (error := require_auth(request)):
            return error
        try:
            limit = int(request.query_params.get("limit", "100"))
        except ValueError:
            return JSONResponse({"error": "invalid_limit"}, status_code=400)
        items = evidence.list(limit)
        return JSONResponse({"evidence": items, "count": len(items)})

    async def create_evidence(request: Request) -> JSONResponse:
        if (error := require_auth(request)):
            return error
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        artifact_url = body.get("artifactUrl")
        page_url = body.get("pageUrl")
        if not isinstance(artifact_url, str) or not artifact_url.startswith("/api/chat/uploads/"):
            return JSONResponse({"error": "invalid_artifact_url"}, status_code=400)
        if not isinstance(page_url, str) or not page_url.strip():
            return JSONResponse({"error": "invalid_page_url"}, status_code=400)
        item = evidence.create(body)
        return JSONResponse({"evidence": item}, status_code=201)

    return [
        Route("/api/aiciv/evidence", endpoint=list_evidence, methods=["GET"]),
        Route("/api/aiciv/evidence", endpoint=create_evidence, methods=["POST"]),
    ]


def register_evidence_routes(app: Starlette, *, check_auth: AuthChecker, store: EvidenceStore | None = None) -> None:
    existing = {getattr(route, "path", None) for route in app.routes}
    for route in build_evidence_routes(check_auth=check_auth, store=store):
        # Same path appears twice with different methods; keep both unless the
        # exact endpoint+method set is already registered by this extension.
        duplicate = any(
            getattr(existing_route, "path", None) == route.path
            and getattr(existing_route, "methods", None) == route.methods
            for existing_route in app.routes
        )
        if not duplicate:
            app.router.routes.append(route)
