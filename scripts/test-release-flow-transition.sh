#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

fail() {
  echo "$*" >&2
  exit 1
}

field() {
  printf '%s\n' "$1" | sed -n "s/^$2=//p"
}

assert_check() {
  paths=$1
  expected=$2
  actual=$(printf '%s\n' "${paths}" | scripts/change-impact.sh --checks --paths)
  value=$(field "${actual}" "$3")
  test "${value}" = "${expected}" || fail "matrix $3 for ${paths}: expected ${expected}, got ${value:-missing}"
}

# A direct-main transition keeps the risk matrix, including its fast and full paths.
assert_check 'backend/internal/httpserver/server.go' 1 backend
assert_check 'backend/internal/httpserver/server.go' 0 backend_full
assert_check 'backend/db/migrations/00001_initial.sql' 1 backend_full
assert_check 'frontend/src/main.ts' 1 e2e
assert_check 'docs/operations/development-release.md' 0 preview
assert_check 'scripts/test-release-flow-transition.sh' validation impact
assert_check 'scripts/preview-state-test.sh' validation impact
assert_check 'scripts/preview-state.sh' validation impact
assert_check 'scripts/preview-state.sh' 1 preview

# Workflow behavior is intentionally structural here: GitHub Actions expressions
# cannot be executed locally, so assert the public routing contract explicitly.
grep -Fq 'branches: [main]' .github/workflows/quality.yml
if grep -Fq 'branches: [dev, main]' .github/workflows/quality.yml || \
  grep -Fq 'ZERP_MERGED_BASE_REF:' .github/workflows/quality.yml; then
  fail 'workflow retains dev routing'
fi
grep -Fq 'name: validation' .github/workflows/quality.yml
grep -Fq "'preview-required' || 'full-validation'" .github/workflows/quality.yml
grep -Fq 'needs.merge_evidence.outputs.preview == '"'"'1'"'"'' .github/workflows/quality.yml
grep -Fq "github.event_name == 'workflow_dispatch' ||" .github/workflows/quality.yml
grep -Fq "github.event_name == 'pull_request' &&" .github/workflows/quality.yml
# A manual run is conservative: the non-PR classifier marks it preview-bound,
# so it cannot manufacture a full-validation check without preview acceptance.
grep -Fq 'workflow_dispatch:' .github/workflows/quality.yml
grep -Fq 'preview=1' .github/workflows/quality.yml
grep -Fq 'required_checks="full-validation"' scripts/production-watch.sh
grep -Fq "github.event.action == 'ready_for_review'" .github/workflows/quality.yml
grep -Fq 'needs.merge_evidence.outputs.reuse_contracts' .github/workflows/quality.yml
checkout_count=$(grep -c 'uses: actions/checkout@v6' .github/workflows/quality.yml)
exact_ref_count=$(grep -c 'ref:.*github.event.pull_request.head.sha.*github.sha' .github/workflows/quality.yml)
test "${checkout_count}" = "${exact_ref_count}" || fail 'every quality job must checkout the exact PR head SHA'
grep -Fq "'draft-validation'" .github/workflows/quality.yml

# Direct-main PR evidence must include the latest base and no merge commits.
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-transition-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "${tmp}/repo"
git -C "${tmp}/repo" init -q
git -C "${tmp}/repo" config user.email transition-test@example.invalid
git -C "${tmp}/repo" config user.name transition-test
printf 'base\n' >"${tmp}/repo/file"
git -C "${tmp}/repo" add file
git -C "${tmp}/repo" commit -qm base
base_sha=$(git -C "${tmp}/repo" rev-parse HEAD)
printf 'feature\n' >>"${tmp}/repo/file"
git -C "${tmp}/repo" commit -qam feature
head_sha=$(git -C "${tmp}/repo" rev-parse HEAD)
(
  cd "${tmp}/repo"
  GITHUB_BASE_REF=main ZERP_PR_BASE_SHA="${base_sha}" ZERP_PR_HEAD_SHA="${head_sha}" \
    "${repo_root}/scripts/verify-pr-base.sh" >/dev/null
)
if (
  cd "${tmp}/repo"
  GITHUB_BASE_REF=dev ZERP_PR_BASE_SHA="${base_sha}" ZERP_PR_HEAD_SHA="${head_sha}" \
    "${repo_root}/scripts/verify-pr-base.sh" >/dev/null 2>&1
); then
  fail 'dev-target PR was accepted'
