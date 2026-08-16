#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-local-test.XXXXXX")
cleanup() {
  if [ "${KEEP_ISSUE_LOCAL_TEST_TMP:-0}" = 1 ]; then
    echo "kept test workspace: ${tmp}" >&2
  else
    rm -rf "${tmp}"
  fi
}
trap cleanup EXIT HUP INT TERM

primary="${tmp}/repo"
remote="${tmp}/remote.git"
runtime="${primary}/backend/var/issue-delivery"
events="${tmp}/events"
mkdir -p "${primary}" "${tmp}/bin"
git init --bare "${remote}" >/dev/null
cat >"${remote}/hooks/pre-receive" <<'EOF'
#!/bin/sh
set -eu
while read -r _ new ref; do
  if [ "${MOCK_REQUIRE_PR_BODY_BEFORE_PUSH:-0}" = 1 ] && \
    [ "${ref}" = "refs/heads/${MOCK_EXPECTED_PUSH_BRANCH}" ]; then
    grep -Fq "head=${new} fingerprint=runtime-one" "${MOCK_CAPTURE}/pr-body.md"
    test "${new}" = "${MOCK_EXPECTED_PUSH_HEAD}"
  fi
done
EOF
chmod +x "${remote}/hooks/pre-receive"
git -C "${primary}" init -b main >/dev/null
git -C "${primary}" config user.name 'Issue Local Test'
git -C "${primary}" config user.email issue-local-test@example.com
mkdir -p "${primary}/backend/var" "${primary}/node_modules/.pnpm" \
  "${primary}/node_modules/.bin" "${primary}/frontend/node_modules/.bin" \
  "${primary}/frontend/node_modules/.pnpm" "${primary}/frontend/node_modules/.tmp" \
  "${primary}/frontend/node_modules/.vite" "${primary}/frontend/node_modules/.vite-temp" \
  "${primary}/frontend/node_modules/.pnpm-store"
printf '.scratch/\nbackend/var/\nbackend/.env*.local\nnode_modules\n' >"${primary}/.gitignore"
printf 'seed\n' >"${primary}/README.md"
printf 'backend seed\n' >"${primary}/backend/README.md"
printf 'lockfileVersion: "9.0"\n' >"${primary}/pnpm-lock.yaml"
printf '{"packageManager":"pnpm@10.34.5"}\n' >"${primary}/package.json"
printf 'TEST_POSTGRES_DB=issue_local_test\n' >"${primary}/backend/.env.local"
printf 'APP_ENV=test\n' >"${primary}/backend/.env.e2e.local"
printf 'layoutVersion: 1\n' >"${primary}/node_modules/.modules.yaml"
printf '#!/bin/sh\nexit 0\n' >"${primary}/frontend/node_modules/.bin/vite"
chmod +x "${primary}/frontend/node_modules/.bin/vite"
: >"${primary}/frontend/node_modules/vite"
printf 'primary cache\n' >"${primary}/frontend/node_modules/.tmp/primary-cache"
git -C "${primary}" add .gitignore README.md backend/README.md package.json pnpm-lock.yaml
git -C "${primary}" commit -m seed >/dev/null
git -C "${primary}" remote add origin "${remote}"
git -C "${primary}" push -u origin main >/dev/null
cp "${primary}/.git/info/exclude" "${tmp}/git-exclude-before"

feature="${primary}/.scratch/inventory-query/issues"
mkdir -p "${feature}"
cat >"${feature}/01-first-slice.md" <<'EOF'
# 01 — First slice

**What to build:** Deliver the first complete behavior.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] First acceptance criterion
EOF
cat >"${feature}/02-second-slice.md" <<'EOF'
# 02 — Second slice

**What to build:** Deliver the dependent complete behavior.

**Blocked by:** 01 — First slice

**Status:** ready-for-agent

- [ ] Second acceptance criterion
EOF

cat >"${tmp}/bin/codex" <<'EOF'
#!/bin/sh
set -eu
if [ "${1:-}" = login ] && [ "${2:-}" = status ]; then
  echo 'Logged in using ChatGPT' >&2
  exit 0
fi
all_args="$*"
test "${1:-}" = --ask-for-approval
test "${2:-}" = never
shift 2
test "${1:-}" = exec
printf '%s\n' "${all_args}" >"${MOCK_CODEX_ARGS}"
printf '%s\n' "${COREPACK_ROOT:-}" >"${MOCK_COREPACK_ROOT}"
command -v pnpm >"${MOCK_CODEX_PNPM_PATH}"
pnpm --version >"${MOCK_CODEX_PNPM_VERSION}"
worktree=
output=
shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    -C) worktree=$2; shift 2 ;;
    -o) output=$2; shift 2 ;;
    *) shift ;;
  esac
done
prompt=$(cat)
if [ -e "${worktree}/backend/.env.local" ] || [ -L "${worktree}/backend/.env.local" ] ||
  [ -e "${worktree}/backend/.env.e2e.local" ] || [ -L "${worktree}/backend/.env.e2e.local" ]; then
  echo 'Codex received the host backend environment file' >&2
  exit 3
fi
printf 'codex\n' >>"${MOCK_EVENTS}"
if [ "${MOCK_CODEX_SLEEP:-0}" = 1 ]; then sleep 30; fi
printf '%s\n' "${prompt}" >"${MOCK_PROMPT}"
printf '%s\n' "${prompt}" | grep -Fq '$implement'
count=$(cat "${MOCK_CODEX_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_CODEX_COUNT}"
printf '%s\n' "${prompt}" >"${MOCK_PROMPT}-${count}"
mkdir -p "${worktree}/.pnpm-store" "${worktree}/frontend/node_modules/.pnpm-store"
if [ "${count}" -le "${MOCK_CODEX_FAILS:-0}" ]; then
  echo "simulated code review failure ${count}" >&2
  exit 1
fi
if [ "${MOCK_CODEX_MODE:-completed}" = needs-input ]; then
  jq -n '{status:"needs_input",summary:"decision required",commitSha:"",validation:"not_run",review:"not_run"}' >"${output}"
  exit 0
fi
if [ "${MOCK_CODEX_MODE:-completed}" = failed ]; then
  echo 'simulated code review failure' >&2
  exit 1
fi
if [ "${MOCK_CODEX_REVIEW_EXISTING:-0}" = 1 ] &&
  printf '%s\n' "${prompt}" | grep -Fq 'unreviewed manual repair'; then
  head=$(git -C "${worktree}" rev-parse HEAD)
  printf 'model-review\n' >>"${MOCK_EVENTS}"
  jq -n --arg head "${head}" \
    '{status:"completed",summary:"reviewed existing repair",commitSha:$head,validation:"not_run",review:"passed"}' >"${output}"
  exit 0
fi
printf 'implemented\n' >"${worktree}/deliverable-${count}.txt"
git -C "${worktree}" add "deliverable-${count}.txt"
git -C "${worktree}" -c user.name='Local Implement' -c user.email=local@example.com \
  commit -m 'feat: implement inventory query batch' >/dev/null
printf 'model-commit\n' >>"${MOCK_EVENTS}"
head=$(git -C "${worktree}" rev-parse HEAD)
printf 'model-review\n' >>"${MOCK_EVENTS}"
jq -n --arg head "${head}" --arg validation "${MOCK_VALIDATION:-not_run}" \
  '{status:"completed",summary:"implemented",commitSha:$head,validation:$validation,review:"passed"}' >"${output}"
EOF
chmod +x "${tmp}/bin/codex"

cat >"${tmp}/bin/gate" <<'EOF'
#!/bin/sh
set -eu
printf 'gate\n' >>"${MOCK_EVENTS}"
printf '%s\n' "${COREPACK_ROOT:-}" >"${MOCK_GATE_COREPACK_ROOT}"
command -v pnpm >"${MOCK_GATE_PNPM_PATH}"
pnpm --version >"${MOCK_GATE_PNPM_VERSION}"
test -L backend/.env.local
readlink backend/.env.local >"${MOCK_GATE_ENV_TARGET}"
printf '%s\n' "${ZERP_E2E_ENV_FILE:-}" >"${MOCK_GATE_E2E_ENV_TARGET}"
count=$(cat "${MOCK_GATE_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_GATE_COUNT}"
if [ "${count}" -le "${MOCK_GATE_FAILS:-0}" ]; then
  if [ "${MOCK_GATE_LONG_FAILURE:-0}" = 1 ]; then
    line=1
    while [ "${line}" -le 300 ]; do
      printf 'successful gate output line %s\n' "${line}"
      line=$((line + 1))
    done
  fi
  if [ "${MOCK_GATE_E2E_FAILURE:-0}" = 1 ]; then
    echo '==> isolated full-stack E2E'
    echo '  1) [system-serial] › tests/e2e/user-management-lifecycle.spec.ts:48:1 › lifecycle'
  fi
  if [ "${MOCK_GATE_FAILURE_NUMERIC_UNIQUE:-0}" = 1 ]; then
    case "${count}" in
      1) failure_kind='HTTP 401' ;;
      *) failure_kind='HTTP 500' ;;
    esac
    echo "simulated host gate failure ${failure_kind}" >&2
  elif [ "${MOCK_GATE_FAILURE_UNIQUE:-0}" = 1 ]; then
    failure_kind=$(printf 'abcdefgh' | cut -c "${count}")
    echo "simulated host gate failure ${failure_kind}" >&2
  else
    echo 'simulated host gate failure' >&2
  fi
  exit 1
