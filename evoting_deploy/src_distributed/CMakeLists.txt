cmake_minimum_required(VERSION 3.16)
project(evoting_distributed CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- Find OpenFHE ---
# Đầu tiên thử tìm trong hệ thống (nếu đã sudo make install)
find_package(OpenFHE QUIET)

if(NOT OpenFHE_FOUND)
    # Nếu không thấy, thử tìm ở các đường dẫn dự phòng phổ biến
    set(OPENFHE_HINTS 
        "$ENV{HOME}/Project /openfhe-development/build"
        "/usr/local/lib/cmake/OpenFHE"
        "$ENV{HOME}/openfhe-development/build"
    )
    find_package(OpenFHE REQUIRED PATHS ${OPENFHE_HINTS} NO_DEFAULT_PATH)
endif()

# --- Include paths ---
include_directories(
    ${OPENFHE_INCLUDE}
    ${OPENFHE_INCLUDE}/third-party/include
    ${OPENFHE_INCLUDE}/core
    ${OPENFHE_INCLUDE}/pke
    ${OPENFHE_INCLUDE}/binfhe
    ${OpenFHE_INCLUDE}
    ${OpenFHE_INCLUDE}/third-party/include
    ${OpenFHE_INCLUDE}/core
    ${OpenFHE_INCLUDE}/pke
    ${OpenFHE_INCLUDE}/binfhe
    /usr/local/include/openfhe
    /usr/local/include/openfhe/core
    /usr/local/include/openfhe/pke
    /usr/local/include/openfhe/binfhe
    /usr/local/include/openfhe/cereal
)


# --- macOS: fix libomp (Apple Clang does not bundle OpenMP) ---
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
    if(APPLE AND OMP_LIB)
        target_link_libraries(${T} PRIVATE "${OMP_LIB}")
    endif()
endforeach()

