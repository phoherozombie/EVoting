// =============================================================
// web/vote.js  —  Ballon d'Or Voting Logic (Base 4 FHE decoding)
// =============================================================
'use strict';

let hasVoted       = false;
let shareSubmitted = false;
let pollTimer      = null;
let jwtToken       = null;
let currentVoterId = null;
let selectedCandidateIdx = null;

const EXPECTED     = 3;

const PLAYERS = [
    { name: "Lionel Messi" },
    { name: "Cristiano Ronaldo" },
    { name: "Vinicius Jr" },
    { name: "Erling Haaland" },
    { name: "Kylian Mbappé" },
    { name: "Jude Bellingham" }
];

window.addEventListener('DOMContentLoaded', async () => {
    // Tự động mờ nút Decrypt lúc mới vào
    document.getElementById('btnDecrypt').disabled = true;
    startPolling();
});

function switchAuthTab(tab) {
    const btnPwd = document.getElementById('tabPwd');
    const btnOtp = document.getElementById('tabOtp');
    const formPwd = document.getElementById('formPwd');
    const formOtp = document.getElementById('formOtp');
    const authLog = document.getElementById('authLog');
    
    authLog.textContent = ''; // clear log

    if (tab === 'pwd') {
        btnPwd.style.background = 'var(--accent)';
        btnPwd.style.color = '#000';
        btnOtp.style.background = 'rgba(229,193,88,.1)';
        btnOtp.style.color = 'var(--accent)';
        formPwd.style.display = 'block';
        formOtp.style.display = 'none';
    } else {
        btnOtp.style.background = 'var(--accent)';
        btnOtp.style.color = '#000';
        btnPwd.style.background = 'rgba(229,193,88,.1)';
        btnPwd.style.color = 'var(--accent)';
        formOtp.style.display = 'block';
        formPwd.style.display = 'none';
    }
}

async function handleRegister() {
    const voterId = document.getElementById('voterIdInput').value.trim();
    const email = document.getElementById('emailRegInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const authLog = document.getElementById('authLog');
    
    if (!voterId || !password || !email) {
        authLog.textContent = 'Vui lòng nhập Voter ID, Email và Password';
        return;
    }
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voter_id: voterId, password, email })
        });
        const data = await res.json();
        
        if (res.ok) {
            authLog.style.color = 'var(--accent)';
            authLog.textContent = 'Đăng ký thành công! Vui lòng Đăng nhập.';
        } else {
            authLog.style.color = 'var(--no)';
            authLog.textContent = data.error || 'Lỗi đăng ký';
        }
    } catch (err) {
        authLog.style.color = 'var(--no)';
        authLog.textContent = 'Lỗi kết nối';
    }
}

// --- OTP Logic ---
let otpCountdown = 0;
let otpInterval = null;

