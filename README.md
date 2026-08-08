# AICIV React Portal

The AICIV React Portal is the **human-facing control surface for a persistent AICIV**. It is not just a chat UI: it is the per-CIV workspace where a human can converse with the primary intelligence, inspect live runtime state, work with agent teams, operate the browser, use calendar/mail/docs/sheets, manage the agent organization, and now talk to the same AICIV through low-latency voice Presence.

The Portal intentionally sits at the boundary between a human/product UI and the local AICIV runtime. Today that runtime is primarily Claude Code + tmux + local files/services. The Portal absorbs those implementation details so other surfaces—voice, mobile, Reachy, watch/earbuds, and future clients—do not have to learn them.

> **Core design idea:** the Portal is the canonical local control-plane adapter for one AICIV. Chat, voice Presence, tools, agents, files, and external services should converge on the same durable intelligence rather than creating separate “bots” per interface.

---

## Current system at a glance

```text
                               HUMAN
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
          typed Portal       voice Portal       operator UI
              │                  │                  │
              │          ElevenLabs WebRTC          │
              │                  │                  │
              │          Presence Gateway           │
              │           fast cognition            │
              │                  │                  │
              └──────────────┬───┴──────────────────┘
                             │
                      React Portal API
                   Python / Starlette :8097
                             │
           ┌─────────────────┼───────────────────┐
           │                 │                   │
        tmux /            CivOS APIs          local state
      Claude Code     AgentCal / Sheets      JSONL / SQLite
           │          AgentMail / HUB             │
           │                                     │
           └────────────── PRIMARY AICIV ─────────┘
                         agents / tools
                         durable work
```

Voice is deliberately a **Presence layer**, not a second AICIV. The low-latency voice model can answer directly or call `ask_primary(...)` to create a durable job in the primary AICIV. Completion is reported with explicit receipts; a voice session ending does not end the job.

---

## What is in this repository

```text
react-portal-aiciv/
├── portal_server.py          # Core Starlette Portal backend / local AICIV adapter
├── portal_entrypoint.py      # Production entrypoint; adds optional Presence routes
├── presence_bridge.py        # Same-origin Portal → Presence token bridge + rate limiting
├── start.sh                  # Canonical launcher (defaults to port 8097)
├── release_notes.json
│
├── react-portal/             # React 19 + TypeScript + Vite client
│   ├── src/
│   │   ├── components/       # Product surfaces and shared UI
│   │   ├── stores/           # Zustand state stores
│   │   ├── api/              # Typed-ish same-origin API adapters
│   │   ├── types/            # TypeScript domain interfaces
│   │   ├── styles/           # Global design tokens / CSS
│   │   ├── utils/
│   │   └── test/             # Vitest frontend tests
│   ├── package.json
│   ├── package-lock.json     # Committed reproducible dependency lock
│   └── README.md             # AICIV-facing operating notes
│
├── agents/                   # Claude Code agent manifests
├── skills/                   # AICIV skills installed by Portal deployments
│   └── presence-job/         # Durable Presence callback/receipt skill
├── civ-tools/                # Operational helpers available to the CIV
│   └── react.py              # Direct reaction/sentiment append tool
├── test_presence_bridge.py   # Focused Presence trust-boundary tests
└── .github/workflows/        # CI, including frontend build/test/security gate
```

### Important backend design note

`portal_server.py` is the mature core server and currently contains a large amount of Portal functionality in one Starlette module. New voice integration **does not patch that monolith directly**. `portal_entrypoint.py` imports the existing app and registers the narrow `presence_bridge.py` routes before starting Uvicorn. Preserve that low-blast-radius pattern when adding cross-cutting integrations.

---

# Portal surfaces

The current React application exposes these top-level routes:

