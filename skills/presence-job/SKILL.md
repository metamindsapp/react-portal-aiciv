---
name: presence-job
description: Report lifecycle events and receipts for durable jobs delegated by an AICIV Presence/voice agent.
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

### 2. Progress / waiting

Use sparingly for meaningful state changes, not narration spam:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 progress \
  --message "Loaded both benchmark result sets; comparing batching deltas"
```

If blocked on something external:

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 waiting \
  --message "Waiting for the remote benchmark artifact to finish uploading"
```

### 3. Succeed with a result and receipts

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

### 4. Fail truthfully

```bash
python3 ~/.claude/skills/presence-job/presence_job.py \
  job_0123456789abcdef01234567 failed \
  --error "Tuesday benchmark artifact is missing, so a verified comparison is impossible"
```

### 5. Confirm cancellation

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

## Relationship to Portal chat

Portal chat remains the delivery path into your live primary session. The Presence Gateway owns the durable job record and the callback tool owns explicit completion receipts. Do not rely on Presence scraping arbitrary assistant chat text to guess whether a job finished.
