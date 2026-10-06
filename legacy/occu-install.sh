#!/bin/bash
#
# LEGACY: installs ReGaHss from the old OCCU repository (OpenCCU/occu) into
# the running system (needs root). Superseded by the OpenCCU-Base based
# docker environment (see Dockerfile) and only kept for comparison runs
# until OCCU is retired.
#
# Environment:
#   FLAVOR    ReGaHss flavor to install: community, normal or beta (default: beta)
#   ARCH      OCCU architecture directory (default: X86_32_GCC8)
#   OCCU_REF  OCCU branch/tag to use (default: master)
#
set -euo pipefail

FLAVOR=${FLAVOR:-beta}
ARCH=${ARCH:-X86_32_GCC8}
OCCU_REF=${OCCU_REF:-master}
FAKETIME_REF=v0.9.10
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)

umask 022

echo "STEP: installing required packages"
packages=(expect)
if [[ ! ${ARCH} =~ 64 ]]; then
  packages+=(libc6:i386 libstdc++6:i386 gcc-multilib)
fi
apt-get -qq install -y "${packages[@]}"

echo "STEP: compiling libfaketime ${FAKETIME_REF}"
if [[ ! -x /bin/faketime ]]; then
  rm -rf /tmp/libfaketime
  git clone -q --depth 1 --branch "${FAKETIME_REF}" https://github.com/wolfcw/libfaketime.git /tmp/libfaketime
  if [[ ! ${ARCH} =~ 64 ]]; then
    make -C /tmp/libfaketime CC=gcc CFLAGS="-m32" LDFLAGS="-m32 -L/usr/lib32" PREFIX= install
  else
    make -C /tmp/libfaketime CC=gcc PREFIX= install
  fi
fi

echo "STEP: cloning OCCU (${OCCU_REF})"
rm -rf /occu
git clone -q --depth 1 --branch "${OCCU_REF}" https://github.com/OpenCCU/occu /occu
echo "OCCU commit: $(git -C /occu rev-parse HEAD)"

echo "STEP: installing ReGaHss.${FLAVOR} (${ARCH})"
case "${FLAVOR}" in
  beta) src="/occu/${ARCH}/packages-eQ-3/WebUI-Beta/bin/ReGaHss" ;;
  *)    src="/occu/${ARCH}/packages-eQ-3/WebUI/bin/ReGaHss.${FLAVOR}" ;;
esac
if [[ ! -f ${src} ]]; then
  echo "::error::${src} missing in OCCU"
  exit 1
fi
install -m 0755 "${src}" "/bin/ReGaHss.${FLAVOR}"

mkdir -p /etc/config /config /www
cp -a /occu/WebUI/www/. /www/
install -m 0644 "${REPO_DIR}/rega.conf" /etc/rega.conf
install -m 0644 "${REPO_DIR}/InterfacesList.xml" "${REPO_DIR}/homematic.regadom" /etc/config/
chmod -R a+rw /etc/config
for hook in hm_startup hm_autoconf; do
  printf '#!/bin/sh\necho /bin/%s executed\n' "${hook}" >"/bin/${hook}"
  chmod 0755 "/bin/${hook}"
done

: >/etc/ld.so.conf.d/hm.conf
if [[ ${FLAVOR} == beta && -d /occu/${ARCH}/packages-eQ-3/WebUI-Beta/lib ]]; then
  echo "/occu/${ARCH}/packages-eQ-3/WebUI-Beta/lib/" >>/etc/ld.so.conf.d/hm.conf
fi
echo "/occu/${ARCH}/packages-eQ-3/WebUI/lib/" >>/etc/ld.so.conf.d/hm.conf
ldconfig

ldd "/bin/ReGaHss.${FLAVOR}"
if ldd "/bin/ReGaHss.${FLAVOR}" | grep -q 'not found'; then
  echo "::error::unresolved runtime dependencies of /bin/ReGaHss.${FLAVOR}"
  exit 1
fi
"/bin/ReGaHss.${FLAVOR}" -h 2>&1 | head -2 || true
