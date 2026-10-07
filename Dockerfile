# ReGaHss-Test environment
#
# Self-contained image with a ReGaHss binary (plus its libXmlRpc/libxmlparser
# runtime libraries and WebUI files) taken from OpenCCU-Base together with the
# node.js/mocha based ReGaHss-Test suite and libfaketime.
#
#   docker build -t regahss-test \
#     --build-arg BASE_REF=main \
#     --build-arg REGA_ARCH=x86_64-linux-gnu \
#     --build-arg REGA_LIBS=prebuilt .
#   docker run --rm --init -v "$PWD/results:/results" regahss-test
#   docker run --rm --init regahss-test npx mocha test/02-script-doku-teil1.js
#   docker run --rm --init -e REGA_JOBS=4 -e REGA_FAKETIME_RATE=1 regahss-test
#
# Build arguments:
#   BASE_REPO  OpenCCU-Base git repository
#   BASE_REF   OpenCCU-Base branch, tag or commit SHA to test (default: main)
#   REGA_ARCH  x86_64-linux-gnu or i686-linux-gnu
#   REF_BASE_REF  OpenCCU-Base ref with a reference ReGaHss for differential
#              tests of the script corpus (optional)
#   REGA_LIBS  libXmlRpc/libxmlparser to run ReGaHss with:
#              prebuilt  prebuilt libraries of OpenCCU-Base (default)
#              source    built from the OpenCCU-Base sources
#              asan      built from source with ASan/UBSan and gcov coverage
#                        (x86_64-linux-gnu only)

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

# fetch the ReGaHss of a reference revision for differential tests of the
# script corpus (if requested, e.g. the previous ReGaHss version)
FROM openccu-base AS reference
ARG BASE_REPO=https://github.com/OpenCCU/OpenCCU-Base.git
ARG REF_BASE_REF=
ARG REGA_ARCH=x86_64-linux-gnu
RUN mkdir -p /opt/regahss-ref \
 && if [ -n "${REF_BASE_REF}" ]; then \
      fetch-openccu-base.sh "${BASE_REPO}" "${REF_BASE_REF}" "${REGA_ARCH}" /tmp/ref binaries \
      && install -m 0755 "/tmp/ref/bin/${REGA_ARCH}/ReGaHss" /opt/regahss-ref/ReGaHss \
      && install -m 0644 "/tmp/ref/lib/${REGA_ARCH}/libXmlRpc.so" "/tmp/ref/lib/${REGA_ARCH}/libxmlparser.so" /opt/regahss-ref/ \
      && cp /tmp/ref/.openccu-base-commit /opt/regahss-ref/commit \
      && rm -rf /tmp/ref; \
    fi

