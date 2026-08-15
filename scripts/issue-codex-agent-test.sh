#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-codex-agent-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM
export ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH=1

mkdir -p "${tmp}/bin" "${tmp}/runtime"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'false\n' ;;
  *) echo "unexpected GitHub mutation while disabled: $*" >&2; exit 91 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
echo 'Codex must not run while automation is disabled' >&2
exit 92
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"

grep -Fq 'automation kill switch is disabled' "${tmp}/stderr"
[ ! -e "${tmp}/runtime/agent.lock" ]

cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *) echo "unexpected GitHub mutation without Codex auth: $*" >&2; exit 93 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
[ "$*" = 'login status' ] || { echo "unexpected Codex command: $*" >&2; exit 94; }
printf 'Not logged in\n'
exit 1
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex"

if PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"; then
  echo 'agent accepted missing ChatGPT authentication' >&2
  exit 1
fi
grep -Fq 'Codex ChatGPT authentication is required' "${tmp}/stderr"
[ ! -e "${tmp}/runtime/agent.lock" ]

cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
[ "$*" = 'login status' ] || { echo "Codex execution must not run while locked: $*" >&2; exit 95; }
printf 'Logged in using ChatGPT\n'
MOCK
mkdir -p "${tmp}/runtime/agent.lock"
printf '%s\n' "$$" >"${tmp}/runtime/agent.lock/pid"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
grep -Fq "local Codex agent already running with pid $$" "${tmp}/stderr"
test "$(cat "${tmp}/runtime/agent.lock/pid")" = "$$"
rm -rf "${tmp}/runtime/agent.lock"

export MOCK_CALLS="${tmp}/calls"
: >"${MOCK_CALLS}"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *'/issues?state=open&per_page=100'*) printf '[[]]\n' ;;
  *) echo "unexpected GitHub call with an empty queue: $*" >&2; exit 96 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
[ "$*" = 'login status' ] || { echo "Codex execution must not run for an empty queue: $*" >&2; exit 97; }
printf 'Logged in using ChatGPT\n'
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
grep -Fq 'issues?state=open&per_page=100' "${MOCK_CALLS}"
test "$(grep -c '^login status$' "${MOCK_CALLS}")" = 1
grep -Fq 'no eligible local Codex work' "${tmp}/stderr"
[ ! -e "${tmp}/runtime/agent.lock" ]

: >"${MOCK_CALLS}"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *'/issues?state=open&per_page=100'*)
    printf '[[{"number":41,"body":"authorized body","labels":[{"name":"automation:ready"},{"name":"priority:p1"}]}]]\n'
    ;;
  *'/issues/41/dependencies/blocked_by'*) printf '[]\n' ;;
  *'/deployments?environment=issue-authorization-41&per_page=100'*) printf '[]\n' ;;
  *) echo "unexpected GitHub call without authorization evidence: $*" >&2; exit 98 ;;
esac
MOCK
chmod +x "${tmp}/bin/gh"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
grep -Fq 'dependencies/blocked_by' "${MOCK_CALLS}"
grep -Fq 'issue-authorization-41' "${MOCK_CALLS}"
test "$(grep -c '^login status$' "${MOCK_CALLS}")" = 1
grep -Fq 'no authorized local Codex work' "${tmp}/stderr"
[ ! -e "${tmp}/runtime/agent.lock" ]

