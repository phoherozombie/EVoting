# Current Architecture Inventory Report

## 1. Project Structure

```text
.
├── client/
│   ├── client.js           # Voter node application
│   └── data/               # Local voter storage
│       ├── keys/
│       ├── shares/
│       └── tally/
├── crypto/
│   ├── CMakeLists.txt
│   └── src/                # OpenFHE C++ binaries source
│       ├── combine.cpp
│       ├── encrypt_vote.cpp
│       ├── keygen.cpp
│       ├── partial_decrypt.cpp
│       ├── setup.cpp
│       ├── tally.cpp
│       ├── voter_keygen.cpp
│       └── voter_partial_decrypt.cpp
├── params/
│   └── crypto_params.bin   # FHE CryptoContext parameters
├── scripts/                # Bash/Node automation scripts
├── server/
│   ├── data/               # Server storage
│   │   ├── ciphertexts/
│   │   ├── keys/
│   │   ├── registry/
│   │   ├── shares/
│   │   ├── tally/
│   │   └── voters/
│   └── server.js           # Main Tally Server
└── web/
    ├── index.html          # Frontend UI
    └── vote.js             # Frontend logic
```

## 2. API Inventory

### Authentication & Registration

**POST /register**
* **Route:** `/register`
* **Request body:** `{ "voterId": "...", "fullName": "...", "cccd": "..." }`
* **Headers:** `Content-Type: application/json`
* **Authentication:** None
* **Response format:** `{ status, message, voterId, token, isFirst }`
* **Current storage logic:** Reads `voter_list.txt` to check duplicates. Updates in-memory `TOKENS` dictionary.

**POST /upload_pk**
* **Route:** `/upload_pk`
* **Request body:** Binary payload (`application/octet-stream`)
* **Headers:** `Authorization: Bearer <token>`
* **Authentication:** Required (Bearer Token)
* **Response format:** `{ status, message }`
* **Current storage logic:** Overwrites `keys/joint_pk.bin`. Creates individual backup `keys/pk_<voterId>.bin`. Appends voter ID to `voter_list.txt`.

**GET /joint_pk**
* **Route:** `/joint_pk`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** Binary stream
* **Current storage logic:** Reads and serves `keys/joint_pk.bin`.

**POST /finalize**
* **Route:** `/finalize`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** `{ status, message, voters }`
* **Current storage logic:** Reads `voter_list.txt`. Updates `state.json` setting `finalized: true`.

### Election Phase

**POST /vote**
* **Route:** `/vote`
* **Request body:** Binary payload (`application/octet-stream`)
* **Headers:** `Authorization: Bearer <token>`
* **Authentication:** Required (Bearer Token)
* **Response format:** `{ status, message, count }`
* **Current storage logic:** Writes payload to `ciphertexts/enc_vote_<voterId>.bin`.

**POST /tally**
* **Route:** `/tally`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** `{ status, message }`
* **Current storage logic:** Executes C++ binary `tally` which reads from `ciphertexts/` and outputs to `tally/enc_tally.bin`.

**GET /tally**
* **Route:** `/tally`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** Binary stream
* **Current storage logic:** Reads and serves `tally/enc_tally.bin`.

### Decryption Phase

**POST /share**
* **Route:** `/share`
* **Request body:** Binary payload (`application/octet-stream`)
* **Headers:** `Authorization: Bearer <token>`
* **Authentication:** Required (Bearer Token)
* **Response format:** `{ status, message, submitted, all_in, result }`
* **Current storage logic:** Writes payload to `shares/share_<voterId>.bin`. If all shares received, executes C++ `combine` binary which generates `tally/final_result.txt`.

**GET /result**
* **Route:** `/result`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** `{ result }`
* **Current storage logic:** Reads `tally/final_result.txt`.

### Utility

**GET /status**
* **Route:** `/status`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** JSON object mapping election state, votes received, tally status, etc.
* **Current storage logic:** Reads `state.json`, `voter_list.txt`, `candidates.json`, and scans `ciphertexts/` and `shares/` directories.

**GET /candidates**
* **Route:** `/candidates`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** `{ candidates: [...] }`
* **Current storage logic:** Reads `candidates.json`.

**POST /candidates**
* **Route:** `/candidates`
* **Request body:** `{ candidates: [...] }`
* **Headers:** `Content-Type: application/json`
* **Authentication:** None
* **Response format:** `{ status, message, candidates }`
* **Current storage logic:** Overwrites `candidates.json`.

**POST /reset**
* **Route:** `/reset`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** `{ message }`
* **Current storage logic:** Deletes all files in all data directories. Executes C++ `setup` binary.

