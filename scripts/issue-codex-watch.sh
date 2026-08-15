#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
gh_bin=${ZERP_GH_BIN:-gh}
codex_bin=${ZERP_CODEX_BIN:-codex}
repo=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
repo_owner=${repo%%/*}
repo_name=${repo#*/}
primary_root=${ZERP_PRIMARY_ROOT:-/Users/hansonyu/code/zerp}
automation_helper=${ZERP_ISSUE_AUTOMATION_HELPER:-${primary_root}/scripts/issue-automation.sh}
runtime_root=${ZERP_ISSUE_CODEX_RUNTIME_ROOT:-${primary_root}/backend/var/issue-codex}
lock_dir="${runtime_root}/agent.lock"
repository_root=${ZERP_ISSUE_CODEX_REPOSITORY_ROOT:-${runtime_root}/repository}
source_root="${runtime_root}/source"
task_dir=

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }

run_gate() {
  worktree=$1
  output=$2
  if [ -n "${ZERP_ISSUE_CODEX_GATE_BIN:-}" ]; then
    ZERP_WORKTREE="${worktree}" "${ZERP_ISSUE_CODEX_GATE_BIN}" >"${output}" 2>&1
  else
    {
      make -C "${worktree}" pre-push-plan
      make -C "${worktree}" pre-push
    } >"${output}" 2>&1
  fi
}

if [ "${ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH:-0}" != 1 ]; then
  implementer_root=${ZERP_IMPLEMENTER_APP_CREDENTIAL_ROOT:-${HOME}/.secrets/zerp-issue-implementer}
  reviewer_root=${ZERP_REVIEWER_APP_CREDENTIAL_ROOT:-${HOME}/.secrets/zerp-issue-reviewer}
  token_helper=${ZERP_GITHUB_APP_TOKEN_HELPER:-${script_dir}/github-app-token.sh}
  for credential in app-id private-key.pem bot-login; do
    [ -r "${implementer_root}/${credential}" ] || { log "implementer GitHub App credential is missing: ${credential}"; exit 1; }
    [ -r "${reviewer_root}/${credential}" ] || { log "reviewer GitHub App credential is missing: ${credential}"; exit 1; }
  done
  implementer_app_id=$(sed -n '1p' "${implementer_root}/app-id")
  reviewer_app_id=$(sed -n '1p' "${reviewer_root}/app-id")
  ZERP_IMPLEMENTER_BOT_LOGIN=${ZERP_IMPLEMENTER_BOT_LOGIN:-$(sed -n '1p' "${implementer_root}/bot-login")}
  ZERP_REVIEWER_BOT_LOGIN=${ZERP_REVIEWER_BOT_LOGIN:-$(sed -n '1p' "${reviewer_root}/bot-login")}
  ZERP_IMPLEMENTER_GH_TOKEN=${ZERP_IMPLEMENTER_GH_TOKEN:-$("${token_helper}" "${implementer_app_id}" "${implementer_root}/private-key.pem" "${repo_owner}" "${repo_name}")}
  ZERP_REVIEWER_GH_TOKEN=${ZERP_REVIEWER_GH_TOKEN:-$("${token_helper}" "${reviewer_app_id}" "${reviewer_root}/private-key.pem" "${repo_owner}" "${repo_name}")}
  GH_TOKEN=${ZERP_IMPLEMENTER_GH_TOKEN}
  export GH_TOKEN ZERP_IMPLEMENTER_GH_TOKEN ZERP_REVIEWER_GH_TOKEN \
    ZERP_IMPLEMENTER_BOT_LOGIN ZERP_REVIEWER_BOT_LOGIN
fi

enabled=$("${gh_bin}" api "repos/${repo}/actions/variables/ZERP_AUTOMATION_ENABLED" --jq .value 2>/dev/null || printf false)
[ "${enabled}" = true ] || { log 'automation kill switch is disabled'; exit 0; }

auth_status=$("${codex_bin}" login status 2>/dev/null || true)
[ "${auth_status}" = 'Logged in using ChatGPT' ] || {
  log 'Codex ChatGPT authentication is required'
  exit 1
}

mkdir -p "${runtime_root}"
chmod 700 "${runtime_root}"
if ! mkdir "${lock_dir}" 2>/dev/null; then
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
    log "local Codex agent already running with pid ${lock_pid}"
    exit 0
  fi
  rm -rf "${lock_dir}"
  mkdir "${lock_dir}"
fi
chmod 700 "${lock_dir}"
printf '%s\n' "$$" >"${lock_dir}/pid"
chmod 600 "${lock_dir}/pid"
cleanup() {
  if [ -n "${task_dir}" ]; then rm -rf "${task_dir}"; fi
  if [ -d "${source_root}" ] && git -C "${repository_root}" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
    git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
  fi
  rm -f "${lock_dir}/pid"
  rmdir "${lock_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else shasum -a 256 | awk '{print $1}'
  fi
}

