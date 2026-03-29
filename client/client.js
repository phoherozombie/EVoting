// =============================================================
// client/client.js  —  Voter Client  (Computers 2 / 3 / 4)
// Port: 3000  (override with CLIENT_PORT env var)
//
// Environment variables:
//   SERVER_URL   http://192.168.1.100:3001   tally server address
//   VOTER_ID     voter1 | voter2 | voter3
//   CLIENT_PORT  3000
//
// Routes:
//   GET  /          → serve voting HTML page
//   GET  /health    → liveness
//   GET  /status    → this voter's local state
//   POST /vote      → browser submits YES/NO
//   POST /partial-decrypt → browser triggers share submission
//
// Start:
//   SERVER_URL=http://192.168.1.100:3001 VOTER_ID=voter1 node client.js
// =============================================================
'use strict';

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const { spawnSync } = require('child_process');
const fetch    = require('node-fetch');

const app        = express();
const PORT       = parseInt(process.env.CLIENT_PORT || '3000', 10);
const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:3001').replace(/\/$/, '');
const VOTER_ID   = process.env.VOTER_ID   || 'voter1';

// ── Paths ─────────────────────────────────────────────────────
const ROOT       = path.join(__dirname, '..');
const CRYPTO_BIN = path.join(ROOT, 'crypto', 'build');
const DATA       = path.join(__dirname, 'data');
const KEYS_DIR   = path.join(DATA, 'keys');
const TALLY_DIR  = path.join(DATA, 'tally');
const SHARES_DIR = path.join(DATA, 'shares');

[KEYS_DIR, TALLY_DIR, SHARES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(ROOT, 'web')));

