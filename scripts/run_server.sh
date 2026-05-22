#!/bin/bash
# =============================================================
# scripts/run_server.sh  —  DAY 4
# Starts the tally server (Computer 1).
# Usage:  ./scripts/run_server.sh
# =============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

export SERVER_PORT="${SERVER_PORT:-3001}"
export EXPECTED_VOTERS="${EXPECTED_VOTERS:-3}"

echo ""
echo "Starting tally server on port $SERVER_PORT..."
echo "Expected voters: $EXPECTED_VOTERS"
echo ""

cd "$ROOT/server"

if [[ ! -d node_modules ]]; then
    echo "Installing dependencies..."
    npm install
fi

node server.js
