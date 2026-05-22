#!/bin/bash
# =============================================================
# scripts/demo_tally.sh  —  DAY 4
# Presenter runs this on Computer 1 after all votes are in.
# Triggers: POST /tally → homomorphic addition
# Then after all shares arrive: POST /combine → final result
#
# Usage:
#   ./scripts/demo_tally.sh tally     # trigger homomorphic tally
#   ./scripts/demo_tally.sh combine   # fuse shares and reveal result
#   ./scripts/demo_tally.sh status    # check election state
#   ./scripts/demo_tally.sh reset     # wipe for fresh demo run
# =============================================================

SERVER="${SERVER_URL:-http://localhost:3001}"
CMD="${1:-status}"

print_json() {
    echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"
}

case "$CMD" in
  status)
    echo ""
    echo "── Election Status ──────────────────────────────"
    RESULT=$(curl -s "$SERVER/status")
    print_json "$RESULT"
    echo ""
    ;;

  tally)
    echo ""
    echo "── Triggering Homomorphic Tally ─────────────────"
    echo "  Server performs EvalAdd on all encrypted votes..."
    RESULT=$(curl -s -X POST "$SERVER/tally")
    print_json "$RESULT"
    echo ""
    echo "  enc_tally.bin is now available for download."
    echo "  Each voter can now submit their decryption share."
    echo ""
    ;;

  combine)
    echo ""
    echo "── Combining Decryption Shares ──────────────────"
    echo "  Fusing partial decryption shares..."
    RESULT=$(curl -s -X POST "$SERVER/combine")
    print_json "$RESULT"
    echo ""
    FINAL=$(curl -s "$SERVER/result")
    echo "── FINAL RESULT:"
    print_json "$FINAL"
    echo ""
    ;;

  result)
    echo ""
    echo "── Final Result ─────────────────────────────────"
    RESULT=$(curl -s "$SERVER/result")
    print_json "$RESULT"
    echo ""
    ;;

  reset)
    echo ""
    echo "── Resetting server for fresh demo run ──────────"
    read -p "  Are you sure? This deletes all votes and shares. [y/N] " CONFIRM
    if [[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]]; then
        RESULT=$(curl -s -X POST "$SERVER/reset")
        print_json "$RESULT"
    else
        echo "  Cancelled."
    fi
    echo ""
    ;;

  *)
    echo "Usage: $0 <status|tally|combine|result|reset>"
    exit 1
    ;;
esac
