#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <scheme/bgvrns/bgvrns-ser.h>
#include <filesystem>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main(int argc, char* argv[]) {
    if (argc < 2) return 1;
    int id = std::stoi(argv[1]);
    
    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile("./params/crypto_params.bin", cc, SerType::BINARY)) {
        return 1;
    }

    KeyPair<DCRTPoly> kp;
    if (id == 1) {
        kp = cc->KeyGen();
    } else {
        PublicKey<DCRTPoly> prevPk;
        Serial::DeserializeFromFile(argv[2], prevPk, SerType::BINARY);
        kp = cc->MultipartyKeyGen(prevPk);
    }

    std::string clientDir = "./client" + std::to_string(id);
    fs::create_directories(clientDir);
    Serial::SerializeToFile(clientDir + "/sk.bin", kp.secretKey, SerType::BINARY);

    fs::create_directories("./server");
    Serial::SerializeToFile("./server/pk_share" + std::to_string(id) + ".bin", kp.publicKey, SerType::BINARY);
    
    std::cout << "[Step 2] Client " << id << ": Key share sent.\n";
    return 0;
}
