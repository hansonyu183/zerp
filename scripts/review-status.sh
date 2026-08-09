#!/bin/sh
set -eu

pr_number=${1:-}
repository=${ZERP_GITHUB_REPOSITORY:-}

if [ -z "${repository}" ]; then
  repository=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
fi
if [ -z "${pr_number}" ]; then
  pr_number=$(gh pr view --json number --jq '.number')
fi
case "${pr_number}" in
  '' | *[!0-9]*)
    echo 'usage: scripts/review-status.sh [pull-request-number]' >&2
    exit 2
    ;;
esac

pull_request=$(gh api "repos/${repository}/pulls/${pr_number}")
head_sha=$(printf '%s' "${pull_request}" | jq -r '.head.sha // ""')
base_ref=$(printf '%s' "${pull_request}" | jq -r '.base.ref // ""')
pr_state=$(printf '%s' "${pull_request}" | jq -r '.state // ""')
if [ -z "${head_sha}" ] || [ "${base_ref}" != main ] || [ "${pr_state}" != open ]; then
  echo "PR #${pr_number} is not an open pull request targeting main" >&2
  exit 2
fi

reviews=$(gh api --paginate --slurp \
  "repos/${repository}/pulls/${pr_number}/reviews?per_page=100")
comments=$(gh api --paginate --slurp \
  "repos/${repository}/issues/${pr_number}/comments?per_page=100")
evidence=$(
  jq -cn --argjson reviews "${reviews}" --argjson comments "${comments}" '
    [
      $reviews[][]
      | select(.user.login == "chatgpt-codex-connector[bot]")
      | {at: .submitted_at, sha: .commit_id, source: "review"}
    ] + [
      $comments[][]
      | select(
          .user.login == "chatgpt-codex-connector" or
          .user.login == "chatgpt-codex-connector[bot]"
        )
      | (.body | try capture("Reviewed commit:\\*\\* `(?<sha>[0-9a-f]{7,40})`") catch null) as $match
      | select($match != null)
      | {at: .created_at, sha: $match.sha, source: "comment"}
    ]
    | sort_by(.at)
    | if length == 0 then {at:"", sha:"", source:"none"} else last end
  '
)
reviewed_sha=$(printf '%s' "${evidence}" | jq -r '.sha')
evidence_source=$(printf '%s' "${evidence}" | jq -r '.source')

owner=${repository%%/*}
name=${repository#*/}
# shellcheck disable=SC2016
threads=$(
  gh api graphql \
    -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage}nodes{isResolved}}}}}' \
    -f owner="${owner}" -f name="${name}" -F number="${pr_number}"
)
has_more_threads=$(printf '%s' "${threads}" |
  jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
if [ "${has_more_threads}" = true ]; then
  echo 'Review thread count exceeds the supported page; inspect GitHub directly' >&2
  exit 2
fi
unresolved=$(printf '%s' "${threads}" |
  jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length')

status=stale
if [ -z "${reviewed_sha}" ]; then
  status=pending
elif [ "${head_sha#"${reviewed_sha}"}" != "${head_sha}" ] && [ "${unresolved}" -eq 0 ]; then
  status=ready
elif [ "${head_sha#"${reviewed_sha}"}" != "${head_sha}" ]; then
  status=pending
fi

printf 'pr=%s\n' "${pr_number}"
printf 'head=%s\n' "${head_sha}"
printf 'reviewed=%s\n' "${reviewed_sha:-none}"
printf 'evidence=%s\n' "${evidence_source}"
printf 'unresolved=%s\n' "${unresolved}"
printf 'status=%s\n' "${status}"

test "${status}" = ready
