#!/usr/bin/env python3
"""Replayable typed event/activity hub for the per-CIV Portal.

Events answer "what changed?". Existing domain APIs remain authoritative for
"what is true?". The hub persists a bounded replay window and fans new events
out to one browser WebSocket connection per Portal client.
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect


AuthChecker = Callable[[Request], bool]
HttpClientFactory = Callable[[], httpx.AsyncClient]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_int(value: str | None, default: int, low: int, high: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    return max(low, min(parsed, high))


def _safe_float(value: str | None, default: float, low: float, high: float) -> float:
    try:
        parsed = float(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    return max(low, min(parsed, high))


class AicivEventHub:
    """Bounded persistent replay store + live asyncio subscribers."""

    def __init__(self, path: Path, *, max_events: int = 2000):
        self.path = path
        self.max_events = max(100, min(int(max_events), 20_000))
        self._lock = threading.Lock()
        self._subscribers: set[asyncio.Queue] = set()

    def _empty(self) -> dict:
        return {"version": 1, "nextSeq": 1, "events": []}

    def _read_unlocked(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("events"), list)
                or not isinstance(data.get("nextSeq"), int)
            ):
                return self._empty()
            return data
        except (OSError, json.JSONDecodeError):
            return self._empty()

    def _write_unlocked(self, state: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(state, separators=(",", ":")) + "\n", encoding="utf-8")
        try:
            tmp.chmod(0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    @property
    def latest_seq(self) -> int:
        with self._lock:
            state = self._read_unlocked()
            return max(0, int(state["nextSeq"]) - 1)

    def replay(self, *, after: int = 0, limit: int = 200) -> list[dict]:
        after = max(0, int(after))
        limit = max(1, min(int(limit), 1000))
        with self._lock:
            events = self._read_unlocked()["events"]
            return [event.copy() for event in events if int(event.get("seq", 0)) > after][:limit]

    def publish(
        self,
        event_type: str,
        *,
        source: str,
        subject_kind: str | None = None,
        subject_id: str | None = None,
        project_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict:
        clean_type = event_type.strip()[:160]
        clean_source = source.strip()[:80]
        if not clean_type or not clean_source:
            raise ValueError("event type and source are required")

        with self._lock:
            state = self._read_unlocked()
            seq = int(state["nextSeq"])
            event: dict[str, Any] = {
                "eventId": f"evt_{secrets.token_hex(12)}",
                "seq": seq,
                "type": clean_type,
                "source": clean_source,
                "occurredAt": _utc_now(),
            }
            if subject_kind and subject_id:
                event["subject"] = {
                    "kind": subject_kind.strip()[:80],
                    "id": subject_id.strip()[:500],
                }
            if project_id:
                event["projectId"] = project_id.strip()[:200]
            if payload:
                event["payload"] = payload

            events = state["events"]
            events.append(event)
            if len(events) > self.max_events:
                del events[: len(events) - self.max_events]
            state["nextSeq"] = seq + 1
            self._write_unlocked(state)

        # Publish outside the file lock. All current publishers run on the Portal
        # event loop, so put_nowait is safe; queue overflow is recoverable through
        # persisted replay on reconnect.
        for queue in list(self._subscribers):
            try:
                if queue.full():
                    queue.get_nowait()
                queue.put_nowait(event.copy())
            except (asyncio.QueueEmpty, asyncio.QueueFull, RuntimeError):
                pass
        return event.copy()

    def subscribe(self, *, max_queue: int = 256) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=max_queue)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)


def default_event_hub() -> AicivEventHub:
    configured = os.environ.get("AICIV_EVENTS_STATE_FILE", "").strip()
    path = Path(configured) if configured else Path(__file__).parent / ".aiciv-events.json"
    max_events = _safe_int(os.environ.get("AICIV_EVENTS_MAX_REPLAY"), 2000, 100, 20_000)
    return AicivEventHub(path, max_events=max_events)


def build_aiciv_event_routes(
    *,
    check_auth: AuthChecker,
    bearer_token: str,
    hub: AicivEventHub,
) -> list:
    async def replay_events(request: Request) -> JSONResponse:
        if not check_auth(request):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        after = _safe_int(request.query_params.get("after"), 0, 0, 2_147_483_647)
        limit = _safe_int(request.query_params.get("limit"), 200, 1, 1000)
        events = hub.replay(after=after, limit=limit)
        return JSONResponse({
            "events": events,
            "count": len(events),
            "latestSeq": hub.latest_seq,
        })

    async def event_socket(websocket: WebSocket) -> None:
        token = websocket.query_params.get("token", "")
        if not token or not secrets.compare_digest(token, bearer_token):
            await websocket.close(code=4401)
            return

        after = _safe_int(websocket.query_params.get("after"), 0, 0, 2_147_483_647)
        await websocket.accept()
        queue = hub.subscribe()
        try:
            # Subscribe before replay. An event that lands in the narrow race can
            # therefore be delivered twice, but never missed; clients dedupe by seq.
            for event in hub.replay(after=after, limit=1000):
                await websocket.send_json({"type": "event", "event": event})

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25.0)
                    await websocket.send_json({"type": "event", "event": event})
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "heartbeat", "latestSeq": hub.latest_seq})
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            hub.unsubscribe(queue)
            try:
                await websocket.close()
            except Exception:
                pass

    return [
        Route("/api/aiciv/events", endpoint=replay_events, methods=["GET"]),
        WebSocketRoute("/ws/aiciv/events", endpoint=event_socket),
    ]


def register_aiciv_event_routes(
    app: Starlette,
    *,
    check_auth: AuthChecker,
    bearer_token: str,
    hub: AicivEventHub,
) -> None:
    existing = {(getattr(route, "path", None), tuple(sorted(getattr(route, "methods", []) or []))) for route in app.routes}
    for route in build_aiciv_event_routes(check_auth=check_auth, bearer_token=bearer_token, hub=hub):
        key = (route.path, tuple(sorted(getattr(route, "methods", []) or [])))
        if key not in existing:
            app.router.routes.append(route)
            existing.add(key)


class PresenceJobWatcher:
    """One server-side poller that converts Presence job changes into Portal events.

    This centralizes polling at the Portal process instead of having Now, Inbox,
    Projects, mobile, etc. independently poll the Presence Gateway.
    """

    def __init__(
        self,
        *,
        hub: AicivEventHub,
        gateway_url: str,
        gateway_api_key: str,
        interval_seconds: float = 3.0,
        http_client_factory: HttpClientFactory | None = None,
    ):
        self.hub = hub
        self.gateway_url = gateway_url.rstrip("/")
        self.gateway_api_key = gateway_api_key
        self.interval_seconds = max(2.0, min(float(interval_seconds), 60.0))
        self.http_client_factory = http_client_factory or (
            lambda: httpx.AsyncClient(timeout=httpx.Timeout(8.0))
        )
        self._fingerprints: dict[str, tuple] = {}
        self._baseline_ready = False
        self._online: bool | None = None
        self._task: asyncio.Task | None = None

    @property
    def configured(self) -> bool:
        return bool(self.gateway_url and self.gateway_api_key)

    @staticmethod
    def _fingerprint(job: dict) -> tuple:
        return (
            job.get("status"),
            job.get("updatedAt"),
            len(job.get("events") or []),
            len(job.get("receipts") or []),
            bool(job.get("result") is not None),
            job.get("error"),
        )

    async def poll_once(self) -> None:
        if not self.configured:
            return
        try:
            async with self.http_client_factory() as client:
                response = await client.get(
                    f"{self.gateway_url}/v1/delegations?limit=200",
                    headers={
                        "Authorization": f"Bearer {self.gateway_api_key}",
                        "Accept": "application/json",
                    },
                )
            if response.status_code < 200 or response.status_code >= 300:
                raise RuntimeError(f"presence gateway HTTP {response.status_code}")
            payload = response.json()
            jobs = payload.get("jobs", []) if isinstance(payload, dict) else []
            if not isinstance(jobs, list):
                raise RuntimeError("invalid Presence job list")

            if self._online is False:
                self.hub.publish("presence.gateway.restored", source="presence-watcher")
            self._online = True

            next_fingerprints: dict[str, tuple] = {}
            by_id: dict[str, dict] = {}
            for raw in jobs:
                if not isinstance(raw, dict):
                    continue
                job_id = raw.get("jobId")
                if not isinstance(job_id, str) or not job_id:
                    continue
                next_fingerprints[job_id] = self._fingerprint(raw)
                by_id[job_id] = raw

            if self._baseline_ready:
                for job_id, fingerprint in next_fingerprints.items():
                    previous = self._fingerprints.get(job_id)
                    if previous == fingerprint:
                        continue
                    job = by_id[job_id]
                    event_type = "job.created" if previous is None else "job.updated"
                    self.hub.publish(
                        event_type,
                        source="presence-watcher",
                        subject_kind="job",
                        subject_id=job_id,
                        payload={
                            "status": job.get("status"),
                            "previousStatus": previous[0] if previous else None,
                            "updatedAt": job.get("updatedAt"),
                        },
                    )
            else:
                self._baseline_ready = True

            self._fingerprints = next_fingerprints
        except Exception:
            if self._online is not False:
                self.hub.publish("presence.gateway.unavailable", source="presence-watcher")
            self._online = False

    async def _run(self) -> None:
        while True:
            await self.poll_once()
            await asyncio.sleep(self.interval_seconds)

    async def start(self) -> None:
        if not self.configured or self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="presence-job-watcher")

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def register_presence_job_watcher(app: Starlette, *, hub: AicivEventHub, gateway_url: str, gateway_api_key: str) -> PresenceJobWatcher:
    interval = _safe_float(os.environ.get("AICIV_EVENT_PRESENCE_POLL_SECONDS"), 3.0, 2.0, 60.0)
    watcher = PresenceJobWatcher(
        hub=hub,
        gateway_url=gateway_url,
        gateway_api_key=gateway_api_key,
        interval_seconds=interval,
    )
    if watcher.configured:
        app.add_event_handler("startup", watcher.start)
        app.add_event_handler("shutdown", watcher.stop)
    return watcher
