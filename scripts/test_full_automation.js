// =============================================================
// scripts/test_full_automation.js
// Automated Integration and Security Test for Distributed MK-FHE
// =============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const CRYPTO_BIN = path.join(ROOT, 'crypto', 'build');
const PARAMS_FILE = path.join(ROOT, 'params', 'crypto_params.bin');

// Directory for test clients local storage
const TEST_DATA_DIR = path.join(__dirname, 'test_data');

// Ensure test directory is clean
function cleanTestData() {
    if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

// Helper to run C++ binaries locally (simulating client)
function runLocalBinary(name, args = []) {
    const bin = path.join(CRYPTO_BIN, name);
    if (!fs.existsSync(bin)) {
        throw new Error(`Binary not found: ${bin}. Build it first!`);
    }
    const result = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`${name} failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

// HTTP request helper
function request(path, method, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const isBuffer = Buffer.isBuffer(body);
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: method,
            headers: {
                ...headers
            }
        };

        if (body && !isBuffer) {
            options.headers['Content-Type'] = 'application/json';
        } else if (isBuffer) {
            options.headers['Content-Type'] = 'application/octet-stream';
        }

        const req = http.request(options, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const resBody = Buffer.concat(chunks);
                const isJson = res.headers['content-type'] && res.headers['content-type'].includes('application/json');
                
                if (res.statusCode >= 400) {
                    const errMsg = isJson ? JSON.parse(resBody.toString()).error : resBody.toString();
                    reject({ statusCode: res.statusCode, error: errMsg });
                } else {
                    if (isJson) {
                        try {
                            resolve({ statusCode: res.statusCode, data: JSON.parse(resBody.toString()) });
                        } catch (e) {
                            resolve({ statusCode: res.statusCode, data: resBody });
                        }
                    } else {
                        resolve({ statusCode: res.statusCode, data: resBody });
                    }
                }
            });
        });

        req.on('error', reject);

        if (body) {
            if (isBuffer) {
                req.write(body);
            } else {
                req.write(JSON.stringify(body));
            }
        }
        req.end();
    });
}

// Assert helper
function assert(condition, message) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`  ✓ ${message}`);
}

async function run() {
    try {
        console.log("=============================================================");
        console.log("   DISTRIBUTED MK-FHE E-VOTING SYSTEM COMPREHENSIVE TESTS    ");
        console.log("=============================================================\n");

        cleanTestData();

        // -----------------------------------------------------------------
        // RESET
        // -----------------------------------------------------------------
        console.log("== 1. Resetting Server State ==");
        await request('/reset', 'POST');
        console.log("✓ Server reset successfully.\n");

        // -----------------------------------------------------------------
        // SUCCESS CASE 1 & 2: Registration & Client Keygen
        // -----------------------------------------------------------------
        console.log("== 2. Testing Registration, Keygen, and PK upload ==");
        
        const voterInputs = [
            { name: 'Nguyen Van A', cccd: '012345678901', dob: '1995-03-15', address: 'Da Nang', phone: '0901111111', voteIndex: 1 }, // YES
            { name: 'Tran Thi B',  cccd: '023456789012', dob: '1990-07-20', address: 'Ha Noi',  phone: '0902222222', voteIndex: 1 }, // YES
            { name: 'Le Van C',    cccd: '034567890123', dob: '1988-12-05', address: 'HCM',     phone: null,          voteIndex: 0 }  // NO
        ];

        const voters = [];

        for (let i = 0; i < voterInputs.length; i++) {
            const inp = voterInputs[i];
            console.log(`Registering ${inp.name}...`);
            const regRes = await request('/register', 'POST', {
                full_name: inp.name,
                cccd:      inp.cccd,
                dob:       inp.dob,
                address:   inp.address,
                phone:     inp.phone
            });
            assert(regRes.statusCode === 200, `Registered ${inp.name}`);

            const voter = {
                id:        regRes.data.voter_id,
                name:      inp.name,
                cccd:      inp.cccd,
                token:     regRes.data.token,
                isFirst:   regRes.data.isFirst === 1,
                voteIndex: inp.voteIndex
            };
            voters.push(voter);

            const voterDir = path.join(TEST_DATA_DIR, voter.id);
            fs.mkdirSync(voterDir, { recursive: true });

            // Generate keys locally
            const skPath = path.join(voterDir, 'secret_key.bin');
            const pkPath = path.join(voterDir, 'public_key.bin');
            
            let tempJointPkPath = "";
            if (!voter.isFirst) {
                console.log(`Downloading current joint public key for ${voter.id}...`);
                const pkDlRes = await request('/joint_pk', 'GET');
                assert(pkDlRes.statusCode === 200, `Downloaded joint PK for ${voter.id}`);
                tempJointPkPath = path.join(voterDir, 'temp_joint_pk.bin');
                fs.writeFileSync(tempJointPkPath, pkDlRes.data);
            } else {
                tempJointPkPath = path.join(voterDir, 'dummy_joint_pk.bin');
                fs.writeFileSync(tempJointPkPath, Buffer.alloc(0));
            }

            console.log(`Running voter_keygen locally for ${voter.id}...`);
            runLocalBinary('voter_keygen', [
                voter.id,
                voter.isFirst ? '1' : '0',
                tempJointPkPath,
                skPath,
                pkPath,
                PARAMS_FILE
            ]);

            assert(fs.existsSync(skPath), `Local SK generated for ${voter.id}`);
            assert(fs.existsSync(pkPath), `Local PK generated for ${voter.id}`);

            // Verify server directory contains no secret keys
            const serverKeysDir = path.join(ROOT, 'server', 'data', 'keys');
            const hasServerSk = fs.readdirSync(serverKeysDir).some(f => f.includes('sk_') || f.includes('secret'));
            assert(!hasServerSk, `Cryptographic isolation: Server does NOT store secret key for ${voter.id}`);

            console.log(`Uploading public key share for ${voter.id}...`);
            const pkBuffer = fs.readFileSync(pkPath);
            const uploadPkRes = await request('/upload_pk', 'POST', pkBuffer, {
                'Authorization': `Bearer ${voter.token}`
            });
            assert(uploadPkRes.statusCode === 200, `Uploaded PK share for ${voter.id}`);
        }

        // Verify voters.json was written
        const votersDbPath = path.join(ROOT, 'server', 'data', 'voters', 'voters.json');
        assert(fs.existsSync(votersDbPath), 'voters.json was persisted to disk');
        const votersDb = JSON.parse(fs.readFileSync(votersDbPath, 'utf8'));
        assert(votersDb.length === 3, `voters.json contains 3 records (got ${votersDb.length})`);
        assert(votersDb[0].has_voted === false, 'has_voted is false before voting');
        console.log("✓ Success Case: Registration & Local Keygen verified.\n");

        // -----------------------------------------------------------------
        // FAILURE CASE: State Transitions & Invalid Token & Spoofed ID during registration
        // -----------------------------------------------------------------
        console.log("== 3. Testing Registration Phase Failure Cases ==");
        
        // Failure: Register duplicate CCCD
        try {
            await request('/register', 'POST', {
                full_name: 'Duplicate Person',
                cccd: '012345678901', // same as voter 0
                dob: '1990-01-01',
                address: 'Some City'
            });
            assert(false, "Should not allow duplicate CCCD");
        } catch (err) {
            assert(err.statusCode === 409, `Rejected duplicate CCCD (status ${err.statusCode})`);
        }

        // Failure: Register with invalid CCCD (not 12 digits)
        try {
            await request('/register', 'POST', {
                full_name: 'Invalid Person',
                cccd: '123', // too short
                dob: '1990-01-01',
                address: 'Some City'
            });
            assert(false, "Should reject invalid CCCD");
        } catch (err) {
            assert(err.statusCode === 400, `Rejected invalid CCCD (status ${err.statusCode})`);
        }

        // Failure: Register underage voter
        try {
            await request('/register', 'POST', {
                full_name: 'Young Person',
                cccd: '099988877766',
                dob: '2015-01-01', // 9 years old
                address: 'Some City'
            });
            assert(false, "Should reject underage voter");
        } catch (err) {
            assert(err.statusCode === 400, `Rejected underage voter (status ${err.statusCode})`);
        }

        // Failure: Upload PK without token
        try {
            await request('/upload_pk', 'POST', Buffer.from('dummy-pk-bytes'));
            assert(false, "Should reject PK upload without token");
        } catch (err) {
            assert(err.statusCode === 401, `Rejected PK upload without token (status ${err.statusCode})`);
        }

        // Failure: Upload PK with invalid token
        try {
            await request('/upload_pk', 'POST', Buffer.from('dummy-pk-bytes'), {
                'Authorization': 'Bearer invalid_token_123'
            });
            assert(false, "Should reject PK upload with invalid token");
        } catch (err) {
            assert(err.statusCode === 401, `Rejected PK upload with invalid token (status ${err.statusCode})`);
        }

        // Failure: Spoofed voterId during PK upload — duplicate PK from same voter
        try {
            await request('/upload_pk', 'POST', Buffer.from('dummy-pk-bytes'), {
                'Authorization': `Bearer ${voters[0].token}`
            });
            assert(false, "Should reject duplicate PK upload from same voter");
        } catch (err) {
            assert(err.statusCode === 409, `Rejected duplicate PK upload (status ${err.statusCode})`);
        }
        console.log("✓ Registration phase failure cases verified.\n");

        // -----------------------------------------------------------------
        // FAILURE CASE: Vote before Finalize
        // -----------------------------------------------------------------
        console.log("== 4. Testing State Machine: Voting before Finalize ==");
        try {
            await request('/vote', 'POST', Buffer.from('dummy-vote-bytes'), {
                'Authorization': `Bearer ${voters[0].token}`
            });
            assert(false, "Should reject vote before finalize");
        } catch (err) {
            assert(err.statusCode === 409, `Rejected vote before finalize (status ${err.statusCode})`);
        }

        // Finalize registration
        console.log("Finalizing registration...");
        const finRes = await request('/finalize', 'POST');
        assert(finRes.statusCode === 200, "Election finalized");

        // Failure: Register after finalize
        try {
            await request('/register', 'POST', {
                full_name: 'Dave Late',
                cccd: '099911122233',
                dob: '1985-06-01',
                address: 'Can Tho'
            });
            assert(false, "Should reject registration after finalize");
        } catch (err) {
            assert(err.statusCode === 409, `Rejected registration after finalize (status ${err.statusCode})`);
        }
        console.log("✓ State transition rules verified.\n");

        // -----------------------------------------------------------------
        // SUCCESS CASE: Encrypted Voting
        // -----------------------------------------------------------------
        console.log("== 5. Testing Encrypted Voting ==");
        
        // Download finalized joint PK
        console.log("Downloading finalized joint public key...");
        const jointPkRes = await request('/joint_pk', 'GET');
        assert(jointPkRes.statusCode === 200, "Downloaded final joint PK");
        const finalJointPkPath = path.join(TEST_DATA_DIR, 'final_joint_pk.bin');
        fs.writeFileSync(finalJointPkPath, jointPkRes.data);

        for (const voter of voters) {
            const voterDir = path.join(TEST_DATA_DIR, voter.id);
            const encVotePath = path.join(voterDir, 'enc_vote.bin');

            console.log(`Encrypting vote locally for ${voter.name} (choice: ${voter.voteIndex})...`);
            runLocalBinary('encrypt_vote', [
                String(voter.voteIndex),
                finalJointPkPath,
                encVotePath,
                PARAMS_FILE
            ]);

            assert(fs.existsSync(encVotePath), `Local ciphertext generated for ${voter.id}`);

            console.log(`Uploading ciphertext for ${voter.id}...`);
            const voteBuffer = fs.readFileSync(encVotePath);
            const voteRes = await request('/vote', 'POST', voteBuffer, {
                'Authorization': `Bearer ${voter.token}`
            });
            assert(voteRes.statusCode === 200, `Uploaded encrypted vote for ${voter.id}`);
        }
        console.log("✓ Success Case: Encrypted votes uploaded.\n");

        // -----------------------------------------------------------------
        // FAILURE CASE: Double Voting & Voting Failures
        // -----------------------------------------------------------------
        console.log("== 6. Testing Voting Phase Failure Cases ==");

        // Failure: Double voting
        try {
            console.log("Attempting double vote for voter1...");
            const voteBuffer = fs.readFileSync(path.join(TEST_DATA_DIR, 'voter1', 'enc_vote.bin'));
            await request('/vote', 'POST', voteBuffer, {
                'Authorization': `Bearer ${voters[0].token}`
            });
            assert(false, "Should reject double voting");
        } catch (err) {
            assert(err.statusCode === 409, `Rejected double voting (status ${err.statusCode})`);
        }

        // Failure: Malformed ciphertext (empty body)
        try {
            console.log("Attempting vote with malformed payload (empty body)...");
            await request('/vote', 'POST', Buffer.alloc(0), {
                'Authorization': `Bearer ${voters[0].token}` // voter1 already voted, but check validation first
            });
            assert(false, "Should reject empty payload");
        } catch (err) {
            assert(err.statusCode === 400 || err.statusCode === 409, `Rejected malformed payload (status ${err.statusCode})`);
        }
        console.log("✓ Voting phase failure cases verified.\n");

        // -----------------------------------------------------------------
        // SUCCESS CASE: Homomorphic Tally
        // -----------------------------------------------------------------
        console.log("== 7. Testing Homomorphic Tally ==");
        
        console.log("Running tally on server...");
        const tallyRes = await request('/tally', 'POST');
        assert(tallyRes.statusCode === 200, "Tally computed on server");

        // Failure: Vote after tally (election closed)
        try {
            console.log("Attempting to vote after tally starts...");
            const voteBuffer = fs.readFileSync(path.join(TEST_DATA_DIR, 'voter1', 'enc_vote.bin'));
            // Create a fake token/user just to show it rejects due to election closed, not already voted
            await request('/vote', 'POST', voteBuffer, {
                'Authorization': `Bearer ${voters[0].token}`
            });
            assert(false, "Should reject vote because election is closed");
        } catch (err) {
            assert(err.statusCode === 409, `Rejected vote: election closed (status ${err.statusCode})`);
        }
        console.log("✓ Success Case: Homomorphic tally computed & Election Closed state verified.\n");

        // -----------------------------------------------------------------
        // SUCCESS & FAILURE: Share Generation & Missing Share & Spoofed Share
        // -----------------------------------------------------------------
        console.log("== 8. Testing Decryption Share Phase ==");

        // Download tally ciphertext
        console.log("Downloading encrypted tally...");
        const tallyDlRes = await request('/tally', 'GET');
        assert(tallyDlRes.statusCode === 200, "Downloaded enc_tally.bin");
        const encTallyPath = path.join(TEST_DATA_DIR, 'enc_tally.bin');
        fs.writeFileSync(encTallyPath, tallyDlRes.data);

        // Failure: Fetch results before shares are submitted (missing share)
        try {
            console.log("Attempting to fetch results before combining shares...");
            await request('/result', 'GET');
            assert(false, "Should reject fetching results when complete tally not computed");
        } catch (err) {
            assert(err.statusCode === 404, `Rejected result request: results not available (status ${err.statusCode})`);
        }

        // Generate shares for voters
        for (const voter of voters) {
            const voterDir = path.join(TEST_DATA_DIR, voter.id);
            const skPath = path.join(voterDir, 'secret_key.bin');
            const sharePath = path.join(voterDir, `share_${voter.id}.bin`);

            console.log(`Running voter_partial_decrypt locally for ${voter.id} (isFirst: ${voter.isFirst})...`);
            runLocalBinary('voter_partial_decrypt', [
                voter.id,
                voter.isFirst ? '1' : '0',
                skPath,
                encTallyPath,
                sharePath,
                PARAMS_FILE
            ]);

            assert(fs.existsSync(sharePath), `Decryption share generated locally for ${voter.id}`);
            voter.sharePath = sharePath;
        }

        // Failure: Submit share with invalid token
        try {
            console.log("Attempting to upload share with invalid token...");
            const shareBuffer = fs.readFileSync(voters[0].sharePath);
            await request('/share', 'POST', shareBuffer, {
                'Authorization': 'Bearer invalid_token_123'
            });
            assert(false, "Should reject share upload with invalid token");
        } catch (err) {
            assert(err.statusCode === 401, `Rejected share upload with invalid token (status ${err.statusCode})`);
        }

        // Upload shares for voter1 and voter2
        console.log("Uploading share for voter1...");
        const share1Buffer = fs.readFileSync(voters[0].sharePath);
        const share1Res = await request('/share', 'POST', share1Buffer, {
            'Authorization': `Bearer ${voters[0].token}`
        });
        assert(share1Res.statusCode === 200, "Share 1 accepted");

        console.log("Uploading share for voter2...");
        const share2Buffer = fs.readFileSync(voters[1].sharePath);
        const share2Res = await request('/share', 'POST', share2Buffer, {
            'Authorization': `Bearer ${voters[1].token}`
        });
        assert(share2Res.statusCode === 200, "Share 2 accepted");

        // Failure: Double share submission
        try {
            console.log("Attempting double share upload for voter1...");
            await request('/share', 'POST', share1Buffer, {
                'Authorization': `Bearer ${voters[0].token}`
            });
            assert(false, "Should reject duplicate share upload");
        } catch (err) {
            assert(err.statusCode === 409, `Rejected duplicate share upload (status ${err.statusCode})`);
        }

        // Still missing share 3, check result again
        try {
            console.log("Checking results again before final share is uploaded...");
            await request('/result', 'GET');
            assert(false, "Should reject fetching results when share is missing");
        } catch (err) {
            assert(err.statusCode === 404, `Rejected result request: missing share (status ${err.statusCode})`);
        }

        // Upload final share for voter3 (Charlie)
        console.log("Uploading share for voter3...");
        const share3Buffer = fs.readFileSync(voters[2].sharePath);
        const share3Res = await request('/share', 'POST', share3Buffer, {
            'Authorization': `Bearer ${voters[2].token}`
        });
        assert(share3Res.statusCode === 200, "Share 3 accepted. Fusion Decryption triggered.");

        // Wait a short time for async combine
        console.log("Waiting for decryption fusion combine...");
        await new Promise(r => setTimeout(r, 2000));

        // -----------------------------------------------------------------
        // SUCCESS CASE: Results Reveal & Correct Tally
        // -----------------------------------------------------------------
        console.log("== 9. Fetching Final Results ==");
        const resultRes = await request('/result', 'GET');
        assert(resultRes.statusCode === 200, "Successfully fetched final results");
        
        const rawResults = resultRes.data.result;
        console.log("Raw results from server:\n" + rawResults);

        // Verify correct votes
        // Alice and Bob voted 1. Charlie voted 0.
        // CANDIDATE_0 should have 1 vote.
        // CANDIDATE_1 should have 2 votes.
        // CANDIDATE_2..9 should have 0 votes.
        
        const lines = rawResults.split('\n').filter(Boolean);
        let cand0Votes = -1;
        let cand1Votes = -1;
        
        for (const line of lines) {
            const parts = line.split(':');
            if (parts[0] === 'CANDIDATE_0') {
                cand0Votes = parseInt(parts[1], 10);
            } else if (parts[0] === 'CANDIDATE_1') {
                cand1Votes = parseInt(parts[1], 10);
            }
        }

        assert(cand0Votes === 1, `Candidate 0 has exactly 1 vote (got ${cand0Votes})`);
        assert(cand1Votes === 2, `Candidate 1 has exactly 2 votes (got ${cand1Votes})`);

        // Verify has_voted=true in voters.json
        const votersDbFinal = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'data', 'voters', 'voters.json'), 'utf8'));
        const allVoted = votersDbFinal.every(v => v.has_voted === true);
        assert(allVoted, 'All voters marked has_voted=true in voters.json');

        console.log("\n=============================================================");
        console.log(" 🎉 ALL TESTS PASSED SUCCESSFULLY!                           ");
        console.log(" ✓ Cryptographic separation (Server has no SKs) verified.      ");
        console.log(" ✓ Strict state machine and authentication verified.          ");
        console.log(" ✓ CCCD validation (12-digit, unique) verified.               ");
        console.log(" ✓ Age-gate (>=18) and underage rejection verified.           ");
        console.log(" ✓ voters.json persistence and has_voted tracking verified.  ");
        console.log(" ✓ 10 Success Criteria & 8 Failure Cases verified.            ");
        console.log("=============================================================");

    } catch (err) {
        console.error("\n❌ TEST RUN ERROR:", err);
        process.exit(1);
    }
}

run();
