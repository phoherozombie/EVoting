const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const DATA_DIR = path.join(__dirname, 'server/data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const VOTERS_FILE = path.join(DATA_DIR, 'voters.json');
if (!fs.existsSync(VOTERS_FILE)) fs.writeFileSync(VOTERS_FILE, JSON.stringify([]));

const BUILD_DIR = '/home/tuyen/Project/evoting-system/EVoting/crypto/src_distributed/build';
const SERVER_DIR = path.join(BUILD_DIR, 'server');

let votesReceived = 0;
let sharesReceived = 0;
let finalResult = null;
const EXPECTED_VOTERS = 3;
let votedIds = new Set();
let sharedIds = new Set();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync(SERVER_DIR)) fs.mkdirSync(SERVER_DIR, { recursive: true });
        cb(null, SERVER_DIR);
    },
    filename: function (req, file, cb) {
        cb(null, `${req.body.type}${req.body.id}.bin`);
    }
});
const upload = multer({ storage: storage });

app.get('/api/status', (req, res) => {
    res.json({ 
        votes_received: votesReceived, 
        shares_received: sharesReceived, 
        result: finalResult,
        voted_ids: Array.from(votedIds),
        shared_ids: Array.from(sharedIds)
    });
});

app.get('/api/files', (req, res) => {
    try {
        if (fs.existsSync(SERVER_DIR)) {
            const files = fs.readdirSync(SERVER_DIR);
            res.json({ files });
        } else {
            res.json({ files: [] });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>E-Voting Central Server | Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0b0d13;
            --card-bg: #141824;
            --accent-cyan: #00f0ff;
            --accent-purple: #9d4edd;
            --text-main: #f8fafc;
            --text-secondary: #94a3b8;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --border-color: rgba(255, 255, 255, 0.08);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
        }

        header {
            background-color: rgba(20, 24, 36, 0.7);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--border-color);
            padding: 1.5rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .logo-wrap {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .pulse-led {
            width: 12px;
            height: 12px;
            background-color: var(--success);
            border-radius: 50%;
            box-shadow: 0 0 10px var(--success);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.9); opacity: 0.6; }
            50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 18px var(--success); }
            100% { transform: scale(0.9); opacity: 0.6; }
        }

        h1 {
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, #00f0ff, #9d4edd);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: 0.5px;
        }

        .container {
            max-width: 1200px;
            width: 100%;
            margin: 2.5rem auto;
            padding: 0 1.5rem;
            flex-grow: 1;
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 2rem;
        }

        @media (max-width: 900px) {
            .container {
                grid-template-columns: 1fr;
            }
        }

        .card {
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 1.75rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            margin-bottom: 2rem;
        }

        .card-title {
            font-size: 1.15rem;
            font-weight: 600;
            margin-bottom: 1.25rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 0.75rem;
            color: var(--accent-cyan);
        }

        .grid-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
        }

        @media (max-width: 600px) {
            .grid-stats {
                grid-template-columns: 1fr;
            }
        }

        .stat-box {
            background-color: rgba(255,255,255,0.02);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.25rem;
            text-align: center;
        }

        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--text-main);
            margin: 0.5rem 0;
            font-family: 'JetBrains Mono', monospace;
        }

        .progress-bar-container {
            background-color: rgba(255,255,255,0.05);
            height: 10px;
            border-radius: 5px;
            margin-top: 1rem;
            overflow: hidden;
            width: 100%;
        }

        .progress-fill {
            height: 100%;
            border-radius: 5px;
            width: 0%;
            transition: width 0.5s ease-out;
        }

        .progress-votes {
            background: linear-gradient(90deg, #3b82f6, var(--accent-cyan));
        }

        .progress-shares {
            background: linear-gradient(90deg, #8b5cf6, var(--accent-purple));
        }

        .client-list {
            margin-top: 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .client-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background-color: rgba(255,255,255,0.015);
            padding: 0.75rem 1rem;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.03);
        }

        .status-badge {
            font-size: 0.8rem;
            font-weight: 600;
            padding: 0.25rem 0.6rem;
            border-radius: 20px;
            text-transform: uppercase;
        }

        .status-done {
            background-color: rgba(16, 185, 129, 0.15);
            color: var(--success);
        }

        .status-wait {
            background-color: rgba(245, 158, 11, 0.15);
            color: var(--warning);
        }

        .result-display {
            background: radial-gradient(circle at top left, rgba(0, 240, 255, 0.05), rgba(157, 78, 221, 0.05));
            border: 2px solid rgba(0, 240, 255, 0.15);
            border-radius: 16px;
            padding: 2rem;
            text-align: center;
            position: relative;
            overflow: hidden;
        }

        .result-title {
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
        }

        .result-number {
            font-size: 4rem;
            font-weight: 700;
            color: var(--accent-cyan);
            font-family: 'JetBrains Mono', monospace;
            text-shadow: 0 0 20px rgba(0, 240, 255, 0.4);
        }

        .file-list {
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
            max-height: 380px;
            overflow-y: auto;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.9rem;
        }

        .file-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background-color: rgba(0,0,0,0.2);
            border: 1px solid rgba(255,255,255,0.03);
            padding: 0.6rem 0.8rem;
            border-radius: 8px;
        }

        .file-name {
            color: #e2e8f0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .file-status {
            font-size: 0.75rem;
            color: var(--success);
            background-color: rgba(16, 185, 129, 0.1);
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
        }

        .file-empty {
            color: var(--text-secondary);
            text-align: center;
            padding: 2rem;
            font-style: italic;
        }

        .btn-reset {
            width: 100%;
            background-color: transparent;
            border: 1.5px solid var(--danger);
            color: var(--text-main);
            padding: 1rem;
            font-size: 1rem;
            font-weight: 600;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 0.5rem;
        }

        .btn-reset:hover {
            background-color: var(--danger);
            box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
            transform: translateY(-2px);
        }

        .btn-reset:active {
            transform: translateY(0);
        }

        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: var(--card-bg);
            border-left: 4px solid var(--success);
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
            z-index: 1000;
        }

        .toast.show {
            transform: translateY(0);
            opacity: 1;
        }
    </style>
