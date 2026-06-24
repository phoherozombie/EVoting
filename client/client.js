// =============================================================
// client/client.js  —  Voter Client  (Computers 2 / 3 / 4)
// Port: 3000  (override with CLIENT_PORT env var)
//
// Environment variables:
//   SERVER_URL   http://192.168.1.100:3001   tally server address
//   VOTER_ID     voter1 | voter2 | voter3
//   CLIENT_PORT  3000
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

function ensureDirectories() {
    [KEYS_DIR, TALLY_DIR, SHARES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
}
ensureDirectories();

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
let isRegistered      = false;
let authToken         = null;
let isFirstVoter      = false;

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

function resetLocalState() {
    console.log(`[${VOTER_ID}] Resetting local client state...`);
    [KEYS_DIR, TALLY_DIR, SHARES_DIR].forEach(dir => {
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(f => {
                const fullPath = path.join(dir, f);
                if (!fs.statSync(fullPath).isDirectory()) {
                    try { fs.unlinkSync(fullPath); } catch (e) {}
                }
            });
        }
    });
    const voteFile = path.join(DATA, 'enc_vote.bin');
    if (fs.existsSync(voteFile)) {
        try { fs.unlinkSync(voteFile); } catch (e) {}
    }
    hasVoted = false;
    shareSubmitted = false;
    isRegistered = false;
    authToken = null;
    isFirstVoter = false;
}

