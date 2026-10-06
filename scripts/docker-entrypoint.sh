#!/bin/bash
#
# Entrypoint of the ReGaHss-Test docker image: prints the versions of the
# components under test and executes the given command (default: test suite).
#
set -euo pipefail

# shellcheck source=/dev/null
[[ -r /etc/regahss-test.info ]] && source /etc/regahss-test.info

export REGA_BIN=${REGA_BIN:-/bin/ReGaHss}
export REGA_LABEL=${REGA_LABEL:-${REGA_ARCH:-unknown}@${OPENCCU_BASE_COMMIT:0:7}}

echo "ReGaHss-Test environment:"
echo "  ReGaHss:      ${REGA_VERSION:-unknown} (${REGA_BIN})"
echo "  OpenCCU-Base: ${OPENCCU_BASE_COMMIT:-unknown} (${REGA_ARCH:-unknown})"
echo "  node.js:      $(node --version)"
echo "  faketime:     $(dpkg-query -W -f='${Version}' faketime 2>/dev/null || echo unknown)"
echo "  timezone:     ${TZ:-unset} ($(date +%Z))"
echo

exec "$@"
