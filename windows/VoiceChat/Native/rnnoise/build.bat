@echo off
setlocal EnableDelayedExpansion

REM Visual Studio 2022 x64 环境
set "VSPATH=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.36.32532"
set "WINSDK=C:\Program Files (x86)\Windows Kits\10"
set "WINSDK_VER=10.0.22000.0"

set "PATH=%VSPATH%\bin\Hostx64\x64;%WINSDK%\bin\%WINSDK_VER%\x64;%PATH%"
set "INCLUDE=%VSPATH%\include;%WINSDK%\Include\%WINSDK_VER%\ucrt;%WINSDK%\Include\%WINSDK_VER%\shared;%WINSDK%\Include\%WINSDK_VER%\um"
set "LIB=%VSPATH%\lib\x64;%WINSDK%\Lib\%WINSDK_VER%\ucrt\x64;%WINSDK%\Lib\%WINSDK_VER%\um\x64"

cd /d "%~dp0"

if not exist build_manual mkdir build_manual

echo === Compiling RNNoise sources ===

cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\celt_lpc.obj src\celt_lpc.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\denoise.obj src\denoise.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\kiss_fft.obj src\kiss_fft.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\nnet.obj src\nnet.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\nnet_default.obj src\nnet_default.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\pitch.obj src\pitch.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\rnn.obj src\rnn.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\rnnoise_tables.obj src\rnnoise_tables.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\parse_lpcnet_weights.obj src\parse_lpcnet_weights.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\rnnoise_data.obj src\rnnoise_data.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\x86cpu.obj src\x86\x86cpu.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\x86_dnn_map.obj src\x86\x86_dnn_map.c
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /Iinclude /Isrc /Fobuild_manual\nnet_avx2.obj src\x86\nnet_avx2.c /arch:AVX2
cl.exe /c /O2 /MD /W3 /D WIN32 /D RNNOISE_BUILD /D DLL_EXPORT /D __SSE4_1__=1 /Iinclude /Isrc /Fobuild_manual\nnet_sse4_1.obj src\x86\nnet_sse4_1.c

echo === Linking DLL ===

link.exe /DLL /OUT:build_manual\librnnoise.dll ^
  build_manual\celt_lpc.obj ^
  build_manual\denoise.obj ^
  build_manual\kiss_fft.obj ^
  build_manual\nnet.obj ^
  build_manual\nnet_default.obj ^
  build_manual\pitch.obj ^
  build_manual\rnn.obj ^
  build_manual\rnnoise_tables.obj ^
  build_manual\parse_lpcnet_weights.obj ^
  build_manual\rnnoise_data.obj ^
  build_manual\x86cpu.obj ^
  build_manual\x86_dnn_map.obj ^
  build_manual\nnet_avx2.obj ^
  build_manual\nnet_sse4_1.obj ^
  /MACHINE:X64 /OPT:REF /OPT:ICF

echo === Done ===
dir build_manual\librnnoise.dll
