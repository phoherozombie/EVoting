#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <ciphertext-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main() {
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[Step 7] ERROR: Could not load crypto_params.bin" << std::endl;
        return 1;
    }

    std::vector<Ciphertext<DCRTPoly>> components(3);
    for (int i = 1; i <= 3; i++) {
        std::string filename = "./server/share" + std::to_string(i) + ".bin";
        if (!Serial::DeserializeFromFile(filename, components[i-1], SerType::BINARY)) {
            std::cerr << "[Step 7] ERROR: Could not find " << filename << ". Make sure all voters have sent their partial decryption shares." << std::endl;
            return 1;
        }
    }

    Plaintext result;
    cc->MultipartyDecryptFusion(components, &result);
    result->SetLength(1);
    
    std::cout << "[Step 7] Server: FINAL RESULT = " << result->GetPackedValue()[0] << "\n";
    return 0;
}