body='authorized body'
body_hash=$(printf '%s' "${body}" | shasum -a 256 | awk '{print $1}')
main_sha=$(git -C "${repo_root}" rev-parse HEAD)
export MOCK_BODY_HASH="${body_hash}" MOCK_MAIN_SHA="${main_sha}"
export MOCK_PATCH_FILE="${tmp}/patch.json" MOCK_COMMENT_FILE="${tmp}/comment"
: >"${MOCK_CALLS}"
rm -f "${MOCK_PATCH_FILE}" "${MOCK_COMMENT_FILE}"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *'/issues?state=open&per_page=100'*)
    printf '[[{"number":41,"body":"authorized body","labels":[{"name":"automation:ready"},{"name":"priority:p1"}]}]]\n'
    ;;
  *'/issues/41/dependencies/blocked_by'*) printf '[]\n' ;;
  *'/deployments?environment=issue-authorization-41&per_page=100'*)
    printf '[{"id":501,"task":"authorize","created_at":"2026-08-15T00:00:00Z","payload":{"body_sha256":"%s","run_id":"7001"}}]\n' "${MOCK_BODY_HASH}"
    ;;
  *'/deployments/501/statuses?per_page=100'*) printf '[{"state":"success","created_at":"2026-08-15T00:00:01Z"}]\n' ;;
  'run download 7001 '*)
    destination=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --dir ]; then shift; destination=$1; fi
      shift
    done
    mkdir -p "${destination}"
    jq -n --argjson issue 41 --arg body_sha256 "${MOCK_BODY_HASH}" --arg main_sha "${MOCK_MAIN_SHA}" \
      '{issue:$issue,title:"Authorized change",body:"authorized body",body_sha256:$body_sha256,main_sha:$main_sha,workflow:{run_id:"7001"}}' \
      >"${destination}/authorization.json"
    ;;
  *'--method PATCH repos/example/zerp/issues/41 --input -'*) cat >"${MOCK_PATCH_FILE}"; printf '{}\n' ;;
  'api repos/example/zerp/issues/41') printf '{"labels":[{"name":"automation:implementing"},{"name":"priority:p1"}]}\n' ;;
  'issue comment 41 '*) printf '%s\n' "$*" >"${MOCK_COMMENT_FILE}" ;;
  *) echo "unexpected GitHub call for needs-input flow: $*" >&2; exit 99 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
if [ "$*" = 'login status' ]; then printf 'Logged in using ChatGPT\n'; exit 0; fi
case "$1" in exec) ;;
  *) echo "unexpected Codex command: $*" >&2; exit 100 ;;
esac
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ] || [ "$1" = --output-last-message ]; then shift; output=$1; fi
  shift
done
[ -n "${output}" ] || exit 101
printf '{"status":"needs_input","summary":"choose an accounting period"}\n' >"${output}"
cat >/dev/null
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_CODEX_REPOSITORY_ROOT="${repo_root}" \
  ZERP_ISSUE_CODEX_SKIP_FETCH=1 \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
jq -e '.labels == ["automation:needs-input","priority:p1"]' "${MOCK_PATCH_FILE}" >/dev/null
grep -Fq 'choose an accounting period' "${MOCK_COMMENT_FILE}"
grep -Fq 'exec --ignore-user-config --ephemeral --sandbox workspace-write' "${MOCK_CALLS}"
[ ! -e "${tmp}/runtime/source" ]
[ ! -e "${tmp}/runtime/agent.lock" ]

git clone -q --bare "${repo_root}" "${tmp}/remote.git"
git clone -q "${tmp}/remote.git" "${tmp}/repository"
export MOCK_PR_FILE="${tmp}/pr" MOCK_GATE_COUNT_FILE="${tmp}/gate-count"
: >"${MOCK_CALLS}"
rm -f "${MOCK_PATCH_FILE}" "${MOCK_PR_FILE}" "${MOCK_GATE_COUNT_FILE}"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *'/issues?state=open&per_page=100'*)
    printf '[[{"number":41,"body":"authorized body","labels":[{"name":"automation:ready"},{"name":"priority:p1"}]}]]\n'
    ;;
  *'/issues/41/dependencies/blocked_by'*) printf '[]\n' ;;
  *'/deployments?environment=issue-authorization-41&per_page=100'*)
    printf '[{"id":501,"task":"authorize","created_at":"2026-08-15T00:00:00Z","payload":{"body_sha256":"%s","run_id":"7001"}}]\n' "${MOCK_BODY_HASH}"
    ;;
  *'/deployments/501/statuses?per_page=100'*) printf '[{"state":"success","created_at":"2026-08-15T00:00:01Z"}]\n' ;;
  'run download 7001 '*)
    destination=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --dir ]; then shift; destination=$1; fi
      shift
    done
    mkdir -p "${destination}"
    jq -n --argjson issue 41 --arg body_sha256 "${MOCK_BODY_HASH}" --arg main_sha "${MOCK_MAIN_SHA}" \
      '{issue:$issue,title:"Authorized change",body:"authorized body",body_sha256:$body_sha256,main_sha:$main_sha,workflow:{run_id:"7001"}}' \
      >"${destination}/authorization.json"
    ;;
  *'--method PATCH repos/example/zerp/issues/41 --input -'*) cat >"${MOCK_PATCH_FILE}"; printf '{}\n' ;;
  'api repos/example/zerp/issues/41') printf '{"labels":[{"name":"automation:implementing"},{"name":"priority:p1"}]}\n' ;;
  'pr create '*) printf '%s\n' "$*" >"${MOCK_PR_FILE}" ;;
  'pr view codex/issue-41-c8715ac1 '*) printf '77\n' ;;
  *) echo "unexpected GitHub call for implemented flow: $*" >&2; exit 102 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
