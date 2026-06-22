// =============================================================
// web/vote.js — Browser-side logic for Ballon d'Or FHE voting
//
// Responsibilities:
//   - Fetch candidates from /candidates and render photo cards
//   - Handle single-selection with radio behaviour
//   - Submit encrypted vote via POST /vote (candidateIndex)
//   - Poll /status every 3 s for phase + progress updates
//   - Render leaderboard when phase === 'complete'
//   - Trigger partial decryption share via POST /partial-decrypt
// =============================================================
'use strict';

// ── Constants & state ─────────────────────────────────────────
const CLIENT_BASE = '';   // same-origin: served at localhost:3000

let selectedCandidateIndex = null;   // currently highlighted card id
let candidates             = [];     // array fetched from /candidates
let hasVoted               = false;  // true after successful POST /vote
let shareSubmitted         = false;  // true after partial-decrypt sent
let pollTimer              = null;   // setInterval handle
let leaderboardRendered    = false;  // guard against double-render

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Show voter ID in header tag if available
    fetch(CLIENT_BASE + '/health')
        .then(r => r.json())
        .then(s => {
            const tag = document.getElementById('voterTag');
            if (s.voter && tag) tag.textContent = s.voter.toUpperCase();
        })
        .catch(() => {});

    addLog('System ready. Loading candidates...', 'info');
    loadCandidates();
    startPolling();
});

// ── Helpers ───────────────────────────────────────────────────
function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Return up to 2 uppercase initials from a name: "Vinicius Jr" → "VJ" */
function initials(name) {
    return (name || '')
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
}

// ── Load candidates ───────────────────────────────────────────
async function loadCandidates() {
    try {
        const res  = await fetch(CLIENT_BASE + '/candidates');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        candidates = data.candidates || data;   // handle both shapes
        renderCandidateGrid();
        addLog(`Loaded ${candidates.length} candidates.`, 'ok');
    } catch (err) {
        console.warn('Could not load candidates:', err.message);
        const grid = document.getElementById('candidateGrid');
        if (grid) {
            grid.innerHTML =
                `<p style="color:#ff3860;font-family:'Share Tech Mono',monospace;`+
                `text-align:center;grid-column:1/-1;padding:20px 0">` +
                `Error loading candidates: ${esc(err.message)}</p>`;
        }
        addLog(`Could not load candidates: ${err.message}`, 'err');
    }
}

