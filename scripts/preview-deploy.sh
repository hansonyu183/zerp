#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

# The operator must launch the control plane from an exact main checkout. The
# PR worktree is untrusted input and is never allowed to choose executable
# orchestration code that receives preview credentials.
git fetch origin main --quiet
controller_sha=$(git rev-parse HEAD)
trusted_sha=$(git rev-parse FETCH_HEAD)
test "${controller_sha}" = "${trusted_sha}" || {
  echo "Run preview deployment from a trusted checkout of current origin/main" >&2
  exit 1
}
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Trusted preview control checkout has tracked modifications" >&2
  exit 1
fi

pr=${1:-${PREVIEW_PR:-}}
head=${2:-${PREVIEW_REF:-}}
actor=${PREVIEW_ACTOR:-${GITHUB_ACTOR:-}}
if [ -z "${pr}" ] || [ -z "${head}" ]; then
  echo "usage: preview-deploy.sh <pr-number> <head-sha>" >&2
  exit 2
fi
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
    "${repo_root}/scripts/preview.sh" "$@"
}

# Build with a scrubbed environment first. Then re-read the PR before the slot
# or any mutable preview state is touched.
preview_env build

# The first native-state adoption may not have a cached release for its main
# baseline yet. Build that trusted baseline once so close/reap can always switch
# both data and code back atomically.
baseline_kind=$(sed -n 's/^kind=//p' "${state_root}/current")
baseline_sha=$(sed -n 's/^sha=//p' "${state_root}/current")
if [ "${baseline_kind}" = baseline ] && [ ! -d "${native_runtime}/releases/${baseline_sha}" ]; then
  test "${baseline_sha}" = "${controller_sha}" || {
    echo "Missing cached release for non-current baseline ${baseline_sha}" >&2
    exit 1
  }
  ZERP_PREVIEW_SOURCE_ROOT="${repo_root}" \
    ZERP_PREVIEW_ENV_FILE="${env_file}" \
    ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
    ZERP_PREVIEW_STATE_ROOT="${state_root}" \
    ZERP_RELEASE_SHA="${baseline_sha}" \
    "${repo_root}/scripts/preview.sh" build
fi
PREVIEW_ACTOR="${actor}" scripts/verify-preview-pr.sh "${pr}" "${head}"

preview_env stop-app
state_claimed=0
if ! PREVIEW_PR="${pr}" PREVIEW_REF="${head}" PREVIEW_ACTOR="${actor}" \
  PREVIEW_VERIFIED=1 ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
  ZERP_PREVIEW_STATE_ROOT="${state_root}" scripts/preview-state.sh claim; then
  preview_env restart-app || true
  exit 1
fi
state_claimed=1

if ! preview_env activate; then
  if [ "${state_claimed}" = 1 ]; then
    PREVIEW_PR="${pr}" PREVIEW_FAILURE_REASON=deploy-failed \
      ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
      ZERP_PREVIEW_STATE_ROOT="${state_root}" \
      scripts/preview-state.sh fail || true
  fi
  preview_env restart-app || true
  exit 1
fi

echo "Preview deployed PR #${pr} commit: ${head}"
