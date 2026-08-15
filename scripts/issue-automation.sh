#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
gh_bin=${ZERP_GH_BIN:-gh}
repo=${GITHUB_REPOSITORY:-${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}}

usage() {
  echo "usage: $0 {snapshot <event-json> <output-json>|set-state <issue> <state>|state <issue>}" >&2
  exit 2
}

require_tools() {
  command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
  command -v "${gh_bin}" >/dev/null 2>&1 || { echo "gh is required" >&2; exit 1; }
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

section() {
  heading=$1
  body=$2
  printf '%s\n' "${body}" | awk -v wanted="${heading}" '
    $0 == "### " wanted { capture=1; next }
    capture && /^### / { exit }
    capture { print }
  ' | sed '/^[[:space:]]*$/d'
}

present() {
  value=$(printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -n "${value}" ] && [ "${value}" != "_No response_" ]
}

needs_input() {
  echo "$*" >&2
  exit 3
}

validate_full_sha() {
  value=$1
  case "${value}" in *[!0-9a-f]*) return 1 ;; esac
  [ "${#value}" -eq 40 ]
}

snapshot() {
  event_file=$1
  output_file=$2

  [ "${ZERP_AUTOMATION_ENABLED:-false}" = true ] || {
    echo "repository automation kill switch is disabled" >&2
    exit 5
  }

  jq -e '
    .action == "labeled" and
    .label.name == "automation:ready" and
    .issue.state == "open" and
    (.issue.pull_request | not) and
    .sender.type == "User"
  ' "${event_file}" >/dev/null || needs_input "event is not an open Issue authorization"

  issue=$(jq -r '.issue.number' "${event_file}")
  title=$(jq -r '.issue.title' "${event_file}")
  body=$(jq -r '.issue.body // ""' "${event_file}")
  actor=$(jq -r '.sender.login' "${event_file}")
  labels=$(jq -c '[.issue.labels[].name]' "${event_file}")
  state_count=$(printf '%s' "${labels}" | jq '[.[] | select(startswith("automation:"))] | length')
  if [ "${state_count}" -ne 1 ] ||
    ! printf '%s' "${labels}" | jq -e 'index("automation:ready") != null' >/dev/null; then
    needs_input "Issue must have exactly one automation state: automation:ready"
  fi

  actor_key=$(printf '%s' "${actor}" | tr '[:upper:]' '[:lower:]')
  case "${actor_key}" in *'[bot]' | *-bot | bot) needs_input "Bot actors cannot authorize Issues" ;; esac
  owner_key=$(printf '%s' "${repo%%/*}" | tr '[:upper:]' '[:lower:]')
  authorizers=$(printf '%s,%s' "${owner_key}" "${ZERP_AUTOMATION_AUTHORIZERS:-}" |
    tr -d '[:space:]' |
    tr '[:upper:]' '[:lower:]' |
    tr ',' '\n')
  printf '%s\n' "${authorizers}" | grep -Fxq "${actor_key}" || needs_input "authorizing actor is not in ZERP_AUTOMATION_AUTHORIZERS"
  permission=authorized

  outcome=$(section Outcome "${body}")
  scope=$(section Scope "${body}")
  exclusions=$(section Exclusions "${body}")
  acceptance=$(section "Acceptance criteria" "${body}")
  risk=$(section "Risk level" "${body}")
  risks=$(section Risks "${body}")
  recovery=$(section "Recovery conditions" "${body}")
  references=$(section "Linked specifications" "${body}")
  present "${outcome}" || needs_input "Outcome is required"
  present "${scope}" || needs_input "Scope is required"
  present "${exclusions}" || needs_input "Exclusions are required"
  present "${acceptance}" || needs_input "Objective acceptance criteria are required"
  present "${risk}" || needs_input "Risk level is required"
  present "${references}" || needs_input "Linked specifications are required"
  case "${risk}" in
    High*)
      present "${risks}" || needs_input "High-risk work requires explicit risks"
      present "${recovery}" || needs_input "High-risk work requires recovery conditions"
      ;;
  esac

  blockers=$("${gh_bin}" api --paginate "repos/${repo}/issues/${issue}/dependencies/blocked_by" 2>/dev/null || printf '[]')
  printf '%s' "${blockers}" | jq -e 'type == "array"' >/dev/null || {
    echo "native dependency evidence is unavailable" >&2
    exit 4
  }
  open_blockers=$(printf '%s' "${blockers}" | jq '[.[] | select(.state != "closed")] | length')

  priority=$(printf '%s' "${labels}" | jq -r '[.[] | select(test("^priority:p[0-3]$"))] | if length == 0 then "priority:p2" elif length == 1 then .[0] else "invalid" end')
  [ "${priority}" != invalid ] || needs_input "Issue must have at most one priority:p0 through priority:p3 label"

  main_sha=${ZERP_AUTOMATION_MAIN_SHA:-$(git -C "${repo_root}" rev-parse HEAD)}
  validate_full_sha "${main_sha}" || { echo "automation main SHA is invalid" >&2; exit 1; }
  body_hash=$(printf '%s' "${body}" | sha256)
  authorized_at=${ZERP_AUTHORIZED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}

  linked_specs='[]'
  if [ "${references}" != "无" ]; then
    # shellcheck disable=SC2016 # backticks are literal Issue-markdown delimiters
    paths=$(printf '%s\n' "${references}" | sed -n 's/.*`\([^`]*\)`.*/\1/p')
    for path in ${paths}; do
      case "${path}" in docs/* | contracts/openapi/*) ;; *) needs_input "Linked specification is outside docs/ or contracts/openapi/: ${path}" ;; esac
      tracked=$(git -C "${repo_root}" ls-files --error-unmatch -- "${path}" 2>/dev/null || true)
      [ "${tracked}" = "${path}" ] || needs_input "Linked specification is not tracked: ${path}"
      digest=$(sha256 <"${repo_root}/${path}")
      linked_specs=$(printf '%s' "${linked_specs}" | jq -c --arg path "${path}" --arg sha256 "${digest}" '. + [{path:$path,sha256:$sha256}]')
    done
  fi

  jq -n \
    --argjson issue "${issue}" --arg title "${title}" --arg body "${body}" \
    --arg body_hash "${body_hash}" --arg actor "${actor}" --arg permission "${permission}" \
    --arg authorized_at "${authorized_at}" --arg priority "${priority}" \
    --arg main_sha "${main_sha}" --arg repository "${repo}" \
    --arg run_id "${GITHUB_RUN_ID:-local}" --arg run_attempt "${GITHUB_RUN_ATTEMPT:-1}" \
    --argjson labels "${labels}" --argjson linked_specs "${linked_specs}" \
    --argjson open_dependencies "${open_blockers}" '
      {
        schema:1, repository:$repository, issue:$issue, title:$title, body:$body,
        body_sha256:$body_hash, authorization:{actor:$actor,permission:$permission,authorized_at:$authorized_at},
        priority:$priority, labels:$labels, main_sha:$main_sha,
        workflow:{run_id:$run_id,run_attempt:$run_attempt}, linked_specs:$linked_specs,
        open_dependencies:$open_dependencies
      }
    ' >"${output_file}"
}

allowed_state() {
  case "$1" in
    automation:ready | automation:implementing | automation:reviewing | automation:release | \
      automation:needs-input | automation:blocked | automation:cancelled | automation:incident | automation:done) return 0 ;;
    *) return 1 ;;
  esac
}

set_state() {
  issue=$1
  target=$2
  allowed_state "${target}" || { echo "invalid automation state: ${target}" >&2; exit 2; }
  issue_json=$("${gh_bin}" api "repos/${repo}/issues/${issue}")
  labels=$(printf '%s' "${issue_json}" | jq -c --arg target "${target}" '[.labels[].name | select(startswith("automation:") | not)] + [$target] | unique')
  jq -n --argjson labels "${labels}" '{labels:$labels}' |
    "${gh_bin}" api --method PATCH "repos/${repo}/issues/${issue}" --input - >/dev/null
}

current_state() {
  issue=$1
  "${gh_bin}" api "repos/${repo}/issues/${issue}" --jq '[.labels[].name | select(startswith("automation:"))] | if length == 1 then .[0] else "invalid" end'
}

require_tools
case "${1:-}" in
  snapshot) [ "$#" -eq 3 ] || usage; snapshot "$2" "$3" ;;
  set-state) [ "$#" -eq 3 ] || usage; set_state "$2" "$3" ;;
  state) [ "$#" -eq 2 ] || usage; current_state "$2" ;;
  *) usage ;;
esac