fi
head=$(git rev-parse HEAD)
jq -n --arg head "${head}" --arg base "$1" \
  --arg runtime_fingerprint "${MOCK_RUNTIME_FINGERPRINT:-runtime-one}" \
  '{status:"passed",head:$head,base:$base,runtimeFingerprint:$runtime_fingerprint}' \
  >"${ZERP_GATE_EVIDENCE_FILE}"
EOF
chmod +x "${tmp}/bin/gate"

cat >"${tmp}/bin/focused-e2e" <<'EOF'
#!/bin/sh
set -eu
printf 'focused-e2e %s\n' "$*" >>"${MOCK_EVENTS}"
printf '%s\n' "${ZERP_E2E_ENV_FILE:-}" >"${MOCK_FOCUSED_E2E_ENV_TARGET}"
count=$(cat "${MOCK_FOCUSED_E2E_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_FOCUSED_E2E_COUNT}"
if [ "${count}" -le "${MOCK_FOCUSED_E2E_FAILS:-0}" ]; then
  echo "simulated focused E2E failure ${count}" >&2
  exit 1
fi
EOF
chmod +x "${tmp}/bin/focused-e2e"

cat >"${tmp}/bin/preview" <<'EOF'
#!/bin/sh
set -eu
if [ "${1:-}" = close ]; then
  printf 'preview-close %s\n' "${2:-}" >>"${MOCK_EVENTS}"
  if [ -n "${MOCK_PREVIEW_CLOSE_TICKET:-}" ]; then
    grep -Fq "**Status:** ${MOCK_PREVIEW_CLOSE_EXPECT_STATUS}" \
      "${MOCK_PREVIEW_CLOSE_TICKET}"
  fi
  exit 0
fi
if [ "${MOCK_PREVIEW_REQUIRE_DETACHED_MODULES:-0}" = 1 ] && \
  { [ -e "${ZERP_ISSUE_WORKTREE}/node_modules" ] || [ -L "${ZERP_ISSUE_WORKTREE}/node_modules" ]; }; then
  echo 'preview received the controller-managed primary node_modules symlink' >&2
  exit 2
fi
if [ "${MOCK_PREVIEW_LEAVES_DEPENDENCY_RESIDUE:-0}" = 1 ]; then
  mkdir -p "${ZERP_ISSUE_WORKTREE}/node_modules/.pnpm" \
    "${ZERP_ISSUE_WORKTREE}/frontend/node_modules/.pnpm-store" \
    "${ZERP_ISSUE_WORKTREE}/frontend/node_modules/.vite"
fi
printf 'preview\n' >>"${MOCK_EVENTS}"
count=$(cat "${MOCK_PREVIEW_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_PREVIEW_COUNT}"
if [ "${count}" -le "${MOCK_PREVIEW_FAILS:-0}" ]; then
  echo "simulated preview stdout ${count}"
  echo "simulated preview environment failure ${count}" >&2
  exit 1
fi
printf 'url=https://zerp-preview.bytesucceed.com\n'
printf 'fingerprint=%s\n' "${MOCK_RUNTIME_FINGERPRINT:-runtime-one}"
EOF
chmod +x "${tmp}/bin/preview"

cat >"${tmp}/bin/production" <<'EOF'
#!/bin/sh
set -eu
printf 'production\n' >>"${MOCK_EVENTS}"
if [ "${MOCK_VERIFY_COMPLETION_CANDIDATE:-0}" = 1 ]; then
  worktree=${ZERP_ISSUE_WORKTREE:?}
  worktree_git_dir=$(git -C "${worktree}" rev-parse --path-format=absolute --git-dir)
  common_git_dir=$(git -C "${worktree}" rev-parse --path-format=absolute --git-common-dir)
  grep -Fq -- "--add-dir ${worktree_git_dir}" "${MOCK_CODEX_ARGS}"
  grep -Fq -- "--add-dir ${common_git_dir}" "${MOCK_CODEX_ARGS}"
  test -L "${worktree}/node_modules"
  test "$(readlink "${worktree}/node_modules")" = "${MOCK_PRIMARY}/node_modules"
  test ! -e "${worktree}/backend/.env.local"
  test ! -e "${worktree}/backend/.env.e2e.local"
  test -d "${worktree}/frontend/node_modules/.tmp"
  test ! -e "${worktree}/frontend/node_modules/.tmp/primary-cache"
  test ! -e "${worktree}/frontend/node_modules/.pnpm"
  test ! -e "${worktree}/frontend/node_modules/.vite"
  test ! -e "${worktree}/.pnpm-store"
  test ! -e "${worktree}/frontend/node_modules/.pnpm-store"
  : >"${MOCK_CAPTURE}/completion-candidate-verified"
fi
printf 'sha=9999999999999999999999999999999999999999\n'
EOF
chmod +x "${tmp}/bin/production"

cat >"${tmp}/bin/gh" <<'EOF'
#!/bin/sh
set -eu
printf 'gh %s\n' "$*" >>"${MOCK_EVENTS}"
case " $* " in
  *' api --paginate repos/example/zerp/issues?state=all&per_page=100 '*) printf '[]\n' ;;
  *' api --method POST repos/example/zerp/issues '*)
    payload=$(cat)
    count=$(cat "${MOCK_ISSUE_COUNT}" 2>/dev/null || printf 0)
    count=$((count + 1))
    printf '%s\n' "${count}" >"${MOCK_ISSUE_COUNT}"
    printf '%s\n' "${payload}" >"${MOCK_CAPTURE}/issue-${count}.json"
    jq -n --argjson number "$((100 + count))" --argjson id "$((1000 + count))" \
      '{number:$number,id:$id,html_url:("https://github.com/example/zerp/issues/"+($number|tostring))}'
    ;;
  *'/dependencies/blocked_by'*)
    printf '%s\n' "$*" >"${MOCK_CAPTURE}/dependency.txt"
    printf '{}\n'
    ;;
  *' pr create '*)
    body_file=
    previous=
    for argument in "$@"; do
      if [ "${previous}" = --body-file ]; then body_file=${argument}; fi
      previous=${argument}
    done
    cp "${body_file}" "${MOCK_CAPTURE}/pr-body.md"
    printf 'https://github.com/example/zerp/pull/77\n'
    ;;
  *' pr list '*) printf '\n' ;;
  *' pr checks 77 '*)
    count=$(cat "${MOCK_CHECK_COUNT}" 2>/dev/null || printf 0)
    count=$((count + 1))
    printf '%s\n' "${count}" >"${MOCK_CHECK_COUNT}"
    if [ "${MOCK_CHECK_MODE:-}" = advance-main-once ] && [ "${count}" = 1 ]; then
      printf 'upstream\n' >"${MOCK_PRIMARY}/upstream.txt"
      git -C "${MOCK_PRIMARY}" add upstream.txt
      git -C "${MOCK_PRIMARY}" commit -m 'upstream change' >/dev/null
      git -C "${MOCK_PRIMARY}" push origin main >/dev/null
      echo 'required checks failed' >&2
      exit 1
    fi
    if [ "${count}" -le "${MOCK_CHECKS_MISSING:-0}" ]; then
      if [ "${MOCK_CHECKS_MISSING_MESSAGE:-required}" = plain ]; then
        echo "no checks reported on the test branch" >&2
      else
        echo "no required checks reported on the test branch" >&2
      fi
      exit 1
    fi
    if [ "${count}" -le "${MOCK_CHECKS_FAILS:-0}" ]; then
      echo 'required checks failed for candidate' >&2
      exit 1
    fi
    exit 0
    ;;
  *' pr merge 77 '*) printf '{}\n' ;;
  *' pr edit 77 '*)
    body_file=
    previous=
    for argument in "$@"; do
      if [ "${previous}" = --body-file ]; then body_file=${argument}; fi
      previous=${argument}
    done
    cp "${body_file}" "${MOCK_CAPTURE}/pr-body.md"
    printf '{}\n'
    ;;
  *' pr view 77 '*'state,headRefName,headRefOid,baseRefName,body'*)
    jq -n \
      --arg state "${MOCK_EXISTING_PR_STATE:-OPEN}" \
      --arg head_ref "${MOCK_EXISTING_PR_BRANCH:-automation/local-published-resume}" \
      --arg head "${MOCK_EXISTING_PR_HEAD:-0000000000000000000000000000000000000000}" \
      --arg base_ref "${MOCK_EXISTING_PR_BASE:-main}" \
      --arg body "${MOCK_EXISTING_PR_BODY:-stale body}" \
      '{state:$state,headRefName:$head_ref,headRefOid:$head,baseRefName:$base_ref,body:$body}'
    ;;
  *' pr view 77 '*) printf '{"state":"MERGED","mergeCommit":{"oid":"9999999999999999999999999999999999999999"}}\n' ;;
  *' issue close '*) printf '{}\n' ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
