const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const CLIENT_ID = process.env.CLIENT_ID || '1'; 
const CENTRAL_SERVER_URL = process.env.CENTRAL_SERVER_URL || 'http://localhost:3001';
const BUILD_DIR = '/home/tuyen/Project/evoting-system/EVoting/crypto/src_distributed/build';

console.log(`[Khởi động] VoterApp ${CLIENT_ID}`);

app.get('/health', (req, res) => res.json({ status: 'ok', voter: `client${CLIENT_ID}` }));

app.get('/status', async (req, res) => {
    try {
        const response = await axios.get(`${CENTRAL_SERVER_URL}/api/status`);
        res.json(response.data);
    } catch (err) { res.json({ votes_received: 0, result: null }); }
});

app.post('/vote', async (req, res) => {
    const { vote } = req.body;
    const voteValue = vote === 'yes' ? 1 : 0;
    
    try {
        // Kiểm tra file phụ trợ
        if (!fs.existsSync(path.join(BUILD_DIR, 'params/crypto_params.bin'))) {
             throw new Error('Thiếu file params/crypto_params.bin. Hãy chạy ./setup trước!');
        }

        console.log(`[Voter ${CLIENT_ID}] Đang mã hóa phiếu...`);
        execSync(`./client_vote ${CLIENT_ID} ${voteValue}`, { cwd: BUILD_DIR });

        const voteFile = path.join(BUILD_DIR, 'server', `vote${CLIENT_ID}.bin`);
        const form = new FormData();
        form.append('file', fs.createReadStream(voteFile));
        form.append('type', 'vote');
        form.append('id', CLIENT_ID);

        await axios.post(`${CENTRAL_SERVER_URL}/api/upload`, form, { headers: form.getHeaders() });
        res.json({ message: 'Đã gửi phiếu bầu thành công.' });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/partial-decrypt', async (req, res) => {
    try {
        // 1. Tải tally.bin
        console.log(`[Voter ${CLIENT_ID}] Đang tải tally.bin...`);
        const resp = await axios.get(`${CENTRAL_SERVER_URL}/api/download/tally.bin`, { responseType: 'arraybuffer' });
        fs.writeFileSync(path.join(BUILD_DIR, 'server/tally.bin'), Buffer.from(resp.data));

        // 2. Kiểm tra Secret Key
        const skPath = path.join(BUILD_DIR, `client${CLIENT_ID}/sk.bin`);
        if (!fs.existsSync(skPath)) throw new Error(`Không tìm thấy chìa khóa tại ${skPath}`);

        // 3. Chạy Decrypt
        console.log(`[Voter ${CLIENT_ID}] Đang giải mã...`);
        execSync(`./client_partial_decrypt ${CLIENT_ID}`, { cwd: BUILD_DIR });

        // 4. Gửi share
        const shareFile = path.join(BUILD_DIR, `server/share${CLIENT_ID}.bin`);
        const form = new FormData();
        form.append('file', fs.createReadStream(shareFile));
        form.append('type', 'share');
        form.append('id', CLIENT_ID);

        const uploadRes = await axios.post(`${CENTRAL_SERVER_URL}/api/upload`, form, { headers: form.getHeaders() });
        res.json({ message: 'Đã nộp phần giải mã của bạn.', ready_to_combine: uploadRes.data.ready_to_combine });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 VoterApp http://localhost:${PORT}`));
