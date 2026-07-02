const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ĐƯỜNG DẪN ĐÃ SỬA: Khớp với Project (không dấu cách)
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
            try { execSync('./server_tally', { cwd: BUILD_DIR, stdio: 'inherit' }); } catch (err) {}
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
                const match = output.match(/FINAL RESULT = (\d+)/);
                if (match) finalResult = match[0];
            } catch (err) {}
        }
        res.json({ success: true, ready_to_combine: ready });
    }
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Central API: http://localhost:${PORT}`);
});
