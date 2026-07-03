// =============================================================
// web/vote.js  —  Browser-side logic (Đã được vá lỗi khóa nút)
// =============================================================
'use strict';

let hasVoted       = false;
let shareSubmitted = false;
let pollTimer      = null;
const EXPECTED     = 3;

window.addEventListener('DOMContentLoaded', async () => {
    // Tự động mờ nút Decrypt lúc mới vào
    document.getElementById('btnDecrypt').disabled = true;

    try {
        const s = await fetch('/health').then(r => r.json());
        const tag = document.getElementById('voterTag');
        if (s.voter) tag.textContent = s.voter.toUpperCase();
    } catch (_) {}

    log('Hệ thống đã sẵn sàng. Vui lòng bỏ phiếu.', 'info');
    startPolling();
});

function startPolling() {
    pollTimer = setInterval(pollStatus, 3000);
}

async function pollStatus() {
    try {
        const res = await fetch('/status');
        if (!res.ok) return;
        const s = await res.json();

        updateProgress(s.votes_received || 0, EXPECTED);

        // CHỈ MỞ khóa nút giải mã khi đủ 3 phiếu bầu
        if (s.votes_received >= EXPECTED && !shareSubmitted) {
            document.getElementById('btnDecrypt').disabled = false;
        } else if (s.votes_received < EXPECTED) {
            document.getElementById('btnDecrypt').disabled = true; // Khóa lại nếu server bị reset
        }

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

async function castVote(choice) {
    if (hasVoted) { log('Bạn đã bỏ phiếu rồi!', 'err'); return; }

    lockVoteButtons();
    log(`Đang mã hóa phiếu bầu ${choice.toUpperCase()} cục bộ...`, 'info');

    try {
        const res  = await fetch('/vote', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ vote: choice }),
        });
        const data = await res.json();

        if (!res.ok) {
            unlockVoteButtons();
            log(`Lỗi: ${data.error}`, 'err');
            return;
        }

        hasVoted = true;
        document.getElementById('votedBadge').classList.add('show');
        log(`✓ ${data.message}`, 'ok');

        if (data.server) updateProgress(data.server.count || 0, EXPECTED);

    } catch (err) {
        unlockVoteButtons();
        log(`Lỗi kết nối: ${err.message}`, 'err');
    }
}

async function partialDecrypt() {
    if (shareSubmitted) { log('Bạn đã nộp share giải mã rồi!', 'err'); return; }

    document.getElementById('btnDecrypt').disabled = true;
    log('Đang tải kết quả tally đã mã hóa từ Server...', 'info');

    try {
        const res  = await fetch('/partial-decrypt', { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            document.getElementById('btnDecrypt').disabled = false;
            log(`Lỗi: ${data.error}`, 'err');
            return;
        }

        shareSubmitted = true;
        log(`✓ ${data.message}`, 'ok');

        if (data.ready_to_combine) {
            log('Đã thu thập đủ các mảnh giải mã. Kết quả sẽ được hiển thị!', 'warn');
        } else {
            log('Đợi các cử tri khác nộp mảnh giải mã của họ...', 'info');
        }

    } catch (err) {
        document.getElementById('btnDecrypt').disabled = false;
        log(`Lỗi kết nối: ${err.message}`, 'err');
    }
}

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