</head>
<body>

    <header>
        <div class="logo-wrap">
            <div class="pulse-led"></div>
            <h1>E-VOTING CENTRAL CONTROL PANEL</h1>
        </div>
        <div style="font-size:0.85rem; color: var(--text-secondary);">
            Server IP: <span style="font-family:'JetBrains Mono';color:#fff">172.20.1.152:3001</span>
        </div>
    </header>

    <div class="container">
        <!-- Main Area -->
        <div>
            <!-- Grid summary -->
            <div class="grid-stats">
                <div class="card">
                    <div class="card-title">
                        <span>Ballots Uploaded (Phiếu Bầu)</span>
                        <span id="voteCountBadge">0 / 3</span>
                    </div>
                    <div class="stat-value" id="voteCountText">0</div>
                    <div class="progress-bar-container">
                        <div class="progress-fill progress-votes" id="voteProgress"></div>
                    </div>
                    <div class="client-list" id="voteClientList">
                        <div class="client-item"><span>Voter 1</span><span class="status-badge status-wait">Waiting</span></div>
                        <div class="client-item"><span>Voter 2</span><span class="status-badge status-wait">Waiting</span></div>
                        <div class="client-item"><span>Voter 3</span><span class="status-badge status-wait">Waiting</span></div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-title">
                        <span>Decryption Shares (Mảnh khóa)</span>
                        <span id="shareCountBadge">0 / 3</span>
                    </div>
                    <div class="stat-value" id="shareCountText">0</div>
                    <div class="progress-bar-container">
                        <div class="progress-fill progress-shares" id="shareProgress"></div>
                    </div>
                    <div class="client-list" id="shareClientList">
                        <div class="client-item"><span>Voter 1 Share</span><span class="status-badge status-wait">Waiting</span></div>
                        <div class="client-item"><span>Voter 2 Share</span><span class="status-badge status-wait">Waiting</span></div>
                        <div class="client-item"><span>Voter 3 Share</span><span class="status-badge status-wait">Waiting</span></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Sidebar (Files and Actions) -->
        <div>
            <!-- Files present -->
            <div class="card" style="margin-bottom:1.5rem">
                <div class="card-title">Server Storage Check (.bin)</div>
                <div class="file-list" id="fileList">
                    <div class="file-empty">Scanning files...</div>
                </div>
            </div>

            <!-- Reset Actions -->
            <div class="card">
                <div class="card-title">System Commands</div>
                <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1.5rem">
                    Nút khôi phục dưới đây sẽ xóa vĩnh viễn toàn bộ các file phiếu bầu (.bin) trên ổ đĩa và reset trạng thái kiểm phiếu về số 0.
                </div>
                <button class="btn-reset" onclick="resetSystem()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                    RESET SYSTEM STATE
                </button>
            </div>
        </div>
    </div>

    <div class="toast" id="toast">Đã reset hệ thống thành công!</div>

    <script>
        const API_STATUS = '/api/status';
        const API_FILES = '/api/files';
        const API_RESET = '/api/reset';

        async function updateDashboard() {
            try {
                // 1. Fetch Status
                const statusRes = await fetch(API_STATUS);
                const status = await statusRes.json();
                
                const votes = status.votes_received || 0;
                const shares = status.shares_received || 0;
                const voted = status.voted_ids || [];
                const shared = status.shared_ids || [];

                // Update vote details
                document.getElementById('voteCountBadge').textContent = \`\${votes} / 3\`;
                document.getElementById('voteCountText').textContent = votes;
                document.getElementById('voteProgress').style.width = \`\${Math.round((votes/3)*100)}%\`;

                // Update share details
                document.getElementById('shareCountBadge').textContent = \`\${shares} / 3\`;
                document.getElementById('shareCountText').textContent = shares;
                document.getElementById('shareProgress').style.width = \`\${Math.round((shares/3)*100)}%\`;

                // Update client voter status
                let voteHtml = '';
                for (let i = 1; i <= 3; i++) {
                    const isVoted = voted.includes(String(i)) || voted.includes(i);
                    voteHtml += \`<div class="client-item">
                        <span>Voter \${i}</span>
                        <span class="status-badge \${isVoted ? 'status-done':'status-wait'}">\${isVoted ? 'Voted' : 'Waiting'}</span>
                    </div>\`;
                }
                document.getElementById('voteClientList').innerHTML = voteHtml;

                // Update client share status
                let shareHtml = '';
                for (let i = 1; i <= 3; i++) {
                    const isShared = shared.includes(String(i)) || shared.includes(i);
                    shareHtml += \`<div class="client-item">
                        <span>Voter \${i} Share</span>
                        <span class="status-badge \${isShared ? 'status-done':'status-wait'}">\${isShared ? 'Sent' : 'Waiting'}</span>
                    </div>\`;
                }
                document.getElementById('shareClientList').innerHTML = shareHtml;

                // 2. Fetch Files
                const filesRes = await fetch(API_FILES);
                const filesData = await filesRes.json();
                const files = filesData.files || [];
                
                let filesHtml = '';
                const expectedFiles = [
                    'joint_pk.bin',
                    'vote1.bin',
                    'vote2.bin',
                    'vote3.bin',
                    'tally.bin',
                    'share1.bin',
                    'share2.bin',
                    'share3.bin'
                ];

                expectedFiles.forEach(expected => {
                    const present = files.includes(expected);
                    filesHtml += \`<div class="file-item" style="opacity: \${present ? 1 : 0.4}">
                        <span class="file-name" style="color: \${present ? '#fff':'var(--text-secondary)'}">\${expected}</span>
                        <span class="status-badge \${present ? 'status-done':'status-wait'}" style="font-size:0.7rem">\${present ? 'Present':'None'}</span>
                    </div>\`;
                });
                document.getElementById('fileList').innerHTML = filesHtml;

            } catch (err) {
                console.error('Lỗi khi fetch API:', err);
            }
        }

        async function resetSystem() {
            if(!confirm('Bạn có chắc chắn muốn reset toàn bộ hệ thống?')) return;
            try {
                const res = await fetch(API_RESET);
                if (res.ok) {
                    showToast();
                    updateDashboard();
                }
            } catch (err) {
                alert('Lỗi khi reset: ' + err.message);
            }
        }

        function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        // Tự động reload cập nhật sau mỗi 1.5 giây
        setInterval(updateDashboard, 1500);
        updateDashboard();
    </script>
</body>
</html>`);
});

