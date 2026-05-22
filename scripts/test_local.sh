#!/bin/bash
# =============================================================
# scripts/test_local.sh  —  DAY 2
# Runs the COMPLETE pipeline on a single machine.
# Tests: setup → keygen×3 → encrypt×3 → tally → partial×3 → combine
#
# Simulates 3 voters, all on this one machine.
# If this passes, the crypto is correct and ready for networking.
#
# Usage:  ./scripts/test_local.sh
# =============================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
BIN="$ROOT/crypto/build"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    MK-FHE  Local Pipeline Test  (Day 2)      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Verify binaries exist ─────────────────────────────────────
for b in setup keygen encrypt_vote tally partial_decrypt combine; do
    if [[ ! -f "$BIN/$b" ]]; then
        echo "✗ Binary missing: $BIN/$b"
        echo "  Run: ./scripts/build.sh first."
        exit 1
    fi
done

# ── Clean previous test run ───────────────────────────────────
echo "── Cleaning previous test data..."
rm -rf "$ROOT/params" \
       "$ROOT/client/data" \
       "$ROOT/server/data/ciphertexts" \
       "$ROOT/server/data/tally" \
       "$ROOT/server/data/shares" \
       "$ROOT/server/data/keys"

mkdir -p "$ROOT/params" \
         "$ROOT/server/data/ciphertexts" \
         "$ROOT/server/data/tally" \
         "$ROOT/server/data/shares"

cd "$ROOT"

# ── Step 1: Setup ─────────────────────────────────────────────
echo ""
echo "── STEP 1: Generate shared CryptoContext"
"$BIN/setup"

# ── Voter simulation helper ───────────────────────────────────
simulate_voter() {
    local VOTER_ID=$1
    local VOTE=$2   # 1=YES 0=NO

    echo ""
    echo "── VOTER $VOTER_ID: vote=$([ $VOTE -eq 1 ] && echo YES || echo NO)"

    # Temporarily redirect key/vote paths for this voter
    mkdir -p "client_${VOTER_ID}/data/keys"
    mkdir -p "client_${VOTER_ID}/data"

    # Keygen: registers voter and updates joint_pk.bin in server/data/keys
    "$BIN/voter_keygen" "voter${VOTER_ID}"

    "$BIN/encrypt_vote" "voter${VOTER_ID}" "$VOTE"

    echo "  → Voter ${VOTER_ID} registered and vote recorded."
}

# ── Step 2: Registration ──────────────────────────────────────
echo ""
echo "── STEP 2: Voter Registration"
for V in 1 2 3; do
    "$BIN/voter_keygen" "voter${V}"
done

# ── Step 3: Voting ──────────────────────────────────────────
echo ""
echo "── STEP 3: Cast Ballots (under FINAL joint key)"
"$BIN/encrypt_vote" "voter1" 1
"$BIN/encrypt_vote" "voter2" 1
"$BIN/encrypt_vote" "voter3" 0

echo ""
echo "── STEP 4: Homomorphic Tally (server)"
"$BIN/tally"

echo ""
echo "── STEP 5: Partial Decryption (each voter)"

for V in 1 2 3; do
    echo ""
    echo "  Voter $V partial decrypt..."
    # voter_partial_decrypt handles lead/main roles automatically based on order
    "$BIN/voter_partial_decrypt" "voter${V}"
    echo "  → Share saved: server/data/shares/share_voter${V}.bin"
done

echo ""
echo "── STEP 5: Combine shares → Final Result"
"$BIN/combine"

# ── Verify result ─────────────────────────────────────────────
RESULT_FILE="$ROOT/server/data/tally/final_result.txt"
if [[ -f "$RESULT_FILE" ]]; then
    RESULT=$(cat "$RESULT_FILE")
    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║              TEST RESULT                     ║"
    echo "╠══════════════════════════════════════════════╣"
    echo "  $RESULT"
    echo "  Expected: FINAL YES VOTES = 2"
    echo "╚══════════════════════════════════════════════╝"

    if echo "$RESULT" | grep -q "= 2"; then
        echo ""
        echo "✓  TEST PASSED — crypto pipeline is correct!"
    else
        echo ""
        echo "✗  TEST FAILED — result does not match expected value 2"
        exit 1
    fi
else
    echo "✗  Result file not found!"
    exit 1
fi

# ── Cleanup temp voter dirs ───────────────────────────────────
rm -rf "$ROOT/client_1" "$ROOT/client_2" "$ROOT/client_3"

echo ""
echo "✓  Local pipeline test complete. Ready for Day 3 networking."
echo ""
