#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

plan_only=0
fast_only=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan) plan_only=1; shift ;;
    --fast) fast_only=1; shift ;;
    *) break ;;
  esac
done
[ "$#" -eq 1 ] || { echo "usage: scripts/change-gate.sh [--plan] [--fast] <base-ref>" >&2; exit 2; }
base_ref=$1

case "${PRE_PUSH_FULL:-0}" in
  0 | 1) ;;
  *) echo "PRE_PUSH_FULL must be 0 or 1" >&2; exit 2 ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "change gate requires a clean worktree" >&2
  exit 1
fi
git rev-parse --verify "${base_ref}^{commit}" >/dev/null
git merge-base --is-ancestor "${base_ref}" HEAD || {
  echo "HEAD must descend from ${base_ref}" >&2
  exit 1
}
if git rev-list --merges "${base_ref}..HEAD" | grep -q .; then
  echo "feature branches must be rebased, not merged" >&2
  exit 1
fi

diff_range="${base_ref}...HEAD"
changed_files=$(git diff --name-only "${diff_range}")
if [ -z "${changed_files}" ]; then
  echo "No changes relative to ${base_ref}"
  exit 0
fi

check_matrix=$(scripts/change-impact.sh --checks "${diff_range}")
eval "${check_matrix}"
if [ "${PRE_PUSH_FULL:-0}" = 1 ]; then
  impact=application
  contracts=1
  frontend=1
  frontend_audit=1
  frontend_full=1
  backend=1
  backend_full=1
  backend_deps=1
  containers=1
  api_image=1
  web_image=1
  e2e=1
  local_e2e=1
  preview=1
fi

print_plan() {
  echo "Change gate plan relative to ${base_ref}:"
  [ "${fast_only}" != 1 ] || echo '  mode: fast deterministic checks only'
  printf '  impact: %s\n' "${impact}"
  if [ "${impact}" = application ]; then
    printf '  contracts: %s\n' "${contracts}"
    printf '  frontend: %s\n' "${frontend}"
    printf '  frontend dependency audit: %s\n' "${frontend_audit}"
    printf '  frontend full gate: %s\n' "${frontend_full}"
    printf '  backend: %s\n' "${backend}"
    printf '  backend full integration/race: %s\n' "${backend_full}"
    printf '  backend dependency integrity: %s\n' "${backend_deps}"
    printf '  containers: %s\n' "${containers}"
    printf '  API image: %s\n' "${api_image}"
    printf '  Web image: %s\n' "${web_image}"
    printf '  PR E2E: %s\n' "${e2e}"
    printf '  local E2E: %s\n' "${local_e2e}"
    printf '  public preview: %s\n' "${preview}"
  fi
  [ "${PRE_PUSH_FULL:-0}" != 1 ] || echo '  override: PRE_PUSH_FULL=1'
}

run_stage() {
  stage_name=$1
  shift
  stage_started=$(date +%s)
  echo "==> ${stage_name}"
  "$@"
  stage_finished=$(date +%s)
  printf '<== %s passed in %ss\n' "${stage_name}" "$((stage_finished - stage_started))"
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
  scripts/test-release-flow-transition.sh
  check_changed_validation
}

changed_path_matches() {
  pattern=$1
  printf '%s\n' "${changed_files}" | grep -Eq "${pattern}"
}

check_changed_validation() {
  if [ "${impact}" = application ] && changed_path_matches \
    '^(Makefile|scripts/change-impact\.sh|scripts/test-release-flow-transition\.sh)$'; then
    scripts/test-release-flow-transition.sh
  fi
  if changed_path_matches '^scripts/issue-local(-test)?\.sh$'; then
    scripts/issue-local-test.sh
  fi
  if changed_path_matches '^(backend/Makefile|backend/scripts/run-integration-tests(-test)?\.sh)$'; then
    backend/scripts/run-integration-tests-test.sh
  fi
  if changed_path_matches '^scripts/pre-push(-test)?\.sh$'; then
    scripts/pre-push-test.sh
  fi
  if [ "${local_e2e}" != 1 ] && changed_path_matches '^frontend/(playwright\.config\.ts|scripts/(check-e2e-constraints(\.test)?|preview-smoke)\.mjs|tests/e2e/)'; then
    make check-e2e-constraints
  fi
}

