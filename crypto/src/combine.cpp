// combine.cpp — Multiparty Decryption Fusion
// Reads all share_*.bin from server/data/shares/
// Calls MultipartyDecryptFusion → writes final_result.txt
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

int main() {
    std::cout << "\n[combine] Loading CryptoContext...\n";

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("../params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[combine] ERROR: Cannot load crypto_params.bin\n"; return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    const std::string sharesDir = "../server/data/shares";
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

    Plaintext result;
    cc->MultipartyDecryptFusion(shares, &result);
    result->SetLength(1);
    int64_t finalTally = result->GetPackedValue()[0];

    std::cout << "\n╔═══════════════════════════════════╗\n";
    std::cout << "║         FINAL VOTE RESULT         ║\n";
    std::cout << "╠═══════════════════════════════════╣\n";
    std::cout << "║   TOTAL YES VOTES = " << finalTally
              << std::string(16 - std::to_string(finalTally).size(), ' ') << "║\n";
    std::cout << "╚═══════════════════════════════════╝\n\n";

    fs::create_directories("../server/data/tally");
    std::ofstream out("../server/data/tally/final_result.txt");
    if (out.is_open()) {
        out << "FINAL YES VOTES = " << finalTally << "\n";
        out.close();
    }
    std::cout << "[combine] ✓ Done.\n\n";
    return 0;
}
