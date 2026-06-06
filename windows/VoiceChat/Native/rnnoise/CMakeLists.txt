cmake_minimum_required(VERSION 3.16)
project(rnnoise LANGUAGES C)

set(CMAKE_C_STANDARD 99)

# Windows DLL export
if(WIN32)
    add_definitions(-DRNNOISE_BUILD -DDLL_EXPORT)
endif()

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# Core library source files
set(RNNOISE_SOURCES
    src/celt_lpc.c
    src/denoise.c
    src/kiss_fft.c
    src/nnet.c
    src/nnet_default.c
    src/parse_lpcnet_weights.c
    src/pitch.c
    src/rnn.c
    src/rnnoise_data.c
    src/rnnoise_tables.c
    src/x86/x86cpu.c
    src/x86/x86_dnn_map.c
    src/x86/nnet_avx2.c
    src/x86/nnet_sse4_1.c
)

# Build shared library (DLL on Windows)
add_library(rnnoise SHARED ${RNNOISE_SOURCES})

# Set output name
set_target_properties(rnnoise PROPERTIES
    OUTPUT_NAME "rnnoise"
    PREFIX "lib"
)

# Windows-specific: export all symbols
if(WIN32)
    set_target_properties(rnnoise PROPERTIES
        WINDOWS_EXPORT_ALL_SYMBOLS ON
    )
endif()

# Math library (not needed on Windows)
if(NOT WIN32)
    target_link_libraries(rnnoise m)
endif()

# Install targets
install(TARGETS rnnoise
    RUNTIME DESTINATION bin
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
)

install(FILES include/rnnoise.h DESTINATION include)
