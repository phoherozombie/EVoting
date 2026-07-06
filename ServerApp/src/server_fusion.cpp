#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <ciphertext-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main() {
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) return 1;

    std::vector<Ciphertext<DCRTPoly>> components(3);
    for (int i = 1; i <= 3; i++) {
        Serial::DeserializeFromFile("./server/share" + std::to_string(i) + ".bin", components[i-1], SerType::BINARY);
    }

    Plaintext result;
    cc->MultipartyDecryptFusion(components, &result);
    result->SetLength(1);
    
    std::cout << "[Step 7] Server: FINAL RESULT = " << result->GetPackedValue()[0] << "\n";
    return 0;
}
