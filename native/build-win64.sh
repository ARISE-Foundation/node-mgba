#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="mgba-win-builder"

# Build builder image if not already built
if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
    echo "Building ${IMAGE_NAME} Docker image..."
    docker build -t "${IMAGE_NAME}" -f "${REPO_ROOT}/native/Dockerfile" "${REPO_ROOT}/native"
fi

echo "Building Windows x64 mgba_shim.dll in Docker..."
docker run --rm \
    -v "${REPO_ROOT}/vendor/mgba-src:/src:ro" \
    -v "${REPO_ROOT}/native:/native" \
    "${IMAGE_NAME}" bash -c '
set -euo pipefail

BUILD_DIR=$(mktemp -d)
SRC_COPY=$(mktemp -d)

cleanup() {
    rm -rf "${BUILD_DIR}" "${SRC_COPY}"
}
trap cleanup EXIT

cp -r /src/* "${SRC_COPY}/"
cd "${BUILD_DIR}"

# Enable dependency bundling for LIBMGBA_ONLY static builds
sed -i "s/set(DISABLE_DEPS ON)/set(DISABLE_DEPS OFF)/g" "${SRC_COPY}/CMakeLists.txt"
# Handle CRLF in libpng awk scripts on Windows targets
sed -i "s/out == \"\" {/{ sub(\/\\\\r\$\/, \"\"); }\\nout == \"\" {/" "${SRC_COPY}/src/third-party/libpng/scripts/options.awk"
sed -i "s/out == \"\" {/{ sub(\/\\\\r\$\/, \"\"); }\\nout == \"\" {/" "${SRC_COPY}/src/third-party/libpng/scripts/dfn.awk" || true

cmake "${SRC_COPY}" \
    -GNinja \
    -DCMAKE_SYSTEM_NAME=Windows \
    -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc \
    -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
    -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres \
    -DCMAKE_BUILD_TYPE=Release \
    -DLIBMGBA_ONLY=ON \
    -DBUILD_STATIC=ON \
    -DBUILD_SHARED=OFF \
    -DUSE_ZLIB=ON \
    -DUSE_PNG=ON \
    -DAWK=/usr/bin/mawk \
    -DUSE_DISCORD_RPC=OFF \
    -DUSE_EPOXY=OFF \
    -DUSE_FFMPEG=OFF \
    -DUSE_FREETYPE=OFF \
    -DUSE_JSON_C=OFF \
    -DUSE_LIBZIP=OFF \
    -DUSE_LUA=OFF \
    -DUSE_SQLITE3=OFF \
    -DUSE_EDITLINE=OFF

ninja

x86_64-w64-mingw32-gcc -O3 -shared -static-libgcc -o /native/mgba_shim.dll /native/mgba_shim.c \
    -I/src/include -I"${BUILD_DIR}/include" \
    -DENABLE_VFS=1 -DENABLE_DIRECTORIES=1 \
    -Wl,--export-all-symbols \
    -Wl,--whole-archive "${BUILD_DIR}/libmgba.a" $(find "${BUILD_DIR}" -name "*.a" ! -name "libmgba.a") -Wl,--no-whole-archive \
    -lws2_32 -lshlwapi -lversion -lole32 -lshell32 -luuid

echo "Successfully built /native/mgba_shim.dll"
'

chmod 755 "${REPO_ROOT}/native/mgba_shim.dll"
echo "Done! Output: ${REPO_ROOT}/native/mgba_shim.dll"
ls -lh "${REPO_ROOT}/native/mgba_shim.dll"
