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
printf 'packages:\n  - frontend\n' >"${primary}/pnpm-workspace.yaml"
printf '{"packageManager":"pnpm@10.34.5"}\n' >"${primary}/package.json"
printf 'TEST_POSTGRES_DB=issue_local_test\n' >"${primary}/backend/.env.local"
printf 'APP_ENV=test\n' >"${primary}/backend/.env.e2e.local"
printf 'layoutVersion: 1\n' >"${primary}/node_modules/.modules.yaml"
printf '#!/bin/sh\nexit 0\n' >"${primary}/frontend/node_modules/.bin/vite"
chmod +x "${primary}/frontend/node_modules/.bin/vite"
: >"${primary}/frontend/node_modules/vite"
printf 'primary cache\n' >"${primary}/frontend/node_modules/.tmp/primary-cache"
git -C "${primary}" add .gitignore README.md backend/README.md package.json pnpm-lock.yaml \
  pnpm-workspace.yaml
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
if [ "${MOCK_CODEX_MODE:-completed}" = commit-then-fail ] && [ "${count}" = 1 ]; then
  printf 'implemented before controller failure\n' >"${worktree}/deliverable-${count}.txt"
  git -C "${worktree}" add "deliverable-${count}.txt"
  git -C "${worktree}" -c user.name='Local Implement' -c user.email=local@example.com \
    commit -m 'feat: commit before controller failure' >/dev/null
  printf 'model-commit\n' >>"${MOCK_EVENTS}"
  echo 'simulated protocol failure after clean commit' >&2
  exit 1
fi
if [ "${MOCK_CODEX_REVIEW_EXISTING:-0}" = 1 ] &&
  printf '%s\n' "${prompt}" | grep -Eq 'unreviewed (manual repair|automated commit)'; then
  head=$(git -C "${worktree}" rev-parse HEAD)
  printf 'model-review\n' >>"${MOCK_EVENTS}"
  jq -n --arg head "${head}" \
    '{status:"completed",summary:"reviewed existing repair",commitSha:$head,validation:"not_run",review:"passed"}' >"${output}"
  exit 0
fi
printf 'implemented\n' >"${worktree}/deliverable-${count}.txt"
if [ "${MOCK_CODEX_CHANGE_MANIFEST:-0}" = 1 ]; then
  jq --argjson count "${count}" '.mockDependencyRevision = $count' \
    "${worktree}/package.json" >"${worktree}/package.json.new"
  mv "${worktree}/package.json.new" "${worktree}/package.json"
fi
git -C "${worktree}" add "deliverable-${count}.txt" package.json
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
fast=0
mode=legacy
if [ "${1:-}" = --fast ]; then
  fast=1
  shift
elif [ "${1:-}" = --baseline ]; then
  mode=baseline
  shift
elif [ "${1:-}" = --reverify ]; then
  mode=reverify
  shift 2
elif [ "${1:-}" = --release ]; then
  mode=release
  shift
fi
if [ "${fast}" = 1 ]; then
  count=$(cat "${MOCK_FAST_GATE_COUNT}" 2>/dev/null || printf 0)
  count=$((count + 1))
  printf '%s\n' "${count}" >"${MOCK_FAST_GATE_COUNT}"
  head=$(git rev-parse HEAD)
  jq -n --arg head "${head}" --arg base "$1" \
    '{version:1,status:"passed",mode:"fast",head:$head,base:$base}' \
    >"${ZERP_GATE_EVIDENCE_FILE}"
  exit 0
fi
printf 'gate\n' >>"${MOCK_EVENTS}"
[ "${mode}" = legacy ] || printf 'gate-%s\n' "${mode}" >>"${MOCK_EVENTS}"
printf '%s\n' "${COREPACK_ROOT:-}" >"${MOCK_GATE_COREPACK_ROOT}"
command -v pnpm >"${MOCK_GATE_PNPM_PATH}"
pnpm --version >"${MOCK_GATE_PNPM_VERSION}"
test -L backend/.env.local
readlink backend/.env.local >"${MOCK_GATE_ENV_TARGET}"
printf '%s\n' "${ZERP_E2E_ENV_FILE:-}" >"${MOCK_GATE_E2E_ENV_TARGET}"
count=$(cat "${MOCK_GATE_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_GATE_COUNT}"
head=$(git rev-parse HEAD)
if [ "${MOCK_VALIDATION_MULTI_FAILURE:-0}" = 1 ]; then
  if [ "${mode}" = baseline ]; then
    printf 'frontend typecheck failed\nbackend integration failed\n' >&2
    jq -n --arg head "${head}" --arg base "$1" '
      {version:1,status:"failed",mode:"baseline",head:$head,base:$base,stages:[
        {id:"common",status:"passed",verifiedHead:$head},
        {id:"frontend",status:"failed",verifiedHead:$head},
        {id:"backend",status:"failed",verifiedHead:$head},
        {id:"e2e",status:"blocked",blockedBy:["frontend","backend"]}
      ]}' >"${ZERP_GATE_EVIDENCE_FILE}"
    exit 1
  fi
  if [ "${mode}" = reverify ]; then
    jq -n --arg head "${head}" --arg base "$1" '
      {version:1,status:"passed",mode:"reverify",head:$head,base:$base,stages:[
        {id:"common",status:"passed",verifiedHead:$head},
        {id:"frontend",status:"passed",verifiedHead:$head},
        {id:"backend",status:"passed",verifiedHead:$head},
        {id:"e2e",status:"passed",verifiedHead:$head}
      ]}' >"${ZERP_GATE_EVIDENCE_FILE}"
    exit 0
  fi
fi
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
  if [ "${MOCK_GATE_INTEGRATION_FAILURE:-0}" = 1 ]; then
    echo '==> isolated integration package internal/seed/productionseed'
    jq -n '{version:1,status:"failed",packages:[
      {package:"internal/wfl",status:"failed",exitCode:1},
      {package:"internal/seed/productionseed",status:"passed",exitCode:0}
    ]}' >"${TEST_INTEGRATION_RESULT_FILE}"
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
  if [ "${mode}" = baseline ] || [ "${mode}" = reverify ]; then
    failed_stage=common
    [ "${MOCK_GATE_E2E_FAILURE:-0}" != 1 ] || failed_stage=e2e
    [ "${MOCK_GATE_INTEGRATION_FAILURE:-0}" != 1 ] || failed_stage=backend
    if [ "${MOCK_GATE_INTEGRATION_FAILURE:-0}" = 1 ]; then
      jq -n --arg head "${head}" --arg base "$1" --arg mode "${mode}" '
        {version:1,status:"failed",mode:$mode,head:$head,base:$base,stages:[
          {id:"backend",status:"failed",verifiedHead:$head},
          {id:"e2e",status:"blocked",blockedBy:["backend"]}
        ]}' >"${ZERP_GATE_EVIDENCE_FILE}"
    else
      jq -n --arg head "${head}" --arg base "$1" --arg mode "${mode}" \
        --arg failed_stage "${failed_stage}" '
        {version:1,status:"failed",mode:$mode,head:$head,base:$base,stages:[
          {id:$failed_stage,status:"failed",verifiedHead:$head}
        ]}' >"${ZERP_GATE_EVIDENCE_FILE}"
    fi
  fi
  exit 1
fi
if [ "${count}" -le "${MOCK_GATE_INVALID_EVIDENCE_FAILS:-0}" ]; then
  printf '{"status":"passed","head":"invalid"}\n' >"${ZERP_GATE_EVIDENCE_FILE}"
  exit 0
