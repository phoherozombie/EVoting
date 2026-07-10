# Secure E-Voting System (Ballon d'Or Edition)

A distributed, secure electronic voting system leveraging **Multi-Key Fully Homomorphic Encryption (MK-FHE)** via the OpenFHE library. This system guarantees voter privacy (votes are encrypted end-to-end and tallied without decryption) and result verifiability.

## Architecture

The system consists of two main components:
1. **Central Server (`central_server.js`)**: Collects encrypted votes, aggregates public key shares, and performs homomorphic tallying (`server_tally`). It also performs the final fusion (`server_fusion`) of partial decryptions to reveal the final tally without ever seeing the individual plaintext votes.
2. **Client Gateway (`client_server.js`)**: A local proxy for the voter that interacts with the C++ backend to generate local key shares (`client_keygen`), encrypt the vote (`client_vote`), and perform partial decryption (`client_partial_decrypt`).

### Directory Structure (evoting_deploy)
- `src_distributed/`: C++ source code utilizing OpenFHE for cryptography (keygen, vote encryption, tallying, decryption fusion).
- `web/`: Node.js Express servers.
  - `central_server.js`: Centralized coordination server (Dashboard at port 3001).
  - `client_server.js`: Local voter gateway (Voting Interface at port 3000).
  - `vote.js` & `index.html`: Frontend application.

## Prerequisites

- **Node.js** (v18+)
- **OpenFHE Library**: Must be compiled and installed on the host machine.
- **CMake & C++ Compiler**: To build the `src_distributed` files.

## Build and Setup

### 1. Build C++ Cryptography Backend
Navigate to the `src_distributed` folder and build the executables using CMake:
```bash
cd evoting_deploy/src_distributed
mkdir build && cd build
cmake ..
make
```

### 2. Install Node.js Dependencies
Navigate to the `web` directory and install the necessary npm packages:
```bash
cd evoting_deploy/web
npm install
```

### 3. Environment Variables
In the `web/` directory, ensure you have a `.env` file configured:
```env
JWT_SECRET=super_secret_voting_key_2026
SMTP_EMAIL=your_email@gmail.com
SMTP_PASSWORD=your_app_password
```

## Running the System

### Starting the Central Server
This server handles registration, collects encrypted data, and runs the tallying process.
```bash
cd evoting_deploy/web
node central_server.js
```
- API & Dashboard available at: `http://localhost:3001` (Note: Update IP bindings if deployed remotely).

### Starting the Client Gateway (Voter Machine)
Each voter runs a local gateway to encrypt votes safely on their own machine.
```bash
cd evoting_deploy/web
node client_server.js
```
- Voting UI available at: `http://localhost:3000`

## Voting Workflow
1. **Register & Login**: Voters log in using their Voter ID and Password.
2. **Key Generation**: The client generates a unique partial public key and secret key. Only the public key share is uploaded.
3. **Vote**: The voter selects a candidate. The vote is homomorphically encrypted locally and pushed to the central server.
4. **Tally**: Once enough votes are received, the central server homomorphically adds them (`tally.bin`).
5. **Decrypt**: Voters download the encrypted tally and perform a partial decryption using their local secret key.
6. **Fusion**: The central server fuses all partial decryptions to reveal the final winner!
