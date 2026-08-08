# AICIV React Portal

The AICIV React Portal is the **human-facing operating environment for a persistent AICIV**.

It is not just a chat application, and it is not an admin dashboard bolted onto an AI. The Portal is the per-CIV workspace where a human and an AICIV share conversation, low-latency voice Presence, durable background work, returned results and receipts, human decisions, projects/workstreams, agent teams, browser control, calendar/mail, knowledge, structured data, global search, and raw operational visibility.

The Portal deliberately sits at the boundary between product UX and the local AICIV runtime. Today that runtime is primarily Claude Code + tmux + local files/services. The Portal absorbs those implementation details so other surfaces—voice, mobile, Reachy, watch/earbuds, and future clients—can interact with the same durable intelligence without learning how its container is wired.

> **Core design idea:** one persistent intelligence, many surfaces. Chat, voice, projects, agents, files, tools, background jobs, browser sessions, mobile clients and future embodied clients should converge on the same AICIV rather than creating separate “bots” per interface.

---

# Current collaboration model

The product now separates three lifetimes explicitly:

```text
human ↔ AICIV relationship       long-lived
        │
        ├── projects/workstreams  durable shared context
        │      │
        │      └── linked authoritative objects
        │
        ├── durable jobs          seconds → hours/days
        │      │
        │      ├── waiting / human decision boundary
        │      └── result + evidence/receipts
        │
        └── realtime Presence     milliseconds → minutes
```

The key invariant is:

```text
voice/session lifetime != durable job lifetime != human↔AICIV relationship lifetime
```

A WebRTC session may disappear while durable work continues. A result can survive browser/device changes. A project can continue linking that result, the supporting Doc and later work without becoming the data owner of any of them.

---

# Product loop

The highest-level human collaboration surfaces are now:

```text
                         HUMAN
                           │
          ┌────────────────┼────────────────┐
          │                │                │
         Now             Inbox          Projects
  what is happening?  what came back?   what are we doing?
          │                │                │
          └──────────── Portal shell ───────┘
                           │
          global Search / Ask AICIV / Talk live
                           │
                      Conversation
                           │
                    primary durable AICIV
                           │
                    agents / tools / work
                           │
                explicit result + receipts
```

`Now`, `Inbox`, `Projects`, Conversation, global voice Presence and global `Cmd/Ctrl-K` search are intended to make the existing subsystem power feel like **one intelligence inhabiting one workspace**.

---

# Repository layout

```text
react-portal-aiciv/
├── portal_server.py             # Mature core Starlette Portal / local AICIV adapter
├── portal_entrypoint.py         # Canonical production entrypoint + extension registration
├── presence_bridge.py           # Portal ↔ Presence Gateway boundary
├── aiciv_inbox.py               # Shared human-facing Result/Decision Inbox annotations
├── aiciv_projects.py            # Shared project/workstream reference graph
├── start.sh                     # Canonical launcher; defaults to port 8097
│
├── react-portal/
│   ├── src/
│   │   ├── components/
│   │   │   ├── now/             # AICIV Now synthesis cockpit
│   │   │   ├── inbox/           # Needs You / Results / Archive
│   │   │   ├── projects/        # durable workstreams + object relationships
│   │   │   ├── command/         # global Cmd/Ctrl-K palette
│   │   │   ├── presence/        # global Presence shell capability
│   │   │   ├── chat/
│   │   │   ├── browser/
│   │   │   ├── docs/
│   │   │   ├── sheets/
│   │   │   └── ...
│   │   ├── search/              # cross-surface object indexing/ranking
│   │   ├── stores/              # Zustand UI/domain stores
│   │   ├── api/                 # same-origin API adapters
│   │   ├── types/               # TypeScript domain contracts
│   │   ├── styles/              # shared design tokens
│   │   └── test/                # Vitest regression tests
│   ├── package.json
│   ├── package-lock.json        # reproducible dependency lock
│   └── README.md                # AICIV-facing operating guide
│
├── agents/                      # Claude Code agent manifests
├── skills/
│   └── presence-job/            # durable job callback + human decision protocol
├── civ-tools/
│   └── react.py                 # collaboration reaction helper
├── docs/
│   └── AICIV_NATIVE_PORTAL_REVIEW.md
├── test_presence_bridge.py
├── test_aiciv_inbox.py
├── test_aiciv_projects.py
└── .github/workflows/
```

## Extension-module rule