if [ "$*" = 'login status' ]; then printf 'Logged in using ChatGPT\n'; exit 0; fi
source_root=
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -C ]; then shift; source_root=$1; fi
  if [ "$1" = -o ] || [ "$1" = --output-last-message ]; then shift; output=$1; fi
  shift
done
[ -n "${source_root}" ] && [ -n "${output}" ] || exit 103
printf '\nlocal Codex agent test change\n' >>"${source_root}/README.md"
printf '{"status":"implemented","summary":"implemented"}\n' >"${output}"
cat >/dev/null
MOCK
cat >"${tmp}/bin/gate" <<'MOCK'
#!/bin/sh
printf 'gate %s\n' "${ZERP_WORKTREE}" >>"${MOCK_CALLS}"
count=$(cat "${MOCK_GATE_COUNT_FILE}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_GATE_COUNT_FILE}"
[ "${count}" -gt 1 ] || { printf 'focused gate failed\n'; exit 1; }
[ -f "${ZERP_WORKTREE}/README.md" ]
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex" "${tmp}/bin/gate"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_GATE_BIN=gate \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_CODEX_REPOSITORY_ROOT="${tmp}/repository" \
  ZERP_ISSUE_CODEX_SKIP_FETCH=1 \
  ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH=1 \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
jq -e '.labels == ["automation:reviewing","priority:p1"]' "${MOCK_PATCH_FILE}" >/dev/null
grep -Fq -- '--draft' "${MOCK_PR_FILE}"
grep -Fq 'zerp-automation issue=41 authorization_run=7001 deployment=501 body_sha=c8715ac1df2efbcc71299a6539ae041c416b1f0f2232e9042a6d3bc29e650c21 round=2' "${MOCK_PR_FILE}"
published_sha=$(git --git-dir="${tmp}/remote.git" rev-parse refs/heads/codex/issue-41-c8715ac1)
test "$(git --git-dir="${tmp}/remote.git" show -s --format=%s "${published_sha}")" = 'automation(issue #41): implementation round 2'
test "$(cat "${MOCK_GATE_COUNT_FILE}")" = 2
test "$(grep -c 'exec --ignore-user-config --ephemeral --sandbox workspace-write' "${MOCK_CALLS}")" = 2
if git --git-dir="${tmp}/remote.git" ls-tree -r --name-only "${published_sha}" | grep -Eq '(^|/)(authorization|automation-output)\.json$'; then
  echo 'automation input leaked into the candidate commit' >&2
  exit 1
fi
[ ! -e "${tmp}/runtime/source" ]
[ ! -e "${tmp}/runtime/agent.lock" ]

export MOCK_HEAD_SHA="${published_sha}" MOCK_STATUS_FILE="${tmp}/statuses" MOCK_READY_FILE="${tmp}/ready"
: >"${MOCK_CALLS}"
: >"${MOCK_STATUS_FILE}"
rm -f "${MOCK_PATCH_FILE}" "${MOCK_READY_FILE}"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *'/issues?state=open&per_page=100'*)
    printf '[[{"number":41,"body":"authorized body","labels":[{"name":"automation:reviewing"},{"name":"priority:p1"}]}]]\n'
    ;;
  'pr list '*)
    jq -nc --arg head "${MOCK_HEAD_SHA}" --arg base "${MOCK_MAIN_SHA}" --arg body "Refs #41

