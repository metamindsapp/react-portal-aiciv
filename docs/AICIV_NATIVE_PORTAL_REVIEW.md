# AICIV-Native Portal Review

## Purpose

This document reviews the current AICIV React Portal from four levels at once:

1. **30,000 ft — product thesis and information architecture**
2. **10,000 ft — workflows, shared objects and AICIV-native interaction model**
3. **1,000 ft — individual surfaces and UX behavior**
4. **ground floor — frontend/backend code architecture, reliability, security and performance**

The Portal is already unusually capable. The next step is not simply adding more features. It is making the existing capabilities feel like **one persistent intelligence inhabiting one coherent workspace with its human**.

---

# Executive thesis

The current Portal is best described as a **powerful collection of AICIV subsystem interfaces**:

- Chat
- Voice Presence
- Terminal
- Teams/tmux panes
- HUB
- TGIM
- Shared Browser
- Org Chart
- Calendar
- Mail
- Bookmarks
- Context
- Points/reactions
- Docs
- Sheets
- Status
- Settings

That breadth is a major asset.

The main product problem is that the interface still makes the human **assemble the intelligence themselves**. Important state is distributed among pages, server stores, localStorage and polling loops. A person often has to know which subsystem contains the answer before they can find it.

An AICIV-native interface should reverse that relationship:

> The human should express intent, inspect activity/evidence and take control when useful. The system should synthesize the underlying services into one understandable collaboration state.

The desired transition is:

```text
collection of AI admin pages
          ↓
AICIV cockpit / shared workspace
          ↓
ambient operating environment for a persistent intelligence
```

---

# What should be preserved

Before redesigning anything, protect the parts that are already strategically correct.

## 1. Portal as local AICIV control-plane adapter

Portal knows the local runtime: identity, tmux, Claude, files, agents and per-CIV services. Keep those details here rather than leaking them into every client.

## 2. Presence separated from durable cognition

The new voice architecture is correct: realtime Presence handles low-latency conversation while substantial work moves to durable primary cognition.

Do not collapse those lifetimes just to simplify UI code.

## 3. Human/agent browser co-control

The shared Browser is a very AICIV-native primitive. Continue developing cooperative takeover rather than replacing it with an ordinary embedded browser.

## 4. Shared durable work surfaces

Docs, Sheets, Calendar and HUB are strong foundations for shared human/AICIV objects.

## 5. Explicit operational visibility

Terminal, Teams, Context and Status are valuable for power users and debugging. Hide machinery progressively when appropriate, but do not remove inspectability.

## 6. Narrow integration seams

The Presence bridge lives outside the large Portal server monolith. Preserve this pattern for new domains.

---

# 30,000-ft product model

## The Portal should answer five human questions

At any moment the human should be able to answer:

1. **What is my AICIV doing right now?**
2. **What changed since I last looked?**
3. **What needs my attention or decision?**
4. **What do we know / what have we produced?**
5. **How do I tell it what I want next?**

The current Portal answers pieces of all five, but across many surfaces.

The new shell should make these questions first-class.

---

# Recommended primary information architecture

Instead of 16 equal top-level destinations, organize around intent.

## 1. Home / Now

The default landing page should become an AICIV **Now** dashboard rather than a blank Chat-first shell.

It should contain:

- AICIV presence/availability;
- “what I am doing now” summary;
- active durable jobs;
- agents currently working;
- completed work since last visit;
- waiting/blockers;
- decisions/approvals needed;
- upcoming calendar items;
- unread important mail/HUB mentions;
- context pressure/health only when actionable;
- recommended next actions;
- one obvious conversational composer.

This is the synthesis layer the current system lacks.

## 2. Conversation

Includes:

- typed Chat;
- full voice Presence;
- conversation history/search;
- bookmarks/saved memories;
- result resurfacing;
- message-linked artifacts.

## 3. Work

Includes:

- durable Presence jobs;
- TGIM/goals;
- calendar/tasks;
- agents/teams;
- current workstreams;
- approvals/decisions;
- activity timeline.

## 4. Knowledge

Includes:

- Docs;
- Sheets;
- artifacts/deliverables;
- bookmarks/memories;
- semantic search;
- evidence/receipts.

## 5. Control

Includes:

- shared Browser;
- Terminal;
- raw Teams/tmux panes;
- Org Chart;
- advanced agent controls.

## 6. System

Progressively disclosed:

