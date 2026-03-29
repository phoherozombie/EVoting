#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <filesystem>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main() {
    std::cout << "\n[partial_decrypt] Loading CryptoContext...\n";

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("../params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[partial_decrypt] ERROR: Cannot load crypto_params.bin\n"; return 1;
    }
    cc->Enable(PKE);
    cc->Enable(MULTIPARTY);

    PrivateKey<DCRTPoly> sk;
    if (!Serial::DeserializeFromFile("../client/data/keys/secret_key.bin", sk, SerType::BINARY)) {
        std::cerr << "[partial_decrypt] ERROR: Cannot load secret_key.bin\n"; return 1;
    }

    Ciphertext<DCRTPoly> tally;
    if (!Serial::DeserializeFromFile("../client/data/tally/enc_tally.bin", tally, SerType::BINARY)) {
        std::cerr << "[partial_decrypt] ERROR: Cannot load enc_tally.bin\n"; return 1;
    }

    auto partialResult = cc->MultipartyDecryptMain({tally}, sk);

    fs::create_directories("../client/data/shares");
    if (!Serial::SerializeToFile("../client/data/shares/my_share.bin",
                                  partialResult[0], SerType::BINARY)) {
        std::cerr << "[partial_decrypt] ERROR: Could not write my_share.bin\n"; return 1;
    }
    std::cout << "[partial_decrypt] Saved → my_share.bin\n";
    std::cout << "[partial_decrypt] ✓ Done.\n\n";
    return 0;
}