marker_value() {
  marker=$1
  key=$2
  printf '%s\n' "${marker}" | sed -n "s/.* ${key}=\\([^ ]*\\).*/\\1/p" | tail -n 1
}

publish_review_status() {
  context=$1
  verdict=$2
  summary=$3
  case "${verdict}" in pass) state=success ;; *) state=failure ;; esac
  clean_summary=$(printf '%s' "${summary}" | tr '\r\n' '  ')
  description=$(printf 'PR #%s round %s: %s by %s' "${pr}" "${round}" "${clean_summary}" "${reviewer_actor}" | cut -c1-140)
  payload=$(jq -nc --arg state "${state}" --arg context "${context}" \
    --arg description "${description}" --arg target_url "https://github.com/${repo}/commit/${head_sha}" \
    '{state:$state,context:$context,description:$description,target_url:$target_url}')
  if [ "${ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH:-0}" = 1 ]; then
    response=$(printf '%s' "${payload}" | "${gh_bin}" api --method POST "repos/${repo}/statuses/${head_sha}" --input -)
  else
    reviewer_token=${ZERP_REVIEWER_GH_TOKEN:-${GH_TOKEN:-}}
    [ -n "${reviewer_token}" ] || { log 'reviewer GitHub App token is required'; exit 1; }
    response=$(printf '%s' "${payload}" | GH_TOKEN="${reviewer_token}" \
      "${gh_bin}" api --method POST "repos/${repo}/statuses/${head_sha}" --input -)
  fi
  creator=$(printf '%s' "${response}" | jq -r '.creator.login // ""' | tr '[:upper:]' '[:lower:]')
  expected=$(printf '%s' "${reviewer_actor}" | tr '[:upper:]' '[:lower:]')
  [ "${creator}" = "${expected}" ] || { log "${context} status was not created by the reviewer App"; exit 1; }
}

issues=$("${gh_bin}" api --paginate --slurp "repos/${repo}/issues?state=open&per_page=100" |
  jq -c 'add | [.[] | select(.pull_request | not)]')
eligible=$(printf '%s' "${issues}" | jq -c '[.[] | [.labels[].name] as $labels |
  select(($labels | index("automation:implementing")) or
         ($labels | index("automation:reviewing")) or
         ($labels | index("automation:ready")))]')
[ "$(printf '%s' "${eligible}" | jq length)" -gt 0 ] || {
  log 'no eligible local Codex work'
  exit 0
}

active=$(printf '%s' "${eligible}" | jq -c '[.[] | [.labels[].name] as $labels |
  select(($labels | index("automation:implementing")) or
         ($labels | index("automation:reviewing")))] |
  sort_by(.number) | if length == 0 then null else .[0] end')
