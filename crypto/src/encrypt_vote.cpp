// encrypt_vote.cpp
// Usage: encrypt_vote <voter_id> <0|1>
//
// Encrypts a single vote under the JOINT public key.
//   - Reads server/data/keys/joint_pk.bin   (built during registration)
//   - Writes server/data/ciphertexts/enc_vote_<voter_id>.bin
//
// Paths are relative to ROOT = evoting-system/ (binary is run with cwd=ROOT)

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <filesystem>
#include <string>

using namespace lbcrypto;
namespace fs = std::filesystem;

static const std::string PARAMS_FILE   = "./params/crypto_params.bin";
static const std::string JOINT_PK_FILE = "./server/data/keys/joint_pk.bin";
static const std::string CIPHER_DIR    = "./server/data/ciphertexts";

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage:\n";
        std::cerr << "  (Voter mode) : encrypt_vote <0|1>          -> saves to client/data/enc_vote.bin\n";
        std::cerr << "  (Server mode): encrypt_vote <id> <0|1>     -> saves to server/data/ciphertexts/enc_vote_<id>.bin\n";
        return 1;
    }

    std::string voterId = "";
    int vote = 0;
    std::string outFile = "";
    std::string pkFile = JOINT_PK_FILE;

    if (argc == 2) {
        // Voter mode: encrypt_vote <vote>
        vote = std::stoi(std::string(argv[1]));
        outFile = "./client/data/enc_vote.bin";
        std::cout << "\n[encrypt_vote] Mode: VOTER  Choice: " << (vote ? "YES (1)" : "NO (0)") << "\n";
    } else {
        // Server mode: encrypt_vote <id> <vote>
        voterId = argv[1];
        vote = std::stoi(std::string(argv[2]));
        fs::create_directories(CIPHER_DIR);
        outFile = CIPHER_DIR + "/enc_vote_" + voterId + ".bin";
        std::cout << "\n[encrypt_vote] Mode: SERVER  Voter: " << voterId
                  << "  Choice: " << (vote ? "YES (1)" : "NO (0)") << "\n";
    }

    if (vote != 0 && vote != 1) { std::cerr << "ERROR: vote must be 0 or 1\n"; return 1; }

    // ── Load CryptoContext ────────────────────────────────────
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile(PARAMS_FILE, cc, SerType::BINARY)) {
        std::cerr << "[encrypt_vote] ERROR: Cannot load crypto_params.bin\n"; return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    // ── Load joint public key ────────────────────────────────
    PublicKey<DCRTPoly> jointPk;
    if (!Serial::DeserializeFromFile(pkFile, jointPk, SerType::BINARY)) {
        std::cerr << "[encrypt_vote] ERROR: Cannot load " << pkFile << "\n"
                  << "  (Election must be initialized first)\n";
        return 1;
    }

    // ── Encrypt vote under joint key ──────────────────────────
    auto ciphertext = cc->Encrypt(jointPk, cc->MakePackedPlaintext({(int64_t)vote}));

    // ── Save ciphertext ───────────────────────────────────────
    fs::path outPath(outFile);
    fs::create_directories(outPath.parent_path());
    if (!Serial::SerializeToFile(outFile, ciphertext, SerType::BINARY)) {
        std::cerr << "[encrypt_vote] ERROR: Cannot write " << outFile << "\n"; return 1;
    }
    std::cout << "[encrypt_vote] Saved → " << outFile << "\n";
    std::cout << "[encrypt_vote] ✓ Done.\n\n";
    return 0;
}