- Status;
- Context;
- settings;
- credentials/integrations;
- diagnostics;
- usage/cost;
- release information.

HUB/Mail can be exposed as communication objects inside Home/Work and retain dedicated detail surfaces under a secondary navigation.

---

# The AICIV should be globally present, not trapped in Chat

Today full conversational Presence is a control rendered inside the Chat route.

Recommendation: turn Presence into a **global shell capability**.

A user reading a Doc, looking at a Sheet, watching the Browser or inspecting an agent should be able to say:

```text
“Explain this row.”
“Send this to Morgan.”
“Why did that browser action fail?”
“Have the research agent verify this paragraph.”
“Schedule the follow-up for Tuesday.”
```

without first navigating back to Chat and manually describing what “this” means.

## Proposed global Presence bar

A compact persistent control in the app shell:

```text
● Synth  Listening…                    [mute] [voice] [type]
```

or when idle:

```text
Ask Synth anything…                                   🎙
```

The shell supplies **current surface context** as structured references, not by dumping the whole DOM into the model.

Example contextual envelope:

```json
{
  "surface": "docs",
  "object": {
    "type": "doc",
    "id": "doc_123",
    "title": "Presence Architecture"
  },
  "selection": {
    "kind": "text",
    "range": "paragraph-12"
  }
}
```

This is dramatically more useful than a Chat-only assistant.

---

# Build one shared AICIV object graph

The largest structural product upgrade is to stop treating each page's entities as unrelated.

Define canonical object references for:

```text
conversation
message
job
task / goal
agent
team
doc
sheet / row
artifact
receipt
browser session / evidence
calendar event
mail thread
HUB thread/post
bookmark / memory
```

Every object should have:

- stable ID;
- type;
- title/summary;
- creator/owner;
- timestamps;
- related objects;
- optional project/workstream;
- canonical Portal URL;
- permission/visibility metadata;
- activity/events;
- provenance/receipts where relevant.

Then the human and AICIV can speak in references:

```text
“Use #doc:presence-architecture and #sheet:latency-evals to update #job:voice-benchmark.”
```

The UI can render those as rich chips rather than text blobs.

This object graph becomes the foundation for search, memory, activity, proactive suggestions and multi-device handoff.

---

# Add Projects / Workstreams

The Portal currently has many objects but little shared grouping above them.

Introduce a **Project / Workstream** entity that can contain:

- goal/context;
- active jobs;
- relevant agents;
- docs;
- sheets;
- browser sessions;
- mail/HUB threads;
- calendar events;
- decisions;
- recent activity;
- outputs/receipts.

A project page should look like a living collaboration room rather than a folder.

Example:

```text
Presence Product
├── Goal: production-quality AICIV voice
├── Active: latency eval / Reachy client prototype
├── Waiting: ElevenLabs production credentials
├── Decisions: default voice; provider fallback policy
├── People/Agents: Corey / Synth / voice-eval / portal-engineer
├── Knowledge: Architecture.md / eval sheet
├── Recent outputs: PR #4 / benchmark report
└── Timeline
```

This lets the AICIV maintain context over time without depending on one giant chat thread.

---

# Add a first-class Activity / Event model

The system already generates meaningful events, but they are fragmented.

Create a shared event stream with event families such as:

```text
job.created
job.running
job.waiting
job.succeeded
job.failed
job.cancel_requested
job.cancelled
agent.started
agent.completed
artifact.created
browser.action
browser.handoff
calendar.created
mail.received
hub.mentioned
doc.updated
sheet.updated
system.warning
context.high
presence.connected
presence.disconnected
```

The UI can consume the same stream for:

- Home/Now;
- notifications;
- project timeline;
- activity drawer;
- audit/history;
- mobile push;
- proactive Presence resurfacing.

This is preferable to every page inventing its own polling/status semantics.

---

# Add a Decision / Approval Inbox

AICIVs become more useful when they can work autonomously **until human judgment is actually needed**.

Create a first-class decision object:

```json
{
  "id": "decision_...",
  "title": "Choose production voice",
  "why_now": "Blind eval complete",
  "recommended": "Voice B",
  "options": ["Voice A", "Voice B", "rerun"],
  "evidence": ["artifact_...", "sheet_..."],
  "blocking_jobs": ["job_..."],
  "urgency": "normal"
}
```

Home should show these prominently.

The AICIV can then say:

> “I finished the evaluation. I recommend B. I need your approval before switching production.”

