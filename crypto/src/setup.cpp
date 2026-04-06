#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <filesystem>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main() {
    std::cout << "\n[setup] Generating shared CryptoContext (BFV-RNS)...\n";

    CCParams<CryptoContextBFVRNS> params;
    params.SetPlaintextModulus(65537);
    params.SetMultiplicativeDepth(1);
    params.SetSecurityLevel(HEStd_128_classic);
    params.SetRingDim(0);
    params.SetMaxRelinSkDeg(1);

    auto cc = GenCryptoContext(params);
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    std::cout << "[setup] Ring dimension : " << cc->GetRingDimension() << "\n";
    std::cout << "[setup] Plaintext mod  : "
              << cc->GetCryptoParameters()->GetPlaintextModulus() << "\n";

    fs::create_directories("./params");
    if (!Serial::SerializeToFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[setup] ERROR: Could not write crypto_params.bin\n";
        return 1;
    }
    std::cout << "[setup] Saved → ./params/crypto_params.bin\n";
    std::cout << "[setup] ✓ Done.\n\n";
    return 0;
}