// ── Request logger ────────────────────────────────────────────
app.use((req, _res, next) => {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[${ts}] ${req.method} ${req.path}`);
    next();
});

// ── State ─────────────────────────────────────────────────────
let hasVoted          = false;
let shareSubmitted    = false;

// ── Helpers ───────────────────────────────────────────────────
function runBinary(name, args = []) {
    const bin = path.join(CRYPTO_BIN, name);
    if (!fs.existsSync(bin)) {
        throw new Error(
            `Binary not found: ${bin}\n` +
            `Build with: cd ${path.join(ROOT,'crypto','build')} && cmake .. && make`
        );
    }
    const result = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`${name} exited ${result.status}:\n${result.stderr || result.stdout}`);
    }
    console.log(result.stdout);
    return result.stdout;
}

async function fetchBinary(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
    }
    return res.buffer();
}

async function postBinary(url, buf, headers = {}) {
    const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...headers },
        body:    buf,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ── GET /health ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        voter:  VOTER_ID,
        server: SERVER_URL,
        hasVoted,
        shareSubmitted,
    });
});

// ── GET /status ───────────────────────────────────────────────
app.get('/status', (_req, res) => {
    const hasKeys      = fs.existsSync(path.join(KEYS_DIR, 'public_key.bin'));
    const hasVoteFile  = fs.existsSync(path.join(DATA, 'enc_vote.bin'));
    const hasTally     = fs.existsSync(path.join(TALLY_DIR, 'enc_tally.bin'));
    const hasShare     = fs.existsSync(path.join(SHARES_DIR, 'my_share.bin'));
    res.json({
        voter: VOTER_ID,
        server: SERVER_URL,
        keys_generated: hasKeys,
        vote_encrypted: hasVoteFile,
        has_voted: hasVoted,
        tally_downloaded: hasTally,
        share_submitted: shareSubmitted,
        share_produced: hasShare,
    });
});

// ── POST /vote ────────────────────────────────────────────────
// Called by the browser when voter clicks YES / NO
app.post('/vote', async (req, res) => {
    if (hasVoted) {
        return res.status(409).json({ error: 'You have already voted in this session.' });
    }

    const { vote } = req.body;
    if (vote !== 'yes' && vote !== 'no') {
        return res.status(400).json({ error: 'vote must be "yes" or "no"' });
    }
    const voteInt = vote === 'yes' ? '1' : '0';

    console.log(`\n[${VOTER_ID}] === VOTE PHASE ===`);
    console.log(`[${VOTER_ID}] Choice: ${vote.toUpperCase()} (${voteInt})`);

    try {
        // ── 1. Encrypt vote via C++ binary ───────────────────
        console.log(`[${VOTER_ID}] Running encrypt_vote ${voteInt}...`);
        runBinary('encrypt_vote', [voteInt]);

        // ── 2. Read ciphertext ───────────────────────────────
        const cipherPath = path.join(DATA, 'enc_vote.bin');
        if (!fs.existsSync(cipherPath)) {
            return res.status(500).json({ error: 'Ciphertext file not produced by encrypt_vote.' });
        }
        const cipherBuf = fs.readFileSync(cipherPath);
        console.log(`[${VOTER_ID}] Ciphertext: ${cipherBuf.length} bytes`);

        // ── 3. Send to tally server ──────────────────────────
        console.log(`[${VOTER_ID}] Sending to ${SERVER_URL}/vote ...`);
        const data = await postBinary(`${SERVER_URL}/vote`, cipherBuf, { 'voter-id': VOTER_ID });

        hasVoted = true;
        console.log(`[${VOTER_ID}] ✓ Vote sent. Server: ${data.message}`);

        res.json({
            status:  'ok',
            message: `Your ${vote.toUpperCase()} vote was encrypted and sent.`,
            server:  data,
        });

    } catch (err) {
        console.error(`[${VOTER_ID}] ERROR in /vote:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /partial-decrypt ─────────────────────────────────────
// Browser triggers this after all votes are cast
app.post('/partial-decrypt', async (req, res) => {
    if (shareSubmitted) {
        return res.status(409).json({ error: 'Decryption share already submitted.' });
    }

    console.log(`\n[${VOTER_ID}] === PARTIAL DECRYPT PHASE ===`);

    try {
        // ── 1. Download encrypted tally from server ──────────
        console.log(`[${VOTER_ID}] Downloading enc_tally.bin from ${SERVER_URL}/tally ...`);
        const tallyBuf = await fetchBinary(`${SERVER_URL}/tally`);
        const tallyPath = path.join(TALLY_DIR, 'enc_tally.bin');
        fs.writeFileSync(tallyPath, tallyBuf);
        console.log(`[${VOTER_ID}] Tally downloaded: ${tallyBuf.length} bytes`);

        // ── 2. Produce partial decryption share ──────────────
        console.log(`[${VOTER_ID}] Running partial_decrypt ...`);
        runBinary('partial_decrypt');

        // ── 3. Upload share to server ────────────────────────
        const sharePath = path.join(SHARES_DIR, 'my_share.bin');
        if (!fs.existsSync(sharePath)) {
            return res.status(500).json({ error: 'Share file not produced by partial_decrypt.' });
        }
        const shareBuf = fs.readFileSync(sharePath);
        console.log(`[${VOTER_ID}] Uploading share (${shareBuf.length} bytes) ...`);

        const data = await postBinary(`${SERVER_URL}/share`, shareBuf, { 'voter-id': VOTER_ID });
        shareSubmitted = true;

        console.log(`[${VOTER_ID}] ✓ Share submitted. Server: ${data.message}`);

        res.json({
            status:       'ok',
            message:      'Decryption share submitted.',
            ready_to_combine: data.ready_to_combine || false,
            server:       data,
        });

    } catch (err) {
        console.error(`[${VOTER_ID}] ERROR in /partial-decrypt:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║      MK-FHE  Voter Client  —  RUNNING        ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`  Voter    : ${VOTER_ID}`);
    console.log(`  Port     : ${PORT}`);
    console.log(`  Server   : ${SERVER_URL}`);
    console.log(`  Vote at  : http://localhost:${PORT}`);
    console.log(`  Status   : http://localhost:${PORT}/status`);
    console.log('');
});