This is far more AICIV-native than burying the same request in a chat paragraph.

---

# Add a durable Result Inbox

Presence now supports jobs that outlive voice, but Portal needs a human-facing durable return channel.

Recommended Result Inbox states:

```text
new
seen
acknowledged
needs_followup
archived
```

Each result should show:

- original request;
- concise result;
- job lifecycle;
- evidence/receipts;
- related objects;
- “ask about this”;
- “continue work”;
- “turn into doc/task/project”;
- “archive.”

Completed jobs should also surface contextually in Chat/voice once, not repeatedly.

---

# Global Command Palette / Omnibox

The Portal already has slash commands inside Chat. Generalize the concept to the whole workspace.

Keyboard:

```text
Cmd/Ctrl + K
```

Examples:

```text
> ask Synth …
> open Presence project
> search all knowledge for latency
> create task Tuesday 9am
> message agent qa-engineer …
> open browser
> start voice
> show running jobs
> inspect system health
```

Results can mix:

- commands;
- objects;
- people/agents;
- recent pages;
- semantic search;
- recommended actions.

This reduces dependence on a deep sidebar and makes the system feel agentic.

---

# Search should become global and semantic

Current search is mostly surface-local (for example Chat and Docs).

Build one search experience over:

- conversations;
- docs;
- sheets/rows;
- jobs;
- tasks;
- receipts/artifacts;
- mail;
- HUB;
- agents;
- browser evidence;
- bookmarks.

Offer filters but do not require the user to choose a subsystem before searching.

Longer-term, combine lexical and embedding/semantic retrieval and allow:

```text
“Where did we decide not to make Reachy its own brain?”
```

The answer should return the conversation/doc/decision objects that support it.

---

# Surface-by-surface recommendations

## Chat

### High priority

1. **Resolve the two-microphone problem.**
   - Current composer mic = browser speech-to-text dictation.
   - Current header Voice = full conversational Presence.
   - Rename/re-icon them explicitly, e.g. `Dictate` vs `Talk live`, or remove dictation if Presence supersedes it.

2. **Add durable job cards inline.**

Instead of only textual handoff acknowledgement:

```text
Research competitor pricing
● Running · 2m
[Open job] [Cancel]
```

When complete:

```text
✓ Complete
Summary: …
Receipts: report.md · 3 sources
[Open result] [Continue]
```

3. **Render object references richly.**
   Docs, sheets, jobs, agents, files and browser evidence should be interactive cards/chips.

4. **Server-sync reactions and bookmarks.**
   Bookmarks are currently localStorage. They should become shared durable objects visible to the AICIV and other devices.

5. **Expose connection state accurately.**
   Chat store should reflect actual WebSocket `onopen/onclose`, not assume connected immediately after invoking `connect()`.

6. **Show send/delivery failures.**
   Avoid console-only or swallowed errors for user actions.

### Medium priority

7. Thread/branch conversations around projects/results instead of one effectively endless chronological stream.
8. Virtualize long histories.
9. Add jump-to-latest/new-message affordance when auto-scroll is disabled.
10. Add message actions: convert to task, save to doc, delegate, quote in project.

---

## Voice Presence

1. Make Presence global across all routes.
2. Add a compact transcript/history drawer during live voice.
3. Show when Presence delegated versus answered itself.
4. Surface active durable jobs without reading opaque IDs aloud.
5. Add device/audio controls and graceful reconnect UI.
6. Show privacy state clearly: microphone live/muted/provider connection.
7. Add optional push-to-talk / hands-free modes.
8. Eventually let the user hand a current object/selection into voice context explicitly.

---

## Home / Now (new)

This should be the highest-value new surface.

Sections:

```text
Now              what Synth is doing
Needs you         decisions / blockers
Completed         results since last visit
Upcoming          calendar / scheduled work
People/Agents     active teams
Messages          important mail/HUB
Health            only actionable warnings
Ask Synth         universal composer / voice
```

Avoid dashboard-card overload. Use a narrative priority hierarchy.

---

## Teams

Current Teams is a useful raw tmux pane monitor, but it exposes implementation rather than meaning.

Add a semantic layer above panes:

```text
Agent / role
Current goal
State: working / waiting / done / blocked
Elapsed
Last meaningful action
Output/result link
Parent job/project
Needs human? yes/no
```

Keep raw terminal output expandable for debugging.

---

## Org Chart