`portal_server.py` is mature and large. New cross-cutting capabilities should not automatically grow that monolith.

The preferred pattern is:

```text
portal_server.app
      │
portal_entrypoint.py
      ├── register_presence_routes(...)
      ├── register_aiciv_inbox_routes(...)
      └── register_aiciv_project_routes(...)
```

This keeps new domains testable and replaceable while preserving the working core server. Extract older domains opportunistically when they are meaningfully changed; do not rewrite the whole Portal merely for architectural purity.

---

# Information architecture

Desktop navigation is grouped by human intent rather than backend ownership:

```text
Together
  Now
  Inbox
  Conversation

Work
  Projects
  Teams
  Calendar
  Mail
  Org
  TGIM

Knowledge
  Docs
  Sheets
  HUB
  Bookmarks
  Signals

Control
  Browser
  Terminal
  Context
  Status
  Settings
```

Mobile prioritizes the high-frequency collaboration loop:

```text
Now · Chat · Inbox · Mail · More
```

Projects and every operator surface remain reachable under More.

---

# Current Portal routes

`react-portal/src/App.tsx` is the source of truth.

| Route | Surface | Purpose |
|---|---|---|
| `/now` | **AICIV Now** | Meaning-first synthesis of primary health, durable work, results, context pressure, unread mail, active panes and activity |
| `/inbox` | **AICIV Inbox** | `Needs You`, `Results`, `Archive`; structured decisions plus receipt-backed terminal work |
| `/projects` | **Projects** | Shared durable workstreams linking authoritative Jobs, Docs and future AICIV objects |
| `/` | **Conversation** | Typed primary conversation, search, reactions, uploads, artifacts, commands and dictation |
| `/teams` | Teams | Live tmux panes / advanced direct pane interaction |
| `/calendar` | Calendar | AgentCal scheduling and recurring work |
| `/mail` | Mail | AgentMail inbox/sent/threads/compose |
| `/orgchart` | Org | Agent hierarchy and organizational workflows |
| `/tgim` | TGIM | Task & Goal Intelligence Manager |
| `/docs` | Docs | Shared Markdown knowledge with tags/search/visibility |
| `/sheets` | Sheets | Shared structured data/workbooks/rows/export |
| `/hub` | HUB | Groups, rooms, threads and posts |
| `/bookmarks` | Bookmarks | Saved conversation references; currently browser-local |
| `/points` | Signals | Reaction/sentiment collaboration signal |
| `/browser` | Browser | Shared human/AICIV browser viewport and control handoff |
| `/terminal` | Terminal | Direct terminal/tmux control |
| `/context` | Context | Claude context/session state |
| `/status` | Status | Raw CIV/tmux/Claude/BOOP/auth health |
| `/settings` | Settings | Preferences, identity controls and logout |

---

# AICIV Now

`/now` is the Portal's first meaning-first synthesis layer.

It combines:

- primary tmux + Claude availability;
- context-window pressure;
- active durable Presence jobs;
- completed results and receipts;
- waiting/failed/cancel-requested work needing attention;
- unread AgentMail;
- active team/tmux panes;
- normalized recent activity.

Raw pages remain available as drill-down views. The design principle is:

> **meaning first, machinery second.**

`useNowStore` is an initial shared synthesis model. Long-term, independent polling should increasingly become a typed server event/activity stream.

---

# Shared AICIV Inbox

`/inbox` is the durable return/judgment surface.

## Needs You

A durable AICIV can report a `waiting` event with a structured human decision:

```json
{
  "decision": {
    "id": "dec_provider_choice",
    "question": "Which provider should we use for the next cohort?",
    "context": "Provider B won latency; Provider A has more production history.",
    "recommendation": "Use B for a reversible cohort and keep A as fallback.",
    "risk": "B has less production history in our stack.",
    "options": [
      {"id": "provider_b", "label": "Use Provider B"},
      {"id": "provider_a", "label": "Stay on Provider A"},
      {"id": "more_testing", "label": "Run more testing"}
    ],
    "allowFreeform": true
  }
}
```

The Portal renders this as a decision object rather than inferring a choice from prose.

When the human responds:

1. Portal sends the structured decision response to the primary AICIV through the existing authenticated chat delivery path.
2. Only after delivery is accepted does Portal store the shared inbox annotation.
3. The AICIV resumes the durable job.
4. The downstream consequence still requires a later job receipt.