async function handleSendOTP() {
    const email = document.getElementById('emailOtpInput').value.trim();
    const authLog = document.getElementById('authLog');
    const btnSendOtp = document.getElementById('btnSendOtp');
    
    if (!email) {
        authLog.textContent = 'Vui lòng nhập Email để nhận OTP';
        return;
    }
    
    try {
        btnSendOtp.disabled = true;
        authLog.style.color = 'var(--accent)';
        authLog.textContent = 'Đang gửi OTP...';

        const res = await fetch('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        
        if (res.ok) {
            authLog.style.color = 'var(--accent)';
            authLog.textContent = data.message || 'OTP đã được gửi!';
            document.getElementById('otpCodeInput').disabled = false;
            document.getElementById('btnVerifyOtp').disabled = false;
            
            // Bắt đầu đếm ngược 60s
            otpCountdown = 60;
            if (otpInterval) clearInterval(otpInterval);
            otpInterval = setInterval(() => {
                otpCountdown--;
                if (otpCountdown <= 0) {
                    clearInterval(otpInterval);
                    btnSendOtp.textContent = 'Gửi lại';
                    btnSendOtp.disabled = false;
                } else {
                    btnSendOtp.textContent = `${otpCountdown}s`;
                }
            }, 1000);

        } else {
            btnSendOtp.disabled = false;
            authLog.style.color = 'var(--no)';
            authLog.textContent = data.error || 'Lỗi gửi OTP';
        }
    } catch (err) {
        btnSendOtp.disabled = false;
        authLog.style.color = 'var(--no)';
        authLog.textContent = 'Lỗi kết nối';
    }
}

async function handleVerifyOTP() {
    const email = document.getElementById('emailOtpInput').value.trim();
    const otp = document.getElementById('otpCodeInput').value.trim();
    const authLog = document.getElementById('authLog');
    
    if (!email || !otp) {
        authLog.textContent = 'Vui lòng nhập Email và mã OTP';
        return;
    }
    
    try {
        const res = await fetch('/api/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp })
        });
        const data = await res.json();
        
        if (res.ok) {
            jwtToken = data.token;
            currentVoterId = data.voter_id;
            document.getElementById('authCard').style.display = 'none';
            document.getElementById('voteCard').style.display = 'block';
            document.getElementById('voterTag').textContent = `VOTER ${currentVoterId}`;
            log(`Đăng nhập thành công với OTP. Voter ID: ${currentVoterId}`, 'ok');
            log('Hệ thống đã sẵn sàng. Vui lòng chọn cầu thủ bạn muốn bầu chọn.', 'info');
        } else {
            authLog.style.color = 'var(--no)';
            authLog.textContent = data.error || 'Mã OTP không hợp lệ';
        }
    } catch (err) {
        authLog.style.color = 'var(--no)';
        authLog.textContent = 'Lỗi kết nối';
    }
}

async function handleLogin() {
    const voterId = document.getElementById('voterIdInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const authLog = document.getElementById('authLog');
    
    if (!voterId || !password) {
        authLog.textContent = 'Vui lòng nhập Voter ID và Password';
        return;
    }
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voter_id: voterId, password })
        });
        const data = await res.json();
        
        if (res.ok) {
            jwtToken = data.token;
            currentVoterId = voterId;
            document.getElementById('authCard').style.display = 'none';
            document.getElementById('voteCard').style.display = 'block';
            document.getElementById('voterTag').textContent = `VOTER ${voterId}`;
            log(`Đăng nhập thành công với Voter ID: ${voterId}`, 'ok');
            log('Hệ thống đã sẵn sàng. Vui lòng chọn cầu thủ bạn muốn bầu chọn.', 'info');
        } else {
            authLog.style.color = 'var(--no)';
            authLog.textContent = data.error || 'Lỗi đăng nhập';
        }
    } catch (err) {
        authLog.style.color = 'var(--no)';
        authLog.textContent = 'Lỗi kết nối';
    }
}

function startPolling() {
    pollTimer = setInterval(pollStatus, 3000);
}

