#!/bin/sh
set -eu

base_ref=${GITHUB_BASE_REF:?set GITHUB_BASE_REF}

test "${base_ref}" = "main" || {
  echo "Pull requests must target main; wait for the parent PR to merge, then rebase this branch onto the updated main" >&2
  exit 1
}

base_sha=${ZERP_PR_BASE_SHA:-}
head_sha=${ZERP_PR_HEAD_SHA:-}
if [ -n "${base_sha}" ] || [ -n "${head_sha}" ]; then
  if [ -z "${base_sha}" ] || [ -z "${head_sha}" ]; then
    echo "Both ZERP_PR_BASE_SHA and ZERP_PR_HEAD_SHA are required for ancestry verification" >&2
    exit 1
  fi
  git merge-base --is-ancestor "${base_sha}" "${head_sha}" || {
    echo "Pull request head does not include the current main base; update the branch from main before running full checks" >&2
    exit 1
  }
fi

pr_number=${ZERP_PR_NUMBER:-}
if [ -n "${pr_number}" ]; then
  repository=${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY}
  token=${GH_TOKEN:?set GH_TOKEN}
  test -n "${token}" || exit 1
  command -v gh >/dev/null 2>&1 || {
    echo "gh is required to detect stacked pull requests" >&2
    exit 1
  }
  command -v jq >/dev/null 2>&1 || {
    echo "jq is required to detect stacked pull requests" >&2
    exit 1
  }

  open_pulls=$(gh api "repos/${repository}/pulls?state=open&per_page=100")
  printf '%s' "${open_pulls}" |
    jq -r --argjson current "${pr_number}" \
      '.[] | select(.number != $current) | "\(.number) \(.head.sha)"' |
    while read -r candidate_number candidate_sha; do
      if git cat-file -e "${candidate_sha}^{commit}" 2>/dev/null &&
        git merge-base --is-ancestor "${candidate_sha}" "${head_sha}"; then
        echo "Pull request includes open PR #${candidate_number}; merge it first, then update this branch from main" >&2
        exit 1
      fi
    done
fi

echo "Pull request is directly based on current main"