**Human selection is input, not execution proof.**

## Results

Shows authoritative terminal Presence job outcomes:

```text
succeeded | failed | cancelled
```

Successful work may include structured result data and evidence/receipts.

## Archive

Portal stores only collaboration annotations:

- `seenAt`;
- `archivedAt`;
- decision-response selections.

The default file is `.aiciv-inbox-state.json`, atomically written and chmod `0600`.

Override with:

```bash
AICIV_INBOX_STATE_FILE=/srv/portal/state/aiciv-inbox.json
```

This annotation store is never a second source of truth for job state.

---

# AICIV Projects / workstream graph

`/projects` supplies the durable connective tissue between subsystem objects.

A project currently stores:

```text
projectId
title
goal
summary
status
tags[]
links[]
createdAt
updatedAt
```

A link is deliberately small:

```json
{
  "kind": "job",
  "objectId": "job_0123456789abcdef01234567",
  "relation": "work",
  "addedAt": "2026-08-08T12:00:00Z"
}
```

Supported link kinds are prepared for:

```text
job
doc
sheet
thread
agent
calendar
mail
browser
artifact
```

## Reference-only invariant

Projects store **relationships, not copies of truth**.

For example:

```text
Project → job_...
```

means the project references a Presence job. The job goal/status/result/receipts remain authoritative in the Presence system.

Likewise:

```text
Project → doc_...
```

references a Doc; the project file does not copy the Doc body.

This prevents Projects from becoming another giant stale data silo.

## Current UI

Projects currently supports:

- create project;
- edit title/goal/summary/tags;
- active/paused/completed/archived state;
- link/unlink existing durable Jobs;
- link/unlink existing Docs;
- resolve those links against authoritative stores at render time;
- preserve/display future graph-edge types it does not yet richly render;
- direct navigation back to the linked authoritative object;
- `Work with AICIV`, which delivers a structured project-context envelope into Conversation.

That handoff contains project/object IDs and explicitly tells the AICIV they are references—not copied state. Delivery acceptance is not downstream execution proof.

## Persistence and API

Default persistence:

```text
.aiciv-projects.json
```

Atomic, mode `0600`, ignored by git.

Optional relocation:

```bash
AICIV_PROJECTS_STATE_FILE=/srv/portal/state/aiciv-projects.json
```

Routes:

```text
GET   /api/aiciv/projects
POST  /api/aiciv/projects
GET   /api/aiciv/projects/{project_id}
PATCH /api/aiciv/projects/{project_id}
POST  /api/aiciv/projects/{project_id}/links
POST  /api/aiciv/projects/{project_id}/links/remove
```

Relationship creation is idempotent for the same `(kind, objectId, relation)` edge.

---

# Global command palette / cross-surface search

Press:

```text
Ctrl-K   Windows/Linux
Cmd-K    macOS
```

The global palette is available on every Portal route.

It currently indexes:

- Portal destinations/intents;
- exact Projects by title/goal/summary/tags/status;
- recent durable Presence jobs/results;
- shared Docs by title/tags/body text;
- the most recent 200 conversation messages.

Object results perform deep navigation:

- Project → opens the exact selected project;
- Doc → opens the exact selected Doc;
- conversation result → scrolls/highlights the exact message;
- durable job → routes to Now or Inbox based on state.

Any non-trivial freeform query also offers:

```text
Ask AICIV: “...”
```

This sends the query through the existing authenticated primary-chat delivery path. Portal only navigates after delivery is accepted; it does not claim the AICIV completed any requested work.

The current ranking layer is dependency-free and token-aware. It tolerates partial source failure so one unavailable subsystem does not destroy navigation/search for everything else.

---

# Conversation, Dictate and Talk live

Conversation remains the primary typed interaction surface.

Capabilities include:

- merged/history-backed chat;
- WebSocket updates;
- optimistic human messages;
- reactions;
- local conversation search;
- uploads;
- artifact/code preview;
- slash commands;
- quick-fire messages;
- speech-to-text **Dictate**.

The composer microphone is only dictation: it fills the text box.

Full realtime conversational voice is global **Talk live** in the Portal header.

---

# Global Voice Presence

Voice Presence is available from the app shell on every route.

Provider-specific ElevenLabs code stays encapsulated behind the generic Presence UI boundary.

## Trust flow

