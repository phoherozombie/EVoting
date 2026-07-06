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
    res.json({ votes_received: votesReceived, shares_received: sharesReceived, result: finalResult });
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
