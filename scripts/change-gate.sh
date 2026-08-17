#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

plan_only=0
fast_only=0
validation_mode=release
previous_evidence=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan) plan_only=1; shift ;;
    --fast) fast_only=1; shift ;;
    --baseline) validation_mode=baseline; shift ;;
    --reverify)
      [ "$#" -ge 2 ] || { echo '--reverify requires previous evidence' >&2; exit 2; }
      validation_mode=reverify
      previous_evidence=$2
      shift 2
      ;;
    --release) validation_mode=release; shift ;;
    *) break ;;
  esac
done
[ "$#" -eq 1 ] || {
  echo "usage: scripts/change-gate.sh [--plan] [--fast|--baseline|--reverify <evidence>|--release] <base-ref>" >&2
  exit 2
}
base_ref=$1
[ "${fast_only}" != 1 ] || [ "${validation_mode}" = release ] || {
  echo '--fast cannot be combined with a validation lifecycle mode' >&2
  exit 2
}
[ "${validation_mode}" != reverify ] || [ -r "${previous_evidence}" ] || {
  echo "previous validation evidence is not readable: ${previous_evidence}" >&2
  exit 2
}

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
  [ "${fast_only}" = 1 ] || printf '  mode: %s\n' "${validation_mode}"
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
  if changed_path_matches '^scripts/change-gate(-test)?\.sh$'; then
    scripts/change-gate-test.sh
  fi
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

check_clean_worktree() {
  [ -z "$(git status --porcelain)" ] || {
    echo 'validation stage modified the worktree' >&2
    git status --short >&2
    return 1
  }
}

validation_stage_file=
validation_failed=0
delta_impact=docs
delta_contracts=0
delta_frontend=0
delta_backend=0
delta_containers=0
delta_local_e2e=0

append_validation_stage() {
  stage_id=$1
  stage_status=$2
  verified_head=${3:-}
  blocked_by=${4:-'[]'}
  retained=${5:-false}
  jq -nc --arg id "${stage_id}" --arg status "${stage_status}" \
    --arg verified_head "${verified_head}" --argjson blocked_by "${blocked_by}" \
    --argjson retained "${retained}" '
    {id:$id,status:$status} +
    (if $verified_head == "" then {} else {verifiedHead:$verified_head} end) +
    (if ($blocked_by | length) == 0 then {} else {blockedBy:$blocked_by} end) +
    (if $retained then {retained:true} else {} end)
  ' >>"${validation_stage_file}"
}

run_validation_stage() {
  stage_id=$1
  stage_name=$2
  shift 2
  stage_started=$(date +%s)
  echo "==> ${stage_name}"
  if "$@"; then
    stage_finished=$(date +%s)
    printf '<== %s passed in %ss\n' "${stage_name}" "$((stage_finished - stage_started))"
    append_validation_stage "${stage_id}" passed "$(git rev-parse HEAD)"
    return 0
  else
    stage_result=$?
  fi
  stage_finished=$(date +%s)
  printf '<== %s failed in %ss\n' "${stage_name}" "$((stage_finished - stage_started))" >&2
  append_validation_stage "${stage_id}" failed "$(git rev-parse HEAD)"
  validation_failed=1
  return "${stage_result}"
}

write_validation_evidence() {
  evidence_mode=$1
  evidence_status=passed
  [ "${validation_failed}" = 0 ] || evidence_status=failed
  head_sha=$(git rev-parse HEAD)
  base_sha=$(git rev-parse "${base_ref}^{commit}")
  runtime_fingerprint=
  if [ "${evidence_status}" = passed ]; then
    runtime_fingerprint=$(scripts/runtime-fingerprint.sh HEAD)
  fi
  stages=$(jq -s '.' "${validation_stage_file}")
  jq -n --arg status "${evidence_status}" --arg mode "${evidence_mode}" \
    --arg head "${head_sha}" --arg base "${base_sha}" --arg impact "${impact}" \
    --arg runtime_fingerprint "${runtime_fingerprint}" --argjson preview "${preview}" \
    --argjson stages "${stages}" '
    {version:1,status:$status,mode:$mode,head:$head,base:$base,impact:$impact,
      previewRequired:($preview == 1),stages:$stages} +
    (if $runtime_fingerprint == "" then {} else {runtimeFingerprint:$runtime_fingerprint} end)
  ' >"${ZERP_GATE_EVIDENCE_FILE}.new"
  mv "${ZERP_GATE_EVIDENCE_FILE}.new" "${ZERP_GATE_EVIDENCE_FILE}"
}