fi
if [ "${MOCK_BASELINE_DIRTY:-0}" = 1 ]; then
  if [ "${mode}" = baseline ]; then
    printf 'generated by baseline\n' >baseline-generated.tmp
  elif [ "${mode}" = release ]; then
    test -f baseline-generated.tmp
    rm -f baseline-generated.tmp
  fi
fi
jq -n --arg head "${head}" --arg base "$1" \
  --arg runtime_fingerprint "${MOCK_RUNTIME_FINGERPRINT:-runtime-one}" \
  --arg mode "${mode}" \
  '{version:1,status:"passed",mode:$mode,head:$head,base:$base,
    runtimeFingerprint:$runtime_fingerprint,stages:[
      {id:"common",status:"passed",verifiedHead:$head},
      {id:"frontend",status:"passed",verifiedHead:$head},
      {id:"backend",status:"passed",verifiedHead:$head},
      {id:"runtime",status:"passed",verifiedHead:$head},
      {id:"e2e",status:"passed",verifiedHead:$head}
    ]}' \
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

cat >"${tmp}/bin/focused-integration" <<'EOF'
#!/bin/sh
set -eu
packages_file=$1
result_file=$2
printf 'focused-integration %s\n' "$(paste -sd, "${packages_file}")" >>"${MOCK_EVENTS}"
count=$(cat "${MOCK_FOCUSED_INTEGRATION_COUNT}" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s\n' "${count}" >"${MOCK_FOCUSED_INTEGRATION_COUNT}"
status=passed
exit_code=0
if [ "${count}" -le "${MOCK_FOCUSED_INTEGRATION_FAILS:-0}" ]; then
  status=failed
  exit_code=1
fi
jq -Rn --arg status "${status}" --argjson exitCode "${exit_code}" \
  '[inputs | {package:.,status:$status,exitCode:$exitCode}] | {version:1,status:$status,packages:.}' \
  <"${packages_file}" >"${result_file}"
[ "${status}" = passed ]
EOF
chmod +x "${tmp}/bin/focused-integration"

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
if [ "${MOCK_PREVIEW_REQUIRE_INDEPENDENT_MODULES:-0}" = 1 ]; then
  test -d "${ZERP_ISSUE_WORKTREE}/node_modules"
  test ! -L "${ZERP_ISSUE_WORKTREE}/node_modules"
  test -d "${ZERP_ISSUE_WORKTREE}/frontend/node_modules"
  test ! -L "${ZERP_ISSUE_WORKTREE}/frontend/node_modules"
fi
if [ "${MOCK_PREVIEW_LEAVES_DEPENDENCY_RESIDUE:-0}" = 1 ]; then
  mkdir -p "${ZERP_ISSUE_WORKTREE}/node_modules/.pnpm" \
    "${ZERP_ISSUE_WORKTREE}/frontend/node_modules/.pnpm-store" \
    "${ZERP_ISSUE_WORKTREE}/frontend/node_modules/.vite"
fi
if [ "${MOCK_PREVIEW_CORRUPTS_MODULES:-0}" = 1 ]; then
  jq '.storeDir = "/unmanaged/pnpm/store"' \
    "${ZERP_ISSUE_WORKTREE}/node_modules/.modules.yaml" \
    >"${ZERP_ISSUE_WORKTREE}/node_modules/.modules.yaml.new"
  mv "${ZERP_ISSUE_WORKTREE}/node_modules/.modules.yaml.new" \
    "${ZERP_ISSUE_WORKTREE}/node_modules/.modules.yaml"
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
if [ "${count}" -le "${MOCK_PREVIEW_EXACT_MISMATCH_FAILS:-0}" ]; then
  echo "exact SHA mismatch: expected candidate, received stale preview" >&2
  exit 1
fi
if [ "${count}" -le "${MOCK_PREVIEW_INVALID_EVIDENCE_FAILS:-0}" ]; then
  printf 'url=https://zerp-preview.bytesucceed.com\n'
  printf 'fingerprint=invalid\n'
  exit 0
fi
printf 'url=https://zerp-preview.bytesucceed.com\n'
printf 'fingerprint=%s\n' "${MOCK_RUNTIME_FINGERPRINT:-runtime-one}"
EOF
chmod +x "${tmp}/bin/preview"

cat >"${tmp}/bin/production" <<'EOF'
#!/bin/sh
set -eu
printf 'production\n' >>"${MOCK_EVENTS}"
if [ "${MOCK_PRODUCTION_FAIL:-0}" = 1 ]; then
  echo 'simulated production verification failure' >&2
  exit 1
fi
if [ "${MOCK_VERIFY_COMPLETION_CANDIDATE:-0}" = 1 ]; then
  worktree=${ZERP_ISSUE_WORKTREE:?}
  worktree_git_dir=$(git -C "${worktree}" rev-parse --path-format=absolute --git-dir)
  common_git_dir=$(git -C "${worktree}" rev-parse --path-format=absolute --git-common-dir)
  grep -Fq -- "--add-dir ${worktree_git_dir}" "${MOCK_CODEX_ARGS}"
  grep -Fq -- "--add-dir ${common_git_dir}" "${MOCK_CODEX_ARGS}"
  test -d "${worktree}/node_modules"
  test ! -L "${worktree}/node_modules"
  test -d "${worktree}/frontend/node_modules"
  test ! -L "${worktree}/frontend/node_modules"
  jq -e --arg store "${ZERP_PNPM_STORE_PATH}/v11" '.storeDir == $store' \
    "${worktree}/node_modules/.modules.yaml" >/dev/null
  jq -e --arg store "${ZERP_PNPM_STORE_PATH}/v11" '
    .version == 1 and .pnpmVersion == "10.34.5" and .storePath == $store and
    (.lockfileHash | length == 64) and (.packageJsonHash | length == 64) and
    (.workspaceHash | length == 64)
  ' "${worktree}/.scratch/.issue-local-deps.json" >/dev/null
  test ! -e "${worktree}/backend/.env.local"
  test ! -e "${worktree}/backend/.env.e2e.local"
  test -d "${worktree}/frontend/node_modules/.tmp"
  test ! -e "${worktree}/frontend/node_modules/.tmp/primary-cache"
  test ! -e "${worktree}/frontend/node_modules/.vite"
  test ! -e "${worktree}/.pnpm-store"
  test ! -e "${worktree}/frontend/node_modules/.pnpm-store"
  : >"${MOCK_CAPTURE}/completion-candidate-verified"
fi
printf 'sha=9999999999999999999999999999999999999999\n'
EOF
chmod +x "${tmp}/bin/production"

cat >"${tmp}/bin/osascript" <<'EOF'
#!/bin/sh
set -eu
case "${1:-}" in
  -)
    test "$#" = 1
    script=$(cat)
    if printf '%s' "${script}" | grep -Fq 'system attribute "ZERP_ISSUE_MESSAGE_RECIPIENT"'; then
      test -n "${ZERP_ISSUE_MESSAGE_RECIPIENT:-}"
      test -n "${ZERP_ISSUE_MESSAGE_BODY:-}"
      : >"${MOCK_MESSAGES_STARTED}"
      if [ "${MOCK_OSASCRIPT_HANG:-0}" = 1 ]; then
        printf 'imessage-send-hanging\n' >>"${MOCK_IMESSAGE_EVENTS}"
        printf '%s\n' "$$" >"${MOCK_OSASCRIPT_PID}"
        trap 'rm -f "${MOCK_OSASCRIPT_PID}"; exit 143' TERM
        while :; do :; done
      fi
      if [ "${MOCK_OSASCRIPT_FAIL:-0}" = 1 ]; then
        printf 'imessage-send-failed\n' >>"${MOCK_IMESSAGE_EVENTS}"
        exit 1
      fi
      printf '%s\n---\n' "${ZERP_ISSUE_MESSAGE_BODY}" >>"${MOCK_IMESSAGE_EVENTS}"
    elif printf '%s' "${script}" | grep -Fq 'display notification'; then
      test -n "${ZERP_ISSUE_NOTIFICATION_TITLE:-}"
      test -n "${ZERP_ISSUE_MESSAGE_BODY:-}"
      printf 'macos-notification\n' >>"${MOCK_IMESSAGE_EVENTS}"
    else
      exit 2
    fi
    ;;
  -e)
    test "$#" = 2
    test "${2:-}" = 'tell application "Messages" to quit'
    printf 'messages-quit\n' >>"${MOCK_IMESSAGE_EVENTS}"
    rm -f "${MOCK_MESSAGES_STARTED}"
    ;;
  *) exit 2 ;;