| Route | Surface | What it is for |
|---|---|---|
| `/` | **Chat** | Primary typed conversation with the live AICIV; history, WebSocket updates, reactions, file uploads, artifact preview, search, and voice Presence control |
| `/terminal` | **Terminal** | Direct terminal/tmux view for advanced human operation |
| `/teams` | **Teams** | Live tmux pane view; inspect active panes and inject messages into a selected pane |
| `/hub` | **HUB** | Group/room/thread/post collaboration interface backed by the HUB service |
| `/tgim` | **TGIM** | Embedded Task & Goal Intelligence Manager command center |
| `/browser` | **Browser** | Shared browser viewport with agent/human control handoff and action log |
| `/orgchart` | **Org Chart** | Agent hierarchy, discovery, hiring/organization workflows, team structure |
| `/calendar` | **AgentCal** | Calendar/task interface with recurring scheduling and AgentCal integration |
| `/mail` | **AgentMail** | AgentMail inbox/sent/thread/compose surface |
| `/bookmarks` | **Bookmarks** | Saved chat messages / useful conversational references |
| `/context` | **Context** | Live Claude context-window utilization and session information |
| `/points` | **Points** | Reaction/sentiment score dashboard and collaboration signal |
| `/docs` | **Docs / Knowledge Base** | Searchable Markdown documents with tags and visibility controls |
| `/sheets` | **Sheets** | AgentSheets workbooks, sheets, typed columns, rows, inline editing and export |
| `/status` | **Status** | CIV, tmux, Claude, Telegram, BOOP, auth and context operational health |
| `/settings` | **Settings** | Identity display, theme, BOOP toggle, quick-fire messages, resources and logout |

The route list in `react-portal/src/App.tsx` is the source of truth when adding/removing a top-level Portal surface. The desktop navigation list currently lives in `components/layout/Sidebar.tsx`; mobile navigation has its own component.

---

# Chat: the primary human ↔ AICIV surface

Portal Chat is the highest-level conversational interface into the same primary AICIV session used by the rest of the system.

Current Chat capabilities include:

- merged/history-backed conversation display;
- WebSocket updates from `/ws/chat`;
- optimistic human message insertion;
- message reactions;
- text search/highlighting;
- file upload through `/api/chat/upload`;
- artifact/code preview panel;
- quick-fire messages;
- low-latency voice Presence control.

Portal chat is also the first transport used by the Presence Gateway to inject durable work into the active AICIV. **A chat delivery receipt is not a task-completion receipt.** Durable Presence jobs use a separate job state machine and explicit callbacks.

---

# Voice Presence

Voice Presence is now a first-class Portal capability.

## Trust boundary

```text
Browser
  │ Portal bearer
  ▼
Portal
  │ server-only PRESENCE_GATEWAY_API_KEY
  ▼
AICIV Presence Gateway
  │ server-only ElevenLabs + OpenAI credentials
  ▼
ElevenLabs Speech Engine
  │
  └── short-lived conversation token → Browser WebRTC
```

The browser never receives:

- `PRESENCE_GATEWAY_API_KEY`;
- the ElevenLabs API key;
- the OpenAI API key;
- `AICIV_CALLBACK_API_KEY`;
- the Portal's upstream service credentials.

It receives only a short-lived ElevenLabs conversation credential from the authenticated same-origin Portal route.

## Portal Presence endpoints

`presence_bridge.py` registers:

```text
GET  /api/presence/status
POST /api/presence/voice/token
```

The token route:

- authenticates Portal first;
- fails closed if Presence is not configured;
- derives participant identity from trusted Portal CIV/human state, never browser metadata;
- rate-limits token minting (default 12 attempts per 60 seconds per Portal process);
- calls the Presence Gateway with a server-only bearer key;
- strips upstream diagnostic/provider bodies from client errors;
- returns only `{ token, conversationId }`.

## Frontend voice behavior

`VoicePresenceControl.tsx` uses `@elevenlabs/react` and is lazy-loaded from Chat so the ElevenLabs/WebRTC bundle does not tax every initial Portal page load.

User-facing states include:

- checking availability;
- unavailable;
- ready;
- connecting;
- listening;
- speaking;
- muted;
- retry/error.

Microphone permission is requested from a direct user gesture before the provider owns the live WebRTC capture.

---

# Durable Presence jobs and receipts

The Portal repository installs the `presence-job` skill into AICIV environments. This is the callback side of the Presence Gateway's durable delegation protocol.

A Presence request arriving in the primary AICIV contains a durable marker such as:

```text
[PRESENCE DURABLE JOB job_0123456789abcdef01234567]
```

The job is **not tied to the current voice turn or WebRTC connection**.

