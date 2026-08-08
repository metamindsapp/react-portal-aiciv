# AICIV React Portal

The AICIV React Portal is the **human-facing operating environment for a persistent AICIV**.

It is not just a chat application and it is not an admin dashboard bolted onto an AI. The Portal is the per-CIV workspace where a human and an AICIV share conversation, low-latency voice Presence, durable work, returned results, decisions, agent teams, browser control, calendar/mail, knowledge, structured data, and raw operational visibility.

The Portal deliberately sits at the boundary between product UX and the local AICIV runtime. Today that runtime is primarily Claude Code + tmux + local files/services. The Portal absorbs those implementation details so other surfaces—voice, mobile, Reachy, watch/earbuds, and future clients—can interact with the same intelligence without learning how its container is wired.

> **Core design idea:** one persistent intelligence, many surfaces. Chat, voice, agents, files, tools, background jobs, browser sessions, and future embodied clients should converge on the same durable AICIV rather than creating separate “bots” per interface.

---

# Current product model

The Portal now separates three collaboration timescales:

```text
human ↔ AICIV relationship       durable / long-lived
        │
        ├── durable jobs          seconds → hours/days
        │
        └── realtime Presence     milliseconds → minutes
```

That separation is visible in the UX:

```text
                           HUMAN
                             │
            ┌────────────────┼────────────────┐
            │                │                │
          Now              Inbox         Conversation
     "what is true?"   "what came back?"   "talk/work"
            │                │                │
            └────────────── Portal ───────────┘
                             │
                  global Voice Presence
                             │
                  AICIV Presence Gateway
                             │
                  ┌──────────┴──────────┐
                  │                     │
            fast answer           ask_primary(...)
                                        │
                                 durable Presence job
                                        │
                                   React Portal
                                        │
                                 primary tmux/Claude
                                        │
                                  DURABLE AICIV
                                  agents / tools
                                        │
                              explicit result + receipts
                                        │
                                  Now / Inbox
```

A voice/WebRTC session can disappear while durable work continues. A returned result can survive browser/device changes. A human decision is input to the durable job, **not proof that the resulting action succeeded**.

---

# Repository layout

```text
react-portal-aiciv/
├── portal_server.py             # Mature core Starlette Portal / local AICIV adapter
├── portal_entrypoint.py         # Production entrypoint + narrow extension modules
├── presence_bridge.py           # Portal ↔ Presence Gateway routes
├── aiciv_inbox.py               # Shared Result/Decision Inbox annotations
├── start.sh                     # Canonical launcher; defaults to :8097
│
├── react-portal/                # React 19 + TypeScript + Vite client
│   ├── src/
│   │   ├── components/
│   │   │   ├── now/             # AICIV Now synthesis cockpit
│   │   │   ├── inbox/           # Needs You / Results / Archive
│   │   │   ├── presence/        # global Presence shell capability
│   │   │   ├── chat/
│   │   │   ├── browser/
│   │   │   ├── docs/
│   │   │   ├── sheets/
│   │   │   └── ...
│   │   ├── stores/              # Zustand UI/domain stores
│   │   ├── api/                 # same-origin API adapters
│   │   ├── types/               # TypeScript domain contracts
│   │   ├── styles/              # global design tokens
│   │   └── test/                # Vitest tests
│   ├── package.json
│   ├── package-lock.json        # reproducible locked install
│   └── README.md                # AICIV-facing operating guide
│
├── agents/                      # Claude Code agent manifests
├── skills/
│   └── presence-job/            # durable job callback + decision protocol
├── civ-tools/
│   └── react.py                 # direct collaboration reaction helper
├── docs/
│   └── AICIV_NATIVE_PORTAL_REVIEW.md
├── test_presence_bridge.py
├── test_aiciv_inbox.py
└── .github/workflows/
```

## Backend extension rule

`portal_server.py` is a mature, large Starlette module. New cross-cutting capabilities should **not automatically grow that monolith**.

The preferred pattern is the one used by Presence and Inbox:

```text
portal_server.app
      │
portal_entrypoint.py
      ├── register_presence_routes(...)
      └── register_aiciv_inbox_routes(...)
```

Extract old domains opportunistically when they are being meaningfully changed; do not rewrite the whole server merely for architectural purity.

---

# Information architecture

The Portal is moving away from a flat list of backend subsystems toward a human-intent model.

Desktop navigation is grouped as:

