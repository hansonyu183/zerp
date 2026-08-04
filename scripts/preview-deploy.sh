#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

preview_ref=${1:-HEAD}
release_sha=$(git rev-parse --verify "${preview_ref}^{commit}")
short_sha=$(printf '%s' "${release_sha}" | cut -c1-12)

common_git_dir=$(git rev-parse --path-format=absolute --git-common-dir)
git_root=$(dirname "${common_git_dir}")
state_root=${ZERP_PREVIEW_STATE_ROOT:-${git_root}}
runtime_root=${ZERP_PREVIEW_BUILD_ROOT:-${state_root}/backend/var/preview-build}
build_root="${runtime_root}/${short_sha}"
env_file=${ZERP_PREVIEW_ENV_FILE:-${state_root}/backend/.env.preview.local}
native_runtime=${ZERP_PREVIEW_RUNTIME_ROOT:-${state_root}/backend/var/preview-native}

test -f "${env_file}" || {
  echo "Missing preview environment: ${env_file}" >&2
  exit 1
}

mkdir -p "${runtime_root}"

cleanup() {
  git -C "${git_root}" worktree remove --force "${build_root}" >/dev/null 2>&1 || true
  git -C "${git_root}" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cleanup
git -C "${git_root}" worktree add --detach "${build_root}" "${release_sha}"

ZERP_PREVIEW_SOURCE_ROOT="${build_root}" \
ZERP_PREVIEW_ENV_FILE="${env_file}" \
ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
ZERP_RELEASE_SHA="${release_sha}" \
  "${build_root}/scripts/preview.sh" up

echo "Preview deployed commit: ${release_sha}"