EOF
chmod +x "${tmp}/bin/gh"

mkdir -p "${tmp}/capture"
pnpm_store="${tmp}/pnpm-store"
cached_pnpm="${pnpm_store}/v11/links/@/pnpm/10.34.5/test/node_modules/pnpm"
mkdir -p "${cached_pnpm}/bin"
printf '{"name":"pnpm","version":"10.34.5"}\n' >"${cached_pnpm}/package.json"
cat >"${cached_pnpm}/bin/pnpm.cjs" <<'EOF'
process.stdout.write('10.34.5\n')
EOF
cat >"${tmp}/bin/pnpm" <<'EOF'
#!/bin/sh
printf 'wrong-homebrew-pnpm\n' >>"${MOCK_EVENTS}"
printf '11.0.0\n'
EOF
chmod +x "${tmp}/bin/pnpm"
export MOCK_EVENTS="${events}"
export MOCK_PROMPT="${tmp}/prompt"
export MOCK_CAPTURE="${tmp}/capture"
export MOCK_PRIMARY="${primary}"
export MOCK_ISSUE_COUNT="${tmp}/issue-count"
export MOCK_CODEX_COUNT="${tmp}/codex-count"
export MOCK_PREVIEW_COUNT="${tmp}/preview-count"
export MOCK_CHECK_COUNT="${tmp}/check-count"
export MOCK_CODEX_ARGS="${tmp}/codex-args"
export MOCK_COREPACK_ROOT="${tmp}/corepack-root"
export MOCK_GATE_COUNT="${tmp}/gate-count"
export MOCK_FOCUSED_E2E_COUNT="${tmp}/focused-e2e-count"
export MOCK_GATE_COREPACK_ROOT="${tmp}/gate-corepack-root"
export MOCK_CODEX_PNPM_PATH="${tmp}/codex-pnpm-path"
export MOCK_CODEX_PNPM_VERSION="${tmp}/codex-pnpm-version"
export MOCK_GATE_PNPM_PATH="${tmp}/gate-pnpm-path"
export MOCK_GATE_PNPM_VERSION="${tmp}/gate-pnpm-version"
export MOCK_GATE_ENV_TARGET="${tmp}/gate-env-target"
export MOCK_GATE_E2E_ENV_TARGET="${tmp}/gate-e2e-env-target"
export MOCK_FOCUSED_E2E_ENV_TARGET="${tmp}/focused-e2e-env-target"
export ZERP_PNPM_STORE_PATH="${pnpm_store}"
export MOCK_PREVIEW_REQUIRE_DETACHED_MODULES=1
export MOCK_PREVIEW_LEAVES_DEPENDENCY_RESIDUE=1
: >"${events}"

PATH="${tmp}/bin:${PATH}" \
ZERP_PRIMARY_ROOT="${primary}" \
ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  ZERP_CODEX_BIN=codex \
  ZERP_GH_BIN=gh \
  ZERP_ISSUE_PREVIEW_COMMAND="${tmp}/bin/preview" \
  ZERP_ISSUE_PRODUCTION_COMMAND="${tmp}/bin/production" \
  ZERP_ISSUE_GATE_COMMAND="${tmp}/bin/gate" \
  MOCK_VERIFY_COMPLETION_CANDIDATE=1 \
  "${repo_root}/scripts/issue-local.sh" run

