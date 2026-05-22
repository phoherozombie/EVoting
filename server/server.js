// =============================================================
// server/server.js  —  MK-FHE Multi-Key E-Voting Server
// Real threshold decryption: every voter must contribute a share.
//
// Election phases:
//   registration → voting → tallied → decrypting → complete
//
// Start:
//   node server.js
//   EXPECTED_VOTERS=3 node server.js
// =============================================================
'use strict';

const express       = require('express');
const cors          = require('cors');
const fs            = require('fs');
const path          = require('path');
const crypto        = require('crypto');
const { spawnSync } = require('child_process');

const app  = express();
const PORT = parseInt(process.env.SERVER_PORT    || '3001', 10);

// ── Paths ─────────────────────────────────────────────────────
const ROOT       = path.join(__dirname, '..');
const CRYPTO_BIN = path.join(ROOT, 'crypto', 'build');
const PARAMS_DIR = path.join(ROOT, 'params');
const DATA_DIR   = path.join(ROOT, 'server', 'data');
const DIRS = {
    keys:        path.join(DATA_DIR, 'keys'),
    ciphertexts: path.join(DATA_DIR, 'ciphertexts'),
    tally:       path.join(DATA_DIR, 'tally'),
    shares:      path.join(DATA_DIR, 'shares'),
    registry:    path.join(DATA_DIR, 'registry'),
    voters:      path.join(DATA_DIR, 'voters')
};
Object.values(DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));
fs.mkdirSync(PARAMS_DIR, { recursive: true });

const STATE_FILE     = path.join(DATA_DIR, 'state.json');
const VOTER_LIST     = path.join(DIRS.keys, 'voter_list.txt');
const JOINT_PK       = path.join(DIRS.keys, 'joint_pk.bin');
const ENC_TALLY      = path.join(DIRS.tally, 'enc_tally.bin');
const FINAL_RESULT   = path.join(DIRS.tally, 'final_result.txt');
const CCCD_INDEX     = path.join(DIRS.registry, 'cccd_index.json');

