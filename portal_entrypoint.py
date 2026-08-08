#!/usr/bin/env python3
"""Production entrypoint for PureBrain Portal + AICIV-native extension routes.

`portal_server.py` remains the upstream/core Portal application. Importing it as
an ordinary Python module constructs the existing Starlette app without running
its `if __name__ == "__main__"` block. We then register narrowly-scoped modules
and serve the exact same app.

Keeping this wrapper tiny is intentional: cross-cutting product capabilities
should not require recurring edits to the mature Portal server monolith.
"""

from __future__ import annotations

import os
import signal
import sys

import uvicorn

import portal_server
from aiciv_collaboration import register_collaboration_routes
from aiciv_inbox import register_aiciv_inbox_routes
from aiciv_projects import register_aiciv_project_routes
from presence_bridge import register_presence_routes


register_presence_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
    civ_name=portal_server.CIV_NAME,
    human_name=portal_server.HUMAN_NAME,
)
register_aiciv_inbox_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
)
register_aiciv_project_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
)
register_collaboration_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
)


def _handle_sigterm(signum, frame):
    """Preserve the Portal's clean SIGTERM behavior."""
    print("[portal] SIGTERM received, shutting down gracefully...")
    sys.exit(0)


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_sigterm)

    port = int(os.environ.get("PORT", 8097))
    print(f"[portal] Starting PureBrain Portal + AICIV extensions on port {port}")
    # Never print Presence Gateway credentials here. The existing Portal bearer
    # behavior remains owned by portal_server.py.
    uvicorn.run(portal_server.app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
