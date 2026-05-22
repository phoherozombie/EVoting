#!/bin/bash
# =============================================================
# scripts/build.sh  —  Build all C++ crypto binaries
#
# Usage:
#   ./scripts/build.sh
#   ./scripts/build.sh /path/to/openfhe/build   # custom prefix
# =============================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
CRYPTO="$ROOT/crypto"
BUILD="$CRYPTO/build"
OPENFHE_HINT="${1:-}"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         MK-FHE  E-Voting  Build              ║"
echo "╚══════════════════════════════════════════════╝"
echo "  Project : $ROOT"
echo "  Build   : $BUILD"
[[ -n "$OPENFHE_HINT" ]] && echo "  OpenFHE : $OPENFHE_HINT"
echo ""

mkdir -p "$BUILD"
cd "$BUILD"

CMAKE_ARGS=("-DCMAKE_BUILD_TYPE=Release")
if [[ -n "$OPENFHE_HINT" ]]; then
    if [[ -f "$OPENFHE_HINT/OpenFHEConfig.cmake" ]]; then
        # Đường dẫn tới thư mục build trực tiếp
        CMAKE_ARGS+=("-DOpenFHE_DIR=$OPENFHE_HINT")
    else
        # Đường dẫn tới thư mục cài đặt tiêu chuẩn
        CMAKE_ARGS+=("-DOpenFHE_DIR=$OPENFHE_HINT/lib/cmake/OpenFHE")
    fi
fi

echo "── cmake configure..."
cmake "${CMAKE_ARGS[@]}" "$CRYPTO"

echo ""
echo "── cmake build (4 parallel jobs)..."
cmake --build . --parallel 4

echo ""
echo "── Verifying binaries..."
PASS=true
for t in setup keygen encrypt_vote tally partial_decrypt combine; do
    if [[ -f "$BUILD/$t" ]]; then
        echo "  ✓  $t"
    else
        echo "  ✗  $t  MISSING"
        PASS=false
    fi
done

echo ""
if $PASS; then
    echo "✓  All binaries built successfully."
    echo ""
    echo "  Day 1 quick test:"
    echo "    cd $ROOT"
    echo "    ./crypto/build/setup"
    echo "    ./crypto/build/keygen"
    echo "    ./crypto/build/encrypt_vote 1"
    echo "    ls -lh client/data/enc_vote.bin"
else
    echo "✗  Build incomplete. See output above."
    exit 1
fi
echo ""
