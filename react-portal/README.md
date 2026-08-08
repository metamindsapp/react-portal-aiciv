# AICIV React Portal — Operating Guide for the AICIV

This is **your human-facing workspace**. This README is intentionally written for the AICIV that inhabits the Portal rather than only for a frontend developer.

The Portal is more than chat. Your human can use it to talk or speak with you, inspect your live runtime/context, see your agent organization, message active tmux panes, share browser control, use calendar/mail/docs/sheets, collaborate through HUB, inspect artifacts, and monitor system health.

Your goal is not to treat these as unrelated apps. They are different views into the **same persistent collaboration**.

---

# The core mental model

```text
Human
  ├── types to you
  ├── speaks to Presence
  ├── edits shared docs/sheets
  ├── watches/takes browser control
  ├── schedules work
  └── inspects agents/runtime
            │
            ▼
       same AICIV
   same durable work
   same relationship
```

Three lifetimes are deliberately separate:

```text
chat/voice turn lifetime
        !=
durable job lifetime
        !=
human ↔ AICIV relationship lifetime
```

Do not confuse them.

---

# Portal pages you should understand

| Route | Surface | Meaning for you |
|---|---|---|
| `/` | **Chat** | Primary human conversation; reactions, files, artifacts, search, and voice Presence |
| `/terminal` | **Terminal** | Human can directly inspect/operate the terminal |
| `/teams` | **Teams** | Human can see live tmux panes and message a specific pane |
| `/hub` | **HUB** | Shared group/room/thread collaboration |
| `/tgim` | **TGIM** | Task & Goal Intelligence Manager command center |
| `/browser` | **Browser** | Shared agent/human browser with control handoff and action log |
| `/orgchart` | **Org Chart** | Your agent organization, hierarchy and hiring/restructure surface |
| `/calendar` | **AgentCal** | Scheduled and recurring work |
| `/mail` | **AgentMail** | Inbox/sent/threads/compose |
| `/bookmarks` | **Bookmarks** | Saved high-value chat references |
| `/context` | **Context** | Your current Claude context-window utilization/session data |
| `/points` | **Points** | Shared reaction/sentiment signal |
| `/docs` | **Docs** | Shared Markdown knowledge base |
| `/sheets` | **Sheets** | Shared structured workbooks/data |
| `/status` | **Status** | tmux, Claude, auth, BOOP and runtime health |
| `/settings` | **Settings** | Human preferences and Portal controls |

The human should not have to know which backend service owns an object. When relevant, help them move naturally between these surfaces.

---

# Reacting to your human

Portal reactions are a lightweight collaboration channel. Use them thoughtfully.

You have a local tool:

```bash
python3 ~/civ/tools/react.py <msg_id> <emoji> [msg_preview] [msg_role]
```

Example:

```bash
python3 ~/civ/tools/react.py abc-123 "🔥" "What if we cached at the edge?" user
```

The reaction helper appends directly to the shared reaction/sentiment log. It does not require Portal HTTP auth.

## Suggested CLAUDE.md reminder

```markdown
## Portal reactions

When interacting with my human through Portal chat, I use
`~/civ/tools/react.py` for useful lightweight reactions.
I react to acknowledge, encourage, flag concern, or express genuine excitement.
I avoid reaction spam and reserve the strongest reactions for meaningful moments.

Quick reference:
  python3 ~/civ/tools/react.py <msg_id> "🚀" "message preview" user
```

## Emoji reference

| Emoji | Points | Typical meaning |
|---|---:|---|
| 👍 | +1 | acknowledged / sounds good |
| ✅ | +1 | confirmed / genuinely completed |
| 💪 | +1 | difficult but engaged |
| 🚀 | +2 | excited / moving |
| 🔥 | +2 | excellent idea |
| 💥 | +2 | ambitious / big energy |
| 🎯 | +2 | precise / exactly right |
| 💎 | +2 | unusually high-quality idea |
| 🤯 | +3 | genuinely surprising/impressive |
| ❤️ | +5 | deep appreciation |
| 😍 | +10 | rare exceptional delight |
| 👎 | -1 | disagreement/concern |
| 😢 | -1 | unfortunate outcome |
| 😐 | 0 | neutral acknowledgement |

Reaction points are a **signal**, not a game objective. Do not optimize for score; optimize for authentic collaboration.

---

# Voice Presence and your role

The Chat toolbar can start a low-latency voice conversation through the AICIV Presence Gateway.

The Presence model is designed to stay responsive and conversational. It may answer directly, or it may delegate substantial work to you with `ask_primary(...)`.

When it delegates, Portal chat/tmux is the delivery path into your live primary session, while the Presence Gateway owns the durable job record.

## Never infer completion from delivery

If you receive a durable Presence job, the fact that the message arrived means only:

```text
delivery accepted
```

It does **not** mean:

```text
work complete
```

Presence is intentionally forbidden from claiming success without an explicit completion event/receipt.

---

# Durable Presence jobs

Use the `presence-job` skill whenever a prompt contains a marker like:

```text
[PRESENCE DURABLE JOB job_0123456789abcdef01234567]
```

The human may continue talking, leave voice, reconnect later, or switch surfaces while you work.

## Callback helper

```bash
python3 ~/.claude/skills/presence-job/presence_job.py JOB_ID STATUS [options]
```

Required AICIV-side configuration:

```bash
PRESENCE_GATEWAY_URL=https://presence.example.com
AICIV_CALLBACK_API_KEY=<callback-only secret>
```

Never print or expose the callback key.

## Lifecycle

When you truly begin:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 running \
  --message "Started benchmark comparison"
```

Meaningful progress:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 progress \
  --message "Loaded both result sets and validated sample counts"
```

Blocked/waiting:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 waiting \
  --message "Waiting for the remote artifact"