<!-- zerp-automation issue=41 authorization_run=7001 deployment=501 body_sha=${MOCK_BODY_HASH} round=2 -->" \
      '[{number:77,body:$body,headRefName:"codex/issue-41-c8715ac1",headRefOid:$head,baseRefOid:$base,isDraft:true,url:"https://github.com/example/zerp/pull/77"}]'
    ;;
  'run download 7001 '*)
    destination=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --dir ]; then shift; destination=$1; fi
      shift
    done
    mkdir -p "${destination}"
    jq -n --argjson issue 41 --arg body_sha256 "${MOCK_BODY_HASH}" --arg main_sha "${MOCK_MAIN_SHA}" \
      '{issue:$issue,title:"Authorized change",body:"authorized body",body_sha256:$body_sha256,main_sha:$main_sha,workflow:{run_id:"7001"}}' \
      >"${destination}/authorization.json"
    ;;
  *'--method POST repos/example/zerp/statuses/'*'--input -'*)
    payload=$(cat)
    printf '%s\n' "${payload}" >>"${MOCK_STATUS_FILE}"
    printf '%s' "${payload}" | jq '. + {id:9001,creator:{login:"zerp-issue-reviewer[bot]"}}'
    ;;
  *'--method PATCH repos/example/zerp/issues/41 --input -'*) cat >"${MOCK_PATCH_FILE}"; printf '{}\n' ;;
  'api repos/example/zerp/issues/41') printf '{"labels":[{"name":"automation:reviewing"},{"name":"priority:p1"}]}\n' ;;
  'pr ready 77 '*) printf '%s\n' "$*" >"${MOCK_READY_FILE}" ;;
  *) echo "unexpected GitHub call for review flow: $*" >&2; exit 104 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
if [ "$*" = 'login status' ]; then printf 'Logged in using ChatGPT\n'; exit 0; fi
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ] || [ "$1" = --output-last-message ]; then shift; output=$1; fi
  shift
done
[ -n "${output}" ] || exit 105
printf '{"verdict":"pass","summary":"pass","findings":[]}\n' >"${output}"
cat >/dev/null
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_CODEX_REPOSITORY_ROOT="${tmp}/repository" \
  ZERP_ISSUE_CODEX_SKIP_FETCH=1 \
  ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH=1 \
  ZERP_REVIEWER_BOT_LOGIN='zerp-issue-reviewer[bot]' \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
jq -e '.labels == ["automation:release","priority:p1"]' "${MOCK_PATCH_FILE}" >/dev/null
test -s "${MOCK_READY_FILE}"
test "$(wc -l <"${MOCK_STATUS_FILE}" | tr -d ' ')" = 2
jq -sc 'map(.context) | sort == ["automation-spec-review","automation-standards-review"]' "${MOCK_STATUS_FILE}" >/dev/null
test "$(grep -c 'exec --ignore-user-config --ephemeral --sandbox read-only' "${MOCK_CALLS}")" = 2
[ ! -e "${tmp}/runtime/source" ]
[ ! -e "${tmp}/runtime/agent.lock" ]

export MOCK_REVIEW_COMMENT_FILE="${tmp}/review-comment"
: >"${MOCK_CALLS}"
: >"${MOCK_STATUS_FILE}"
rm -f "${MOCK_PATCH_FILE}" "${MOCK_READY_FILE}" "${MOCK_REVIEW_COMMENT_FILE}"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *'/issues?state=open&per_page=100'*)
    printf '[[{"number":41,"body":"authorized body","labels":[{"name":"automation:reviewing"},{"name":"priority:p1"}]}]]\n'
    ;;
  'pr list '*)
    jq -nc --arg head "${MOCK_HEAD_SHA}" --arg base "${MOCK_MAIN_SHA}" --arg body "Refs #41

