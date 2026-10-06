#!/bin/bash
#
# Entrypoint of the ReGaHss-Test docker image: prints the versions of the
# components under test, executes the given command (default: test suite)
# and afterwards evaluates sanitizer reports and library coverage (asan
# variant). A markdown summary plus all reports are written to
# REGA_RESULTS_DIR (default: /results, mount it to keep the results).
#
set -uo pipefail

# shellcheck source=/dev/null
[[ -r /etc/regahss-test.info ]] && source /etc/regahss-test.info

REGA_LIBS=${REGA_LIBS:-prebuilt}
RESULTS=${REGA_RESULTS_DIR:-/results}
LIBS_BUILD_DIR=/opt/regahss-libs/build
BASE_DIR=/opt/openccu-base

export REGA_BIN=${REGA_BIN:-/bin/ReGaHss}
export REGA_LABEL=${REGA_LABEL:-${REGA_ARCH:-unknown}@${OPENCCU_BASE_COMMIT:0:7}/${REGA_LIBS}}

mkdir -p "${RESULTS}"
summary=${RESULTS}/summary.md

# keep the output of each ReGaHss instance
export REGA_LOG_DIR=${REGA_LOG_DIR:-${RESULTS}/logs}
rm -rf "${REGA_LOG_DIR}"

if [[ ${REGA_LIBS} == asan ]]; then
  sanitizer_dir=${RESULTS}/sanitizer
  rm -rf "${sanitizer_dir}"
  mkdir -p "${sanitizer_dir}"
  asan_lib=$(ldconfig -p | awk '/libasan\.so\.[0-9]+ .*x86-64/ {print $NF; exit}')
  ubsan_lib=$(ldconfig -p | awk '/libubsan\.so\.[0-9]+ .*x86-64/ {print $NF; exit}')
  if [[ -z ${asan_lib} || -z ${ubsan_lib} ]]; then
    echo "ERROR: ASan/UBSan runtime libraries not found" >&2
    exit 1
  fi
  # the sanitizer runtimes are only preloaded into the ReGaHss process
  export REGA_PRELOAD=${asan_lib}:${ubsan_lib}
  export ASAN_OPTIONS=${ASAN_OPTIONS:-detect_leaks=0:print_summary=1:log_path=${sanitizer_dir}/asan}
  export UBSAN_OPTIONS=${UBSAN_OPTIONS:-print_stacktrace=1:print_summary=1:log_path=${sanitizer_dir}/ubsan}
  # graceful shutdown to let ReGaHss write the gcov coverage data
  export REGA_STOP_SIGNAL=${REGA_STOP_SIGNAL:-TERM}
  # remove coverage data of previous runs
  find "${LIBS_BUILD_DIR}" -name '*.gcda' -delete 2>/dev/null
fi

{
  echo "## ReGaHss test: ${REGA_LABEL}"
  echo
  echo "| Component | Version |"
  echo "|---|---|"
  echo "| ReGaHss | ${REGA_VERSION:-unknown} (${REGA_ARCH:-unknown}) |"
  echo "| OpenCCU-Base | ${OPENCCU_BASE_COMMIT:-unknown} |"
  echo "| libXmlRpc/libxmlparser | ${REGA_LIBS} |"
  echo "| node.js | $(node --version) |"
  echo "| libfaketime | $(faketime --version 2>&1 | grep -o 'Version.*' || echo unknown) |"
  echo "| timezone | ${TZ:-unset} ($(date +%Z)) |"
  echo
} >"${summary}"
cat "${summary}"

"$@"
rc=$?

{
  echo "### Test suite"
  echo
  if [[ ${rc} -eq 0 ]]; then
    echo "passed"
    if [[ ${REGA_LIBS} == asan ]]; then
      echo
      echo "(faketime based timer tests are skipped, as libfaketime and the preloaded ASan runtime deadlock at ReGaHss startup)"
    fi
  else
    echo "**FAILED** (exit code ${rc})"
  fi
  echo
} >>"${summary}"

if [[ -s /etc/regahss-abi-report.txt ]]; then
  cp /etc/regahss-abi-report.txt "${RESULTS}/abi-report.txt"
  {
    echo "### ABI changes vs. prebuilt libraries (informational)"
    echo
    echo '```'
    cat /etc/regahss-abi-report.txt
    echo '```'
    echo
  } >>"${summary}"
fi

if [[ ${REGA_LIBS} == asan ]]; then
  reports=$(find "${sanitizer_dir}" -type f -size +0 | sort)
  {
    echo "### Sanitizer reports (ASan/UBSan)"
    echo
    if [[ -n ${reports} ]]; then
      echo "**$(wc -l <<<"${reports}") report(s) found:**"
      echo
      echo '```'
      for f in ${reports}; do
        echo "==> ${f##*/} <=="
        head -n 60 "${f}"
      done
      echo '```'
    else
      echo "none"
    fi
    echo
  } >>"${summary}"
  if [[ -n ${reports} ]]; then
    echo "ERROR: sanitizer reports found:" >&2
    for f in ${reports}; do
      echo "==> ${f} <==" >&2
      cat "${f}" >&2
    done
    [[ ${rc} -ne 0 ]] || rc=1
  fi

  if command -v gcovr >/dev/null; then
    mkdir -p "${RESULTS}/coverage"
    search_paths=("${LIBS_BUILD_DIR}/src/libXmlRpc" "${LIBS_BUILD_DIR}/src/libxmlparser")
    # (system headers referenced by the gcov data are not installed)
    if ! gcovr --root "${BASE_DIR}" "${search_paths[@]}" \
      --filter "${BASE_DIR}/src/" \
      --gcov-ignore-errors=source_not_found \
      --gcov-ignore-errors=no_working_dir_found \
      --txt "${RESULTS}/coverage/coverage.txt" \
      --json-summary "${RESULTS}/coverage/summary.json" \
      --html-details "${RESULTS}/coverage/index.html" \
      >"${RESULTS}/coverage/gcovr.log" 2>&1; then
      echo "ERROR: gcovr failed:" >&2
      tail -n 40 "${RESULTS}/coverage/gcovr.log" >&2
    fi
    {
      echo "### Coverage of libXmlRpc/libxmlparser"
      echo
      node "$(dirname "$0")/coverage-summary.js" "${RESULTS}/coverage/summary.json" || echo "coverage summary failed, see gcovr.log"
      echo
    } >>"${summary}"
  fi
fi

{
  echo "### Result"
  echo
  if [[ ${rc} -eq 0 ]]; then
    echo "✅ passed"
  else
    echo "❌ failed"
  fi
} >>"${summary}"

# compress the ReGaHss logs
if [[ -d ${REGA_LOG_DIR} ]]; then
  tar -C "$(dirname "${REGA_LOG_DIR}")" -czf "${REGA_LOG_DIR}.tar.gz" "$(basename "${REGA_LOG_DIR}")" && rm -rf "${REGA_LOG_DIR}"
fi

echo
cat "${summary}"
echo
echo "results written to ${RESULTS}"
exit "${rc}"
