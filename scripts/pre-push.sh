#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

plan_only=0
case "${1:-}" in
  '')
    ;;
  --plan)
    plan_only=1
    ;;
  *)
    echo "usage: scripts/pre-push.sh [--plan]" >&2
    exit 2
    ;;
esac

git fetch origin main --prune
if [ "${plan_only}" = 1 ]; then
  exec "${repo_root}/scripts/change-gate.sh" --plan origin/main
fi

head_sha=$(git rev-parse HEAD)
base_sha=$(git rev-parse 'origin/main^{commit}')
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
evidence_dir="${git_common_dir}/zerp/pre-push-gates"
evidence_file="${evidence_dir}/${head_sha}.json"
lock_dir="${evidence_file}.lock"
mkdir -p "${evidence_dir}"

if [ -e "${evidence_file}" ]; then
  jq -e --arg head "${head_sha}" '
    .status == "passed" and .head == $head
  ' "${evidence_file}" >/dev/null 2>&1 || {
    echo "invalid final gate evidence for ${head_sha}; refusing to overwrite it" >&2
    exit 1
  }
  echo "reusing final gate evidence for exact head ${head_sha}"
  exit 0
fi

mkdir "${lock_dir}" 2>/dev/null || {
  echo "final gate is already running for exact head ${head_sha}" >&2
  exit 1
}
cleanup_lock() {
  rmdir "${lock_dir}" 2>/dev/null || true
}
trap cleanup_lock EXIT HUP INT TERM

"${repo_root}/scripts/change-gate.sh" origin/main

[ "$(git rev-parse HEAD)" = "${head_sha}" ] &&
  [ "$(git rev-parse 'origin/main^{commit}')" = "${base_sha}" ] || {
  echo 'HEAD or origin/main changed during the final gate; evidence was not recorded' >&2
  exit 1
}
jq -n --arg head "${head_sha}" --arg base "${base_sha}" \
  '{status:"passed",head:$head,base:$base}' >"${evidence_file}.new"
mv "${evidence_file}.new" "${evidence_file}"
