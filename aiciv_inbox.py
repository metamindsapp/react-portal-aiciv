#!/usr/bin/env python3
"""Server-shared state for the AICIV Result / Decision inbox.

Presence owns authoritative durable job state. This module stores only the
human-facing collaboration state that should survive browser/device changes:
seen/archived markers and decision responses selected by the human.

It deliberately does not duplicate job results, receipts, or task status.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


AuthChecker = Callable[[Request], bool]
_JOB_ID_RE = re.compile(r"^job_[a-f0-9]{24}$")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class AicivInboxStore:
    """Tiny atomic JSON store for cross-device inbox annotations."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _empty(self) -> dict:
        return {"version": 1, "jobs": {}}

    def _read_unlocked(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("jobs"), dict):
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

    def snapshot(self) -> dict:
        with self._lock:
            return self._read_unlocked()

    def _job_state(self, state: dict, job_id: str) -> dict:
        jobs = state.setdefault("jobs", {})
        job = jobs.setdefault(job_id, {})
        job.setdefault("decisionResponses", {})
        return job

    def mark_seen(self, job_id: str) -> dict:
        with self._lock:
            state = self._read_unlocked()
            job = self._job_state(state, job_id)
            job["seenAt"] = _utc_now()
            self._write_unlocked(state)
            return job.copy()

    def set_archived(self, job_id: str, archived: bool) -> dict:
        with self._lock:
            state = self._read_unlocked()
            job = self._job_state(state, job_id)
            if archived:
                job["archivedAt"] = _utc_now()
                if "seenAt" not in job:
                    job["seenAt"] = _utc_now()
            else:
                job.pop("archivedAt", None)
            self._write_unlocked(state)
            return job.copy()

    def record_decision_response(
        self,
        job_id: str,
        decision_id: str,
        option_id: str,
        label: str | None = None,
        message: str | None = None,
    ) -> dict:
        with self._lock:
            state = self._read_unlocked()
            job = self._job_state(state, job_id)
            responses = job.setdefault("decisionResponses", {})
            response = {
                "optionId": option_id,
                "respondedAt": _utc_now(),
            }
            if label:
                response["label"] = label
            if message:
                response["message"] = message
            responses[decision_id] = response
            if "seenAt" not in job:
                job["seenAt"] = _utc_now()
            self._write_unlocked(state)
            return response.copy()


def default_inbox_store() -> AicivInboxStore:
    configured = os.environ.get("AICIV_INBOX_STATE_FILE", "").strip()
    path = Path(configured) if configured else Path(__file__).parent / ".aiciv-inbox-state.json"
    return AicivInboxStore(path)


def build_aiciv_inbox_routes(
    *,
    check_auth: AuthChecker,
    store: AicivInboxStore | None = None,
) -> list[Route]:
    inbox = store or default_inbox_store()

    def require_auth(request: Request) -> JSONResponse | None:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return None

    def valid_job_id(request: Request) -> tuple[str | None, JSONResponse | None]:
        job_id = request.path_params.get("job_id", "")
        if not _JOB_ID_RE.fullmatch(job_id):
            return None, JSONResponse({"error": "invalid_job_id"}, status_code=400)
        return job_id, None

    async def inbox_state(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        return JSONResponse(inbox.snapshot())

    async def mark_seen(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        job_id, id_error = valid_job_id(request)
        if id_error:
            return id_error
        return JSONResponse({"jobId": job_id, "state": inbox.mark_seen(job_id)})

    async def archive(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        job_id, id_error = valid_job_id(request)
        if id_error:
            return id_error
        return JSONResponse({"jobId": job_id, "state": inbox.set_archived(job_id, True)})

    async def restore(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        job_id, id_error = valid_job_id(request)
        if id_error:
            return id_error
        return JSONResponse({"jobId": job_id, "state": inbox.set_archived(job_id, False)})

    async def decision_response(request: Request) -> JSONResponse:
        auth_error = require_auth(request)
        if auth_error:
            return auth_error
        job_id, id_error = valid_job_id(request)
        if id_error:
            return id_error

        decision_id = request.path_params.get("decision_id", "").strip()
        if not decision_id or len(decision_id) > 200:
            return JSONResponse({"error": "invalid_decision_id"}, status_code=400)

        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_body"}, status_code=400)

        option_id = body.get("optionId")
        label = body.get("label")
        message = body.get("message")
        if not isinstance(option_id, str) or not option_id.strip() or len(option_id) > 200:
            return JSONResponse({"error": "invalid_option_id"}, status_code=400)
        if label is not None and (not isinstance(label, str) or len(label) > 500):
            return JSONResponse({"error": "invalid_label"}, status_code=400)
        if message is not None and (not isinstance(message, str) or len(message) > 4000):
            return JSONResponse({"error": "invalid_message"}, status_code=400)

        response = inbox.record_decision_response(
            job_id,
            decision_id,
            option_id.strip(),
            label.strip() if isinstance(label, str) and label.strip() else None,
            message.strip() if isinstance(message, str) and message.strip() else None,
        )
        return JSONResponse({
            "jobId": job_id,
            "decisionId": decision_id,
            "response": response,
            # This endpoint stores collaboration state only. The frontend writes
            # this annotation after /api/chat/send reports delivery, but callers
            # of this endpoint directly must not infer AICIV delivery/execution.
            "semanticReceipt": "inbox_annotation_recorded_not_delivery_or_execution",
        })

    return [
        Route("/api/aiciv/inbox/state", endpoint=inbox_state, methods=["GET"]),
        Route("/api/aiciv/inbox/{job_id}/seen", endpoint=mark_seen, methods=["POST"]),
        Route("/api/aiciv/inbox/{job_id}/archive", endpoint=archive, methods=["POST"]),
        Route("/api/aiciv/inbox/{job_id}/restore", endpoint=restore, methods=["POST"]),
        Route(
            "/api/aiciv/inbox/{job_id}/decisions/{decision_id}/respond",
            endpoint=decision_response,
            methods=["POST"],
        ),
    ]


def register_aiciv_inbox_routes(
    app: Starlette,
    *,
    check_auth: AuthChecker,
    store: AicivInboxStore | None = None,
) -> None:
    existing_paths = {
        getattr(route, "path", None)
        for route in app.routes
        if getattr(route, "path", None)
    }
    for route in build_aiciv_inbox_routes(check_auth=check_auth, store=store):
        if route.path not in existing_paths:
            app.router.routes.append(route)
            existing_paths.add(route.path)