<!-- zerp-automation issue=41 authorization_run=7001 deployment=501 body_sha=${MOCK_BODY_HASH} round=2 -->" \
      '[{number:77,body:$body,headRefName:"codex/issue-41-c8715ac1",headRefOid:$head,baseRefOid:$base,isDraft:true,url:"https://github.com/example/zerp/pull/77"}]'
    ;;
  'run download 7001 '*)
    destination=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --dir ]; then shift; destination=$1; fi
      shift
    done
    mkdir -p "${destination}"
    jq -n --argjson issue 41 --arg body_sha256 "${MOCK_BODY_HASH}" --arg main_sha "${MOCK_MAIN_SHA}" \
      '{issue:$issue,title:"Authorized change",body:"authorized body",body_sha256:$body_sha256,main_sha:$main_sha,workflow:{run_id:"7001"}}' \
      >"${destination}/authorization.json"
    ;;
  *'--method POST repos/example/zerp/statuses/'*'--input -'*)
    payload=$(cat)
    printf '%s\n' "${payload}" >>"${MOCK_STATUS_FILE}"
    printf '%s' "${payload}" | jq '. + {id:9002,creator:{login:"zerp-issue-reviewer[bot]"}}'
    ;;
  'pr comment 77 '*) printf '%s\n' "$*" >"${MOCK_REVIEW_COMMENT_FILE}" ;;
  *'--method PATCH repos/example/zerp/issues/41 --input -'*) cat >"${MOCK_PATCH_FILE}"; printf '{}\n' ;;
  'api repos/example/zerp/issues/41') printf '{"labels":[{"name":"automation:reviewing"},{"name":"priority:p1"}]}\n' ;;
  *) echo "unexpected GitHub call for failed review flow: $*" >&2; exit 106 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
if [ "$*" = 'login status' ]; then printf 'Logged in using ChatGPT\n'; exit 0; fi
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ] || [ "$1" = --output-last-message ]; then shift; output=$1; fi
  shift
done
[ -n "${output}" ] || exit 107
case "${output}" in
  *standards*) printf '{"verdict":"fail","summary":"unsafe state transition","findings":[{"severity":"major","message":"verify the exact head"}]}\n' >"${output}" ;;
  *) printf '{"verdict":"pass","summary":"spec passes","findings":[]}\n' >"${output}" ;;
esac
cat >/dev/null
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_CODEX_REPOSITORY_ROOT="${tmp}/repository" \
  ZERP_ISSUE_CODEX_SKIP_FETCH=1 \
  ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH=1 \
  ZERP_REVIEWER_BOT_LOGIN='zerp-issue-reviewer[bot]' \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
jq -e '.labels == ["automation:implementing","priority:p1"]' "${MOCK_PATCH_FILE}" >/dev/null
grep -Fq "zerp-review head=${MOCK_HEAD_SHA} round=2" "${MOCK_REVIEW_COMMENT_FILE}"
grep -Fq 'verify the exact head' "${MOCK_REVIEW_COMMENT_FILE}"
test "$(wc -l <"${MOCK_STATUS_FILE}" | tr -d ' ')" = 2
[ ! -e "${MOCK_READY_FILE}" ]
[ ! -e "${tmp}/runtime/source" ]
[ ! -e "${tmp}/runtime/agent.lock" ]

export MOCK_REPAIR_PR_FILE="${tmp}/repair-pr"
: >"${MOCK_CALLS}"
rm -f "${MOCK_PATCH_FILE}" "${MOCK_REPAIR_PR_FILE}"
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
case "$*" in
  *'/actions/variables/ZERP_AUTOMATION_ENABLED'*) printf 'true\n' ;;
  *'/issues?state=open&per_page=100'*)
    printf '[[{"number":41,"body":"authorized body","labels":[{"name":"automation:implementing"},{"name":"priority:p1"}]}]]\n'
    ;;
  'pr list '*)
    jq -nc --arg head "${MOCK_HEAD_SHA}" --arg base "${MOCK_MAIN_SHA}" --arg body "Refs #41

