#!/bin/bash
# =============================================================
# scripts/sync_params.sh  —  DAY 3
# Copies crypto_params.bin from THIS machine to all others.
# Run from Computer 1 (tally server) after running setup.
#
# Prerequisites:
#   - SSH keys set up between all machines, OR
#   - Will prompt for password each time
#
# Usage:
#   ./scripts/sync_params.sh
# =============================================================

# ── CONFIGURE THESE ──────────────────────────────────────────
VOTER1_USER="${VOTER1_USER:-student}"
VOTER2_USER="${VOTER2_USER:-student}"
VOTER3_USER="${VOTER3_USER:-student}"
VOTER1_IP="${VOTER1_IP:-192.168.1.101}"
VOTER2_IP="${VOTER2_IP:-192.168.1.102}"
VOTER3_IP="${VOTER3_IP:-192.168.1.103}"
REMOTE_PATH="${REMOTE_PATH:-~/evoting-system/params/}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PARAMS="$ROOT/params/crypto_params.bin"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    MK-FHE  Sync crypto_params.bin            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

if [[ ! -f "$PARAMS" ]]; then
    echo "✗ params/crypto_params.bin not found."
    echo "  Run: ./crypto/build/setup first."
    exit 1
fi

SIZE=$(du -h "$PARAMS" | cut -f1)
echo "  Source: $PARAMS  ($SIZE)"
echo ""

scp_to() {
    local label=$1
    local user=$2
    local ip=$3
    echo -n "  Copying to $label ($user@$ip:$REMOTE_PATH)... "
    if ssh -o ConnectTimeout=5 "$user@$ip" "mkdir -p $REMOTE_PATH" 2>/dev/null && \
       scp -q "$PARAMS" "$user@$ip:$REMOTE_PATH"; then
        echo "✓"
    else
        echo "✗ FAILED (check SSH access to $ip)"
    fi
}

scp_to "Voter 1" "$VOTER1_USER" "$VOTER1_IP"
scp_to "Voter 2" "$VOTER2_USER" "$VOTER2_IP"
scp_to "Voter 3" "$VOTER3_USER" "$VOTER3_IP"

echo ""
echo "Done. Each voter machine should now have params/crypto_params.bin."
echo "Verify with: ssh user@ip 'ls -lh ~/evoting-system/params/'"
echo ""