esac
EOF
chmod +x "${tmp}/bin/osascript"

cat >"${tmp}/bin/pgrep" <<'EOF'
#!/bin/sh
set -eu
test "$*" = '-x Messages'
if [ "${MOCK_MESSAGES_ALREADY_RUNNING:-0}" = 1 ] || [ -e "${MOCK_MESSAGES_STARTED}" ]; then
  exit 0
fi
exit 1
EOF
chmod +x "${tmp}/bin/pgrep"

cat >"${tmp}/bin/gh" <<'EOF'
#!/bin/sh
set -eu
printf 'gh %s\n' "$*" >>"${MOCK_EVENTS}"
case " $* " in
  *' api --paginate repos/example/zerp/issues?state=all&per_page=100 '*) printf '[]\n' ;;
  *' api repos/example/zerp/commits/'*'/check-runs?filter=latest&per_page=100 '*)
    head=$(sed -n 's/.* head=\([0-9a-f]\{40\}\) fingerprint=.*/\1/p' \
      "${MOCK_CAPTURE}/pr-body.md")
    jq -n --arg head "${head}" --arg name "${MOCK_CHECK_FAILURE_NAME:-frontend}" \
      --arg workflow "${MOCK_CHECK_FAILURE_WORKFLOW:-Full-stack quality}" \
      '{check_runs:[{name:$name,status:"completed",conclusion:"failure",head_sha:$head,
        details_url:"https://github.com/example/zerp/actions/runs/123/job/456",
        app:{slug:"github-actions"},workflow_name:$workflow}]}'
    ;;
  *' api --method POST repos/example/zerp/issues '*)
    payload=$(cat)
    attempt=$(cat "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}" 2>/dev/null || printf 0)
    attempt=$((attempt + 1))
    printf '%s\n' "${attempt}" >"${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}"
    payload_title=$(printf '%s' "${payload}" | jq -r '.title // empty')
    if [ "${attempt}" -le "${MOCK_PUBLISH_ISSUE_FAILS:-0}" ]; then
      case "${attempt}" in
        1) echo 'HTTP 502 temporary GitHub failure' >&2 ;;
        2) echo 'HTTP 503 temporary GitHub failure' >&2 ;;
        3) echo 'connection reset by peer' >&2 ;;
        *) echo 'TLS timeout while publishing issue' >&2 ;;
      esac
      exit 1
    fi
    case "${payload_title}" in
      *'External publish retry'*)
        if [ -e "${MOCK_PUBLISH_ISSUE_FAILS_FILE}" ]; then
          rm -f "${MOCK_PUBLISH_ISSUE_FAILS_FILE}"
          echo 'HTTP 503 temporary GitHub failure' >&2
          exit 1
        fi
        ;;
    esac
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
  *' pr checks 77 '*'--json name,state,link,bucket,workflow'*)
    jq -n --arg name "${MOCK_CHECK_FAILURE_NAME:-frontend}" \
      --arg workflow "${MOCK_CHECK_FAILURE_WORKFLOW:-Full-stack quality}" \
      '[{name:$name,state:"FAILURE",bucket:"fail",workflow:$workflow,
        link:"https://github.com/example/zerp/actions/runs/123/job/456"}]'
    exit 1
    ;;
  *' pr checks 77 '*)
    count=$(cat "${MOCK_CHECK_COUNT}" 2>/dev/null || printf 0)
    count=$((count + 1))
    printf '%s\n' "${count}" >"${MOCK_CHECK_COUNT}"
    if [ "${MOCK_CHECK_MODE:-}" = advance-main-once ] && [ "${count}" -le 2 ]; then
      if [ "${count}" = 1 ]; then
        printf 'upstream\n' >"${MOCK_PRIMARY}/upstream.txt"
        git -C "${MOCK_PRIMARY}" add upstream.txt
        git -C "${MOCK_PRIMARY}" commit -m 'upstream change' >/dev/null
        git -C "${MOCK_PRIMARY}" push origin main >/dev/null
      fi
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
  *' run view 123 '*'--job 456 --log-failed'*)
    case "${MOCK_CHECK_LOG_KIND:-product}" in
      product) echo 'TypeScript compilation failed with deterministic error' ;;
      environment) echo 'The hosted runner lost connection while pulling a Docker image' ;;
      test-flake) echo 'Playwright browser process exited unexpectedly' ;;
    esac
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
  *' pr view 77 '*'number,headRefOid,url'*)
    head=$(sed -n 's/.* head=\([0-9a-f]\{40\}\) fingerprint=.*/\1/p' \
      "${MOCK_CAPTURE}/pr-body.md")
    jq -n --arg head "${head}" \
      '{number:77,headRefOid:$head,url:"https://github.com/example/zerp/pull/77"}'
    ;;
  *' pr view 77 '*) printf '{"state":"MERGED","mergeCommit":{"oid":"9999999999999999999999999999999999999999"}}\n' ;;
  *' pr comment 77 '*) printf '{}\n' ;;
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
const fs = require('fs')
const path = require('path')

if (process.argv.includes('--version')) {
  process.stdout.write('10.34.5\n')
  process.exit(0)
}

if (process.argv[2] !== 'install') {
  if (process.argv[2] === 'store' && process.argv[3] === 'path') {
    const storeDir = process.argv[process.argv.indexOf('--store-dir') + 1]
    process.stdout.write(`${storeDir}/v11\n`)
    process.exit(0)
  }
  process.stderr.write(`unexpected cached pnpm command: ${process.argv.slice(2).join(' ')}\n`)
  process.exit(2)
}