test "$(cat "${tmp}/issue-count")" = 2
test "$(grep -c '^codex$' "${events}")" = 1
test "$(grep -c '^gate$' "${events}")" = 1
test "$(cat "${MOCK_GATE_COREPACK_ROOT}")" = 1
test "$(cat "${MOCK_GATE_PNPM_VERSION}")" = 10.34.5
test "$(cat "${MOCK_GATE_ENV_TARGET}")" = "${primary}/backend/.env.local"
test "$(cat "${MOCK_GATE_E2E_ENV_TARGET}")" = "${primary}/backend/.env.e2e.local"
test "$(grep -c '^preview$' "${events}")" = 1
grep -Fq -- '--ignore-user-config' "${MOCK_CODEX_ARGS}"
grep -Fq -- '--ask-for-approval never' "${MOCK_CODEX_ARGS}"
grep -Fq -- '--model gpt-5.6-sol' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'model_reasoning_effort=high' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'sandbox_workspace_write.network_access=false' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'login shells reset PATH' "${MOCK_PROMPT}"
grep -Fq -- 'Before editing, inventory every user-visible wire value affected by the batch' "${MOCK_PROMPT}"
grep -Fq -- 'Start implementation only after every known value has a Chinese business label or is explicitly confirmed not user-visible' "${MOCK_PROMPT}"
mapping_preflight_line=$(grep -nF 'Before editing, inventory every user-visible wire value affected by the batch' "${MOCK_PROMPT}" | cut -d: -f1)
tdd_line=$(grep -nF 'Use TDD at the agreed repository seams' "${MOCK_PROMPT}" | cut -d: -f1)
test "${mapping_preflight_line}" -lt "${tdd_line}"
grep -Fq -- 'do not rerun unaffected stages already shown as passed' "${MOCK_PROMPT}"
test "$(cat "${MOCK_COREPACK_ROOT}")" = 1
test "$(cat "${MOCK_CODEX_PNPM_VERSION}")" = 10.34.5
if grep -Fqx 'wrong-homebrew-pnpm' "${events}"; then
  echo 'Codex or host gate used the wrong PATH pnpm instead of the exact cached wrapper' >&2
  exit 1
fi
test -r "${tmp}/capture/completion-candidate-verified"
test "$(grep -o -- '--add-dir ' "${MOCK_CODEX_ARGS}" | wc -l | tr -d ' ')" = 2
if grep -Fq -- "--add-dir ${primary}/node_modules" "${MOCK_CODEX_ARGS}"; then
  echo 'Codex received an unexpected primary node_modules write grant' >&2
  exit 1
fi
if grep -Fq -- '.colima/default/docker.sock' "${MOCK_CODEX_ARGS}"; then
  echo 'Codex received an unexpected Docker socket grant' >&2
  exit 1
fi
if grep -Fq -- '--dangerously-bypass-approvals-and-sandbox' "${MOCK_CODEX_ARGS}"; then
  echo 'Codex bypassed its sandbox' >&2
  exit 1
fi
test "$(cat "${MOCK_CODEX_PNPM_PATH}")" = "${runtime}/worktrees/inventory-query/.scratch/.issue-local-bin/pnpm"
test "$(cat "${MOCK_GATE_PNPM_PATH}")" = "${runtime}/worktrees/inventory-query/.scratch/.issue-local-bin/pnpm"
test ! -e "${runtime}/worktrees/inventory-query"
if git -C "${primary}" show-ref --verify --quiet refs/heads/automation/local-inventory-query; then
  echo 'completed candidate branch was not removed' >&2
  exit 1
fi
cmp -s "${tmp}/git-exclude-before" "${primary}/.git/info/exclude"
if find "${primary}/.git" \( -name 'issue-local-index-probe-*' -o -path '*/refs/issue-local-probe/*' \) -print | grep -q .; then
  echo 'Git metadata writability preflight did not clean up its probe files' >&2
  exit 1
fi
preview_line=$(grep -n '^preview$' "${events}" | cut -d: -f1)
commit_line=$(grep -n '^model-commit$' "${events}" | cut -d: -f1)
review_line=$(grep -n '^model-review$' "${events}" | cut -d: -f1)
gate_line=$(grep -n '^gate$' "${events}" | cut -d: -f1)
first_gh_line=$(grep -n '^gh ' "${events}" | sed -n '1s/:.*//p')
test "${commit_line}" -lt "${review_line}"
test "${review_line}" -lt "${gate_line}"
test "${gate_line}" -lt "${preview_line}"
test "${preview_line}" -lt "${first_gh_line}"

jq -e '.title == "First slice" and (.body | contains("First acceptance criterion"))' \
  "${tmp}/capture/issue-1.json" >/dev/null
jq -e '.title == "Second slice" and (.body | contains("Blocked by") and contains("#101"))' \
  "${tmp}/capture/issue-2.json" >/dev/null
grep -Fq '/issues/102/dependencies/blocked_by' "${tmp}/capture/dependency.txt"
grep -Fq 'issue_id=1001' "${tmp}/capture/dependency.txt"
grep -Fq 'Refs #101' "${tmp}/capture/pr-body.md"
grep -Fq 'Refs #102' "${tmp}/capture/pr-body.md"
grep -Fq 'https://zerp-preview.bytesucceed.com' "${tmp}/capture/pr-body.md"
grep -Fq '<!-- zerp-local-batch feature=inventory-query' "${tmp}/capture/pr-body.md"

grep -Fq '**Status:** done' "${feature}/01-first-slice.md"
grep -Fq -- '- [x] First acceptance criterion' "${feature}/01-first-slice.md"
grep -Fq '**Status:** done' "${feature}/02-second-slice.md"
grep -Fq -- '- [x] Second acceptance criterion' "${feature}/02-second-slice.md"
grep -Fq 'gh issue close 101' "${events}"
grep -Fq 'gh issue close 102' "${events}"
case "$(tail -n 1 "${events}")" in 'gh issue close 102 '*) ;; *) exit 1 ;; esac

PATH="${tmp}/bin:${PATH}" \
ZERP_PRIMARY_ROOT="${primary}" \
ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-local.sh" status | grep -Fq 'inventory-query: done'

echo 'local issue delivery tests passed'

make_ticket() {
  slug=$1
  title=$2
  directory="${primary}/.scratch/${slug}/issues"
  mkdir -p "${directory}"
  cat >"${directory}/01-ticket.md" <<EOF
# 01 — ${title}

**What to build:** Deliver ${title}.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] ${title} accepted
EOF
}

run_agent() {
  PATH="${tmp}/bin:${PATH}" \
  ZERP_PRIMARY_ROOT="${primary}" \
  ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  ZERP_CODEX_BIN=codex \
ZERP_GH_BIN=gh \
ZERP_ISSUE_PREVIEW_COMMAND="${tmp}/bin/preview" \
ZERP_ISSUE_PRODUCTION_COMMAND="${tmp}/bin/production" \
ZERP_ISSUE_GATE_COMMAND="${tmp}/bin/gate" \
ZERP_ISSUE_FOCUSED_E2E_COMMAND="${tmp}/bin/focused-e2e" \
    "${repo_root}/scripts/issue-local.sh" run
}

retry_agent() {
  PATH="${tmp}/bin:${PATH}" \
  ZERP_PRIMARY_ROOT="${primary}" \
  ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  ZERP_ISSUE_PREVIEW_CLOSE_COMMAND="${tmp}/bin/preview" \
    "${repo_root}/scripts/issue-local.sh" retry "$1"
}

stop_agent() {
  PATH="${tmp}/bin:${PATH}" \
  ZERP_PRIMARY_ROOT="${primary}" \
  ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  ZERP_ISSUE_STOP_GRACE_SECONDS="${ZERP_ISSUE_STOP_GRACE_SECONDS:-5}" \
  ZERP_ISSUE_STOP_KILL_SECONDS="${ZERP_ISSUE_STOP_KILL_SECONDS:-5}" \
    "${repo_root}/scripts/issue-local.sh" stop
}

