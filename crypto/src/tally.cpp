// tally.cpp — Homomorphic tally (EvalAdd over all ciphertexts)
// No change from original except updated comment header.
//
// Reads:  server/data/ciphertexts/enc_vote_*.bin
// Writes: server/data/tally/enc_tally.bin
//
// Paths relative to ROOT = evoting-system/

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <filesystem>
#include <vector>
#include <algorithm>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main() {
    std::cout << "\n[tally] Starting homomorphic tally...\n";

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("../params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[tally] ERROR: Cannot load crypto_params.bin\n"; return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    const std::string voteDir = "../server/data/ciphertexts";
    if (!fs::exists(voteDir)) {
        std::cerr << "[tally] ERROR: Directory not found: " << voteDir << "\n"; return 1;
    }

    std::vector<fs::path> files;
    for (auto& e : fs::directory_iterator(voteDir))
        if (e.path().extension() == ".bin") files.push_back(e.path());
    std::sort(files.begin(), files.end());

    if (files.empty()) { std::cerr << "[tally] ERROR: No vote files found.\n"; return 1; }
    std::cout << "[tally] Found " << files.size() << " vote(s).\n";

    Ciphertext<DCRTPoly> tally;
    bool first = true;
    for (auto& fp : files) {
        Ciphertext<DCRTPoly> vote;
        if (!Serial::DeserializeFromFile(fp.string(), vote, SerType::BINARY)) {
            std::cerr << "[tally] ERROR: Cannot deserialize " << fp << "\n"; return 1;
        }
        if (first) { tally = vote; first = false; }
        else        { tally = cc->EvalAdd(tally, vote); }
        std::cout << "[tally]   Added: " << fp.filename() << "\n";
    }

    fs::create_directories("../server/data/tally");
    if (!Serial::SerializeToFile("../server/data/tally/enc_tally.bin", tally, SerType::BINARY)) {
        std::cerr << "[tally] ERROR: Could not write enc_tally.bin\n"; return 1;
    }
    std::cout << "[tally] Saved → ../server/data/tally/enc_tally.bin\n";
    std::cout << "[tally] ✓ Tally complete. Server never saw plaintext votes.\n\n";
    return 0;
}