const worktree = process.cwd()
const args = process.argv.slice(2)
fs.appendFileSync(process.env.MOCK_PNPM_INSTALL_LOG, `${worktree}\t${args.join(' ')}\n`)
const attemptFile = process.env.MOCK_PNPM_INSTALL_COUNT
const attempt = Number(fs.existsSync(attemptFile) ? fs.readFileSync(attemptFile, 'utf8') : '0') + 1
fs.writeFileSync(attemptFile, `${attempt}\n`)
if (
  attempt <= Number(process.env.MOCK_PNPM_INSTALL_FAILS || 0) ||
  attempt === Number(process.env.MOCK_PNPM_INSTALL_FAIL_ON || 0)
) {
  process.stderr.write(`simulated offline install failure ${attempt}\n`)
  process.exit(1)
}
if (attempt === Number(process.env.MOCK_PNPM_MANIFEST_FAIL_ON || 0)) {
  process.stderr.write('ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile because pnpm-lock.yaml is not up to date with package.json\n')
  process.exit(1)
}
fs.rmSync(path.join(worktree, '.pnpm-store'), { recursive: true, force: true })
fs.rmSync(path.join(worktree, 'frontend/node_modules'), { recursive: true, force: true })
fs.mkdirSync(path.join(worktree, 'node_modules/.pnpm'), { recursive: true })
fs.mkdirSync(path.join(worktree, 'node_modules/.bin'), { recursive: true })
fs.mkdirSync(path.join(worktree, 'frontend/node_modules/.bin'), { recursive: true })
fs.mkdirSync(path.join(worktree, 'frontend/node_modules/.tmp'), { recursive: true })
fs.writeFileSync(
  path.join(worktree, 'node_modules/.modules.yaml'),
  `${JSON.stringify({ storeDir: `${args[args.indexOf('--store-dir') + 1]}/v11`, virtualStoreDir: '.pnpm' })}\n`,
)
fs.writeFileSync(path.join(worktree, 'frontend/node_modules/.bin/vite'), '#!/bin/sh\nexit 0\n')
fs.chmodSync(path.join(worktree, 'frontend/node_modules/.bin/vite'), 0o700)
fs.writeFileSync(path.join(worktree, 'frontend/node_modules/vite'), '')
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
export MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT="${tmp}/publish-issue-attempt-count"
export MOCK_PUBLISH_ISSUE_FAILS_FILE="${tmp}/publish-issue-fails"
export MOCK_CODEX_ARGS="${tmp}/codex-args"
export MOCK_COREPACK_ROOT="${tmp}/corepack-root"
export MOCK_GATE_COUNT="${tmp}/gate-count"
export MOCK_FAST_GATE_COUNT="${tmp}/fast-gate-count"
export MOCK_FOCUSED_E2E_COUNT="${tmp}/focused-e2e-count"
export MOCK_FOCUSED_INTEGRATION_COUNT="${tmp}/focused-integration-count"
export MOCK_GATE_COREPACK_ROOT="${tmp}/gate-corepack-root"
export MOCK_CODEX_PNPM_PATH="${tmp}/codex-pnpm-path"
export MOCK_CODEX_PNPM_VERSION="${tmp}/codex-pnpm-version"
export MOCK_GATE_PNPM_PATH="${tmp}/gate-pnpm-path"
export MOCK_GATE_PNPM_VERSION="${tmp}/gate-pnpm-version"
export MOCK_GATE_ENV_TARGET="${tmp}/gate-env-target"
export MOCK_GATE_E2E_ENV_TARGET="${tmp}/gate-e2e-env-target"
export MOCK_FOCUSED_E2E_ENV_TARGET="${tmp}/focused-e2e-env-target"
export MOCK_PNPM_INSTALL_LOG="${tmp}/pnpm-install.log"
export MOCK_PNPM_INSTALL_COUNT="${tmp}/pnpm-install-count"
export MOCK_IMESSAGE_RECIPIENT='issue-local-test@example.invalid'
export MOCK_IMESSAGE_EVENTS="${tmp}/imessage-events"
export MOCK_MESSAGES_STARTED="${tmp}/messages-started"
export MOCK_OSASCRIPT_PID="${tmp}/osascript-pid"
export ZERP_PNPM_STORE_PATH="${pnpm_store}"
export ZERP_ISSUE_ENVIRONMENT_RETRY_WAIT_SECONDS=0
export MOCK_PREVIEW_REQUIRE_INDEPENDENT_MODULES=1
export MOCK_PREVIEW_LEAVES_DEPENDENCY_RESIDUE=1
: >"${events}"

PATH="${tmp}/bin:${PATH}" \
ZERP_PRIMARY_ROOT="${primary}" \
ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
ZERP_GITHUB_REPOSITORY=example/zerp \
  ZERP_CODEX_BIN=codex \
ZERP_GH_BIN=gh \
ZERP_ISSUE_MESSAGE_RECIPIENT="${MOCK_IMESSAGE_RECIPIENT}" \
ZERP_OSASCRIPT_BIN="${tmp}/bin/osascript" \
ZERP_PGREP_BIN="${tmp}/bin/pgrep" \
ZERP_ISSUE_PREVIEW_COMMAND="${tmp}/bin/preview" \
  ZERP_ISSUE_PRODUCTION_COMMAND="${tmp}/bin/production" \
  ZERP_ISSUE_GATE_COMMAND="${tmp}/bin/gate" \
  MOCK_VERIFY_COMPLETION_CANDIDATE=1 \
  "${repo_root}/scripts/issue-local.sh" run

test "$(cat "${tmp}/issue-count")" = 2
test "$(grep -c '^codex$' "${events}")" = 1
test "$(cat "${MOCK_FAST_GATE_COUNT}")" = 1
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
if grep -Fq -- 'Before the final two-axis review, run `scripts/change-gate.sh --fast' "${MOCK_PROMPT}"; then
  echo 'Codex prompt still delegates the host fast gate to the sandbox' >&2
  exit 1
fi
grep -Fq -- 'The host Validation module runs fast, baseline, delta reverify, and final release checks' \
  "${MOCK_PROMPT}"
expected_fast_head=$(jq -r .commitSha "${runtime}/batches/inventory-query/implementation.json")
jq -e --arg head "${expected_fast_head}" '
  .status == "passed" and .mode == "fast" and .head == $head
' "${runtime}/batches/inventory-query/fast-gate-evidence.json" >/dev/null
jq -e '.tickets == 2 and .acceptanceCriteria == 2 and .largeBatch == false' \
  "${runtime}/batches/inventory-query/risk.json" >/dev/null
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
grep -Fq -- "install --offline --frozen-lockfile --store-dir ${pnpm_store}" \
  "${MOCK_PNPM_INSTALL_LOG}"
test "$(cat "${MOCK_PNPM_INSTALL_COUNT}")" = 1
if awk -F '\t' -v primary="${primary}" '$1 == primary {found=1} END {exit !found}' \
  "${MOCK_PNPM_INSTALL_LOG}"; then
  echo 'WorktreeEnvironment installed dependencies in the primary worktree' >&2
  exit 1
fi
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

test_checkpoint() {
  [ "${ZERP_ISSUE_LOCAL_TEST_STOP_AFTER:-}" != "$1" ] || {
    echo "local issue tests passed through $1"
    exit 0
  }
}

for notification_event in in-progress implementing fast-gate validation-baseline \
  public-preview preview-passed pr-open github-checks ci-passed merged production 'done'; do
  find "${runtime}/notifications/pending" -type f -name '*.json' -exec \
    jq -e --arg event "${notification_event}" \
      'select(.feature == "inventory-query" and .event == $event) | true' {} \; \
    | grep -q true || {
      echo "missing notification progress event: ${notification_event}" >&2
      exit 1
    }
done
test_checkpoint notification-progress

run_agent() {
  PATH="${tmp}/bin:${PATH}" \
  ZERP_PRIMARY_ROOT="${primary}" \
  ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  ZERP_GITHUB_REPOSITORY=example/zerp \
  ZERP_CODEX_BIN=codex \
ZERP_GH_BIN=gh \
ZERP_ISSUE_MESSAGE_RECIPIENT="${MOCK_IMESSAGE_RECIPIENT}" \
ZERP_OSASCRIPT_BIN="${tmp}/bin/osascript" \
ZERP_PGREP_BIN="${tmp}/bin/pgrep" \
ZERP_ISSUE_PREVIEW_COMMAND="${tmp}/bin/preview" \
ZERP_ISSUE_PRODUCTION_COMMAND="${tmp}/bin/production" \
ZERP_ISSUE_GATE_COMMAND="${tmp}/bin/gate" \
ZERP_ISSUE_FOCUSED_E2E_COMMAND="${tmp}/bin/focused-e2e" \
ZERP_ISSUE_FOCUSED_INTEGRATION_COMMAND="${tmp}/bin/focused-integration" \
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

prepare_reviewed_candidate legacy-budget-migration
legacy_budget="${runtime}/batches/legacy-budget-migration/repair-budget.json"
jq -n '{version:1,total:0,lastStage:null,lastFingerprint:null,consecutive:0,
  events:[],recoveries:[]}' >"${legacy_budget}"
