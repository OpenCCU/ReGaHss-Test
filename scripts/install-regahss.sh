#!/bin/bash
#
# Installs ReGaHss plus its runtime environment (libXmlRpc/libxmlparser,
# WebUI files, rega.conf, InterfacesList.xml, test regadom and dummy hook
# scripts) from an OpenCCU-Base tree into the running system. This has to be
# run as root and is meant for disposable environments (docker container,
# CI runner) only, as it writes to /bin, /etc, /www and /usr/local/lib.
#
# Usage: install-regahss.sh <openccu-base-dir> [arch] [libs-dir]
#
#   [libs-dir]  directory with libXmlRpc.so/libxmlparser.so built from source
#               (see build-libs.sh) to be used instead of the prebuilt
#               libraries of OpenCCU-Base
#
set -euo pipefail

BASE_DIR=${1:?usage: $0 <openccu-base-dir> [arch] [libs-dir]}
ARCH=${2:-x86_64-linux-gnu}
LIBS_DIR=${3:-}
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
LIB_DIR=/usr/local/lib/regahss
REGA_BIN=/bin/ReGaHss
ABI_REPORT=/etc/regahss-abi-report.txt
LIBS=(libXmlRpc.so libxmlparser.so)

error() {
  echo "::error::$*" >&2
  exit 1
}

# the ARM binaries run with the qemu user mode emulator (no binfmt_misc
# registration required), their libraries are installed into the multiarch
# directory of the architecture, which the loader of the guest searches
EMULATOR=""
LOADER=""
case ${ARCH} in
  aarch64-linux-gnu)
    EMULATOR=qemu-aarch64-static
    LOADER=/lib/ld-linux-aarch64.so.1
    LIB_DIR=/usr/lib/${ARCH}
    ;;
  arm-linux-gnueabihf)
    EMULATOR=qemu-arm-static
    LOADER=/lib/ld-linux-armhf.so.3
    LIB_DIR=/usr/lib/${ARCH}
    ;;
esac
if [[ -n ${EMULATOR} ]]; then
  command -v "${EMULATOR}" >/dev/null || error "${EMULATOR} (qemu-user-static) required to run the ${ARCH} ReGaHss"
  [[ -e ${LOADER} ]] || error "${LOADER} missing (install the ${ARCH} C library)"
fi

# like ldd [-r], also for emulated binaries (via the loader of the guest)
list_dependencies() {
  if [[ -z ${EMULATOR} ]]; then
    ldd "$@"
    return
  fi

  local relocations=""
  if [[ $1 == -r ]]; then
    relocations=yes
    shift
  fi
  LD_TRACE_LOADED_OBJECTS=1 LD_WARN=yes LD_BIND_NOW=${relocations} "${EMULATOR}" "${LOADER}" "$1"
}

[[ -f ${BASE_DIR}/bin/${ARCH}/ReGaHss ]] || error "ReGaHss binary for ${ARCH} missing in ${BASE_DIR}"
for lib in "${LIBS[@]}"; do
  [[ -f ${BASE_DIR}/lib/${ARCH}/${lib} ]] || error "${lib} for ${ARCH} missing in ${BASE_DIR}"
  [[ -z ${LIBS_DIR} || -f ${LIBS_DIR}/${lib} ]] || error "${lib} missing in ${LIBS_DIR}"
done
[[ -d ${BASE_DIR}/www/rega ]] || error "WebUI files (www/rega) missing in ${BASE_DIR}"

if [[ -n ${LIBS_DIR} ]]; then
  libs_variant=$(cat "${LIBS_DIR}/../variant" 2>/dev/null || echo source)
  libs_src=${LIBS_DIR}
else
  libs_variant=prebuilt
  libs_src=${BASE_DIR}/lib/${ARCH}
fi

umask 022

echo "STEP: installing ReGaHss (${ARCH}) with ${libs_variant} libraries"
install -D -m 0755 "${BASE_DIR}/bin/${ARCH}/ReGaHss" "${REGA_BIN}"
install -d "${LIB_DIR}"
for lib in "${LIBS[@]}"; do
  install -m 0644 "${libs_src}/${lib}" "${LIB_DIR}/"
done
if [[ -z ${EMULATOR} ]]; then
  echo "${LIB_DIR}" >/etc/ld.so.conf.d/regahss.conf
  ldconfig
fi

echo "STEP: installing WebUI files"
mkdir -p /www
cp -a "${BASE_DIR}/www/." /www/

echo "STEP: installing configuration"
mkdir -p /etc/config /config
install -m 0644 "${REPO_DIR}/rega.conf" /etc/rega.conf
install -m 0644 "${REPO_DIR}/InterfacesList.xml" "${REPO_DIR}/homematic.regadom" /etc/config/
chmod -R a+rw /etc/config

echo "STEP: creating hook scripts"
for hook in hm_startup hm_autoconf; do
  printf '#!/bin/sh\necho /bin/%s executed\n' "${hook}" >"/bin/${hook}"
  chmod 0755 "/bin/${hook}"
done

echo "STEP: verifying ReGaHss runtime dependencies"
list_dependencies "${REGA_BIN}"
if list_dependencies "${REGA_BIN}" | grep -q 'not found'; then
  error "unresolved runtime dependencies of ${REGA_BIN}"
fi
# all symbols ReGaHss imports must be provided by the (rebuilt) libraries
undefined=$(list_dependencies -r "${REGA_BIN}" 2>&1 | grep 'undefined symbol' || true)
if [[ -n ${undefined} ]]; then
  echo "${undefined}" >&2
  error "${REGA_BIN} has undefined symbols with the ${libs_variant} libraries"
fi

# (sanitizer instrumented libraries require the ASan runtime to be preloaded,
# which is not needed for just printing the version)
version=$(ASAN_OPTIONS=verify_asan_link_order=0:detect_leaks=0 timeout 60 ${EMULATOR} "${REGA_BIN}" -h 2>&1 |
  grep -m1 -o 'ReGaHss R[0-9.]*.*' || true)
[[ -n ${version} ]] || error "${REGA_BIN} -h did not output any version information"

# informational ABI comparison of the release build vs. the prebuilt libraries
rm -f "${ABI_REPORT}"
if [[ ${libs_variant} == source ]] && command -v abidiff >/dev/null; then
  echo "STEP: comparing ABI of ${libs_variant} vs. prebuilt libraries"
  for lib in "${LIBS[@]}"; do
    rc=0
    report=$(abidiff --no-show-locs "${BASE_DIR}/lib/${ARCH}/${lib}" "${libs_src}/${lib}" 2>&1) || rc=$?
    {
      echo "### ${lib} (abidiff exit code ${rc})"
      echo
      echo "${report:-no ABI changes}"
      echo
    } | tee -a "${ABI_REPORT}"
  done
fi

commit=$(cat "${BASE_DIR}/.openccu-base-commit" 2>/dev/null || echo unknown)
cat >/etc/regahss-test.info <<EOF
REGA_ARCH=${ARCH}
REGA_LIBS=${libs_variant}
REGA_VERSION="${version}"
REGA_EMULATOR_INFO="${EMULATOR:+$(${EMULATOR} --version | head -n 1)}"
OPENCCU_BASE_COMMIT=${commit}
EOF
echo "installed ${version} from OpenCCU-Base ${commit} (${ARCH}, ${libs_variant} libraries)"
