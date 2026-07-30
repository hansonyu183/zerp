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

case "${PRE_PUSH_FULL:-0}" in
  0 | 1) ;;
  *)
    echo "PRE_PUSH_FULL must be 0 or 1" >&2
    exit 2
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "pre-push requires a clean worktree; commit or isolate all changes first" >&2
  exit 1
fi

base_ref=${PRE_PUSH_BASE_REF:-origin/main}
git rev-parse --verify "${base_ref}^{commit}" >/dev/null
diff_range="${base_ref}...HEAD"

changed_files=$(git diff --name-only "${diff_range}")
if [ -z "${changed_files}" ]; then
  echo "No changes relative to ${base_ref}"
  exit 0
fi

check_matrix=$(scripts/change-impact.sh --checks "${diff_range}")
eval "${check_matrix}"

if [ "${PRE_PUSH_FULL:-0}" = "1" ]; then
  impact=application
  contracts=1
  frontend=1
  backend=1
  containers=1
  e2e=1
  local_e2e=1
  preview=1
fi

print_plan() {
  echo "Pre-push plan relative to ${base_ref}:"
  printf '  impact: %s\n' "${impact}"
  if [ "${impact}" = "application" ]; then
    printf '  contracts: %s\n' "${contracts}"
    printf '  frontend: %s\n' "${frontend}"
    printf '  backend: %s\n' "${backend}"
    printf '  containers: %s\n' "${containers}"
    printf '  PR E2E: %s\n' "${e2e}"
    printf '  local E2E: %s\n' "${local_e2e}"
    printf '  fixed preview after green CI: %s\n' "${preview}"
  fi
  if [ "${PRE_PUSH_FULL:-0}" = "1" ]; then
    echo "  override: PRE_PUSH_FULL=1"
  fi
}

run_stage() {
  stage_name=$1
  shift
  stage_started=$(date +%s)
  echo "==> ${stage_name}"
  "$@"
  stage_finished=$(date +%s)
  stage_elapsed=$((stage_finished - stage_started))
  printf '<== %s passed in %ss\n' "${stage_name}" "${stage_elapsed}"
}

check_docs() {
  printf '%s\n' "${changed_files}" |
    while IFS= read -r changed_file; do
      if [ -e "${changed_file}" ] || [ -L "${changed_file}" ]; then
        pnpm exec prettier --check "${changed_file}"
      fi
    done
  pnpm docs:check
}

check_validation() {
  pnpm format:check
  pnpm docs:check
  scripts/validation-check.sh
}

check_backend() {
  make check-backend \
    BACKEND_SKIP_GENERATED="${contracts}" \
    BACKEND_SKIP_IMAGE="${local_e2e}"
}

print_plan
if [ "${plan_only}" = "1" ]; then
  exit 0
fi

gate_started=$(date +%s)
git diff --check "${diff_range}"

case "${impact}" in
  docs)
    run_stage "documentation" check_docs
    ;;
  validation)
    run_stage "validation tooling" check_validation
    ;;
  application)
    run_stage "common checks" make check-common
    if [ "${contracts}" = "1" ]; then
      run_stage "generated contracts" make check-contracts
    fi
    if [ "${frontend}" = "1" ]; then
      run_stage "frontend quality" make check-frontend
    fi
    if [ "${backend}" = "1" ]; then
      run_stage "backend quality" check_backend
    fi
    if [ "${containers}" = "1" ]; then
      run_stage "container and release configuration" make check-containers
    fi
    if [ "${local_e2e}" = "1" ]; then
      run_stage "isolated full-stack E2E" make e2e
    fi
    ;;
  *)
    echo "Unsupported change impact: ${impact}" >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "pre-push checks changed tracked or untracked files" >&2
  git status --short >&2
  exit 1
fi

gate_finished=$(date +%s)
gate_elapsed=$((gate_finished - gate_started))
echo "Pre-push gate passed: ${impact} (${gate_elapsed}s)"