function loadCCCDIndex() {
    try { return JSON.parse(fs.readFileSync(CCCD_INDEX, 'utf8')); } catch { return {}; }
}
function saveCCCDIndex(idx) {
    fs.writeFileSync(CCCD_INDEX, JSON.stringify(idx, null, 2));
}

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] ${req.method} ${req.path}`);
    next();
});

// ── Helpers ───────────────────────────────────────────────────
function runBinary(name, args = []) {
    const bin = path.join(CRYPTO_BIN, name);
    if (!fs.existsSync(bin))
        throw new Error(`Binary not found: ${bin}\nRun: ./scripts/build.sh`);
    const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', env: process.env });
    if (r.status !== 0)
        throw new Error(`${name} failed:\n${r.stderr || r.stdout}`);
    return r.stdout;
}

function readVoterList() {
    if (!fs.existsSync(VOTER_LIST)) return [];
    return fs.readFileSync(VOTER_LIST, 'utf8')
             .split('\n').map(s => s.trim()).filter(Boolean);
}

function listBins(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.bin')).sort();
}

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ── Derived election state ────────────────────────────────────
function electionState() {
    const st            = loadState();
    const voters        = readVoterList();
    const votes         = listBins(DIRS.ciphertexts);
    const shares        = listBins(DIRS.shares);
    const hasTally      = fs.existsSync(ENC_TALLY);
    const hasResult     = fs.existsSync(FINAL_RESULT);
    const result        = hasResult ? fs.readFileSync(FINAL_RESULT, 'utf8').trim() : null;
    const finalized     = !!st.finalized;

    // Phase logic
    let phase;
    if (hasResult)                               phase = 'complete';
    else if (hasTally)                           phase = 'decrypting';
    else if (finalized && voters.length > 0)     phase = 'voting';
    else                                         phase = 'registration';

    return {
        phase,
        voters,
        voters_count:    voters.length,
        finalized,
        votes_received:  votes.length,
        votes_expected:  voters.length,
        tally_computed:  hasTally,
        shares_received: shares.map(f => f.replace(/^share_/, '').replace(/\.bin$/, '')),
        shares_needed:   voters,
        result,
    };
}

// ── Auto-setup (CryptoContext) ────────────────────────────────
function ensureSetup() {
    const paramsFile = path.join(PARAMS_DIR, 'crypto_params.bin');
    if (!fs.existsSync(paramsFile)) {
        console.log('[setup] Generating shared CryptoContext...');
        runBinary('setup');
        console.log('[setup] ✓ CryptoContext ready.');
    }
}

// ══════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════

app.get('/', (_req, res) => res.send(getVotingPage()));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/status', (_req, res) => res.json(electionState()));

// ── POST /register  ───────────────────────────────────────────
// Body: { fullName: "...", cccd: "...", dob: "...", address: "...", contact: "...", voterId: "..." (optional) }
// Registers a new voter, generates their keypair, updates joint_pk.
app.post('/register', (req, res) => {
    let { fullName, cccd, dob, address, contact, voterId } = req.body;
    
    // For backward compatibility with old script
    if (voterId && !fullName && !cccd) {
        fullName = voterId;
        cccd = voterId; // Mock cccd if running old demo script
    }

    if (!fullName || !fullName.trim())
        return res.status(400).json({ error: 'fullName is required' });
    if (!cccd || !cccd.trim())
        return res.status(400).json({ error: 'cccd is required' });

    const st = loadState();
    if (st.finalized)
        return res.status(409).json({ error: 'Registration is closed. Election already finalized.' });

    const cccdHash = crypto.createHash('sha256').update(cccd.trim()).digest('hex');
    const index = loadCCCDIndex();
    if (index[cccdHash]) {
        return res.status(409).json({ error: 'CCCD is already registered.' });
    }

    if (!voterId || !voterId.trim()) {
        voterId = `voter_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    }
    const id = voterId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    
    const existing = readVoterList();
    if (existing.includes(id))
        return res.status(409).json({ error: `'${id}' is already registered.` });

    console.log(`[register] Registering voter: ${fullName} (ID: ${id})`);
    try {
        const out = runBinary('voter_keygen', [id]);
        console.log(out);
        
        // Save to voters directory
        const voterDir = path.join(DIRS.voters, id);
        fs.mkdirSync(voterDir, { recursive: true });
        
        const profile = {
            voter_id: id,
            full_name: fullName.trim(),
            cccd: cccd.trim(), // In a real system, do not store plain CCCD. Storing here for demo validation
            cccd_hash: cccdHash,
            dob: dob ? dob.trim() : '',
            address: address ? address.trim() : '',
            contact: contact ? contact.trim() : '',
            registered_at: new Date().toISOString(),
            public_key_path: path.join(DIRS.keys, `pk_${id}.bin`),
            private_key_metadata: `Demo Mode: Secret key generated on server at ${path.join(DIRS.keys, `sk_${id}.bin`)}`
        };
        fs.writeFileSync(path.join(voterDir, 'profile.json'), JSON.stringify(profile, null, 2));
        fs.writeFileSync(path.join(voterDir, 'status.json'), JSON.stringify({ voted: false, shared_decryption: false }, null, 2));
        
        index[cccdHash] = id;
        saveCCCDIndex(index);
        
        const voters = readVoterList();
        res.json({
            status:  'ok',
            message: `Voter '${fullName}' registered. Joint key updated.`,
            voters,
            voter_id: id
        });
    } catch (err) {
        console.error('[register] ERROR:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /finalize  ───────────────────────────────────────────
// Locks registration. No new voters after this.
app.post('/finalize', (req, res) => {
    const voters = readVoterList();
    if (voters.length < 2)
        return res.status(400).json({ error: 'Need at least 2 registered voters to finalize.' });
    if (!fs.existsSync(JOINT_PK))
        return res.status(400).json({ error: 'No joint public key found. Register voters first.' });

    const st = loadState();
    if (st.finalized)
        return res.status(409).json({ error: 'Already finalized.' });

    st.finalized = true;
    saveState(st);
    console.log(`[finalize] ✓ Election finalized with ${voters.length} voters.`);
    res.json({
        status:  'ok',
        message: `Election finalized with ${voters.length} voters. Voting is now open.`,
        voters,
    });
});

// ── POST /vote  ───────────────────────────────────────────────
// Body: { voterId: "alice", vote: "yes"|"no" }
app.post('/vote', (req, res) => {
    const { voterId, vote } = req.body;
    if (!voterId || typeof voterId !== 'string' || !voterId.trim())
        return res.status(400).json({ error: 'voterId is required' });
    if (vote !== 'yes' && vote !== 'no')
        return res.status(400).json({ error: 'vote must be "yes" or "no"' });

    const st = loadState();
    if (!st.finalized)
        return res.status(409).json({ error: 'Registration not finalized yet.' });

    const id = voterId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const voters = readVoterList();
    if (!voters.includes(id))
        return res.status(403).json({ error: `'${id}' is not a registered voter.` });

    const voteFile = path.join(DIRS.ciphertexts, `enc_vote_${id}.bin`);
    if (fs.existsSync(voteFile))
        return res.status(409).json({ error: `'${id}' has already voted.` });

    const voteInt = vote === 'yes' ? 1 : 0;
    console.log(`[vote] ${id} → ${vote.toUpperCase()}`);
    try {
        const out = runBinary('encrypt_vote', [id, String(voteInt)]);
        console.log(out);
        const count = listBins(DIRS.ciphertexts).length;
        res.json({
            status:  'ok',
            message: `Vote from '${id}' encrypted under joint key and recorded.`,
            count,
            expected: voters.length,
        });
    } catch (err) {
        console.error('[vote] ERROR:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /tally  ──────────────────────────────────────────────
app.post('/tally', (_req, res) => {
    const votes = listBins(DIRS.ciphertexts);
    if (votes.length === 0)
        return res.status(400).json({ error: 'No votes received yet.' });
    console.log(`[tally] Homomorphic tally over ${votes.length} votes...`);
    try {
        const out = runBinary('tally');
        console.log(out);
        res.json({ status: 'ok', message: `Homomorphic tally computed over ${votes.length} votes.` });
    } catch (err) {
        console.error('[tally] ERROR:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /partial_decrypt  ────────────────────────────────────
// Body: { voterId: "alice" }
// Voter contributes their partial decryption share.
app.post('/partial_decrypt', (req, res) => {
    const { voterId } = req.body;
    if (!voterId || typeof voterId !== 'string' || !voterId.trim())
        return res.status(400).json({ error: 'voterId is required' });
    if (!fs.existsSync(ENC_TALLY))
        return res.status(400).json({ error: 'Tally not computed yet. POST /tally first.' });

    const id = voterId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const voters = readVoterList();
    if (!voters.includes(id))
        return res.status(403).json({ error: `'${id}' is not a registered voter.` });

    const shareFile = path.join(DIRS.shares, `share_${id}.bin`);
    if (fs.existsSync(shareFile))
        return res.status(409).json({ error: `'${id}' already submitted their decryption share.` });

    console.log(`[partial_decrypt] Voter '${id}' submitting share...`);
    try {
        const out = runBinary('voter_partial_decrypt', [id]);
        console.log(out);

        const shares = listBins(DIRS.shares);
        const submitted = shares.map(f => f.replace(/^share_/, '').replace(/\.bin$/, ''));
        const allIn = voters.every(v => submitted.includes(v));

        let result = null;
        if (allIn) {
            console.log('[partial_decrypt] All shares received! Running combine...');
            const combineOut = runBinary('combine');
            console.log(combineOut);
            result = fs.existsSync(FINAL_RESULT)
                ? fs.readFileSync(FINAL_RESULT, 'utf8').trim()
                : null;
        }

        res.json({
            status:     'ok',
            message:    `Share from '${id}' accepted.`,
            submitted,
            needed:     voters,
            all_in:     allIn,
            result,
        });
    } catch (err) {
        console.error('[partial_decrypt] ERROR:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /result  ──────────────────────────────────────────────
app.get('/result', (_req, res) => {
    if (!fs.existsSync(FINAL_RESULT))
        return res.status(404).json({ error: 'Result not yet available.' });
    res.json({ result: fs.readFileSync(FINAL_RESULT, 'utf8').trim() });
});

// ── POST /reset  ──────────────────────────────────────────────
app.post('/reset', (_req, res) => {
    // Clear all data directories
    [DIRS.ciphertexts, DIRS.tally, DIRS.shares, DIRS.keys, DIRS.registry, DIRS.voters].forEach(dir => {
        if (fs.existsSync(dir))
            fs.readdirSync(dir).forEach(f => {
                const fullPath = path.join(dir, f);
                if (fs.statSync(fullPath).isDirectory()) {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(fullPath);
                }
            });
    });
    // Clear state
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    console.log('[reset] ✓ All data cleared. Re-running setup...');
    // Re-generate crypto context
    runBinary('setup');
    res.json({ message: 'Reset complete. Ready for new election.' });
});

// ══════════════════════════════════════════════════════════════
// VOTING PAGE
// ══════════════════════════════════════════════════════════════
function getVotingPage() {
return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MK-FHE Secure Vote</title>
  <meta name="description" content="Privacy-Preserving E-Voting demo using Multi-Key Fully Homomorphic Encryption with OpenFHE.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#050d1a;--surface:#091525;--surface2:#0d1e30;
      --border:#1a3050;--border2:#0f2240;
      --accent:#00e5ff;--yes:#00ff88;--no:#ff3860;
      --gold:#ffd600;--purple:#b388ff;
      --text:#cdd9e8;--muted:#4a6080;--faint:#0a1a2e;
      --mono:'Share Tech Mono',monospace;--sans:'Syne',sans-serif;
    }
    html,body{min-height:100%;background:var(--bg);color:var(--text);font-family:var(--sans)}
    body::before{content:'';position:fixed;inset:0;
      background-image:linear-gradient(rgba(0,229,255,.025)1px,transparent 1px),
        linear-gradient(90deg,rgba(0,229,255,.025)1px,transparent 1px);
      background-size:44px 44px;pointer-events:none;z-index:0}

    /* ── Layout ── */
    .page{position:relative;z-index:1;min-height:100vh;display:flex;
      flex-direction:column;align-items:center;padding:40px 16px 60px}

    /* ── Header ── */
    .header{text-align:center;margin-bottom:36px}
    .badge{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);
      font-size:.62rem;letter-spacing:.16em;color:var(--accent);
      border:1px solid rgba(0,229,255,.3);padding:5px 16px;border-radius:2px;
      margin-bottom:18px;animation:pb 3s ease-in-out infinite}
    @keyframes pb{0%,100%{border-color:rgba(0,229,255,.15)}50%{border-color:rgba(0,229,255,.6)}}
    .bdot{width:6px;height:6px;border-radius:50%;background:var(--yes);animation:blink 1.4s infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
    h1{font-size:clamp(2rem,5vw,3rem);font-weight:800;color:#fff;
      letter-spacing:-.02em;line-height:1.1;margin-bottom:10px}
    h1 .hi{color:var(--accent)}
    .sub{font-family:var(--mono);font-size:.7rem;color:var(--muted);line-height:2;max-width:420px;margin:0 auto}

    /* ── Flow diagram ── */
    .flow{display:flex;align-items:center;gap:0;margin:28px auto 40px;
      max-width:660px;width:100%;overflow-x:auto;padding-bottom:4px}
    .fstep{flex:1;min-width:80px;text-align:center;position:relative}
    .fstep::after{content:'→';position:absolute;right:-8px;top:50%;transform:translateY(-50%);
      color:var(--muted);font-size:.8rem}
    .fstep:last-child::after{display:none}
    .fnum{width:32px;height:32px;border-radius:50%;border:2px solid var(--border);
      display:flex;align-items:center;justify-content:center;
      margin:0 auto 6px;font-family:var(--mono);font-size:.7rem;color:var(--muted);
      transition:all .3s}
    .ftxt{font-family:var(--mono);font-size:.55rem;color:var(--muted);letter-spacing:.06em;
      line-height:1.4;transition:color .3s}
    .fstep.active .fnum{border-color:var(--accent);color:var(--accent);background:rgba(0,229,255,.08);
      box-shadow:0 0 12px rgba(0,229,255,.3)}
    .fstep.active .ftxt{color:var(--accent)}
    .fstep.done .fnum{border-color:var(--yes);color:var(--yes);background:rgba(0,255,136,.08)}
    .fstep.done .ftxt{color:var(--yes)}

    /* ── Cards ── */
    .card{background:var(--surface);border:1px solid var(--border);
      border-radius:6px;width:100%;max-width:500px;overflow:hidden;
      box-shadow:0 0 80px rgba(0,229,255,.04);margin-bottom:16px}
    .cbar{display:flex;align-items:center;gap:7px;padding:11px 18px;
      border-bottom:1px solid var(--border);background:rgba(0,229,255,.025)}
    .dot{width:9px;height:9px;border-radius:50%}
    .dr{background:#ff5f57}.dy{background:#febc2e}.dg{background:var(--yes);animation:blink 2s infinite}
    .ctitle{font-family:var(--mono);font-size:.62rem;color:var(--muted);margin-left:4px;letter-spacing:.07em}
    .cbody{padding:24px}

    /* ── Phase panels ── */
    .phase-panel{display:none}
    .phase-panel.show{display:block}

    /* ── Info strip ── */
    .strip{display:flex;align-items:flex-start;gap:10px;
      border:1px solid;border-radius:3px;padding:10px 14px;margin-bottom:20px;font-family:var(--mono);font-size:.63rem;line-height:1.7}
    .strip-accent{border-color:rgba(0,229,255,.2);background:rgba(0,229,255,.04);color:var(--accent)}
    .strip-yes{border-color:rgba(0,255,136,.2);background:rgba(0,255,136,.04);color:var(--yes)}
    .strip-warn{border-color:rgba(255,214,0,.2);background:rgba(255,214,0,.04);color:var(--gold)}
    .strip-purple{border-color:rgba(179,136,255,.2);background:rgba(179,136,255,.04);color:var(--purple)}

    /* ── Input ── */
    .field{margin-bottom:18px}
    .field label{display:block;font-family:var(--mono);font-size:.62rem;
      color:var(--muted);letter-spacing:.1em;margin-bottom:7px}
    .field input{width:100%;background:var(--faint);border:1px solid var(--border);
      border-radius:3px;padding:11px 14px;color:#fff;font-family:var(--mono);
      font-size:.85rem;outline:none;transition:border-color .2s}
    .field input:focus{border-color:var(--accent)}
    .field input::placeholder{color:var(--muted)}

    /* ── Voter list ── */
    .voter-list{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px;min-height:28px}
    .vtag{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);
      font-size:.65rem;padding:4px 10px;border-radius:2px;
      border:1px solid rgba(0,229,255,.25);background:rgba(0,229,255,.06);color:var(--accent)}
    .vtag.voted{border-color:rgba(0,255,136,.25);background:rgba(0,255,136,.06);color:var(--yes)}
    .vtag.shared{border-color:rgba(179,136,255,.25);background:rgba(179,136,255,.06);color:var(--purple)}
    .vtag .check{font-size:.75rem}

    /* ── Buttons ── */
    .btn{width:100%;padding:13px;border:1px solid;border-radius:3px;
      font-family:var(--mono);font-size:.75rem;letter-spacing:.09em;
      cursor:pointer;transition:all .18s;margin-bottom:10px;background:transparent}
    .btn:disabled{opacity:.22;cursor:not-allowed}
    .btn-accent{border-color:rgba(0,229,255,.4);color:var(--accent)}
    .btn-accent:hover:not(:disabled){background:rgba(0,229,255,.06);box-shadow:0 0 20px rgba(0,229,255,.12)}
    .btn-yes{border-color:rgba(0,255,136,.4);color:var(--yes)}
    .btn-yes:hover:not(:disabled){background:rgba(0,255,136,.06);box-shadow:0 0 20px rgba(0,255,136,.12)}
    .btn-no{border-color:rgba(255,56,96,.4);color:var(--no)}
    .btn-no:hover:not(:disabled){background:rgba(255,56,96,.06);box-shadow:0 0 20px rgba(255,56,96,.12)}
    .btn-warn{border-color:rgba(255,214,0,.3);color:var(--gold)}
    .btn-warn:hover:not(:disabled){background:rgba(255,214,0,.05)}
    .btn-purple{border-color:rgba(179,136,255,.35);color:var(--purple)}
    .btn-purple:hover:not(:disabled){background:rgba(179,136,255,.06);box-shadow:0 0 20px rgba(179,136,255,.1)}
    .btn-danger{border-color:rgba(255,56,96,.2);color:rgba(255,56,96,.5)}
    .btn-danger:hover{background:rgba(255,56,96,.04)}
    .vote-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
    .vote-row .btn{padding:20px 12px;font-size:.95rem;margin-bottom:0}
    .bicon{display:block;font-size:1.5rem;margin-bottom:2px}

    /* ── Progress ── */
    .prog-wrap{margin-bottom:18px}
    .prog-label{display:flex;justify-content:space-between;
      font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-bottom:6px}
    .prog-bar{height:3px;background:var(--faint);border-radius:2px;overflow:hidden}
    .prog-fill{height:100%;border-radius:2px;transition:width .6s ease;width:0%}
    .fill-accent{background:var(--accent)}
    .fill-yes{background:var(--yes)}
    .fill-purple{background:var(--purple)}

    /* ── Divider ── */
    .div{height:1px;background:var(--border);margin:20px 0;position:relative}
    .div-label::after{content:attr(data-label);position:absolute;top:50%;left:50%;
      transform:translate(-50%,-50%);background:var(--surface);padding:0 10px;
      font-family:var(--mono);font-size:.57rem;color:var(--muted);letter-spacing:.12em}

    /* ── Result ── */
    .result-box{display:none;text-align:center;padding:24px;
      background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.2);border-radius:4px;
      margin-top:14px}
    .result-box.show{display:block}
    .rlabel{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.14em;margin-bottom:10px}
    .rvalue{font-size:3rem;font-weight:800;color:var(--accent);line-height:1}
    .rsubt{font-family:var(--mono);font-size:.65rem;color:var(--muted);margin-top:6px}

    /* ── Log ── */
    #log{margin-top:16px;font-family:var(--mono);font-size:.64rem;
      line-height:1.85;max-height:130px;overflow-y:auto}
    #log::-webkit-scrollbar{width:3px}
    #log::-webkit-scrollbar-thumb{background:var(--border)}
    .le{display:flex;gap:10px;padding:3px 0;
      border-bottom:1px solid rgba(255,255,255,.03);animation:fu .2s ease}
    @keyframes fu{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
    .ts{color:var(--muted);flex-shrink:0;min-width:62px}
    .ok{color:var(--yes)}.err{color:var(--no)}.info{color:var(--accent)}.warn{color:var(--gold)}
    .purple{color:var(--purple)}

    /* ── Footer ── */
    .footer{margin-top:28px;font-family:var(--mono);font-size:.58rem;
      color:var(--muted);text-align:center;letter-spacing:.07em;line-height:2.5}

    /* ── Voted badge ── */
    .voted-badge{display:none;align-items:center;justify-content:center;gap:8px;
      padding:10px;border:1px solid rgba(0,255,136,.2);border-radius:3px;
      font-family:var(--mono);font-size:.68rem;color:var(--yes);
      background:rgba(0,255,136,.05);margin-bottom:14px}
    .voted-badge.show{display:flex}
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="badge"><span class="bdot"></span>MULTI-KEY FHE · THRESHOLD DECRYPTION</div>
    <h1>Privacy<span class="hi">-</span>Preserving<br>E-<span class="hi">Vote</span></h1>
    <p class="sub">Mỗi cử tri có cặp khóa riêng · Phiếu mã hóa bằng khóa chung<br>
      Cần <em>tất cả</em> cử tri giải mã một phần để ra kết quả</p>
  </div>

  <!-- Flow -->
  <div class="flow" id="flowDiagram">
    <div class="fstep" id="fs0">
      <div class="fnum">1</div>
      <div class="ftxt">ĐĂNG KÝ<br>REGISTER</div>
    </div>
    <div class="fstep" id="fs1">
      <div class="fnum">2</div>
      <div class="ftxt">KHÓA CHUNG<br>JOINT KEY</div>
    </div>
    <div class="fstep" id="fs2">
      <div class="fnum">3</div>
      <div class="ftxt">BỎ PHIẾU<br>VOTE</div>
    </div>
    <div class="fstep" id="fs3">
      <div class="fnum">4</div>
      <div class="ftxt">TỔNG HỢP<br>TALLY</div>
    </div>
    <div class="fstep" id="fs4">
      <div class="fnum">5</div>
      <div class="ftxt">GIẢI MÃ PHẦN<br>PARTIAL DEC</div>
    </div>
    <div class="fstep" id="fs5">
      <div class="fnum">6</div>
      <div class="ftxt">KẾT QUẢ<br>RESULT</div>
    </div>
  </div>

  <!-- Main Card -->
  <div class="card">
    <div class="cbar">
      <div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div>
      <span class="ctitle" id="cardTitle">secure-evote / mk-fhe</span>
    </div>
    <div class="cbody">

      <!-- ══ PHASE: REGISTRATION ══ -->
      <div class="phase-panel" id="panelReg">
        <div class="strip strip-accent">
          🔑 Điền thông tin cá nhân. Hệ thống tự động mã hóa và ẩn danh danh tính của bạn.
        </div>
        <div class="field">
          <label>HỌ VÀ TÊN</label>
          <input type="text" id="regName" placeholder="Nhập họ và tên (vd: Nguyen Van A)" maxlength="50">
        </div>
        <div class="field">
          <label>SỐ CCCD / CITIZEN ID</label>
          <input type="text" id="regCCCD" placeholder="Nhập số CCCD (12 số)" maxlength="12">
        </div>
        <div class="field" style="display:flex; gap:10px;">
          <div style="flex:1;">
            <label>NGÀY SINH</label>
            <input type="date" id="regDOB">
          </div>
          <div style="flex:1;">
            <label>ĐIỆN THOẠI / EMAIL</label>
            <input type="text" id="regContact" placeholder="Nhập liên hệ">
          </div>
        </div>
        <div class="field">
          <label>ĐỊA CHỈ</label>
          <input type="text" id="regAddress" placeholder="Nhập địa chỉ thường trú">
        </div>
        <button class="btn btn-accent" id="btnRegister" onclick="doRegister()">
          [ ĐĂNG KÝ VOTER ]
        </button>
        <div class="prog-wrap">
          <div class="prog-label">
            <span>CỬ TRI ĐÃ ĐĂNG KÝ</span>
            <span id="regCount">0 cử tri</span>
          </div>
          <div class="prog-bar"><div class="prog-fill fill-accent" id="regFill" style="width:0%"></div></div>
        </div>
        <div class="voter-list" id="regVoterList"></div>

        <div class="div div-label" data-label="ADMIN"></div>
        <button class="btn btn-yes" id="btnFinalize" onclick="doFinalize()">
          [ FINALIZE REGISTRATION — KHÓA ĐĂNG KÝ ]
        </button>
        <p style="font-family:var(--mono);font-size:.6rem;color:var(--muted);text-align:center;margin-top:-4px">
          Cần ít nhất 2 cử tri. Sau bước này không thể thêm cử tri mới.
        </p>
      </div>

      <!-- ══ PHASE: VOTING ══ -->
      <div class="phase-panel" id="panelVote">
        <div class="strip strip-yes">
          🗳️ Bỏ phiếu mã hóa dưới <strong>joint public key</strong>. Server không thấy nội dung phiếu.
        </div>
        <div class="voted-badge" id="votedBadge">
          <span>✓</span><span id="votedMsg">PHIẾU ĐÃ ĐƯỢC MÃ HÓA</span>
        </div>
        <div class="field">
          <label>TÊN CỬ TRI (đã đăng ký)</label>
          <input type="text" id="voteName" placeholder="Nhập tên đã đăng ký" maxlength="30">
        </div>
        <div style="font-family:var(--mono);font-size:.62rem;color:var(--muted);letter-spacing:.14em;margin-bottom:8px;text-align:center">CÂU HỎI</div>
        <div style="font-size:1.15rem;font-weight:700;color:#fff;text-align:center;margin-bottom:20px">Bạn có đồng ý với đề xuất này không?</div>
        <div class="vote-row">
          <button class="btn btn-yes" id="btnYes" onclick="castVote('yes')">
            <span class="bicon">✓</span>CÓ
          </button>
          <button class="btn btn-no" id="btnNo" onclick="castVote('no')">
            <span class="bicon">✗</span>KHÔNG
          </button>
        </div>
        <div class="prog-wrap">
          <div class="prog-label">
            <span>PHIẾU ĐÃ MÃ HÓA</span>
            <span id="voteCount">0 / 0</span>
          </div>
          <div class="prog-bar"><div class="prog-fill fill-yes" id="voteFill"></div></div>
        </div>
        <div class="voter-list" id="voteVoterList"></div>

        <div class="div div-label" data-label="ADMIN"></div>
        <button class="btn btn-accent" id="btnTally" onclick="doTally()">
          [ HOMOMORPHIC TALLY — TỔNG HỢP MÃ HÓA ]
        </button>
      </div>

      <!-- ══ PHASE: DECRYPTION ══ -->
      <div class="phase-panel" id="panelDecrypt">
        <div class="strip strip-purple">
          🔓 Mỗi cử tri phải nộp <strong>phần giải mã</strong> của mình. Cần đủ tất cả mới ra được kết quả.
        </div>
        <div class="field">
          <label>TÊN CỬ TRI</label>
          <input type="text" id="decryptName" placeholder="Nhập tên để nộp share" maxlength="30">
        </div>
        <button class="btn btn-purple" id="btnPartialDecrypt" onclick="doPartialDecrypt()">
          [ NỘP PHẦN GIẢI MÃ (PARTIAL DECRYPT) ]
        </button>
        <div class="prog-wrap">
          <div class="prog-label">
            <span>SHARES ĐÃ NHẬN</span>
            <span id="shareCount">0 / 0</span>
          </div>
          <div class="prog-bar"><div class="prog-fill fill-purple" id="shareFill"></div></div>
        </div>
        <div class="voter-list" id="shareVoterList"></div>

        <div class="result-box" id="resultBox">
          <div class="rlabel">KẾT QUẢ CUỐI CÙNG — TỔNG PHIẾU CÓ</div>
          <div class="rvalue" id="resultVal">—</div>
          <div class="rsubt">MultipartyDecryptFusion · OpenFHE 1.5.0</div>
        </div>
      </div>

      <!-- ══ PHASE: COMPLETE ══ -->
      <div class="phase-panel" id="panelComplete">
        <div class="strip strip-yes">
          ✅ Bầu cử hoàn tất. Kết quả đã được giải mã bằng đủ tất cả các shares.
        </div>
        <div class="result-box show" id="finalResultBox">
          <div class="rlabel">KẾT QUẢ CUỐI CÙNG — TỔNG PHIẾU CÓ</div>
          <div class="rvalue" id="finalResultVal">—</div>
          <div class="rsubt">MultipartyDecryptFusion · OpenFHE 1.5.0</div>
        </div>
      </div>

      <!-- ── Log ── -->
      <div id="log"></div>

      <!-- ── Admin: Reset ── -->
      <div class="div" style="margin-top:20px"></div>
      <button class="btn btn-danger" onclick="doReset()">[ RESET — XÓA TẤT CẢ ]</button>
    </div>
  </div>

  <div class="footer">
    <div>Privacy-Preserving E-Voting · Đồ án Tốt nghiệp</div>
    <div>Multi-Key FHE · OpenFHE 1.5.0 · C++17 · Node.js</div>
    <div style="color:#1a3050;margin-top:4px">threshold decryption · no single point of trust</div>
  </div>
</div>

<script>
const PHASE_STEPS = {
  registration: [0,1],
  voting:       [2],
  tallied:      [3],
  decrypting:   [4],
  complete:     [5],
};
const DONE_STEPS = {
  registration: [],
  voting:       [0,1],
  tallied:      [0,1,2,3],
  decrypting:   [0,1,2,3],
  complete:     [0,1,2,3,4,5],
};

let currentPhase = null;
let voted = false;
let sharedDecrypt = false;
let pollTimer = null;

window.addEventListener('DOMContentLoaded', () => {
  log('Sistema de voto MK-FHE pronto.', 'info');
  pollTimer = setInterval(poll, 3000);
  poll();
});

async function poll() {
  try {
    const s = await fetch('/status').then(r => r.json());
    applyState(s);
  } catch(_) {}
}

function applyState(s) {
  const phase = s.phase;
  if (phase === currentPhase) {
    // Just update dynamic parts
    updateVoterTags(s);
    return;
  }
  currentPhase = phase;

  // Update flow diagram
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById('fs' + i);
    el.classList.remove('active','done');
  }
  (DONE_STEPS[phase]||[]).forEach(i => document.getElementById('fs'+i).classList.add('done'));
  (PHASE_STEPS[phase]||[]).forEach(i => document.getElementById('fs'+i).classList.add('active'));

  // Show correct panel
  ['panelReg','panelVote','panelDecrypt','panelComplete'].forEach(id =>
    document.getElementById(id).classList.remove('show'));

  if (phase === 'registration') {
    document.getElementById('panelReg').classList.add('show');
    document.getElementById('cardTitle').textContent = 'secure-evote / registration';
  } else if (phase === 'voting') {
    document.getElementById('panelVote').classList.add('show');
    document.getElementById('cardTitle').textContent = 'secure-evote / voting';
    log('✓ Đăng ký hoàn tất. Joint public key đã được tạo.', 'ok');
    log('Bỏ phiếu mã hóa dưới joint key đang mở.', 'info');
  } else if (phase === 'decrypting') {
    document.getElementById('panelDecrypt').classList.add('show');
    document.getElementById('cardTitle').textContent = 'secure-evote / partial-decrypt';
    log('✓ Tổng hợp đồng hình hoàn tất.', 'ok');
    log('Mỗi cử tri cần nộp phần giải mã của mình.', 'purple');
  } else if (phase === 'complete') {
    document.getElementById('panelComplete').classList.add('show');
    document.getElementById('cardTitle').textContent = 'secure-evote / result';
    if (s.result) {
      const m = s.result.match(/(\\d+)/);
      if (m) document.getElementById('finalResultVal').textContent = m[1];
    }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    log('✓ Tất cả shares đã nhận. Kết quả đã giải mã!', 'ok');
  }

  updateVoterTags(s);
}

function updateVoterTags(s) {
  // Registration panel: voter tags
  const regList = document.getElementById('regVoterList');
  if (regList) {
    regList.innerHTML = (s.voters||[]).map(v =>
      '<span class="vtag"><span class="check">●</span>' + v + '</span>'
    ).join('');
    const rc = document.getElementById('regCount');
    if (rc) rc.textContent = (s.voters||[]).length + ' cử tri';
  }

  // Vote panel
  const voteList = document.getElementById('voteVoterList');
  if (voteList) {
    const voted = s.shares_received || [];
    voteList.innerHTML = (s.voters||[]).map(v => {
      const hasVote = (s.votes_received || 0) > 0; // approximate
      return '<span class="vtag ' + (hasVote ? '' : '') + '">' + v + '</span>';
    }).join('');
    const vc = document.getElementById('voteCount');
    if (vc) vc.textContent = (s.votes_received||0) + ' / ' + (s.votes_expected||0);
    const vf = document.getElementById('voteFill');
    if (vf && s.votes_expected > 0)
      vf.style.width = Math.min(100, Math.round((s.votes_received||0) / s.votes_expected * 100)) + '%';
  }

  // Decrypt panel
  const shareList = document.getElementById('shareVoterList');
  if (shareList) {
    const submitted = s.shares_received || [];
    shareList.innerHTML = (s.voters||[]).map(v =>
      '<span class="vtag ' + (submitted.includes(v) ? 'shared' : '') + '">' +
      (submitted.includes(v) ? '✓ ' : '') + v + '</span>'
    ).join('');
    const sc = document.getElementById('shareCount');
    if (sc) sc.textContent = submitted.length + ' / ' + (s.voters||[]).length;
    const sf = document.getElementById('shareFill');
    if (sf && s.voters && s.voters.length > 0)
      sf.style.width = Math.min(100, Math.round(submitted.length / s.voters.length * 100)) + '%';
  }

  // Result in decrypt panel
  if (s.result) {
    const m = s.result.match(/(\\d+)/);
    const rv = document.getElementById('resultVal');
    if (rv && m) rv.textContent = m[1];
    const rb = document.getElementById('resultBox');
    if (rb) rb.classList.add('show');
  }
}

async function doRegister() {
  const name = document.getElementById('regName').value.trim();
  const cccd = document.getElementById('regCCCD').value.trim();
  const dob = document.getElementById('regDOB').value.trim();
  const contact = document.getElementById('regContact').value.trim();
  const address = document.getElementById('regAddress').value.trim();

  if (!name || !cccd) { log('Vui lòng nhập đủ Họ Tên và CCCD.', 'err'); return; }
  document.getElementById('btnRegister').disabled = true;
  log('Đang kiểm tra CCCD và tạo keypair cho ' + name + '...', 'info');
  try {
    const r = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: name, cccd: cccd, dob: dob, contact: contact, address: address }),
    });
    const d = await r.json();
    if (!r.ok) { log('Lỗi: ' + d.error, 'err'); document.getElementById('btnRegister').disabled = false; return; }
    log('✓ ' + d.message, 'ok');
    log('Voter ID của bạn là: ' + d.voter_id, 'info');
    document.getElementById('regName').value = '';
    document.getElementById('regCCCD').value = '';
    document.getElementById('regDOB').value = '';
    document.getElementById('regContact').value = '';
    document.getElementById('regAddress').value = '';
    poll();
  } catch(e) { log('Network error: ' + e.message, 'err'); }
  finally { document.getElementById('btnRegister').disabled = false; }
}

async function doFinalize() {
  document.getElementById('btnFinalize').disabled = true;
  log('Đang finalize election...', 'info');
  try {
    const r = await fetch('/finalize', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { log('Lỗi: ' + d.error, 'err'); document.getElementById('btnFinalize').disabled = false; return; }
    log('✓ ' + d.message, 'ok');
    log('Joint public key hoàn chỉnh. Bỏ phiếu bắt đầu!', 'ok');
    poll();
  } catch(e) { log('Network error: ' + e.message, 'err'); document.getElementById('btnFinalize').disabled = false; }
}

async function castVote(choice) {
  if (voted) { log('Bạn đã bỏ phiếu rồi.', 'warn'); return; }
  const name = document.getElementById('voteName').value.trim();
  if (!name) { log('Nhập tên đã đăng ký.', 'err'); return; }
  document.getElementById('btnYes').disabled = true;
  document.getElementById('btnNo').disabled  = true;
  log('Đang mã hóa phiếu dưới joint key...', 'info');
  try {
    const r = await fetch('/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId: name, vote: choice }),
    });
    const d = await r.json();
    if (!r.ok) {
      log('Lỗi: ' + d.error, 'err');
      document.getElementById('btnYes').disabled = false;
      document.getElementById('btnNo').disabled  = false;
      return;
    }
    voted = true;
    document.getElementById('votedBadge').classList.add('show');
    document.getElementById('votedMsg').textContent = name.toUpperCase() + ' — PHIẾU ĐÃ MÃ HÓA';
    log('✓ ' + d.message, 'ok');
    poll();
  } catch(e) {
    log('Network error: ' + e.message, 'err');
    document.getElementById('btnYes').disabled = false;
    document.getElementById('btnNo').disabled  = false;
  }
}

async function doTally() {
  document.getElementById('btnTally').disabled = true;
  log('Đang tính tổng đồng hình (homomorphic addition)...', 'info');
  try {
    const r = await fetch('/tally', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) { log('Lỗi: ' + d.error, 'err'); document.getElementById('btnTally').disabled = false; return; }
    log('✓ ' + d.message, 'ok');
    log('Tổng vẫn đang mã hóa. Cần tất cả cử tri nộp share.', 'warn');
    poll();
  } catch(e) { log('Network error: ' + e.message, 'err'); document.getElementById('btnTally').disabled = false; }
}

async function doPartialDecrypt() {
  const name = document.getElementById('decryptName').value.trim();
  if (!name) { log('Nhập tên để nộp share.', 'err'); return; }
  document.getElementById('btnPartialDecrypt').disabled = true;
  log('Đang tính partial decrypt cho ' + name + '...', 'purple');
  try {
    const r = await fetch('/partial_decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId: name }),
    });
    const d = await r.json();
    if (!r.ok) {
      log('Lỗi: ' + d.error, 'err');
      document.getElementById('btnPartialDecrypt').disabled = false;
      return;
    }
    log('✓ ' + d.message, 'ok');
    document.getElementById('decryptName').value = '';
    if (d.all_in && d.result) {
      const m = d.result.match(/(\\d+)/);
      if (m) {
        document.getElementById('resultVal').textContent = m[1];
        document.getElementById('resultBox').classList.add('show');
        log('🎉 Tất cả shares nhận đủ! Kết quả: ' + d.result, 'ok');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }
    }
    poll();
  } catch(e) { log('Network error: ' + e.message, 'err'); }
  finally { document.getElementById('btnPartialDecrypt').disabled = false; }
}

async function doReset() {
  if (!confirm('Xóa toàn bộ dữ liệu bầu cử?')) return;
  voted = false; sharedDecrypt = false;
  document.getElementById('votedBadge').classList.remove('show');
  document.getElementById('resultBox') && document.getElementById('resultBox').classList.remove('show');
  const r = await fetch('/reset', { method: 'POST' });
  const d = await r.json();
  log('✓ ' + d.message, 'warn');
  currentPhase = null;
  if (!pollTimer) pollTimer = setInterval(poll, 3000);
  poll();
}

function log(msg, type='info') {
  const el = document.getElementById('log');
  const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const e  = document.createElement('div');
  e.className = 'le';
  e.innerHTML = '<span class="ts">' + ts + '</span><span class="' + type + '">' + msg + '</span>';
  el.appendChild(e);
  el.scrollTop = el.scrollHeight;
}
</script>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════
try {
    ensureSetup();
} catch (err) {
    console.error('[startup] Setup failed:', err.message);
    console.error('Make sure ./scripts/build.sh was run first.');
    process.exit(1);
}

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║      MK-FHE  Secure Vote — Multi-Key Threshold       ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`  Port: ${PORT}`);
    console.log('  Election flow: registration → voting → tally → partial decrypt → reveal');
    console.log('');
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal)
                console.log(`  → http://${net.address}:${PORT}`);
        }
    }
    console.log('');
});