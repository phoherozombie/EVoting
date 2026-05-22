#!/bin/bash
# test_register.sh
# Tests the new registration API with CCCD constraints.

PORT=3001
SERVER_URL="http://localhost:${PORT}"
DATA_DIR="./server/data"

echo "=========================================="
echo "    TEST: Voter Registration API          "
echo "=========================================="

# Start server in background
echo "[*] Starting Tally Server on port $PORT..."
SERVER_PORT=$PORT node ./server/server.js > /dev/null 2>&1 &
SERVER_PID=$!
sleep 2 # wait for server to start

# Helper to run curl and extract HTTP status code
run_curl() {
  local data=$1
  curl -s -o /tmp/resp.txt -w "%{http_code}" -X POST "${SERVER_URL}/register" -H "Content-Type: application/json" -d "$data"
}

echo "[*] Resetting server state..."
curl -s -X POST "${SERVER_URL}/reset" > /dev/null

echo "---"
echo "[1] Test Missing Fields"
STATUS=$(run_curl '{"fullName": "No CCCD Voter"}')
if [ "$STATUS" -eq 400 ]; then
  echo "✓ Missing fields blocked as expected (400)"
else
  echo "✗ Failed: Expected 400, got $STATUS"
fi

echo "---"
echo "[2] Test Normal Registration"
STATUS=$(run_curl '{"fullName": "Alice Voter", "cccd": "123456789012", "dob": "2000-01-01", "contact": "alice@mail.com", "address": "Hanoi"}')
if [ "$STATUS" -eq 200 ]; then
  echo "✓ Registration successful (200)"
else
  echo "✗ Failed: Expected 200, got $STATUS"
  cat /tmp/resp.txt
fi

echo "---"
echo "[3] Test Duplicate CCCD Registration"
STATUS=$(run_curl '{"fullName": "Bob Hacker", "cccd": "123456789012"}')
if [ "$STATUS" -eq 409 ]; then
  echo "✓ Duplicate CCCD blocked as expected (409)"
else
  echo "✗ Failed: Expected 409, got $STATUS"
  cat /tmp/resp.txt
fi

echo "---"
echo "[*] Verifying file structure..."
if [ -d "$DATA_DIR/voters" ]; then
  VOTER_COUNT=$(ls -1 "$DATA_DIR/voters" | wc -l | tr -d ' ')
  if [ "$VOTER_COUNT" -eq 1 ]; then
    echo "✓ Exactly 1 voter folder created."
  else
    echo "✗ Failed: Expected 1 voter folder, found $VOTER_COUNT."
  fi
  
  VOTER_DIR=$(ls -1 "$DATA_DIR/voters" | head -n 1)
  if [ -f "$DATA_DIR/voters/$VOTER_DIR/profile.json" ]; then
    echo "✓ profile.json exists."
  else
    echo "✗ Failed: profile.json missing."
  fi
else
  echo "✗ Failed: voters directory not found."
fi

# Clean up
echo "[*] Stopping Server (PID: $SERVER_PID)"
kill $SERVER_PID
rm -f /tmp/resp.txt

echo "=========================================="
echo "                TEST DONE                 "
echo "=========================================="
