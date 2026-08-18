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
assert_check 'scripts/check-run-provenance.sh' application impact
assert_check 'scripts/check-run-provenance.sh' 1 containers
assert_check 'scripts/check-run-provenance.sh' 1 preview
assert_check 'scripts/preview-state-test.sh' validation impact
assert_check 'scripts/preview-state.sh' validation impact
assert_check 'scripts/preview-state.sh' 1 preview
assert_check 'backend/scripts/run-integration-tests-test.sh' validation impact
assert_check 'frontend/scripts/preview-smoke.mjs' validation impact
assert_check 'frontend/scripts/preview-smoke.mjs' 1 preview
assert_check 'frontend/scripts/check-e2e-constraints.mjs' validation impact
assert_check 'frontend/scripts/check-e2e-constraints.test.mjs' validation impact
assert_check 'frontend/playwright.config.ts' application impact
assert_check 'frontend/playwright.config.ts' 0 containers
assert_check 'frontend/playwright.config.ts' 1 local_e2e
assert_check 'scripts/production-watch.sh' application impact
assert_check 'scripts/preview-runtime-sandbox.sh' 1 preview

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
if grep -Eq 'local_preview|automation/local-|zerp-local-batch' .github/workflows/quality.yml; then
  fail 'workflow retains the retired trusted local-controller path'
fi
grep -Fq "github.event_name == 'workflow_dispatch' ||" .github/workflows/quality.yml
grep -Fq "github.event_name == 'pull_request' &&" .github/workflows/quality.yml
# A manual run is conservative: the non-PR classifier marks it preview-bound,
# so it cannot manufacture a full-validation check without preview acceptance.
grep -Fq 'workflow_dispatch:' .github/workflows/quality.yml
grep -Fq 'preview=1' .github/workflows/quality.yml
grep -Fq 'required_checks="full-validation"' scripts/production-watch.sh
# shellcheck disable=SC2016
grep -Fq 'verify_actions_check_run "${repo_slug}"' scripts/production-watch.sh
# shellcheck disable=SC2016
grep -Fq 'find_production_cloudflare_deployment' scripts/production-watch.sh
# shellcheck disable=SC2016
grep -Fq 'verify_cloudflare_pages_deployment "${candidate_deployment}"' scripts/production-watch.sh
grep -Fq 'sort_by(.started_at) | reverse | .[]' scripts/production-watch.sh
grep -Fq 'gh api --paginate --slurp' scripts/production-watch.sh
if grep -Fq 'Production no-op for' scripts/production-watch.sh; then
  fail 'production agent can mark a commit processed without exact-SHA deployment'
fi
# shellcheck disable=SC2016
grep -Fq 'verify_actions_check_run "${repo}"' scripts/verify-preview-pr.sh
# shellcheck disable=SC2016
grep -Fq 'check-run-provenance.sh" "${provenance}' scripts/install-production-agent.sh
# shellcheck disable=SC2016
grep -Fq 'check-run-provenance.sh" "${provenance_candidate}' scripts/production-deploy.sh
grep -Fq 'api_token_workers_access' scripts/production-deploy.sh
# shellcheck disable=SC2016
grep -Fq 'load_cloudflare_pages_project' scripts/production-deploy.sh
# shellcheck disable=SC2016
grep -Fq 'verify_cloudflare_pages_project "${cloudflare_project_json}"' scripts/production-deploy.sh
grep -Fq "github.event.action == 'ready_for_review'" .github/workflows/quality.yml
grep -Fq "if [ \"\$READY_VALIDATION\" = \"1\" ]; then" .github/workflows/quality.yml
grep -Fq 'needs.merge_evidence.outputs.reuse_contracts' .github/workflows/quality.yml
checkout_count=$(grep -c 'uses: actions/checkout@v6' .github/workflows/quality.yml)
exact_ref_count=$(grep -c 'ref:.*github.event.pull_request.head.sha.*github.sha' .github/workflows/quality.yml)
test "${checkout_count}" = "${exact_ref_count}" || fail 'every quality job must checkout the exact PR head SHA'
grep -Fq "'draft-validation'" .github/workflows/quality.yml
if grep -ERq 'openai/codex-action|OPENAI_API_KEY|issue-queue|issue-implement|issue-review' .github/workflows; then
  fail 'retired cloud Codex workflow remains reachable'