Move from static hierarchy to operational organization:

- capacity/availability;
- active assignments;
- recent outcomes;
- capability tags;
- success/quality metrics;
- delegation graph;
- agent memory/context health;
- cost/model;
- hire/restructure proposals with preview/diff;
- “why does this agent exist?” explanation.

Let the human drag/drop only if the underlying manifest/organization update can be represented safely and receipt-backed.

---

## Browser

The co-control primitive is excellent. Enrich it with:

- explicit takeover handshake;
- keyboard input and form control if not already supported by backend;
- action receipts;
- screenshot/evidence capture linked to jobs;
- annotations (“look here”);
- visual pointer showing agent intent before high-impact clicks;
- approvals for sensitive actions;
- browser session attached to project/job;
- resumable browser state;
- per-action provenance in the activity timeline.

Most importantly, translate low-level logs into meaningful steps:

```text
Opened vendor pricing
Compared Team vs Enterprise
Downloaded pricing PDF
Waiting for you before submitting contact form
```

while retaining the raw log underneath.

---

## Docs

The current knowledge base is a solid start.

Add:

- “Ask AICIV about this doc”;
- inline selection actions;
- citations/backlinks from conversations/jobs;
- version history/diff;
- comments/review requests;
- generated summaries;
- semantic related-doc suggestions;
- project membership;
- artifact/receipt linkage;
- presence indicators if human + AICIV edit concurrently.

Replace plain textareas with an editor only when there is a clear need; do not lose Markdown portability.

---

## Sheets

Add AICIV-native operations:

- “analyze this sheet”;
- “fill missing values” with preview;
- formula/computed-column support;
- bulk edit with diff/approval;
- filters/sorts/views;
- chart generation;
- row-level provenance;
- attach a row to a job/task;
- agent writes visible as activity events;
- optimistic concurrency/version checks.

For AI writes, show a proposed change set before applying destructive/bulk mutations when appropriate.

---

## Calendar

Unify scheduled events and autonomous work.

A calendar item should be able to show:

- what will trigger;
- which AICIV/agent owns it;
- current status;
- associated project;
- recurrence;
- last run outcome;
- next run;
- result history;
- pause/resume;
- whether it requires the human to be online.

Scheduled tasks should not feel like a separate calendar product bolted onto the AI.

---

## Mail + HUB

Add synthesized communication triage:

- important/unread summary;
- AICIV-recommended replies;
- “needs decision” extraction;
- link messages/threads to projects/tasks;
- summarize long threads;
- create job from thread;
- cross-channel person/entity identity.

Home should surface only important communication rather than forcing inbox checking.

---

## Bookmarks / memory

Current browser-local bookmarks should evolve into **shared saved context**.

Add types:

```text
bookmark
memory candidate
reference
quote
decision
important result
```

Let the human say:

```text
“remember this for the Presence project”
```

and create a durable shared object with project/context metadata.

---

## Context

Keep the raw context gauge but add consequences:

```text
Context 72% — healthy
```

or:

```text
Context 89% — compaction likely soon
Synth saved project state 4m ago
[view handoff note]
```

The human generally cares about continuity risk, not token accounting by itself.

---

## Status

Move low-level health into a secondary diagnostic surface.

Create a shared health model that turns processes into capabilities:

```text
Conversation: available
Durable work: available
Browser: degraded
Mail: available
Voice: not configured
Primary AICIV: online
```

Every red state should answer:

- what is broken;
- what human capability is affected;
- whether work is at risk;
- recommended recovery action.

---

## Settings

Current Settings is intentionally small. Expand around meaningful AICIV configuration:

### Identity / relationship
- AICIV name/avatar;
- human preferred name;
- timezone;
- communication preferences;
- proactive notification level.

### Voice
- voice selection;
- speaking pace/style;
- hands-free/push-to-talk;
- interruption sensitivity if provider supports it;
- device selection;
- voice/provider health.

### Autonomy / permissions
- what may happen without approval;
- browser side effects;
- external messages;
- purchases/spend thresholds;
- file/system changes;
- scheduled autonomous work.

### Integrations
- AgentCal;
- AgentMail;
- AgentSheets;
- HUB;
- Presence;
- browser;
- future external tools.

Show capability status without exposing raw secrets.

---

# Ground-floor frontend recommendations

## 1. Separate server state from UI state

Zustand is useful for UI/local state, but much current server state is manually fetched/polled inside views/stores.

