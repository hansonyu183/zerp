#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
gh_bin=${ZERP_GH_BIN:-gh}
repo=${GITHUB_REPOSITORY:-${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}}
now=${ZERP_RETRY_NOW:-$(date +%s)}

[ "${ZERP_AUTOMATION_ENABLED:-false}" = true ] || exit 0
runs=$("${gh_bin}" api --paginate --slurp "repos/${repo}/actions/runs?status=failure&per_page=100" | jq -c '[.[].workflow_runs[]] | sort_by(.updated_at) | reverse')
seen=" "

printf '%s' "${runs}" | jq -c '.[] | select(.name == "Issue authorization" or .name == "Issue implementation" or .name == "Automated independent reviews")' |
while IFS= read -r run; do
  title=$(printf '%s' "${run}" | jq -r .display_title)
  case "${title}" in
    Issue\ \#*) issue=$(printf '%s' "${title}" | sed -n 's/^Issue #\([0-9][0-9]*\).*/\1/p') ;;
    PR\ \#*)
      pr=$(printf '%s' "${title}" | sed -n 's/^PR #\([0-9][0-9]*\).*/\1/p')
      issue=$("${gh_bin}" api "repos/${repo}/pulls/${pr}" --jq '.body // ""' 2>/dev/null |
        sed -n 's/.*<!-- zerp-automation issue=\([0-9][0-9]*\) .*/\1/p')
      ;;
    *) continue ;;
  esac
  [ -n "${issue}" ] || continue
  case "${seen}" in *" ${issue} "*) continue ;; esac
  seen="${seen}${issue} "

  state=$("${repo_root}/scripts/issue-automation.sh" state "${issue}")
  case "${state}" in
    automation:ready | automation:implementing | automation:reviewing | automation:release) ;;
    *) continue ;;
  esac

  created=$(printf '%s' "${run}" | jq -r .created_at)
  updated=$(printf '%s' "${run}" | jq -r .updated_at)
  created_epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "${created}" '+%s' 2>/dev/null || date -u -d "${created}" '+%s')
  updated_epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "${updated}" '+%s' 2>/dev/null || date -u -d "${updated}" '+%s')
  age=$((now - created_epoch))
  if [ "${age}" -ge 86400 ]; then
    "${repo_root}/scripts/issue-automation.sh" set-state "${issue}" automation:blocked
    "${gh_bin}" issue comment "${issue}" --body "GitHub、OpenAI 或网络基础设施在 24 小时有界重试后仍未恢复，自动交付已阻塞。最后运行：$(printf '%s' "${run}" | jq -r .html_url)"
    continue
  fi

  attempt=$(printf '%s' "${run}" | jq -r '.run_attempt // 1')
  delay=300
  count=1
  while [ "${count}" -lt "${attempt}" ] && [ "${delay}" -lt 21600 ]; do
    delay=$((delay * 2))
    [ "${delay}" -le 21600 ] || delay=21600
    count=$((count + 1))
  done
  [ $((now - updated_epoch)) -ge "${delay}" ] || continue
  run_id=$(printf '%s' "${run}" | jq -r .id)
  "${gh_bin}" api --method POST "repos/${repo}/actions/runs/${run_id}/rerun-failed-jobs" >/dev/null
  echo "reran failed infrastructure jobs for Issue #${issue}, run ${run_id}, attempt ${attempt}"
done
