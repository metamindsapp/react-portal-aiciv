# AICIV-Native Portal — Build Status

This file is the implementation companion to [`AICIV_NATIVE_PORTAL_REVIEW.md`](AICIV_NATIVE_PORTAL_REVIEW.md).

The review is the product/design thesis. This file answers a narrower question:

> Which recommendations are already real code on `main`, and what is still next?

Update this file when an AICIV-native tranche is merged.

---

## Delivered foundation

Before the interface tranches, Portal already had substantial subsystem capability:

- primary Chat backed by the live AICIV/Claude session;
- Terminal and tmux Teams;
- Org hierarchy;
- AgentCal;
- AgentMail;
- Docs;
- Sheets;
- HUB;
- shared Browser control;
- Context and Status;
- reactions/Signals;
- Bookmarks;
- TGIM;
- low-latency Voice Presence through the separate Presence Gateway;
- durable Presence delegation jobs and receipt callbacks.

The AICIV-native work is primarily about synthesizing these primitives into one coherent shared operating environment.

---

# Delivered tranche 1 — Now + global Presence

Merged as Portal PR #5.

Delivered:

- `/now` AICIV Now cockpit;
- synthesized primary health;
- active durable work;
- returned receipt-backed results;
- context pressure;
- unread mail;
- active panes;
- normalized activity feed;
- Portal proxy for authoritative durable-job reads/cancel requests;
- global Talk Live Presence in the app shell;
- explicit Dictate vs Talk Live UX;
- desktop navigation grouped by human intent;
- mobile Now-first collaboration navigation.

Important invariant retained:

```text
cancel_requested != cancelled
```

---

# Delivered tranche 2 — Result / Decision Inbox

Merged as Portal PR #6.

Delivered:

- `/inbox`;
- Needs You;
- Results;
- Archive;
- server-shared seen/archive state;
- structured durable human decision protocol;
- recommendation/context/risk/options rendering;
- decision response delivery back to the primary AICIV;
- response annotations only after Portal accepts delivery;
- durable AICIV resume instructions in `presence-job` skill.

Important invariant retained:

```text
human selected option != downstream action executed
```

The downstream consequence still requires an authoritative job callback/receipt.

---

# Delivered tranche 3 — global command/search

Merged as Portal PR #7.

Delivered:

- global `Ctrl/Cmd-K` palette;
- human-intent Portal navigation search;
- durable Job/result search;
- Docs search;
- recent Conversation search;
- exact Doc deep-navigation;
- exact conversation-message focus/highlight;
- state-aware Job navigation to Now/Inbox;
- freeform `Ask AICIV: “…”` from every Portal route;
- partial-source degradation instead of whole-search failure.

Important invariant retained:

```text
Ask AICIV delivery accepted != requested work completed
```

---

# Delivered tranche 4 — Projects / shared object graph

Implemented on PR #8 and intended for merge after the normal CI gate.

Delivered in the tranche:

- `/projects`;
- durable project/workstream records;
- goal/summary/status/tags;
- project relationship graph;
- authoritative Job references;
- authoritative Doc references;
- prepared relationship kinds for Sheets, threads, agents, calendar events, mail, browser sessions and artifacts;
- object link/unlink;
- idempotent reference edges;
- `Work with AICIV` project-context delivery;
- project-aware global `Cmd-K` search;
- exact project deep-navigation;
- atomic server-shared project state.

Core invariant:

```text
project links object != project owns/copies object truth
```

A linked Presence Job remains authoritative in Presence. A linked Doc remains authoritative in Docs. The Project supplies the relationship/context spine.

---

# Highest-value remaining roadmap

## 1. Unified typed event/activity transport

Current Now/Inbox/other surfaces still rely on a mix of polling and independent stores.

Desired direction:

```text
job.running
job.completed
decision.required
mail.received
agent.changed
artifact.created
browser.handoff
context.warning
project.changed
```

One event model should eventually feed:

- Now;
- Inbox;
- project timelines;
- notifications;
- mobile;
- proactive Presence return;
- future Reachy behaviors where appropriate.

## 2. Expand the object graph

Projects should progressively gain rich resolution/UI for existing prepared link kinds:

- Sheets;
- HUB threads;
- agents;
- Calendar events;
- Mail;
- Browser evidence/sessions;
- artifacts/receipts.

Do not migrate ownership of those objects into Projects.

## 3. Project-aware Presence

Today `Work with AICIV` sends a structured project-context envelope into Conversation.

Future Presence should be able to receive a trusted active-project/context ID directly so:

> “Compare this to Tuesday’s run”

can inherit the correct workstream context across voice/mobile/Reachy without hand-written prompt stuffing.

## 4. Semantic Teams / agent state

Keep raw tmux panes, but add meaning above them:

- role;
- goal;
- current durable job/project;
- working/waiting/blocked/done;
- last meaningful event;
- output/artifact;
- human attention needed.

## 5. Browser co-control + evidence

Develop Browser toward:

- explicit takeover/handback;
- semantic action logs;
- human annotations;
- evidence snapshots linked to Jobs/Projects;
- sensitive-action approval boundaries;
- resumable sessions.

## 6. Shared object/correlation IDs

Carry durable correlation from:

```text
human intent
  → conversation / Presence turn
  → Project
  → Job
  → agent/tool/browser action
  → artifact/result
  → receipt
```

This will materially improve trust, debugging, enterprise support and proactive synthesis.

## 7. Server-sync remaining local collaboration state

Bookmarks are still browser-local. Reaction display also has client-local aspects.

Move durable collaboration objects server-side where cross-device/AICIV sharing materially helps.

## 8. Frontend/server-state architecture cleanup

As realtime state grows:

- reduce independent polling;
- consider a consistent server-state cache/query layer;
- expose real WebSocket connection lifecycle rather than optimistic state;
- lazy-load large routes;
- standardize recoverable error surfaces.

## 9. Progressive backend decomposition

Keep the working `portal_server.py`, but new domains should continue to land as focused extension modules.

Extract old domains when doing meaningful work in them rather than starting a risky rewrite.

## 10. Auth / multi-tenant identity

Before broad untrusted public exposure, replace today's trusted per-CIV browser bearer model with a real application session/tenant/device identity model.

## 11. Mobile + Reachy

New clients should consume the same:

- AICIV identity;
- active project/workstream;
- Presence;
- durable Job lifecycle;
- Inbox/decisions;
- results/receipts;
- object graph.

They should be new bodies of the same intelligence, not new brains.

---

# Product north star

The implementation should increasingly let the human ask:

```text
What are we doing?
What is my AICIV doing now?
What came back?
What needs me?
What changed while I was away?
What evidence proves the result?
What objects belong to this effort?
Where can I intervene?
What should we do next?
```

without first knowing whether the answer lives in Chat, Presence, Teams, Docs, Sheets, Mail, Browser, Calendar, or another subsystem.