app.get('/api/download/:filename', (req, res) => {
    const filepath = path.join(SERVER_DIR, req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).send('File not found');
    res.download(filepath);
});

// Auth Middleware
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, process.env.JWT_SECRET || 'super_secret_voting_key_2026', (err, user) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    } else {
        res.sendStatus(401);
    }
};

app.post('/api/register', (req, res) => {
    const { voter_id, password } = req.body;
    if (!voter_id || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    
    let voters = JSON.parse(fs.readFileSync(VOTERS_FILE));
    if (voters.find(v => v.voter_id === voter_id)) {
        return res.status(400).json({ error: 'Cử tri đã đăng ký' });
    }
    
    voters.push({ voter_id, password });
    fs.writeFileSync(VOTERS_FILE, JSON.stringify(voters));
    res.json({ success: true, message: 'Đăng ký thành công' });
});

app.post('/api/login', (req, res) => {
    const { voter_id, password } = req.body;
    let voters = JSON.parse(fs.readFileSync(VOTERS_FILE));
    const user = voters.find(v => v.voter_id === voter_id && v.password === password);
    
    if (user) {
        const token = jwt.sign({ voter_id: user.voter_id }, process.env.JWT_SECRET || 'super_secret_voting_key_2026', { expiresIn: '1h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Sai thông tin đăng nhập' });
    }
});

app.post('/api/upload', authenticateJWT, upload.single('file'), (req, res) => {
    const type = req.body.type;
    console.log(`[Server] Nhận ${type} từ Client ${req.body.id}`);

    if (req.user.voter_id !== req.body.id) {
        return res.status(403).json({ error: 'ID không khớp với token đăng nhập' });
    }

    if (type === 'vote') {
        if (votedIds.has(req.user.voter_id)) {
            return res.status(403).json({ error: 'Bạn đã bỏ phiếu rồi!' });
        }
        votedIds.add(req.user.voter_id);
        
        votesReceived++;
        if (votesReceived >= EXPECTED_VOTERS) {
            console.log(`[Server] Đủ phiếu! Đang chạy tally...`);
            try { execSync('./server_tally', { cwd: BUILD_DIR, stdio: 'inherit' }); } catch (err) {
                console.error('Lỗi chạy server_tally:', err.message);
            }
        }
        res.json({ success: true, server: { count: votesReceived } });
    } 
    else if (type === 'share') {
        if (sharedIds.has(req.user.voter_id)) {
            return res.status(403).json({ error: 'Bạn đã nộp phần giải mã rồi!' });
        }
        sharedIds.add(req.user.voter_id);
        
        sharesReceived++;
        let ready = false;
        if (sharesReceived >= EXPECTED_VOTERS) {
            ready = true;
            console.log(`[Server] Đủ share! Đang chạy fusion...`);
            try {
                const output = execSync('./server_fusion', { cwd: BUILD_DIR, encoding: 'utf-8' });
                console.log(output);
                const match = output.match(/FINAL RESULT = ([\s\S]*)$/);
                if (match) {
                     finalResult = match[0].trim();
                } else {
                     finalResult = output;
                }
            } catch (err) {
                console.error('Lỗi chạy server_fusion:', err.message);
            }
        }
        res.json({ success: true, ready_to_combine: ready });
    }
});

// API reset: Dọn sạch cả bộ nhớ RAM và ổ đĩa cứng
app.get('/api/reset', (req, res) => {
    votesReceived = 0;
    sharesReceived = 0;
    finalResult = null;
    votedIds.clear();
    sharedIds.clear();

    try {
        if (fs.existsSync(SERVER_DIR)) {
            const files = fs.readdirSync(SERVER_DIR);
            for (const file of files) {
                if (file.startsWith('vote') || file.startsWith('share') || file === 'tally.bin') {
                    fs.unlinkSync(path.join(SERVER_DIR, file));
                }
            }
            console.log('[Server] Đã dọn sạch các file vote/share/tally trong server/...');
        }
    } catch (err) {
        console.error('Lỗi khi xóa file lúc reset:', err.message);
    }

    res.send('Đã reset biến trạng thái và dọn sạch các file rác trên Server.');
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Central API: http://localhost:${PORT}`);
});
