const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../docs/screenshots/final');

const candidates = [
    {id: 0, name: "Lionel Messi", club: "Inter Miami", nationality: "Argentina", image: "https://upload.wikimedia.org/wikipedia/commons/b/b4/Lionel-Messi-Argentina-2022-FIFA-World-Cup_%28cropped%29.jpg"},
    {id: 1, name: "Erling Haaland", club: "Man City", nationality: "Norway", image: "https://upload.wikimedia.org/wikipedia/commons/0/07/Erling_Haaland_2023_%28cropped%29.jpg"},
    {id: 2, name: "Kylian Mbappé", club: "PSG", nationality: "France", image: "https://upload.wikimedia.org/wikipedia/commons/b/b3/2022_FIFA_World_Cup_France_4%E2%80%931_Australia_-_%287%29_%28cropped%29.jpg"},
    {id: 3, name: "Kevin De Bruyne", club: "Man City", nationality: "Belgium", image: "https://upload.wikimedia.org/wikipedia/commons/b/bd/Kevin_De_Bruyne_201807092.jpg"},
    {id: 4, name: "Rodri", club: "Man City", nationality: "Spain", image: "https://upload.wikimedia.org/wikipedia/commons/9/91/Rodri_2023.jpg"}
];

const delay = ms => new Promise(res => setTimeout(res, ms));

async function captureScreenshots() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    let currentPhase = 'voting';
    let resultsData = null;

    // Enable request interception
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = request.url();
        console.log("Intercepted:", url);
        const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
        
        if (url.endsWith('/candidates')) {
            request.respond({
                status: 200,
                headers,
                body: JSON.stringify({ candidates })
            });
        } else if (url.endsWith('/status')) {
            request.respond({
                status: 200,
                headers,
                body: JSON.stringify({
                    phase: currentPhase,
                    candidates: candidates,
                    votes_received: currentPhase === 'voting' ? 1 : 5,
                    votes_expected: 5,
                    results: resultsData
                })
            });
        } else if (url.endsWith('/health')) {
            request.respond({
                status: 200,
                headers,
                body: JSON.stringify({ voter: 'voter1', status: 'ok' })
            });
        } else if (url.endsWith('/vote')) {
            request.respond({
                status: 200,
                headers,
                body: JSON.stringify({ success: true, message: "Vote recorded." })
            });
        } else {
            request.continue();
        }
    });

    console.log("Loading page...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // 1. Voting Page
    await delay(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '01_voting_page.png'), fullPage: true });
    console.log("Captured: Voting Page");

    // 2. Candidate Selected
    try {
        await page.click('.candidate-card[data-index="0"]');
        await delay(500);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '02_candidate_selected.png'), fullPage: true });
        console.log("Captured: Candidate Selected");
    } catch(e) {
        console.error("Failed to click candidate card", e);
    }

    // 3. Decryption Phase
    currentPhase = 'decrypting';
    // Wait for next poll to update UI
    await delay(3500); 
    await page.screenshot({ path: path.join(OUTPUT_DIR, '03_decryption_phase.png'), fullPage: true });
    console.log("Captured: Decryption Phase");

    // 4. Results Leaderboard
    currentPhase = 'complete';
    resultsData = [
        { id: 0, name: "Lionel Messi", club: "Inter Miami", votes: 3, image: candidates[0].image },
        { id: 1, name: "Erling Haaland", club: "Man City", votes: 1, image: candidates[1].image },
        { id: 2, name: "Kylian Mbappé", club: "PSG", votes: 1, image: candidates[2].image },
        { id: 3, name: "Kevin De Bruyne", club: "Man City", votes: 0, image: candidates[3].image },
        { id: 4, name: "Rodri", club: "Man City", votes: 0, image: candidates[4].image }
    ];
    await delay(3500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '04_results_leaderboard.png'), fullPage: true });
    console.log("Captured: Results Leaderboard");

    // 5. Mobile Responsive View (Voting Page)
    currentPhase = 'voting';
    await page.setViewport({ width: 390, height: 844 }); // iPhone 12 Pro dimensions
    await page.reload({ waitUntil: 'networkidle0' });
    await delay(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '05_mobile_voting.png'), fullPage: true });
    console.log("Captured: Mobile Responsive View");

    await browser.close();
}

captureScreenshots().catch(console.error);
