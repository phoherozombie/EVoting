#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <ciphertext-ser.h>
#include <key/key-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main(int argc, char* argv[]) {
    if (argc < 3) return 1;
    int id = std::stoi(argv[1]);
    int voteValue = std::stoi(argv[2]);

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) return 1;

    PublicKey<DCRTPoly> jointPk;
    if (!Serial::DeserializeFromFile("./server/joint_pk.bin", jointPk, SerType::BINARY)) return 1;

    Plaintext pt = cc->MakePackedPlaintext({(int64_t)voteValue});
    auto ct = cc->Encrypt(jointPk, pt);

    Serial::SerializeToFile("./server/vote" + std::to_string(id) + ".bin", ct, SerType::BINARY);
    std::cout << "[Step 4] Client " << id << ": Vote encrypted.\n";
    return 0;
}