fi
if grep -ERq 'issue-(automation|codex-watch|release-watch)|automation:(ready|implementing|reviewing|release)' \
  scripts .github/workflows docs/agents; then
  fail 'retired remote Issue automation remains reachable'
fi
grep -Fq 'ZERP_RELEASE_VERIFIER_ACTOR is required' scripts/verify-preview-pr.sh

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
cp scripts/check-run-provenance.sh "${tmp}/check-run-provenance.sh"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
case "${MOCK_SCENARIO}" in
  accepted-status-bot) acceptance_actor=bot ;;
  accepted-status-suffix-bot) acceptance_actor=release-bot ;;
  accepted-status-bracket-bot) acceptance_actor='Release[Bot]' ;;
  *) acceptance_actor='release-verifier[bot]' ;;
esac
case "$*" in
  *'/pulls?per_page=20'*)
    printf '[{"number":7,"base":{"ref":"main"},"merged_at":"2026-08-08T00:00:00Z","merge_commit_sha":"%s","head":{"sha":"%s","ref":"feature"}}]\n' "$MOCK_MERGE_SHA" "$MOCK_HEAD_SHA"
    ;;
  *"/git/commits/${MOCK_MERGE_SHA}"*) printf '%s\n' "${MOCK_MERGE_TREE}" ;;
  *"/git/commits/${MOCK_HEAD_SHA}"*) printf '%s\n' "${MOCK_HEAD_TREE}" ;;
  *'/check-runs?per_page=100'*)
    case "${MOCK_SCENARIO}" in
      success | success-empty-pulls) checks='full-validation:success' ;;
      untrusted-check) checks='full-validation:success' ;;
      preview-check-success) checks='preview-required:success full-validation:success' ;;
      full-after-preview | preview-after-full) checks='preview-required:success full-validation:success' ;;
      status-success | accepted-status-*) checks='validation:success' ;;
      missing) checks='validation:success' ;;
      failed) checks='full-validation:failure' ;;
      *) exit 2 ;;
    esac
    printf '{"check_runs":['
    separator=
    for check in ${checks}; do
      name=${check%%:*}; conclusion=${check##*:}
      app=github-actions
      [ "${MOCK_SCENARIO}" != untrusted-check ] || app=untrusted-app
      started_at=2026-08-08T00:00:00Z
      if [ "${MOCK_SCENARIO}" = full-after-preview ] && [ "${name}" = full-validation ]; then
        started_at=2026-08-08T00:01:00Z
      elif [ "${MOCK_SCENARIO}" = preview-after-full ] && [ "${name}" = preview-required ]; then
        started_at=2026-08-08T00:01:00Z
      fi
      printf '%s{"name":"%s","status":"completed","conclusion":"%s","started_at":"%s","details_url":"https://github.com/example/zerp/actions/runs/88/job/99","app":{"slug":"%s"}}' "$separator" "$name" "$conclusion" "$started_at" "$app"
      separator=,
    done
    printf ']}\n'
    ;;
  *'/actions/runs/88')
    if [ "${MOCK_SCENARIO}" = push-success ]; then
      event=push; pulls='[]'
    elif [ "${MOCK_SCENARIO}" = success-empty-pulls ]; then
      event=pull_request; pulls='[]'
    else
      event=pull_request
      pulls=$(printf '[{"number":7,"base":{"ref":"main"},"head":{"sha":"%s"}}]' "${MOCK_HEAD_SHA}")
    fi
    printf '{"id":88,"name":"Full-stack quality","path":".github/workflows/quality.yml","event":"%s","status":"completed","conclusion":"success","head_sha":"%s","head_repository":{"full_name":"example/zerp"},"pull_requests":%s}\n' "${event}" "${MOCK_HEAD_SHA}" "${pulls}"
    ;;
  *'/actions/jobs/99')
    printf '{"id":99,"name":"full-validation","status":"completed","conclusion":"success","head_sha":"%s","html_url":"https://github.com/example/zerp/actions/runs/88/job/99","workflow_name":"Full-stack quality","run_url":"https://api.github.com/repos/example/zerp/actions/runs/88"}\n' "${MOCK_HEAD_SHA}"
    ;;
  *"commits/${MOCK_HEAD_SHA}/statuses?per_page=100"*)
    if [ "${MOCK_SCENARIO}" = status-success ]; then
      printf '[{"context":"full-validation","state":"success","created_at":"2026-08-08T00:01:00Z"}]\n'
    elif [ "${MOCK_SCENARIO#accepted-status-}" != "${MOCK_SCENARIO}" ]; then
      printf '[{"context":"full-validation","state":"success","description":"verified preview PR #7 generation 3 by %s","target_url":"https://zerp-preview.bytesucceed.com","creator":{"login":"%s"},"created_at":"2026-08-08T00:01:00Z"}]\n' "${acceptance_actor}" "${acceptance_actor}"
    else
      printf '[]\n'
    fi
    ;;
  *'/collaborators/'*'/permission'*) printf 'write\n' ;;
  *'/deployments?sha='*)
    printf '[{"id":42,"description":"preview PR #7 generation 3 verifier %s","payload":{"pr":"7","generation":"3","actor":"%s"},"creator":{"login":"%s"},"created_at":"2026-08-08T00:01:00Z"}]\n' "${acceptance_actor}" "${acceptance_actor}" "${acceptance_actor}"
    ;;
  *'/deployments/42/statuses?per_page=100'*)
    printf '[{"state":"success","description":"verified PR #7 head %s generation 3 by %s","creator":{"login":"%s"},"created_at":"2026-08-08T00:02:00Z"}]\n' "${MOCK_HEAD_SHA}" "${acceptance_actor}" "${acceptance_actor}"
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
    ZERP_RELEASE_VERIFIER_ACTOR='release-verifier[bot]' \
    "${tmp}/verify-merged-pr.sh" >/dev/null 2>&1; then
    actual=success
  else
    actual=failure
  fi
  test "${actual}" = "${expected}" || fail "merge evidence ${scenario}/${merge_tree}: expected ${expected}, got ${actual}"
}

