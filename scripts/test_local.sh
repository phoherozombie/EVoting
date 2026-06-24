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

PARAMS="$ROOT/params/crypto_params.bin"
JOINT_PK="$ROOT/server/data/keys/joint_pk.bin"
mkdir -p "$ROOT/server/data/keys"

# ── Step 2: Registration ──────────────────────────────────────
echo ""
echo "── STEP 2: Voter Registration"
for V in 1 2 3; do
    VOTER_ID="voter${V}"
    IS_FIRST=$([ $V -eq 1 ] && echo "1" || echo "0")
    IN_JOINT_PK=$([ $V -eq 1 ] && echo "dummy.bin" || echo "$JOINT_PK")
    
    mkdir -p "client_${VOTER_ID}/data/keys"
    OUT_SK="client_${VOTER_ID}/data/keys/secret_key.bin"
    OUT_PK="client_${VOTER_ID}/data/keys/public_key.bin"
    
    if [ $V -eq 1 ]; then touch dummy.bin; fi
    
    "$BIN/voter_keygen" "$VOTER_ID" "$IS_FIRST" "$IN_JOINT_PK" "$OUT_SK" "$OUT_PK" "$PARAMS"
    
    # Simulate upload to server by making the new PK the current joint PK
    cp "$OUT_PK" "$JOINT_PK"
done
rm -f dummy.bin

# ── Step 3: Voting ──────────────────────────────────────────
echo ""
echo "── STEP 3: Cast Ballots (under FINAL joint key)"
# voter1 votes YES(1), voter2 votes YES(1), voter3 votes NO(0)
for V in 1 2 3; do
    VOTER_ID="voter${V}"
    VOTE=$([ $V -eq 3 ] && echo "0" || echo "1")
    OUT_ENC="server/data/ciphertexts/enc_vote_${VOTER_ID}.bin"
    
    "$BIN/encrypt_vote" "$VOTE" "$JOINT_PK" "$OUT_ENC" "$PARAMS"
done

echo ""
echo "── STEP 4: Homomorphic Tally (server)"
"$BIN/tally"

echo ""
echo "── STEP 5: Partial Decryption (each voter)"
TALLY_FILE="server/data/tally/enc_tally.bin"

for V in 1 2 3; do
    echo ""
    echo "  Voter $V partial decrypt..."
    VOTER_ID="voter${V}"
    IS_LEAD=$([ $V -eq 1 ] && echo "1" || echo "0")
    IN_SK="client_${VOTER_ID}/data/keys/secret_key.bin"
    OUT_SHARE="server/data/shares/share_${VOTER_ID}.bin"
    
    "$BIN/voter_partial_decrypt" "$VOTER_ID" "$IS_LEAD" "$IN_SK" "$TALLY_FILE" "$OUT_SHARE" "$PARAMS"
    echo "  → Share saved: $OUT_SHARE"
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

    if echo "$RESULT" | grep -q "CANDIDATE_1:2"; then
        echo ""
        echo "✓  TEST PASSED — crypto pipeline is correct!"
    else
        echo ""
        echo "✗  TEST FAILED — result does not match expected value"
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