if [ "${active}" != null ]; then
  active_state=$(printf '%s' "${active}" | jq -r '[.labels[].name | select(startswith("automation:"))] | .[0]')
  if [ "${active_state}" = automation:implementing ]; then
    issue=$(printf '%s' "${active}" | jq -r .number)
    body=$(printf '%s' "${active}" | jq -r '.body // ""')
    body_hash=$(printf '%s' "${body}" | sha256)
    prs=$("${gh_bin}" pr list --repo "${repo}" --state open --base main \
      --search "Refs #${issue} in:body" \
      --json number,body,headRefName,headRefOid,baseRefOid,isDraft,url --limit 10)
    pr_json=$(printf '%s' "${prs}" | jq -c --argjson issue "${issue}" '
      [.[] | select(.headRefName | startswith("codex/issue-")) |
        select(.body | contains("zerp-automation issue=\($issue) "))] |
      if length == 1 then .[0] else null end')
    [ "${pr_json}" != null ] || { log 'active local Codex implementation has no repairable PR'; exit 0; }

    pr=$(printf '%s' "${pr_json}" | jq -r .number)
    pr_body=$(printf '%s' "${pr_json}" | jq -r .body)
    branch=$(printf '%s' "${pr_json}" | jq -r .headRefName)
    head_sha=$(printf '%s' "${pr_json}" | jq -r .headRefOid)
    marker=$(printf '%s' "${pr_body}" | sed -n '/<!-- zerp-automation /p' | tail -n 1)
    authorization_run_id=$(marker_value "${marker}" authorization_run)
    marker_body_hash=$(marker_value "${marker}" body_sha)
    round=$(marker_value "${marker}" round)
    [ "${marker_body_hash}" = "${body_hash}" ] && [ -n "${authorization_run_id}" ] && [ -n "${round}" ] || {
      log "Issue #${issue} automation PR marker is invalid"
      exit 1
    }
    reviewer_actor=${ZERP_REVIEWER_BOT_LOGIN:-zerp-issue-reviewer[bot]}
    expected_review_marker="zerp-review head=${head_sha} round=${round}"
    comments=$("${gh_bin}" api "repos/${repo}/issues/${pr}/comments?per_page=100")
    review_comment=$(printf '%s' "${comments}" | jq -r --arg reviewer "${reviewer_actor}" \
      --arg marker "${expected_review_marker}" '
      [.[] | select((.user.login | ascii_downcase) == ($reviewer | ascii_downcase)) |
        select(.body | contains($marker))] | if length == 0 then "" else last.body end')
    repair_reason=review
    if [ -z "${review_comment}" ]; then
      release_actor=$("${gh_bin}" api "repos/${repo}/actions/variables/ZERP_RELEASE_VERIFIER_BOT_LOGIN" --jq .value 2>/dev/null || true)
      expected_repair_marker="zerp-repair head=${head_sha} round=${round}"
      review_comment=$(printf '%s' "${comments}" | jq -r --arg release "${release_actor}" \
        --arg marker "${expected_repair_marker}" '
        [.[] | select((.user.login | ascii_downcase) == ($release | ascii_downcase)) |
          select(.body | contains($marker))] | if length == 0 then "" else last.body end')
      repair_marker=$(printf '%s' "${review_comment}" | sed -n '/<!-- zerp-repair /p' | tail -n 1)
      repair_reason=$(marker_value "${repair_marker}" reason)
    fi
    case "${repair_reason}" in
      review | preview) next_round=$((round + 1)) ;;
      stale-main) next_round=${round} ;;
      *) log "Issue #${issue} has no trusted repair request for exact head ${head_sha}"; exit 1 ;;
    esac
    if [ "${round}" -ge 3 ] && [ "${repair_reason}" != stale-main ]; then
      ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
        "${automation_helper}" set-state "${issue}" automation:blocked
      log "Issue #${issue} exhausted three repair rounds"
      exit 0
    fi

    task_dir=$(mktemp -d "${runtime_root}/.task-${issue}.XXXXXX")
    chmod 700 "${task_dir}"
    "${gh_bin}" run download "${authorization_run_id}" --repo "${repo}" \
      --name "authorization-issue-${issue}" --dir "${task_dir}/authorization"
    authorization_file="${task_dir}/authorization/authorization.json"
    [ -r "${authorization_file}" ] || { log "Issue #${issue} authorization artifact is missing"; exit 1; }
    [ "$(jq -r .issue "${authorization_file}")" = "${issue}" ] || { log "Issue #${issue} authorization number mismatch"; exit 1; }
    [ "$(jq -r .body_sha256 "${authorization_file}")" = "${body_hash}" ] || { log "Issue #${issue} authorization body mismatch"; exit 1; }

    if [ ! -d "${repository_root}/.git" ] && [ ! -f "${repository_root}/HEAD" ]; then
      git clone --filter=blob:none "https://github.com/${repo}.git" "${repository_root}"
    fi
    git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
    git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
    if [ "${ZERP_ISSUE_CODEX_SKIP_FETCH:-0}" != 1 ]; then
      git -C "${repository_root}" fetch origin "${branch}:refs/remotes/origin/${branch}" main --prune
    fi
    git -C "${repository_root}" cat-file -e "${head_sha}^{commit}"
    git -C "${repository_root}" worktree add --detach "${source_root}" "${head_sha}"
    cp "${authorization_file}" "${source_root}/authorization.json"
    if [ "${repair_reason}" = review ]; then
      mkdir -p "${source_root}/review-evidence"
      printf '%s\n' "${review_comment}" >"${source_root}/review-evidence/review.md"
    else
      printf 'Trusted release-controller repair request for exact head %s: %s.\n' \
        "${head_sha}" "${repair_reason}" >"${source_root}/automation-failure.log"
      if [ "${repair_reason}" = stale-main ]; then
        printf 'Rebase the candidate onto the already fetched origin/main and resolve conflicts within the authorized scope.\n' \
          >>"${source_root}/automation-failure.log"
      fi
    fi
    repair_prompt="${task_dir}/repair.md"
    {
      printf 'Repair round: %s\nExact head SHA: %s\n\n' "${next_round}" "${head_sha}"
      cat "${source_root}/.github/automation/prompts/repair.md"
    } >"${repair_prompt}"
    output_file="${task_dir}/repair-output.json"
    "${codex_bin}" exec --ignore-user-config --ephemeral --sandbox workspace-write --approve-for-me \
      -C "${source_root}" --output-schema "${source_root}/.github/automation/schemas/implementation-output.json" \
      -o "${output_file}" - <"${repair_prompt}"
    jq -e . "${output_file}" >/dev/null
    result=$(jq -r .status "${output_file}")
    summary=$(jq -r .summary "${output_file}")
    case "${result}" in
      needs_input)
        ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
          "${automation_helper}" set-state "${issue}" automation:needs-input
        "${gh_bin}" issue comment "${issue}" --repo "${repo}" --body "自动修复需要输入：${summary}"
        ;;
      blocked)
        ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
          "${automation_helper}" set-state "${issue}" automation:blocked
        "${gh_bin}" issue comment "${issue}" --repo "${repo}" --body "自动修复已阻塞：${summary}"
        ;;
      implemented)
        rm -f "${source_root}/authorization.json" "${source_root}/automation-failure.log"
        rm -rf "${source_root}/review-evidence"
        candidate_head=$(git -C "${source_root}" rev-parse HEAD)
        if [ "${repair_reason}" = stale-main ] && \
          ! git -C "${source_root}" merge-base --is-ancestor origin/main "${candidate_head}"; then
          log "Issue #${issue} repair did not replay the candidate onto latest main"
          exit 1
        fi
        if [ "${candidate_head}" = "${head_sha}" ] && \
          git -C "${source_root}" diff --quiet && git -C "${source_root}" diff --cached --quiet; then
          log "Issue #${issue} repair produced no changes"
          exit 1
        fi
        gate_log="${task_dir}/gate.log"
        while ! run_gate "${source_root}" "${gate_log}"; do
          if [ "${next_round}" -ge 3 ]; then
            ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
              "${automation_helper}" set-state "${issue}" automation:blocked
            "${gh_bin}" issue comment "${issue}" --repo "${repo}" \
              --body "自动修复在第 3 轮仍未通过本地门禁，已阻塞。"
            log "Issue #${issue} exhausted three gate repair rounds"
            exit 0
          fi
          next_round=$((next_round + 1))
          cp "${authorization_file}" "${source_root}/authorization.json"
          cp "${gate_log}" "${source_root}/automation-failure.log"
          {
            printf 'Repair round: %s\nExact prior head SHA: %s\n\n' "${next_round}" "${head_sha}"
            cat "${source_root}/.github/automation/prompts/repair.md"
          } >"${repair_prompt}"
          "${codex_bin}" exec --ignore-user-config --ephemeral --sandbox workspace-write --approve-for-me \
            -C "${source_root}" --output-schema "${source_root}/.github/automation/schemas/implementation-output.json" \
            -o "${output_file}" - <"${repair_prompt}"
          result=$(jq -r .status "${output_file}")
          rm -f "${source_root}/authorization.json" "${source_root}/automation-failure.log"
          case "${result}" in
            implemented) ;;
            needs_input)
              ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
                "${automation_helper}" set-state "${issue}" automation:needs-input
              exit 0
              ;;
            *)
              ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
                "${automation_helper}" set-state "${issue}" automation:blocked
              exit 0
              ;;
          esac
        done
        implementer_actor=${ZERP_IMPLEMENTER_BOT_LOGIN:-zerp-issue-implementer[bot]}
        git -C "${source_root}" switch -C "${branch}" "${candidate_head}"
        git -C "${source_root}" config user.name "${implementer_actor}"
        git -C "${source_root}" config user.email "${implementer_actor}@users.noreply.github.com"
        git -C "${source_root}" add -A
        git -C "${source_root}" commit --amend -m "automation(issue #${issue}): implementation round ${next_round}"
        if [ "${ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH:-0}" = 1 ]; then
          git -C "${source_root}" push --force-with-lease="refs/heads/${branch}:${head_sha}" origin "HEAD:refs/heads/${branch}"
        else
          implementer_token=${ZERP_IMPLEMENTER_GH_TOKEN:-${GH_TOKEN:-}}
          [ -n "${implementer_token}" ] || { log 'implementer GitHub App token is required'; exit 1; }
          askpass="${task_dir}/git-askpass.sh"
          cat >"${askpass}" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) printf '%s\n' "${ZERP_PUSH_TOKEN}" ;;
  *) exit 1 ;;
