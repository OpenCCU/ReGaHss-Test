#!/bin/bash
#
# Builds the ReGaHss runtime libraries libXmlRpc and libxmlparser from the
# sources of an OpenCCU-Base tree using OpenCCU-Base's own CMake build system
# (target compat-libraries).
#
# Usage: build-libs.sh <openccu-base-dir> <arch> <variant> <outdir>
#
#   <arch>     x86_64-linux-gnu or i686-linux-gnu (cross build via the
#              OpenCCU-Base toolchain file, requires i686-linux-gnu-g++)
#   <variant>  source  release build as used by OpenCCU
#              asan    debug build instrumented with AddressSanitizer,
#                      UndefinedBehaviorSanitizer and gcov coverage
#
# The libraries are placed in <outdir>/lib, the CMake build tree (incl. the
# gcov notes files of the asan variant) in <outdir>/build.
#
set -euo pipefail

BASE_DIR=${1:?usage: $0 <openccu-base-dir> <arch> <variant> <outdir>}
ARCH=${2:?missing arch}
VARIANT=${3:?missing variant}
OUT=${4:?missing outdir}

cmake_args=(
  -S "${BASE_DIR}"
  -B "${OUT}/build"
  -DTARGET_PLATFORM="${ARCH}"
  -DBUILD_DEFAULT_COMPONENTS=OFF
  -DBUILD_TCL_MODULES=OFF
  -DBUILD_WEBUI_AND_DEVICETYPES=OFF
  -DDEPLOY_TO_REPO=OFF
  -DROOTFS_DIR="${OUT}/rootfs"
)

case "${ARCH}" in
  x86_64-linux-gnu)
    cmake_args+=(-DCROSS_PREFIX=)
    ;;
  i686-linux-gnu)
    cmake_args+=(-DCMAKE_TOOLCHAIN_FILE="${BASE_DIR}/cmake/toolchains/i686-linux-gnu.cmake" -DCROSS_PREFIX=i686-linux-gnu-)
    ;;
  *)
    echo "ERROR: unsupported arch ${ARCH}" >&2
    exit 1
    ;;
esac

case "${VARIANT}" in
  source)
    cmake_args+=(-DCMAKE_BUILD_TYPE=Release)
    ;;
  asan)
    flags="-fsanitize=address,undefined -fno-omit-frame-pointer --coverage"
    cmake_args+=(
      -DCMAKE_BUILD_TYPE=RelWithDebInfo
      -DCMAKE_CXX_FLAGS="${flags}"
      -DCMAKE_SHARED_LINKER_FLAGS="${flags}"
    )
    ;;
  *)
    echo "ERROR: unsupported variant ${VARIANT}" >&2
    exit 1
    ;;
esac

cmake "${cmake_args[@]}"
cmake --build "${OUT}/build" --target compat-libraries --parallel "$(nproc)"

install -d "${OUT}/lib"
install -m 0644 "${OUT}/rootfs/lib/libXmlRpc.so" "${OUT}/rootfs/lib/libxmlparser.so" "${OUT}/lib/"
echo "${VARIANT}" >"${OUT}/variant"
echo "built libXmlRpc/libxmlparser (${VARIANT}, ${ARCH}) in ${OUT}/lib"