The AICIV reports lifecycle events with:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py JOB_ID STATUS [options]
```

Supported callback events:

```text
running
progress
waiting
succeeded
failed
cancelled
```

Important semantics:

- `accepted` means the durable request was persisted/delivered, **not completed**;
- `cancel_requested` means a stop was requested, **not that work has stopped**;
- `succeeded` must include an actually completed result and appropriate evidence/receipts;
- `cancelled` should only be emitted after work genuinely stops or reaches a safe stopping point;
- callback retries may reuse the same event ID; the gateway de-duplicates them.

See `skills/presence-job/SKILL.md` for the complete AICIV protocol and examples.

---

# AICIV reactions and collaboration signal

Portal supports a lightweight shared reaction/sentiment channel.

The human can react in Chat. The AICIV can react directly from inside its container with:

```bash
python3 ~/civ/tools/react.py <msg_id> "🔥" "message preview" user
```

Both flows append to the same reaction log. The `/points` surface aggregates the resulting collaboration signal.

The AICIV-facing instructions and emoji/point conventions live in `react-portal/README.md`.

---

# Agent organization

Agent manifests are Markdown files in `~/.claude/agents/` with YAML frontmatter.

Example:

```markdown
---
name: full-stack-developer
description: Implements frontend/backend product work
model: opus
tools: Read, Write, Edit, Bash, Grep, Glob, Agent(qa-engineer)
---

