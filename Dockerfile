# ReGaHss-Test environment
#
# Self-contained image with a ReGaHss binary (plus its libXmlRpc/libxmlparser
# runtime libraries and WebUI files) taken from OpenCCU-Base together with the
# node.js/mocha based ReGaHss-Test suite and libfaketime.
#
#   docker build -t regahss-test \
#     --build-arg BASE_REF=main \
#     --build-arg REGA_ARCH=x86_64-linux-gnu .
#   docker run --rm --init regahss-test                    # complete test suite
#   docker run --rm --init regahss-test npx mocha test/02-script-doku-teil1.js
#
# Build arguments:
#   BASE_REPO  OpenCCU-Base git repository
#   BASE_REF   OpenCCU-Base branch, tag or commit SHA to test (default: main)
#   REGA_ARCH  x86_64-linux-gnu or i686-linux-gnu

# fetch the required parts of OpenCCU-Base
FROM node:22-bookworm-slim AS openccu-base
ARG BASE_REPO=https://github.com/OpenCCU/OpenCCU-Base.git
ARG BASE_REF=main
ARG REGA_ARCH=x86_64-linux-gnu
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
COPY scripts/fetch-openccu-base.sh /usr/local/bin/
RUN fetch-openccu-base.sh "${BASE_REPO}" "${BASE_REF}" "${REGA_ARCH}" /openccu-base

# build libfaketime from source: the 32-bit ReGaHss uses the glibc time64 ABI
# (__clock_gettime64 & co.) which is only supported since libfaketime 0.9.13
FROM node:22-bookworm-slim AS libfaketime
ARG REGA_ARCH=x86_64-linux-gnu
ARG LIBFAKETIME_REF=v0.9.13
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN packages=(ca-certificates git make gcc libc6-dev) \
 && cc=gcc \
 && if [ "${REGA_ARCH}" = "i686-linux-gnu" ]; then packages+=(gcc-multilib); cc="gcc -m32"; fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends "${packages[@]}" \
 && rm -rf /var/lib/apt/lists/* \
 && git clone -q --depth 1 --branch "${LIBFAKETIME_REF}" https://github.com/wolfcw/libfaketime.git /src/libfaketime \
 && make -C /src/libfaketime/src CC="${cc}" PREFIX=/usr/local all install

# test environment
FROM node:22-bookworm-slim
ARG REGA_ARCH=x86_64-linux-gnu
LABEL org.opencontainers.image.source="https://github.com/OpenCCU/ReGaHss-Test" \
      org.opencontainers.image.description="ReGaHss test environment based on OpenCCU-Base" \
      org.opencontainers.image.licenses="MIT"
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Europe/Berlin \
    REGA_BIN=/bin/ReGaHss
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN packages=(ca-certificates expect procps tzdata) \
 && case "${REGA_ARCH}" in \
      x86_64-linux-gnu) ;; \
      i686-linux-gnu) \
        dpkg --add-architecture i386 \
        && packages+=(libc6:i386 libstdc++6:i386 libgcc-s1:i386) ;; \
      *) echo "unsupported REGA_ARCH ${REGA_ARCH}" >&2; exit 1 ;; \
    esac \
 && apt-get update \
 && apt-get install -y --no-install-recommends "${packages[@]}" \
 && rm -rf /var/lib/apt/lists/* \
 && ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime \
 && echo "${TZ}" >/etc/timezone

COPY --from=libfaketime /usr/local/bin/faketime /usr/local/bin/faketime
COPY --from=libfaketime /usr/local/lib/faketime /usr/local/lib/faketime

WORKDIR /opt/regahss-test
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --from=openccu-base /openccu-base /opt/openccu-base
COPY . .
RUN scripts/install-regahss.sh /opt/openccu-base "${REGA_ARCH}"

ENTRYPOINT ["/opt/regahss-test/scripts/docker-entrypoint.sh"]
CMD ["npm", "run", "test:mocha"]
