const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const BUILD_DIR = '/home/tuyen/Project/evoting-system/EVoting/crypto/src_distributed/build';
const SERVER_DIR = path.join(BUILD_DIR, 'server');

let votesReceived = 0;
let sharesReceived = 0;
let finalResult = null;
const EXPECTED_VOTERS = 3;

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

app.post('/api/upload', upload.single('file'), (req, res) => {
    const type = req.body.type;
    console.log(`[Server] Nhận ${type} từ Client ${req.body.id}`);

    if (type === 'vote') {
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