fi
if (
  cd "${tmp}/repo"
  GITHUB_BASE_REF=main ZERP_PR_BASE_SHA="${head_sha}" ZERP_PR_HEAD_SHA="${base_sha}" \
    "${repo_root}/scripts/verify-pr-base.sh" >/dev/null 2>&1
); then
  fail 'stale main ancestry was accepted'
fi
if (
  cd "${tmp}/repo"
  GITHUB_BASE_REF=main ZERP_CURRENT_MAIN_SHA="${head_sha}" \
    ZERP_PR_BASE_SHA="${base_sha}" ZERP_PR_HEAD_SHA="${head_sha}" \
    "${repo_root}/scripts/verify-pr-base.sh" >/dev/null 2>&1
); then
  fail 'PR based on an outdated main tip was accepted'
fi
git -C "${tmp}/repo" branch side "${base_sha}"
git -C "${tmp}/repo" checkout -q side
printf 'side\n' >"${tmp}/repo/side"
git -C "${tmp}/repo" add side
git -C "${tmp}/repo" commit -qm side
git -C "${tmp}/repo" checkout -q -
git -C "${tmp}/repo" merge --no-ff side -m merge-side >/dev/null
merged_head=$(git -C "${tmp}/repo" rev-parse HEAD)
if (
  cd "${tmp}/repo"
  GITHUB_BASE_REF=main ZERP_PR_BASE_SHA="${base_sha}" ZERP_PR_HEAD_SHA="${merged_head}" \
    "${repo_root}/scripts/verify-pr-base.sh" >/dev/null 2>&1
); then
  fail 'merge commit PR was accepted'
fi

# Merge evidence is reusable only from the exact PR head whose tree matches main.
mkdir -p "${tmp}/bin"
cp scripts/verify-merged-pr.sh "${tmp}/verify-merged-pr.sh"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
case "$*" in
  *'/pulls?per_page=20'*)
    printf '[{"number":7,"base":{"ref":"main"},"merged_at":"2026-08-08T00:00:00Z","merge_commit_sha":"%s","head":{"sha":"%s","ref":"feature"}}]\n' "$MOCK_MERGE_SHA" "$MOCK_HEAD_SHA"
    ;;
  *"/git/commits/${MOCK_MERGE_SHA}"*) printf '%s\n' "${MOCK_MERGE_TREE}" ;;
  *"/git/commits/${MOCK_HEAD_SHA}"*) printf '%s\n' "${MOCK_HEAD_TREE}" ;;
  *'/check-runs?per_page=100'*)
    case "${MOCK_SCENARIO}" in
      success) checks='full-validation:success' ;;
      status-success) checks='validation:success' ;;
      missing) checks='validation:success' ;;
      failed) checks='full-validation:failure' ;;
      *) exit 2 ;;
    esac
    printf '{"check_runs":['
    separator=
    for check in ${checks}; do
      name=${check%%:*}; conclusion=${check##*:}
      printf '%s{"name":"%s","status":"completed","conclusion":"%s","started_at":"2026-08-08T00:00:00Z"}' "$separator" "$name" "$conclusion"
      separator=,
    done
    printf ']}\n'
    ;;
  *'/statuses?per_page=100'*)
    if [ "${MOCK_SCENARIO}" = status-success ]; then
      printf '[{"context":"full-validation","state":"success","created_at":"2026-08-08T00:01:00Z"}]\n'
    else
      printf '[]\n'
    fi
    ;;
  *) exit 2 ;;
esac
MOCK
chmod +x "${tmp}/bin/gh"

assert_merge_evidence() {
  scenario=$1
  merge_tree=$2
  expected=$3
  if PATH="${tmp}/bin:${PATH}" MOCK_SCENARIO="${scenario}" \
    MOCK_MERGE_SHA=1111111111111111111111111111111111111111 \
    MOCK_HEAD_SHA=2222222222222222222222222222222222222222 \
    MOCK_MERGE_TREE="${merge_tree}" MOCK_HEAD_TREE=3333333333333333333333333333333333333333 \
    GITHUB_REPOSITORY=example/zerp GITHUB_SHA=1111111111111111111111111111111111111111 \
    "${tmp}/verify-merged-pr.sh" >/dev/null 2>&1; then
    actual=success
  else
    actual=failure
  fi
  test "${actual}" = "${expected}" || fail "merge evidence ${scenario}/${merge_tree}: expected ${expected}, got ${actual}"
}

