#!/usr/bin/env python3
"""Report durable Presence-job events back to the AICIV Presence Gateway.

This helper is intentionally dependency-free (stdlib only) so every Portal/AICIV
container can use it without changing the Python environment. It reads the
callback endpoint and secret from process environment first and then ~/.env.

Required configuration in the AICIV container:

    PRESENCE_GATEWAY_URL=https://presence.example.com
    AICIV_CALLBACK_API_KEY=<long random callback-only secret>

Examples:

    python3 presence_job.py job_abcd... running --message "Started"
    python3 presence_job.py job_abcd... progress --message "Benchmarks loaded"
    python3 presence_job.py job_abcd... succeeded \
        --result-file /tmp/result.json --receipts-file /tmp/receipts.json
    python3 presence_job.py job_abcd... failed --error "Build logs unavailable"

The gateway de-duplicates event_id values, so callers may safely retry the same
request by passing --event-id explicitly.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


VALID_STATUSES = ("running", "progress", "waiting", "succeeded", "failed", "cancelled")
DEFAULT_TIMEOUT_SECONDS = 15


def _read_dotenv() -> dict[str, str]:
    """Read simple KEY=value pairs from ~/.env without executing shell syntax."""
    values: dict[str, str] = {}
    env_path = Path.home() / ".env"
    if not env_path.exists():
        return values

    try:
        for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key:
                continue
            # Support the common quoted-value case without trying to implement
            # a shell parser (which would be both surprising and unsafe here).
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            values[key] = value
    except OSError:
        pass
    return values


def _config_value(name: str, dotenv: dict[str, str]) -> str:
    return os.environ.get(name, "").strip() or dotenv.get(name, "").strip()


def _load_json_or_text(path_value: str | None) -> Any | None:
    if not path_value:
        return None
    path = Path(path_value).expanduser()
    raw = path.read_text(encoding="utf-8", errors="replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _load_receipts(path_value: str | None) -> list[dict[str, Any]] | None:
    if not path_value:
        return None
    value = _load_json_or_text(path_value)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError("--receipts-file must contain a JSON array of receipt objects")
    return value


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Report a durable Presence-job event")
    parser.add_argument("job_id", help="Durable job ID (job_<24 hex chars>)")
    parser.add_argument("status", choices=VALID_STATUSES)
    parser.add_argument("--message", help="Human-readable progress/result message")
    parser.add_argument("--result-file", help="JSON or UTF-8 text file containing the result")
    parser.add_argument("--receipts-file", help="JSON array of evidence/receipt objects")
    parser.add_argument("--error", help="Failure reason (normally used with status=failed)")
    parser.add_argument(
        "--event-id",
        default=None,
        help="Stable event ID for idempotent retry; generated automatically if omitted",
    )
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if not args.job_id.startswith("job_") or len(args.job_id) != 28:
        print("error: job_id must look like job_<24 hex chars>", file=sys.stderr)
        return 2

    dotenv = _read_dotenv()
    gateway_url = _config_value("PRESENCE_GATEWAY_URL", dotenv).rstrip("/")
    callback_key = _config_value("AICIV_CALLBACK_API_KEY", dotenv)
    if not gateway_url:
        print("error: PRESENCE_GATEWAY_URL is not configured", file=sys.stderr)
        return 2
    if not callback_key:
        print("error: AICIV_CALLBACK_API_KEY is not configured", file=sys.stderr)
        return 2

    try:
        result = _load_json_or_text(args.result_file)
        receipts = _load_receipts(args.receipts_file)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    payload: dict[str, Any] = {
        "eventId": args.event_id or f"evt_{uuid.uuid4()}",
        "type": args.status,
    }
    if args.message:
        payload["message"] = args.message
    if result is not None:
        payload["result"] = result
    if receipts is not None:
        payload["receipts"] = receipts
    if args.error:
        payload["error"] = args.error

    if args.status == "failed" and not args.error and not args.message:
        print("error: failed status requires --error or --message", file=sys.stderr)
        return 2
    if args.status == "succeeded" and args.error:
        print("error: succeeded status cannot include --error", file=sys.stderr)
        return 2

    endpoint = f"{gateway_url}/v1/delegations/{args.job_id}/events"
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {callback_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "aiciv-presence-job/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=max(1.0, args.timeout)) as response:
            raw = response.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw) if raw else {"ok": True}
            # Deliberately print the gateway response: it contains job state and
            # receipts, never the callback credential.
            print(json.dumps(parsed, indent=2, sort_keys=True))
            return 0
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")[:2000]
        print(f"error: gateway returned HTTP {exc.code}: {response_body}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"error: gateway unavailable: {exc.reason}", file=sys.stderr)
        return 1
    except TimeoutError:
        print("error: gateway callback timed out", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
