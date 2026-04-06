// voter_keygen.cpp
// Usage: voter_keygen <voter_id>
//
// Registers one voter:
//   - Generates (pk_i, sk_i) using KeyGen() or MultipartyKeyGen(joint_pk)
//   - Writes server/data/keys/pk_<id>.bin  and  sk_<id>.bin
//   - Updates server/data/keys/joint_pk.bin  (the running joint public key)
//   - Appends voter_id to  server/data/keys/voter_list.txt
//
// Paths are relative to ROOT = evoting-system/ (binary is run with cwd=ROOT)

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <string>
#include <vector>
#include <algorithm>

using namespace lbcrypto;
namespace fs = std::filesystem;

static const std::string KEYS_DIR    = "./server/data/keys";
static const std::string PARAMS_FILE = "./params/crypto_params.bin";
static const std::string JOINT_PK    = "./server/data/keys/joint_pk.bin";
static const std::string VOTER_LIST  = "./server/data/keys/voter_list.txt";

// Load existing voter IDs
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
        std::cerr << "Usage: voter_keygen <voter_id>\n";
        return 1;
    }
    const std::string voterId(argv[1]);
    std::cout << "\n[voter_keygen] Registering voter: " << voterId << "\n";

    // ── Sanity: no duplicate ──────────────────────────────────
    auto existing = loadVoterList();
    if (std::find(existing.begin(), existing.end(), voterId) != existing.end()) {
        std::cerr << "[voter_keygen] ERROR: Voter '" << voterId << "' already registered.\n";
        return 1;
    }

    // ── Load CryptoContext ────────────────────────────────────
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile(PARAMS_FILE, cc, SerType::BINARY)) {
        std::cerr << "[voter_keygen] ERROR: Cannot load crypto_params.bin\n";
        return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    fs::create_directories(KEYS_DIR);

    KeyPair<DCRTPoly> kp;

    if (existing.empty()) {
        // ── First voter: standard KeyGen ─────────────────────
        std::cout << "[voter_keygen] First voter — using KeyGen()\n";
        kp = cc->KeyGen();
    } else {
        // ── Subsequent voters: MultipartyKeyGen(joint_pk) ────
        std::cout << "[voter_keygen] Voter #" << (existing.size() + 1)
                  << " — using MultipartyKeyGen(joint_pk)\n";
        PublicKey<DCRTPoly> jointPk;
        if (!Serial::DeserializeFromFile(JOINT_PK, jointPk, SerType::BINARY)) {
            std::cerr << "[voter_keygen] ERROR: Cannot load joint_pk.bin\n";
            return 1;
        }
        kp = cc->MultipartyKeyGen(jointPk);
    }

    if (!kp.good()) {
        std::cerr << "[voter_keygen] ERROR: Key generation failed.\n";
        return 1;
    }

    // ── Save individual keys ──────────────────────────────────
    const std::string pkFile = KEYS_DIR + "/pk_" + voterId + ".bin";
    const std::string skFile = KEYS_DIR + "/sk_" + voterId + ".bin";

    if (!Serial::SerializeToFile(pkFile, kp.publicKey, SerType::BINARY)) {
        std::cerr << "[voter_keygen] ERROR: Cannot write " << pkFile << "\n";
        return 1;
    }
    if (!Serial::SerializeToFile(skFile, kp.secretKey, SerType::BINARY)) {
        std::cerr << "[voter_keygen] ERROR: Cannot write " << skFile << "\n";
        return 1;
    }
    std::cout << "[voter_keygen] Saved → " << pkFile << "\n";
    std::cout << "[voter_keygen] Saved → " << skFile << "\n";

    // ── Update joint public key ───────────────────────────────
    // After MultipartyKeyGen, kp.publicKey IS the new joint public key
    if (!Serial::SerializeToFile(JOINT_PK, kp.publicKey, SerType::BINARY)) {
        std::cerr << "[voter_keygen] ERROR: Cannot write joint_pk.bin\n";
        return 1;
    }
    std::cout << "[voter_keygen] Updated → joint_pk.bin (joint key now includes "
              << (existing.size() + 1) << " voter(s))\n";

    // ── Append voter to list ──────────────────────────────────
    std::ofstream listFile(VOTER_LIST, std::ios::app);
    listFile << voterId << "\n";
    listFile.close();

    std::cout << "[voter_keygen] ✓ Done. Total registered: "
              << (existing.size() + 1) << "\n\n";
    return 0;
}