esac
ASKPASS
          chmod 700 "${askpass}"
          GIT_ASKPASS="${askpass}" GIT_TERMINAL_PROMPT=0 ZERP_PUSH_TOKEN="${implementer_token}" \
            git -C "${source_root}" push --force-with-lease="refs/heads/${branch}:${head_sha}" \
            "https://github.com/${repo}.git" "HEAD:refs/heads/${branch}"
        fi
        new_pr_body=$(printf '%s' "${pr_body}" | sed "s/ round=${round} -->/ round=${next_round} -->/")
        "${gh_bin}" pr edit "${pr}" --repo "${repo}" --body "${new_pr_body}"
        ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
          "${automation_helper}" set-state "${issue}" automation:reviewing
        log "Issue #${issue} repair round ${next_round} published to PR #${pr}"
        ;;
      *) log "Issue #${issue} returned an invalid Codex repair status"; exit 1 ;;
    esac
    exit 0
  fi
  [ "${active_state}" = automation:reviewing ] || { log 'active local Codex work is pending'; exit 0; }

  issue=$(printf '%s' "${active}" | jq -r .number)
  body=$(printf '%s' "${active}" | jq -r '.body // ""')
  body_hash=$(printf '%s' "${body}" | sha256)
  prs=$("${gh_bin}" pr list --repo "${repo}" --state open --base main \
    --search "Refs #${issue} in:body" \
    --json number,body,headRefName,headRefOid,baseRefOid,isDraft,url --limit 10)
  pr_json=$(printf '%s' "${prs}" | jq -c --argjson issue "${issue}" '
    [.[] | select(.headRefName | startswith("codex/issue-")) |
      select(.body | contains("zerp-automation issue=\($issue) "))] |
    if length == 1 then .[0] else null end')
  [ "${pr_json}" != null ] || { log "Issue #${issue} must have exactly one automation PR"; exit 1; }

  pr=$(printf '%s' "${pr_json}" | jq -r .number)
  branch=$(printf '%s' "${pr_json}" | jq -r .headRefName)
  head_sha=$(printf '%s' "${pr_json}" | jq -r .headRefOid)
  base_sha=$(printf '%s' "${pr_json}" | jq -r .baseRefOid)
  marker=$(printf '%s' "${pr_json}" | jq -r .body | sed -n '/<!-- zerp-automation /p' | tail -n 1)
  authorization_run_id=$(marker_value "${marker}" authorization_run)
  authorization_deployment=$(marker_value "${marker}" deployment)
  marker_body_hash=$(marker_value "${marker}" body_sha)
  round=$(marker_value "${marker}" round)
  [ -n "${authorization_run_id}" ] && [ -n "${authorization_deployment}" ] && \
    [ "${marker_body_hash}" = "${body_hash}" ] && [ -n "${round}" ] || {
      log "Issue #${issue} automation PR marker is invalid"
      exit 1
    }

  task_dir=$(mktemp -d "${runtime_root}/.task-${issue}.XXXXXX")
  chmod 700 "${task_dir}"
  "${gh_bin}" run download "${authorization_run_id}" --repo "${repo}" \
    --name "authorization-issue-${issue}" --dir "${task_dir}/authorization"
  authorization_file="${task_dir}/authorization/authorization.json"
  [ -r "${authorization_file}" ] || { log "Issue #${issue} authorization artifact is missing"; exit 1; }
  [ "$(jq -r .issue "${authorization_file}")" = "${issue}" ] || { log "Issue #${issue} authorization number mismatch"; exit 1; }
  [ "$(jq -r .body_sha256 "${authorization_file}")" = "${body_hash}" ] || { log "Issue #${issue} authorization body mismatch"; exit 1; }

  if [ ! -d "${repository_root}/.git" ] && [ ! -f "${repository_root}/HEAD" ]; then
    git clone --filter=blob:none "https://github.com/${repo}.git" "${repository_root}"
  fi
  git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
  git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
  if [ "${ZERP_ISSUE_CODEX_SKIP_FETCH:-0}" != 1 ]; then
    git -C "${repository_root}" fetch origin "${branch}:refs/remotes/origin/${branch}" main --prune
  fi
  git -C "${repository_root}" cat-file -e "${head_sha}^{commit}"
  git -C "${repository_root}" cat-file -e "${base_sha}^{commit}"
  git -C "${repository_root}" worktree add --detach "${source_root}" "${head_sha}"
  cp "${authorization_file}" "${source_root}/authorization.json"

  standards_prompt="${task_dir}/review-standards.md"
  spec_prompt="${task_dir}/review-spec.md"
  {
    printf 'Base SHA: %s\nHead SHA: %s\n\n' "${base_sha}" "${head_sha}"
    cat "${source_root}/.github/automation/prompts/review-standards.md"
  } >"${standards_prompt}"
  {
    printf 'Base SHA: %s\nHead SHA: %s\nAuthorization snapshot: authorization.json\n\n' "${base_sha}" "${head_sha}"
    cat "${source_root}/.github/automation/prompts/review-spec.md"
  } >"${spec_prompt}"
  standards_output="${task_dir}/standards-output.json"
  spec_output="${task_dir}/spec-output.json"
  "${codex_bin}" exec --ignore-user-config --ephemeral --sandbox read-only \
    -C "${source_root}" --output-schema "${source_root}/.github/automation/schemas/review-output.json" \
    -o "${standards_output}" - <"${standards_prompt}"
  "${codex_bin}" exec --ignore-user-config --ephemeral --sandbox read-only \
    -C "${source_root}" --output-schema "${source_root}/.github/automation/schemas/review-output.json" \
    -o "${spec_output}" - <"${spec_prompt}"
  jq -e '.verdict == "pass" or .verdict == "fail"' "${standards_output}" >/dev/null
  jq -e '.verdict == "pass" or .verdict == "fail"' "${spec_output}" >/dev/null

  reviewer_actor=${ZERP_REVIEWER_BOT_LOGIN:-zerp-issue-reviewer[bot]}
  standards_verdict=$(jq -r .verdict "${standards_output}")
  spec_verdict=$(jq -r .verdict "${spec_output}")
  [ "$(jq '.findings | length' "${standards_output}")" -eq 0 ] || standards_verdict=fail
  [ "$(jq '.findings | length' "${spec_output}")" -eq 0 ] || spec_verdict=fail
  publish_review_status automation-standards-review "${standards_verdict}" "$(jq -r .summary "${standards_output}")"
  publish_review_status automation-spec-review "${spec_verdict}" "$(jq -r .summary "${spec_output}")"
  if [ "${standards_verdict}" = pass ] && [ "${spec_verdict}" = pass ] && \
    [ "$(jq '.findings | length' "${standards_output}")" -eq 0 ] && \
    [ "$(jq '.findings | length' "${spec_output}")" -eq 0 ]; then
    ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
      "${automation_helper}" set-state "${issue}" automation:release
    "${gh_bin}" pr ready "${pr}" --repo "${repo}"
    log "Issue #${issue} PR #${pr} passed both local Codex reviews"
    exit 0
  fi
  review_body=$(jq -nc --arg head "${head_sha}" --argjson round "${round}" \
    --slurpfile standards "${standards_output}" --slurpfile spec "${spec_output}" \
    '{head:$head,round:$round,standards:$standards[0],spec:$spec[0]}')
  # shellcheck disable=SC2016 # backticks are literal Markdown delimiters
  review_comment=$(printf 'Local Codex review failed for `%s` in round %s.\n\n```json\n%s\n```\n\n<!-- zerp-review head=%s round=%s -->' \
    "${head_sha}" "${round}" "${review_body}" "${head_sha}" "${round}")
  if [ "${ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH:-0}" = 1 ]; then
    "${gh_bin}" pr comment "${pr}" --repo "${repo}" --body "${review_comment}"
  else
    GH_TOKEN="${reviewer_token}" "${gh_bin}" pr comment "${pr}" --repo "${repo}" --body "${review_comment}"
  fi
  if [ "${round}" -ge 3 ]; then
    ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
      "${automation_helper}" set-state "${issue}" automation:blocked
    log "Issue #${issue} is blocked after three failed review rounds"
  else
    ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
      "${automation_helper}" set-state "${issue}" automation:implementing
    log "Issue #${issue} returned to implementation after failed review round ${round}"
  fi
  exit 0
fi

candidate_file="${runtime_root}/ready-candidates.$$"
: >"${candidate_file}"
printf '%s' "${eligible}" | jq -c '.[] | select([.labels[].name] | index("automation:ready"))' |
while IFS= read -r issue_json; do
  issue=$(printf '%s' "${issue_json}" | jq -r .number)
  body=$(printf '%s' "${issue_json}" | jq -r '.body // ""')
  body_hash=$(printf '%s' "${body}" | sha256)
  blockers=$("${gh_bin}" api --paginate "repos/${repo}/issues/${issue}/dependencies/blocked_by" 2>/dev/null || printf '[]')
  [ "$(printf '%s' "${blockers}" | jq '[.[] | select(.state != "closed")] | length')" -eq 0 ] || continue
  deployments=$("${gh_bin}" api "repos/${repo}/deployments?environment=issue-authorization-${issue}&per_page=100")
  authorization=$(printf '%s' "${deployments}" | jq -c --arg hash "${body_hash}" '
    [.[] | select(.task == "authorize" and .payload.body_sha256 == $hash)] |
    sort_by(.created_at) | if length == 0 then null else last end')
  [ "${authorization}" != null ] || continue
  deployment_id=$(printf '%s' "${authorization}" | jq -r .id)
  deployment_status=$("${gh_bin}" api "repos/${repo}/deployments/${deployment_id}/statuses?per_page=100" |
    jq -r 'sort_by(.created_at) | if length == 0 then "missing" else last.state end')
  [ "${deployment_status}" = success ] || continue
  priority=$(printf '%s' "${issue_json}" | jq -r '[.labels[].name | select(test("^priority:p[0-3]$"))] |
    if length == 1 then .[0] else "priority:p2" end | sub("priority:p"; "") | tonumber')
  authorized_at=$(printf '%s' "${authorization}" | jq -r .created_at)
  run_id=$(printf '%s' "${authorization}" | jq -r .payload.run_id)
  jq -nc --argjson issue "${issue}" --argjson deployment_id "${deployment_id}" \
    --argjson priority "${priority}" --arg authorized_at "${authorized_at}" \
    --arg body_sha256 "${body_hash}" --arg authorization_run_id "${run_id}" \
    '{issue:$issue,deployment_id:$deployment_id,priority:$priority,authorized_at:$authorized_at,body_sha256:$body_sha256,authorization_run_id:$authorization_run_id,round:1}' \
    >>"${candidate_file}"
done
candidate=$(jq -sc 'sort_by(.priority,.authorized_at,.issue) | if length == 0 then null else .[0] end' "${candidate_file}")
rm -f "${candidate_file}"
[ "${candidate}" != null ] || { log 'no authorized local Codex work'; exit 0; }

issue=$(printf '%s' "${candidate}" | jq -r .issue)
body_hash=$(printf '%s' "${candidate}" | jq -r .body_sha256)
authorization_run_id=$(printf '%s' "${candidate}" | jq -r .authorization_run_id)
authorization_deployment=$(printf '%s' "${candidate}" | jq -r .deployment_id)
round=$(printf '%s' "${candidate}" | jq -r .round)

ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
  "${automation_helper}" set-state "${issue}" automation:implementing

task_dir=$(mktemp -d "${runtime_root}/.task-${issue}.XXXXXX")
chmod 700 "${task_dir}"
"${gh_bin}" run download "${authorization_run_id}" --repo "${repo}" \
  --name "authorization-issue-${issue}" --dir "${task_dir}/authorization"
authorization_file="${task_dir}/authorization/authorization.json"
[ -r "${authorization_file}" ] || { log "Issue #${issue} authorization artifact is missing"; exit 1; }
[ "$(jq -r .issue "${authorization_file}")" = "${issue}" ] || { log "Issue #${issue} authorization number mismatch"; exit 1; }
[ "$(jq -r .body_sha256 "${authorization_file}")" = "${body_hash}" ] || { log "Issue #${issue} authorization body mismatch"; exit 1; }

if [ ! -d "${repository_root}/.git" ] && [ ! -f "${repository_root}/HEAD" ]; then
  git clone --filter=blob:none "https://github.com/${repo}.git" "${repository_root}"
fi
git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
if [ "${ZERP_ISSUE_CODEX_SKIP_FETCH:-0}" = 1 ]; then
  base_sha=$(git -C "${repository_root}" rev-parse HEAD)
else
  git -C "${repository_root}" fetch origin main --prune
  base_sha=$(git -C "${repository_root}" rev-parse origin/main)
fi
git -C "${repository_root}" worktree add --detach "${source_root}" "${base_sha}"

cp "${authorization_file}" "${source_root}/authorization.json"
cp "${source_root}/.github/automation/prompts/implement.md" "${task_dir}/prompt.md"
{
  printf '\nImmutable authorization snapshot:\n```json\n'
  jq . "${authorization_file}"
  printf '```\n'
} >>"${task_dir}/prompt.md"
output_file="${task_dir}/implementation-output.json"
"${codex_bin}" exec --ignore-user-config --ephemeral --sandbox workspace-write --approve-for-me \
  -C "${source_root}" --output-schema "${source_root}/.github/automation/schemas/implementation-output.json" \
  -o "${output_file}" - <"${task_dir}/prompt.md"
jq -e . "${output_file}" >/dev/null
result=$(jq -r .status "${output_file}")
summary=$(jq -r .summary "${output_file}")

case "${result}" in
  needs_input)
    ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
      "${automation_helper}" set-state "${issue}" automation:needs-input
    "${gh_bin}" issue comment "${issue}" --repo "${repo}" \
      --body "自动实现需要输入：${summary}。请修正 Issue 后重新添加 \`automation:ready\`。"
    log "Issue #${issue} requires maintainer input"
    ;;
  blocked)
    ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
      "${automation_helper}" set-state "${issue}" automation:blocked
    "${gh_bin}" issue comment "${issue}" --repo "${repo}" --body "自动实现已阻塞：${summary}"
    log "Issue #${issue} implementation is blocked"
    ;;
  implemented)
    rm -f "${source_root}/authorization.json"
    if git -C "${source_root}" diff --quiet && git -C "${source_root}" diff --cached --quiet; then
      log "Issue #${issue} produced no implementation changes"
      exit 1
    fi
    gate_log="${task_dir}/gate.log"
    while ! run_gate "${source_root}" "${gate_log}"; do
      if [ "${round}" -ge 3 ]; then
        ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
          "${automation_helper}" set-state "${issue}" automation:blocked
        "${gh_bin}" issue comment "${issue}" --repo "${repo}" \
          --body "自动实现在第 3 轮仍未通过本地门禁，已阻塞。"
        log "Issue #${issue} exhausted three gate repair rounds"
        exit 0
      fi
      round=$((round + 1))
      cp "${authorization_file}" "${source_root}/authorization.json"
      cp "${gate_log}" "${source_root}/automation-failure.log"
      repair_prompt="${task_dir}/gate-repair-${round}.md"
      {
        printf 'Repair round: %s\nBase SHA: %s\n\n' "${round}" "${base_sha}"
        cat "${source_root}/.github/automation/prompts/repair.md"
      } >"${repair_prompt}"
      "${codex_bin}" exec --ignore-user-config --ephemeral --sandbox workspace-write --approve-for-me \
        -C "${source_root}" --output-schema "${source_root}/.github/automation/schemas/implementation-output.json" \
        -o "${output_file}" - <"${repair_prompt}"
      result=$(jq -r .status "${output_file}")
      summary=$(jq -r .summary "${output_file}")
      rm -f "${source_root}/authorization.json" "${source_root}/automation-failure.log"
      case "${result}" in
        implemented) ;;
        needs_input)
          ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
            "${automation_helper}" set-state "${issue}" automation:needs-input
          "${gh_bin}" issue comment "${issue}" --repo "${repo}" --body "自动门禁修复需要输入：${summary}"
          exit 0
          ;;
        *)
          ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
            "${automation_helper}" set-state "${issue}" automation:blocked
          "${gh_bin}" issue comment "${issue}" --repo "${repo}" --body "自动门禁修复已阻塞：${summary}"
          exit 0
          ;;
      esac
    done
    branch="codex/issue-${issue}-$(printf '%s' "${body_hash}" | cut -c1-8)"
    git -C "${source_root}" switch -c "${branch}"
    implementer_actor=${ZERP_IMPLEMENTER_BOT_LOGIN:-zerp-issue-implementer[bot]}
    git -C "${source_root}" config user.name "${implementer_actor}"
    git -C "${source_root}" config user.email "${implementer_actor}@users.noreply.github.com"
    git -C "${source_root}" add -A
    git -C "${source_root}" commit -m "automation(issue #${issue}): implementation round ${round}"
    if [ "${ZERP_ISSUE_CODEX_SKIP_REMOTE_AUTH:-0}" = 1 ]; then
      git -C "${source_root}" push origin "HEAD:refs/heads/${branch}"
    else
      implementer_token=${ZERP_IMPLEMENTER_GH_TOKEN:-${GH_TOKEN:-}}
      [ -n "${implementer_token}" ] || { log 'implementer GitHub App token is required'; exit 1; }
      askpass="${task_dir}/git-askpass.sh"
      cat >"${askpass}" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) printf '%s\n' "${ZERP_PUSH_TOKEN}" ;;
  *) exit 1 ;;
