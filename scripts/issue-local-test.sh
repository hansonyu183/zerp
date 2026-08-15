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
git -C "${primary}" init -b main >/dev/null
git -C "${primary}" config user.name 'Issue Local Test'
git -C "${primary}" config user.email issue-local-test@example.com
mkdir -p "${primary}/backend/var" "${primary}/node_modules/.pnpm" \
  "${primary}/node_modules/.bin" "${primary}/frontend/node_modules/.bin" \
  "${primary}/frontend/node_modules/.pnpm" "${primary}/frontend/node_modules/.tmp" \
  "${primary}/frontend/node_modules/.vite" "${primary}/frontend/node_modules/.vite-temp" \
  "${primary}/frontend/node_modules/.pnpm-store"
printf '.scratch/\nbackend/var/\nnode_modules\n' >"${primary}/.gitignore"
printf 'seed\n' >"${primary}/README.md"
printf 'backend seed\n' >"${primary}/backend/README.md"
printf 'lockfileVersion: "9.0"\n' >"${primary}/pnpm-lock.yaml"
printf '{"packageManager":"pnpm@10.34.5"}\n' >"${primary}/package.json"
printf 'TEST_POSTGRES_DB=issue_local_test\n' >"${primary}/backend/.env.local"
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
if [ -e "${worktree}/backend/.env.local" ] || [ -L "${worktree}/backend/.env.local" ]; then
  echo 'Codex received the host backend environment file' >&2
  exit 3
fi
printf 'codex\n' >>"${MOCK_EVENTS}"
printf '%s\n' "${prompt}" >"${MOCK_PROMPT}"
printf '%s\n' "${prompt}" | grep -Fq '$implement'
count=$(cat "${MOCK_CODEX_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_CODEX_COUNT}"
printf '%s\n' "${prompt}" >"${MOCK_PROMPT}-${count}"
mkdir -p "${worktree}/.pnpm-store" "${worktree}/frontend/node_modules/.pnpm-store"
if [ "${MOCK_CODEX_MODE:-completed}" = needs-input ]; then
  jq -n '{status:"needs_input",summary:"decision required",commitSha:"",validation:"not_run",review:"not_run"}' >"${output}"
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
  echo "simulated host gate failure ${count}" >&2
  exit 1
fi
head=$(git rev-parse HEAD)
jq -n --arg head "${head}" --arg base "$1" \
  --arg runtime_fingerprint "${MOCK_RUNTIME_FINGERPRINT:-runtime-one}" \
  '{status:"passed",head:$head,base:$base,runtimeFingerprint:$runtime_fingerprint}' \
  >"${ZERP_GATE_EVIDENCE_FILE}"
EOF
chmod +x "${tmp}/bin/gate"

cat >"${tmp}/bin/preview" <<'EOF'
#!/bin/sh
set -eu
printf 'preview\n' >>"${MOCK_EVENTS}"
count=$(cat "${MOCK_PREVIEW_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_PREVIEW_COUNT}"
if [ "${count}" -le "${MOCK_PREVIEW_FAILS:-0}" ]; then exit 1; fi
printf 'url=https://zerp-preview.bytesucceed.com\n'
printf 'fingerprint=%s\n' "${MOCK_RUNTIME_FINGERPRINT:-runtime-one}"
EOF
chmod +x "${tmp}/bin/preview"

cat >"${tmp}/bin/production" <<'EOF'
#!/bin/sh
set -eu
printf 'production\n' >>"${MOCK_EVENTS}"
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
      echo "no required checks reported on the test branch" >&2
      exit 1
    fi
    exit 0
    ;;
  *' pr merge 77 '*) printf '{}\n' ;;
  *' pr edit 77 '*) printf '{}\n' ;;
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
export MOCK_GATE_COREPACK_ROOT="${tmp}/gate-corepack-root"
export MOCK_CODEX_PNPM_PATH="${tmp}/codex-pnpm-path"
export MOCK_CODEX_PNPM_VERSION="${tmp}/codex-pnpm-version"
export MOCK_GATE_PNPM_PATH="${tmp}/gate-pnpm-path"
export MOCK_GATE_PNPM_VERSION="${tmp}/gate-pnpm-version"
export MOCK_GATE_ENV_TARGET="${tmp}/gate-env-target"
export ZERP_PNPM_STORE_PATH="${pnpm_store}"
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
  "${repo_root}/scripts/issue-local.sh" run

