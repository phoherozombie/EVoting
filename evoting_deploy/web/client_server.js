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

async function syncElectionParams() {
    try {
        console.log(`[Voter] Đang tự động đồng bộ crypto_params.bin...`);
        const paramsRes = await axios.get(`${CENTRAL_SERVER_URL}/api/download/crypto_params.bin`, { responseType: 'arraybuffer' });
        const paramsDir = path.join(BUILD_DIR, 'params');
        if (!fs.existsSync(paramsDir)) fs.mkdirSync(paramsDir, { recursive: true });
        fs.writeFileSync(path.join(paramsDir, 'crypto_params.bin'), Buffer.from(paramsRes.data));

        console.log(`[Voter] Đang tự động đồng bộ joint_pk.bin...`);
        const pkRes = await axios.get(`${CENTRAL_SERVER_URL}/api/download/joint_pk.bin`, { responseType: 'arraybuffer' });
        const serverDir = path.join(BUILD_DIR, 'server');
        if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
        fs.writeFileSync(path.join(serverDir, 'joint_pk.bin'), Buffer.from(pkRes.data));
    } catch (err) {
        console.warn(`[Cảnh báo] Không thể tải tham số từ server: ${err.message}. Sẽ sử dụng tham số local.`);
    }
}

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

app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const response = await axios.post(`${CENTRAL_SERVER_URL}/api/auth/send-otp`, req.body, {
            headers: { 'x-forwarded-for': clientIp }
        });
        res.json(response.data);
    } catch (err) { res.status(err.response?.status || 500).json(err.response?.data || { error: 'Lỗi server' }); }
});

app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const response = await axios.post(`${CENTRAL_SERVER_URL}/api/auth/verify-otp`, req.body, {
            headers: { 'x-forwarded-for': clientIp }
        });
        res.json(response.data);
    } catch (err) { res.status(err.response?.status || 500).json(err.response?.data || { error: 'Lỗi server' }); }
});

app.get('/status', async (req, res) => {
    try {
        const response = await axios.get(`${CENTRAL_SERVER_URL}/api/status`);
        res.json(response.data);
    } catch (err) { res.json({ votes_received: 0, result: null }); }
});

app.post('/api/generate-key', async (req, res) => {
    const { voter_id } = req.body;
    const id = parseInt(voter_id, 10);
    const authHeader = req.headers.authorization;
    
    try {
        console.log(`[Voter ${id}] Khởi động quy trình sinh khóa FHE...`);
        const serverDir = path.join(BUILD_DIR, 'server');
        if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });

        // 1. Tải và đồng bộ crypto_params.bin
        console.log(`[Voter ${id}] Đồng bộ crypto_params.bin từ server...`);
        const paramsRes = await axios.get(`${CENTRAL_SERVER_URL}/api/download/crypto_params.bin`, { responseType: 'arraybuffer' });
        const paramsDir = path.join(BUILD_DIR, 'params');
        if (!fs.existsSync(paramsDir)) fs.mkdirSync(paramsDir, { recursive: true });
        fs.writeFileSync(path.join(paramsDir, 'crypto_params.bin'), Buffer.from(paramsRes.data));

        // 2. Chạy sinh khóa (keygen) theo ID
        if (id === 1) {
            console.log(`[Voter 1] Chạy ./client_keygen 1...`);
            execSync('./client_keygen 1', { cwd: BUILD_DIR, stdio: 'inherit' });
        } else {
            const prevId = id - 1;
            console.log(`[Voter ${id}] Tải mảnh khóa pk_share${prevId}.bin từ server...`);
            const prevPkRes = await axios.get(`${CENTRAL_SERVER_URL}/api/download/pk_share${prevId}.bin`, { responseType: 'arraybuffer' });
            fs.writeFileSync(path.join(serverDir, `pk_share${prevId}.bin`), Buffer.from(prevPkRes.data));
            
            console.log(`[Voter ${id}] Chạy ./client_keygen ${id} ./server/pk_share${prevId}.bin...`);
            execSync(`./client_keygen ${id} ./server/pk_share${prevId}.bin`, { cwd: BUILD_DIR, stdio: 'inherit' });
        }

        // 3. Upload mảnh khóa vừa sinh lên server trung tâm
        const shareFile = path.join(serverDir, `pk_share${id}.bin`);
        if (!fs.existsSync(shareFile)) {
            throw new Error(`Không tìm thấy file mảnh khóa: ${shareFile}`);
        }

        const form = new FormData();
        form.append('type', 'pk_share');
        form.append('id', id.toString());
        form.append('file', fs.createReadStream(shareFile));

        const headers = { ...form.getHeaders() };
        if (authHeader) headers['Authorization'] = authHeader;

        console.log(`[Voter ${id}] Đang tải lên pk_share${id}.bin...`);
        await axios.post(`${CENTRAL_SERVER_URL}/api/upload`, form, { headers });

        res.json({ success: true, message: `Đã tạo và đồng bộ mảnh khóa cho Voter ${id}!` });
    } catch (error) {
        console.error(`[Lỗi sinh khóa Voter ${id}]:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/vote', async (req, res) => {
    const { vote, voter_id } = req.body;
    const candidateIdx = parseInt(vote, 10);
    const voteValue = Math.pow(4, candidateIdx);
    const authHeader = req.headers.authorization;
    
    try {
        await syncElectionParams();

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
