#!/bin/bash
# =============================================================
# scripts/network_check.sh  —  DAY 3
# Verifies all 4 computers can reach each other before
# starting the distributed test.
#
# Edit the IP addresses below to match your actual network.
#
# Usage:
#   ./scripts/network_check.sh           # run from any machine
#   ./scripts/network_check.sh server    # test server routes only
# =============================================================

# ── CONFIGURE THESE IPs ──────────────────────────────────────
SERVER_IP="${SERVER_IP:-192.168.1.100}"
VOTER1_IP="${VOTER1_IP:-192.168.1.101}"
VOTER2_IP="${VOTER2_IP:-192.168.1.102}"
VOTER3_IP="${VOTER3_IP:-192.168.1.103}"
SERVER_PORT="${SERVER_PORT:-3001}"
CLIENT_PORT="${CLIENT_PORT:-3000}"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    MK-FHE  Network Connectivity Check        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Server  : $SERVER_IP:$SERVER_PORT"
echo "  Voter 1 : $VOTER1_IP:$CLIENT_PORT"
echo "  Voter 2 : $VOTER2_IP:$CLIENT_PORT"
echo "  Voter 3 : $VOTER3_IP:$CLIENT_PORT"
echo ""

PASS=true

check_http() {
    local label=$1
    local url=$2
    local result
    result=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "$url" 2>/dev/null)
    if [[ "$result" == "200" ]]; then
        echo "  ✓  $label  ($url)"
    else
        echo "  ✗  $label  ($url)  → HTTP $result (is the service running?)"
        PASS=false
    fi
}

check_ping() {
    local label=$1
    local ip=$2
    if ping -c 1 -W 2 "$ip" &>/dev/null; then
        echo "  ✓  ping $label ($ip)"
    else
        echo "  ✗  ping $label ($ip)  → unreachable"
        PASS=false
    fi
}

echo "── Ping checks..."
check_ping "Server"  "$SERVER_IP"
check_ping "Voter 1" "$VOTER1_IP"
check_ping "Voter 2" "$VOTER2_IP"
check_ping "Voter 3" "$VOTER3_IP"

echo ""
echo "── HTTP health checks..."
check_http "Server  /health" "http://$SERVER_IP:$SERVER_PORT/health"
check_http "Voter 1 /health" "http://$VOTER1_IP:$CLIENT_PORT/health"
check_http "Voter 2 /health" "http://$VOTER2_IP:$CLIENT_PORT/health"
check_http "Voter 3 /health" "http://$VOTER3_IP:$CLIENT_PORT/health"

echo ""
echo "── Server election status..."
STATUS=$(curl -s "http://$SERVER_IP:$SERVER_PORT/status" 2>/dev/null)
if [[ -n "$STATUS" ]]; then
    echo "  $STATUS" | python3 -m json.tool 2>/dev/null || echo "  $STATUS"
fi

echo ""
if $PASS; then
    echo "✓  All machines reachable. Network is ready for distributed demo."
else
    echo "✗  Some machines are unreachable."
    echo ""
    echo "  Troubleshooting:"
    echo "  1. Confirm all Node.js servers are running (node server.js / node client.js)"
    echo "  2. Check macOS firewall: System Settings → Network → Firewall"
    echo "  3. Confirm all machines are on the SAME Wi-Fi network"
    echo "  4. Update IP addresses at the top of this script"
    echo "  5. Try: curl http://<IP>:3001/health from this machine manually"
fi
echo ""