// ── Render candidate grid ─────────────────────────────────────
function renderCandidateGrid() {
    const grid = document.getElementById('candidateGrid');
    if (!grid) return;

    if (!candidates || candidates.length === 0) {
        grid.innerHTML =
            '<p style="font-family:\'Share Tech Mono\',monospace;font-size:.68rem;'  +
            'color:#4a6080;grid-column:1/-1;text-align:center;padding:20px 0">'      +
            'No candidates configured.</p>';
        return;
    }

    grid.innerHTML = candidates.map(c => {
        const num  = String((c.id || 0) + 1).padStart(2, '0');
        const inits = initials(c.name);
        const imgSrc = esc(c.image || '');

        return `
        <div class="candidate-card"
             data-index="${c.id}"
             onclick="selectCandidate(${c.id})">
          <div class="candidate-photo-wrap">
            <img class="candidate-photo"
                 src="${imgSrc}"
                 alt="${esc(c.name)}"
                 loading="lazy"
                 onerror="this.style.display='none';
                          this.nextElementSibling.style.display='flex'">
            <div class="candidate-photo-fallback">
              <span>${esc(inits)}</span>
            </div>
          </div>
          <div class="candidate-info">
            <div class="candidate-number">#${num}</div>
            <div class="candidate-name">${esc(c.name)}</div>
            <div class="candidate-club">${esc(c.club || '')}</div>
            <div class="candidate-nationality">${esc(c.nationality || '')}</div>
          </div>
        </div>`;
    }).join('');

    // Show the Ballon d'Or section
    const section = document.getElementById('ballonDorSection');
    if (section) section.style.display = 'block';

    // Hide any legacy YES/NO elements that may still exist
    ['votingSection', 'yesNoSection', 'btnYes', 'btnNo', 'btnConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

// ── Candidate selection ───────────────────────────────────────
function selectCandidate(index) {
    if (hasVoted) return;

    selectedCandidateIndex = index;

    // Reset all cards
    document.querySelectorAll('.candidate-card').forEach(el => {
        el.classList.remove('selected');
    });

    // Highlight chosen card
    const chosen = document.querySelector(`.candidate-card[data-index="${index}"]`);
    if (chosen) chosen.classList.add('selected');

    // Update preview bar
    const cand = candidates.find(c => c.id === index);
    if (!cand) return;

    const preview = document.getElementById('selectedPreview');
    if (preview) {
        preview.style.display = 'flex';

        const img = document.getElementById('previewImg');
        if (img) {
            img.src   = cand.image || '';
            img.alt   = cand.name  || '';
            img.onerror = function () {
                this.onerror = null;
                this.src = 'data:image/svg+xml;utf8,' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46">' +
                    '<rect width="46" height="46" fill="%230a1628"/>' +
                    '<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"' +
                    ' font-family="sans-serif" font-size="16" fill="%234a7fa5">' +
                    (cand.name ? cand.name.charAt(0) : '?') +
                    '</text></svg>';
            };
        }

        const nameEl = document.getElementById('previewName');
        if (nameEl) nameEl.textContent = cand.name || '';

        const clubEl = document.getElementById('previewClub');
        if (clubEl) clubEl.textContent = cand.club || cand.nationality || '';
    }

    // Show confirm button
    const btn = document.getElementById('confirmVoteBtn');
    if (btn) {
        btn.style.display = 'block';
        btn.disabled      = false;
        btn.textContent   = '🔐 CONFIRM & ENCRYPT VOTE';
    }
}

// ── Confirm & submit vote ─────────────────────────────────────
async function confirmAndVote() {
    if (selectedCandidateIndex === null) return;

    const candidate = candidates.find(c => c.id === selectedCandidateIndex);
    if (!candidate) return;

    const ok = window.confirm(
        `🗳️ CONFIRM ENCRYPTED VOTE\n\n` +
        `Candidate: ${candidate.name}\n` +
        `Club: ${candidate.club || ''}\n\n` +
        `This vote will be encrypted using MK-FHE.\n` +
        `You cannot change your vote after confirmation.\n\n` +
        `Proceed?`
    );
    if (!ok) return;

    const btn = document.getElementById('confirmVoteBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'ENCRYPTING...'; }

    // Resolve voter ID: try explicit input, then health endpoint tag
    let voterId = '';
    const voterIdInput = document.getElementById('voterIdInput');
    if (voterIdInput) voterId = voterIdInput.value.trim();
    if (!voterId) {
        const tag = document.getElementById('voterTag');
        if (tag && tag.textContent && tag.textContent !== 'VOTER') {
            voterId = tag.textContent.toLowerCase();
        }
    }

    if (!voterId) {
        alert('Please set your Voter ID before voting.');
        if (btn) { btn.disabled = false; btn.textContent = '🔐 CONFIRM & ENCRYPT VOTE'; }
        return;
    }

    addLog(`Encrypting vote for "${candidate.name}" under joint MK-FHE key…`, 'info');

    try {
        const res  = await fetch(CLIENT_BASE + '/vote', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ voterId, candidateIndex: selectedCandidateIndex }),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        hasVoted = true;

        // Hide confirm UI
        if (btn) btn.style.display = 'none';
        const preview = document.getElementById('selectedPreview');
        if (preview) preview.style.display = 'none';

        // Show voted badge
        const badge = document.getElementById('votedBadge');
        if (badge) badge.style.display = 'block';

        // Lock all cards; keep selected card visible
        document.querySelectorAll('.candidate-card').forEach(el => {
            el.classList.add('voted-lock');
        });

        addLog('✓ Vote encrypted under joint MK-FHE key and submitted.', 'ok');

    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = '🔐 CONFIRM & ENCRYPT VOTE'; }
        addLog(`✗ Vote failed: ${err.message}`, 'err');
    }
}

// ── Polling ───────────────────────────────────────────────────
function startPolling() {
    pollStatus();
    pollTimer = setInterval(pollStatus, 3000);
}

async function pollStatus() {
    try {
        const res = await fetch(CLIENT_BASE + '/status');
        if (!res.ok) return;
        const s = await res.json();

        // Populate candidates from status if loadCandidates failed
        if (s.candidates && s.candidates.length > 0 && candidates.length === 0) {
            candidates = s.candidates;
            renderCandidateGrid();
        }

        // Update progress bar
        const received = s.votes_received ?? 0;
        const expected = s.votes_expected ?? s.voters_count ?? 0;

        const progressWrap = document.getElementById('progressWrap');
        const progressText = document.getElementById('progressText');
        const progressFill = document.getElementById('progressFill');

        const showProgress = (s.phase === 'voting' || s.phase === 'decrypting');
        if (progressWrap) progressWrap.style.display = showProgress ? 'block' : 'none';
        if (progressText) progressText.textContent = `${received} / ${expected}`;
        if (progressFill && expected > 0) {
            progressFill.style.width = Math.min(100, Math.round((received / expected) * 100)) + '%';
        }

        // Manage decrypt button
        const btnDecrypt = document.getElementById('btnDecrypt');
        if (btnDecrypt) {
            btnDecrypt.disabled = (s.phase !== 'decrypting') || shareSubmitted;
        }

        // Phase-specific actions
        switch (s.phase) {
            case 'registration':
                addLog('Election is in registration phase — waiting for voters.', 'warn');
                break;

            case 'voting':
                // Make sure the section is visible once candidates are loaded
                if (candidates.length > 0) {
                    const sec = document.getElementById('ballonDorSection');
                    if (sec) sec.style.display = 'block';
                }
                break;

            case 'decrypting':
                // nothing extra; decrypt button is already enabled above
                break;

            case 'complete':
                if (!leaderboardRendered) {
                    const results = s.results || parseRawResult(s.result, s.candidates || candidates);
                    if (results && results.length > 0) {
                        renderLeaderboard(results, s.candidates || candidates);
                    }
                }
                break;
        }

    } catch (_) { /* network hiccup — swallow silently */ }
}

/** Parse legacy text result "CANDIDATE_N:count\n…" if server sends raw string */
function parseRawResult(raw, candidatesData) {
    if (!raw || typeof raw !== 'string') return null;
    const parsed = [];
    for (const line of raw.split('\n')) {
        const m = line.match(/^CANDIDATE_(\d+):(\d+)$/);
        if (m) {
            const idx  = parseInt(m[1], 10);
            const cnt  = parseInt(m[2], 10);
            const cand = (candidatesData || []).find(c => c.id === idx)
                         || { id: idx, name: `Candidate ${idx}`, club: '', nationality: '', image: '' };
            parsed.push({ ...cand, votes: cnt });
        }
    }
    return parsed.sort((a, b) => b.votes - a.votes);
}

// ── Render leaderboard ────────────────────────────────────────
function renderLeaderboard(resultsArray, candidatesData) {
    if (leaderboardRendered) return;
    leaderboardRendered = true;

    if (!resultsArray || resultsArray.length === 0) return;

    const maxVotes = Math.max(1, resultsArray[0].votes || 0);

    const medals = ['🥇', '🥈', '🥉'];

    const rows = resultsArray.map((r, i) => {
        const rank      = i + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const medal     = rank <= 3 ? medals[i] : `#${rank}`;

        // Merge with candidatesData to get image if not in result
        const cand  = (candidatesData || []).find(c => c.id === r.id) || r;
        const imgSrc = esc(cand.image || r.image || '');
        const inits  = initials(cand.name || r.name || '');
        const pct    = maxVotes > 0 ? Math.round(((r.votes || 0) / maxVotes) * 100) : 0;

        return `
        <div class="leaderboard-row ${rankClass}"
             style="animation-delay:${i * 0.07}s">
          <div class="leaderboard-rank">${medal}</div>
          <div class="lb-photo-wrap">
            <img class="leaderboard-photo"
                 src="${imgSrc}"
                 alt="${esc(cand.name || r.name)}"
                 loading="lazy"
                 onerror="this.style.display='none';
                          this.nextElementSibling.style.display='flex'">
            <div class="lb-photo-fallback">
              <span>${esc(inits)}</span>
            </div>
          </div>
          <div class="leaderboard-name">${esc(cand.name || r.name || '')}</div>
          <div class="leaderboard-club">${esc(cand.club || r.club || '')}</div>
          <div class="leaderboard-bar-wrap">
            <div class="leaderboard-bar" style="width:${pct}%"></div>
          </div>
          <div class="leaderboard-votes">${r.votes || 0} VOTES</div>
        </div>`;
    }).join('');

    // Hide candidate grid, show results box
    const grid = document.getElementById('candidateGrid');
    if (grid) grid.style.display = 'none';

    const preview = document.getElementById('selectedPreview');
    if (preview) preview.style.display = 'none';

    const confirmBtn = document.getElementById('confirmVoteBtn');
    if (confirmBtn) confirmBtn.style.display = 'none';

    const progressWrap = document.getElementById('progressWrap');
    if (progressWrap) progressWrap.style.display = 'none';

    // Keep ballonDorSection visible for the header
    const section = document.getElementById('ballonDorSection');
    if (section) section.style.display = 'block';

    // Populate result box
    const resultBox = document.getElementById('resultBox');
    if (resultBox) {
        resultBox.classList.add('show');
        const container = document.getElementById('leaderboardContainer');
        if (container) {
            container.innerHTML = `<div class="leaderboard">${rows}</div>`;
        }
    }

    addLog('🏆 Election complete — results revealed!', 'ok');
}

// ── Partial decryption ────────────────────────────────────────
async function partialDecrypt() {
    if (shareSubmitted) {
        addLog('Decryption share already submitted.', 'err');
        return;
    }

    const btn = document.getElementById('btnDecrypt');
    if (btn) btn.disabled = true;

    addLog('Downloading encrypted tally and computing decryption share…', 'info');

    try {
        const res  = await fetch(CLIENT_BASE + '/partial-decrypt', { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            if (btn) btn.disabled = false;
            addLog(`Error: ${data.error}`, 'err');
            return;
        }

        shareSubmitted = true;
        addLog(`✓ ${data.message}`, 'ok');

        if (data.ready_to_combine) {
            addLog('All shares received. Server will now reveal the tally.', 'warn');
        } else {
            addLog('Waiting for remaining voters to submit their shares…', 'info');
        }

    } catch (err) {
        if (btn) btn.disabled = false;
        addLog(`Network error: ${err.message}`, 'err');
    }
}

// ── Activity log ──────────────────────────────────────────────
function addLog(msg, type = 'info') {
    const el = document.getElementById('log');
    if (!el) return;
    const ts    = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML =
        `<span class="log-ts">[${ts}]</span>` +
        `<span class="log-${type}">${msg}</span>`;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
}