prepare_reviewed_candidate() {
  slug=$1
  marker=${2:-}
  make_ticket "${slug}" "${slug}"
  batch_root="${runtime}/batches/${slug}"
  candidate="${runtime}/worktrees/${slug}"
  branch="automation/local-${slug}"
  mkdir -p "${batch_root}" "$(dirname "${candidate}")"
  git -C "${primary}" worktree add -b "${branch}" "${candidate}" main >/dev/null
  printf 'reviewed\n' >"${candidate}/reviewed.txt"
  git -C "${candidate}" add reviewed.txt
  git -C "${candidate}" -c user.name='Local Implement' -c user.email=local@example.com \
    commit -m 'feat: reviewed candidate' >/dev/null
  base_sha=$(git -C "${primary}" rev-parse main)
  head_sha=$(git -C "${candidate}" rev-parse HEAD)
  write_value_file="${batch_root}/base-sha"
  printf '%s\n' "${base_sha}" >"${write_value_file}"
  jq -n --arg head "${head_sha}" \
    '{status:"blocked",summary:"reviewed before host gate",commitSha:$head,validation:"not_run",review:"passed"}' \
    >"${batch_root}/implementation.json"
  if [ -n "${marker}" ]; then printf '%s\n' "${head_sha}" >"${batch_root}/gate-attempted-head"; fi
  ticket="${primary}/.scratch/${slug}/issues/01-ticket.md"
  sed 's/^\*\*Status:\*\*.*/**Status:** blocked/' "${ticket}" >"${ticket}.new"
  mv "${ticket}.new" "${ticket}"
}

make_ticket dependency-lock-mismatch 'Dependency lock mismatch'
mismatch_worktree="${runtime}/worktrees/dependency-lock-mismatch"
mkdir -p "$(dirname "${mismatch_worktree}")"
git -C "${primary}" worktree add -b automation/local-dependency-lock-mismatch \
  "${mismatch_worktree}" main >/dev/null
printf 'lockfileVersion: "different"\n' >"${mismatch_worktree}/pnpm-lock.yaml"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_COREPACK_ROOT}"
if run_agent; then
  echo 'mismatched candidate lockfile was accepted' >&2
  exit 1
fi
test ! -e "${MOCK_CODEX_COUNT}"
test ! -e "${MOCK_COREPACK_ROOT}"
test ! -s "${events}"
grep -Fq '**Status:** blocked' "${primary}/.scratch/dependency-lock-mismatch/issues/01-ticket.md"

make_ticket dependency-missing 'Dependency missing'
mv "${primary}/frontend/node_modules" "${primary}/frontend/node_modules.saved"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_COREPACK_ROOT}"
if run_agent; then
  echo 'missing primary dependencies were accepted' >&2
  exit 1
fi
mv "${primary}/frontend/node_modules.saved" "${primary}/frontend/node_modules"
test ! -e "${MOCK_CODEX_COUNT}"
test ! -e "${MOCK_COREPACK_ROOT}"
test ! -s "${events}"
grep -Fq '**Status:** blocked' "${primary}/.scratch/dependency-missing/issues/01-ticket.md"

make_ticket pnpm-cache-missing 'Exact pnpm cache missing'
mkdir -p "${tmp}/empty-pnpm-store"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_COREPACK_ROOT}"
if ZERP_PNPM_STORE_PATH="${tmp}/empty-pnpm-store" run_agent; then
  echo 'missing exact pnpm cache was accepted' >&2
  exit 1
fi
ZERP_PNPM_STORE_PATH="${pnpm_store}"
test ! -e "${MOCK_CODEX_COUNT}"
test ! -e "${MOCK_COREPACK_ROOT}"
test ! -s "${events}"
grep -Fq '**Status:** blocked' "${primary}/.scratch/pnpm-cache-missing/issues/01-ticket.md"

prepare_reviewed_candidate retry-managed-link
managed_candidate="${runtime}/worktrees/retry-managed-link"
printf '.scratch/\nbackend/var/\nnode_modules/\n' >"${managed_candidate}/.gitignore"
git -C "${managed_candidate}" add .gitignore
git -C "${managed_candidate}" -c user.name='Local Implement' -c user.email=local@example.com \
  commit --amend --no-edit >/dev/null
managed_head=$(git -C "${managed_candidate}" rev-parse HEAD)
jq --arg head "${managed_head}" '.commitSha = $head' \
  "${runtime}/batches/retry-managed-link/implementation.json" \
  >"${runtime}/batches/retry-managed-link/implementation.json.new"
mv "${runtime}/batches/retry-managed-link/implementation.json.new" \
  "${runtime}/batches/retry-managed-link/implementation.json"
ln -s "${primary}/node_modules" "${managed_candidate}/node_modules"
git -C "${managed_candidate}" status --porcelain | grep -Fq '?? node_modules'
retry_agent retry-managed-link
test -r "${runtime}/batches/retry-managed-link/implementation.json"
test ! -e "${managed_candidate}/node_modules"
managed_ticket="${primary}/.scratch/retry-managed-link/issues/01-ticket.md"
sed 's/^\*\*Status:\*\*.*/**Status:** blocked/' "${managed_ticket}" >"${managed_ticket}.new"
mv "${managed_ticket}.new" "${managed_ticket}"

make_ticket retry-active-controller 'Retry active controller'
active_ticket="${primary}/.scratch/retry-active-controller/issues/01-ticket.md"
: >"${events}"
rm -rf "${runtime}/agent.lock"
MOCK_CODEX_SLEEP=1 run_agent >"${tmp}/active-controller.log" 2>&1 &
active_runner=$!
attempts=100
until [ -r "${runtime}/agent.lock/command" ] && grep -q '^codex$' "${events}" ||
  [ "${attempts}" -eq 0 ]; do
  sleep 0.05
  attempts=$((attempts - 1))
done
test "${attempts}" -gt 0
active_pid=$(cat "${runtime}/agent.lock/pid")
if retry_agent retry-active-controller; then
  echo 'retry accepted an active controller' >&2
  stop_agent || true
  wait "${active_runner}" 2>/dev/null || true
  exit 1
fi
stop_agent
test -r "${runtime}/disabled"
wait "${active_runner}" 2>/dev/null || true
if kill -0 "${active_pid}" 2>/dev/null; then
  echo 'stop left the controller process group alive' >&2
  exit 1
fi
test ! -e "${runtime}/agent.lock"
# shellcheck disable=SC2016 # intentional literal source assertions
grep -Fq '/bin/kill -TERM -- "-${controller_pgid}"' "${repo_root}/scripts/issue-local.sh"
# shellcheck disable=SC2016
grep -Fq '/bin/kill -KILL -- "-${controller_pgid}"' "${repo_root}/scripts/issue-local.sh"
sed 's/^\*\*Status:\*\*.*/**Status:** blocked/' "${active_ticket}" >"${active_ticket}.new"
mv "${active_ticket}.new" "${active_ticket}"
rm -f "${runtime}/disabled"

