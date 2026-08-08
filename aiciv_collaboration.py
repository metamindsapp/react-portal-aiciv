#!/usr/bin/env python3
"""Server-shared collaboration state for Portal messages.

This extension owns collaboration annotations (shared references and reaction
summaries) while authoritative conversation text remains owned by Portal/Claude
history. Changes emit canonical activity events for other AICIV client bodies.
"""

from __future__ import annotations

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

from aiciv_activity import record_activity

AuthChecker = Callable[[Request], bool]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_message_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 300:
        return None
    if any(ch in value for ch in ("/", "\\", "\x00")):
        return None
    return value


class CollaborationStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _empty(self) -> dict:
        return {"version": 1, "bookmarks": {}, "reactions": {}}

    def _read_unlocked(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return self._empty()
            if not isinstance(data.get("bookmarks"), dict):
                data["bookmarks"] = {}
            if not isinstance(data.get("reactions"), dict):
                data["reactions"] = {}
            data["version"] = 1
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

    def put_bookmark(self, message_id: str, payload: dict) -> dict:
        with self._lock:
            state = self._read_unlocked()
            bookmark = {
                "msgId": message_id,
                "text": str(payload.get("text") or "")[:2000],
                "role": payload.get("role") if payload.get("role") in ("user", "assistant") else "assistant",
                "timestamp": float(payload.get("timestamp") or 0),
                "savedAt": payload.get("savedAt") or _utc_now(),
            }
            if isinstance(payload.get("tags"), list):
                bookmark["tags"] = [str(tag).strip()[:80] for tag in payload["tags"][:20] if str(tag).strip()]
            note = payload.get("note")
            if isinstance(note, str) and note.strip():
                bookmark["note"] = note.strip()[:2000]
            state["bookmarks"][message_id] = bookmark
            self._write_unlocked(state)
            return bookmark.copy()

    def remove_bookmark(self, message_id: str) -> bool:
        with self._lock:
            state = self._read_unlocked()
            existed = message_id in state["bookmarks"]
            state["bookmarks"].pop(message_id, None)
            if existed:
                self._write_unlocked(state)
            return existed

    def set_reaction_summary(self, message_id: str, reactions: list[dict]) -> list[dict]:
        normalized: list[dict] = []
        for item in reactions[:40]:
            if not isinstance(item, dict):
                continue
            emoji = item.get("emoji")
            count = item.get("count")
            mine = item.get("mine")
            if not isinstance(emoji, str) or not emoji or len(emoji) > 16:
                continue
            try:
                count_int = max(0, min(int(count), 100000))
            except (TypeError, ValueError):
                count_int = 0
            normalized.append({"emoji": emoji, "count": count_int, "mine": bool(mine)})

        with self._lock:
            state = self._read_unlocked()
            if normalized:
                state["reactions"][message_id] = normalized
            else:
                state["reactions"].pop(message_id, None)
            self._write_unlocked(state)
        return normalized


def default_collaboration_store() -> CollaborationStore:
    configured = os.environ.get("AICIV_COLLABORATION_STATE_FILE", "").strip()
    path = Path(configured) if configured else Path(__file__).parent / ".aiciv-collaboration-state.json"
    return CollaborationStore(path)


def build_collaboration_routes(*, check_auth: AuthChecker, store: CollaborationStore | None = None) -> list[Route]:
    collaboration = store or default_collaboration_store()

    def require_auth(request: Request) -> JSONResponse | None:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return None

    async def state(request: Request) -> JSONResponse:
        if (error := require_auth(request)):
            return error
        snapshot = collaboration.snapshot()
        bookmarks = sorted(snapshot["bookmarks"].values(), key=lambda item: str(item.get("savedAt", "")), reverse=True)
        return JSONResponse({"version": 1, "bookmarks": bookmarks, "reactions": snapshot["reactions"]})

    async def add_bookmark(request: Request) -> JSONResponse:
        if (error := require_auth(request)):
            return error
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        message_id = _safe_message_id(body.get("msgId"))
        if not message_id:
            return JSONResponse({"error": "invalid_message_id"}, status_code=400)
        text = body.get("text")
        role = body.get("role")
        if not isinstance(text, str) or not text.strip():
            return JSONResponse({"error": "invalid_text"}, status_code=400)
        if role not in ("user", "assistant"):
            return JSONResponse({"error": "invalid_role"}, status_code=400)
        bookmark = collaboration.put_bookmark(message_id, body)
        record_activity(
            kind="reference.saved",
            object_kind="message",
            object_id=message_id,
            summary=f"Saved a shared reference from {role} conversation",
            actor="human",
            metadata={"role": role},
        )
        return JSONResponse({"bookmark": bookmark, "semanticReceipt": "shared_reference_saved"}, status_code=201)

    async def remove_bookmark(request: Request) -> JSONResponse:
        if (error := require_auth(request)):
            return error
        message_id = _safe_message_id(request.path_params.get("message_id"))
        if not message_id:
            return JSONResponse({"error": "invalid_message_id"}, status_code=400)
        removed = collaboration.remove_bookmark(message_id)
        if removed:
            record_activity(
                kind="reference.removed",
                object_kind="message",
                object_id=message_id,
                summary="Removed a shared conversation reference",
                actor="human",
            )
        return JSONResponse({"msgId": message_id, "removed": removed})

    async def update_reactions(request: Request) -> JSONResponse:
        if (error := require_auth(request)):
            return error
        message_id = _safe_message_id(request.path_params.get("message_id"))
        if not message_id:
            return JSONResponse({"error": "invalid_message_id"}, status_code=400)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_body"}, status_code=400)
        reactions = body.get("reactions") if isinstance(body, dict) else None
        if not isinstance(reactions, list):
            return JSONResponse({"error": "invalid_reactions"}, status_code=400)
        normalized = collaboration.set_reaction_summary(message_id, reactions)
        record_activity(
            kind="reaction.changed",
            object_kind="message",
            object_id=message_id,
            summary="Updated shared conversation reaction state",
            actor="human",
            metadata={"reactionCount": len(normalized)},
        )
        return JSONResponse({"msgId": message_id, "reactions": normalized})

    return [
        Route("/api/aiciv/collaboration", endpoint=state, methods=["GET"]),
        Route("/api/aiciv/bookmarks", endpoint=add_bookmark, methods=["POST"]),
        Route("/api/aiciv/bookmarks/{message_id}", endpoint=remove_bookmark, methods=["DELETE"]),
        Route("/api/aiciv/reactions/{message_id}", endpoint=update_reactions, methods=["PUT"]),
    ]


def register_collaboration_routes(app: Starlette, *, check_auth: AuthChecker, store: CollaborationStore | None = None) -> None:
    existing_paths = {getattr(route, "path", None) for route in app.routes if getattr(route, "path", None)}
    for route in build_collaboration_routes(check_auth=check_auth, store=store):
        if route.path not in existing_paths:
            app.router.routes.append(route)
            existing_paths.add(route.path)
