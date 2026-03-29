cmake_minimum_required(VERSION 3.16)
project(evoting_crypto CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Find OpenFHE ──────────────────────────────────────────────
set(OPENFHE_ROOT "$ENV{HOME}/openfhe-development")
set(OPENFHE_BUILD "${OPENFHE_ROOT}/build")

set(OpenFHE_DIR "${OPENFHE_BUILD}/OpenFHEConfig.cmake")
find_package(OpenFHE REQUIRED PATHS "${OPENFHE_BUILD}" NO_DEFAULT_PATH)

message(STATUS "OpenFHE version : ${OpenFHE_VERSION}")

# ── Include paths ─────────────────────────────────────────────
include_directories(
    ${OPENFHE_ROOT}/src/pke/include
    ${OPENFHE_ROOT}/src/core/include
    ${OPENFHE_ROOT}/src/core/include/lattice
    ${OPENFHE_ROOT}/src/core/include/math
    ${OPENFHE_ROOT}/src/core/include/utils
    ${OPENFHE_ROOT}/src/binfhe/include
    ${OPENFHE_BUILD}/src/core
    ${OPENFHE_BUILD}/src/pke
    ${OPENFHE_BUILD}/src/binfhe
    ${OPENFHE_ROOT}/third-party/cereal/include
)

link_directories(${OPENFHE_BUILD}/lib)

# ── macOS: fix libomp (Apple Clang does not bundle OpenMP) ────
if(APPLE)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-unknown-pragmas")

    execute_process(
        COMMAND brew --prefix libomp
        OUTPUT_VARIABLE LIBOMP_PREFIX
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )

    if(LIBOMP_PREFIX AND EXISTS "${LIBOMP_PREFIX}/lib/libomp.dylib")
        message(STATUS "libomp found: ${LIBOMP_PREFIX}")
        include_directories("${LIBOMP_PREFIX}/include")
        link_directories("${LIBOMP_PREFIX}/lib")
        set(OMP_LIB "${LIBOMP_PREFIX}/lib/libomp.dylib")
    else()
        message(WARNING "libomp not found. Run: brew install libomp")
        set(OMP_LIB "")
    endif()
endif()

# ── Targets ───────────────────────────────────────────────────
# Core infrastructure
add_executable(setup                 src/setup.cpp)

# MK-FHE multiparty binaries
add_executable(voter_keygen          src/voter_keygen.cpp)
add_executable(encrypt_vote          src/encrypt_vote.cpp)
add_executable(tally                 src/tally.cpp)
add_executable(voter_partial_decrypt src/voter_partial_decrypt.cpp)
add_executable(combine               src/combine.cpp)

# ── Link OpenFHE + libomp to every target ─────────────────────
foreach(TARGET setup voter_keygen encrypt_vote tally voter_partial_decrypt combine)
    target_link_libraries(${TARGET} PRIVATE ${OpenFHE_LIBRARIES})
    if(APPLE AND OMP_LIB)
        target_link_libraries(${TARGET} PRIVATE "${OMP_LIB}")
    endif()
endforeach()

# ── Output binaries to build/ ─────────────────────────────────
set_target_properties(
    setup voter_keygen encrypt_vote tally voter_partial_decrypt combine
    PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)