#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-local-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
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
mkdir -p "${primary}/backend/var"
printf '.scratch/\nbackend/var/\n' >"${primary}/.gitignore"
printf 'seed\n' >"${primary}/README.md"
git -C "${primary}" add .gitignore README.md
git -C "${primary}" commit -m seed >/dev/null
git -C "${primary}" remote add origin "${remote}"
git -C "${primary}" push -u origin main >/dev/null

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
printf 'codex\n' >>"${MOCK_EVENTS}"
printf '%s\n' "${prompt}" >"${MOCK_PROMPT}"
printf '%s\n' "${prompt}" | grep -Fq '$implement'
count=$(cat "${MOCK_CODEX_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_CODEX_COUNT}"
if [ "${MOCK_CODEX_MODE:-completed}" = needs-input ]; then
  jq -n '{status:"needs_input",summary:"decision required",commitSha:"",validation:"not_run",review:"not_run"}' >"${output}"
  exit 0
fi
printf 'implemented\n' >"${worktree}/deliverable-${count}.txt"
git -C "${worktree}" add "deliverable-${count}.txt"
git -C "${worktree}" -c user.name='Local Implement' -c user.email=local@example.com \
  commit -m 'feat: implement inventory query batch' >/dev/null
head=$(git -C "${worktree}" rev-parse HEAD)
jq -n --arg head "${head}" '{status:"completed",summary:"implemented",commitSha:$head,validation:"passed",review:"passed"}' >"${output}"
runtime_fingerprint=${MOCK_RUNTIME_FINGERPRINT:-runtime-one}
jq -n --arg head "${head}" --arg base "${ZERP_ISSUE_BASE_SHA}" \
  --arg runtime_fingerprint "${runtime_fingerprint}" \
  '{status:"passed",head:$head,base:$base,runtimeFingerprint:$runtime_fingerprint}' \
  >"${ZERP_GATE_EVIDENCE_FILE}"
EOF
chmod +x "${tmp}/bin/codex"

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
export MOCK_EVENTS="${events}"
export MOCK_PROMPT="${tmp}/prompt"
export MOCK_CAPTURE="${tmp}/capture"
export MOCK_PRIMARY="${primary}"
export MOCK_ISSUE_COUNT="${tmp}/issue-count"
export MOCK_CODEX_COUNT="${tmp}/codex-count"
export MOCK_PREVIEW_COUNT="${tmp}/preview-count"
export MOCK_CHECK_COUNT="${tmp}/check-count"
export MOCK_CODEX_ARGS="${tmp}/codex-args"
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
  "${repo_root}/scripts/issue-local.sh" run

test "$(cat "${tmp}/issue-count")" = 2
test "$(grep -c '^codex$' "${events}")" = 1
test "$(grep -c '^preview$' "${events}")" = 1
grep -Fq -- '--ignore-user-config' "${MOCK_CODEX_ARGS}"
grep -Fq -- '--ask-for-approval never' "${MOCK_CODEX_ARGS}"
grep -Fq -- '--model gpt-5.6-sol' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'model_reasoning_effort=high' "${MOCK_CODEX_ARGS}"
grep -Fq -- 'sandbox_workspace_write.network_access=false' "${MOCK_CODEX_ARGS}"
worktree_git_dir=$(git -C "${runtime}/worktrees/inventory-query" rev-parse --path-format=absolute --git-dir)
common_git_dir=$(git -C "${runtime}/worktrees/inventory-query" rev-parse --path-format=absolute --git-common-dir)
grep -Fq -- "--add-dir ${worktree_git_dir}" "${MOCK_CODEX_ARGS}"
grep -Fq -- "--add-dir ${common_git_dir}" "${MOCK_CODEX_ARGS}"
if find "${primary}/.git" \( -name 'issue-local-index-probe-*' -o -path '*/refs/issue-local-probe/*' \) -print | grep -q .; then
  echo 'Git metadata writability preflight did not clean up its probe files' >&2
  exit 1
fi
preview_line=$(grep -n '^preview$' "${events}" | cut -d: -f1)
first_gh_line=$(grep -n '^gh ' "${events}" | sed -n '1s/:.*//p')
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
    "${repo_root}/scripts/issue-local.sh" run
}

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
