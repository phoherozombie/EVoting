// voter_partial_decrypt.cpp
// Usage: voter_partial_decrypt <voter_id>
//
// Each voter contributes their partial decryption share.
// CRITICAL: OpenFHE requires exactly one party to call MultipartyDecryptLead
//           and all other parties to call MultipartyDecryptMain.
//           The first voter in voter_list.txt is the "lead" party.
//
// Paths relative to ROOT = evoting-system/

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <string>
#include <vector>

using namespace lbcrypto;
namespace fs = std::filesystem;

static const std::string PARAMS_FILE = "../params/crypto_params.bin";
static const std::string KEYS_DIR    = "../server/data/keys";
static const std::string VOTER_LIST  = "../server/data/keys/voter_list.txt";
static const std::string TALLY_FILE  = "../server/data/tally/enc_tally.bin";
static const std::string SHARES_DIR  = "../server/data/shares";

// Read voter_list.txt and return ordered list
static std::vector<std::string> loadVoterList() {
    std::vector<std::string> ids;
    std::ifstream f(VOTER_LIST);
    std::string line;
    while (std::getline(f, line))
        if (!line.empty()) ids.push_back(line);
    return ids;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: voter_partial_decrypt <voter_id>\n";
        return 1;
    }
    const std::string voterId(argv[1]);
    std::cout << "\n[voter_partial_decrypt] Voter: " << voterId << "\n";

    // ── Determine role: lead or main ─────────────────────────
    auto voters = loadVoterList();
    if (voters.empty()) {
        std::cerr << "[voter_partial_decrypt] ERROR: voter_list.txt is empty.\n";
        return 1;
    }
    bool isLead = (voters[0] == voterId);
    std::cout << "[voter_partial_decrypt] Role: "
              << (isLead ? "LEAD (MultipartyDecryptLead)" : "MAIN (MultipartyDecryptMain)")
              << "\n";

    // ── Load CryptoContext ────────────────────────────────────
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile(PARAMS_FILE, cc, SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot load crypto_params.bin\n";
        return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    // ── Load voter's secret key ───────────────────────────────
    const std::string skFile = KEYS_DIR + "/sk_" + voterId + ".bin";
    PrivateKey<DCRTPoly> sk;
    if (!Serial::DeserializeFromFile(skFile, sk, SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot load " << skFile
                  << "\n  Is '" << voterId << "' a registered voter?\n";
        return 1;
    }
    std::cout << "[voter_partial_decrypt] Loaded secret key for " << voterId << "\n";

    // ── Load encrypted tally ──────────────────────────────────
    Ciphertext<DCRTPoly> tally;
    if (!Serial::DeserializeFromFile(TALLY_FILE, tally, SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot load enc_tally.bin\n"
                  << "  Run POST /tally first.\n";
        return 1;
    }

    // ── Partial decryption ────────────────────────────────────
    std::vector<Ciphertext<DCRTPoly>> partialResult;
    if (isLead) {
        // Lead: includes the b part of the ciphertext
        partialResult = cc->MultipartyDecryptLead({tally}, sk);
    } else {
        // All other voters: contribute only their s_i component
        partialResult = cc->MultipartyDecryptMain({tally}, sk);
    }

    // ── Save share ────────────────────────────────────────────
    fs::create_directories(SHARES_DIR);
    const std::string shareFile = SHARES_DIR + "/share_" + voterId + ".bin";
    if (!Serial::SerializeToFile(shareFile, partialResult[0], SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot write " << shareFile << "\n";
        return 1;
    }
    std::cout << "[voter_partial_decrypt] Saved → " << shareFile << "\n";
    std::cout << "[voter_partial_decrypt] ✓ Done.\n\n";
    return 0;
}