**GET /health**
* **Route:** `/health`
* **Request body:** None
* **Headers:** None
* **Authentication:** None
* **Response format:** `{ status: "ok" }`
* **Current storage logic:** None.

## 3. Data Storage Inventory

### Server-Side Storage (`server/data/`)
* **`state.json`**:
  * **Purpose:** Stores the election state flag.
  * **Example content:** `{ "finalized": true }`
  * **Read locations:** Almost all endpoints via `loadState()`.
  * **Write locations:** `POST /finalize` via `saveState()`.
* **`candidates.json`**:
  * **Purpose:** Stores candidate details.
  * **Example content:** `{ "candidates": [ { "id": 0, "name": "Lionel Messi" } ] }`
  * **Read locations:** `GET /candidates`, `GET /status`.
  * **Write locations:** `POST /candidates`.
* **`keys/voter_list.txt`**:
  * **Purpose:** Registry of registered voter IDs.
  * **Example content:** `voter1\nvoter2`
  * **Read locations:** `GET /status`, `POST /register`, `POST /upload_pk`, `POST /finalize`, `POST /share`.
  * **Write locations:** `POST /upload_pk`.
* **`keys/joint_pk.bin`**:
  * **Purpose:** Holds the aggregated multi-key public key.
  * **Read locations:** `GET /joint_pk`.
  * **Write locations:** `POST /upload_pk`.
* **`keys/pk_<voterId>.bin`**:
  * **Purpose:** Backup of an individual voter's public key.
  * **Read locations:** Never actively read in the JS flow (used as a backup).
  * **Write locations:** `POST /upload_pk`.
* **`ciphertexts/enc_vote_<voterId>.bin`**:
  * **Purpose:** Encrypted vote submitted by a voter.
  * **Read locations:** `POST /tally` (C++ binary reads it), `GET /status` (counts files).
  * **Write locations:** `POST /vote`.
* **`tally/enc_tally.bin`**:
  * **Purpose:** Homomorphically aggregated ciphertext of all votes.
  * **Read locations:** `GET /tally`, `GET /status`, `POST /share` (C++ combine reads it).
  * **Write locations:** `POST /tally` (C++ binary produces it).
* **`tally/final_result.txt`**:
  * **Purpose:** Plaintext result after threshold decryption.
  * **Example content:** `CANDIDATE_0:3\nCANDIDATE_1:1`
  * **Read locations:** `GET /status`, `GET /result`, `POST /share`.
  * **Write locations:** `POST /share` (C++ binary `combine` produces it).
* **`shares/share_<voterId>.bin`**:
  * **Purpose:** Partial decryption shares from voters.
  * **Read locations:** `POST /share` (C++ `combine` reads them), `GET /status`.
  * **Write locations:** `POST /share`.

### Client-Side Storage (`client/data/`)
* **`keys/secret_key.bin`**: Voter's locally kept secret key.
* **`keys/public_key.bin`**: Voter's locally generated public key.
* **`keys/temp_joint_pk.bin`**: Fetched joint PK used for encryption/generation.
* **`enc_vote.bin`**: Produced locally before sending to server.
* **`tally/enc_tally.bin`**: Fetched from server to produce share.
* **`shares/my_share.bin`**: Produced locally before sending to server.

## 4. Cryptographic Assets

* **`crypto_params.bin`**
  * **Producer:** `setup` (Server)
  * **Consumer:** All C++ binaries (Server & Client)
  * **Location:** `params/`
* **`joint_pk.bin`**
  * **Producer:** `voter_keygen` (Client) and `upload_pk` (Server overwrites)
  * **Consumer:** `encrypt_vote` (Client)
  * **Location:** `server/data/keys/` and `client/data/keys/temp_joint_pk.bin`
* **`secret_key.bin`**
  * **Producer:** `voter_keygen` (Client)
  * **Consumer:** `voter_partial_decrypt` (Client)
  * **Location:** `client/data/keys/`
* **`public_key.bin`**
  * **Producer:** `voter_keygen` (Client)
  * **Consumer:** `upload_pk` API (Server)
  * **Location:** `client/data/keys/`
* **`enc_vote_<voterId>.bin`**
  * **Producer:** `encrypt_vote` (Client)
  * **Consumer:** `tally` (Server)
  * **Location:** `client/data/` (as `enc_vote.bin`), `server/data/ciphertexts/`
* **`enc_tally.bin`**
  * **Producer:** `tally` (Server)
  * **Consumer:** `voter_partial_decrypt` (Client), `combine` (Server)
  * **Location:** `server/data/tally/` and `client/data/tally/`
* **`share_<voterId>.bin`**
  * **Producer:** `voter_partial_decrypt` (Client)
  * **Consumer:** `combine` (Server)
  * **Location:** `client/data/shares/` (as `my_share.bin`), `server/data/shares/`