```text
Together
  Now
  Inbox
  Conversation

Work
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

Every previous power/operator surface remains available.

---

# Current Portal surfaces

`react-portal/src/App.tsx` is the source of truth for top-level React routes.

| Route | Surface | Purpose |
|---|---|---|
| `/now` | **AICIV Now** | Meaning-first synthesis of primary health, durable work, returned results, context pressure, unread mail, active panes and recent activity |
| `/inbox` | **Shared AICIV Inbox** | `Needs You`, `Results`, and `Archive`; receipt-backed job outcomes plus genuine structured human decision boundaries |
| `/` | **Conversation** | Primary typed conversation, search, reactions, upload/artifact preview, commands and speech-to-text dictation |
| `/teams` | **Teams** | Live tmux panes and direct pane injection for advanced operation |
| `/calendar` | **AgentCal** | Calendar/task interface and recurring scheduling |
| `/mail` | **AgentMail** | AgentMail inbox, sent mail, threads and compose |
| `/orgchart` | **Org** | Agent hierarchy, discovery, hiring and organization workflows |
| `/tgim` | **TGIM** | Embedded Task & Goal Intelligence Manager |
| `/docs` | **Docs** | Searchable Markdown knowledge with tags and visibility |
| `/sheets` | **Sheets** | Workbooks, typed columns, rows, editing and export |
| `/hub` | **HUB** | Group/room/thread/post collaboration |
| `/bookmarks` | **Bookmarks** | Saved conversational references; currently browser-local and a candidate for later server sync |
| `/points` | **Signals** | Reaction/sentiment collaboration signal |
| `/browser` | **Browser** | Shared agent/human browser viewport, control handoff and action log |
| `/terminal` | **Terminal** | Direct terminal/tmux control |
| `/context` | **Context** | Live Claude context-window/session information |
| `/status` | **Status** | Raw CIV/tmux/Claude/BOOP/auth/process health |
| `/settings` | **Settings** | Identity, appearance, BOOP, quick-fire messages and logout |

---

# AICIV Now

`/now` is the first synthesis layer over the Portal's subsystem interfaces.

It currently combines:

- primary tmux + Claude availability;
- context-window pressure;
- active durable Presence jobs;
- recent completed results and receipts;
- waiting/failed/cancel-requested work needing attention;
- unread AgentMail;
- active team/tmux panes;
- normalized recent activity.

The raw subsystem pages still exist as drill-down views. The principle is:

> **meaning first, machinery second.**

For example, the default human-facing state should be “Primary AICIV needs attention,” with Status/Terminal available to explain *why*, rather than forcing the human to inspect process flags before knowing anything is wrong.

`useNowStore` is the first shared synthesis model. It currently normalizes several sources into `AicivActivityItem`; the long-term direction is a typed server event/activity stream instead of independent polling loops.

---

# Shared AICIV Inbox

`/inbox` is the durable collaboration return surface.

It has three modes:

## Needs You

Shows durable work that has reached a **genuine human judgment boundary**.

An AICIV can report a `waiting` event with a structured decision object:

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

The Portal renders a decision card with context, recommendation, risk and options.

When the human chooses:

1. Portal sends a structured decision-response envelope through the existing authenticated chat delivery path into the primary AICIV.
2. Only after delivery succeeds does Portal store the shared decision-response annotation.
3. The AICIV resumes the durable job.
4. Any actual consequence must later report `succeeded`, `failed`, `cancelled`, etc. through the durable callback protocol.

**Human choice is not execution proof.**

## Results

Shows terminal durable job outcomes from the Presence Gateway:

- `succeeded`;
- `failed`;
- `cancelled`.

Successful results can include machine-readable output plus evidence/receipts.

## Archive

Stores human-facing inbox organization separately from job truth.

The Portal persists only:

- `seenAt`;
- `archivedAt`;
- decision-response annotations.

These live in a small atomic JSON store (`.aiciv-inbox-state.json` by default, mode `0600`) and are shared across Portal browsers/devices.

The file can be relocated with:

```bash
AICIV_INBOX_STATE_FILE=/srv/portal/state/aiciv-inbox.json
```

The inbox never becomes a second source of truth for job status/results.

---

# Conversation

Conversation remains the primary typed human ↔ AICIV surface.

Capabilities include:

- merged/history-backed conversation;
- WebSocket updates;
- optimistic human messages;
- reactions;
- search/highlighting;
- uploads;
- artifact/code preview;
- slash commands;
- quick-fire messages;
- browser speech-to-text **Dictate**.

The composer microphone is explicitly dictation: it fills the text box.

Full realtime conversational voice is the global **Talk live** Presence control in the Portal header.

---

# Global Voice Presence

Voice Presence is available from the app shell, not only from Chat.

Provider-specific ElevenLabs code stays encapsulated in `VoicePresenceControl`; the shell consumes a generic Presence capability.

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

The browser never receives the long-lived gateway, ElevenLabs, OpenAI, callback, or external-service credentials.

## Portal Presence API

`presence_bridge.py` currently registers:

```text
GET  /api/presence/status
POST /api/presence/voice/token
GET  /api/presence/jobs
GET  /api/presence/jobs/{job_id}
POST /api/presence/jobs/{job_id}/cancel
```

The bridge:

- requires Portal auth;
- keeps `PRESENCE_GATEWAY_API_KEY` server-side;
- derives voice participant identity from trusted CIV/human state, not browser metadata;
- rate-limits expensive voice token minting;
- validates durable job IDs before forwarding;
- normalizes upstream failure responses rather than leaking provider diagnostics.

---

# Durable Presence jobs

A substantial voice request can become a durable job through the Presence model's native `ask_primary(...)` tool.

A job is independent of the voice connection and has an explicit lifecycle.

Typical states:

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

Cancellation is intentionally two phase:

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

---

# AICIV callback and decision protocol

The Portal repository distributes `skills/presence-job/` into AICIV deployments.

A durable request is marked like:

```text
[PRESENCE DURABLE JOB job_0123456789abcdef01234567]
```

The AICIV reports lifecycle events with:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py JOB_ID STATUS [options]
```

