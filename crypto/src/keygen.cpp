#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <filesystem>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main() {
    std::cout << "\n[keygen] Loading shared CryptoContext...\n";

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[keygen] ERROR: Cannot load crypto_params.bin\n";
        return 1;
    }
    cc->Enable(PKE);
    cc->Enable(MULTIPARTY);

    auto keyPair = cc->KeyGen();
    if (!keyPair.good()) {
        std::cerr << "[keygen] ERROR: Key generation failed.\n";
        return 1;
    }

    fs::create_directories("./client/data/keys");
    if (!Serial::SerializeToFile("./client/data/keys/public_key.bin",
                                  keyPair.publicKey, SerType::BINARY) ||
        !Serial::SerializeToFile("./client/data/keys/secret_key.bin",
                                  keyPair.secretKey, SerType::BINARY)) {
        std::cerr << "[keygen] ERROR: Could not write key files.\n";
        return 1;
    }

    std::cout << "[keygen] Saved → public_key.bin + secret_key.bin\n";
    std::cout << "[keygen] ✓ Done.\n\n";
    return 0;
}
