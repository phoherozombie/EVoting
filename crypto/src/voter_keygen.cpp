// voter_keygen.cpp
// Usage: voter_keygen <voter_id> <isFirst> <in_joint_pk> <out_sk> <out_pk> <params_file>
//
// Registers one voter on the client:
//   - Generates (pk_i, sk_i) using KeyGen() or MultipartyKeyGen(joint_pk)
//   - Writes <out_sk> and <out_pk>

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <string>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main(int argc, char* argv[]) {
    if (argc < 7) {
        std::cerr << "Usage: voter_keygen <voter_id> <isFirst> <in_joint_pk> <out_sk> <out_pk> <params_file>\n";
        return 1;
    }
    const std::string voterId(argv[1]);
    const int isFirst = std::stoi(argv[2]);
    const std::string inJointPk(argv[3]);
    const std::string outSk(argv[4]);
    const std::string outPk(argv[5]);
    const std::string paramsFile(argv[6]);

    std::cout << "\n[voter_keygen] Voter: " << voterId << "\n";

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile(paramsFile, cc, SerType::BINARY)) {
        std::cerr << "[voter_keygen] ERROR: Cannot load " << paramsFile << "\n";
        return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    fs::create_directories(fs::path(outSk).parent_path());
    fs::create_directories(fs::path(outPk).parent_path());

    KeyPair<DCRTPoly> kp;

    if (isFirst == 1) {
        std::cout << "[voter_keygen] First voter — using KeyGen()\n";
        kp = cc->KeyGen();
    } else {
        std::cout << "[voter_keygen] Subsequent voter — using MultipartyKeyGen(joint_pk)\n";
        PublicKey<DCRTPoly> jointPk;
        if (!Serial::DeserializeFromFile(inJointPk, jointPk, SerType::BINARY)) {
            std::cerr << "[voter_keygen] ERROR: Cannot load " << inJointPk << "\n";
            return 1;
        }
        kp = cc->MultipartyKeyGen(jointPk);
    }

    if (!kp.good()) {
        std::cerr << "[voter_keygen] ERROR: Key generation failed.\n";
        return 1;
    }

    if (!Serial::SerializeToFile(outPk, kp.publicKey, SerType::BINARY)) {
        std::cerr << "[voter_keygen] ERROR: Cannot write " << outPk << "\n";
        return 1;
    }
    if (!Serial::SerializeToFile(outSk, kp.secretKey, SerType::BINARY)) {
        std::cerr << "[voter_keygen] ERROR: Cannot write " << outSk << "\n";
        return 1;
    }

    std::cout << "[voter_keygen] Saved SK -> " << outSk << "\n";
    std::cout << "[voter_keygen] Saved PK -> " << outPk << "\n";
    std::cout << "[voter_keygen] ✓ Done.\n\n";
    return 0;
}
