#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main() {
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        return 1;
    }

    PublicKey<DCRTPoly> jointPk;
    if (Serial::DeserializeFromFile("./server/pk_share3.bin", jointPk, SerType::BINARY)) {
        Serial::SerializeToFile("./server/joint_pk.bin", jointPk, SerType::BINARY);
        std::cout << "[Step 3] Server: Joint public key finalized.\n";
        return 0;
    }
    return 1;
}