sleep 30 &
shared_pid=$!
mkdir -p "${runtime}/agent.lock"
printf '%s\n' "${shared_pid}" >"${runtime}/agent.lock/pid"
ps -o pgid= -p "${shared_pid}" | tr -d ' ' >"${runtime}/agent.lock/pgid"
ps -o lstart= -p "${shared_pid}" | sed 's/^[[:space:]]*//' >"${runtime}/agent.lock/started"
ps -o command= -p "${shared_pid}" | sed 's/^[[:space:]]*//' >"${runtime}/agent.lock/command"
printf '%s\n' "${repo_root}/scripts/issue-local.sh" >"${runtime}/agent.lock/script"
if stop_agent; then
  echo 'stop accepted an unverifiable shared process group' >&2
  kill "${shared_pid}" 2>/dev/null || true
  wait "${shared_pid}" 2>/dev/null || true
  exit 1
fi
kill -0 "${shared_pid}"
kill "${shared_pid}"
wait "${shared_pid}" 2>/dev/null || true
rm -rf "${runtime}/agent.lock"
rm -f "${runtime}/disabled"

prepare_reviewed_candidate resume-reviewed
retry_agent resume-reviewed
test -r "${runtime}/batches/resume-reviewed/implementation.json"
test ! -e "${runtime}/batches/resume-reviewed/gate-attempted-head"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
run_agent
test ! -e "${MOCK_CODEX_COUNT}"
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/resume-reviewed/issues/01-ticket.md"

prepare_reviewed_candidate resume-marker marker
retry_agent resume-marker
test -r "${runtime}/batches/resume-marker/implementation.json"
test ! -e "${runtime}/batches/resume-marker/gate-attempted-head"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
run_agent
test ! -e "${MOCK_CODEX_COUNT}"
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1

prepare_reviewed_candidate resume-dirty
printf 'dirty\n' >"${runtime}/worktrees/resume-dirty/dirty.txt"
retry_agent resume-dirty
test ! -e "${runtime}/batches/resume-dirty/implementation.json"
ticket="${primary}/.scratch/resume-dirty/issues/01-ticket.md"
sed 's/^\*\*Status:\*\*.*/**Status:** blocked/' "${ticket}" >"${ticket}.new"
mv "${ticket}.new" "${ticket}"

prepare_reviewed_candidate resume-mismatch
jq '.commitSha = "0000000000000000000000000000000000000000"' \
  "${runtime}/batches/resume-mismatch/implementation.json" \
  >"${runtime}/batches/resume-mismatch/implementation.json.new"
mv "${runtime}/batches/resume-mismatch/implementation.json.new" \
  "${runtime}/batches/resume-mismatch/implementation.json"
retry_agent resume-mismatch
test ! -e "${runtime}/batches/resume-mismatch/implementation.json"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 1

prepare_reviewed_candidate resume-manual-repair marker
manual_candidate="${runtime}/worktrees/resume-manual-repair"
manual_review_base=$(cat "${runtime}/batches/resume-manual-repair/gate-attempted-head")
printf 'manual repair\n' >"${manual_candidate}/manual-repair.txt"
git -C "${manual_candidate}" add manual-repair.txt
git -C "${manual_candidate}" -c user.name='Local Repair' -c user.email=local@example.com \
  commit -m 'fix: manual repair' >/dev/null
printf 'focused prior failure\n' >"${runtime}/batches/resume-manual-repair/failure.md"
rm -f "${runtime}/batches/resume-manual-repair/implementation.json"
retry_agent resume-manual-repair
test ! -e "${runtime}/batches/resume-manual-repair/implementation.json"
test -r "${runtime}/batches/resume-manual-repair/failure.md"
test "$(cat "${runtime}/batches/resume-manual-repair/reviewed-head")" = "${manual_review_base}"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_CODEX_REVIEW_EXISTING=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test ! -e "${manual_candidate}"
if grep -q '^model-commit$' "${events}"; then
  echo 'manual repair review created a redundant commit' >&2
  exit 1
fi
grep -Fq 'unreviewed manual repair' "${MOCK_PROMPT}-1"
grep -Fq 'review only the repair delta' "${MOCK_PROMPT}-1"

prepare_reviewed_candidate marker-without-retry marker
old_marker=$(cat "${runtime}/batches/marker-without-retry/gate-attempted-head")
ticket="${primary}/.scratch/marker-without-retry/issues/01-ticket.md"
sed 's/^\*\*Status:\*\*.*/**Status:** ready-for-agent/' "${ticket}" >"${ticket}.new"
mv "${ticket}.new" "${ticket}"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test "$(grep -n '^model-commit$' "${events}" | cut -d: -f1)" -lt \
  "$(grep -n '^gate$' "${events}" | cut -d: -f1)"
test "$(cat "${runtime}/batches/marker-without-retry/gate-attempted-head")" != "${old_marker}"

make_ticket gate-repair 'Gate repair'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_FOCUSED_E2E_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=1 MOCK_GATE_LONG_FAILURE=1 MOCK_GATE_E2E_FAILURE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(cat "${MOCK_FOCUSED_E2E_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq 'Host final gate failed' "${MOCK_PROMPT}-2"
grep -Fq 'simulated host gate failure' "${MOCK_PROMPT}-2"
grep -Fq 'review only the repair delta' "${MOCK_PROMPT}-2"
grep -Fq 'tests/e2e/user-management-lifecycle.spec.ts' "${MOCK_PROMPT}-2"
if grep -Fxq 'successful gate output line 1' "${MOCK_PROMPT}-2"; then
  echo 'repair prompt retained unrelated early gate output' >&2
  exit 1
fi
grep -Fq 'focused-e2e tests/e2e/user-management-lifecycle.spec.ts --project=system-serial --no-deps' "${events}"
test "$(cat "${MOCK_FOCUSED_E2E_ENV_TARGET}")" = "${primary}/backend/.env.e2e.local"
grep -Fq '**Status:** done' "${primary}/.scratch/gate-repair/issues/01-ticket.md"
unset MOCK_GATE_LONG_FAILURE MOCK_GATE_E2E_FAILURE

make_ticket gate-blocked 'Gate blocked'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_GATE_FAILS=3 run_agent; then
  echo 'repeated identical host gate failures were accepted' >&2
  exit 1
fi
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test ! -e "${MOCK_PREVIEW_COUNT}"
if grep -q '^gh ' "${events}"; then
  echo 'GitHub was accessed after failed host gates' >&2
  exit 1
fi
grep -Fq 'Host final gate failed' "${runtime}/batches/gate-blocked/failure.md"
grep -Fq '**Status:** blocked' "${primary}/.scratch/gate-blocked/issues/01-ticket.md"
test "$(jq -r .total "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq -r .consecutive "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq '.events | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
unset MOCK_GATE_FAILS
retry_agent gate-blocked
test "$(jq -r .total "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq -r .consecutive "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq '.recoveries | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 0
gate_blocked_worktree="${runtime}/worktrees/gate-blocked"
printf 'manual repair\n' >"${gate_blocked_worktree}/manual-repair.txt"
git -C "${gate_blocked_worktree}" add manual-repair.txt
git -C "${gate_blocked_worktree}" -c user.name='Manual Repair' -c user.email=manual@example.com \
  commit -m 'fix: manual gate repair' >/dev/null
manual_repair_head=$(git -C "${gate_blocked_worktree}" rev-parse HEAD)
retry_agent gate-blocked
test "$(jq -r .total "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq -r .consecutive "${runtime}/batches/gate-blocked/repair-budget.json")" = 0
test "$(jq '.events | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq '.recoveries | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 1
test "$(jq -r '.events[-1].candidateHead' "${runtime}/batches/gate-blocked/repair-budget.json")" != null
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}"
MOCK_CODEX_REVIEW_EXISTING=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/gate-blocked/repair-budget.json")" = 3
test "$(jq '.events | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 3
test "$(jq '.recoveries | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 1
test "$(jq -r '.recoveries[0].previousConsecutive' "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq -r '.recoveries[0].candidateHead' "${runtime}/batches/gate-blocked/repair-budget.json")" = "${manual_repair_head}"
unset MOCK_CODEX_REVIEW_EXISTING

