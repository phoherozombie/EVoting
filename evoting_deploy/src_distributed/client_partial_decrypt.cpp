#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>

using namespace lbcrypto;

int main(int argc, char* argv[]) {
    if (argc < 2) return 1;
    int id = std::stoi(argv[1]);
    
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) return 1;

    PrivateKey<DCRTPoly> sk;
    Serial::DeserializeFromFile("./client" + std::to_string(id) + "/sk.bin", sk, SerType::BINARY);

    Ciphertext<DCRTPoly> tally;
    Serial::DeserializeFromFile("./server/tally.bin", tally, SerType::BINARY);

    std::vector<Ciphertext<DCRTPoly>> share;
    if (id == 1) {
        share = cc->MultipartyDecryptLead({tally}, sk);
    } else {
        share = cc->MultipartyDecryptMain({tally}, sk);
    }
    Serial::SerializeToFile("./server/share" + std::to_string(id) + ".bin", share[0], SerType::BINARY);
    std::cout << "[Step 6] Client " << id << ": Share sent.\n";
    return 0;
}
