#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

pr=${1:-${PREVIEW_PR:-}}
head=${2:-${PREVIEW_REF:-}}
actor=${PREVIEW_ACTOR:-${GITHUB_ACTOR:-}}
test -n "${pr}" && test -n "${head}" || {
  echo "usage: preview-deploy.sh <pr-number> <head-sha>" >&2
  exit 2
}
if [ -z "${actor}" ]; then
  actor=$(gh api user --jq .login)
fi

PREVIEW_ACTOR="${actor}" scripts/verify-preview-pr.sh "${pr}" "${head}"

common_git_dir=$(git rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "${common_git_dir}")
native_runtime=${ZERP_PREVIEW_RUNTIME_ROOT:-${primary_root}/backend/var/preview-native}
state_root=${ZERP_PREVIEW_STATE_ROOT:-${native_runtime}/state}
env_file=${ZERP_PREVIEW_ENV_FILE:-${primary_root}/backend/.env.preview.local}
build_root=${ZERP_PREVIEW_BUILD_ROOT:-${primary_root}/backend/var/preview-build}/${head}
mkdir -p "$(dirname "${build_root}")"

cleanup() {
  git -C "${primary_root}" worktree remove --force "${build_root}" >/dev/null 2>&1 || true
  git -C "${primary_root}" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

git -C "${primary_root}" worktree add --detach "${build_root}" "${head}"

preview_env() {
  ZERP_PREVIEW_SOURCE_ROOT="${build_root}" \
    ZERP_PREVIEW_ENV_FILE="${env_file}" \
    ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
    ZERP_PREVIEW_STATE_ROOT="${state_root}" \
    ZERP_RELEASE_SHA="${head}" \
    "$@"
}

# Build with a scrubbed environment first. Then re-read the PR before the slot
# or any mutable preview state is touched.
preview_env "${build_root}/scripts/preview.sh" build
PREVIEW_ACTOR="${actor}" scripts/verify-preview-pr.sh "${pr}" "${head}"

preview_env "${build_root}/scripts/preview.sh" stop-app
state_claimed=0
if ! PREVIEW_PR="${pr}" PREVIEW_REF="${head}" PREVIEW_ACTOR="${actor}" \
  PREVIEW_VERIFIED=1 ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
  ZERP_PREVIEW_STATE_ROOT="${state_root}" scripts/preview-state.sh claim; then
  preview_env "${build_root}/scripts/preview.sh" restart-app || true
  exit 1
fi
state_claimed=1

if ! preview_env "${build_root}/scripts/preview.sh" activate; then
  if [ "${state_claimed}" = 1 ]; then
    PREVIEW_PR="${pr}" PREVIEW_FAILURE_REASON=deploy-failed \
      ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
      ZERP_PREVIEW_STATE_ROOT="${state_root}" \
      scripts/preview-state.sh fail || true
  fi
  preview_env "${build_root}/scripts/preview.sh" restart-app || true
  exit 1
fi

echo "Preview deployed PR #${pr} commit: ${head}"
