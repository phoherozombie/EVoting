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
       "$ROOT/server/data/shares"

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

    # Keygen: use voter-specific key directory
    # For test: we point binaries at temp dirs via symlinks
    rm -rf "client/data"
    mkdir -p "client/data/keys"

    "$BIN/keygen"

    "$BIN/encrypt_vote" "voter${VOTER_ID}" "$VOTE"

    # Copy ciphertext to server inbox
    cp "client/data/enc_vote.bin" "server/data/ciphertexts/enc_vote_voter${VOTER_ID}.bin"
    echo "  → Ciphertext saved: server/data/ciphertexts/enc_vote_voter${VOTER_ID}.bin"

    # Save keys for partial decrypt later
    cp -r "client/data/keys" "client_${VOTER_ID}/data/"
}

# ── Step 2: Simulate 3 voters ─────────────────────────────────
# Vote pattern: voter1=YES, voter2=YES, voter3=NO → expected tally = 2
simulate_voter 1 1
simulate_voter 2 1
simulate_voter 3 0

echo ""
echo "── STEP 3: Homomorphic Tally (server)"
"$BIN/tally"

echo ""
echo "── STEP 4: Partial Decryption (each voter)"

for V in 1 2 3; do
    echo ""
    echo "  Voter $V partial decrypt..."
    # Restore this voter's keys
    rm -rf "client/data"
    mkdir -p "client/data"
    cp -r "client_${V}/data/keys" "client/data/"
    mkdir -p "client/data/tally"
    cp "server/data/tally/enc_tally.bin" "client/data/tally/"

    "$BIN/partial_decrypt"

    cp "client/data/shares/my_share.bin" "server/data/shares/share_voter${V}.bin"
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
