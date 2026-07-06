cmake_minimum_required(VERSION 3.16)
project(evoting_distributed CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- Find OpenFHE ---
set(OPENFHE_BUILD "/home/tuyen/Project /openfhe-development/build")
set(OpenFHE_DIR "${OPENFHE_BUILD}")
find_package(OpenFHE REQUIRED PATHS "${OpenFHE_DIR}" NO_DEFAULT_PATH)

message(STATUS "OpenFHE found at: ${OpenFHE_DIR}")

# --- Include paths ---
get_filename_component(OPENFHE_ROOT "${OpenFHE_DIR}" DIRECTORY)
include_directories(
    ${OPENFHE_ROOT}/src/pke/include
    ${OPENFHE_ROOT}/src/core/include
    ${OPENFHE_ROOT}/src/core/include/lattice
    ${OPENFHE_ROOT}/src/core/include/math
    ${OPENFHE_ROOT}/src/core/include/utils
    ${OPENFHE_ROOT}/src/binfhe/include
    ${OpenFHE_DIR}/src/core
    ${OpenFHE_DIR}/src/pke
    ${OpenFHE_DIR}/src/binfhe
    ${OPENFHE_ROOT}/third-party/cereal/include
)

link_directories(${OpenFHE_DIR}/lib)

# --- Targets ---
set(TARGETS 
    setup 
    client_keygen 
    server_key_aggregate 
    client_vote 
    server_tally 
    client_partial_decrypt 
    server_fusion
)

foreach(T ${TARGETS})
    add_executable(${T} ${T}.cpp)
    target_link_libraries(${T} PRIVATE ${OpenFHE_LIBRARIES})
endforeach()
