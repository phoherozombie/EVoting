#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <ciphertext-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main() {
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) return 1;

    Ciphertext<DCRTPoly> tally, ct;
    for (int i = 1; i <= 3; i++) {
        Serial::DeserializeFromFile("./server/vote" + std::to_string(i) + ".bin", ct, SerType::BINARY);
        if (i == 1) tally = ct;
        else tally = cc->EvalAdd(tally, ct);
    }

    Serial::SerializeToFile("./server/tally.bin", tally, SerType::BINARY);
    std::cout << "[Step 5] Server: Tally complete.\n";
    return 0;
}
