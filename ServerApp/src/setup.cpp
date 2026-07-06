#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>
#include <filesystem>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main() {
    std::cout << "[Step 1] Server: Setting up CryptoContext (BGVRNS)...\n";
    
    CCParams<CryptoContextBGVRNS> params;
    params.SetPlaintextModulus(65537);
    params.SetMultiplicativeDepth(2);
    
    auto cc = GenCryptoContext(params);
    cc->Enable(PKE);
    cc->Enable(KEYSWITCH);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    fs::create_directories("./params");
    if (Serial::SerializeToFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cout << "[Step 1] SUCCESS: Saved shared parameters to ./params/crypto_params.bin\n";
    } else {
        std::cerr << "[Step 1] ERROR: Failed to save parameters.\n";
        return 1;
    }
    return 0;
}
