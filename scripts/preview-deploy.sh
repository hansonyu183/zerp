#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

preview_ref=${1:-}
case "${preview_ref}" in
  '' | *[!0-9a-f]*)
    echo "Preview ref must be the full lowercase SHA of the current dev commit" >&2
    exit 2
    ;;
esac
sha_length=$(printf '%s' "${preview_ref}" | wc -c | tr -d ' ')
test "${sha_length}" = 40 || {
  echo "Preview ref must be the full lowercase SHA of the current dev commit" >&2
  exit 2
}

git fetch origin dev --prune
release_sha=$(git rev-parse --verify "${preview_ref}^{commit}")
dev_sha=$(git rev-parse --verify 'origin/dev^{commit}')
test "${release_sha}" = "${dev_sha}" || {
  echo "Preview ref ${release_sha} is not the current origin/dev commit ${dev_sha}" >&2
  exit 1
}

GITHUB_REPOSITORY=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp} \
GITHUB_SHA=${release_sha} \
ZERP_MERGED_BASE_REF=dev \
  scripts/verify-merged-pr.sh
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
