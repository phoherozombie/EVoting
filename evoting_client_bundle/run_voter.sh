#!/bin/bash
export SERVER_URL="${SERVER_URL:-http://localhost:3001}"
export VOTER_ID="${VOTER_ID:-voter1}"

echo "Starting Voter Client ($VOTER_ID)..."
echo "Connecting to Tally Server at: $SERVER_URL"
cd client && npm install && node client.js
