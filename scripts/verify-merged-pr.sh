#!/bin/sh
set -eu

repository=${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY}
merge_sha=${GITHUB_SHA:?set GITHUB_SHA}
required_checks=${ZERP_REQUIRED_PR_CHECKS:-"full-validation"}
expected_pull_number=${ZERP_EXPECTED_PR:-}
expected_head_sha=${ZERP_EXPECTED_HEAD:-}

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

if [ -n "${expected_pull_number}" ] && [ "${pull_number}" != "${expected_pull_number}" ]; then
  echo "Main commit ${merge_sha} belongs to PR #${pull_number}, expected PR #${expected_pull_number}" >&2
  exit 1
fi
if [ -n "${expected_head_sha}" ] && [ "${head_sha}" != "${expected_head_sha}" ]; then
  echo "Merged PR #${pull_number} head is ${head_sha}, expected ${expected_head_sha}" >&2
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
  if [ "${check_state}" = "completed:success" ]; then
    continue
  fi

  status=$(printf '%s' "${statuses}" | jq -c --arg name "${required_check}" '[.[] | select(.context == $name)] | sort_by(.created_at) | if length == 0 then null else last end')
  status_state=$(printf '%s' "${status}" | jq -r '.state // "missing"')
  if [ "${required_check}" != full-validation ] || [ "${status_state}" != success ]; then
    echo "Merged PR #${pull_number} check ${required_check} is check=${check_state}, status=${status_state}" >&2
    exit 1
  fi

  status_description=$(printf '%s' "${status}" | jq -r '.description // ""')
  status_target=$(printf '%s' "${status}" | jq -r '.target_url // ""')
  status_actor=$(printf '%s' "${status}" | jq -r '.creator.login // ""')
  acceptance=$(printf '%s' "${status_description}" | sed -n "s/^accepted preview PR #${pull_number} generation \([0-9][0-9]*\) by \([^ ][^ ]*\)$/\1 \2/p")
  generation=${acceptance%% *}
  accepted_actor=${acceptance#* }
  if [ -z "${acceptance}" ] || [ "${status_target}" != "https://zerp-preview.bytesucceed.com" ] || \
    [ "$(printf '%s' "${status_actor}" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "${accepted_actor}" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "Merged PR #${pull_number} full-validation status is not trusted preview acceptance evidence" >&2
    exit 1
  fi
  accepted_actor_key=$(printf '%s' "${accepted_actor}" | tr '[:upper:]' '[:lower:]')
  case "${accepted_actor_key}" in
    *'[bot]' | *-bot | bot)
      echo "Merged PR #${pull_number} preview acceptance actor must not be a Bot" >&2
      exit 1
      ;;
  esac
  permission=$(gh api "repos/${repository}/collaborators/${accepted_actor}/permission" --jq '.permission // "none"')
  case "${permission}" in
    admin | maintain | write) ;;
    *)
      echo "Merged PR #${pull_number} preview acceptance actor ${accepted_actor} lacks write permission" >&2
      exit 1
      ;;
  esac

  deployment_description="preview PR #${pull_number} generation ${generation} actor ${accepted_actor}"
  deployments=$(gh api -H "Accept: application/vnd.github+json" "repos/${repository}/deployments?sha=${head_sha}&environment=preview&per_page=100")
  deployment_id=$(printf '%s' "${deployments}" | jq -r \
    --arg pr "${pull_number}" --arg generation "${generation}" \
    --arg actor "${accepted_actor}" --arg description "${deployment_description}" \
    '[.[] | select(.description == $description and (.payload.pr | tostring) == $pr and (.payload.generation | tostring) == $generation and ((.payload.actor // "") | ascii_downcase) == ($actor | ascii_downcase) and ((.creator.login // "") | ascii_downcase) == ($actor | ascii_downcase))] | sort_by(.created_at) | if length == 0 then "" else last.id end')
  if [ -z "${deployment_id}" ]; then
    echo "Merged PR #${pull_number} has no trusted Preview Deployment for accepted head ${head_sha}" >&2
    exit 1
  fi
  deployment_statuses=$(gh api -H "Accept: application/vnd.github+json" "repos/${repository}/deployments/${deployment_id}/statuses?per_page=100")
  deployment_status=$(printf '%s' "${deployment_statuses}" | jq -c 'sort_by(.created_at) | if length == 0 then null else last end')
  deployment_state=$(printf '%s' "${deployment_status}" | jq -r '.state // "missing"')
  deployment_actor=$(printf '%s' "${deployment_status}" | jq -r '.creator.login // ""')
  deployment_status_description=$(printf '%s' "${deployment_status}" | jq -r '.description // ""')
  expected_deployment_status="accepted PR #${pull_number} head ${head_sha} generation ${generation} actor ${accepted_actor}"
  if [ "${deployment_state}" != success ] || \
    [ "${deployment_status_description}" != "${expected_deployment_status}" ] || \
    [ "$(printf '%s' "${deployment_actor}" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "${accepted_actor}" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "Merged PR #${pull_number} Preview Deployment ${deployment_id} lacks matching accepted status" >&2
    exit 1
  fi
done

echo "Reused successful full-validation from merged PR #${pull_number} for ${merge_sha}"