make_ticket gate-fingerprint-advance 'Gate fingerprint advance'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=2 MOCK_GATE_FAILURE_UNIQUE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 3
test "$(cat "${MOCK_GATE_COUNT}")" = 3
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/gate-fingerprint-advance/repair-budget.json")" = 3
test "$(jq -r .consecutive "${runtime}/batches/gate-fingerprint-advance/repair-budget.json")" = 1

make_ticket gate-numeric-fingerprint-advance 'Gate numeric fingerprint advance'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=2 MOCK_GATE_FAILURE_NUMERIC_UNIQUE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 3
test "$(cat "${MOCK_GATE_COUNT}")" = 3
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/gate-numeric-fingerprint-advance/repair-budget.json")" = 3
test "$(jq -r .consecutive "${runtime}/batches/gate-numeric-fingerprint-advance/repair-budget.json")" = 1
unset MOCK_GATE_FAILURE_NUMERIC_UNIQUE

make_ticket repair-stage-advance 'Repair stage advance'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_CODEX_FAILS=1 MOCK_GATE_FAILS=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 3
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/repair-stage-advance/repair-budget.json")" = 3
test "$(jq -r .consecutive "${runtime}/batches/repair-stage-advance/repair-budget.json")" = 1
unset MOCK_CODEX_FAILS

make_ticket code-review-retry 'Code review retry'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_CODEX_FAILS=3 run_agent; then
  echo 'repeated identical code review failures were accepted' >&2
  exit 1
fi
unset MOCK_CODEX_FAILS
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test ! -e "${MOCK_GATE_COUNT}"
test ! -e "${runtime}/batches/code-review-retry/gate-attempted-head"
test "$(jq -r .consecutive "${runtime}/batches/code-review-retry/repair-budget.json")" = 2
test "$(jq -r '.events[-1].candidateHead' "${runtime}/batches/code-review-retry/repair-budget.json")" != null
retry_agent code-review-retry
test "$(jq -r .consecutive "${runtime}/batches/code-review-retry/repair-budget.json")" = 2
test "$(jq '.recoveries | length' "${runtime}/batches/code-review-retry/repair-budget.json")" = 0
code_review_worktree="${runtime}/worktrees/code-review-retry"
printf 'manual code review repair\n' >"${code_review_worktree}/manual-repair.txt"
git -C "${code_review_worktree}" add manual-repair.txt
git -C "${code_review_worktree}" -c user.name='Manual Repair' -c user.email=manual@example.com \
  commit -m 'fix: manual code review repair' >/dev/null
manual_code_review_head=$(git -C "${code_review_worktree}" rev-parse HEAD)
retry_agent code-review-retry
test "$(jq -r .consecutive "${runtime}/batches/code-review-retry/repair-budget.json")" = 0
test "$(jq '.recoveries | length' "${runtime}/batches/code-review-retry/repair-budget.json")" = 1
test "$(jq -r '.recoveries[0].candidateHead' "${runtime}/batches/code-review-retry/repair-budget.json")" = "${manual_code_review_head}"
ticket="${primary}/.scratch/code-review-retry/issues/01-ticket.md"
sed 's/^\*\*Status:\*\*.*/**Status:** blocked/' "${ticket}" >"${ticket}.new"
mv "${ticket}.new" "${ticket}"

make_ticket gate-budget-blocked 'Gate budget blocked'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_GATE_FAILS=9 MOCK_GATE_FAILURE_UNIQUE=1 run_agent; then
  echo 'repair budget allowed more than eight code/review/gate repairs' >&2
  exit 1
fi
test "$(cat "${MOCK_CODEX_COUNT}")" = 8
test "$(cat "${MOCK_GATE_COUNT}")" = 8
test ! -e "${MOCK_PREVIEW_COUNT}"
test "$(jq -r .total "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = 8
grep -Fq 'Repair budget exhausted' "${runtime}/batches/gate-budget-blocked/failure.md"
test "$(grep -c 'Repair budget exhausted:' "${runtime}/batches/gate-budget-blocked/failure.md")" = 1
unset MOCK_GATE_FAILURE_UNIQUE

make_ticket legacy-model-validation 'Legacy model validation'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=0 MOCK_VALIDATION=passed run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/legacy-model-validation/issues/01-ticket.md"
unset MOCK_GATE_FAILS MOCK_VALIDATION

make_ticket preview-repair 'Preview repair'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
export MOCK_PREVIEW_FAILS=1
if run_agent; then
  echo 'preview environment failure was accepted' >&2
  exit 1
fi
unset MOCK_PREVIEW_FAILS
test "$(grep -c '^codex$' "${events}")" = 1
test "$(grep -c '^gate$' "${events}")" = 1
test "$(grep -c '^preview$' "${events}")" = 1
if grep -q '^gh ' "${events}"; then
  echo 'GitHub was accessed after a preview environment failure' >&2
  exit 1
fi
grep -Fq 'simulated preview environment failure 1' "${runtime}/batches/preview-repair/preview.log"
grep -Fq 'simulated preview stdout 1' "${runtime}/batches/preview-repair/preview.log"
grep -Fq 'simulated preview environment failure 1' "${runtime}/batches/preview-repair/failure.md"
grep -Fq 'simulated preview stdout 1' "${runtime}/batches/preview-repair/failure.md"
grep -Fq '**Status:** blocked' "${primary}/.scratch/preview-repair/issues/01-ticket.md"
test "$(cat "${runtime}/batches/preview-repair/state")" = preview-blocked
test "$(jq -r .total "${runtime}/batches/preview-repair/repair-budget.json")" = 1
printf 'stale successful gate marker\n' >"${runtime}/batches/preview-repair/repair-e2e.env"
export MOCK_PREVIEW_CLOSE_TICKET="${primary}/.scratch/preview-repair/issues/01-ticket.md"
export MOCK_PREVIEW_CLOSE_EXPECT_STATUS=blocked
retry_agent preview-repair
unset MOCK_PREVIEW_CLOSE_TICKET MOCK_PREVIEW_CLOSE_EXPECT_STATUS
test -r "${runtime}/batches/preview-repair/gate-evidence.json"
test ! -e "${runtime}/batches/preview-repair/repair-e2e.env"
test -r "${runtime}/batches/preview-repair/failure.md"
test "$(jq -r .total "${runtime}/batches/preview-repair/repair-budget.json")" = 1
grep -Fq '**Status:** ready-for-agent' \
  "${primary}/.scratch/preview-repair/issues/01-ticket.md"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
export MOCK_PREVIEW_FAILS=0
run_agent
unset MOCK_PREVIEW_FAILS
test ! -e "${MOCK_CODEX_COUNT}"
test ! -e "${MOCK_GATE_COUNT}"
test "$(grep -c '^preview$' "${events}")" = 1
test "$(jq -r .total "${runtime}/batches/preview-repair/repair-budget.json")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/preview-repair/issues/01-ticket.md"