<!-- zerp-automation issue=41 authorization_run=7001 deployment=501 body_sha=${MOCK_BODY_HASH} round=2 -->" \
      '[{number:77,body:$body,headRefName:"codex/issue-41-c8715ac1",headRefOid:$head,baseRefOid:$base,isDraft:true,url:"https://github.com/example/zerp/pull/77"}]'
    ;;
  *'repos/example/zerp/issues/77/comments?per_page=100'*)
    jq -nc --arg head "${MOCK_HEAD_SHA}" '[{user:{login:"zerp-issue-reviewer[bot]"},body:("Local Codex review failed. verify the exact head. <!-- zerp-review head=" + $head + " round=2 -->")} ]'
    ;;
  'run download 7001 '*)
    destination=
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --dir ]; then shift; destination=$1; fi
      shift
    done
    mkdir -p "${destination}"
    jq -n --argjson issue 41 --arg body_sha256 "${MOCK_BODY_HASH}" --arg main_sha "${MOCK_MAIN_SHA}" \
      '{issue:$issue,title:"Authorized change",body:"authorized body",body_sha256:$body_sha256,main_sha:$main_sha,workflow:{run_id:"7001"}}' \
      >"${destination}/authorization.json"
    ;;
  'pr edit 77 '*) printf '%s\n' "$*" >"${MOCK_REPAIR_PR_FILE}" ;;
  *'--method PATCH repos/example/zerp/issues/41 --input -'*) cat >"${MOCK_PATCH_FILE}"; printf '{}\n' ;;
  'api repos/example/zerp/issues/41') printf '{"labels":[{"name":"automation:implementing"},{"name":"priority:p1"}]}\n' ;;
  *) echo "unexpected GitHub call for repair flow: $*" >&2; exit 108 ;;
esac
MOCK
cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_CALLS}"
if [ "$*" = 'login status' ]; then printf 'Logged in using ChatGPT\n'; exit 0; fi
source_root=
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -C ]; then shift; source_root=$1; fi
  if [ "$1" = -o ] || [ "$1" = --output-last-message ]; then shift; output=$1; fi
  shift
done
[ -n "${source_root}" ] && [ -n "${output}" ] || exit 109
printf '\nlocal Codex repair\n' >>"${source_root}/README.md"
printf '{"status":"implemented","summary":"repaired"}\n' >"${output}"
cat >/dev/null
MOCK
chmod +x "${tmp}/bin/gh" "${tmp}/bin/codex"

PATH="${tmp}/bin:${PATH}" \
  ZERP_GH_BIN=gh \
  ZERP_CODEX_BIN=codex \
  ZERP_ISSUE_CODEX_GATE_BIN=gate \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_CODEX_REPOSITORY_ROOT="${tmp}/repository" \
  ZERP_ISSUE_CODEX_SKIP_FETCH=1 \
  ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH=1 \
  ZERP_REVIEWER_BOT_LOGIN='zerp-issue-reviewer[bot]' \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  "${repo_root}/scripts/issue-codex-watch.sh" >"${tmp}/stdout" 2>"${tmp}/stderr"
jq -e '.labels == ["automation:reviewing","priority:p1"]' "${MOCK_PATCH_FILE}" >/dev/null
grep -Fq 'round=3' "${MOCK_REPAIR_PR_FILE}"
repaired_sha=$(git --git-dir="${tmp}/remote.git" rev-parse refs/heads/codex/issue-41-c8715ac1)
test "${repaired_sha}" != "${MOCK_HEAD_SHA}"
test "$(git --git-dir="${tmp}/remote.git" show -s --format=%s "${repaired_sha}")" = 'automation(issue #41): implementation round 3'
test "$(grep -c 'exec --ignore-user-config --ephemeral --sandbox workspace-write' "${MOCK_CALLS}")" = 1
[ ! -e "${tmp}/runtime/source" ]
[ ! -e "${tmp}/runtime/agent.lock" ]

echo 'issue Codex agent tests passed'
