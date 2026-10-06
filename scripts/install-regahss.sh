#!/bin/bash
#
# Installs ReGaHss plus its runtime environment (libXmlRpc/libxmlparser,
# WebUI files, rega.conf, InterfacesList.xml, test regadom and dummy hook
# scripts) from an OpenCCU-Base tree into the running system. This has to be
# run as root and is meant for disposable environments (docker container,
# CI runner) only, as it writes to /bin, /etc, /www and /usr/local/lib.
#
# Usage: install-regahss.sh <openccu-base-dir> [arch]
#
set -euo pipefail

BASE_DIR=${1:?usage: $0 <openccu-base-dir> [arch]}
ARCH=${2:-x86_64-linux-gnu}
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
LIB_DIR=/usr/local/lib/regahss
REGA_BIN=/bin/ReGaHss

error() {
  echo "::error::$*" >&2
  exit 1
}

[[ -f ${BASE_DIR}/bin/${ARCH}/ReGaHss ]] || error "ReGaHss binary for ${ARCH} missing in ${BASE_DIR}"
for lib in libXmlRpc.so libxmlparser.so; do
  [[ -f ${BASE_DIR}/lib/${ARCH}/${lib} ]] || error "${lib} for ${ARCH} missing in ${BASE_DIR}"
done
[[ -d ${BASE_DIR}/www/rega ]] || error "WebUI files (www/rega) missing in ${BASE_DIR}"

umask 022

echo "STEP: installing ReGaHss (${ARCH})"
install -D -m 0755 "${BASE_DIR}/bin/${ARCH}/ReGaHss" "${REGA_BIN}"
install -d "${LIB_DIR}"
install -m 0644 "${BASE_DIR}/lib/${ARCH}/libXmlRpc.so" "${BASE_DIR}/lib/${ARCH}/libxmlparser.so" "${LIB_DIR}/"
echo "${LIB_DIR}" >/etc/ld.so.conf.d/regahss.conf
ldconfig

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
ldd "${REGA_BIN}"
if ldd "${REGA_BIN}" | grep -q 'not found'; then
  error "unresolved runtime dependencies of ${REGA_BIN}"
fi

version=$("${REGA_BIN}" -h 2>&1 | grep -m1 -o 'ReGaHss R[0-9.]*.*' || true)
[[ -n ${version} ]] || error "${REGA_BIN} -h did not output any version information"

commit=$(cat "${BASE_DIR}/.openccu-base-commit" 2>/dev/null || echo unknown)
cat >/etc/regahss-test.info <<EOF
REGA_ARCH=${ARCH}
REGA_VERSION="${version}"
OPENCCU_BASE_COMMIT=${commit}
EOF
echo "installed ${version} from OpenCCU-Base ${commit} (${ARCH})"
