#!/usr/bin/env python3
"""Production entrypoint for PureBrain Portal + AICIV-native extension routes."""

from __future__ import annotations

import os
import signal
import sys

import uvicorn

import portal_server
from aiciv_collaboration import register_collaboration_routes
from aiciv_evidence import register_evidence_routes
from aiciv_http import install_http_boundary
from aiciv_inbox import register_aiciv_inbox_routes
from aiciv_projects import register_aiciv_project_routes
from aiciv_protocol import activity_inbox_store, activity_project_store, register_protocol_routes
from aiciv_session import install_session_auth
from presence_bridge import register_presence_routes


install_session_auth(
    portal_server.app,
    portal_bearer=portal_server.BEARER_TOKEN,
)

register_presence_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
    civ_name=portal_server.CIV_NAME,
    human_name=portal_server.HUMAN_NAME,
)
register_aiciv_inbox_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
    store=activity_inbox_store(),
)
register_aiciv_project_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
    store=activity_project_store(),
)
register_collaboration_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
)
register_evidence_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
)
register_protocol_routes(
    portal_server.app,
    check_auth=portal_server.check_auth,
    civ_name=portal_server.CIV_NAME,
    human_name=portal_server.HUMAN_NAME,
)
install_http_boundary(portal_server.app)


def _handle_sigterm(signum, frame):
    print("[portal] SIGTERM received, shutting down gracefully...")
    sys.exit(0)


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_sigterm)
    port = int(os.environ.get("PORT", 8097))
    print(f"[portal] Starting PureBrain Portal + AICIV extensions on port {port}")
    uvicorn.run(portal_server.app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
