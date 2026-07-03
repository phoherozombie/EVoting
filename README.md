# Privacy-Preserving E-Voting — MK-FHE Demo
**Graduation Project** · C++17 · OpenFHE · Node.js · Distributed Demo

---

## Quick Reference

| Script | When | What |
|--------|------|------|
| `./scripts/build.sh` | Day 1 | Compile all C++ binaries |
| `./scripts/test_local.sh` | Day 2 | Full pipeline test on 1 machine |
| `./scripts/network_check.sh` | Day 3 | Verify all 4 computers reachable |
| `./scripts/sync_params.sh` | Day 3 | Copy crypto_params.bin to all machines |
| `./scripts/run_server.sh` | Day 4 | Start tally server (Computer 1) |
| `./scripts/run_voter.sh` | Day 4 | Start voter client (Computers 2/3/4) |
| `./scripts/demo_run.sh` | Demo | Guided presentation walkthrough |
| `./scripts/demo_tally.sh tally` | Demo | Trigger homomorphic tally |
| `./scripts/demo_tally.sh combine` | Demo | Fuse shares → reveal result |
| `./scripts/demo_tally.sh reset` | Demo | Wipe server for fresh run |

---

## Day 1 — Build & Basic Crypto

```bash
# 1. Build all binaries
./scripts/build.sh
# With custom OpenFHE path:
# ./scripts/build.sh /path/to/openfhe-development/build

# 2. Generate shared CryptoContext
./crypto/build/setup
# → params/crypto_params.bin

# 3. Generate this voter's keypair
./crypto/build/keygen
# → client/data/keys/public_key.bin
# → client/data/keys/secret_key.bin

# 4. Encrypt a YES vote
./crypto/build/encrypt_vote 1
# → client/data/enc_vote.bin

# 5. Verify
ls -lh client/data/enc_vote.bin
```

---

## Day 2 — Full Crypto Pipeline

```bash
# Run the complete local simulation (all 5 steps, 3 simulated voters)
./scripts/test_local.sh

# Expected output:
# ✓  FINAL YES VOTES = 2  (voter1=YES, voter2=YES, voter3=NO)
# ✓  TEST PASSED
```

If the test passes, the entire crypto pipeline is correct.

Then test Node.js integration:
```bash
# Terminal 1: start server
./scripts/run_server.sh

# Terminal 2: start voter client
VOTER_ID=voter1 SERVER_URL=http://localhost:3001 ./scripts/run_voter.sh

# Open http://localhost:3000 → vote → watch terminals
```

---

## Day 3 — Multi-Machine Networking

### 1. Edit IP addresses

Edit the top of these scripts with your actual LAN IPs:
- `scripts/network_check.sh`
- `scripts/sync_params.sh`

### 2. Distribute crypto_params.bin

```bash
# Run on Computer 1 after ./crypto/build/setup
./scripts/sync_params.sh
```

Or copy manually:
```bash
scp params/crypto_params.bin student@192.168.1.101:~/evoting-system/params/
```

### 3. Check connectivity

```bash
./scripts/network_check.sh
```

### 4. Test 2-machine flow

```bash
# Computer 1:
./scripts/run_server.sh

# Computer 2:
VOTER_ID=voter1 SERVER_URL=http://192.168.1.100:3001 ./scripts/run_voter.sh
# Open http://localhost:3000 and vote
```

---

## Day 4 — Full Demo

### Start all services

```bash
# Computer 1 (Tally Server):
./scripts/run_server.sh
./scripts/bundle_client.sh # Create evoting_client_bundle.tar.gz

# Computer 2 (Voter 1):
# Download evoting_client_bundle.tar.gz and extract it
./run_voter.sh

# Computer 3 (Voter 2):
# Download evoting_client_bundle.tar.gz and extract it
VOTER_ID=voter2 ./run_voter.sh

# Computer 4 (Voter 3):
# Download evoting_client_bundle.tar.gz and extract it
VOTER_ID=voter3 ./run_voter.sh
```

### Run the guided demo

```bash
# On Computer 1:
./scripts/demo_run.sh
```

### Manual demo controls

```bash
# Check election state at any time
./scripts/demo_tally.sh status

# After all 3 votes received:
./scripts/demo_tally.sh tally

# After all 3 shares received:
./scripts/demo_tally.sh combine

# Reset for another run:
./scripts/demo_tally.sh reset
```

---

## Folder Structure

```
evoting-system/
├── crypto/
│   ├── CMakeLists.txt
│   ├── build/               ← compiled binaries go here
│   └── src/
│       ├── setup.cpp         D1: generate shared CryptoContext
│       ├── keygen.cpp        D1: generate voter keypair
│       ├── encrypt_vote.cpp  D1: encrypt vote (arg: 0 or 1)
│       ├── tally.cpp         D2: homomorphic addition
│       ├── partial_decrypt.cpp D2: voter's decryption share
│       └── combine.cpp       D2: fuse shares → plaintext result
├── server/
│   ├── package.json
│   ├── server.js            REST API, runs on Computer 1 port 3001
│   └── data/
│       ├── ciphertexts/     enc_vote_<id>.bin files
│       ├── tally/           enc_tally.bin, final_result.txt
│       └── shares/          share_<id>.bin files
├── client/
│   ├── package.json
│   ├── client.js            REST API, runs on Computers 2/3/4 port 3000
│   └── data/
│       ├── keys/            public_key.bin, secret_key.bin
│       ├── tally/           enc_tally.bin (downloaded from server)
│       └── shares/          my_share.bin
├── web/
│   ├── index.html           Voting UI
│   └── vote.js              Browser logic
├── params/
│   └── crypto_params.bin    Shared across ALL computers
└── scripts/
    ├── build.sh
    ├── test_local.sh
    ├── network_check.sh
    ├── sync_params.sh
    ├── run_server.sh
    ├── run_voter.sh
    ├── demo_run.sh
    └── demo_tally.sh
```

---

## Server API Reference

| Method | Route | Description |
|--------|-------|-------------|
| GET | /health | Liveness check |
| GET | /status | Election state (votes, shares, phase) |
| POST | /vote | Receive encrypted vote (binary body, voter-id header) |
| POST | /tally | Trigger homomorphic tally (admin) |
| GET | /tally | Download enc_tally.bin |
| POST | /share | Receive partial decryption share (voter-id header) |
| POST | /combine | Fuse shares → final result (admin) |
| GET | /result | Read final plaintext result |
| POST | /reset | Wipe all data (demo helper) |

## Client API Reference

| Method | Route | Description |
|--------|-------|-------------|
| GET | /health | Liveness check |
| GET | /status | This voter's local state |
| POST | /vote | Browser submits YES/NO |
| POST | /partial-decrypt | Browser triggers share submission |

---

## Environment Variables

### server.js
| Variable | Default | Description |
|----------|---------|-------------|
| SERVER_PORT | 3001 | Port to listen on |
| EXPECTED_VOTERS | 3 | Number of voters expected |

### client.js
| Variable | Default | Description |
|----------|---------|-------------|
| CLIENT_PORT | 3000 | Port to listen on |
| SERVER_URL | http://localhost:3001 | Tally server address |
| VOTER_ID | voter1 | Unique ID for this voter |
# EVoting