retry_agent legacy-budget-migration
jq -e '.version == 2 and .nonProductEvents == [] and .startedAt != null and
  (.startedAtEpoch | type == "number")' \
  "${legacy_budget}" >/dev/null
test_checkpoint legacy-budget-migration

make_ticket automation-after-code-change 'Automation after code change'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_CODEX_MODE=commit-then-fail MOCK_CODEX_REVIEW_EXISTING=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(grep -c '^model-commit$' "${events}")" = 1
test "$(jq -r .total \
  "${runtime}/batches/automation-after-code-change/repair-budget.json")" = 2
test "$(jq -r '.events[0].automationAfterCodeChange' \
  "${runtime}/batches/automation-after-code-change/repair-budget.json")" = true
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "automation")] | length' \
  "${runtime}/batches/automation-after-code-change/repair-budget.json")" = 1
grep -Fq 'unreviewed automated commit' "${MOCK_PROMPT}-2"
grep -Fq '**Status:** done' \
  "${primary}/.scratch/automation-after-code-change/issues/01-ticket.md"
unset MOCK_CODEX_MODE MOCK_CODEX_REVIEW_EXISTING
test_checkpoint automation-after-code-change

make_ticket preview-exact-mismatch 'Preview exact SHA mismatch'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_PREVIEW_EXACT_MISMATCH_FAILS=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 2
test "$(jq -r .total \
  "${runtime}/batches/preview-exact-mismatch/repair-budget.json")" = 1
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "automation")] | length' \
  "${runtime}/batches/preview-exact-mismatch/repair-budget.json")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/preview-exact-mismatch/issues/01-ticket.md"
unset MOCK_PREVIEW_EXACT_MISMATCH_FAILS
test_checkpoint preview-exact-mismatch

make_ticket external-stage-cap 'External stage retry cap'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}"
if MOCK_PUBLISH_ISSUE_FAILS=4 ZERP_ISSUE_NON_PRODUCT_STAGE_RETRY_LIMIT=3 run_agent; then
  echo 'varying external failures exceeded the per-stage retry cap' >&2
  exit 1
fi
test "$(cat "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}")" = 3
test "$(cat "${runtime}/batches/external-stage-cap/state")" = external-blocked
test "$(jq -r '.nonProductEvents | length' \
  "${runtime}/batches/external-stage-cap/repair-budget.json")" = 3
test "$(jq -r '.policyDecision' \
  "${runtime}/batches/external-stage-cap/failure.json")" = BLOCK_EXTERNAL
unset MOCK_PUBLISH_ISSUE_FAILS ZERP_ISSUE_NON_PRODUCT_STAGE_RETRY_LIMIT
test_checkpoint external-stage-cap

make_ticket external-batch-cap 'External batch retry cap'
external_batch_budget="${runtime}/batches/external-batch-cap/repair-budget.json"
mkdir -p "$(dirname "${external_batch_budget}")"
jq -n --arg started_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --argjson started_at_epoch "$(date +%s)" \
  '{version:2,startedAt:$started_at,startedAtEpoch:$started_at_epoch,total:0,
    lastStage:null,lastFingerprint:null,consecutive:0,events:[],recoveries:[],
    nonProductEvents:[
      {failureClass:"environment",stage:"preparing-worktree",signature:("a" * 64),candidateHead:null},
      {failureClass:"automation",stage:"fast-gate-evidence",signature:("b" * 64),candidateHead:null}
    ]}' >"${external_batch_budget}"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}"
if MOCK_PUBLISH_ISSUE_FAILS=1 ZERP_ISSUE_NON_PRODUCT_BATCH_RETRY_LIMIT=3 run_agent; then
  echo 'external failure exceeded the batch-wide retry cap' >&2
  exit 1
fi
test "$(cat "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}")" = 1
test "$(cat "${runtime}/batches/external-batch-cap/state")" = external-blocked
test "$(jq -r '.retryBudget.exhausted' \
  "${runtime}/batches/external-batch-cap/failure.json")" = batch-total
unset MOCK_PUBLISH_ISSUE_FAILS ZERP_ISSUE_NON_PRODUCT_BATCH_RETRY_LIMIT
test_checkpoint external-batch-cap

make_ticket external-deadline 'External batch deadline'
external_deadline_budget="${runtime}/batches/external-deadline/repair-budget.json"
mkdir -p "$(dirname "${external_deadline_budget}")"
jq -n '{version:2,startedAt:"1970-01-01T00:00:01Z",startedAtEpoch:1,total:0,
  lastStage:null,lastFingerprint:null,consecutive:0,events:[],recoveries:[],
  nonProductEvents:[]}' >"${external_deadline_budget}"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}"
if MOCK_PUBLISH_ISSUE_FAILS=1 run_agent; then
  echo 'external failure exceeded the batch wall-clock deadline' >&2
  exit 1
fi
test "$(cat "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}")" = 1
test "$(cat "${runtime}/batches/external-deadline/state")" = external-blocked
test "$(jq -r '.retryBudget.exhausted' \
  "${runtime}/batches/external-deadline/failure.json")" = deadline
unset MOCK_PUBLISH_ISSUE_FAILS
test_checkpoint external-deadline

make_ticket checks-transient 'Transient required check failure'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
MOCK_CHECKS_FAILS=1 ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_CHECK_COUNT}")" = 2
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "external")] | length' \
  "${runtime}/batches/checks-transient/repair-budget.json")" = 1
expected_check_head=$(jq -r .commitSha \
  "${runtime}/batches/checks-transient/implementation.json")
jq -e --arg head "${expected_check_head}" '
  .head == $head and .pr == 77 and .failures[0].provider == "github-actions" and
  .failures[0].link == "https://github.com/example/zerp/actions/runs/123/job/456"
' "${runtime}/batches/checks-transient/required-check-evidence.json" >/dev/null
grep -Fq '**Status:** done' "${primary}/.scratch/checks-transient/issues/01-ticket.md"
unset MOCK_CHECKS_FAILS ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS
test_checkpoint checks-transient

make_ticket checks-environment 'Required check runner failure'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
MOCK_CHECKS_FAILS=2 MOCK_CHECK_LOG_KIND=environment \
  ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_CHECK_COUNT}")" = 3
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "external")] | length' \
  "${runtime}/batches/checks-environment/repair-budget.json")" = 1
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "environment")] | length' \
  "${runtime}/batches/checks-environment/repair-budget.json")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/checks-environment/issues/01-ticket.md"
unset MOCK_CHECKS_FAILS MOCK_CHECK_LOG_KIND ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS
test_checkpoint checks-environment

make_ticket validation-lifecycle 'Incremental validation lifecycle'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_FAST_GATE_COUNT}" "${MOCK_GATE_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_VALIDATION_MULTI_FAILURE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(grep -c '^gate-baseline$' "${events}")" = 1
test "$(grep -c '^gate-reverify$' "${events}")" = 1
test "$(grep -c '^gate-release$' "${events}")" = 1
grep -Fq 'frontend' "${MOCK_PROMPT}-2"
grep -Fq 'backend' "${MOCK_PROMPT}-2"
jq -e '.mode == "reverify" and .status == "passed" and
  all(.stages[]; .status == "passed")' \
  "${runtime}/batches/validation-lifecycle/validation-evidence.json" >/dev/null
jq -e '.mode == "release" and .status == "passed"' \
  "${runtime}/batches/validation-lifecycle/gate-evidence.json" >/dev/null
grep -Fq '**Status:** done' "${primary}/.scratch/validation-lifecycle/issues/01-ticket.md"
unset MOCK_VALIDATION_MULTI_FAILURE
test_checkpoint validation-lifecycle

make_ticket validation-dirty-promotion 'Validation dirty promotion'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}"
MOCK_BASELINE_DIRTY=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(grep -c '^gate-baseline$' "${events}")" = 1
test "$(grep -c '^gate-release$' "${events}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq '**Status:** done' \
  "${primary}/.scratch/validation-dirty-promotion/issues/01-ticket.md"
