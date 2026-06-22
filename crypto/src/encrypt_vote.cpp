// encrypt_vote.cpp
// Usage: encrypt_vote <candidateIndex> <in_joint_pk> <out_enc_vote> <params_file>

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <filesystem>
#include <string>
#include <vector>

using namespace lbcrypto;
namespace fs = std::filesystem;

static const int N_CANDIDATES = 10;

int main(int argc, char* argv[]) {
    if (argc < 5) {
        std::cerr << "Usage: encrypt_vote <candidateIndex> <in_joint_pk> <out_enc_vote> <params_file>\n";
        return 1;
    }

    int candidateIndex = std::stoi(argv[1]);
    std::string inJointPk(argv[2]);
    std::string outFile(argv[3]);
    std::string paramsFile(argv[4]);

    if (candidateIndex < 0 || candidateIndex >= N_CANDIDATES) {
        std::cerr << "ERROR: candidateIndex must be in [0, " << (N_CANDIDATES - 1) << "]\n";
        return 1;
    }

    std::vector<int64_t> ballot(N_CANDIDATES, 0);
    ballot[candidateIndex] = 1;

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile(paramsFile, cc, SerType::BINARY)) {
        std::cerr << "[encrypt_vote] ERROR: Cannot load " << paramsFile << "\n"; return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    PublicKey<DCRTPoly> jointPk;
    if (!Serial::DeserializeFromFile(inJointPk, jointPk, SerType::BINARY)) {
        std::cerr << "[encrypt_vote] ERROR: Cannot load " << inJointPk << "\n";
        return 1;
    }

    auto ciphertext = cc->Encrypt(jointPk, cc->MakePackedPlaintext(ballot));

    fs::create_directories(fs::path(outFile).parent_path());
    if (!Serial::SerializeToFile(outFile, ciphertext, SerType::BINARY)) {
        std::cerr << "[encrypt_vote] ERROR: Cannot write " << outFile << "\n"; return 1;
    }
    std::cout << "[encrypt_vote] Saved -> " << outFile << "\n";
    return 0;
}
