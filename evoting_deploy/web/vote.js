// =============================================================
// web/vote.js  —  Browser-side logic
// Polls server status, drives phase transitions automatically.
// =============================================================
'use strict';

let hasVoted       = false;
let shareSubmitted = false;
let pollTimer      = null;
const EXPECTED     = 3;  // must match server's EXPECTED_VOTERS

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    // Show voter ID from server
    try {
        const s = await fetch('/health').then(r => r.json());
        const tag = document.getElementById('voterTag');
        if (s.voter) tag.textContent = s.voter.toUpperCase();
    } catch (_) {}

    log('System ready. Waiting for ballot.', 'info');
    startPolling();
});

// ── Polling ───────────────────────────────────────────────────
function startPolling() {
    pollTimer = setInterval(pollStatus, 4000);
}

async function pollStatus() {
    try {
        const res = await fetch('/status');
        if (!res.ok) return;
        const s = await res.json();

        // Update progress bar
        updateProgress(s.votes_received || 0, EXPECTED);

        // Show result if available from server
        if (s.result) {
            showResult(s.result);
        }
    } catch (_) {}
}

function updateProgress(count, total) {
    const pct = Math.min(100, Math.round((count / total) * 100));
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = `${count} / ${total}`;
}

function showResult(resultText) {
    const match = resultText.match(/(\d+)/);
    if (match) {
        document.getElementById('resultValue').textContent = match[1];
        document.getElementById('resultBox').classList.add('show');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
}

// ── Cast vote ──────────────────────────────────────────────────
async function castVote(choice) {
    if (hasVoted) { log('Already voted this session.', 'err'); return; }

    lockVoteButtons();
    log(`Encrypting ${choice.toUpperCase()} vote locally...`, 'info');

    try {
        const res  = await fetch('/vote', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ vote: choice }),
        });
        const data = await res.json();

        if (!res.ok) {
            unlockVoteButtons();
            log(`Error: ${data.error}`, 'err');
            return;
        }

        hasVoted = true;
        document.getElementById('votedBadge').classList.add('show');
        log(`✓ ${data.message}`, 'ok');
        log('Ciphertext in transit. Server receives only encrypted data.', 'info');

        // Update progress from server response
        if (data.server) updateProgress(data.server.count || 0, EXPECTED);

    } catch (err) {
        unlockVoteButtons();
        log(`Network error: ${err.message}`, 'err');
    }
}

// ── Partial decrypt ────────────────────────────────────────────
async function partialDecrypt() {
    if (shareSubmitted) { log('Share already submitted.', 'err'); return; }

    document.getElementById('btnDecrypt').disabled = true;
    log('Downloading encrypted tally from server...', 'info');

    try {
        const res  = await fetch('/partial-decrypt', { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            document.getElementById('btnDecrypt').disabled = false;
            log(`Error: ${data.error}`, 'err');
            return;
        }

        shareSubmitted = true;
        log(`✓ ${data.message}`, 'ok');

        if (data.ready_to_combine) {
            log('All shares received. Server can now reveal the tally.', 'warn');
        } else {
            log('Waiting for remaining voters to submit their shares...', 'info');
        }

    } catch (err) {
        document.getElementById('btnDecrypt').disabled = false;
        log(`Network error: ${err.message}`, 'err');
    }
}

// ── UI helpers ────────────────────────────────────────────────
function lockVoteButtons() {
    document.getElementById('btnYes').disabled = true;
    document.getElementById('btnNo').disabled  = true;
}
function unlockVoteButtons() {
    document.getElementById('btnYes').disabled = false;
    document.getElementById('btnNo').disabled  = false;
    document.getElementById('votedBadge').classList.remove('show');
}

function log(msg, type = 'info') {
    const el    = document.getElementById('log');
    const ts    = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML =
        `<span class="log-ts">${ts}</span>` +
        `<span class="log-${type}">${msg}</span>`;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
}