You are the Full Stack Developer...
```

`Agent(...)` references are used to infer team hierarchy. The Portal can synchronize manifests into its agent database and render the resulting organization graph.

Typical sync:

```bash
TOKEN=$(cat ~/purebrain_portal/.portal-token)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8097/api/agents/sync
```

The repository also ships organization-oriented skills such as hiring/health/restructure workflows where present under `skills/`.

---

# Knowledge, data and collaboration surfaces

## Docs / Knowledge Base

The Docs surface provides Markdown documents with:

- create/edit/delete;
- full-text client-side search over loaded documents;
- tags;
- public/private/CIV-only visibility metadata;
- recent/alphabetical sorting;
- responsive list/detail editing UI.

## AgentSheets

The Sheets surface supports:

- workbooks;
- multiple sheets;
- typed columns (`text`, `number`, `boolean`, `date`, `json`);
- row create/update/delete;
- inline cell editing;
- pagination;
- export.

## HUB

HUB exposes collaboration structure as:

```text
group → room → thread → posts/replies
```

The Portal proxies HUB access through the local server rather than exposing remote service credentials to the browser.

## Shared browser

The Browser surface is explicitly collaborative. It streams a server-controlled browser viewport over WebSocket and allows a human to take/release control while preserving an action log.

The intended product direction is **co-navigation**, not a separate human browser: the human should be able to see what the AICIV is doing, intervene when useful, and hand control back without losing task context.

## TGIM

The current TGIM integration is a sandboxed iframe to the externally hosted TGIM command center. It is intentionally a shallow integration today; future native task/goal integration should prefer structured APIs/events over deeper iframe coupling.

---

# Backend and local data model

The Portal server is intentionally close to the CIV runtime and therefore touches several local state sources.

Key local paths/state include:

```text
~/.aiciv-identity.json                 # CIV/human identity
~/.claude/history.jsonl                # Claude history index
~/.claude/projects/...                 # Claude project JSONL sessions
~/portal_uploads/                      # human uploads
~/civ/logs/                            # CIV logs / imports
~/purebrain_portal/.portal-token       # Portal bearer credential
~/purebrain_portal/portal-chat.jsonl   # Portal chat log
~/purebrain_portal/*.db                # local SQLite stores where applicable
```

The exact deployment directory can vary, but `~/purebrain_portal` is the conventional fleet location.

The core server also integrates with CivOS-style services such as AgentCal, AgentSheets and AgentAuth and contains additional administrative/referral/client-management endpoints used by the broader PureBrain deployment.

---

# Authentication and security model

## Portal bearer

The primary Portal UI/API uses a bearer token stored in:

```text
~/purebrain_portal/.portal-token
```

If the file does not exist, `portal_server.py` generates a random token and writes it with restrictive permissions.

The current React client stores the Portal bearer in browser `localStorage`. This is a practical per-CIV deployment mechanism, not the desired final multi-tenant identity architecture. A future public/fleet-facing Portal should move toward short-lived application sessions/OIDC and stronger browser credential isolation.

## Service credentials

External service credentials remain server-side. The frontend uses same-origin Portal APIs/proxies.

## Presence separation

Use two different Presence secrets:

- `PRESENCE_GATEWAY_API_KEY` — normal server-to-server Portal/Gateway operations;
- `AICIV_CALLBACK_API_KEY` — callback-only authority for trusted AICIVs to report durable job events.

Do not reuse the Portal bearer as either Presence key.

---

# Prerequisites

Recommended/current development baseline:

- **Node.js 22+**;
- **npm** with the committed lockfile;
- **Python 3.10+** (3.12 is used in focused CI);
- **tmux**;
- **Claude Code** running in the CIV environment;
- Linux/container environment for the normal fleet deployment.

Core Python dependencies include:

```bash
pip3 install starlette uvicorn aiosqlite httpx pyyaml agentmail cryptography
```

Install any service-specific dependencies required by the features enabled in your deployment.

---

# Installation / deployment

## 1. Clone

```bash
git clone https://github.com/metamindsapp/react-portal-aiciv.git
cd react-portal-aiciv
```

For the normal per-CIV deployment, copy/sync the repository contents into the Portal directory, conventionally:

```text
~/purebrain_portal
```

Ensure the deployment includes at least:

```text
portal_server.py
portal_entrypoint.py
presence_bridge.py
start.sh
react-portal/
skills/
civ-tools/
```

Install/sync agent manifests and skills as appropriate:

```bash
mkdir -p ~/.claude/agents ~/.claude/skills ~/civ/tools
cp agents/*.md ~/.claude/agents/ 2>/dev/null || true
cp -r skills/* ~/.claude/skills/
cp civ-tools/react.py ~/civ/tools/react.py
chmod +x ~/civ/tools/react.py
```

## 2. Identity

Portal auto-detects identity from:

```json
~/.aiciv-identity.json
{
  "civ_id": "synth",
  "human_name": "Corey"
}
```

If missing, development fallbacks are used.

## 3. Environment

Portal reads many service settings from process environment or `~/.env` depending on subsystem.

Common CivOS integrations:

```bash
# AgentCal
AICIVCAL_API_KEY=
AICIVCAL_URL=http://5.161.90.32:8300

# AgentSheets
AGENTSHEETS_URL=http://5.161.90.32:8500
AGENTSHEETS_API_KEY=

# AgentAuth (preferred shared service auth when configured)
AGENTAUTH_URL=
AGENTAUTH_PRIVATE_KEY=
AGENTAUTH_PUBLIC_KEY=

# AgentMail
AGENTMAIL_API_KEY=
AGENTMAIL_INBOX=
```

### Optional Presence integration

On the Portal/AICIV host:

```bash
PRESENCE_GATEWAY_URL=https://presence.example.com
PRESENCE_GATEWAY_API_KEY=<long server-only gateway key>
AICIV_CALLBACK_API_KEY=<separate long callback-only key>

# Optional token-mint protection tuning
PRESENCE_GATEWAY_TIMEOUT_SECONDS=8
PRESENCE_VOICE_TOKEN_LIMIT=12
PRESENCE_VOICE_TOKEN_WINDOW_SECONDS=60
```

`PRESENCE_GATEWAY_API_KEY` must match the gateway's operational bearer. `AICIV_CALLBACK_API_KEY` must match the callback authority configured on the Presence Gateway.

## 4. AgentCal calendar (when applicable)

Create/register a calendar with the AgentCal service and save the returned calendar ID to:

```text
~/purebrain_portal/.aicivcal-calendar-id
```

## 5. Portal bearer

You may pre-create one:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))" > .portal-token
chmod 600 .portal-token
```

If absent, the server generates it at startup/import time.

## 6. Build frontend

Use the committed lockfile:

```bash
cd react-portal
npm ci
npm run build
npm test
cd ..
```

CI also runs a production-dependency vulnerability gate for high/critical shipped vulnerabilities.

## 7. Start Portal

Use the wrapper entrypoint, not a direct `portal_server.py` invocation:

```bash
./start.sh
```

Or select a port:

```bash
./start.sh 8097
```

`start.sh` exports `PORT` and runs `portal_entrypoint.py`, which preserves the existing Portal app while registering optional Presence routes.

---

# Development

Frontend development:

```bash
cd react-portal
npm ci
npm run dev
```

Useful checks:

```bash
npm run build
npm test
npm run lint
```

Focused Presence bridge checks from repository root:

```bash
python3 -m py_compile presence_bridge.py portal_entrypoint.py
python3 test_presence_bridge.py
```

---

# Operational checks

Basic Portal status:

```bash
TOKEN=$(cat .portal-token)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8097/api/status
```

Presence capability status through Portal:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8097/api/presence/status
```

For end-to-end Presence provider/Portal readiness, run `npm run doctor` in the **AICIV Presence Gateway** repository. That doctor validates provider metadata access, durable storage, Portal auth/health, callback configuration and public WSS configuration without creating paid inference or a voice conversation.

---

# Architecture boundaries to preserve

### 1. Portal owns local-runtime adaptation

Portal may know about tmux, Claude Code history, local files, agent manifests and per-CIV services. Generic voice/mobile/robot clients should not.

### 2. Presence owns realtime conversation

Turn-taking, interruption, low-latency cognition and voice-provider integration belong in the Presence Gateway, not scattered across Portal components.

### 3. Durable work has an independent lifetime

A voice connection, a typed Chat turn and a long-running job are different lifecycles.

```text
voice/session lifetime != job lifetime != human↔AICIV relationship lifetime
```

### 4. No completion without evidence

Delivery/acceptance must never be upgraded to “done.” Durable work should terminate with an explicit status/result/receipt path.

### 5. Human and AICIV should share objects

Docs, sheets, browser sessions, tasks, messages and artifacts should increasingly become shared durable objects that either side can create, inspect, edit, reference and hand off.

---

# Current technical stack

## Frontend

- React **19.2.7**
- TypeScript **5.9**
- Vite **8**
- Zustand **5**
- React Router **8.3.0** (currently consumed through the compatibility package alias `react-router-dom`)
- `@elevenlabs/react` **1.11.0**
- `react-markdown` + `remark-gfm`
- date-fns
- Vitest + Testing Library

## Backend

- Python / Starlette / Uvicorn
- aiosqlite / SQLite
- httpx
- tmux + Claude Code integration
- JSONL/local-file state where useful
- CivOS service proxies/adapters

---

# Known architectural pressure points

These are not reasons to stop using the current design; they are the clearest places to evolve it as the Portal becomes a richer AICIV-native product.

1. **`portal_server.py` is a large multi-domain module.** Continue extracting new domains into narrow modules/routers instead of adding more unrelated endpoints directly to the monolith.
2. **Navigation is feature/subsystem-centric.** The growing number of top-level pages should evolve toward intent-based workspaces and progressive disclosure.
3. **Frontend status is fragmented.** Multiple surfaces poll their own endpoints; a shared AICIV activity/state/event model would improve coherence and reduce duplicate polling.
4. **Browser auth is a long-lived bearer in localStorage.** Appropriate for the current trusted per-CIV model, but not the desired final public multi-tenant session architecture.
5. **Many objects are page-local.** The next product leap is deep linking/cross-referencing tasks, agents, docs, sheets, browser evidence, messages and durable Presence jobs across the whole workspace.
6. **The Portal is mostly request/response UI.** A persistent AICIV should increasingly surface proactive activity, pending decisions, completed work and recommended next actions without requiring the human to hunt through pages.

---

# Product direction

The Portal should become less like a collection of admin pages and more like an **operating environment shared by a human and a persistent intelligence**.

The strongest primitives already exist:

- conversation;
- voice Presence;
- durable delegation;
- agents/teams;
- browser co-control;
- calendar;
- mail;
- documents;
- structured data/sheets;
- collaboration/HUB;
- runtime/context visibility.

The next stage is synthesis: one activity model, one command surface, one shared object graph, one notification/decision inbox, and seamless transitions between “talk to the AICIV,” “watch what it is doing,” “inspect the evidence,” and “take control.”

That is the intended meaning of **AICIV-native interface** in this repository.