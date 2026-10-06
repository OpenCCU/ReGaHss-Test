#!/bin/bash
#
# Fetches only those parts of an OpenCCU-Base revision which are required
# to run ReGaHss (binary, runtime libraries and WebUI files) and to rebuild
# its runtime libraries (CMake build system and library sources) via a
# shallow sparse checkout.
#
# Usage: fetch-openccu-base.sh <repo-url> <ref> <arch> <destdir>
#
#   <ref>   branch, tag or full commit SHA of OpenCCU-Base
#   <arch>  x86_64-linux-gnu, i686-linux-gnu, aarch64-linux-gnu or
#           arm-linux-gnueabihf
#
set -euo pipefail

REPO=${1:?usage: $0 <repo-url> <ref> <arch> <destdir>}
REF=${2:?missing ref}
ARCH=${3:?missing arch}
DEST=${4:?missing destdir}

if [[ -e ${DEST} ]]; then
  echo "ERROR: ${DEST} already exists" >&2
  exit 1
fi

git init -q "${DEST}"
git -C "${DEST}" remote add origin "${REPO}"
git -C "${DEST}" sparse-checkout set --no-cone \
  "/bin/${ARCH}/ReGaHss" \
  "/lib/${ARCH}/libXmlRpc.so" \
  "/lib/${ARCH}/libxmlparser.so" \
  "/www/" \
  "/CMakeLists.txt" \
  "/cmake/" \
  "/src/lib*/"
git -C "${DEST}" fetch -q --depth 1 --filter=blob:none origin "${REF}"
git -C "${DEST}" -c advice.detachedHead=false checkout -q FETCH_HEAD

commit=$(git -C "${DEST}" rev-parse HEAD)
echo "${commit}" >"${DEST}/.openccu-base-commit"
rm -rf "${DEST:?}/.git"

for f in "bin/${ARCH}/ReGaHss" "lib/${ARCH}/libXmlRpc.so" "lib/${ARCH}/libxmlparser.so" "www/rega" \
  "CMakeLists.txt" "src/libXmlRpc/CMakeLists.txt" "src/libxmlparser/CMakeLists.txt"; do
  if [[ ! -e ${DEST}/${f} ]]; then
    echo "ERROR: ${f} missing in OpenCCU-Base ${REF} (${commit})" >&2
    exit 1
  fi
done

echo "fetched OpenCCU-Base ${REF} (${commit}) for ${ARCH} to ${DEST}"