# build libXmlRpc/libxmlparser from the OpenCCU-Base sources (if requested)
FROM node:22-bookworm-slim AS libs
ARG REGA_ARCH=x86_64-linux-gnu
ARG REGA_LIBS=prebuilt
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
COPY --from=openccu-base /openccu-base /opt/openccu-base
COPY scripts/build-libs.sh /usr/local/bin/
RUN mkdir -p /opt/regahss-libs \
 && if [ "${REGA_LIBS}" = "prebuilt" ]; then exit 0; fi \
 && if [ "${REGA_LIBS}" = "asan" ] && [ "${REGA_ARCH}" != "x86_64-linux-gnu" ]; then \
      echo "REGA_LIBS=asan is only supported for x86_64-linux-gnu" >&2; exit 1; \
    fi \
 && packages=(cmake make g++) \
 && if [ "${REGA_ARCH}" = "i686-linux-gnu" ]; then packages+=(g++-i686-linux-gnu libc6-dev-i386-cross); fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends "${packages[@]}" \
 && rm -rf /var/lib/apt/lists/* \
 && build-libs.sh /opt/openccu-base "${REGA_ARCH}" "${REGA_LIBS}" /opt/regahss-libs

# build the preload libraries for the ReGaHss architecture: libfaketime from
# source (the 32-bit ReGaHss uses the glibc time64 ABI, __clock_gettime64 &
# co., which is only supported since libfaketime 0.9.13) and liblinebuf (line
# buffered ReGaHss output, see src/linebuf.c)
FROM node:22-bookworm-slim AS tools
ARG REGA_ARCH=x86_64-linux-gnu
ARG LIBFAKETIME_REF=v0.9.13
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
COPY src/linebuf.c /src/linebuf.c
RUN packages=(ca-certificates git make gcc libc6-dev) \
 && cc=gcc \
 && if [ "${REGA_ARCH}" = "i686-linux-gnu" ]; then packages+=(gcc-multilib); cc="gcc -m32"; fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends "${packages[@]}" \
 && rm -rf /var/lib/apt/lists/* \
 && git clone -q --depth 1 --branch "${LIBFAKETIME_REF}" https://github.com/wolfcw/libfaketime.git /src/libfaketime \
 && make -C /src/libfaketime/src CC="${cc}" PREFIX=/usr/local all install \
 && mkdir -p /usr/local/lib/regahss-test \
 && ${cc} -shared -fPIC -O2 -Wall -o /usr/local/lib/regahss-test/liblinebuf.so /src/linebuf.c

# test environment
FROM node:22-bookworm-slim
ARG REGA_ARCH=x86_64-linux-gnu
ARG REGA_LIBS=prebuilt
ARG GCOVR_VERSION=8.6
LABEL org.opencontainers.image.source="https://github.com/OpenCCU/ReGaHss-Test" \
      org.opencontainers.image.description="ReGaHss test environment based on OpenCCU-Base" \
      org.opencontainers.image.licenses="MIT"
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Europe/Berlin \
    REGA_BIN=/bin/ReGaHss \
    REGA_LINEBUF_LIB=/usr/local/lib/regahss-test/liblinebuf.so \
    REGA_FAKETIME_LIB=/usr/local/lib/faketime/libfaketime.so.1
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN packages=(ca-certificates gdb procps tzdata) \
 && case "${REGA_ARCH}" in \
      x86_64-linux-gnu) ;; \
      i686-linux-gnu) \
        dpkg --add-architecture i386 \
        && packages+=(libc6:i386 libstdc++6:i386 libgcc-s1:i386) ;; \
      *) echo "unsupported REGA_ARCH ${REGA_ARCH}" >&2; exit 1 ;; \
    esac \
 && case "${REGA_LIBS}" in \
      prebuilt) ;; \
      source) packages+=(abigail-tools) ;; \
      asan) packages+=(libasan8 libubsan1 gcc python3-venv) ;; \
      *) echo "unsupported REGA_LIBS ${REGA_LIBS}" >&2; exit 1 ;; \
    esac \
 && apt-get update \
 && apt-get install -y --no-install-recommends "${packages[@]}" \
 && rm -rf /var/lib/apt/lists/* \
 && ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime \
 && echo "${TZ}" >/etc/timezone \
 && if [ "${REGA_LIBS}" = "asan" ]; then \
      python3 -m venv /opt/gcovr \
      && /opt/gcovr/bin/pip install --no-cache-dir "gcovr==${GCOVR_VERSION}" \
      && ln -s /opt/gcovr/bin/gcovr /usr/local/bin/gcovr; \
    fi

COPY --from=tools /usr/local/bin/faketime /usr/local/bin/faketime
COPY --from=tools /usr/local/lib/faketime /usr/local/lib/faketime
COPY --from=tools /usr/local/lib/regahss-test /usr/local/lib/regahss-test

WORKDIR /opt/regahss-test
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --from=openccu-base /openccu-base /opt/openccu-base
COPY --from=reference /opt/regahss-ref /opt/regahss-ref
COPY --from=libs /opt/regahss-libs /opt/regahss-libs
COPY . .
RUN libs=() \
 && if [ "${REGA_LIBS}" != "prebuilt" ]; then libs=(/opt/regahss-libs/lib); fi \
 && scripts/install-regahss.sh /opt/openccu-base "${REGA_ARCH}" "${libs[@]}"

ENTRYPOINT ["/opt/regahss-test/scripts/docker-entrypoint.sh"]
CMD ["npm", "run", "test:mocha"]
