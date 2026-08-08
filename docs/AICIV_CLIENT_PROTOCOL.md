# AICIV Portal Client Protocol

The Portal is the local control-plane adapter for one persistent AICIV. The React app is one client of that control plane, not the protocol itself.

This document defines the first small contract for additional bodies such as mobile apps, Reachy and future desktop/watch clients.

## Design rules

1. **One persistent intelligence, many bodies.** A client surface should not create a separate brain or durable job universe.
2. **Objects are references, not copies.** Portal projects/relationships point at authoritative Docs, Sheets, Presence jobs, mail, HUB threads, calendar events, messages and evidence.
3. **Presence jobs remain authoritative in Presence.** Portal may link/render them but does not recreate their lifecycle truth.
4. **Human actions create activity events.** Shared project/reference/evidence/decision changes enter one append-only activity stream.
5. **Raw machinery remains inspectable.** Client protocols expose meaning-first state while terminal/browser/diagnostic surfaces remain available to power users.
6. **Browser auth uses short-lived same-origin HttpOnly sessions.** The long-lived `.portal-token` is a bootstrap credential, not normal browser state.

## Client manifest

Authenticated clients may call:

```text
GET /api/aiciv/client-manifest
```

The response describes:
- the CIV/human identity resolved by this Portal;
- recommended compact mobile navigation;
- stable API endpoints for activity, objects, projects, inbox state, evidence, conversation, Presence jobs and voice token minting;
- same-origin realtime WebSocket routes;
- system invariants.

The manifest deliberately avoids embedding React component names or implementation details.

## Canonical objects

```text
GET /api/aiciv/objects
GET /api/aiciv/objects?kind=project
```

Each object has at minimum:

```json
{
  "ref": "project:project_abcd",
  "kind": "project",
  "id": "project_abcd",
  "label": "Presence rollout"
}
```

Known/projectable kinds include:
- `project`
- `job`
- `message`
- `evidence`
- `doc`
- `sheet`
- `mail`
- `hub`
- `calendar`
- `decision`

The catalog is a projection. It intentionally does **not** copy full job results, document bodies, spreadsheets or conversation history into another database.

## Relationships

Generic cross-object relationships use canonical refs:

```http
POST /api/aiciv/relationships
```

```json
{
  "sourceRef": "project:project_abcd",
  "relation": "supported_by",
  "targetRef": "evidence:evidence_123"
}
```

Relationship IDs are deterministic, so retries are idempotent.

Project-native links remain authoritative inside the existing Project store. The generic graph complements them for relationships that do not belong solely to a project.

## Unified activity

```text
GET /api/aiciv/activity?limit=100
GET /api/aiciv/activity?after=evt_...
```

Example event:

```json
{
  "eventId": "evt_...",
  "kind": "evidence.saved",
  "object": {
    "kind": "evidence",
    "id": "evidence_...",
    "ref": "evidence:evidence_..."
  },
  "summary": "Saved browser evidence from benchmark dashboard",
  "actor": "human",
  "createdAt": "2026-08-08T17:00:00Z"
}
```

Cursor semantics:
- pass the last `eventId` as `after`;
- `nextCursor` is the newest event returned;
- if a cursor is unknown/outside retention, `reset=true` and the latest retained events are returned.

This is a synchronization/activity feed, **not** the sole source of object truth.

## Voice / Presence

Portal proxies token minting through:

```text
POST /api/presence/voice/token
```

Portal derives trusted identity server-side and sends Presence v2 identity metadata:

```text
participantName = <civ>:<human>:portal
continuityKey   = <civ>:<human>
surface         = portal
```

Another trusted body should use its own participant label while keeping the same relationship key, for example:

```text
participantName = <civ>:<human>:reachy
continuityKey   = <civ>:<human>
surface         = reachy
```

This allows separate realtime sessions/devices to share durable Presence jobs without sharing provider session identity.

## Mobile product shape

A compact mobile client should prioritize:

```text
Now · Talk · Needs You · Results
```

rather than attempting desktop page parity. Useful sources:
- `GET /api/aiciv/activity`
- `GET /api/aiciv/objects`
- `GET /api/presence/jobs`
- `GET /api/aiciv/inbox/state`
- `/ws/chat`
- voice token endpoint.

## Reachy product shape

Reachy should use the same continuity relationship and durable Presence/AICIV job model. Its additional contribution is embodiment state and safe behavioral intent, not a separate cognition stack.

The Presence repo documents the corresponding media/embodiment contract in `docs/CLIENT_PROTOCOL.md`.
