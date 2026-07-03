#!/bin/bash
# =============================================================
# scripts/demo_run.sh  —  DAY 4
# Step-by-step guided demo script for the final presentation.
# Runs on Computer 1 (tally server). Guides the presenter
# through each phase with pauses and clear output.
#
# Usage:  ./scripts/demo_run.sh
# =============================================================

SERVER="${SERVER_URL:-http://localhost:3001}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

pause() {
    echo ""
    echo -e "${YELLOW}  ▶  Press ENTER to continue...${RESET}"
    read -r
}

header() {
    echo ""
    echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}"
    echo -e "${BOLD}${CYAN}  $1${RESET}"
    echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${RESET}"
}

step() {
    echo ""
    echo -e "${BOLD}STEP $1: $2${RESET}"
    echo "──────────────────────────────────────────────"
}

print_json() {
    echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"
}

# ── INTRO ─────────────────────────────────────────────────────
clear
header "MK-FHE PRIVACY-PRESERVING E-VOTING  —  LIVE DEMO"
echo ""
echo "  This demo runs on 4 computers:"
echo "    Computer 1 (this machine) → Tally Server"
echo "    Computer 2 → Voter 1"
echo "    Computer 3 → Voter 2"
echo "    Computer 4 → Voter 3"
echo ""
echo "  SECURITY GUARANTEE:"
echo "  The tally server will ADD encrypted votes together"
echo "  but will NEVER see any plaintext vote."
echo ""
echo "  Opening statement: 'We will now demonstrate a voting"
echo "  system where the server cannot learn how anyone voted.'"
pause

# ── STEP 1: Server health ─────────────────────────────────────
step 1 "Verify tally server is running"
echo ""
echo "  Checking server health..."
HEALTH=$(curl -s "$SERVER/health" 2>/dev/null)
if [[ -z "$HEALTH" ]]; then
    echo -e "  ${RED}✗  Server not responding at $SERVER${RESET}"
    echo "     Make sure server/server.js is running."
    exit 1
fi
echo -e "  ${GREEN}✓  Server is online${RESET}"
print_json "$HEALTH"
pause

# ── STEP 2: Show initial status ───────────────────────────────
step 2 "Show empty election state (0 votes received)"
STATUS=$(curl -s "$SERVER/status")
print_json "$STATUS"
echo ""
echo "  'The server has received zero votes."
echo "   All vote slots are empty and waiting.'"
pause

# ── STEP 3: Ask presenter to vote ────────────────────────────
step 3 "VOTING PHASE — Instruct voters to cast ballots"
echo ""
echo -e "  ${BOLD}ACTION REQUIRED:${RESET}"
echo "  Ask each voter at Computer 2, 3, 4 to extract the client bundle"
echo "  (evoting_client_bundle.tar.gz), run ./run_voter.sh locally,"
echo "  and open http://localhost:3000 to vote."
echo ""
echo "  Talking point: 'When a voter clicks YES, their browser"
echo "  calls their local Node.js server, which calls our C++ binary"
echo "  to encrypt the vote using FHE. Only the ciphertext is"
echo "  transmitted. The server never sees the raw vote.'"
echo ""
echo "  Waiting for all 3 votes..."
echo ""

# Poll until 3 votes received
while true; do
    STATUS=$(curl -s "$SERVER/status" 2>/dev/null)
    VOTES=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('votes_received',0))" 2>/dev/null)
    echo -ne "\r  Votes received: ${BOLD}${VOTES}/3${RESET}    "
    if [[ "$VOTES" -ge 3 ]]; then
        echo ""
        echo -e "  ${GREEN}✓  All 3 votes received!${RESET}"
        break
    fi
    sleep 2
done
pause

# ── STEP 4: Show ciphertext ───────────────────────────────────
step 4 "Show ciphertext files on disk"
echo ""
echo "  Files stored on server (all are encrypted):"
ls -lh "$(dirname "$0")/../server/data/ciphertexts/" 2>/dev/null || \
  echo "  (check server/data/ciphertexts/)"