Adopt a consistent server-state layer—TanStack Query is one reasonable choice—or build an equivalent internal abstraction.

Benefits:

- caching;
- invalidation;
- retries/backoff;
- stale/fresh semantics;
- request dedupe;
- consistent loading/error states;
- less hand-written polling.

Keep Zustand for truly client-side state such as shell UI, composer state and temporary selection.

## 2. Introduce a shared realtime event bus

Do not add another polling interval every time a feature needs live status.

Create one authenticated event channel (WebSocket or SSE depending on directionality) carrying typed events.

Current polling examples already include:

- header context;
- global identity/status;
- status dashboard;
- teams panes.

A shared event bus will improve both coherence and backend load.

## 3. Make WebSocket connection state authoritative

`chatStore` currently sets `wsConnected` after calling `connect()` rather than subscribing to actual socket lifecycle.

Expose connection events from `ChatWebSocket` and update state on real `open`, `close`, retry and auth failure.

## 4. Centralize errors / toasts / recovery

There are many `catch {}` / console-only paths.

Introduce a common error model:

```ts
interface AppError {
  code: string
  message: string
  retryable: boolean
  source?: string
  correlationId?: string
}
```

Provide:

- non-blocking toast for transient failures;
- inline error for object-specific failures;
- retry action;
- diagnostic detail expandable for power users.

Never make the UI appear successful after a failed side effect.

## 5. Route-level code splitting

`App.tsx` eagerly imports nearly every surface. Voice is already lazy-loaded successfully.

Apply `lazy()`/route-level chunking to heavy pages such as:

- Org Chart;
- Browser;
- Sheets;
- Docs;
- HUB;
- Terminal;
- TGIM.

This improves initial Chat/Home startup and mobile performance.

## 6. Establish a shared component library

The CSS token system is a good foundation.

Formalize shared components:

```text
Button
IconButton
Badge
StatusIndicator
Card
Panel
Drawer
Tabs
CommandPalette
ObjectChip
ActivityItem
JobCard
DecisionCard
Toast
FormField
EmptyState
ErrorState
Skeleton
```

This reduces page-specific CSS drift.

## 7. Replace emoji navigation icons with a coherent icon system

Emoji are expressive but vary across OS/browser and make hierarchy feel less deliberate.

Keep emoji for reactions/personality. Use a consistent vector icon family for primary navigation/status/action affordances.

## 8. Accessibility pass

Priorities:

- visible keyboard focus (`:focus-visible`), not only border changes on form controls;
- keyboard-accessible message actions currently revealed on hover;
- labels/tooltips that do not rely on emoji meaning;
- color-contrast audit in both themes;
- reduced-motion coverage globally;
- screen-reader announcement discipline for streaming chat/voice;
- modal focus trapping;
- mobile target sizing.

## 9. Optimistic updates only with receipt-aware rollback

Use optimistic UI for low-risk actions such as bookmarking/reaction when server-backed, but surface failure and roll back.

For high-impact AI actions, prefer explicit accepted/running/completed states.

## 10. Create a typed capability manifest

The shell should know what this CIV can actually do:

```json
{
  "voice": true,
  "browser": true,
  "agentMail": true,
  "agentCal": true,
  "agentSheets": false,
  "hub": true
}
```

Use it to:

- hide/disable unavailable navigation;
- explain setup requirements;
- populate command palette;
- expose capabilities to the AICIV UI layer.

Do not show 16 identical destinations when half are unconfigured.

---

# Ground-floor backend recommendations

## 1. Decompose `portal_server.py` by domain

The core file now owns many unrelated domains: chat/auth, tmux/context, referrals/payments/admin, BOOP, agents, calendar, sheets, mail, docs, HUB, browser and more.

Do not rewrite it all at once.

Use incremental extraction:

```text
portal/
├── app.py
├── auth.py
├── config.py
├── domains/
│   ├── chat/routes.py
│   ├── agents/routes.py
│   ├── calendar/routes.py
│   ├── mail/routes.py
│   ├── docs/routes.py
│   ├── sheets/routes.py
│   ├── hub/routes.py
│   ├── browser/routes.py
│   ├── admin/routes.py
│   └── presence/routes.py
└── services/
    ├── tmux.py
    ├── claude.py
    ├── identity.py
    └── event_bus.py
```

Extract only when touching a domain for meaningful work. Preserve tests/behavior.

