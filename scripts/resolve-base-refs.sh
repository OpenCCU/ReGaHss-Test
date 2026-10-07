#!/bin/bash
#
# Resolves the OpenCCU-Base revisions to be tested and outputs them as a
# JSON list suitable for a GitHub Actions matrix:
#
#   main     current HEAD of the OpenCCU-Base main branch
#   release  revision OpenCCU currently builds its firmware with
#            (OPENCCU_BASE_VERSION in openccu-base.mk)
#   custom   optional additional ref (branch, tag or commit SHA) given as
#            first argument
#
# Revisions resolving to the same commit are only tested once. For each
# revision the OpenCCU-Base revision with the previous ReGaHss version is
# determined as reference for differential tests (ref_sha).
#
# Usage: resolve-base-refs.sh [extra-ref]
#
set -euo pipefail

BASE_REPO=${BASE_REPO:-https://github.com/OpenCCU/OpenCCU-Base.git}
OPENCCU_MK_URL=${OPENCCU_MK_URL:-https://raw.githubusercontent.com/OpenCCU/OpenCCU/master/buildroot-external/package/openccu-base/openccu-base.mk}
EXTRA_REF=${1:-}

# resolve a branch/tag name (or full SHA) to a commit SHA
resolve() {
  local ref=$1 sha
  if [[ ${ref} =~ ^[0-9a-f]{40}$ ]]; then
    echo "${ref}"
    return
  fi
  # prefer the peeled commit (^{}) of annotated tags
  sha=$(git ls-remote "${BASE_REPO}" "refs/heads/${ref}" "refs/tags/${ref}" "refs/tags/${ref}^{}" |
    awk '{ if ($2 ~ /\^\{\}$/) peeled=$1; else if (!first) first=$1 } END { print (peeled ? peeled : first) }')
  if [[ -z ${sha} ]]; then
    echo "ERROR: could not resolve OpenCCU-Base ref '${ref}'" >&2
    exit 1
  fi
  echo "${sha}"
}

main_sha=$(resolve main)

release_ref=$(curl -fsSL "${OPENCCU_MK_URL}" | sed -n 's/^OPENCCU_BASE_VERSION *= *//p' | tr -d '[:space:]')
if [[ -z ${release_ref} ]]; then
  echo "ERROR: could not determine OPENCCU_BASE_VERSION from ${OPENCCU_MK_URL}" >&2
  exit 1
fi
release_sha=$(resolve "${release_ref}")

entries=("main ${main_sha}" "release ${release_sha}")
if [[ -n ${EXTRA_REF} ]]; then
  entries+=("custom $(resolve "${EXTRA_REF}")")
fi

# history (without file contents) to determine the previous ReGaHss version
history=$(mktemp -d)
trap 'rm -rf "${history}"' EXIT
git clone -q --bare --filter=blob:none "${BASE_REPO}" "${history}/base.git"

# revision before the last change of the ReGaHss binary
previous_rega() {
  local last
  last=$(git -C "${history}/base.git" log -1 --format=%H "$1" -- bin/x86_64-linux-gnu/ReGaHss)
  # (none if the ReGaHss binary has no earlier version)
  if [[ -n ${last} ]]; then
    git -C "${history}/base.git" rev-parse -q --verify "${last}^" || true
  fi
}

with_refs=()
for entry in "${entries[@]}"; do
  with_refs+=("${entry} $(previous_rega "${entry#* }")")
done

# merge entries pointing to the same commit (e.g. main+release)
refs=$(printf '%s\n' "${with_refs[@]}" |
  jq -R -s -c 'split("\n") | map(select(length > 0) | split(" ") | {name: .[0], sha: .[1], ref_sha: .[2]})
               | group_by(.sha) | map({name: (map(.name) | join("+")), sha: .[0].sha, ref_sha: .[0].ref_sha})
               | sort_by(.name)')

echo "OpenCCU-Base revisions to test: ${refs}" >&2
if [[ -n ${GITHUB_OUTPUT:-} ]]; then
  echo "refs=${refs}" >>"${GITHUB_OUTPUT}"
else
  echo "${refs}"
fi