echo ""
echo "  Talking point: 'These binary files are what the server"
echo "  received. They look like random noise. There is no way"
echo "  to read a vote from any of these files.'"
echo ""
echo "  Optional: run  xxd server/data/ciphertexts/enc_vote_voter1.bin | head -4"
echo "  to show the binary looks like random bytes."
pause

# ── STEP 5: Homomorphic tally ─────────────────────────────────
step 5 "Trigger Homomorphic Tally"
echo ""
echo "  Running: POST $SERVER/tally"
echo "  (this calls our C++ tally binary which runs EvalAdd)"
echo ""
RESULT=$(curl -s -X POST "$SERVER/tally")
print_json "$RESULT"
echo ""
echo -e "  ${GREEN}✓  Tally complete. enc_tally.bin saved.${RESET}"
echo ""
echo "  Talking point: 'The server just added three ciphertexts"
echo "  together using Fully Homomorphic Encryption. The result is"
echo "  still encrypted. The server has NO IDEA what the sum is.'"
pause

# ── STEP 6: Partial decryption ────────────────────────────────
step 6 "DECRYPTION PHASE — Voters submit their key shares"
echo ""
echo -e "  ${BOLD}ACTION REQUIRED:${RESET}"
echo "  Ask each voter to click [SUBMIT DECRYPTION SHARE]"
echo "  on their voting page."
echo ""
echo "  Talking point: 'No single voter can decrypt the tally."
echo "  We need ALL THREE voters to cooperate. If even one"
echo "  refuses, the result stays encrypted forever.'"
echo ""
echo "  Waiting for all 3 shares..."
echo ""

while true; do
    STATUS=$(curl -s "$SERVER/status" 2>/dev/null)
    SHARES=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('shares_received',0))" 2>/dev/null)
    echo -ne "\r  Shares received: ${BOLD}${SHARES}/3${RESET}    "
    if [[ "$SHARES" -ge 3 ]]; then
        echo ""
        echo -e "  ${GREEN}✓  All 3 shares received!${RESET}"
        break
    fi
    sleep 2
done
pause

# ── STEP 7: Combine ───────────────────────────────────────────
step 7 "Combine Shares → Reveal Final Tally"
echo ""
echo "  Running: POST $SERVER/combine"
echo "  (this calls our C++ combine binary: MultipartyDecryptFusion)"
echo ""
RESULT=$(curl -s -X POST "$SERVER/combine")
print_json "$RESULT"
echo ""

FINAL=$(curl -s "$SERVER/result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))" 2>/dev/null)
echo ""
echo -e "${BOLD}${GREEN}"
echo "  ╔════════════════════════════════════╗"
echo "  ║     FINAL ELECTION RESULT          ║"
echo "  ║                                    ║"
echo "  ║   $FINAL"
echo "  ║                                    ║"
echo "  ╚════════════════════════════════════╝"
echo -e "${RESET}"
pause

# ── STEP 8: Privacy recap ─────────────────────────────────────
step 8 "Privacy Guarantee Summary"
echo ""
echo "  What the server learned during this entire election:"
echo ""
echo -e "  ${GREEN}✓  That 3 encrypted votes were received${RESET}"
echo -e "  ${GREEN}✓  The final tally integer (after shares combined)${RESET}"
echo ""
echo -e "  ${RED}✗  Which voter voted YES or NO${RESET}"
echo -e "  ${RED}✗  Any individual vote — ever${RESET}"
echo -e "  ${RED}✗  The secret key of any voter${RESET}"
echo ""
echo "  'The ciphertext the server stored is mathematically"
echo "  indistinguishable from random noise under IND-CPA security."
echo "  Even with unlimited computation, the server cannot extract"
echo "  any individual vote from what it received.'"
echo ""
echo -e "${BOLD}${CYAN}  DEMO COMPLETE.${RESET}"
echo ""