## 5. Authentication System

* **How tokens are generated:** Random 32-byte hex strings are generated using Node's `crypto.randomBytes(32).toString('hex')` upon a successful `POST /register` call.
* **Where tokens are stored:** 
  * Server: In-memory JavaScript object `const TOKENS = {};` mapping `token` -> `voterId`.
  * Client: In-memory JavaScript variable `let authToken = null;` inside `client/client.js`.
* **How tokens are validated:** The `authenticate` middleware in `server/server.js` checks the `Authorization: Bearer <token>` header against the `TOKENS` object.
* **How voter identity is mapped:** If the token exists in `TOKENS`, the middleware assigns `req.voterId = TOKENS[token]` and passes control to the next handler. All subsequent actions (upload PK, vote, share) map to this securely authenticated identity.

## 6. State Machine

The election logic is derived from a combination of `state.finalized` and file presence checks in `GET /status`.

* **REGISTRATION** (`!state.finalized` && `!enc_tally.bin`)
  * **Allowed endpoints:** `/register`, `/upload_pk`, `/candidates` (POST), `/joint_pk`, `/finalize`.
  * **Forbidden endpoints:** `/vote`, `/tally`, `/share`.
* **VOTING** (`state.finalized == true` && `!enc_tally.bin`)
  * **Allowed endpoints:** `/vote`, `/tally`.
  * **Forbidden endpoints:** `/register`, `/upload_pk`, `/candidates` (POST), `/finalize`.
* **DECRYPTING** (`enc_tally.bin` exists && `!final_result.txt`)
  * **Allowed endpoints:** `/share`, `/tally` (GET).
  * **Forbidden endpoints:** `/vote`, `/register`.
* **RESULTS** (`final_result.txt` exists)
  * **Allowed endpoints:** `/result`.
  * **Forbidden endpoints:** All write endpoints are effectively concluded.

## 7. Database Migration Mapping

| Current File | Suggested Table | Reason |
| :--- | :--- | :--- |
| `keys/voter_list.txt` | `voters` | Needs structured querying (id, fullName, cccd, registered_at). |
| `state.json` | `election_state` | Single-row table to store `phase` or `is_finalized` flag permanently. |
| `candidates.json` | `candidates` | Needs structured IDs, names, clubs, nationalities. |
| `const TOKENS = {}` | `voter_sessions` | Memory is volatile; auth tokens need persistence across server restarts. |
| `ciphertexts/enc_vote_*.bin` | `votes` | Move byte blobs to `bytea` columns mapping voter_id -> encrypted_vote. |
| `shares/share_*.bin` | `decryption_shares`| Move byte blobs to `bytea` columns mapping voter_id -> share_data. |

## 8. PostgreSQL Readiness Assessment

* **What can move into PostgreSQL:**
  * Voter identities and demographics (`voters`).
  * Authentication sessions (`voter_sessions`).
  * Candidate profiles (`candidates`).
  * Global election state (`election_state`).
  * Encrypted vote blobs and decryption shares (`bytea` payload storage).
* **What must remain on disk:**
  * The OpenFHE C++ binaries require physical files as inputs/outputs. While the Node.js server can pull `bytea` blobs from PostgreSQL, it will likely need to write them to temporary files (e.g., `/tmp/enc_vote_voter1.bin`) right before invoking `runBinaryAsync()`, and then read the output files to store them back into PostgreSQL.
  * `params/crypto_params.bin` is static and should remain a file.
* **Potential migration risks:**
  * File I/O overhead mapping DB blobs to temp files for C++ execution.
  * Transaction safety: Node.js currently relies on sequential file writing (`pkUploadPromise`). DB migrations need strict transaction isolation (e.g., `SERIALIZABLE` or `pg-promise` transactions) to prevent race conditions during Joint PK generation.

## 9. Code Locations

**`server/server.js`**
* **Registration logic:** Lines 184-212 (`app.post('/register')`)
* **Voting logic:** Lines 273-291 (`app.post('/vote')`)
* **Share upload logic:** Lines 317-358 (`app.post('/share')`)
* **Authentication middleware:** Lines 84-99 (`function authenticate`)
* **State machine (Status):** Lines 116-164 (`app.get('/status')`)
* **File storage functions:** Lines 48-58 (`loadState`, `saveState`, `readVoterList`)

**`client/client.js`**
* **Registration / Keygen loop:** Lines 116-176 (`async function runRegistrationLoop()`)
* **Voting logic:** Lines 253-316 (`app.post('/vote')`)
* **Share upload logic:** Lines 318-376 (`app.post('/partial-decrypt')`)
