#!/bin/bash
# =============================================================
# scripts/bundle_client.sh
# Packages the Node.js client and required OpenFHE binaries
# into a zip/tarball for voters to download and run locally.
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$ROOT/evoting_client_bundle"
BUNDLE_ARCHIVE="$ROOT/evoting_client_bundle.tar.gz"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    MK-FHE  Bundle Voter Client               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 1. Create bundle directory
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/crypto/build"
mkdir -p "$BUNDLE_DIR/params"

# 2. Copy components
echo "Copying Node.js client..."
cp -r "$ROOT/client" "$BUNDLE_DIR/"
# remove any existing data
rm -rf "$BUNDLE_DIR/client/data"

echo "Copying web UI..."
cp -r "$ROOT/web" "$BUNDLE_DIR/"

echo "Copying crypto params..."
if [[ -f "$ROOT/params/crypto_params.bin" ]]; then
    cp "$ROOT/params/crypto_params.bin" "$BUNDLE_DIR/params/"
else
    echo "Warning: crypto_params.bin not found. Run setup first."
fi

echo "Copying OpenFHE binaries..."
for bin in voter_keygen encrypt_vote voter_partial_decrypt; do
    if [[ -f "$ROOT/crypto/build/$bin" ]]; then
        cp "$ROOT/crypto/build/$bin" "$BUNDLE_DIR/crypto/build/"
    else
        echo "Error: $bin not found in crypto/build. Run build.sh first."
        exit 1
    fi
done

# Create a small startup script for the voter
cat << 'EOF' > "$BUNDLE_DIR/run_voter.sh"
#!/bin/bash
export SERVER_URL="${SERVER_URL:-http://localhost:3001}"
export VOTER_ID="${VOTER_ID:-voter1}"

echo "Starting Voter Client ($VOTER_ID)..."
echo "Connecting to Tally Server at: $SERVER_URL"
cd client && npm install && node client.js
EOF
chmod +x "$BUNDLE_DIR/run_voter.sh"

# 3. Create archive
echo "Creating archive $BUNDLE_ARCHIVE..."
cd "$ROOT" && tar -czf "$BUNDLE_ARCHIVE" "$(basename "$BUNDLE_DIR")"

echo ""
echo "✓ Bundle created successfully: $BUNDLE_ARCHIVE"
echo "  Distribute this file to voters."
echo "  Voters should extract it and run ./run_voter.sh"
echo ""
