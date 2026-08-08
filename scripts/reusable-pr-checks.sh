#!/bin/sh
set -eu

repo=${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY}
pr=${ZERP_PR_NUMBER:?set ZERP_PR_NUMBER}
base=${ZERP_PR_BASE_SHA:?set ZERP_PR_BASE_SHA}
head=${ZERP_PR_HEAD_SHA:?set ZERP_PR_HEAD_SHA}
head_ref=${ZERP_PR_HEAD_REF:?set ZERP_PR_HEAD_REF}
current_run=${GITHUB_RUN_ID:?set GITHUB_RUN_ID}

pr_json=$(gh api "repos/${repo}/pulls/${pr}")
printf '%s' "${pr_json}" |
  jq -e --arg base "${base}" --arg head "${head}" --arg ref "${head_ref}" \
    '.base.sha == $base and .head.sha == $head and .head.ref == $ref' >/dev/null || {
  echo "PR base or head changed before evidence reuse" >&2
  exit 1
}

runs=$(gh api "repos/${repo}/actions/runs?event=pull_request&head_sha=${head}&per_page=100")
prior_run=$(
  printf '%s' "${runs}" |
    jq -r --arg current "${current_run}" --arg ref "${head_ref}" \
      --arg base "${base}" --arg head "${head}" --argjson pr "${pr}" '
      [.workflow_runs[]
        | select(
            (.id | tostring) != $current and
            .name == "Full-stack quality" and
            .event == "pull_request" and
            .head_branch == $ref and
            .head_sha == $head and
            ((.pull_requests // []) | any(
              .number == $pr and .base.sha == $base and .head.sha == $head
            )) and
            .status == "completed" and
            .conclusion == "success"
          )]
      | sort_by(.updated_at)
      | if length == 0 then "" else last.id end
    '
)

reuse_contracts=0
if [ -n "${prior_run}" ]; then
  jobs=$(gh api "repos/${repo}/actions/runs/${prior_run}/jobs?per_page=100")
  state=$(
    printf '%s' "${jobs}" |
      jq -r '
        [.jobs[] | select(.name == "contracts")]
        | sort_by(.completed_at)
        | if length == 0 then "missing"
          else last | (.status + ":" + (.conclusion // ""))
          end
      '
  )
  if [ "${state}" = completed:success ]; then
    reuse_contracts=1
  fi
fi

printf 'reuse_contracts=%s\n' "${reuse_contracts}"
fingerprint="${pr}:${base}:${head}"
printf 'fingerprint=%s\n' "${fingerprint}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'reuse_contracts=%s\n' "${reuse_contracts}" >>"${GITHUB_OUTPUT}"
  printf 'fingerprint=%s\n' "${fingerprint}" >>"${GITHUB_OUTPUT}"
fi