test "$(cat "${tmp}/issue-count")" = 2
test "$(grep -c '^codex$' "${events}")" = 1
test "$(grep -c '^gate$' "${events}")" = 1
test "$(cat "${MOCK_GATE_COREPACK_ROOT}")" = 1
test "$(cat "${MOCK_GATE_PNPM_VERSION}")" = 10.34.5
test "$(cat "${MOCK_GATE_ENV_TARGET}")" = "${primary}/backend/.env.local"
test "$(grep -c '^preview$' "${events}")" = 1
grep -Fq -- '--ignore-user-config' "${MOCK_CODEX_ARGS}"
grep -Fq -- '--ask-for-approval never' "${MOCK_CODEX_ARGS}"
grep -Fq -- '--model gpt-5.6-sol' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'model_reasoning_effort=high' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'sandbox_workspace_write.network_access=false' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'login shells reset PATH' "${MOCK_PROMPT}"
grep -Fq -- 'business-error-coverage.spec.ts' "${MOCK_PROMPT}"
grep -Fq -- 'do not rerun unaffected stages already shown as passed' "${MOCK_PROMPT}"
test "$(cat "${MOCK_COREPACK_ROOT}")" = 1
test "$(cat "${MOCK_CODEX_PNPM_VERSION}")" = 10.34.5
worktree_git_dir=$(git -C "${runtime}/worktrees/inventory-query" rev-parse --path-format=absolute --git-dir)
common_git_dir=$(git -C "${runtime}/worktrees/inventory-query" rev-parse --path-format=absolute --git-common-dir)
grep -Fq -- "--add-dir ${worktree_git_dir}" "${MOCK_CODEX_ARGS}"
grep -Fq -- "--add-dir ${common_git_dir}" "${MOCK_CODEX_ARGS}"
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
test -L "${runtime}/worktrees/inventory-query/node_modules"
test "$(cat "${MOCK_CODEX_PNPM_PATH}")" = "${runtime}/worktrees/inventory-query/.scratch/.issue-local-bin/pnpm"
test "$(cat "${MOCK_GATE_PNPM_PATH}")" = "${runtime}/worktrees/inventory-query/.scratch/.issue-local-bin/pnpm"
test ! -e "${runtime}/worktrees/inventory-query/backend/.env.local"
test ! -L "${runtime}/worktrees/inventory-query/backend/.env.local"
test "$(readlink "${runtime}/worktrees/inventory-query/node_modules")" = "${primary}/node_modules"
test -d "${runtime}/worktrees/inventory-query/frontend/node_modules/.tmp"
test ! -e "${runtime}/worktrees/inventory-query/frontend/node_modules/.tmp/primary-cache"
test ! -e "${runtime}/worktrees/inventory-query/frontend/node_modules/.pnpm"
test ! -e "${runtime}/worktrees/inventory-query/frontend/node_modules/.vite"
test ! -e "${runtime}/worktrees/inventory-query/frontend/node_modules/.vite-temp"
test ! -e "${runtime}/worktrees/inventory-query/.pnpm-store"
test ! -e "${runtime}/worktrees/inventory-query/frontend/node_modules/.pnpm-store"
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
    "${repo_root}/scripts/issue-local.sh" run
}

retry_agent() {
  PATH="${tmp}/bin:${PATH}" \
  ZERP_PRIMARY_ROOT="${primary}" \
  ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  "${repo_root}/scripts/issue-local.sh" retry "$1"
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
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=1 MOCK_GATE_LONG_FAILURE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq 'Host final gate failed' "${MOCK_PROMPT}-2"
grep -Fq 'simulated host gate failure 1' "${MOCK_PROMPT}-2"
grep -Fq '**Status:** done' "${primary}/.scratch/gate-repair/issues/01-ticket.md"
unset MOCK_GATE_LONG_FAILURE

make_ticket gate-blocked 'Gate blocked'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_GATE_FAILS=3 run_agent; then
  echo 'three failed host gates were accepted' >&2
  exit 1
fi
test "$(cat "${MOCK_CODEX_COUNT}")" = 3
test "$(cat "${MOCK_GATE_COUNT}")" = 3
test ! -e "${MOCK_PREVIEW_COUNT}"
if grep -q '^gh ' "${events}"; then
  echo 'GitHub was accessed after failed host gates' >&2
  exit 1
fi
grep -Fq 'Host final gate failed' "${runtime}/batches/gate-blocked/failure.md"
grep -Fq '**Status:** blocked' "${primary}/.scratch/gate-blocked/issues/01-ticket.md"

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
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_PREVIEW_FAILS=1 run_agent
test "$(grep -c '^codex$' "${events}")" = 2
test "$(grep -c '^preview$' "${events}")" = 2
test "$(grep -n '^preview$' "${events}" | tail -n 1 | cut -d: -f1)" -lt \
  "$(grep -n '^gh ' "${events}" | head -n 1 | cut -d: -f1)"

make_ticket preview-blocked 'Preview blocked'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_PREVIEW_FAILS=3 run_agent; then
  echo 'three failed preview attempts were accepted' >&2
  exit 1
fi
test "$(grep -c '^codex$' "${events}")" = 3
test "$(grep -c '^preview$' "${events}")" = 3
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
  ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_CHECK_COUNT}")" = 2
grep -Fq '**Status:** done' "${primary}/.scratch/checks-registering/issues/01-ticket.md"

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
