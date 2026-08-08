#!/usr/bin/env python3
"""Unified append-only activity feed for shared human/AICIV workspace events.

This feed records collaboration events owned by Portal extension modules. It
references authoritative objects; it does not copy full Docs, Sheets, Presence
jobs or conversations into another database.

Examples:
- project.created / project.linked
- reference.saved / reference.removed
- reaction.changed
- evidence.saved
- inbox.seen / inbox.archived / decision.responded

Presence durable jobs remain authoritative in the Presence Gateway and are
exposed separately through `/api/presence/jobs`; project/object references can
link to them without duplicating their lifecycle truth.
"""

from __future__ import annotations

import json
import os
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
_MAX_EVENTS = 5000
_COMPACT_BYTES = 5 * 1024 * 1024


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _bounded(value: object, max_length: int) -> str:
    return str(value or "").strip()[:max_length]


class ActivityStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _read_unlocked(self) -> list[dict]:
        if not self.path.exists():
            return []
        events: list[dict] = []
        try:
            for raw in self.path.read_text(encoding="utf-8", errors="replace").splitlines():
                if not raw.strip():
                    continue
                try:
                    item = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(item, dict) and isinstance(item.get("eventId"), str):
                    events.append(item)
        except OSError:
            return []
        return events[-_MAX_EVENTS:]

    def _write_events_unlocked(self, events: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text("".join(json.dumps(event, sort_keys=True) + "\n" for event in events[-_MAX_EVENTS:]), encoding="utf-8")
        try:
            tmp.chmod(0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def append(
        self,
        *,
        kind: str,
        object_kind: str,
        object_id: str,
        summary: str,
        actor: str = "system",
        metadata: dict | None = None,
        event_id: str | None = None,
    ) -> dict:
        clean_kind = _bounded(kind, 120)
        clean_object_kind = _bounded(object_kind, 80)
        clean_object_id = _bounded(object_id, 300)
        if not clean_kind or not clean_object_kind or not clean_object_id:
            raise ValueError("activity kind/object kind/object id are required")

        event = {
            "eventId": event_id or f"evt_{secrets.token_hex(12)}",
            "kind": clean_kind,
            "object": {
                "kind": clean_object_kind,
                "id": clean_object_id,
                "ref": f"{clean_object_kind}:{clean_object_id}",
            },
            "summary": _bounded(summary, 1200),
            "actor": _bounded(actor, 80) or "system",
            "createdAt": _utc_now(),
        }
        if metadata:
            # Metadata is intentionally shallow/bounded. Full authoritative
            # object content belongs to its source service.
            safe: dict[str, object] = {}
            for key, value in list(metadata.items())[:30]:
                clean_key = _bounded(key, 100)
                if not clean_key:
                    continue
                if isinstance(value, (str, int, float, bool)) or value is None:
                    safe[clean_key] = value if not isinstance(value, str) else value[:1000]
            if safe:
                event["metadata"] = safe

        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            # Idempotent deterministic event IDs are useful when a caller is
            # projecting state into the feed after an uncertain retry.
            if event_id:
                for existing in self._read_unlocked():
                    if existing.get("eventId") == event_id:
                        return existing
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(event, sort_keys=True) + "\n")
            try:
                self.path.chmod(0o600)
            except OSError:
                pass
            try:
                if self.path.stat().st_size > _COMPACT_BYTES:
                    self._write_events_unlocked(self._read_unlocked())
            except OSError:
                pass
        return event.copy()

    def list(self, *, after: str | None = None, limit: int = 100) -> tuple[list[dict], bool]:
        limit = max(1, min(int(limit), 500))
        with self._lock:
            events = self._read_unlocked()

        if after:
            for index, event in enumerate(events):
                if event.get("eventId") == after:
                    return events[index + 1:index + 1 + limit], False
            # Cursor fell outside retention or is unknown. Return latest state
            # with reset=true instead of silently pretending continuity.
            return events[-limit:], True
        return events[-limit:], False


def default_activity_store() -> ActivityStore:
    configured = os.environ.get("AICIV_ACTIVITY_FILE", "").strip()
    path = Path(configured) if configured else Path(__file__).parent / ".aiciv-activity.jsonl"
    return ActivityStore(path)


_DEFAULT_STORE: ActivityStore | None = None
_DEFAULT_LOCK = threading.Lock()


def activity_store() -> ActivityStore:
    global _DEFAULT_STORE
    if _DEFAULT_STORE is None:
        with _DEFAULT_LOCK:
            if _DEFAULT_STORE is None:
                _DEFAULT_STORE = default_activity_store()
    return _DEFAULT_STORE


def record_activity(**kwargs) -> dict:
    return activity_store().append(**kwargs)


def build_activity_routes(*, check_auth: AuthChecker, store: ActivityStore | None = None) -> list[Route]:
    feed = store or activity_store()

    async def activity(request: Request) -> JSONResponse:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        try:
            limit = int(request.query_params.get("limit", "100"))
        except ValueError:
            return JSONResponse({"error": "invalid_limit"}, status_code=400)
        after = request.query_params.get("after", "").strip() or None
        events, reset = feed.list(after=after, limit=limit)
        return JSONResponse({
            "events": events,
            "count": len(events),
            "nextCursor": events[-1]["eventId"] if events else after,
            "reset": reset,
        })

    return [Route("/api/aiciv/activity", endpoint=activity, methods=["GET"])]


def register_activity_routes(app: Starlette, *, check_auth: AuthChecker, store: ActivityStore | None = None) -> None:
    if any(getattr(route, "path", None) == "/api/aiciv/activity" for route in app.routes):
        return
    for route in build_activity_routes(check_auth=check_auth, store=store):
        app.router.routes.append(route)