## 2. Separate product Portal from admin/affiliate concerns

Affiliate/payments/admin/client-management routes share the same large server process today.

At minimum isolate them into separate modules and permissions. Long-term, consider whether they belong in the per-CIV Portal process at all.

This reduces security blast radius and cognitive load.

## 3. Normalize external-service error boundaries

Some backend proxy routes return upstream body text or raw exception strings.

Adopt stable client errors:

```json
{
  "error": "hub_unavailable",
  "correlation_id": "...",
  "retryable": true
}
```

Keep provider internals in server logs, not reflected to the browser by default.

The Presence bridge already follows this pattern and is a good precedent.

## 4. Shared schemas / generated contracts

Frontend/backend interfaces are currently handwritten independently.

Move toward one authoritative API schema:

- OpenAPI;
- JSON Schema;
- Pydantic/dataclass models with generation;
- another typed contract system.

Generate or validate TypeScript response/request types where practical.

This matters increasingly as jobs, activity events and shared objects become richer.

## 5. Unified app event service

The backend should emit typed events for important state changes rather than force each feature to poll local/external state.

This can begin in-process and later move behind a broker if scale requires it.

## 6. Stable correlation IDs

Carry correlation IDs through:

```text
human action
→ Portal request
→ Presence/tool
→ AICIV job
→ agent/browser/external action
→ result/receipt
```

Show them only in advanced diagnostics, but log them everywhere.

## 7. Structured audit log

For important side effects, record:

- actor (human/AICIV/agent);
- capability/tool;
- target object;
- request;
- approval if required;
- result;
- receipt;
- timestamp;
- correlation ID.

This is valuable for trust, debugging and future enterprise clients.

---

# Authentication / security roadmap

## Current model

The per-CIV Portal uses a bearer token stored in browser localStorage. WebSockets carry the bearer in the query string.

That is understandable for the current trusted per-CIV deployment but should not be the final public identity model.

## Recommended migration

1. Exchange magic/bootstrap bearer for a short-lived HttpOnly Secure SameSite session cookie.
2. Add CSRF protection where needed for cookie-authenticated mutations.
3. Use server-side session/device records and revocation.
4. Introduce user/tenant/AICIV identity rather than one bearer == one entire Portal.
5. Authenticate WebSockets with the session/cookie or short-lived WS token rather than a long-lived bearer query parameter.
6. Add explicit capability/approval policy for sensitive AI actions.

Do not block current product development on a giant auth rewrite; migrate before broad untrusted/public client exposure.

---

# Reliability and performance

## Replace silent failure with degraded states

A persistent AI interface must distinguish:

```text
not configured
connecting
degraded
offline
retrying
blocked
auth expired
```

rather than defaulting to empty data.

## Add skeletons and stale-data indicators

When cached data exists but refresh fails, prefer:

```text
Last updated 42s ago · reconnecting
```

over wiping the surface or silently freezing it.

## Route/code splitting

Keep initial shell + Home/Conversation light. Lazy load specialist surfaces.

## Virtualization

Apply to:

- long chat histories;
- large docs lists;
- large sheets/tables;
- activity timelines;
- mail/HUB threads when needed.

## Rate and load awareness

Teams polling every few seconds and multiple status/context loops are acceptable at small scale but should converge into shared realtime/cache infrastructure before fleet-scale rollout.

---

# Design system / visual experience

The current token file provides a healthy base: dark/light themes, semantic status colors, spacing, radii and typography.

Recommended evolution:

## 1. Calm default, intense on demand

The AI should feel alive without making every surface neon/animated.

Use motion/glow for:

- live voice;
- active work;
- handoff;
- completion;
- urgent attention.

Keep ordinary reading/work surfaces calm.

## 2. Visualize agency

Develop a small shared visual language:

```text
● present/available
◌ thinking
↗ delegated
⚙ working
⏸ waiting
✓ receipt-backed complete
! needs human
```

Do not rely on color alone.

## 3. Persistent identity

The header should communicate:

- who the AICIV is;
- current availability/activity;
- voice state;
- whether something needs the human.

“Active” alone is too coarse.

## 4. Progressive disclosure

Most users should see semantic summaries. Power users can expand raw process IDs, logs, tmux output and provider diagnostics.

---

# Mobile and ambient use

Static bottom nav is a good start, but the mobile product should optimize for **quick collaboration**, not desktop parity.

