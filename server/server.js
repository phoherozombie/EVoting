// server/server.js  —  MK-FHE Tally Server
'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);

// ── Paths ─────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const CRYPTO_BIN = path.join(ROOT, 'crypto', 'build');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const DIRS = {
    keys: path.join(DATA_DIR, 'keys'),
    ciphertexts: path.join(DATA_DIR, 'ciphertexts'),
    tally: path.join(DATA_DIR, 'tally'),
    shares: path.join(DATA_DIR, 'shares'),
    registry: path.join(DATA_DIR, 'registry'),
    voters: path.join(DATA_DIR, 'voters')
};
Object.values(DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const VOTER_LIST = path.join(DIRS.keys, 'voter_list.txt');
const JOINT_PK = path.join(DIRS.keys, 'joint_pk.bin');
const ENC_TALLY = path.join(DIRS.tally, 'enc_tally.bin');
const FINAL_RESULT = path.join(DIRS.tally, 'final_result.txt');
const CANDIDATES_FILE = path.join(DATA_DIR, 'candidates.json');

// ── Helpers ───────────────────────────────────────────────────
function loadCandidates() {
    try {
        const raw = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
        return Array.isArray(raw.candidates) ? raw.candidates : raw;
    } catch {
        return [
            { id: 0, name: 'NO', club: '', nationality: '' },
            { id: 1, name: 'YES', club: '', nationality: '' },
        ];
    }
}

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function readVoterList() {
    if (!fs.existsSync(VOTER_LIST)) return [];
    return fs.readFileSync(VOTER_LIST, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
}

function runBinaryAsync(name, args = []) {
    return new Promise((resolve, reject) => {
        const bin = path.join(CRYPTO_BIN, name);
        if (!fs.existsSync(bin)) return reject(new Error(`Binary not found: ${bin}`));
        
        const child = spawn(bin, args, { cwd: ROOT });
        let out = '';
        let err = '';
        
        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => err += d);
        
        child.on('close', code => {
            if (code !== 0) reject(new Error(`${name} failed (${code}):\n${err}`));
            else resolve(out);
        });
        child.on('error', err => reject(err));
    });
}

// ── Authentication ────────────────────────────────────────────
// In-memory token store for demo: token -> voterId
const TOKENS = {};

function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.split(' ')[1];
    const voterId = TOKENS[token];
    
    if (!voterId) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Provide voterId down the chain
    req.voterId = voterId;
    next();
}

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
// Custom raw parser for binary uploads
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));