assert_merge_evidence success 3333333333333333333333333333333333333333 success
assert_merge_evidence status-success 3333333333333333333333333333333333333333 success
assert_merge_evidence missing 3333333333333333333333333333333333333333 failure
assert_merge_evidence failed 3333333333333333333333333333333333333333 failure
assert_merge_evidence success 4444444444444444444444444444444444444444 failure

# Component evidence is reusable only from the same PR exact-head fingerprint.
cat >"${tmp}/bin/gh" <<'MOCK_REUSE'
#!/bin/sh
case "$*" in
  *'/pulls/9'*)
    printf '{"base":{"sha":"%s"},"head":{"sha":"%s","ref":"feature-nine"}}\n' "${MOCK_CURRENT_BASE_SHA}" "${MOCK_HEAD_SHA}"
    ;;
  *'/actions/runs?event=pull_request&head_sha='*)
    printf '{"workflow_runs":[{"id":88,"name":"Full-stack quality","event":"pull_request","head_branch":"feature-nine","head_sha":"%s","pull_requests":[{"number":%s,"base":{"sha":"%s"},"head":{"sha":"%s"}}],"status":"completed","conclusion":"success","updated_at":"2026-08-08T00:00:00Z"}]}\n' "${MOCK_HEAD_SHA}" "${MOCK_RUN_PR_NUMBER}" "${MOCK_RUN_BASE_SHA}" "${MOCK_HEAD_SHA}"
    ;;
  *'/actions/runs/88/jobs?per_page=100'*)
    printf '{"jobs":[{"name":"contracts","status":"completed","conclusion":"success","completed_at":"2026-08-08T00:01:00Z"}]}\n'
    ;;
  *) exit 2 ;;
esac
MOCK_REUSE
chmod +x "${tmp}/bin/gh"
reuse_output=${tmp}/reuse-output
base_fingerprint=4444444444444444444444444444444444444444
PATH="${tmp}/bin:${PATH}" GITHUB_REPOSITORY=example/zerp GITHUB_RUN_ID=99 \
  GITHUB_OUTPUT="${reuse_output}" ZERP_PR_NUMBER=9 \
  MOCK_HEAD_SHA="${head_sha}" MOCK_CURRENT_BASE_SHA="${base_fingerprint}" \
  MOCK_RUN_PR_NUMBER=9 MOCK_RUN_BASE_SHA="${base_fingerprint}" \
  ZERP_PR_BASE_SHA="${base_fingerprint}" ZERP_PR_HEAD_SHA="${head_sha}" ZERP_PR_HEAD_REF=feature-nine \
  scripts/reusable-pr-checks.sh >/dev/null
grep -Fxq 'reuse_contracts=1' "${reuse_output}"
grep -Fxq "fingerprint=9:${base_fingerprint}:${head_sha}" "${reuse_output}"

for mismatch in pr base; do
  mismatch_output="${tmp}/reuse-${mismatch}"
  run_pr=9; run_base=${base_fingerprint}
  if [ "${mismatch}" = pr ]; then run_pr=10; else run_base=5555555555555555555555555555555555555555; fi
  PATH="${tmp}/bin:${PATH}" GITHUB_REPOSITORY=example/zerp GITHUB_RUN_ID=99 \
    GITHUB_OUTPUT="${mismatch_output}" ZERP_PR_NUMBER=9 \
    MOCK_HEAD_SHA="${head_sha}" MOCK_CURRENT_BASE_SHA="${base_fingerprint}" \
    MOCK_RUN_PR_NUMBER="${run_pr}" MOCK_RUN_BASE_SHA="${run_base}" \
    ZERP_PR_BASE_SHA="${base_fingerprint}" ZERP_PR_HEAD_SHA="${head_sha}" ZERP_PR_HEAD_REF=feature-nine \
    scripts/reusable-pr-checks.sh >/dev/null
  grep -Fxq 'reuse_contracts=0' "${mismatch_output}"
done