async function pollStatus() {
    try {
        const res = await fetch('/status');
        if (!res.ok) return;
        const s = await res.json();

        updateProgress(s.votes_received || 0, EXPECTED);

        const votedList = s.voted_ids || [];
        const sharedList = s.shared_ids || [];

        // Nếu server báo voter hiện tại đã vote, đồng bộ UI
        if (currentVoterId && (votedList.includes(currentVoterId) || votedList.includes(Number(currentVoterId)))) {
            if (!hasVoted) {
                hasVoted = true;
                lockVoteButtons();
                document.getElementById('votedBadge').classList.add('show');
                log('Hệ thống nhận dạng: Bạn đã gửi phiếu bầu thành công.', 'ok');
            }
        }

        // Nếu server báo voter hiện tại đã gửi fragment giải mã, đồng bộ UI
        if (currentVoterId && (sharedList.includes(currentVoterId) || sharedList.includes(Number(currentVoterId)))) {
            if (!shareSubmitted) {
                shareSubmitted = true;
                document.getElementById('btnDecrypt').disabled = true;
                log('Hệ thống nhận dạng: Bạn đã gửi mảnh giải mã thành công.', 'ok');
            }
        }

        // CHỈ MỞ khóa nút giải mã khi đủ 3 phiếu bầu và chưa gửi share
        if (s.votes_received >= EXPECTED && !shareSubmitted) {
            document.getElementById('btnDecrypt').disabled = false;
        } else if (s.votes_received < EXPECTED || shareSubmitted) {
            document.getElementById('btnDecrypt').disabled = true; // Khóa lại nếu server bị reset hoặc đã gửi
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

function selectCandidate(idx) {
    if (hasVoted) return;
    
    selectedCandidateIdx = idx;
    
    // Clear selections
    for (let i = 0; i < PLAYERS.length; i++) {
        document.getElementById(`candidate-${i}`).classList.remove('selected');
    }
    
    // Select this one
    document.getElementById(`candidate-${idx}`).classList.add('selected');
    
    // Enable submit button
    document.getElementById('btnSubmitVote').disabled = false;
}

async function submitBallot() {
    if (selectedCandidateIdx === null) return;
    await castVote(selectedCandidateIdx);
}

async function castVote(choiceIdx) {
    if (hasVoted) { log('Bạn đã bỏ phiếu rồi!', 'err'); return; }

    lockVoteButtons();
    const playerName = PLAYERS[choiceIdx].name;
    log(`Đang mã hóa phiếu bầu cho ${playerName.toUpperCase()} cục bộ...`, 'info');

    try {
        const res  = await fetch('/vote', {
            method:  'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
            },
            body:    JSON.stringify({ vote: choiceIdx, voter_id: currentVoterId }),
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
        const res  = await fetch('/partial-decrypt', { 
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify({ voter_id: currentVoterId })
        });
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

function showResult(resultText) {
    const match = resultText.match(/(\d+)/);
    if (match) {
        const sum = parseInt(match[1], 10);
        const listEl = document.getElementById('resultsList');
        listEl.innerHTML = '';
        
        let val = sum;
        for (let i = 0; i < PLAYERS.length; i++) {
            const votes = val % 4;
            val = Math.floor(val / 4);
            
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <span class="result-cand-name">${PLAYERS[i].name}</span>
                <span class="result-cand-votes">${votes} votes</span>
            `;
            listEl.appendChild(item);
        }
        
        document.getElementById('resultBox').classList.add('show');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
}

function lockVoteButtons() {
    for (let i = 0; i < PLAYERS.length; i++) {
        document.getElementById(`candidate-${i}`).style.pointerEvents = 'none';
        document.getElementById(`candidate-${i}`).style.opacity = '0.5';
    }
    document.getElementById('btnSubmitVote').disabled = true;
}

function unlockVoteButtons() {
    for (let i = 0; i < PLAYERS.length; i++) {
        document.getElementById(`candidate-${i}`).style.pointerEvents = 'auto';
        document.getElementById(`candidate-${i}`).style.opacity = '1';
        document.getElementById(`candidate-${i}`).classList.remove('selected');
    }
    document.getElementById('btnSubmitVote').disabled = true;
    document.getElementById('votedBadge').classList.remove('show');
}

async function generateCryptoKey() {
    const btn = document.getElementById('btnGenerateKey');
    btn.disabled = true;
    btn.textContent = 'GENERATING KEYS & UPLOADING SHARE...';
    log('Đang chạy sinh khóa mật mã local và đồng bộ mảnh khóa lên Server...', 'info');

    try {
        const res = await fetch('/api/generate-key', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify({ voter_id: currentVoterId })
        });
        const data = await res.json();

        if (res.ok) {
            log('✓ Tạo khóa và đồng bộ mảnh khóa thành công!', 'ok');
            alert('Khởi tạo khóa FHE và gửi mảnh khóa thành công!');
        } else {
            log(`✗ Sinh khóa thất bại: ${data.error}`, 'err');
            alert(`Lỗi sinh khóa: ${data.error}`);
        }
    } catch (err) {
        log(`✗ Lỗi kết nối sinh khóa: ${err.message}`, 'err');
        alert(`Lỗi kết nối sinh khóa: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = '[ GENERATED & UPLOAD NEW KEY SHARE ]';
    }
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