stage_was_present() {
  stage_id=$1
  jq -e --arg id "${stage_id}" 'any(.stages[]; .id == $id)' \
    "${previous_evidence}" >/dev/null
}

stage_is_delta_impacted() {
  stage_id=$1
  case "${stage_id}" in
    diff | common | worktree) return 0 ;;
    validation) [ "${delta_impact}" = validation ] ;;
    docs) [ "${delta_impact}" = docs ] ;;
    contracts) [ "${delta_contracts}" = 1 ] ;;
    frontend) [ "${delta_frontend}" = 1 ] ;;
    backend) [ "${delta_backend}" = 1 ] ;;
    runtime) [ "${delta_containers}" = 1 ] ;;
    e2e) [ "${delta_local_e2e}" = 1 ] ;;
    *) return 1 ;;
  esac
}

stage_needs_reverify() {
  stage_id=$1
  if stage_was_present "${stage_id}"; then
    previous_status=$(jq -r --arg id "${stage_id}" \
      '.stages[] | select(.id == $id) | .status' "${previous_evidence}")
    [ "${previous_status}" != passed ] && return 0
  fi
  stage_is_delta_impacted "${stage_id}"
}

retain_validation_stage() {
  stage_id=$1
  jq -c --arg id "${stage_id}" '
    .stages[] | select(.id == $id) | . + {retained:true}
  ' "${previous_evidence}" >>"${validation_stage_file}"
}

print_plan
[ "${plan_only}" = 0 ] || exit 0
gate_started=$(date +%s)

