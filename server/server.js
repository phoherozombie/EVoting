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
const VOTERS_FILE = path.join(DIRS.voters, 'voters.json');

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

// ── Identity DB helpers ───────────────────────────────────────
function loadVoters() {
    try { return JSON.parse(fs.readFileSync(VOTERS_FILE, 'utf8')); } catch { return []; }
}
function saveVoters(list) {
    fs.mkdirSync(path.dirname(VOTERS_FILE), { recursive: true });
    fs.writeFileSync(VOTERS_FILE, JSON.stringify(list, null, 2));
}
function getAge(dob) {
    // dob: 'YYYY-MM-DD'
    const today = new Date();
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return -1;
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}
function validateCCCD(cccd) {
    return /^\d{12}$/.test(cccd);
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

    const { full_name, cccd, dob, address, phone } = req.body;

    // ── Validation ────────────────────────────────────────────
    if (!full_name || !full_name.trim())
        return res.status(400).json({ error: 'full_name is required.' });
    if (!cccd)
        return res.status(400).json({ error: 'cccd is required.' });
    if (!validateCCCD(cccd))
        return res.status(400).json({ error: 'cccd must be exactly 12 digits.' });
    if (!dob)
        return res.status(400).json({ error: 'dob (date of birth, YYYY-MM-DD) is required.' });
    if (!address || !address.trim())
        return res.status(400).json({ error: 'address is required.' });

    const age = getAge(dob);
    if (age < 0)
        return res.status(400).json({ error: 'dob is not a valid date.' });
    if (age < 18)
        return res.status(400).json({ error: `Voter must be at least 18 years old (current age: ${age}).` });

    // ── Uniqueness checks ─────────────────────────────────────
    const voters = loadVoters();
    if (voters.some(v => v.cccd === cccd))
        return res.status(409).json({ error: 'This CCCD is already registered.' });

    // Derive a unique, anonymised voter_id from the CCCD hash
    const voterId = 'voter_' + crypto.createHash('sha256').update(cccd).digest('hex').slice(0, 8);
    if (voters.some(v => v.voter_id === voterId) || Object.values(TOKENS).includes(voterId))
        return res.status(409).json({ error: 'Voter ID collision — please contact admin.' });

    // ── Persist identity record ───────────────────────────────
    const record = {
        voter_id: voterId,
        cccd,
        full_name: full_name.trim(),
        dob,
        address: address.trim(),
        phone: (phone || '').trim() || null,
        registered_at: new Date().toISOString(),
        has_voted: false
    };
    voters.push(record);
    saveVoters(voters);

    // ── Issue Eligibility Token ───────────────────────────────
    const token = crypto.randomBytes(32).toString('hex');
    TOKENS[token] = voterId;

    const existingKeys = readVoterList();
    const isFirst = existingKeys.length === 0 ? 1 : 0;
    console.log(`[register] New voter registered: ${voterId} | Name: ${full_name.trim()} (age ${age}, isFirst: ${isFirst})`);

    res.json({
        status: 'ok',
        message: 'Registration successful. Token generated. Client must now upload PK.',
        voter_id: voterId,
        token,
        isFirst
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

    const commitment = req.headers['x-ballot-commitment'] || null;

    fs.writeFileSync(voteFile, req.body);
    console.log(`[vote] Received encrypted vote from ${voterId} with commitment: ${commitment}`);

    // Mark has_voted in identity DB
    const voters = loadVoters();
    const voterRecord = voters.find(v => v.voter_id === voterId);
    if (voterRecord) {
        voterRecord.has_voted = true;
        voterRecord.commitment = commitment;
        saveVoters(voters);
    }

    const count = fs.readdirSync(DIRS.ciphertexts).filter(f => f.endsWith('.bin')).length;
    res.json({ status: 'ok', message: 'Encrypted vote recorded.', count });
});

// ── Admin: voter registry endpoints ──────────────────────────
app.get('/voters', (req, res) => {
    const voters = loadVoters();
    // Mask CCCD for privacy (show only last 4 digits)
    const masked = voters.map(v => ({
        voter_id: v.voter_id,
        full_name: v.full_name,
        cccd_masked: '••••••••' + v.cccd.slice(-4),
        dob: v.dob,
        address: v.address,
        registered_at: v.registered_at,
        has_voted: v.has_voted
    }));
    res.json({ count: masked.length, voters: masked });
});

app.get('/voter/:id', (req, res) => {
    const voters = loadVoters();
    const voter = voters.find(v => v.voter_id === req.params.id);
    if (!voter) return res.status(404).json({ error: 'Voter not found.' });
    // Return masked version
    res.json({
        voter_id: voter.voter_id,
        full_name: voter.full_name,
        cccd_masked: '••••••••' + voter.cccd.slice(-4),
        dob: voter.dob,
        address: voter.address,
        phone: voter.phone ? '••••' + voter.phone.slice(-4) : null,
        registered_at: voter.registered_at,
        has_voted: voter.has_voted
    });
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

// ── AUDIT & BALLOT VALIDITY ENDPOINTS ─────────────────────────
const REVEALS_FILE = path.join(DIRS.registry, 'reveals.json');
function loadReveals() {
    try { return JSON.parse(fs.readFileSync(REVEALS_FILE, 'utf8')); } catch { return []; }
}
function saveReveals(list) {
    fs.writeFileSync(REVEALS_FILE, JSON.stringify(list, null, 2));
}

app.post('/reveal-ballot', (req, res) => {
    const { candidateIndex, nonce } = req.body;
    if (typeof candidateIndex === 'undefined' || !nonce) {
        return res.status(400).json({ error: 'candidateIndex and nonce are required.' });
    }

    const commitment = crypto.createHash('sha256').update(candidateIndex + ':' + nonce).digest('hex');
    const voters = loadVoters();
    
    // Find if this commitment matches any voter's registered commitment
    const match = voters.find(v => v.commitment === commitment);
    if (!match) {
        return res.status(400).json({ error: 'Invalid reveal: no matching ballot commitment found.' });
    }

    // Check if this commitment was already revealed
    const reveals = loadReveals();
    if (reveals.some(r => r.commitment === commitment)) {
        return res.status(409).json({ error: 'This ballot has already been audited.' });
    }

    reveals.push({
        candidateIndex: parseInt(candidateIndex, 10),
        nonce,
        commitment
    });
    saveReveals(reveals);

    console.log(`[audit] Successfully validated and recorded anonymous reveal for commitment: ${commitment}`);
    res.json({ status: 'ok', message: 'Ballot commitment successfully verified and recorded.' });
});

app.get('/audit-status', (req, res) => {
    const voters = loadVoters().filter(v => v.has_voted && v.commitment);
    const totalCommitments = voters.length;
    
    const reveals = loadReveals();
    const totalReveals = reveals.length;
    
    let verification = 'pending';
    let details = {};
    
    if (fs.existsSync(FINAL_RESULT)) {
        const raw = fs.readFileSync(FINAL_RESULT, 'utf8').trim();
        const decryptedSum = {};
        for (const line of raw.split('\n')) {
            const m = line.match(/^CANDIDATE_(\d+):(\d+)$/);
            if (m) {
                decryptedSum[parseInt(m[1], 10)] = parseInt(m[2], 10);
            }
        }
        
        const revealedSum = {};
        for (const r of reveals) {
            revealedSum[r.candidateIndex] = (revealedSum[r.candidateIndex] || 0) + 1;
        }
        
        if (totalReveals === totalCommitments && totalCommitments > 0) {
            let match = true;
            const candidates = loadCandidates();
            for (const cand of candidates) {
                const decVal = decryptedSum[cand.id] || 0;
                const revVal = revealedSum[cand.id] || 0;
                if (decVal !== revVal) {
                    match = false;
                }
            }
            verification = match ? 'verified' : 'failed';
        } else if (totalCommitments > 0) {
            verification = 'pending';
        } else {
            verification = 'none';
        }
        
        details = {
            decryptedSum,
            revealedSum
        };
    }
    
    res.json({
        verification,
        total_commitments: totalCommitments,
        total_reveals: totalReveals,
        details
    });
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
    // voters.json is in DIRS.voters and gets cleared by the loop above

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