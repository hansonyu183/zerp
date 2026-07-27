#!/bin/sh
set -eu

repository=${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY}
merge_sha=${GITHUB_SHA:?set GITHUB_SHA}
required_checks=${ZERP_REQUIRED_PR_CHECKS:-"contracts frontend backend containers e2e"}

command -v gh >/dev/null 2>&1 || {
  echo "gh is required to verify merged PR evidence" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required to verify merged PR evidence" >&2
  exit 1
}

pulls=$(
  gh api \
    -H "Accept: application/vnd.github+json" \
    "repos/${repository}/commits/${merge_sha}/pulls?per_page=20"
)
pull_number=$(
  printf '%s' "${pulls}" |
    jq -r --arg merge_sha "${merge_sha}" \
      '[.[] |
        select(
          .base.ref == "main" and
          .merged_at != null and
          .merge_commit_sha == $merge_sha
        )
      ] |
      sort_by(.merged_at) |
      if length == 0 then "" else last.number end'
)
head_sha=$(
  printf '%s' "${pulls}" |
    jq -r --arg merge_sha "${merge_sha}" \
      '[.[] |
        select(
          .base.ref == "main" and
          .merged_at != null and
          .merge_commit_sha == $merge_sha
        )
      ] |
      sort_by(.merged_at) |
      if length == 0 then "" else last.head.sha end'
)

test -n "${pull_number}" && test -n "${head_sha}" || {
  echo "Main commit ${merge_sha} is not an associated merged PR commit" >&2
  exit 1
}

merge_tree=$(gh api "repos/${repository}/git/commits/${merge_sha}" --jq '.tree.sha')
head_tree=$(gh api "repos/${repository}/git/commits/${head_sha}" --jq '.tree.sha')
test "${merge_tree}" = "${head_tree}" || {
  echo "Merged PR #${pull_number} tree does not match main commit ${merge_sha}" >&2
  exit 1
}

check_runs=$(
  gh api \
    -H "Accept: application/vnd.github+json" \
    "repos/${repository}/commits/${head_sha}/check-runs?per_page=100"
)
for required_check in ${required_checks}; do
  check_state=$(
    printf '%s' "${check_runs}" |
      jq -r --arg name "${required_check}" \
        '[.check_runs[] | select(.name == $name)] |
        sort_by(.started_at) |
        if length == 0 then "missing" else
          (last | (.status + ":" + (.conclusion // "")))
        end'
  )
  test "${check_state}" = "completed:success" || {
    echo "Merged PR #${pull_number} check ${required_check} is ${check_state}" >&2
    exit 1
  }
done

echo "Reused successful checks from merged PR #${pull_number} for ${merge_sha}"