assert_merge_evidence success 3333333333333333333333333333333333333333 success
assert_merge_evidence success-empty-pulls 3333333333333333333333333333333333333333 success
assert_merge_evidence untrusted-check 3333333333333333333333333333333333333333 failure
assert_merge_evidence preview-check-success 3333333333333333333333333333333333333333 failure
assert_merge_evidence full-after-preview 3333333333333333333333333333333333333333 success
assert_merge_evidence preview-after-full 3333333333333333333333333333333333333333 failure
assert_merge_evidence status-success 3333333333333333333333333333333333333333 failure
assert_merge_evidence accepted-status-success 3333333333333333333333333333333333333333 success
assert_merge_evidence accepted-status-bot 3333333333333333333333333333333333333333 failure
assert_merge_evidence accepted-status-suffix-bot 3333333333333333333333333333333333333333 failure
assert_merge_evidence accepted-status-bracket-bot 3333333333333333333333333333333333333333 failure
assert_merge_evidence missing 3333333333333333333333333333333333333333 failure
assert_merge_evidence failed 3333333333333333333333333333333333333333 failure
assert_merge_evidence success 4444444444444444444444444444444444444444 failure

# The production watcher accepts only a successful push job from the same
# trusted workflow, repository, exact SHA, run, and job.
# shellcheck source=scripts/check-run-provenance.sh
. "${repo_root}/scripts/check-run-provenance.sh"
trusted_push_check='{"name":"full-validation","status":"completed","conclusion":"success","details_url":"https://github.com/example/zerp/actions/runs/88/job/99","app":{"slug":"github-actions"}}'
if ! PATH="${tmp}/bin:${PATH}" MOCK_SCENARIO=push-success \
  MOCK_HEAD_SHA=2222222222222222222222222222222222222222 \
  verify_actions_check_run example/zerp "${trusted_push_check}" full-validation \
    2222222222222222222222222222222222222222 push '' gh; then
  fail 'trusted production full-validation provenance was rejected'
fi
untrusted_push_check=$(printf '%s' "${trusted_push_check}" |
  jq '.app.slug = "untrusted-app"')
