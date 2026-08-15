#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "${script_dir}/.." && pwd)
primary_root=${ZERP_PRIMARY_ROOT:-${repo_root}}
repo=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
gh_bin=${ZERP_GH_BIN:-gh}

[ "$#" -eq 2 ] || { echo "usage: $0 <pr-number> <merge-sha>" >&2; exit 2; }
pr=$1
merge_sha=$2
pr_json=$("${gh_bin}" pr view "${pr}" --repo "${repo}" --json state,mergeCommit)
[ "$(printf '%s' "${pr_json}" | jq -r .state)" = MERGED ] || {
  echo "PR #${pr} is not merged" >&2
  exit 1
}
[ "$(printf '%s' "${pr_json}" | jq -r '.mergeCommit.oid // ""')" = "${merge_sha}" ] || {
  echo "PR #${pr} merge SHA changed" >&2
  exit 1
}

attempts=${ZERP_PRODUCTION_WAIT_ATTEMPTS:-120}
delay=${ZERP_PRODUCTION_WAIT_SECONDS:-15}
last_output=
while [ "${attempts}" -gt 0 ]; do
  if last_output=$("${primary_root}/scripts/production-status.sh" 2>&1) && \
    printf '%s\n' "${last_output}" | grep -Fq "Production release: ${merge_sha}"; then
    printf '%s\n' "${last_output}"
    printf 'sha=%s\n' "${merge_sha}"
    exit 0
  fi
  attempts=$((attempts - 1))
  [ "${attempts}" -eq 0 ] || sleep "${delay}"
done
printf '%s\n' "${last_output}" >&2
echo "production did not reach verified merge ${merge_sha}" >&2
exit 1
