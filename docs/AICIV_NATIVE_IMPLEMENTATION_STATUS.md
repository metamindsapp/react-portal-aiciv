# AICIV-Native Portal — Implementation Ledger

This document records what happened after `AICIV_NATIVE_PORTAL_REVIEW.md`.

The review proposed 25 changes spanning product UX, frontend architecture, backend design, trust/security and multi-body clients. They have now been translated into a set of concrete implementations rather than remaining a roadmap-only document.

`Implemented foundation` means the product/architecture seam exists, is tested and is usable today, while richer UX/fleet-scale versions can still deepen it.

| # | Recommendation | Status | Current implementation |
|---:|---|---|---|
| 1 | Home / Now | **Implemented** | `/now` meaning-first cockpit with runtime, jobs, needs-you/results, calendar and Workspace Activity |
| 2 | Global Presence | **Implemented** | Talk Live control in app shell; Presence no longer conceptually confined to Chat |
| 3 | Durable Result Inbox | **Implemented** | `/inbox` Results + Archive backed by authoritative Presence jobs |
| 4 | Decision / Approval Inbox | **Implemented** | `/inbox` Needs You with explicit structured decision responses |
| 5 | Projects / Workstreams | **Implemented** | `/projects` with goal/status/tags and authoritative object links |
| 6 | Shared AICIV object graph | **Implemented foundation** | Canonical `kind:id` refs, object catalog, project links, generic deterministic relationships |
| 7 | Unified Activity / Event stream | **Implemented foundation** | Append-only `/api/aiciv/activity` with cursor/reset semantics; visible on Now |
| 8 | Intent-centric IA + command palette | **Implemented** | grouped shell/navigation and Cmd/Ctrl-K palette |
| 9 | Global search | **Implemented** | cross-surface command/search foundation; object graph now gives semantic search a stronger substrate |
| 10 | Resolve two microphone concepts | **Implemented** | Dictate vs Talk Live are explicitly different capabilities |
| 11 | Durable job cards in conversation | **Implemented** | ConversationWorkRail / active + returned Presence work in Chat |
| 12 | Browser co-control / evidence | **Implemented foundation** | Human/AICIV ownership handoff, evidence capture, shared context delivery, reconnect cleanup |
| 13 | Semantic Teams | **Implemented foundation** | cautious Working/Waiting/Needs-attention/Ready projection with raw terminal drill-down |
| 14 | Docs/Sheets AI-native collaboration | **Implemented foundation** | selected-object Ask AICIV actions with authoritative IDs and verification language |
| 15 | Server-sync bookmarks/reactions | **Implemented** | server-shared Collaboration store; Shared References; shared reaction summaries; local migration |
| 16 | Trust UX everywhere | **Implemented foundation** | explicit lifecycle semantics, global Error Center, context/evidence/write disclaimers |
| 17 | Shared server-state layer | **Implemented foundation** | `usePortalResource`: dedupe, TTL, stale retention, refresh, subscribers, polling cadence |
| 18 | Real WebSocket state | **Implemented** | authoritative disconnected/connecting/connected/reconnecting/unauthorized state |
| 19 | Route lazy loading | **Implemented** | all top-level product surfaces code-split with React.lazy/Suspense; voice remains lazy |
| 20 | Decompose backend without rewrite | **Active implemented pattern** | all new cross-cutting domains live in focused modules registered by `portal_entrypoint.py` |
| 21 | Normalize backend errors | **Implemented boundary / ongoing legacy extraction** | stable unhandled API JSON + client `ApiError`; new extension modules use stable codes; legacy proxy endpoints can be normalized as extracted |
| 22 | Typed API contracts + correlation IDs | **Implemented foundation** | `X-Request-ID`, typed client errors, client manifest, domain TS interfaces |
| 23 | Auth migration | **Implemented foundation** | one-time bearer exchange → short-lived HttpOnly SameSite session; HTTP + WebSocket compatibility; legacy localStorage migration |
| 24 | Meaning first, machinery second | **Implemented** | Now, Status, Teams, Browser ownership state; raw Terminal/diagnostics retained |
| 25 | Mobile / Reachy as bodies of same AICIV | **Implemented protocol foundation** | Portal client manifest/object/activity APIs + Presence v2 `continuityKey` cross-surface identity + embodiment protocol |

---

# Architectural additions delivered

## Portal extension modules

New capabilities are intentionally outside the mature `portal_server.py` monolith:

```text
presence_bridge.py
aiciv_inbox.py
aiciv_projects.py
aiciv_collaboration.py
aiciv_evidence.py
aiciv_activity.py
aiciv_protocol.py
aiciv_http.py
aiciv_session.py
```

This is now the preferred pattern for new cross-cutting domains.

## Shared object model

The Portal can describe relationships among authoritative objects without owning copies of their content.

Examples:

```text
project:project_123 --execution--> job:job_...
project:project_123 --supported_by--> evidence:evidence_...
message:abc --supports--> decision:job_...:decision_...
```

Presence owns Presence jobs. Docs own Docs. Sheets own Sheets. The graph owns relationships.

## Activity synchronization

The Activity feed provides a small append-only synchronization seam for other clients. It intentionally records **changes/references**, not full object snapshots.

## Browser auth

The long-lived Portal bearer is now a bootstrap/server credential. Normal browsers exchange it for a short-lived HttpOnly session and can use the same cookie for same-origin HTTP and WebSockets.

## Multi-body Presence identity

Realtime participant identity and durable relationship identity are now separate concepts:

```text
participantName = synth:corey:portal
continuityKey   = synth:corey
surface         = portal
```

```text
participantName = synth:corey:reachy
continuityKey   = synth:corey
surface         = reachy
```

The two bodies have separate realtime conversations but one durable relationship/job scope.

---

# What “done” does not mean

The review has been implemented at the architectural/product-foundation level. It would be misleading to call every idea visually or operationally final.

The most valuable **depth work** now is:

1. semantic/vector search over canonical objects rather than only broad text/search adapters;
2. richer Doc/Sheet co-editing: version history, proposed diffs, provenance, citations;
3. richer project synthesis and automatically suggested relationships;
4. server-pushed Activity subscription when polling becomes materially wasteful;
5. fleet/multi-instance durable state when a single per-CIV filesystem stops being sufficient;
6. fine-grained tenant/user/tool capability policy for side-effecting operations;
7. richer session/device management beyond current short-lived session/logout controls;
8. Browser annotations and stronger action/evidence receipts;
9. actual Android/mobile client consuming the new client protocol;
10. Reachy client/controller consuming Presence world-state + behavior-intent contracts.

Those are **next-depth** tasks, not missing architectural seams.

---

# Invariants to preserve in future work

- one persistent intelligence, many bodies;
- Portal adapts the local runtime; clients do not learn tmux internals;
- realtime Presence and durable cognition remain separate lifetimes;
- no success without a receipt;
- cancel requested is not cancelled;
- evidence saved is not work completed;
- canonical relationships do not duplicate authoritative content;
- human/device metadata is not identity authority;
- meaning-first UX must retain a path to raw diagnostics;
- do not grow `portal_server.py` for every new domain just because it is convenient.