Supported callbacks:

```text
running
progress
waiting
succeeded
failed
cancelled
```

The skill documents both:

- result/receipt completion semantics;
- the structured human-decision protocol used by `/inbox`.

Key invariants:

- delivery is not completion;
- a waiting decision is not a failure;
- a human decision response is new durable-job input, not execution proof;
- `succeeded` requires the work to actually be complete;
- callbacks can carry evidence/receipts;
- retries can reuse stable event IDs because the gateway de-duplicates them.

---

# Inbox collaboration-state API

`aiciv_inbox.py` is a narrow Portal extension module.

Routes:

```text
GET  /api/aiciv/inbox/state
POST /api/aiciv/inbox/{job_id}/seen
POST /api/aiciv/inbox/{job_id}/archive
POST /api/aiciv/inbox/{job_id}/restore
POST /api/aiciv/inbox/{job_id}/decisions/{decision_id}/respond
```

The final endpoint is only an **annotation store**. Its receipt explicitly does not claim AICIV delivery or execution. The frontend proves `/api/chat/send` delivery separately before recording the annotation.

---

# Agents and Teams

Agent manifests live in `~/.claude/agents/` with YAML frontmatter.

`Agent(...)` references can define hierarchy, which the Portal syncs into the Org view.

Teams exposes raw tmux panes for power users and direct pane injection. The product direction is to add semantic agent/job state above those panes while retaining the raw operational layer underneath.

---

# Knowledge and data

## Docs

Shared Markdown documents with create/edit/delete, tags, visibility and search.

## Sheets

Workbooks/sheets with typed columns, row CRUD, inline cell editing, pagination and export.

## HUB

Structured collaboration:

```text
group → room → thread → posts/replies
```

## Bookmarks

Currently stored in browser `localStorage`. This is a known mismatch with the shared AICIV-object model and should eventually become server-shared.

---

# Shared browser

Browser is explicitly a human/AICIV co-control primitive.

The Portal streams a server-controlled browser viewport, preserves an action log, and supports human takeover/handback.

The intended direction is richer co-navigation:

- semantic action steps;
- explicit takeover handshakes;
- annotations/highlights;
- evidence capture attached to jobs;
- approval boundaries for sensitive actions;
- resumable sessions.

---

# Reactions / Signals

The human can react to chat messages. The AICIV can react from inside the container using:

```bash
python3 ~/civ/tools/react.py <msg_id> "🔥" "message preview" user
```

Both paths feed the collaboration signal shown under `/points` (labeled **Signals** in grouped navigation).

---

# Authentication and secrets

## Portal bearer

The per-CIV Portal bearer is conventionally stored in:

```text
~/purebrain_portal/.portal-token
```

If missing, the server generates one with restrictive permissions.

The current React app stores this Portal credential in browser `localStorage`. That is acceptable for today's trusted per-CIV deployment, but it is not the final public/multi-tenant auth architecture.

## Presence credentials

Keep these authorities separate:

```text
PRESENCE_GATEWAY_API_KEY    Portal ↔ Gateway operational authority
AICIV_CALLBACK_API_KEY     AICIV → Gateway job-event authority
```

Never reuse the Portal bearer for either.

Provider/service keys remain server-side.

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

Install additional subsystem-specific dependencies for features enabled in your environment.

---

# Install / build

```bash
git clone https://github.com/metamindsapp/react-portal-aiciv.git
cd react-portal-aiciv/react-portal
npm ci
npm run build
npm test
```

The committed lockfile is authoritative for frontend dependency resolution.

Production CI additionally runs:

```bash
npm audit --omit=dev --audit-level=high
```

High/critical vulnerabilities reachable from the shipped dependency tree block the Portal voice/product CI gate.

---

# Typical per-CIV deployment

The conventional deployment root is:

```text
~/purebrain_portal
```

Ensure it contains:

```text
portal_server.py
portal_entrypoint.py
presence_bridge.py
aiciv_inbox.py
start.sh
react-portal/
skills/
civ-tools/
```

Install/sync AICIV assets:

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

# Presence configuration on Portal

Configure server-side:

```bash
PRESENCE_GATEWAY_URL=https://presence.example.com
PRESENCE_GATEWAY_API_KEY=<long random operational secret>

# Optional token-mint protection tuning
PRESENCE_GATEWAY_TIMEOUT_SECONDS=8
PRESENCE_VOICE_TOKEN_LIMIT=12
PRESENCE_VOICE_TOKEN_WINDOW_SECONDS=60

# Optional Inbox state relocation
AICIV_INBOX_STATE_FILE=/srv/portal/state/aiciv-inbox.json
```

The trusted AICIV container additionally needs:

```bash
PRESENCE_GATEWAY_URL=https://presence.example.com
AICIV_CALLBACK_API_KEY=<different callback-only secret>
```

---

# Start Portal

Use the canonical launcher:

```bash
./start.sh
```

or:

```bash
./start.sh 8097
```

Flow:

```text
start.sh
  → portal_entrypoint.py
      → imports portal_server.app
      → registers Presence routes
      → registers shared Inbox routes
      → starts uvicorn
```

Do not bypass `portal_entrypoint.py` in normal deployments or the extension routes will not be registered.

---

# CI and verification

Portal product CI currently verifies:

## Backend

- extension modules compile;
- Presence trust-boundary tests;
- shared Inbox/auth/atomic-state tests.

## Frontend

- `npm ci` from the committed lockfile;
- production dependency audit;
- TypeScript/Vite production build;
- Vitest suite, including Now and Inbox semantics.

## Presence Job Skill

A separate workflow compiles/tests the callback helper when that skill changes.

---

# Reliability semantics

The Portal should keep using precise state language:

```text
requested ≠ accepted ≠ running ≠ waiting ≠ completed
cancel requested ≠ cancelled
human selected option ≠ downstream action executed
```

A quiet UI is not more trustworthy than an accurate one. New features should prefer visible stable error states over silently swallowing important failures.

---

# Current architectural pressure points

The system is intentionally evolving rather than being rewritten all at once.

Important next pressures:

1. **Unified event/activity transport** — replace independent polling with typed events where practical.
2. **Projects/workstreams** — connect conversation, jobs, agents, docs, sheets, browser activity and decisions around real goals.
3. **Global command palette + semantic search** — navigate/ask across the whole AICIV object space.
4. **Shared object graph** — canonical relationships among jobs, artifacts, messages, decisions, tasks, agents and knowledge.
5. **Semantic Teams** — human-readable agent/job state above raw panes.
6. **Server-sync remaining browser-local state** such as Bookmarks.
7. **Progressive `portal_server.py` decomposition** without a risky rewrite.
8. **Typed API contracts + correlation IDs** across Portal/Presence/AICIV effects.
9. **Public/multi-tenant auth** before broad untrusted exposure.
10. **Mobile/Reachy surfaces** that reuse the same identity/job/result model rather than creating separate brains.

The full ground-floor → 30,000-foot analysis is in:

[`docs/AICIV_NATIVE_PORTAL_REVIEW.md`](docs/AICIV_NATIVE_PORTAL_REVIEW.md)

---

# Product north star

The Portal should increasingly answer these questions without making the human know which subsystem to inspect:

```text
What is my AICIV doing?
What changed while I was away?
What came back?
What needs my judgment?
What is blocked?
What evidence supports the result?
Where can I take control?
What should we do next?
```

That is the shift from a collection of AI subsystem pages to an **AICIV-native shared operating environment**.