unset MOCK_BASELINE_DIRTY
test_checkpoint validation-dirty-promotion

make_ticket dependency-lock-independent 'Candidate lockfile independence'
independent_lock_worktree="${runtime}/worktrees/dependency-lock-independent"
mkdir -p "$(dirname "${independent_lock_worktree}")"
git -C "${primary}" worktree add -b automation/local-dependency-lock-independent \
  "${independent_lock_worktree}" main >/dev/null
printf 'lockfileVersion: "9.0"\nsettings:\n  autoInstallPeers: false\n' \
  >"${independent_lock_worktree}/pnpm-lock.yaml"
git -C "${independent_lock_worktree}" add pnpm-lock.yaml
git -C "${independent_lock_worktree}" \
  -c user.name='Dependency Test' -c user.email=dependency@example.com \
  commit -m 'test: candidate lockfile change' >/dev/null
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_COREPACK_ROOT}" "${MOCK_PNPM_INSTALL_LOG}"
run_agent
grep -Fq 'worktrees/dependency-lock-independent' "${MOCK_PNPM_INSTALL_LOG}"
grep -Fq '**Status:** done' \
  "${primary}/.scratch/dependency-lock-independent/issues/01-ticket.md"
test_checkpoint dependency-lock-independent

make_ticket primary-dependencies-absent 'Primary dependencies absent'
mv "${primary}/node_modules" "${primary}/node_modules.saved"
mv "${primary}/frontend/node_modules" "${primary}/frontend/node_modules.saved"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_COREPACK_ROOT}" "${MOCK_PNPM_INSTALL_LOG}"
run_agent
mv "${primary}/node_modules.saved" "${primary}/node_modules"
mv "${primary}/frontend/node_modules.saved" "${primary}/frontend/node_modules"
grep -Fq '**Status:** done' \
  "${primary}/.scratch/primary-dependencies-absent/issues/01-ticket.md"
test_checkpoint primary-dependencies-absent

make_ticket environment-invariant-repair 'Environment invariant repair'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_PNPM_INSTALL_COUNT}"
MOCK_PREVIEW_CORRUPTS_MODULES=1 run_agent
test "$(cat "${MOCK_PNPM_INSTALL_COUNT}")" = 2
grep -Fq '**Status:** done' \
  "${primary}/.scratch/environment-invariant-repair/issues/01-ticket.md"
unset MOCK_PREVIEW_CORRUPTS_MODULES
test_checkpoint environment-invariant-repair

make_ticket environment-prepare-retry 'Environment prepare retry'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_PNPM_INSTALL_COUNT}"
MOCK_PNPM_INSTALL_FAILS=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(jq -r '[.nonProductEvents[] |
  select(.failureClass == "environment" and .stage == "preparing-worktree")] | length' \
  "${runtime}/batches/environment-prepare-retry/repair-budget.json")" = 1
grep -Fq '**Status:** done' \
  "${primary}/.scratch/environment-prepare-retry/issues/01-ticket.md"
find "${runtime}/notifications/pending" -type f -name '*.json' -exec \
  jq -e 'select(.feature == "environment-prepare-retry" and
    .event == "retry-RETRY_ENVIRONMENT") | true' {} \; | grep -q true
unset MOCK_PNPM_INSTALL_FAILS
test_checkpoint environment-prepare-retry

make_ticket environment-restore-retry 'Environment restore retry'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_PNPM_INSTALL_COUNT}"
MOCK_PNPM_INSTALL_FAIL_ON=2 MOCK_CODEX_CHANGE_MANIFEST=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_PNPM_INSTALL_COUNT}")" = 3
test "$(jq -r '[.nonProductEvents[] |
  select(.failureClass == "environment" and .stage == "worktree-environment")] | length' \
  "${runtime}/batches/environment-restore-retry/repair-budget.json")" = 1
grep -Fq '**Status:** done' \
  "${primary}/.scratch/environment-restore-retry/issues/01-ticket.md"
unset MOCK_PNPM_INSTALL_FAIL_ON MOCK_CODEX_CHANGE_MANIFEST
test_checkpoint environment-restore-retry

make_ticket dependency-manifest-repair 'Dependency manifest repair'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_PNPM_INSTALL_COUNT}"
MOCK_PNPM_MANIFEST_FAIL_ON=2 MOCK_CODEX_CHANGE_MANIFEST=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(cat "${MOCK_PNPM_INSTALL_COUNT}")" = 3
test "$(jq -r .total \
  "${runtime}/batches/dependency-manifest-repair/repair-budget.json")" = 2
test "$(jq -r '.nonProductEvents | length' \
  "${runtime}/batches/dependency-manifest-repair/repair-budget.json")" = 0
grep -Fq 'ERR_PNPM_OUTDATED_LOCKFILE' "${MOCK_PROMPT}-2"
grep -Fq '**Status:** done' \
  "${primary}/.scratch/dependency-manifest-repair/issues/01-ticket.md"
find "${runtime}/notifications/pending" -type f -name '*.json' -exec \
  jq -e 'select(.feature == "dependency-manifest-repair" and
    .event == "retry-REPAIR_CODE") | true' {} \; | grep -q true
unset MOCK_PNPM_MANIFEST_FAIL_ON MOCK_CODEX_CHANGE_MANIFEST
test_checkpoint dependency-manifest-repair

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
ln -s "${primary}/node_modules" "${managed_candidate}/node_modules"
retry_agent retry-managed-link
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_PNPM_INSTALL_LOG}"
run_agent
test ! -e "${MOCK_CODEX_COUNT}"
grep -Fq 'worktrees/retry-managed-link' "${MOCK_PNPM_INSTALL_LOG}"
grep -Fq '**Status:** done' \
  "${primary}/.scratch/retry-managed-link/issues/01-ticket.md"
test_checkpoint retry-managed-link

make_ticket unmanaged-dependency-link 'Unmanaged dependency link'
unmanaged_candidate="${runtime}/worktrees/unmanaged-dependency-link"
mkdir -p "$(dirname "${unmanaged_candidate}")" "${tmp}/unmanaged-modules"
git -C "${primary}" worktree add -b automation/local-unmanaged-dependency-link \
  "${unmanaged_candidate}" main >/dev/null
ln -s "${tmp}/unmanaged-modules" "${unmanaged_candidate}/node_modules"
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}"
if run_agent; then
  echo 'unmanaged candidate dependency symlink was accepted' >&2
  exit 1
fi
test ! -e "${MOCK_CODEX_COUNT}"
test "$(cat "${runtime}/batches/unmanaged-dependency-link/state")" = automation-blocked
jq -e '.failureClass == "automation" and .policyDecision == "BLOCK_AUTOMATION"' \
  "${runtime}/batches/unmanaged-dependency-link/failure.json" >/dev/null
grep -Fq '**Status:** blocked' \
  "${primary}/.scratch/unmanaged-dependency-link/issues/01-ticket.md"
