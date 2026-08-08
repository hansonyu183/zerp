#!/bin/sh
set -eu

repository=${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY}
merge_sha=${GITHUB_SHA:?set GITHUB_SHA}
required_checks=${ZERP_REQUIRED_PR_CHECKS:-"full-validation"}

command -v gh >/dev/null 2>&1 || {
  echo "gh is required to verify merged PR evidence" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required to verify merged PR evidence" >&2
  exit 1
}

pulls=$(gh api -H "Accept: application/vnd.github+json" "repos/${repository}/commits/${merge_sha}/pulls?per_page=20")
pull_number=$(printf '%s' "${pulls}" | jq -r --arg merge_sha "${merge_sha}" '[.[] | select(.base.ref == "main" and .merged_at != null and .merge_commit_sha == $merge_sha)] | sort_by(.merged_at) | if length == 0 then "" else last.number end')
head_sha=$(printf '%s' "${pulls}" | jq -r --arg merge_sha "${merge_sha}" '[.[] | select(.base.ref == "main" and .merged_at != null and .merge_commit_sha == $merge_sha)] | sort_by(.merged_at) | if length == 0 then "" else last.head.sha end')

if [ -z "${pull_number}" ] || [ -z "${head_sha}" ]; then
  echo "Main commit ${merge_sha} is not an associated merged PR commit" >&2
  exit 1
fi

merge_tree=$(gh api "repos/${repository}/git/commits/${merge_sha}" --jq '.tree.sha')
head_tree=$(gh api "repos/${repository}/git/commits/${head_sha}" --jq '.tree.sha')
test "${merge_tree}" = "${head_tree}" || {
  echo "Merged PR #${pull_number} tree does not match main commit ${merge_sha}" >&2
  exit 1
}

check_runs=$(gh api -H "Accept: application/vnd.github+json" "repos/${repository}/commits/${head_sha}/check-runs?per_page=100")
statuses=$(gh api -H "Accept: application/vnd.github+json" "repos/${repository}/commits/${head_sha}/statuses?per_page=100")
for required_check in ${required_checks}; do
  check_state=$(printf '%s' "${check_runs}" | jq -r --arg name "${required_check}" '[.check_runs[] | select(.name == $name)] | sort_by(.started_at) | if length == 0 then "missing" else (last | (.status + ":" + (.conclusion // ""))) end')
  status_state=$(printf '%s' "${statuses}" | jq -r --arg name "${required_check}" '[.[] | select(.context == $name)] | sort_by(.created_at) | if length == 0 then "missing" else last.state end')
  if [ "${check_state}" != "completed:success" ] && [ "${status_state}" != success ]; then
    echo "Merged PR #${pull_number} check ${required_check} is check=${check_state}, status=${status_state}" >&2
    exit 1
  fi
done

echo "Reused successful full-validation from merged PR #${pull_number} for ${merge_sha}"
