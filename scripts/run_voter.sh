#!/bin/bash
# =============================================================
# scripts/run_voter.sh  —  DAY 4
# Starts a voter client (Computers 2/3/4).
#
# Usage:
#   VOTER_ID=voter1 SERVER_URL=http://192.168.1.100:3001 ./scripts/run_voter.sh
#   VOTER_ID=voter2 SERVER_URL=http://192.168.1.100:3001 ./scripts/run_voter.sh
# =============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

export VOTER_ID="${VOTER_ID:-voter1}"
export SERVER_URL="${SERVER_URL:-http://localhost:3001}"
export CLIENT_PORT="${CLIENT_PORT:-3000}"

echo ""
echo "Starting voter client..."
echo "  Voter ID : $VOTER_ID"
echo "  Server   : $SERVER_URL"
echo "  Port     : $CLIENT_PORT"
echo ""

# Ensure keygen has been run
if [[ ! -f "$ROOT/client/data/keys/public_key.bin" ]]; then
    echo "No keys found. Running keygen..."
    "$ROOT/crypto/build/keygen"
fi

cd "$ROOT/client"

if [[ ! -d node_modules ]]; then
    echo "Installing dependencies..."
    npm install
fi

node client.js
