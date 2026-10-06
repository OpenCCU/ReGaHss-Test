#!/bin/bash
#
# LEGACY: runs the test suite against a ReGaHss installed via
# legacy/occu-install.sh (needs root, node.js in PATH).
#
set -euo pipefail

FLAVOR=${FLAVOR:-beta}

export REGA_BIN=/bin/ReGaHss.${FLAVOR}
export REGA_LABEL=occu-${FLAVOR}
export TZ=Europe/Berlin

if [[ ! -x ${REGA_BIN} ]]; then
  echo "::error::${REGA_BIN} missing"
  exit 1
fi

cd "$(dirname "$0")/.."
exec npm run test:mocha -- "$@"