esac
ASKPASS
      chmod 700 "${askpass}"
      GIT_ASKPASS="${askpass}" GIT_TERMINAL_PROMPT=0 ZERP_PUSH_TOKEN="${implementer_token}" \
        git -C "${source_root}" push "https://github.com/${repo}.git" "HEAD:refs/heads/${branch}"
    fi
    issue_title=$(jq -r .title "${authorization_file}")
    # shellcheck disable=SC2016 # backticks are literal Markdown delimiters
    pr_body=$(printf 'Refs #%s\n\nAuthorization: run %s, deployment %s, body `%s`.\n\n<!-- zerp-automation issue=%s authorization_run=%s deployment=%s body_sha=%s round=%s -->\n' \
      "${issue}" "${authorization_run_id}" "${authorization_deployment}" "${body_hash}" \
      "${issue}" "${authorization_run_id}" "${authorization_deployment}" "${body_hash}" "${round}")
    "${gh_bin}" pr create --repo "${repo}" --draft --base main --head "${branch}" \
      --title "automation: ${issue_title}" --body "${pr_body}" >/dev/null
    pr=$("${gh_bin}" pr view "${branch}" --repo "${repo}" --json number --jq .number)
    ZERP_GH_BIN="${gh_bin}" GITHUB_REPOSITORY="${repo}" \
      "${automation_helper}" set-state "${issue}" automation:reviewing
    log "Issue #${issue} published as Draft PR #${pr}"
    ;;
  *) log "Issue #${issue} returned an invalid Codex status"; exit 1 ;;
esac
