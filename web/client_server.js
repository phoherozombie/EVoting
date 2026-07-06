const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const CENTRAL_SERVER_URL = 'http://172.20.1.152:3001';
const BUILD_DIR = path.join(__dirname, '../src_distributed/build');

console.log(`[Khởi động] VoterApp Gateway`);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/register', async (req, res) => {
    try {
        const response = await axios.post(`${CENTRAL_SERVER_URL}/api/register`, req.body);
        res.json(response.data);
    } catch (err) { res.status(err.response?.status || 500).json(err.response?.data || { error: 'Lỗi server' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const response = await axios.post(`${CENTRAL_SERVER_URL}/api/login`, req.body);
        res.json(response.data);
    } catch (err) { res.status(err.response?.status || 500).json(err.response?.data || { error: 'Lỗi server' }); }
});

app.get('/status', async (req, res) => {
    try {
        const response = await axios.get(`${CENTRAL_SERVER_URL}/api/status`);
        res.json(response.data);
    } catch (err) { res.json({ votes_received: 0, result: null }); }
});

app.post('/vote', async (req, res) => {
    const { vote, voter_id } = req.body;
    const voteValue = vote === 'yes' ? 1 : 0;
    const authHeader = req.headers.authorization;
    
    try {
        if (!fs.existsSync(path.join(BUILD_DIR, 'params/crypto_params.bin'))) {
             throw new Error('Thiếu file params/crypto_params.bin. Hãy chạy ./setup trước!');
        }

        console.log(`[Voter ${voter_id}] Đang mã hóa phiếu...`);
        execSync(`./client_vote ${voter_id} ${voteValue}`, { cwd: BUILD_DIR });

        const voteFile = path.join(BUILD_DIR, 'server', `vote${voter_id}.bin`);
        
        // SỦA LỖI Ở ĐÂY: Append text attributes trước khi stream file
        const form = new FormData();
        form.append('type', 'vote');
        form.append('id', voter_id);
        form.append('file', fs.createReadStream(voteFile));

        const headers = { ...form.getHeaders() };
        if (authHeader) headers['Authorization'] = authHeader;

        await axios.post(`${CENTRAL_SERVER_URL}/api/upload`, form, { headers });
        res.json({ message: 'Đã gửi phiếu bầu thành công.' });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/partial-decrypt', async (req, res) => {
    const { voter_id } = req.body;
    const authHeader = req.headers.authorization;
    
    try {
        console.log(`[Voter ${voter_id}] Đang tải tally.bin...`);
        const resp = await axios.get(`${CENTRAL_SERVER_URL}/api/download/tally.bin`, { responseType: 'arraybuffer' });
        fs.writeFileSync(path.join(BUILD_DIR, 'server/tally.bin'), Buffer.from(resp.data));

        const skPath = path.join(BUILD_DIR, `client${voter_id}/sk.bin`);
        if (!fs.existsSync(skPath)) throw new Error(`Không tìm thấy chìa khóa tại ${skPath}`);

        console.log(`[Voter ${voter_id}] Đang giải mã...`);
        execSync(`./client_partial_decrypt ${voter_id}`, { cwd: BUILD_DIR });

        const shareFile = path.join(BUILD_DIR, `server/share${voter_id}.bin`);
        
        // SỦA LỖI Ở ĐÂY: Append text attributes trước khi stream file
        const form = new FormData();
        form.append('type', 'share');
        form.append('id', voter_id);
        form.append('file', fs.createReadStream(shareFile));

        const headers = { ...form.getHeaders() };
        if (authHeader) headers['Authorization'] = authHeader;

        const uploadRes = await axios.post(`${CENTRAL_SERVER_URL}/api/upload`, form, { headers });
        res.json({ message: 'Đã nộp phần giải mã của bạn.', ready_to_combine: uploadRes.data.ready_to_combine });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 VoterApp http://localhost:${PORT}`));
