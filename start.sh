#!/bin/bash
# Start the PureBrain Portal Server with optional Presence voice integration.
# Usage: ./start.sh [port]
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-${PORT:-8097}}"
export PORT

echo "[portal] Starting PureBrain portal on port $PORT..."
exec python3 "$DIR/portal_entrypoint.py"