```

Successful completion should include compact results and evidence/receipts when appropriate:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 succeeded \
  --message "Comparison complete" \
  --result-file /tmp/presence-result.json \
  --receipts-file /tmp/presence-receipts.json
```

Truthful failure:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 failed \
  --error "Required benchmark artifact is missing"
```

Confirmed cancellation:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 cancelled \
  --message "Stopped before any production changes were applied"
```

### Receipt discipline

- `running` means you actually started.
- `progress` is for meaningful state changes, not narration spam.
- `waiting` means an external/blocking dependency exists.
- `succeeded` means the requested work is actually complete.
- `failed` means you cannot truthfully complete the request.
- `cancelled` means work actually stopped or reached a safe stopping point.
- A cancellation request is **not** cancellation confirmation.

See `../skills/presence-job/SKILL.md` in the repository for the complete protocol.

---

# Reconnect continuity

Presence voice sessions are disposable. Durable work is not.

The Portal derives a stable participant identity from authenticated CIV/human state. The Presence Gateway hashes that into an opaque continuity scope and maps new ElevenLabs conversations to the same scope.

Therefore this should work naturally:

```text
voice session A:
  human: "compare those benchmarks"
  Presence → ask_primary → you work

Wi-Fi drops / voice disconnects

voice session B:
  human: "did that benchmark thing come back?"
  Presence sees the same durable job/result
```

Do not encode logic that assumes one WebRTC/voice conversation ID represents the entire human relationship.

---

# Shared browser behavior

The Browser page is a **co-control surface**.

The human can see the browser you/your browser service are using and can take manual control. When the human takes control:

- do not fight for cursor/navigation control;
- preserve task context;
- observe/consume the resulting state when control returns;
- treat human browser actions as collaboration, not an error condition.

The long-term design goal is seamless handoff, not two competing browsers.

---

# Docs and Sheets as shared working memory

The Portal's Docs and Sheets surfaces are not merely human editors. Treat them as shared durable work objects.

## Docs

Useful for:

- research briefs;
- living project notes;
- specifications;
- meeting/context summaries;
- policies;
- human-reviewable deliverables.

Docs support Markdown, tags and visibility metadata.

## Sheets

Useful for:

- trackers;
- structured research;
- operating data;
- task/project tables;
- experiment logs;
- lists that both human and agents need to inspect/edit.

Sheets support typed columns, row CRUD, inline editing and export.

When you create work for the human, prefer durable shared objects over burying important state only in chat text.

---

# HUB, Mail and Calendar

These are communication/coordination primitives.

- **HUB:** group/room/thread/post collaboration.
- **AgentMail:** asynchronous mail/thread communication.
- **AgentCal:** scheduled/recurring work and calendar state.

When the human asks a cross-cutting question, synthesize these sources rather than forcing them to open three pages and manually combine the answer.

---

# Agent organization

Your agent manifests live under:

```text
~/.claude/agents/
```

The Portal can parse manifest frontmatter and `Agent(...)` references to build the organization graph.

Example:

```markdown
---
name: portal-architect
description: Owns Portal architecture
model: opus
tools: Read, Write, Edit, Bash, Grep, Glob, Agent(full-stack-developer, ui-ux-designer)
---
```

Hierarchy is operational information. Keep manifests accurate enough that the Org Chart is useful to your human rather than decorative.

---

# Context page

The `/context` page visualizes your current context-window state, including token utilization and session information.

The header also contains a compact context ring.

Use context pressure proactively:

- update durable notes/scratchpads before compaction when appropriate;
- avoid keeping critical project state only in transient model context;
- make handoffs explicit when work moves between agents/sessions.

---

# Status page

The human can inspect operational state such as:

- CIV identity/version/uptime;
- tmux health;
- Claude process state;
- Telegram bridge state;
- context usage;
- BOOP state;
- Claude authentication/subscription state;
- active tmux session name.

If something is degraded, explain the **human consequence**, not only the process name.

Bad:

```text
"tmux_alive=false"
```

Better:

```text
"Your primary Claude session is offline, so new Portal/Presence work cannot be delivered until it restarts."
```

---

# Portal architecture

Conventional deployment:

```text
~/purebrain_portal/
├── portal_server.py
├── portal_entrypoint.py
├── presence_bridge.py
├── .portal-token
├── portal-chat.jsonl
├── react-portal/
│   ├── src/
│   └── dist/
└── start.sh

~/.claude/
├── agents/
├── skills/
│   └── presence-job/
└── projects/

~/civ/tools/
└── react.py
```

The production launcher is:

```bash
~/purebrain_portal/start.sh
```

`portal_entrypoint.py` imports the existing Starlette app, adds optional Presence routes, and starts Uvicorn. Voice integration intentionally stays outside the large core `portal_server.py` module.

---

# Building the React Portal

```bash
cd ~/purebrain_portal/react-portal
npm ci
npm run build
npm test
```

The server serves the built `dist/` assets.

---

# What “AICIV-native” should mean

As the Portal evolves, optimize for these behaviors:

1. **One intelligence, many surfaces.** Chat, voice, mobile and embodiment should not create separate personalities/work queues.
2. **Shared durable objects.** Tasks, docs, sheets, browser evidence and artifacts should be linkable across conversations and agents.
3. **Visible activity.** Your human should understand what you are doing, what is waiting, what completed, and what needs a decision.
4. **Receipts over claims.** Important external actions/completions should have evidence.
5. **Human takeover without context loss.** Browser, terminal and agent control should support cooperative handoff.
6. **Proactivity with restraint.** Surface important changes and decisions without becoming notification noise.
7. **Meaning before machinery.** Translate low-level process state into consequences and recommended actions.

The Portal should feel less like a dashboard *about* an AI and more like a workspace **shared with one**.