```text
Browser
  │ Portal bearer
  ▼
Portal
  │ server-only PRESENCE_GATEWAY_API_KEY
  ▼
AICIV Presence Gateway
  │ server-only provider credentials
  ▼
ElevenLabs Speech Engine
  │
  └── short-lived conversation token → Browser WebRTC
```

The browser never receives long-lived Presence Gateway, ElevenLabs, OpenAI, callback or other service secrets.

`presence_bridge.py` currently exposes:

```text
GET  /api/presence/status
POST /api/presence/voice/token
GET  /api/presence/jobs
GET  /api/presence/jobs/{job_id}
POST /api/presence/jobs/{job_id}/cancel
```

The bridge:

- requires Portal auth;
- keeps the gateway key server-side;
- derives voice participant identity from trusted CIV/human state;
- rate-limits token minting;
- validates job IDs before forwarding;
- normalizes upstream errors instead of leaking provider diagnostics.

---

# Durable Presence jobs and receipt discipline

Substantial realtime requests can become durable work via Presence's native `ask_primary(...)` tool.

Typical lifecycle:

```text
queued
  ↓
accepted
  ↓
running
  ↔ waiting
  ↓
succeeded | failed | cancelled
```

Cancellation is two-phase:

```text
request stop
   ↓
cancel_requested
   ↓
AICIV actually stops
   ↓
cancelled receipt
```

Portal must not call `cancel_requested` “cancelled.”

The distributed AICIV callback helper lives under:

```text
skills/presence-job/
```

It supports:

```text
running
progress
waiting
succeeded
failed
cancelled
```

and documents both result/receipt completion and the structured human-decision protocol.

---

# Shared Browser

Browser is explicitly a human/AICIV co-control primitive.

The Portal streams a server-controlled browser viewport, preserves action logs and supports human takeover/handback.

Direction:

- semantic action steps;
- clearer takeover handshakes;
- annotations/highlights;
- evidence capture linked to projects/jobs;
- approval boundaries for sensitive actions;
- resumable sessions.

---

# Knowledge / structured data

## Docs

Durable Markdown knowledge with create/edit/delete, tags, visibility and search.

## Sheets

Workbooks and typed structured data with row CRUD, cell editing, pagination and export.

## HUB

Structured group/room/thread/post collaboration.

## Bookmarks

Currently browser-local `localStorage`. This remains a known mismatch with the shared-object model and should eventually move server-side.

---

# Agents / operational visibility

## Teams

Raw tmux panes remain available to power users. Long-term direction is semantic agent/job state above those panes while preserving raw inspectability.

## Org

Agent hierarchy/role/organization management.

## Context

Claude context/session pressure.

## Status

Raw runtime/process health.

The human-facing default should increasingly say what the condition *means*, with these raw pages explaining the machinery underneath.

---

# Authentication / secrets

The current per-CIV Portal bearer is conventionally stored at:

```text
~/purebrain_portal/.portal-token
```

The current React app stores it in browser `localStorage`. This is acceptable for today's trusted per-CIV deployment, but not the final public multi-tenant auth architecture.

Keep these authorities separate:

```text
Portal bearer                  browser → Portal
PRESENCE_GATEWAY_API_KEY       Portal → Presence Gateway
AICIV_CALLBACK_API_KEY         trusted AICIV → Presence job callback
```

Do not reuse them.

---

# Prerequisites

Current baseline:

- Node.js **22+**;
- npm using the committed lockfile;
- Python **3.10+** (focused CI uses 3.12);
- tmux;
- Claude Code in the CIV environment;
- normal Linux/container deployment.

Typical Python dependencies include:

```bash
pip3 install starlette uvicorn aiosqlite httpx pyyaml agentmail cryptography
```

Install additional subsystem-specific dependencies for features enabled in the deployment.

---

# Build / test

```bash
git clone https://github.com/metamindsapp/react-portal-aiciv.git
cd react-portal-aiciv/react-portal
npm ci
npm run build
npm test
```

Production CI additionally runs:

```bash
npm audit --omit=dev --audit-level=high
```

High/critical vulnerabilities reachable from the shipped runtime dependency tree block the product CI gate.

---

# Per-CIV deployment

Conventional deployment root:

```text
~/purebrain_portal
```

Ensure the deployed root includes:

```text
portal_server.py
portal_entrypoint.py
presence_bridge.py
aiciv_inbox.py
aiciv_projects.py
start.sh
react-portal/
skills/
civ-tools/
```