test_checkpoint unmanaged-dependency-link

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
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(cat "${MOCK_FOCUSED_E2E_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq 'focused-e2e tests/e2e/user-management-lifecycle.spec.ts --project=system-serial --no-deps' "${events}"
test "$(cat "${MOCK_FOCUSED_E2E_ENV_TARGET}")" = "${primary}/backend/.env.e2e.local"
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "test-flake")] | length' \
  "${runtime}/batches/gate-repair/repair-budget.json")" = 1
grep -Fq '"event":"gate-passed"' "${runtime}/batches/gate-repair/timeline.jsonl"
grep -Fq '**Status:** done' "${primary}/.scratch/gate-repair/issues/01-ticket.md"
unset MOCK_GATE_FAILS MOCK_GATE_LONG_FAILURE MOCK_GATE_E2E_FAILURE
test_checkpoint gate-repair

make_ticket gate-invalid-evidence 'Gate invalid evidence'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_INVALID_EVIDENCE_FAILS=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "automation")] | length' \
  "${runtime}/batches/gate-invalid-evidence/repair-budget.json")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/gate-invalid-evidence/issues/01-ticket.md"
unset MOCK_GATE_INVALID_EVIDENCE_FAILS

make_ticket e2e-product-repair 'E2E product repair'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_FOCUSED_E2E_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=1 MOCK_GATE_E2E_FAILURE=1 MOCK_FOCUSED_E2E_FAILS=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(cat "${MOCK_GATE_COUNT}")" = 3
test "$(cat "${MOCK_FOCUSED_E2E_COUNT}")" = 2
grep -Fq 'Focused E2E reproduced the failure' "${MOCK_PROMPT}-2"
test "$(jq -r .total \
  "${runtime}/batches/e2e-product-repair/repair-budget.json")" = 2
test "$(jq -r '.nonProductEvents | length' \
  "${runtime}/batches/e2e-product-repair/repair-budget.json")" = 0
grep -Fq '**Status:** done' "${primary}/.scratch/e2e-product-repair/issues/01-ticket.md"
unset MOCK_GATE_FAILS MOCK_GATE_E2E_FAILURE MOCK_FOCUSED_E2E_FAILS
test_checkpoint e2e-product-repair

make_ticket integration-repair 'Integration repair'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_FOCUSED_INTEGRATION_COUNT}" \
  "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=1 MOCK_GATE_INTEGRATION_FAILURE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(cat "${MOCK_FOCUSED_INTEGRATION_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq 'focused-integration internal/wfl' "${events}"
focused_integration_line=$(grep -n '^focused-integration ' "${events}" | cut -d: -f1)
last_gate_line=$(grep -n '^gate$' "${events}" | tail -n 1 | cut -d: -f1)
test "${focused_integration_line}" -lt "${last_gate_line}"
test ! -e "${runtime}/batches/integration-repair/repair-integration.json"
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "test-flake")] | length' \
  "${runtime}/batches/integration-repair/repair-budget.json")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/integration-repair/issues/01-ticket.md"
unset MOCK_GATE_FAILS MOCK_GATE_INTEGRATION_FAILURE
test_checkpoint integration-repair

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
grep -Eq 'Validation (baseline|reverify) collected failures' \
  "${runtime}/batches/gate-blocked/failure.md"
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
test "$(cat "${MOCK_GATE_COUNT}")" = 2
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/gate-blocked/repair-budget.json")" = 3
test "$(jq '.events | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 3
test "$(jq '.recoveries | length' "${runtime}/batches/gate-blocked/repair-budget.json")" = 1
test "$(jq -r '.recoveries[0].previousConsecutive' "${runtime}/batches/gate-blocked/repair-budget.json")" = 2
test "$(jq -r '.recoveries[0].candidateHead' "${runtime}/batches/gate-blocked/repair-budget.json")" = "${manual_repair_head}"
unset MOCK_CODEX_REVIEW_EXISTING
test_checkpoint gate-blocked

make_ticket gate-fingerprint-advance 'Gate fingerprint advance'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=2 MOCK_GATE_FAILURE_UNIQUE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 3
test "$(cat "${MOCK_GATE_COUNT}")" = 4
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/gate-fingerprint-advance/repair-budget.json")" = 3
test "$(jq -r .consecutive "${runtime}/batches/gate-fingerprint-advance/repair-budget.json")" = 1

make_ticket gate-numeric-fingerprint-advance 'Gate numeric fingerprint advance'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=2 MOCK_GATE_FAILURE_NUMERIC_UNIQUE=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 3
test "$(cat "${MOCK_GATE_COUNT}")" = 4
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/gate-numeric-fingerprint-advance/repair-budget.json")" = 3
test "$(jq -r .consecutive "${runtime}/batches/gate-numeric-fingerprint-advance/repair-budget.json")" = 1
unset MOCK_GATE_FAILURE_NUMERIC_UNIQUE

make_ticket repair-stage-advance 'Repair stage advance'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_CODEX_FAILS=1 MOCK_GATE_FAILS=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 3
test "$(cat "${MOCK_GATE_COUNT}")" = 3
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/repair-stage-advance/repair-budget.json")" = 2
test "$(jq -r .consecutive "${runtime}/batches/repair-stage-advance/repair-budget.json")" = 1
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "automation")] | length' \
  "${runtime}/batches/repair-stage-advance/repair-budget.json")" = 1
unset MOCK_CODEX_FAILS MOCK_GATE_FAILS

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
test "$(jq -r .total "${runtime}/batches/code-review-retry/repair-budget.json")" = 0
test "$(jq -r '.nonProductEvents | length' \
  "${runtime}/batches/code-review-retry/repair-budget.json")" = 2
test "$(cat "${runtime}/batches/code-review-retry/state")" = automation-blocked
jq -e '.failureClass == "automation" and .stage == "code-review-gate" and
  .policyDecision == "BLOCK_AUTOMATION"' \
  "${runtime}/batches/code-review-retry/failure.json" >/dev/null
retry_agent code-review-retry
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/code-review-retry/repair-budget.json")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/code-review-retry/issues/01-ticket.md"
test_checkpoint code-review-retry

make_ticket gate-budget-blocked 'Gate budget blocked'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_GATE_FAILS=10 MOCK_GATE_FAILURE_UNIQUE=1 run_agent; then
  echo 'repair budget allowed more than eight code/review/gate repairs' >&2
  exit 1
fi
test "$(cat "${MOCK_CODEX_COUNT}")" = 9
test "$(cat "${MOCK_GATE_COUNT}")" = 9
test ! -e "${MOCK_PREVIEW_COUNT}"
test "$(jq -r .total "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = 9
grep -Fq 'Repair budget exhausted' "${runtime}/batches/gate-budget-blocked/failure.md"
test "$(grep -c 'Repair budget exhausted:' "${runtime}/batches/gate-budget-blocked/failure.md")" = 1
unset MOCK_GATE_FAILS MOCK_GATE_FAILURE_UNIQUE

gate_budget_worktree="${runtime}/worktrees/gate-budget-blocked"
printf 'manual repair after budget exhaustion\n' >"${gate_budget_worktree}/manual-repair.txt"
git -C "${gate_budget_worktree}" add manual-repair.txt
git -C "${gate_budget_worktree}" -c user.name='Manual Repair' -c user.email=manual@example.com \
  commit -m 'fix: manual repair after budget exhaustion' >/dev/null
manual_budget_repair_head=$(git -C "${gate_budget_worktree}" rev-parse HEAD)
retry_agent gate-budget-blocked
test "$(jq -r .total "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = 9
test "$(jq -r '.recoveries[-1].candidateHead' "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = "${manual_budget_repair_head}"
test "$(jq -r '.recoveries[-1].consumed' "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = false
: >"${events}"
MOCK_CODEX_REVIEW_EXISTING=1 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 10
test "$(cat "${MOCK_GATE_COUNT}")" = 11
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
test "$(jq -r .total "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = 10
test "$(jq '.events | length' "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = 10
test "$(jq -r '.recoveries[-1].consumed' "${runtime}/batches/gate-budget-blocked/repair-budget.json")" = true
unset MOCK_CODEX_REVIEW_EXISTING
test_checkpoint gate-budget-blocked

