#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main() {
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[Step 3] ERROR: Could not find ./params/crypto_params.bin\n";
        return 1;
    }

    PublicKey<DCRTPoly> jointPk;
    if (Serial::DeserializeFromFile("./server/pk_share3.bin", jointPk, SerType::BINARY)) {
        Serial::SerializeToFile("./server/joint_pk.bin", jointPk, SerType::BINARY);
        std::cout << "[Step 3] Server: Joint public key finalized and saved to ./server/joint_pk.bin\n";
        return 0;
    } else {
        std::cerr << "[Step 3] ERROR: Could not find ./server/pk_share3.bin\n";
        return 1;
    }
}
