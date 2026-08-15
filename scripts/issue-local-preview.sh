#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "${script_dir}/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
primary_root=${ZERP_PRIMARY_ROOT:-$(dirname "${common_git_dir}")}
preview_url=https://zerp-preview.bytesucceed.com

preview_id() {
  feature=$1
  checksum=$(printf '%s' "${feature}" | cksum | awk '{print $1}')
  printf '%s\n' "$((900000000 + (checksum % 99999999)))"
}

feature=${2:-${1:-}}
case "${feature}" in
  '' | *[!a-z0-9-]* | -* | *-) echo 'invalid feature slug' >&2; exit 2 ;;
esac
id=$(preview_id "${feature}")

if [ "${1:-}" = close ]; then
  [ "$#" -eq 2 ] || exit 2
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
if ! ZERP_PREVIEW_OFFLINE=1 PREVIEW_VERIFIED=1 PREVIEW_PR="${id}" PREVIEW_REF="${head_sha}" \
  PREVIEW_ACTOR=local-batch "${primary_root}/scripts/preview-state.sh" claim; then
  exit 1
fi
if ! ZERP_PREVIEW_SOURCE_ROOT="${worktree}" ZERP_RELEASE_SHA="${head_sha}" \
  "${primary_root}/scripts/preview.sh" build || \
  ! ZERP_PREVIEW_SOURCE_ROOT="${worktree}" ZERP_RELEASE_SHA="${head_sha}" \
  "${primary_root}/scripts/preview.sh" activate || \
  ! ZERP_PREVIEW_SMOKE_REPO_ROOT="${primary_root}" \
  "${primary_root}/scripts/preview-smoke.sh" "${head_sha}"; then
  PREVIEW_PR="${id}" PREVIEW_FAILURE_REASON=local-batch-preview \
    "${primary_root}/scripts/preview-state.sh" fail >/dev/null 2>&1 || true
  exit 1
fi

printf 'url=%s\n' "${preview_url}"
printf 'fingerprint=%s\n' "${fingerprint}"