Primary mobile actions should be dynamic/contextual:

- Talk;
- Ask/type;
- Needs You;
- Results;
- Now.

Calendar/Mail/Terminal can remain reachable but should not necessarily occupy permanent primary slots for every user.

Add:

- push result notifications;
- actionable approval cards;
- voice-first resume;
- handoff from phone to Portal/Reachy;
- offline/reconnect state;
- mobile share sheet into AICIV projects/docs.

---

# Reachy / embodiment implications

The Portal should become the best place to **see and configure embodiment state**, while Reachy uses the same Presence/durable cognition backend.

Potential Portal embodiment surface:

- Reachy connected/offline;
- camera/sensor snapshot;
- attended speaker;
- current behavior/motion intent;
- microphone/audio health;
- manual teleop/takeover;
- safety state;
- recent physical actions and receipts;
- “send this conversation to Reachy” / “continue on Reachy.”

Do not expose raw servo control as a general language-model tool.

---

# Recommended implementation order

## Phase A — Coherence / trust (highest ROI)

1. Add Home / Now synthesis surface.
2. Add durable Job/Result cards and Result Inbox.
3. Add global error/toast/retry model; eliminate important silent failures.
4. Make WebSocket state authoritative.
5. Server-sync bookmarks/reactions.
6. Resolve duplicate mic semantics.
7. Add capability manifest and hide unavailable features.
8. Group sidebar/mobile navigation by intent.

## Phase B — AICIV-native shell

9. Global Presence/Ask bar across all routes.
10. Global command palette.
11. Shared object references/deep links.
12. Project/Workstream object.
13. Unified activity/event stream.
14. Decision/approval inbox.
15. Global semantic search.

## Phase C — Code architecture

16. Introduce consistent server-state/query layer.
17. Route-level lazy loading.
18. Extract Portal server domains incrementally.
19. Typed API schemas/contracts.
20. Structured audit/correlation system.
21. Migrate long-lived browser bearer toward real sessions.

## Phase D — Rich collaboration

22. AI-native Docs/Sheets actions and provenance.
23. Semantic Teams/Org activity above raw tmux.
24. Browser evidence, annotations, approvals and resumable sessions.
25. Cross-channel Mail/HUB triage.
26. Calendar/job/result unification.
27. Multi-device result notifications/handoff.

## Phase E — Embodiment / fleet

28. Reachy control/observation surface.
29. Tenant identity/capability policy.
30. fleet-wide health/usage/cost.
31. distributed events/storage only when required by deployment scale.

---

# Top 10 highest-value recommendations

If only ten things are funded, do these:

1. **Home / Now:** one synthesized view of what the AICIV is doing, what changed and what needs the human.
2. **Durable Result Inbox:** make long-running autonomous work visibly return to the human.
3. **Global Presence:** talk/ask from every surface with structured current-object context.
4. **Projects/Workstreams:** give conversations, jobs, agents, docs, sheets and artifacts a shared home.
5. **Unified Activity Event Stream:** one source of truth for work/status/notifications instead of fragmented polling.
6. **Decision/Approval Inbox:** make human judgment a first-class object rather than a buried chat request.
7. **Shared object graph + global search:** connect everything and make it retrievable by meaning.
8. **Trust UX:** explicit accepted/running/waiting/complete/failed states, receipts, errors and retry.
9. **Intent-based navigation + command palette:** stop making users think in backend subsystem names.
10. **Incremental backend modularization + typed contracts:** make the codebase able to support the richer product without turning `portal_server.py` into the whole company.

---

# North-star experience

A strong AICIV-native session should feel like this:

```text
Human opens Portal.

Synth: “Morning. I finished two things overnight. The voice reconnect test passed;
       the vendor comparison needs your decision. Dana sent one message that affects launch.”

[Review 2 results] [Make decision] [Talk to Synth]

Human opens the voice project.
They see active agents, the benchmark sheet, design doc, browser evidence and timeline.

Human: “Why do you prefer provider B?”

Synth answers using the current project objects without the human re-explaining context.

Human: “Okay, switch the test environment, but not production.”

A permission-aware action/job is created.
The UI shows accepted → running → verified complete with receipts.

The human leaves the laptop.
Later on the phone:

Synth: “The test environment switch passed. Want me to run the 20-minute soak?”

Same AICIV. Same work. Same objects. Same relationship.
```

That is the direction in which the existing Portal primitives become much more than a dashboard.