Sync AICIV assets as needed:

```bash
mkdir -p ~/.claude/agents ~/.claude/skills ~/civ/tools
cp agents/*.md ~/.claude/agents/ 2>/dev/null || true
cp -r skills/* ~/.claude/skills/
cp civ-tools/react.py ~/civ/tools/react.py
chmod +x ~/civ/tools/react.py
```

---

# Identity

Portal auto-detects the local relationship from:

```json
~/.aiciv-identity.json
{
  "civ_id": "synth",
  "human_name": "Corey"
}
```

Development fallbacks are used when absent.

---

# Portal extension configuration

Presence:

```bash
PRESENCE_GATEWAY_URL=https://presence.example.com
PRESENCE_GATEWAY_API_KEY=<long random operational secret>
PRESENCE_GATEWAY_TIMEOUT_SECONDS=8
PRESENCE_VOICE_TOKEN_LIMIT=12
PRESENCE_VOICE_TOKEN_WINDOW_SECONDS=60
```

Shared collaboration state locations are optional overrides:

```bash
AICIV_INBOX_STATE_FILE=/srv/portal/state/aiciv-inbox.json
AICIV_PROJECTS_STATE_FILE=/srv/portal/state/aiciv-projects.json
```

Trusted AICIV callback authority:

```bash
PRESENCE_GATEWAY_URL=https://presence.example.com
AICIV_CALLBACK_API_KEY=<different callback-only secret>
```

---

# Start Portal

Canonical launcher:

```bash
./start.sh
```

or:

```bash
./start.sh 8097
```

Startup flow:

```text
start.sh
  → portal_entrypoint.py
      → imports portal_server.app
      → registers Presence routes
      → registers Inbox routes
      → registers Project routes
      → starts uvicorn
```

Do not bypass `portal_entrypoint.py` in normal deployments or extension routes will not exist.

---

# CI / acceptance discipline

Portal product CI currently verifies:

## Backend

- extension modules compile;
- Presence trust-boundary tests;
- shared Inbox state tests;
- Project graph auth/persistence/idempotency/reference-only tests.

## Frontend

- `npm ci` from the committed lockfile;
- production dependency audit;
- TypeScript/Vite production build;
- full Vitest suite including Now, Inbox, Projects and command-palette semantics.

## Presence Job Skill

A separate workflow compiles/tests the durable callback helper when the skill changes.

---

# Reliability semantics

Keep state language exact:

```text
requested ≠ accepted ≠ running ≠ waiting ≠ completed
cancel requested ≠ cancelled
human selected option ≠ downstream action executed
project links object ≠ project owns/copies object truth
```

A quiet UI is not inherently trustworthy. Important failure paths should become visible stable states rather than disappearing into silent catches.

---

# Next architectural direction

Major pieces now delivered from the AICIV-native review:

- Now synthesis cockpit;
- global Presence;
- durable Result/Decision Inbox;
- structured human decision protocol;
- intent-grouped navigation;
- global `Cmd/Ctrl-K` search + Ask AICIV;
- exact object deep-navigation for Projects/Docs/conversation/jobs;
- Projects/workstream reference graph.

High-value next work:

1. **typed unified event/activity transport** instead of independent polling;
2. **expand project links** to Sheets, HUB threads, agents, calendar events, browser evidence and artifacts;
3. **project-aware Presence/context hydration** so voice can understand the active workstream without hand-written context envelopes;
4. **shared object/correlation IDs** across effects and receipts;
5. **semantic Teams/agent state** above raw panes;
6. **server-sync browser-local Bookmarks**;
7. **richer Browser co-control + evidence capture**;
8. **route-level lazy loading / server-state architecture cleanup**;
9. **public/multi-tenant auth** before broad untrusted exposure;
10. **mobile/Reachy** as additional bodies of the same AICIV.

The original ground-floor → 30,000-foot design review remains in:

[`docs/AICIV_NATIVE_PORTAL_REVIEW.md`](docs/AICIV_NATIVE_PORTAL_REVIEW.md)

---

# Product north star

The Portal should increasingly answer these questions without forcing the human to know which subsystem contains the answer:

```text
What is my AICIV doing?
What changed while I was away?
What came back?
What needs my judgment?
What project are we advancing?
What evidence supports the result?
Where can I take control?
What should we do next?
```

That is the shift from a collection of AI subsystem pages to an **AICIV-native shared operating environment**.