make_ticket preview-blocked 'Preview blocked'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
export MOCK_PREVIEW_FAILS=3
if run_agent; then
  echo 'preview environment failure was accepted' >&2
  exit 1
fi
unset MOCK_PREVIEW_FAILS
test "$(grep -c '^codex$' "${events}")" = 1
test "$(grep -c '^gate$' "${events}")" = 1
test "$(grep -c '^preview$' "${events}")" = 1
if grep -q '^gh ' "${events}"; then
  echo 'GitHub was accessed before a preview passed' >&2
  exit 1
fi
grep -Fq '**Status:** blocked' "${primary}/.scratch/preview-blocked/issues/01-ticket.md"

make_ticket needs-decision 'Needs decision'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_CODEX_MODE=needs-input run_agent; then
  echo 'needs-input result was accepted' >&2
  exit 1
fi
test "$(grep -c '^codex$' "${events}")" = 1
if grep -Eq '^(preview|gh )' "${events}"; then
  echo 'needs-input batch reached preview or GitHub' >&2
  exit 1
fi
grep -Fq '**Status:** needs-input' "${primary}/.scratch/needs-decision/issues/01-ticket.md"

make_ticket checks-registering 'Checks registering'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
MOCK_CODEX_MODE=completed MOCK_PREVIEW_FAILS=0 MOCK_CHECKS_MISSING=1 \
  MOCK_CHECKS_MISSING_MESSAGE=plain \
  ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_CHECK_COUNT}")" = 2
grep -Fq '**Status:** done' "${primary}/.scratch/checks-registering/issues/01-ticket.md"

make_ticket checks-repeated 'Checks repeated'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
export MOCK_CHECKS_MISSING=0 MOCK_CHECKS_FAILS=2
if ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent; then
  echo 'repeated identical required-check failures were accepted' >&2
  exit 1
fi
unset MOCK_CHECKS_MISSING MOCK_CHECKS_FAILS
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(cat "${MOCK_CHECK_COUNT}")" = 2
test "$(jq -r .total "${runtime}/batches/checks-repeated/repair-budget.json")" = 2
test "$(jq -r .consecutive "${runtime}/batches/checks-repeated/repair-budget.json")" = 2
grep -Fq '**Status:** blocked' "${primary}/.scratch/checks-repeated/issues/01-ticket.md"

make_ticket rebase-refresh 'Rebase refresh'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
runtime_fingerprint=$(ZERP_FINGERPRINT_REPO_ROOT="${primary}" \
  "${repo_root}/scripts/runtime-fingerprint.sh" HEAD)
MOCK_CODEX_MODE=completed MOCK_PREVIEW_FAILS=0 MOCK_CHECKS_MISSING=0 \
  MOCK_CHECK_MODE=advance-main-once MOCK_RUNTIME_FINGERPRINT="${runtime_fingerprint}" \
  ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_CHECK_COUNT}")" = 2
grep -Fq 'gh pr edit 77' "${events}"
grep -Fq '**Status:** done' "${primary}/.scratch/rebase-refresh/issues/01-ticket.md"

prepare_reviewed_candidate published-resume
published_batch="${runtime}/batches/published-resume"
published_candidate="${runtime}/worktrees/published-resume"
published_branch=automation/local-published-resume
old_published_head=$(git -C "${published_candidate}" rev-parse HEAD)
git -C "${published_candidate}" push origin "HEAD:refs/heads/${published_branch}" >/dev/null
printf 'published upstream\n' >"${primary}/published-upstream.txt"
git -C "${primary}" add published-upstream.txt
git -C "${primary}" commit -m 'published upstream' >/dev/null
git -C "${primary}" push origin main >/dev/null
git -C "${published_candidate}" rebase main >/dev/null
published_head=$(git -C "${published_candidate}" rev-parse HEAD)
published_base=$(git -C "${primary}" rev-parse HEAD)
printf '%s\n' "${published_base}" >"${published_batch}/base-sha"
jq -n --arg head "${published_head}" --arg base "${published_base}" \
  '{status:"passed",head:$head,base:$base,runtimeFingerprint:"runtime-one",previewRequired:true}' \
  >"${published_batch}/gate-evidence.json"
printf 'url=https://zerp-preview.bytesucceed.com\nfingerprint=runtime-one\n' \
  >"${published_batch}/preview.env"
printf '1\t155\t1550\n' >"${published_batch}/remote-issues.tsv"
printf '77\n' >"${published_batch}/pr-number"
published_ticket="${primary}/.scratch/published-resume/issues/01-ticket.md"
sed 's/^\*\*Status:\*\*.*/**Status:** ready-for-agent/' "${published_ticket}" \
  >"${published_ticket}.new"
mv "${published_ticket}.new" "${published_ticket}"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}" "${tmp}/published-trace.json"
MOCK_EXISTING_PR_HEAD="${old_published_head}" \
MOCK_EXISTING_PR_BRANCH="${published_branch}" \
MOCK_CHECK_MODE=normal \
MOCK_REQUIRE_PR_BODY_BEFORE_PUSH=1 \
MOCK_EXPECTED_PUSH_HEAD="${published_head}" \
MOCK_EXPECTED_PUSH_BRANCH="${published_branch}" \
GIT_TRACE2_EVENT="${tmp}/published-trace.json" run_agent
test ! -e "${MOCK_CODEX_COUNT}"
test ! -e "${MOCK_GATE_COUNT}"
test ! -e "${MOCK_PREVIEW_COUNT}"
test ! -e "${MOCK_ISSUE_COUNT}"
if grep -Eq 'gh (api --method POST repos/example/zerp/issues|pr create|pr list)' "${events}"; then
  echo 'published batch recovery duplicated a remote object' >&2
  exit 1
fi
grep -Fq 'gh pr edit 77' "${events}"
test "$(grep -n 'gh pr edit 77' "${events}" | sed -n '1s/:.*//p')" -lt \
  "$(grep -n 'gh pr checks 77' "${events}" | sed -n '1s/:.*//p')"
grep -Fq "head=${published_head} fingerprint=runtime-one" "${tmp}/capture/pr-body.md"
test "$(git --git-dir="${remote}" rev-parse "refs/heads/${published_branch}")" = \
  "${published_head}"
test ! -e "${published_batch}/pr-body.previous.md"
jq -e --arg lease \
  "--force-with-lease=refs/heads/${published_branch}:${old_published_head}" \
  'select(.event == "start") | select(.argv | index($lease))' \
  "${tmp}/published-trace.json" >/dev/null
grep -Fq '**Status:** done' "${published_ticket}"
unset MOCK_EXISTING_PR_HEAD MOCK_EXISTING_PR_BRANCH MOCK_REQUIRE_PR_BODY_BEFORE_PUSH \
  MOCK_EXPECTED_PUSH_HEAD MOCK_EXPECTED_PUSH_BRANCH GIT_TRACE2_EVENT

make_ticket queue-first 'Queue first'
make_ticket queue-second 'Queue second'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
MOCK_CODEX_MODE=completed MOCK_PREVIEW_FAILS=0 MOCK_CHECKS_MISSING=0 \
  MOCK_CHECK_MODE=normal MOCK_RUNTIME_FINGERPRINT=runtime-one run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
grep -Fq '**Status:** done' "${primary}/.scratch/queue-first/issues/01-ticket.md"
grep -Fq '**Status:** done' "${primary}/.scratch/queue-second/issues/01-ticket.md"

echo 'local issue retry and stop tests passed'
