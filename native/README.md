# Native mGBA Shim

This directory contains the C shim layer bridging Node.js (`koffi`) to `libmgba`.

## Binaries

- `libmgba_shim.so`: Linux x86_64 shared library dynamically linked to `vendor/mgba-dist/lib/libmgba.so.0.11.0`.
- `mgba_shim.dll`: Windows x64 shared library statically bundling `libmgba`, `libpng` (1.6.51), and `zlib` (1.2.11). It links exclusively against standard Windows system libraries (`KERNEL32`, `msvcrt`, `ole32`, `SHELL32`, `SHLWAPI`, `WS2_32`) and has zero third-party runtime dependencies.

---

## Building Linux Shim (`libmgba_shim.so`)

Requires `gcc` and `make`. Run:

```bash
make -C native
```

---

## Building Windows Shim (`mgba_shim.dll`)

The Windows binary is cross-compiled using MinGW-w64 inside a reproducible Docker container.

### Prerequisites
- Docker

### One-Step Build
From the repository root:

```bash
./native/build-win64.sh
```

This script:
1. Builds the `mgba-win-builder` Docker image from `native/Dockerfile` if not already present.
2. Runs CMake with `x86_64-w64-mingw32-gcc` and Ninja.
3. Builds static `libmgba.a`, bundled `libpng16.a`, and bundled `libzlibstatic.a` with `USE_PNG=ON` and `USE_ZLIB=ON`.
4. Statically links the objects into `native/mgba_shim.dll`.
5. Verifies exports and dependencies via `objdump`.

---

## Savestate PNG & Screenshot Architecture

Both `libmgba_shim.so` (Linux) and `mgba_shim.dll` (Windows) have native PNG support enabled. When `mgba_load_state` or `mgba_load_state_buffer` loads a PNG-wrapped savestate container (`.ss0`), `restore_screenshot_if_available` extracts the embedded screenshot and copies the decoded RGBA pixels directly into `handle->video_buffer`. This ensures the emulator resumes displaying the savestate screenshot immediately upon resume across all supported platforms.