async function registerVoter(full_name, cccd, dob, address, phone) {
    if (isRegistered) throw new Error('Already registered in this session.');

    console.log(`[${VOTER_ID}] Attempting registration with server at ${SERVER_URL}...`);
    const res = await fetch(`${SERVER_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, cccd, dob, address, phone })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    authToken   = data.token;
    // Support both old (voterId) and new (voter_id) field name
    const resolvedId = data.voter_id || data.voterId;
    isFirstVoter = data.isFirst === 1;
    console.log(`[${resolvedId}] Registered. Token acquired. isFirst: ${isFirstVoter}`);

    ensureDirectories();
    const tempJointPk = path.join(KEYS_DIR, 'temp_joint_pk.bin');
    if (!isFirstVoter) {
        console.log(`[${resolvedId}] Downloading current joint_pk.bin from server...`);
        const jointPkBuf = await fetchBinary(`${SERVER_URL}/joint_pk`);
        fs.writeFileSync(tempJointPk, jointPkBuf);
        console.log(`[${resolvedId}] Joint PK downloaded (${jointPkBuf.length} bytes)`);
    }

    const outSk = path.join(KEYS_DIR, 'secret_key.bin');
    const outPk = path.join(KEYS_DIR, 'public_key.bin');
    const paramsFile = path.join(ROOT, 'params', 'crypto_params.bin');
    const dummyPk = path.join(KEYS_DIR, 'dummy.bin');
    if (isFirstVoter) {
        fs.writeFileSync(dummyPk, Buffer.alloc(0));
    }

    console.log(`[${resolvedId}] Running voter_keygen binary...`);
    runBinary('voter_keygen', [
        resolvedId,
        isFirstVoter ? '1' : '0',
        isFirstVoter ? dummyPk : tempJointPk,
        outSk,
        outPk,
        paramsFile
    ]);

    console.log(`[${resolvedId}] Uploading public key share to server...`);
    const pkBuf = fs.readFileSync(outPk);
    await postBinary(`${SERVER_URL}/upload_pk`, pkBuf, {
        'Authorization': `Bearer ${authToken}`
    });

    isRegistered = true;
    console.log(`[${resolvedId}] ✓ Registration and key generation complete.`);
    return { voter_id: resolvedId, isFirst: isFirstVoter };
}


// ── GET /health ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        voter:  VOTER_ID,
        server: SERVER_URL,
        is_registered: isRegistered,
        hasVoted,
        shareSubmitted,
    });
});

// ── GET /candidates ─────────────────────────────────────────
app.get('/candidates', async (_req, res) => {
    try {
        const upstream = await fetch(`${SERVER_URL}/candidates`);
        if (!upstream.ok) {
            const text = await upstream.text();
            return res.status(upstream.status).json({ error: text });
        }
        const data = await upstream.json();
        res.json(data);
    } catch (err) {
        console.error(`[${VOTER_ID}] /candidates proxy error:`, err.message);
        res.status(502).json({ error: `Cannot reach tally server: ${err.message}` });
    }
});

// ── GET /status ───────────────────────────────────────────────
app.get('/status', async (_req, res) => {
    const hasKeys      = fs.existsSync(path.join(KEYS_DIR, 'public_key.bin')) && fs.existsSync(path.join(KEYS_DIR, 'secret_key.bin'));
    const hasVoteFile  = fs.existsSync(path.join(DATA, 'enc_vote.bin'));
    const hasTally     = fs.existsSync(path.join(TALLY_DIR, 'enc_tally.bin'));
    const hasShare     = fs.existsSync(path.join(SHARES_DIR, 'my_share.bin'));

    const local = {
        voter: VOTER_ID,
        server: SERVER_URL,
        is_registered: isRegistered,
        keys_generated: hasKeys,
        vote_encrypted: hasVoteFile,
        has_voted: hasVoted,
        tally_downloaded: hasTally,
        share_submitted: shareSubmitted,
        share_produced: hasShare,
    };

    try {
        const upstream = await fetch(`${SERVER_URL}/status`);
        if (upstream.ok) {
            const serverState = await upstream.json();
            const voters = serverState.voters || [];
            if (isRegistered && !voters.includes(VOTER_ID)) {
                console.log(`[${VOTER_ID}] Detected server reset (not in voter list). Resetting local client state.`);
                resetLocalState();
                local.is_registered = false;
                local.keys_generated = false;
                local.vote_encrypted = false;
                local.has_voted = false;
                local.tally_downloaded = false;
                local.share_submitted = false;
                local.share_produced = false;
            }
            return res.json({ ...serverState, ...local });
        }
    } catch (_) { /* server unreachable */ }

    res.json(local);
});

// ── POST /client-register ────────────────────────────────────
// Bridge: browser submits voter PII → we call tally server → run keygen → upload PK
app.post('/client-register', async (req, res) => {
    if (isRegistered) {
        return res.status(409).json({ error: 'Already registered in this session.' });
    }

    const { full_name, cccd, dob, address, phone } = req.body;
    // Basic presence checks (full validation is done server-side)
    if (!full_name || !cccd || !dob || !address) {
        return res.status(400).json({ error: 'full_name, cccd, dob, and address are required.' });
    }

    try {
        const result = await registerVoter(full_name, cccd, dob, address, phone);
        res.json({
            status: 'ok',
            message: 'Voter registered and keys generated successfully.',
            voter_id: result.voter_id,
            isFirst: result.isFirst
        });
    } catch (err) {
        console.error(`[client-register] ERROR:`, err.message);
        res.status(400).json({ error: err.message });
    }
});

// ── POST /vote ───────────────────────────────────────────────
app.post('/vote', async (req, res) => {
    if (!isRegistered || !authToken) {
        return res.status(400).json({ error: 'Client registration not completed yet.' });
    }
    if (hasVoted) {
        return res.status(409).json({ error: 'You have already voted in this session.' });
    }

    let candidateIndex;
    if (typeof req.body.candidateIndex !== 'undefined') {
        candidateIndex = parseInt(req.body.candidateIndex, 10);
        if (isNaN(candidateIndex) || candidateIndex < 0) {
            return res.status(400).json({ error: 'candidateIndex must be a non-negative integer' });
        }
    } else {
        return res.status(400).json({ error: 'candidateIndex (integer) is required' });
    }

    const voteInt = String(candidateIndex);

    console.log(`\n[${VOTER_ID}] === VOTE PHASE ===`);
    console.log(`[${VOTER_ID}] Choice: candidate[${candidateIndex}]`);

    try {
        // ── 1. Download current joint_pk.bin to ensure we have the finalized joint key ──
        console.log(`[${VOTER_ID}] Downloading current joint_pk.bin from server...`);
        const jointPkBuf = await fetchBinary(`${SERVER_URL}/joint_pk`);
        const tempJointPk = path.join(KEYS_DIR, 'temp_joint_pk.bin');
        fs.writeFileSync(tempJointPk, jointPkBuf);
        console.log(`[${VOTER_ID}] Joint PK downloaded (${jointPkBuf.length} bytes)`);

        // ── 2. Encrypt vote via C++ binary ──────────────────
        const outEncVote = path.join(DATA, 'enc_vote.bin');
        const paramsFile = path.join(ROOT, 'params', 'crypto_params.bin');
        console.log(`[${VOTER_ID}] Running encrypt_vote ${voteInt}...`);
        runBinary('encrypt_vote', [voteInt, tempJointPk, outEncVote, paramsFile]);

        if (!fs.existsSync(outEncVote)) {
            return res.status(500).json({ error: 'Ciphertext file not produced by encrypt_vote.' });
        }
        const cipherBuf = fs.readFileSync(outEncVote);
        console.log(`[${VOTER_ID}] Ciphertext: ${cipherBuf.length} bytes`);

        // ── 3. Send to tally server with authentication ──────────────────
        console.log(`[${VOTER_ID}] Sending to ${SERVER_URL}/vote ...`);
        const data = await postBinary(`${SERVER_URL}/vote`, cipherBuf, {
            'Authorization': `Bearer ${authToken}`
        });

        hasVoted = true;
        console.log(`[${VOTER_ID}] ✓ Vote sent. Server: ${data.message}`);

        res.json({
            status:  'ok',
            message: `Your vote for candidate[${candidateIndex}] was encrypted and sent.`,
            server:  data,
        });

    } catch (err) {
        console.error(`[${VOTER_ID}] ERROR in /vote:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /partial-decrypt ─────────────────────────────────────
app.post('/partial-decrypt', async (req, res) => {
    if (!isRegistered || !authToken) {
        return res.status(400).json({ error: 'Client registration not completed yet.' });
    }
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
        const inSk = path.join(KEYS_DIR, 'secret_key.bin');
        const outShare = path.join(SHARES_DIR, 'my_share.bin');
        const paramsFile = path.join(ROOT, 'params', 'crypto_params.bin');
        
        runBinary('voter_partial_decrypt', [
            VOTER_ID,
            isFirstVoter ? '1' : '0',
            inSk,
            tallyPath,
            outShare,
            paramsFile
        ]);

        if (!fs.existsSync(outShare)) {
            return res.status(500).json({ error: 'Share file not produced by voter_partial_decrypt.' });
        }
        const shareBuf = fs.readFileSync(outShare);
        console.log(`[${VOTER_ID}] Uploading share (${shareBuf.length} bytes) ...`);

        const data = await postBinary(`${SERVER_URL}/share`, shareBuf, {
            'Authorization': `Bearer ${authToken}`
        });
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
