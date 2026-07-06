    #include <openfhe.h>
#include <cryptocontext-ser.h>
#include <ciphertext-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main() {
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        std::cerr << "[Step 5] ERROR: Could not load crypto_params.bin" << std::endl;
        return 1;
    }

    Ciphertext<DCRTPoly> tally, ct;
    for (int i = 1; i <= 3; i++) {
        std::string filename = "./server/vote" + std::to_string(i) + ".bin";
        if (!Serial::DeserializeFromFile(filename, ct, SerType::BINARY)) {
            std::cerr << "[Step 5] ERROR: Could not find " << filename << ". Make sure all voters have sent their files to the server/ directory." << std::endl;
            return 1;
        }
        if (i == 1) tally = ct;
        else tally = cc->EvalAdd(tally, ct);
    }

    Serial::SerializeToFile("./server/tally.bin", tally, SerType::BINARY);
    std::cout << "[Step 5] Server: Tally complete.\n";
    return 0;


}

    