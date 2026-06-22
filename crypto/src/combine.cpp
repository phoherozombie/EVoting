// combine.cpp — Multiparty Decryption Fusion
// Reads all share_*.bin from server/data/shares/
// Calls MultipartyDecryptFusion → writes final_result.txt
//
// Multi-candidate output: one line per slot/candidate:
//   CANDIDATE_0:<votes>
//   CANDIDATE_1:<votes>
//   ...
//   CANDIDATE_N-1:<votes>
//
// combine.cpp does not need to know candidate names — only slot indices.
// The server (server.js) maps indices back to names when serving results.
//
// Paths relative to ROOT = evoting-system/

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <vector>
#include <algorithm>

using namespace lbcrypto;
namespace fs = std::filesystem;

// Must match N_CANDIDATES in encrypt_vote.cpp
static const int N_CANDIDATES = 10;

int main() {
    std::cout << "\n[combine] Loading CryptoContext...\n";

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[combine] ERROR: Cannot load crypto_params.bin\n"; return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    const std::string sharesDir = "./server/data/shares";
    if (!fs::exists(sharesDir)) {
        std::cerr << "[combine] ERROR: Shares dir not found.\n"; return 1;
    }

    std::vector<fs::path> files;
    for (auto& e : fs::directory_iterator(sharesDir))
        if (e.path().extension() == ".bin") files.push_back(e.path());
    std::sort(files.begin(), files.end());

    if (files.empty()) { std::cerr << "[combine] ERROR: No share files found.\n"; return 1; }

    std::vector<Ciphertext<DCRTPoly>> shares;
    for (auto& fp : files) {
        Ciphertext<DCRTPoly> share;
        if (!Serial::DeserializeFromFile(fp.string(), share, SerType::BINARY)) {
            std::cerr << "[combine] ERROR: Cannot deserialize " << fp << "\n"; return 1;
        }
        shares.push_back(share);
        std::cout << "[combine]   Loaded share: " << fp.filename() << "\n";
    }

    // ── Multiparty fusion → plaintext ─────────────────────────
    Plaintext result;
    cc->MultipartyDecryptFusion(shares, &result);

    // Read all N_CANDIDATES slots
    result->SetLength(N_CANDIDATES);
    auto tallies = result->GetPackedValue();

    // ── Print results table ───────────────────────────────────
    std::cout << "\n╔═══════════════════════════════════════════╗\n";
    std::cout << "║       BALLON D'OR — FINAL VOTE TALLY      ║\n";
    std::cout << "╠═══════════════════════════════════════════╣\n";
    for (int i = 0; i < N_CANDIDATES; ++i) {
        int64_t v = (i < (int)tallies.size()) ? tallies[i] : 0;
        std::string label = "  CANDIDATE_" + std::to_string(i) + " = " + std::to_string(v);
        // Pad to fixed width
        std::string padded = label + std::string(std::max(0, 43 - (int)label.size()), ' ');
        std::cout << "║" << padded << "║\n";
    }
    std::cout << "╚═══════════════════════════════════════════╝\n\n";

    // ── Write final_result.txt ─────────────────────────────────
    // Format:  CANDIDATE_<i>:<votes>
    // One line per candidate, sorted by index ascending.
    // Server will parse this and join with candidates.json for names.
    fs::create_directories("./server/data/tally");
    std::ofstream out("./server/data/tally/final_result.txt");
    if (!out.is_open()) {
        std::cerr << "[combine] ERROR: Cannot open final_result.txt for writing\n"; return 1;
    }
    for (int i = 0; i < N_CANDIDATES; ++i) {
        int64_t v = (i < (int)tallies.size()) ? tallies[i] : 0;
        out << "CANDIDATE_" << i << ":" << v << "\n";
    }
    out.close();

    std::cout << "[combine] ✓ Done. Results written to server/data/tally/final_result.txt\n\n";
    return 0;
}
