// voter_partial_decrypt.cpp
// Usage: voter_partial_decrypt <voter_id> <isLead> <in_sk> <in_tally> <out_share> <params_file>

#include <openfhe.h>
#include <cryptocontext-ser.h>
#include <key/key-ser.h>
#include <ciphertext-ser.h>
#include <iostream>
#include <filesystem>
#include <string>
#include <vector>

using namespace lbcrypto;
namespace fs = std::filesystem;

int main(int argc, char* argv[]) {
    if (argc < 7) {
        std::cerr << "Usage: voter_partial_decrypt <voter_id> <isLead> <in_sk> <in_tally> <out_share> <params_file>\n";
        return 1;
    }
    std::string voterId(argv[1]);
    int isLead = std::stoi(argv[2]);
    std::string inSk(argv[3]);
    std::string inTally(argv[4]);
    std::string outShare(argv[5]);
    std::string paramsFile(argv[6]);

    CryptoContext<DCRTPoly> cc;
    if (!Serial::DeserializeFromFile(paramsFile, cc, SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot load " << paramsFile << "\n";
        return 1;
    }
    cc->Enable(PKE);
    cc->Enable(LEVELEDSHE);
    cc->Enable(MULTIPARTY);

    PrivateKey<DCRTPoly> sk;
    if (!Serial::DeserializeFromFile(inSk, sk, SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot load " << inSk << "\n";
        return 1;
    }

    Ciphertext<DCRTPoly> tally;
    if (!Serial::DeserializeFromFile(inTally, tally, SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot load " << inTally << "\n";
        return 1;
    }

    std::vector<Ciphertext<DCRTPoly>> partialResult;
    if (isLead == 1) {
        partialResult = cc->MultipartyDecryptLead({tally}, sk);
    } else {
        partialResult = cc->MultipartyDecryptMain({tally}, sk);
    }

    fs::create_directories(fs::path(outShare).parent_path());
    if (!Serial::SerializeToFile(outShare, partialResult[0], SerType::BINARY)) {
        std::cerr << "[voter_partial_decrypt] ERROR: Cannot write " << outShare << "\n";
        return 1;
    }
    std::cout << "[voter_partial_decrypt] Saved -> " << outShare << "\n";
    return 0;
}
