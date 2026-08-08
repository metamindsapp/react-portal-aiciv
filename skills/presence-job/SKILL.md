---
name: presence-job
description: Report lifecycle events, human decision boundaries, and receipts for durable jobs delegated by an AICIV Presence/voice agent.
---

# Presence Job

Use this skill whenever a prompt contains a marker like:

```text
[PRESENCE DURABLE JOB job_...]
```

A Presence job is **not tied to the live voice turn**. The human may keep talking, switch surfaces, or disconnect while you work. Your responsibility is to perform the delegated work normally and report truthful lifecycle events back to Presence.

## Non-negotiable receipt rule

**Never report `succeeded` merely because you accepted, attempted, or mostly completed the task.**

`succeeded` means the requested work is actually complete. Include evidence/receipts appropriate to the job: file paths, commit SHAs, URLs, test results, query outputs, artifact identifiers, or other verifiable provenance.

Likewise, if Presence asks for cancellation, do not report `cancelled` until the work has actually stopped or reached a safe stopping point.

A human selecting an option in the Portal Decision Inbox is also **not** proof that the resulting action completed. Treat that response as new input, continue the durable job, and later report the actual outcome with receipts.

## Callback tool

The helper is installed with this skill:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py JOB_ID STATUS [options]
```

The container must have these values in environment or `~/.env`:

```bash
PRESENCE_GATEWAY_URL=https://presence.example.com
AICIV_CALLBACK_API_KEY=<callback-only secret>
```

Do not print, echo, paste, or include `AICIV_CALLBACK_API_KEY` in artifacts or chat messages.

## Lifecycle

### 1. Start

As soon as you genuinely begin the work:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 running \
  --message "Started benchmark comparison"
```

### 2. Progress

Use sparingly for meaningful state changes, not narration spam:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 progress \
  --message "Loaded both benchmark result sets; comparing batching deltas"
```

### 3. Wait for an external dependency

If blocked on something outside the human's judgment:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 waiting \
  --message "Waiting for the remote benchmark artifact to finish uploading"
```

Do not manufacture a decision object for ordinary waiting. The Portal will show a generic waiting item.

## Human decision boundary — structured protocol

When you have done the work that can be done autonomously and **a genuine human choice is now required**, report `waiting` with a structured decision object in `result`.

Use this shape:

```json
{
  "decision": {
    "id": "dec_provider_choice",
    "question": "Which provider should we use for the next client cohort?",
    "context": "Provider B won latency and interruption tests; Provider A has the stronger existing enterprise agreement.",
    "recommendation": "Use Provider B for the next controlled cohort and keep Provider A as fallback.",
    "risk": "Provider B has less production history in our stack, so the rollout should remain reversible.",
    "options": [
      {
        "id": "provider_b",
        "label": "Use Provider B",
        "description": "Run the next cohort on B with A as fallback."
      },
      {
        "id": "provider_a",
        "label": "Stay on Provider A",
        "description": "Prefer operational history over the latency win."
      },
      {
        "id": "more_testing",
        "label": "Run more testing",
        "description": "Do not choose yet; expand the eval first."
      }
    ],
    "allowFreeform": true
  }
}
```

Then send it:

```bash
cat > /tmp/presence-decision.json <<'JSON'
{
  "decision": {
    "id": "dec_provider_choice",
    "question": "Which provider should we use for the next client cohort?",
    "context": "Provider B won latency and interruption tests; Provider A has the stronger existing enterprise agreement.",
    "recommendation": "Use Provider B for the next controlled cohort and keep Provider A as fallback.",
    "risk": "Provider B has less production history in our stack, so the rollout should remain reversible.",
    "options": [
      {"id": "provider_b", "label": "Use Provider B", "description": "Run the next cohort on B with A as fallback."},
      {"id": "provider_a", "label": "Stay on Provider A", "description": "Prefer operational history over the latency win."},
      {"id": "more_testing", "label": "Run more testing", "description": "Expand the eval before choosing."}
    ],
    "allowFreeform": true
  }
}
JSON

python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 waiting \
  --message "The eval is complete; I need the rollout choice before continuing" \
  --result-file /tmp/presence-decision.json
```

### Decision quality rules

A good decision request:
- comes **after** useful autonomous work, not before it;
- asks one concrete question;
- gives mutually understandable options;
- includes your recommendation when you have one;
- explains the material tradeoff/risk;
- does not dump implementation noise on the human;
- does not ask the human to decide something you can safely determine yourself.

Do **not** use the Decision Inbox as a disguised progress report.

### What happens after the human chooses

The Portal sends a structured message into the same primary AICIV conversation, for example:

```text
[AICIV DECISION RESPONSE job=job_... decision=dec_provider_choice option=provider_b]
Human selection: Use Provider B
Human note: Keep the fallback easy to reverse.

This confirms the human decision was delivered into the primary AICIV conversation. It is NOT proof that any downstream action has completed. Continue the durable job and report actual results/receipts through the Presence job callback.
```

When you receive it:
1. Match the `job` and `decision` identifiers.
2. Resume that durable job using the human choice as authoritative input.
3. If the requested consequence succeeds, later report `succeeded` with evidence.
4. If it fails, report `failed` truthfully.
5. If another genuine human decision is required, you may report another structured `waiting` decision with a new decision ID.

## Succeed with a result and receipts

Write a compact machine-readable result when practical:

```bash
cat > /tmp/presence-result.json <<'JSON'
{
  "summary": "Yesterday was 11.7% faster than Tuesday",
  "primary_driver": "larger effective batching",
  "recommendation": "keep batching change; rerun latency tail test"
}
JSON

cat > /tmp/presence-receipts.json <<'JSON'
[
  {
    "kind": "file",
    "label": "comparison report",
    "uri": "file:///home/aiciv/to-human/benchmark-comparison.md"
  },
  {
    "kind": "test",
    "label": "benchmark validation",
    "metadata": {"passed": true, "samples": 50}
  }
]
JSON

python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 succeeded \
  --message "Comparison complete" \
  --result-file /tmp/presence-result.json \
  --receipts-file /tmp/presence-receipts.json
```

## Fail truthfully

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 failed \
  --error "Tuesday benchmark artifact is missing, so a verified comparison is impossible"
```

## Confirm cancellation

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 cancelled \
  --message "Stopped before any production changes were applied"
```

## Idempotent retries

If a callback times out and you are unsure whether the gateway received it, retry with the **same** event ID:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 succeeded \
  --event-id evt_my-stable-id-001 \
  --result-file /tmp/presence-result.json \
  --receipts-file /tmp/presence-receipts.json
```

The gateway de-duplicates identical event IDs, so network uncertainty does not create duplicate lifecycle events.

## Relationship to Portal

Portal chat remains the delivery path into your live primary session. The Presence Gateway owns the durable job record and the callback tool owns explicit completion receipts.

Portal's AICIV Inbox stores only collaboration annotations such as seen/archive state and which decision option the human selected. Those annotations are **not** task-state receipts.

Do not rely on Presence scraping arbitrary assistant chat text to guess whether a job finished.
