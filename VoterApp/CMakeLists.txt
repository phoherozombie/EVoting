cmake_minimum_required(VERSION 3.16)
project(VoterApp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- Find OpenFHE ---
find_package(OpenFHE QUIET)
if(NOT OpenFHE_FOUND)
    set(OPENFHE_HINTS 
        "$ENV{HOME}/Project /openfhe-development/build"
        "/usr/local/lib/cmake/OpenFHE"
        "$ENV{HOME}/openfhe-development/build"
    )
    find_package(OpenFHE REQUIRED PATHS ${OPENFHE_HINTS} NO_DEFAULT_PATH)
endif()

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

# --- Voter Targets ---
set(VOTER_TARGETS 
    client_keygen 
    client_vote 
    client_partial_decrypt 
)

foreach(T ${VOTER_TARGETS})
    add_executable(${T} src/${T}.cpp)
    target_link_libraries(${T} PRIVATE ${OpenFHE_LIBRARIES})
endforeach()