if [ "${validation_mode}" = baseline ] || [ "${validation_mode}" = reverify ]; then
  [ -n "${ZERP_GATE_EVIDENCE_FILE:-}" ] || {
    echo 'baseline and reverify require ZERP_GATE_EVIDENCE_FILE' >&2
    exit 2
  }
  validation_stage_file=$(mktemp "${TMPDIR:-/tmp}/zerp-validation-stages.XXXXXX")
  cleanup_validation_stage_file() { rm -f "${validation_stage_file}"; }
  trap cleanup_validation_stage_file EXIT HUP INT TERM

  if [ "${validation_mode}" = baseline ]; then
    run_validation_stage diff 'patch whitespace' git diff --check "${diff_range}" || true
    case "${impact}" in
      docs) run_validation_stage docs documentation check_docs || true ;;
      validation) run_validation_stage validation 'validation tooling' check_validation || true ;;
      application)
        if changed_path_matches \
          '^(Makefile|scripts/(change-gate(-test)?|change-impact|test-release-flow-transition|issue-local|issue-local-test|pre-push|pre-push-test)\.sh|frontend/scripts/(check-e2e-constraints(\.test)?|preview-smoke)\.mjs)'; then
          run_validation_stage validation 'changed validation tooling' check_changed_validation || true
        fi
        run_validation_stage common 'common checks' make check-common || true
        [ "${contracts}" != 1 ] || \
          run_validation_stage contracts 'generated contracts' make check-contracts || true
        [ "${frontend}" != 1 ] || \
          run_validation_stage frontend 'frontend quality' make check-frontend || true
        [ "${backend}" != 1 ] || \
          run_validation_stage backend 'backend quality' check_backend || true
        [ "${containers}" != 1 ] || \
          run_validation_stage runtime 'container and release configuration' make check-runtime || true
        if [ "${local_e2e}" = 1 ]; then
          blocked_by=$(jq -sc '[.[] | select(
            (.id == "contracts" or .id == "frontend" or .id == "backend" or .id == "runtime") and
            .status != "passed") | .id]' "${validation_stage_file}")
          if [ "${blocked_by}" = '[]' ]; then
            run_validation_stage e2e 'isolated full-stack E2E' make e2e || true
          else
            append_validation_stage e2e blocked '' "${blocked_by}"
            validation_failed=1
            printf '<== isolated full-stack E2E blocked by %s\n' \
              "$(printf '%s' "${blocked_by}" | jq -r 'join(",")')" >&2
          fi
        fi
        ;;
      *) echo "Unsupported change impact: ${impact}" >&2; exit 1 ;;
    esac
    run_validation_stage worktree 'clean worktree' check_clean_worktree || true
    write_validation_evidence baseline
  else
    jq -e --arg base "$(git rev-parse "${base_ref}^{commit}")" '
      .version == 1 and (.mode == "baseline" or .mode == "reverify") and
      .base == $base and (.head | type == "string" and length == 40) and
      (.stages | type == "array" and length > 0) and
      all(.stages[];
        (.id | type == "string" and length > 0) and
        (.status == "passed" or .status == "failed" or .status == "blocked"))
    ' "${previous_evidence}" >/dev/null || {
      echo 'previous validation evidence is invalid' >&2
      exit 2
    }
    previous_head=$(jq -r .head "${previous_evidence}")
    git merge-base --is-ancestor "${previous_head}" HEAD || {
      echo "validation evidence head ${previous_head} is not an ancestor of HEAD" >&2
      exit 2
    }
    delta_matrix=$(scripts/change-impact.sh --checks "${previous_head}...HEAD" | sed 's/^/delta_/')
    eval "${delta_matrix}"

    for stage_id in diff validation docs common contracts frontend backend runtime e2e worktree; do
      if ! stage_needs_reverify "${stage_id}"; then
        stage_was_present "${stage_id}" || continue
        retain_validation_stage "${stage_id}"
        continue
      fi
      case "${stage_id}" in
        diff) run_validation_stage diff 'patch whitespace' git diff --check "${diff_range}" || true ;;
        validation) run_validation_stage validation 'changed validation tooling' check_changed_validation || true ;;
        docs) run_validation_stage docs documentation check_docs || true ;;
        common) run_validation_stage common 'common checks' make check-common || true ;;
        contracts) run_validation_stage contracts 'generated contracts' make check-contracts || true ;;
        frontend) run_validation_stage frontend 'frontend delta quality' make check-frontend-fast || true ;;
        backend) run_validation_stage backend 'backend delta quality' make check-backend-fast || true ;;
        runtime) run_validation_stage runtime 'container and release configuration' make check-runtime || true ;;
        e2e)
          blocked_by=$(jq -sc '[.[] | select(
            (.id == "contracts" or .id == "frontend" or .id == "backend" or .id == "runtime") and
            .status != "passed") | .id]' "${validation_stage_file}")
          if [ "${blocked_by}" = '[]' ]; then
            run_validation_stage e2e 'isolated full-stack E2E' make e2e || true
          else
            append_validation_stage e2e blocked '' "${blocked_by}"
            validation_failed=1
          fi
          ;;
        worktree) run_validation_stage worktree 'clean worktree' check_clean_worktree || true ;;
      esac
    done
    write_validation_evidence reverify
  fi
  cleanup_validation_stage_file
  trap - EXIT HUP INT TERM
  [ "${validation_failed}" = 0 ] || exit 1
  gate_finished=$(date +%s)
  printf '%s validation passed: %s (%ss)\n' \
    "${validation_mode}" "${impact}" "$((gate_finished - gate_started))"
  exit 0
fi

git diff --check "${diff_range}"

if [ "${impact}" = application ] && changed_path_matches \
  '^(Makefile|scripts/(change-gate(-test)?|change-impact|test-release-flow-transition|issue-local|issue-local-test|pre-push|pre-push-test)\.sh|frontend/scripts/(check-e2e-constraints(\.test)?|preview-smoke)\.mjs)'; then
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
    '{version:1,status:"passed",mode:"release",head:$head,base:$base,
      runtimeFingerprint:$runtime_fingerprint,previewRequired:($preview == 1)}' \
    >"${ZERP_GATE_EVIDENCE_FILE}.new"
  mv "${ZERP_GATE_EVIDENCE_FILE}.new" "${ZERP_GATE_EVIDENCE_FILE}"
fi
gate_finished=$(date +%s)
printf 'Change gate passed: %s (%ss)\n' "${impact}" "$((gate_finished - gate_started))"