check_backend() {
  if [ "${backend_full}" = 1 ]; then
    make check-backend BACKEND_SKIP_GENERATED="${contracts}" BACKEND_SKIP_IMAGE=1
  else
    make check-backend-fast
  fi
}

print_plan
[ "${plan_only}" = 0 ] || exit 0
gate_started=$(date +%s)
git diff --check "${diff_range}"

if [ "${impact}" = application ] && changed_path_matches \
  '^(Makefile|scripts/(change-impact|test-release-flow-transition|issue-local|issue-local-test|pre-push|pre-push-test)\.sh|frontend/scripts/(check-e2e-constraints(\.test)?|preview-smoke)\.mjs)'; then
  run_stage 'changed validation tooling' check_changed_validation
fi

case "${impact}" in
  docs) run_stage documentation check_docs ;;
  validation) run_stage 'validation tooling' check_validation ;;
  application)
    run_stage 'common checks' make check-common
    [ "${contracts}" != 1 ] || run_stage 'generated contracts' make check-contracts
    if [ "${fast_only}" = 1 ]; then
      [ "${frontend}" != 1 ] || run_stage 'frontend fast quality' make check-frontend-fast
      [ "${backend}" != 1 ] || run_stage 'backend fast quality' make check-backend-fast
    else
      [ "${frontend}" != 1 ] || run_stage 'frontend quality' make check-frontend
      [ "${backend}" != 1 ] || run_stage 'backend quality' check_backend
      [ "${containers}" != 1 ] || run_stage 'container and release configuration' make check-runtime
      [ "${local_e2e}" != 1 ] || run_stage 'isolated full-stack E2E' make e2e
    fi
    ;;
  *) echo "Unsupported change impact: ${impact}" >&2; exit 1 ;;
esac

[ -z "$(git status --porcelain)" ] || {
  echo "change gate modified the worktree" >&2
  git status --short >&2
  exit 1
}

head_sha=$(git rev-parse HEAD)
base_sha=$(git rev-parse "${base_ref}^{commit}")
if [ "${fast_only}" = 1 ]; then
  if [ -n "${ZERP_GATE_EVIDENCE_FILE:-}" ]; then
    jq -n --arg head "${head_sha}" --arg base "${base_sha}" --arg impact "${impact}" \
      '{version:1,status:"passed",mode:"fast",head:$head,base:$base,impact:$impact}' \
      >"${ZERP_GATE_EVIDENCE_FILE}.new"
    mv "${ZERP_GATE_EVIDENCE_FILE}.new" "${ZERP_GATE_EVIDENCE_FILE}"
  fi
  gate_finished=$(date +%s)
  printf 'Fast change gate passed: %s (%ss)\n' "${impact}" "$((gate_finished - gate_started))"
  exit 0
fi
runtime_fingerprint=$(scripts/runtime-fingerprint.sh HEAD)
if [ -n "${ZERP_GATE_EVIDENCE_FILE:-}" ]; then
  jq -n --arg head "${head_sha}" --arg base "${base_sha}" \
    --arg runtime_fingerprint "${runtime_fingerprint}" --argjson preview "${preview}" \
    '{status:"passed",head:$head,base:$base,runtimeFingerprint:$runtime_fingerprint,previewRequired:($preview == 1)}' \
    >"${ZERP_GATE_EVIDENCE_FILE}.new"
  mv "${ZERP_GATE_EVIDENCE_FILE}.new" "${ZERP_GATE_EVIDENCE_FILE}"
fi
gate_finished=$(date +%s)
printf 'Change gate passed: %s (%ss)\n' "${impact}" "$((gate_finished - gate_started))"
