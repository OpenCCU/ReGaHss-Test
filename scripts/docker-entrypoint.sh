#!/bin/bash
#
# Entrypoint of the ReGaHss-Test docker image: prints the versions of the
# components under test, executes the given command (default: test suite)
# and afterwards evaluates the test results (JUnit report), core dumps,
# sanitizer reports and library coverage (asan variant). A markdown summary
# plus all reports are written to REGA_RESULTS_DIR (default: /results, mount
# it to keep the results).
#
set -uo pipefail

# shellcheck source=/dev/null
[[ -r /etc/regahss-test.info ]] && source /etc/regahss-test.info

REGA_LIBS=${REGA_LIBS:-prebuilt}
RESULTS=${REGA_RESULTS_DIR:-/results}
LIBS_BUILD_DIR=/opt/regahss-libs/build
BASE_DIR=/opt/openccu-base

export REGA_BIN=${REGA_BIN:-/bin/ReGaHss}
# speed of the faked clock for the timer tests (real time for the 32-bit
# ReGaHss, as libfaketime does not accelerate the waits of its timer thread)
if [[ -z ${REGA_FAKETIME_RATE:-} ]]; then
  [[ ${REGA_ARCH:-} == i686-linux-gnu ]] && REGA_FAKETIME_RATE=1 || REGA_FAKETIME_RATE=10
fi
export REGA_FAKETIME_RATE
export REGA_LABEL=${REGA_LABEL:-${REGA_ARCH:-unknown}@${OPENCCU_BASE_COMMIT:0:7}/${REGA_LIBS}}

mkdir -p "${RESULTS}"
summary=${RESULTS}/summary.md

# keep the output of each ReGaHss instance
export REGA_LOG_DIR=${REGA_LOG_DIR:-${RESULTS}/logs}
rm -rf "${REGA_LOG_DIR}"

# JUnit report of the test suite
export REGA_JUNIT_FILE=${REGA_JUNIT_FILE:-${RESULTS}/junit.xml}
rm -f "${REGA_JUNIT_FILE}"

# working directories of the ReGaHss instances, which also receive core dumps
# of ReGaHss if the kernel.core_pattern of the host is a relative file name
# (e.g. 'core.%e.%p') and core dumps are enabled ('docker run --ulimit core=-1')
export REGA_WORK_DIR=${REGA_WORK_DIR:-/tmp/regahss-test}
cores_dir=${RESULTS}/cores
rm -rf "${REGA_WORK_DIR}" "${cores_dir}"
ulimit -c unlimited 2>/dev/null || true

# reference ReGaHss for differential tests of the script corpus
REF_DIR=/opt/regahss-ref
ref_version=""
if [[ -z ${REGA_REF_BIN:-} && -x ${REF_DIR}/ReGaHss ]]; then
  export REGA_REF_BIN=${REF_DIR}/ReGaHss
  export REGA_REF_LIB_DIR=${REF_DIR}
fi
if [[ -n ${REGA_REF_BIN:-} ]]; then
  export REGA_DIFF_REPORT=${REGA_DIFF_REPORT:-${RESULTS}/differential.md}
  rm -f "${REGA_DIFF_REPORT}"
  ref_version=$(LD_LIBRARY_PATH=${REGA_REF_LIB_DIR:-} timeout 30 "${REGA_REF_BIN}" -h 2>&1 | grep -m1 -o 'ReGaHss R[0-9.]*.*' || echo unknown)
  ref_version="${ref_version} (OpenCCU-Base $(cat "${REF_DIR}/commit" 2>/dev/null || echo unknown))"
fi

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
  if [[ -n ${ref_version} ]]; then
    echo "| reference ReGaHss | ${ref_version} |"
  fi
  echo "| libXmlRpc/libxmlparser | ${REGA_LIBS} |"
  echo "| node.js | $(node --version) |"
  echo "| libfaketime | $(faketime --version 2>&1 | grep -o 'Version.*' || echo unknown) (clock rate x${REGA_FAKETIME_RATE} for timer tests) |"
  echo "| timezone | ${TZ:-unset} ($(date +%Z)) |"
  echo "| parallel jobs | ${REGA_JOBS:-1} |"
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
  else
    echo "**FAILED** (exit code ${rc})"
  fi
  echo
  if [[ -s ${REGA_JUNIT_FILE} ]]; then
    node "$(dirname "$0")/junit-summary.js" "${REGA_JUNIT_FILE}" || echo "JUnit summary failed"
    echo
  fi
  if [[ ${REGA_LIBS} == asan ]]; then
    echo "(faketime based timer tests are skipped, as libfaketime and the preloaded ASan runtime deadlock at ReGaHss startup)"
    echo
  fi
} >>"${summary}"

# core dumps of crashed ReGaHss processes (incl. backtraces)
mapfile -t cores < <(find "${REGA_WORK_DIR}" -type f -name 'core*' 2>/dev/null | sort)
if [[ ${#cores[@]} -gt 0 ]]; then
  mkdir -p "${cores_dir}"
  {
    echo "### Core dumps"
    echo
    echo "**${#cores[@]} core dump(s) found:**"
    echo
    for core in "${cores[@]}"; do
      name=$(basename "$(dirname "${core}")")-$(basename "${core}")
      mv "${core}" "${cores_dir}/${name}"
      gdb -q -batch -ex 'info sharedlibrary' -ex 'thread apply all bt' "${REGA_BIN}" "${cores_dir}/${name}" >"${cores_dir}/${name}.txt" 2>&1
      echo "<details><summary>${name}</summary>"
      echo
      echo '```'
      grep -v '^\[New LWP' "${cores_dir}/${name}.txt" | head -n 80
      echo '```'
      echo "</details>"
      echo
    done
  } >>"${summary}"
  cp "${REGA_BIN}" "${cores_dir}/"
  echo "ERROR: ${#cores[@]} core dump(s) of ReGaHss found in ${cores_dir}" >&2
  [[ ${rc} -ne 0 ]] || rc=1
fi

if [[ -n ${ref_version} ]]; then
  {
    echo "### Script corpus: differences to the reference ReGaHss (informational)"
    echo
    if [[ -s ${REGA_DIFF_REPORT} ]]; then
      cat "${REGA_DIFF_REPORT}"
    else
      echo "no differential report written"
    fi
    echo
  } >>"${summary}"
fi

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
