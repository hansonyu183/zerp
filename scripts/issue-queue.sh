#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
gh_bin=${ZERP_GH_BIN:-gh}
repo=${GITHUB_REPOSITORY:-${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}}
capacity=${ZERP_IMPLEMENTATION_CAPACITY:-2}

[ "${ZERP_AUTOMATION_ENABLED:-false}" = true ] || {
  echo "automation kill switch is disabled"
  exit 0
}
case "${capacity}" in '' | *[!0-9]*) echo "invalid implementation capacity" >&2; exit 2 ;; esac

issues=$("${gh_bin}" api --paginate --slurp "repos/${repo}/issues?state=open&per_page=100" |
  jq -c 'add | [.[] | select(.pull_request | not)]')
active=$(printf '%s' "${issues}" | jq '[.[] | [.labels[].name] as $labels | select(($labels | index("automation:implementing")) or ($labels | index("automation:reviewing")))] | length')
available=$((capacity - active))
[ "${available}" -gt 0 ] || { echo "implementation capacity is full (${active}/${capacity})"; exit 0; }

candidates='[]'
printf '%s' "${issues}" | jq -c '.[] | select([.labels[].name] | index("automation:ready"))' |
while IFS= read -r issue_json; do
  issue=$(printf '%s' "${issue_json}" | jq -r .number)
  body=$(printf '%s' "${issue_json}" | jq -r '.body // ""')
  if command -v sha256sum >/dev/null 2>&1; then
    body_hash=$(printf '%s' "${body}" | sha256sum | awk '{print $1}')
  else
    body_hash=$(printf '%s' "${body}" | shasum -a 256 | awk '{print $1}')
  fi
  blockers=$("${gh_bin}" api --paginate "repos/${repo}/issues/${issue}/dependencies/blocked_by" 2>/dev/null || printf '[]')
  [ "$(printf '%s' "${blockers}" | jq '[.[] | select(.state != "closed")] | length')" -eq 0 ] || continue

  deployments=$("${gh_bin}" api "repos/${repo}/deployments?environment=issue-authorization-${issue}&per_page=100")
  authorization=$(printf '%s' "${deployments}" | jq -c --arg hash "${body_hash}" '
    [.[] | select(.task == "authorize" and .payload.body_sha256 == $hash)] |
    sort_by(.created_at) | if length == 0 then null else last end
  ')
  [ "${authorization}" != null ] || continue
  deployment_id=$(printf '%s' "${authorization}" | jq -r .id)
  authorization_run_id=$(printf '%s' "${authorization}" | jq -r '.payload.run_id')
  status=$("${gh_bin}" api "repos/${repo}/deployments/${deployment_id}/statuses?per_page=100" |
    jq -r 'sort_by(.created_at) | if length == 0 then "missing" else last.state end')
  [ "${status}" = success ] || continue

  priority=$(printf '%s' "${issue_json}" | jq -r '[.labels[].name | select(test("^priority:p[0-3]$"))] | if length == 1 then .[0] else "priority:p2" end | sub("priority:p"; "") | tonumber')
  authorized_at=$(printf '%s' "${authorization}" | jq -r .created_at)
  candidate=$(jq -n --argjson issue "${issue}" --argjson deployment_id "${deployment_id}" --argjson priority "${priority}" --arg authorized_at "${authorized_at}" --arg body_sha256 "${body_hash}" --arg authorization_run_id "${authorization_run_id}" '{issue:$issue,deployment_id:$deployment_id,priority:$priority,authorized_at:$authorized_at,body_sha256:$body_sha256,authorization_run_id:$authorization_run_id,round:1}')
  candidates=$(printf '%s' "${candidates}" | jq -c --argjson candidate "${candidate}" '. + [$candidate]')
  printf '%s\n' "${candidates}" >"${RUNNER_TEMP:-${TMPDIR:-/tmp}}/zerp-issue-candidates.$$"
done

candidate_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/zerp-issue-candidates.$$"
if [ -f "${candidate_file}" ]; then
  candidates=$(cat "${candidate_file}")
  rm -f "${candidate_file}"
fi
selected=$(printf '%s' "${candidates}" | jq -c --argjson available "${available}" 'sort_by(.priority,.authorized_at,.issue) | .[:$available]')

printf '%s' "${selected}" | jq -c '.[]' | while IFS= read -r candidate; do
  issue=$(printf '%s' "${candidate}" | jq -r .issue)
  "${repo_root}/scripts/issue-automation.sh" set-state "${issue}" automation:implementing
  payload=$(jq -n --arg event_type issue-implement --argjson client_payload "${candidate}" '{event_type:$event_type,client_payload:$client_payload}')
  if ! printf '%s' "${payload}" | "${gh_bin}" api --method POST "repos/${repo}/dispatches" --input - >/dev/null; then
    "${repo_root}/scripts/issue-automation.sh" set-state "${issue}" automation:ready
    echo "failed to dispatch Issue #${issue}" >&2
    exit 1
  fi
  echo "dispatched Issue #${issue}"
done
