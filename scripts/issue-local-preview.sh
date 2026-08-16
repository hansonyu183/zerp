#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "${script_dir}/.." && pwd)
if [ -n "${ZERP_PRIMARY_ROOT:-}" ]; then
  primary_root=${ZERP_PRIMARY_ROOT}
else
  common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
  primary_root=$(dirname "${common_git_dir}")
fi
preview_url=https://zerp-preview.bytesucceed.com

preview_id() {
  feature=$1
  checksum=$(printf '%s' "${feature}" | cksum | awk '{print $1}')
  printf '%s\n' "$((900000000 + (checksum % 99999999)))"
}

if [ "${1:-}" = close ]; then feature=${2:-}; else feature=${1:-}; fi
case "${feature}" in
  '' | *[!a-z0-9-]* | -* | *-) echo 'invalid feature slug' >&2; exit 2 ;;
esac
id=$(preview_id "${feature}")

if [ "${1:-}" = close ]; then
  [ "$#" -eq 2 ] || exit 2
  active=$(PREVIEW_PR="${id}" "${primary_root}/scripts/preview-state.sh" status |
    sed -n 's/^active=//p')
  [ "${active}" = "${id}" ] || exit 0
  PREVIEW_PR="${id}" "${primary_root}/scripts/preview.sh" close
  exit
fi

[ "$#" -eq 2 ] || { echo "usage: $0 <feature> <head-sha> | close <feature>" >&2; exit 2; }
head_sha=$2
worktree=${ZERP_ISSUE_WORKTREE:?ZERP_ISSUE_WORKTREE is required}
case "${head_sha}" in *[!0-9a-f]*) echo 'invalid preview SHA' >&2; exit 2 ;; esac
[ "${#head_sha}" -eq 40 ] || { echo 'preview SHA must be full length' >&2; exit 2; }
[ "$(git -C "${worktree}" rev-parse HEAD)" = "${head_sha}" ] || {
  echo 'preview worktree does not match candidate SHA' >&2
  exit 1
}

fingerprint=$(ZERP_FINGERPRINT_REPO_ROOT="${worktree}" \
  "${script_dir}/runtime-fingerprint.sh" "${head_sha}")
apps_stopped=0
claim_started=0
claim_active=0
preview_complete=0

preview_exit() {
  result=$1
  trap - EXIT HUP INT TERM
  if [ "${preview_complete}" = 1 ]; then exit "${result}"; fi
  set +e
  recovery_result=0
  if [ "${claim_started}" = 1 ] && [ "${claim_active}" != 1 ]; then
    status_output=$(PREVIEW_PR="${id}" "${primary_root}/scripts/preview-state.sh" status 2>&1)
    printf '%s\n' "${status_output}" >&2
    active=$(printf '%s\n' "${status_output}" | sed -n 's/^active=//p')
    [ "${active}" = "${id}" ] && claim_active=1
  fi
  if [ "${claim_active}" = 1 ]; then
    PREVIEW_PR="${id}" "${primary_root}/scripts/preview.sh" close >&2
    close_result=$?
    PREVIEW_PR="${id}" PREVIEW_FAILURE_REASON=local-batch-preview \
      "${primary_root}/scripts/preview-state.sh" fail >&2
    fail_result=$?
    if [ "${close_result}" -ne 0 ]; then
      "${primary_root}/scripts/preview.sh" restart-app >&2
      restart_result=$?
    else
      restart_result=0
    fi
    if [ "${close_result}" -ne 0 ] || [ "${fail_result}" -ne 0 ] ||
      [ "${restart_result}" -ne 0 ]; then recovery_result=1; fi
  elif [ "${apps_stopped}" = 1 ]; then
    "${primary_root}/scripts/preview.sh" restart-app >&2 || recovery_result=$?
  fi
  if [ "${result}" -eq 0 ] && [ "${recovery_result}" -ne 0 ]; then result=1; fi
  exit "${result}"
}
trap 'preview_exit $?' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if ! "${primary_root}/scripts/preview.sh" prepare-db >&2; then
  exit 1
fi
if ! ZERP_PREVIEW_SOURCE_ROOT="${worktree}" ZERP_RELEASE_SHA="${head_sha}" \
  "${primary_root}/scripts/preview.sh" build >&2; then
  exit 1
fi
apps_stopped=1
if ! "${primary_root}/scripts/preview.sh" stop-app >&2; then
  exit 1
fi
claim_started=1
if ! ZERP_PREVIEW_OFFLINE=1 PREVIEW_VERIFIED=1 PREVIEW_PR="${id}" PREVIEW_REF="${head_sha}" \
  PREVIEW_ACTOR=local-batch "${primary_root}/scripts/preview-state.sh" claim >&2; then
  exit 1
fi
claim_active=1
if ! ZERP_PREVIEW_SOURCE_ROOT="${worktree}" ZERP_RELEASE_SHA="${head_sha}" \
  "${primary_root}/scripts/preview.sh" activate >&2 || \
  ! ZERP_PREVIEW_SMOKE_REPO_ROOT="${primary_root}" \
  "${primary_root}/scripts/preview-smoke.sh" "${head_sha}" >&2; then
  exit 1
fi

preview_complete=1
printf 'url=%s\n' "${preview_url}"
printf 'fingerprint=%s\n' "${fingerprint}"