if PATH="${tmp}/bin:${PATH}" MOCK_SCENARIO=push-success \
  MOCK_HEAD_SHA=2222222222222222222222222222222222222222 \
  verify_actions_check_run example/zerp "${untrusted_push_check}" full-validation \
    2222222222222222222222222222222222222222 push '' gh; then
  fail 'untrusted production full-validation provenance was accepted'
fi

trusted_cloudflare_check='{"name":"Cloudflare Pages","status":"completed","conclusion":"success","head_sha":"2222222222222222222222222222222222222222","details_url":"https://dash.cloudflare.com/?to=/account/pages/view/zerp/12345678-abcd-4abc-8abc-1234567890ab","external_id":"12345678-abcd-4abc-8abc-1234567890ab","app":{"id":85455,"slug":"cloudflare-workers-and-pages","name":"Cloudflare Workers and Pages","owner":{"login":"cloudflare"}}}'
if ! verify_cloudflare_pages_check_run "${trusted_cloudflare_check}" \
  2222222222222222222222222222222222222222 zerp; then
  fail 'trusted Cloudflare Pages provenance was rejected'
fi
untrusted_cloudflare_check=$(printf '%s' "${trusted_cloudflare_check}" |
  jq '.app.id = 1 | .app.slug = "untrusted-app"')
if verify_cloudflare_pages_check_run "${untrusted_cloudflare_check}" \
  2222222222222222222222222222222222222222 zerp; then
  fail 'untrusted Cloudflare Pages provenance was accepted'
fi
wrong_project_cloudflare_check=$(printf '%s' "${trusted_cloudflare_check}" |
  jq '.details_url = "https://dash.cloudflare.com/?to=/account/pages/view/other/12345678-abcd-4abc-8abc-1234567890ab"')
if verify_cloudflare_pages_check_run "${wrong_project_cloudflare_check}" \
  2222222222222222222222222222222222222222 zerp; then
  fail 'wrong Cloudflare Pages project was accepted'
fi
mismatched_deployment_cloudflare_check=$(printf '%s' "${trusted_cloudflare_check}" |
  jq '.details_url = "https://dash.cloudflare.com/?to=/account/pages/view/zerp/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"')
if verify_cloudflare_pages_check_run "${mismatched_deployment_cloudflare_check}" \
  2222222222222222222222222222222222222222 zerp; then
  fail 'mismatched Cloudflare Pages deployment was accepted'
fi

trusted_cloudflare_deployment='{"success":true,"result":{"id":"12345678-abcd-4abc-8abc-1234567890ab","project_name":"zerp","environment":"production","source":{"type":"github","config":{"owner":"example","repo_name":"zerp","production_branch":"main"}},"deployment_trigger":{"type":"github:push","metadata":{"branch":"main","commit_hash":"2222222222222222222222222222222222222222","commit_dirty":false}},"latest_stage":{"name":"deploy","status":"success"}}}'
if ! verify_cloudflare_pages_deployment "${trusted_cloudflare_deployment}" \
  12345678-abcd-4abc-8abc-1234567890ab \
  2222222222222222222222222222222222222222 zerp example zerp main; then
  fail 'trusted production Cloudflare Pages deployment was rejected'
fi
preview_cloudflare_deployment=$(printf '%s' "${trusted_cloudflare_deployment}" |
  jq '.result.environment = "preview" | .result.deployment_trigger.metadata.branch = "feature"')
if verify_cloudflare_pages_deployment "${preview_cloudflare_deployment}" \
  12345678-abcd-4abc-8abc-1234567890ab \
  2222222222222222222222222222222222222222 zerp example zerp main; then
  fail 'preview Cloudflare Pages deployment was accepted as production'
fi

trusted_cloudflare_project='{"success":true,"result":{"name":"zerp","source":{"type":"github","config":{"owner":"example","repo_name":"zerp","production_branch":"main"}}}}'
if ! verify_cloudflare_pages_project "${trusted_cloudflare_project}" \
  zerp example zerp main; then
  fail 'trusted Cloudflare Pages project was rejected'
fi
wrong_cloudflare_project=$(printf '%s' "${trusted_cloudflare_project}" |
  jq '.result.source.config.owner = "attacker"')
if verify_cloudflare_pages_project "${wrong_cloudflare_project}" \
  zerp example zerp main; then
  fail 'wrong Cloudflare Pages project source was accepted'
fi

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
