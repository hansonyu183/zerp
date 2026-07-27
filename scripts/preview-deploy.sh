#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

preview_ref=${1:-HEAD}
release_sha=$(git rev-parse --verify "${preview_ref}^{commit}")
short_sha=$(printf '%s' "${release_sha}" | cut -c1-12)

common_git_dir=$(git rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "${common_git_dir}")
runtime_root="${primary_root}/backend/var/preview-build"
build_root="${runtime_root}/${short_sha}"
env_file="${primary_root}/backend/.env.preview.local"

test -f "${env_file}" || {
  echo "Missing preview environment: ${env_file}" >&2
  exit 1
}

mkdir -p "${runtime_root}"

cleanup() {
  git -C "${primary_root}" worktree remove --force "${build_root}" >/dev/null 2>&1 || true
  git -C "${primary_root}" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
git -C "${primary_root}" worktree add --detach "${build_root}" "${release_sha}"

ZERP_PREVIEW_SOURCE_ROOT="${build_root}" \
ZERP_PREVIEW_ENV_FILE="${env_file}" \
ZERP_RELEASE_SHA="${release_sha}" \
  "${build_root}/scripts/preview.sh" up

echo "Preview deployed commit: ${release_sha}"