make_ticket legacy-model-validation 'Legacy model validation'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
MOCK_GATE_FAILS=0 MOCK_VALIDATION=passed run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 1
grep -Fq '**Status:** done' "${primary}/.scratch/legacy-model-validation/issues/01-ticket.md"
unset MOCK_GATE_FAILS MOCK_VALIDATION
test_checkpoint legacy-model-validation

make_ticket preview-repair 'Preview repair'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
export MOCK_PREVIEW_FAILS=1
run_agent
unset MOCK_PREVIEW_FAILS
test "$(grep -c '^codex$' "${events}")" = 1
test "$(grep -c '^gate$' "${events}")" = 1
test "$(grep -c '^preview$' "${events}")" = 2
test "$(jq -r .total "${runtime}/batches/preview-repair/repair-budget.json")" = 1
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "environment")] | length' \
  "${runtime}/batches/preview-repair/repair-budget.json")" = 1
test -r "${runtime}/batches/preview-repair/attempts/"*/failure.json
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
test "$(grep -c '^preview$' "${events}")" = 3
if grep -q '^gh ' "${events}"; then
  echo 'GitHub was accessed before a preview passed' >&2
  exit 1
fi
grep -Fq '**Status:** blocked' "${primary}/.scratch/preview-blocked/issues/01-ticket.md"
test "$(cat "${runtime}/batches/preview-blocked/state")" = preview-blocked
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "environment")] | length' \
  "${runtime}/batches/preview-blocked/repair-budget.json")" = 3

make_ticket preview-invalid-evidence 'Preview invalid evidence'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_PREVIEW_INVALID_EVIDENCE_FAILS=2 run_agent; then
  echo 'repeated invalid preview evidence was accepted' >&2
  exit 1
fi
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_GATE_COUNT}")" = 1
test "$(cat "${MOCK_PREVIEW_COUNT}")" = 2
test "$(cat "${runtime}/batches/preview-invalid-evidence/state")" = automation-blocked
test "$(jq -r '[.nonProductEvents[] | select(.failureClass == "automation")] | length' \
  "${runtime}/batches/preview-invalid-evidence/repair-budget.json")" = 2
test "$(jq -r '.policyDecision' \
  "${runtime}/batches/preview-invalid-evidence/failure.json")" = BLOCK_AUTOMATION
unset MOCK_PREVIEW_INVALID_EVIDENCE_FAILS

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

make_ticket large-batch-risk 'Large batch risk'
large_issues="${primary}/.scratch/large-batch-risk/issues"
for number in 02 03 04 05; do
  cat >"${large_issues}/${number}-ticket.md" <<EOF
# ${number} — Large batch slice ${number}

**What to build:** Deliver large batch slice ${number}.

**Blocked by:** 01 — Large batch risk

**Status:** ready-for-agent

- [ ] Large batch slice ${number} accepted
EOF
done
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}"
if MOCK_CODEX_MODE=needs-input run_agent; then
  echo 'large batch needs-input result was accepted' >&2
  exit 1
fi
jq -e '.tickets == 5 and .largeBatch == true' \
  "${runtime}/batches/large-batch-risk/risk.json" >/dev/null
grep -Fq 'This is a large batch' "${MOCK_PROMPT}-1"

make_ticket checks-registering 'Checks registering'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_PREVIEW_COUNT}" "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
MOCK_CODEX_MODE=completed MOCK_PREVIEW_FAILS=0 MOCK_CHECKS_MISSING=1 \
  MOCK_CHECKS_MISSING_MESSAGE=plain \
  ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
test "$(cat "${MOCK_CHECK_COUNT}")" = 2
grep -Fq '**Status:** done' "${primary}/.scratch/checks-registering/issues/01-ticket.md"

make_ticket external-publish-retry 'External publish retry'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}" "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}"
: >"${MOCK_PUBLISH_ISSUE_FAILS_FILE}"
export ZERP_ISSUE_EXTERNAL_RETRY_WAIT_SECONDS=0
run_agent
test "$(cat "${MOCK_CODEX_COUNT}")" = 1
publish_attempts=$(cat "${MOCK_PUBLISH_ISSUE_ATTEMPT_COUNT}")
external_failures=$(jq -r \
  '[.nonProductEvents[] | select(.failureClass == "external")] | length' \
  "${runtime}/batches/external-publish-retry/repair-budget.json")
if [ "${publish_attempts}" != 2 ] || [ "${external_failures}" != 1 ]; then
  echo "unexpected external retry evidence: attempts=${publish_attempts} failures=${external_failures}" >&2
  exit 1
fi
grep -Fq '**Status:** done' "${primary}/.scratch/external-publish-retry/issues/01-ticket.md"
unset ZERP_ISSUE_EXTERNAL_RETRY_WAIT_SECONDS

make_ticket checks-repeated 'Checks repeated'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
export MOCK_CHECKS_MISSING=0 MOCK_CHECKS_FAILS=4
if ZERP_ISSUE_CHECK_REGISTRATION_WAIT_SECONDS=0 run_agent; then
  echo 'repeated identical required-check failures were accepted' >&2
  exit 1
fi
unset MOCK_CHECKS_MISSING MOCK_CHECKS_FAILS
test "$(cat "${MOCK_CODEX_COUNT}")" = 2
test "$(cat "${MOCK_CHECK_COUNT}")" = 4
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
test "$(cat "${MOCK_CHECK_COUNT}")" = 3
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

# The repair path and its caller both request this event; the outbox de-duplicates it.
test "$(find "${runtime}/notifications/pending" -type f -name '*.json' -exec \
  jq -r 'select(.feature == "checks-repeated" and .event == "blocked") | .id' {} \; | \
  wc -l | tr -d ' ')" = 1

make_ticket production-notification 'Production notification'
: >"${events}"
rm -f "${MOCK_CODEX_COUNT}" "${MOCK_GATE_COUNT}" "${MOCK_PREVIEW_COUNT}" \
  "${MOCK_ISSUE_COUNT}" "${MOCK_CHECK_COUNT}"
if MOCK_PRODUCTION_FAIL=1 run_agent; then
  echo 'production verification failure was accepted' >&2
  exit 1
fi
grep -Fq '**Status:** blocked' "${primary}/.scratch/production-notification/issues/01-ticket.md"
test "$(cat "${runtime}/batches/production-notification/state")" = production-blocked
test "$(jq -r '.failureClass' \
  "${runtime}/batches/production-notification/failure.json")" = environment
test "$(find "${runtime}/notifications/pending" -type f -name '*.json' -exec \
  jq -r 'select(.feature == "production-notification" and .event == "production-blocked") | .id' {} \; | \
  wc -l | tr -d ' ')" = 1

PATH="${tmp}/bin:${PATH}" \
ZERP_PRIMARY_ROOT="${primary}" \
ZERP_ISSUE_TRACKER_ROOT="${primary}/.scratch" \
ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${runtime}" \
  "${repo_root}/scripts/issue-local.sh" diagnose production-notification \
  >"${tmp}/diagnose.txt"
grep -Fq 'state=production-blocked' "${tmp}/diagnose.txt"
grep -Fq 'phase=production-blocked' "${tmp}/diagnose.txt"
grep -Fq 'recentTimeline=' "${tmp}/diagnose.txt"

echo 'local issue retry and stop tests passed'