app.use((req, _res, next) => {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] ${req.method} ${req.path}`);
    next();
});

// ── Routes ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/status', (req, res) => {
    const st = loadState();
    const voters = readVoterList();
    const votes = fs.existsSync(DIRS.ciphertexts) ? fs.readdirSync(DIRS.ciphertexts).filter(f => f.endsWith('.bin')) : [];
    const shares = fs.existsSync(DIRS.shares) ? fs.readdirSync(DIRS.shares).filter(f => f.endsWith('.bin')) : [];
    
    let phase = 'registration';
    if (fs.existsSync(FINAL_RESULT)) phase = 'complete';
    else if (fs.existsSync(ENC_TALLY)) phase = 'decrypting';
    else if (st.finalized) phase = 'voting';

    let result = null;
    let results = null;
    const candidates = loadCandidates();

    if (phase === 'complete') {
        const raw = fs.readFileSync(FINAL_RESULT, 'utf8').trim();
        result = raw;
        const parsed = [];
        for (const line of raw.split('\n')) {
            const m = line.match(/^CANDIDATE_(\d+):(\d+)$/);
            if (m) {
                const idx = parseInt(m[1], 10);
                const cnt = parseInt(m[2], 10);
                const cand = candidates.find(c => c.id === idx) || { id: idx, name: `Candidate ${idx}` };
                parsed.push({ ...cand, votes: cnt });
            }
        }
        if (parsed.length > 0) {
            parsed.sort((a, b) => b.votes - a.votes);
            results = parsed;
        }
    }

    res.json({
        phase,
        candidates,
        voters,
        voters_count: voters.length,
        finalized: !!st.finalized,
        votes_received: votes.length,
        votes_expected: voters.length,
        tally_computed: fs.existsSync(ENC_TALLY),
        shares_received: shares.map(f => f.replace(/^share_/, '').replace(/\.bin$/, '')),
        shares_needed: voters,
        result,
        results
    });
});

app.get('/candidates', (req, res) => {
    res.json({ candidates: loadCandidates() });
});

// Admin configures candidates
app.post('/candidates', (req, res) => {
    const st = loadState();
    if (st.finalized) return res.status(409).json({ error: 'Cannot change candidates after registration is finalized.' });

    const { candidates } = req.body;
    if (!Array.isArray(candidates) || candidates.length === 0)
        return res.status(400).json({ error: 'candidates must be a non-empty array.' });

    fs.writeFileSync(CANDIDATES_FILE, JSON.stringify({ candidates }, null, 2));
    res.json({ status: 'ok', message: `${candidates.length} candidates saved.`, candidates });
});

// 1. REGISTRATION PHASE
app.post('/register', (req, res) => {
    const st = loadState();
    if (st.finalized) return res.status(409).json({ error: 'Registration is closed. Election finalized.' });

    let { fullName, cccd, voterId } = req.body;
    if (!voterId) voterId = `voter_${Date.now()}`;
    const id = voterId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    // Make sure voter isn't already registered
    const existing = readVoterList();
    if (existing.includes(id) || Object.values(TOKENS).includes(id)) {
        return res.status(409).json({ error: `'${id}' is already registered or currently registering.` });
    }

    // Generate JWT token
    const token = crypto.randomBytes(32).toString('hex');
    TOKENS[token] = id; // map token to voterId

    const isFirst = existing.length === 0 ? 1 : 0;
    console.log(`[register] Generated token for voter: ${id} (isFirst: ${isFirst})`);

    res.json({
        status: 'ok',
        message: 'Token generated. Client must now upload PK.',
        voterId: id,
        token: token,
        isFirst: isFirst
    });
});

app.get('/joint_pk', (req, res) => {
    if (!fs.existsSync(JOINT_PK)) return res.status(404).send('Joint public key not found');
    res.sendFile(JOINT_PK);
});

// Mutex for sequential PK updates
let pkUploadPromise = Promise.resolve();

app.post('/upload_pk', authenticate, (req, res) => {
    const st = loadState();
    if (st.finalized) return res.status(409).json({ error: 'Registration is closed.' });

    // Ensure strictly sequential processing of PK uploads to avoid chain corruption
    pkUploadPromise = pkUploadPromise.then(() => {
        return new Promise((resolve) => {
            const voterId = req.voterId;
            const existing = readVoterList();

            if (existing.includes(voterId)) {
                res.status(409).json({ error: 'Voter has already uploaded their PK.' });
                return resolve();
            }

            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                res.status(400).json({ error: 'Binary public key payload required.' });
                return resolve();
            }

            console.log(`[upload_pk] Received PK from ${voterId} (${req.body.length} bytes)`);

            // Overwrite joint_pk.bin
            fs.writeFileSync(JOINT_PK, req.body);
            // Backup their individual key
            fs.writeFileSync(path.join(DIRS.keys, `pk_${voterId}.bin`), req.body);
            
            // Append to voter list
            fs.appendFileSync(VOTER_LIST, voterId + '\n');

            res.json({ status: 'ok', message: `PK uploaded successfully. Joint key updated.` });
            resolve();
        });
    });
});

app.post('/finalize', (req, res) => {
    const voters = readVoterList();
    if (voters.length < 2) return res.status(400).json({ error: 'Need at least 2 registered voters.' });
    if (!fs.existsSync(JOINT_PK)) return res.status(400).json({ error: 'No joint PK found.' });

    const st = loadState();
    if (st.finalized) return res.status(409).json({ error: 'Already finalized.' });

    st.finalized = true;
    saveState(st);
    console.log(`[finalize] ✓ Election finalized with ${voters.length} voters.`);
    res.json({ status: 'ok', message: `Election finalized with ${voters.length} voters.`, voters });
});

// 2. VOTING PHASE
app.post('/vote', authenticate, (req, res) => {
    const st = loadState();
    if (!st.finalized) return res.status(409).json({ error: 'Registration not finalized yet.' });
    if (fs.existsSync(ENC_TALLY)) return res.status(409).json({ error: 'Election closed. Tallying started.' });

    const voterId = req.voterId;
    const voteFile = path.join(DIRS.ciphertexts, `enc_vote_${voterId}.bin`);

    if (fs.existsSync(voteFile)) return res.status(409).json({ error: 'You have already voted.' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Binary encrypted vote payload required.' });
    }

    fs.writeFileSync(voteFile, req.body);
    console.log(`[vote] Received encrypted vote from ${voterId}`);

    const count = fs.readdirSync(DIRS.ciphertexts).filter(f => f.endsWith('.bin')).length;
    res.json({ status: 'ok', message: 'Encrypted vote recorded.', count });
});

app.post('/tally', async (req, res) => {
    const st = loadState();
    if (!st.finalized) return res.status(409).json({ error: 'Not voting yet.' });

    const votes = fs.readdirSync(DIRS.ciphertexts).filter(f => f.endsWith('.bin'));
    if (votes.length === 0) return res.status(400).json({ error: 'No votes received yet.' });

    console.log(`[tally] Homomorphic tally over ${votes.length} votes...`);
    try {
        const out = await runBinaryAsync('tally');
        console.log(out);
        res.json({ status: 'ok', message: `Homomorphic tally computed over ${votes.length} votes.` });
    } catch (err) {
        console.error('[tally] ERROR:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/tally', (req, res) => {
    if (!fs.existsSync(ENC_TALLY)) return res.status(404).send('Tally not found');
    res.sendFile(ENC_TALLY);
});

// 3. DECRYPTION PHASE
app.post('/share', authenticate, async (req, res) => {
    const voterId = req.voterId;
    if (!fs.existsSync(ENC_TALLY)) return res.status(400).json({ error: 'Tally not computed yet.' });

    const shareFile = path.join(DIRS.shares, `share_${voterId}.bin`);
    if (fs.existsSync(shareFile)) return res.status(409).json({ error: 'Decryption share already submitted.' });

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Binary share payload required.' });
    }

    fs.writeFileSync(shareFile, req.body);
    console.log(`[share] Received decryption share from ${voterId}`);

    const voters = readVoterList();
    const shares = fs.readdirSync(DIRS.shares).filter(f => f.endsWith('.bin'));
    const submitted = shares.map(f => f.replace(/^share_/, '').replace(/\.bin$/, ''));
    const allIn = voters.every(v => submitted.includes(v));

    let result = null;
    if (allIn) {
        console.log('[share] All shares received! Running combine asynchronously...');
        try {
            const out = await runBinaryAsync('combine');
            console.log(out);
            if (fs.existsSync(FINAL_RESULT)) {
                result = fs.readFileSync(FINAL_RESULT, 'utf8').trim();
            }
        } catch (err) {
            console.error('[combine] ERROR:', err.message);
            return res.status(500).json({ error: 'Failed to combine shares: ' + err.message });
        }
    }

    res.json({
        status: 'ok',
        message: 'Share accepted.',
        submitted,
        all_in: allIn,
        result
    });
});

app.get('/result', (req, res) => {
    if (!fs.existsSync(FINAL_RESULT)) return res.status(404).json({ error: 'Result not available.' });
    res.json({ result: fs.readFileSync(FINAL_RESULT, 'utf8').trim() });
});

// 4. RESET
app.post('/reset', async (req, res) => {
    [DIRS.ciphertexts, DIRS.tally, DIRS.shares, DIRS.keys, DIRS.registry, DIRS.voters].forEach(dir => {
        if (fs.existsSync(dir)) fs.readdirSync(dir).forEach(f => {
            const fullPath = path.join(dir, f);
            if (!fs.statSync(fullPath).isDirectory()) fs.unlinkSync(fullPath);
        });
    });
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(CANDIDATES_FILE)) fs.unlinkSync(CANDIDATES_FILE);
    for (let key in TOKENS) delete TOKENS[key];

    console.log('[reset] All data cleared. Running setup...');
    try {
        await runBinaryAsync('setup');
        res.json({ message: 'Reset complete.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Auto-setup
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`=========================================`);
    console.log(` MK-FHE Server running on port ${PORT}`);
    console.log(`=========================================`);
    const paramsFile = path.join(ROOT, 'params', 'crypto_params.bin');
    if (!fs.existsSync(paramsFile)) {
        console.log('[setup] Generating CryptoContext...');
        try {
            await runBinaryAsync('setup');
            console.log('[setup] Ready.');
        } catch (e) {
            console.error('[setup] Failed:', e);
        }
    }
});