#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=scripts/check-run-provenance.sh
. "${script_dir}/check-run-provenance.sh"

repo_slug=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
repo_owner=${repo_slug%%/*}
repo_name=${repo_slug#*/}
primary_root=${ZERP_PRIMARY_ROOT:-/Users/hansonyu/code/zerp}
runtime_root=${ZERP_ISSUE_RELEASE_RUNTIME_ROOT:-${primary_root}/backend/var/issue-release}
repository_root="${runtime_root}/repository"
source_root="${runtime_root}/source"
lock_dir="${runtime_root}/agent.lock"
credential_root=${ZERP_RELEASE_APP_CREDENTIAL_ROOT:-/Users/hansonyu/.secrets/zerp-release-controller}
app_id_file="${credential_root}/app-id"
private_key_file="${credential_root}/private-key.pem"
actor_file="${credential_root}/bot-login"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }

if [ ! -r "${app_id_file}" ] || [ ! -r "${private_key_file}" ] || [ ! -r "${actor_file}" ]; then
  log "release-controller GitHub App credentials are incomplete"
  exit 1
fi
app_id=$(sed -n '1p' "${app_id_file}")
release_actor=$(sed -n '1p' "${actor_file}")
GH_TOKEN=$("${script_dir}/github-app-token.sh" "${app_id}" "${private_key_file}" "${repo_owner}" "${repo_name}")
export GH_TOKEN ZERP_RELEASE_VERIFIER_ACTOR="${release_actor}"

mkdir -p "${runtime_root}"
chmod 700 "${runtime_root}"
if ! mkdir "${lock_dir}" 2>/dev/null; then
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then exit 0; fi
  rm -rf "${lock_dir}"
  mkdir "${lock_dir}" 2>/dev/null || exit 0
fi
printf '%s\n' "$$" >"${lock_dir}/pid"
cleanup() {
  git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
  git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
  rm -f "${lock_dir}/pid"
  rmdir "${lock_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

enabled=$(gh api "repos/${repo_slug}/actions/variables/ZERP_AUTOMATION_ENABLED" --jq .value 2>/dev/null || printf false)
[ "${enabled}" = true ] || { log "automation kill switch is disabled"; exit 0; }

if [ ! -d "${repository_root}/.git" ]; then
  git clone --filter=blob:none "https://github.com/${repo_slug}.git" "${repository_root}"
fi
git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
git -C "${repository_root}" fetch origin main --prune
main_sha=$(git -C "${repository_root}" rev-parse origin/main)
git -C "${repository_root}" worktree add --detach "${source_root}" "${main_sha}"

issues=$(gh api --paginate --slurp "repos/${repo_slug}/issues?state=open&labels=automation%3Arelease&per_page=100" | jq -c 'add | [.[] | select(.pull_request | not)]')
[ "$(printf '%s' "${issues}" | jq length)" -gt 0 ] || exit 0

candidate_file="${runtime_root}/candidates.new"
: >"${candidate_file}"
printf '%s' "${issues}" | jq -c '.[]' | while IFS= read -r issue_json; do
  issue=$(printf '%s' "${issue_json}" | jq -r .number)
  priority=$(printf '%s' "${issue_json}" | jq -r '[.labels[].name | select(test("^priority:p[0-3]$"))] | if length == 1 then .[0] else "priority:p2" end | sub("priority:p";"") | tonumber')
  pr_json=$(gh pr list --state open --base main --search "Refs #${issue} in:body" --json number,body,headRefName,headRefOid,isDraft,state --limit 10 | jq -c --arg issue "${issue}" '[.[] | select(.headRefName | startswith("codex/issue-")) | select(.body | contains("zerp-automation issue="+$issue+" "))] | if length == 1 then .[0] else null end')
  [ "${pr_json}" != null ] || continue
  deployment=$(printf '%s' "${pr_json}" | jq -r '.body' | sed -n 's/.* deployment=\([0-9][0-9]*\) .*/\1/p')
  authorized_at=$(gh api "repos/${repo_slug}/deployments/${deployment}" --jq .created_at 2>/dev/null || printf '9999-12-31T23:59:59Z')
  jq -nc --argjson priority "${priority}" --arg authorized_at "${authorized_at}" --argjson issue "${issue}" --argjson pr "$(printf '%s' "${pr_json}" | jq -r .number)" '{priority:$priority,authorized_at:$authorized_at,issue:$issue,pr:$pr}' >>"${candidate_file}"
done

candidate=$(jq -sc 'sort_by(.priority,.authorized_at,.issue) | if length == 0 then null else .[0] end' "${candidate_file}")
rm -f "${candidate_file}"
[ "${candidate}" != null ] || exit 0
issue=$(printf '%s' "${candidate}" | jq -r .issue)
pr=$(printf '%s' "${candidate}" | jq -r .pr)
retry_file="${runtime_root}/issue-${issue}-infra.state"
now=$(date +%s)
read_retry_field() { sed -n "s/^$1=//p" "${retry_file}" 2>/dev/null | sed -n '1p'; }
block_expired_infrastructure() {
  first=$(read_retry_field first)
  [ -n "${first}" ] && [ $((now - first)) -ge 86400 ] || return 1
  "${source_root}/scripts/issue-automation.sh" set-state "${issue}" automation:blocked
  gh issue comment "${issue}" --body "本地预览、GitHub 或公网基础设施在 24 小时指数退避后仍未恢复，自动交付已阻塞。"
  rm -f "${retry_file}"
  return 0
}
record_infrastructure_failure() {
  reason=$1
  first=$(read_retry_field first)
  attempts=$(read_retry_field attempts)
  [ -n "${first}" ] || first=${now}
  [ -n "${attempts}" ] || attempts=0
  attempts=$((attempts + 1))
  if [ $((now - first)) -ge 86400 ]; then
    block_expired_infrastructure
    return
  fi
  delay=60
  count=1
  while [ "${count}" -lt "${attempts}" ] && [ "${delay}" -lt 21600 ]; do
    delay=$((delay * 2))
    [ "${delay}" -le 21600 ] || delay=21600
    count=$((count + 1))
  done
  next=$((now + delay))
  {
    printf 'first=%s\n' "${first}"
    printf 'attempts=%s\n' "${attempts}"
    printf 'next=%s\n' "${next}"
    printf 'reason=%s\n' "${reason}"
  } >"${retry_file}.new"
  mv "${retry_file}.new" "${retry_file}"
  log "Issue #${issue} infrastructure failure; retry ${attempts} after ${delay}s: ${reason}"
}
if [ -f "${retry_file}" ]; then
  block_expired_infrastructure && exit 0
  next=$(read_retry_field next)
  [ -z "${next}" ] || [ "${now}" -ge "${next}" ] || exit 0
fi
pr_json=$(gh api "repos/${repo_slug}/pulls/${pr}")
head=$(printf '%s' "${pr_json}" | jq -r .head.sha)
draft=$(printf '%s' "${pr_json}" | jq -r .draft)
[ "${draft}" = false ] || { log "PR #${pr} is still Draft"; exit 0; }
git -C "${repository_root}" fetch origin "refs/pull/${pr}/head:refs/remotes/origin/release/${pr}" --force
if ! git -C "${repository_root}" merge-base --is-ancestor "${main_sha}" "${head}"; then
  round=$(git -C "${repository_root}" show -s --format=%s "${head}" | sed -n 's/.* implementation round \([1-3]\)$/\1/p')
  [ -n "${round}" ] || round=1
  gh pr ready "${pr}" --undo >/dev/null
  gh pr comment "${pr}" --body "Release controller requires replay of exact head \`${head}\` onto current main \`${main_sha}\`. <!-- zerp-repair head=${head} round=${round} reason=stale-main -->"
  "${source_root}/scripts/issue-automation.sh" set-state "${issue}" automation:implementing
  log "requested latest-main replay for stale PR #${pr}"
  exit 0
fi

checks=$(gh api --paginate --slurp "repos/${repo_slug}/commits/${head}/check-runs?per_page=100" | jq -ce '{check_runs:[.[].check_runs[]]}')
latest_check() { printf '%s' "${checks}" | jq -c --arg name "$1" '[.check_runs[] | select(.name == $name)] | sort_by(.started_at) | if length == 0 then null else last end'; }
reviewer_actor=$(gh api "repos/${repo_slug}/actions/variables/ZERP_REVIEWER_BOT_LOGIN" --jq .value 2>/dev/null || true)
[ -n "${reviewer_actor}" ] || { log 'reviewer Bot login is not configured'; exit 0; }
statuses=$(gh api --paginate --slurp "repos/${repo_slug}/commits/${head}/statuses?per_page=100" | jq -ce '[.[][]]')
verify_review_status() {
  context=$1
  status=$(printf '%s' "${statuses}" | jq -c --arg context "${context}" \
    '[.[] | select(.context == $context)] | sort_by(.created_at,.id) | if length == 0 then null else last end')
  [ "${status}" != null ] || return 1
  printf '%s' "${status}" | jq -e --arg head "${head}" --arg actor "${reviewer_actor}" \
    --arg context "${context}" --arg target "https://github.com/${repo_slug}/commit/${head}" \
    --arg prefix "PR #${pr} round " '
      .sha == $head and .state == "success" and .context == $context and
      ((.creator.login | ascii_downcase) == ($actor | ascii_downcase)) and
      .target_url == $target and (.description | startswith($prefix))
    ' >/dev/null
}
verify_review_status automation-standards-review || { log "waiting for trusted standards review on PR #${pr}"; exit 0; }
verify_review_status automation-spec-review || { log "waiting for trusted specification review on PR #${pr}"; exit 0; }

full_check=$(latest_check full-validation)
preview_check=$(latest_check preview-required)
if verify_actions_check_run "${repo_slug}" "${full_check}" full-validation "${head}" pull_request "${pr}" gh; then
  log "PR #${pr} has trusted full-validation without preview"
elif verify_actions_check_run "${repo_slug}" "${preview_check}" preview-required "${head}" pull_request "${pr}" gh; then
  log "deploying exact-SHA preview for PR #${pr}"
  if ! ZERP_PRIMARY_ROOT="${primary_root}" \
  ZERP_PREVIEW_RUNTIME_ROOT="${primary_root}/backend/var/preview-native" \
  ZERP_PREVIEW_STATE_ROOT="${primary_root}/backend/var/preview-native/state" \
  ZERP_PREVIEW_ENV_FILE="${primary_root}/backend/.env.preview.local" \
  PREVIEW_ACTOR="${release_actor}" \
    "${source_root}/scripts/preview-deploy.sh" "${pr}" "${head}"; then
    record_infrastructure_failure "exact-SHA preview deployment failed"
    exit 0
  fi
  if ! ZERP_PRIMARY_ROOT="${primary_root}" ZERP_PREVIEW_ENV_FILE="${primary_root}/backend/.env.preview.local" \
    "${source_root}/scripts/preview-smoke.sh" "${head}"; then
    round=$(git -C "${repository_root}" show -s --format=%s "${head}" | sed -n 's/.* implementation round \([1-3]\)$/\1/p')
    [ -n "${round}" ] || round=3
    if [ "${round}" -lt 3 ]; then
      gh pr ready "${pr}" --undo >/dev/null
      gh pr comment "${pr}" --body "Release controller rejected exact head \`${head}\`: preview browser smoke failed. <!-- zerp-repair head=${head} round=${round} reason=preview -->"
      "${source_root}/scripts/issue-automation.sh" set-state "${issue}" automation:implementing
      exit 0
    fi
    "${source_root}/scripts/issue-automation.sh" set-state "${issue}" automation:blocked
    gh issue comment "${issue}" --body "精确 SHA 预览浏览器验收在第 3 轮失败，自动交付已阻塞。"
    exit 1
  fi
  if ! PREVIEW_PR="${pr}" PREVIEW_ACTOR="${release_actor}" \
  ZERP_PREVIEW_RUNTIME_ROOT="${primary_root}/backend/var/preview-native" \
  ZERP_PREVIEW_STATE_ROOT="${primary_root}/backend/var/preview-native/state" \
    "${source_root}/scripts/preview-state.sh" accept; then
    record_infrastructure_failure "release-verifier evidence publication failed"
    exit 0
  fi
else
  log "waiting for trusted quality evidence on PR #${pr}"
  exit 0
fi

if ! gh pr merge "${pr}" --auto --squash --delete-branch; then
  record_infrastructure_failure "squash auto-merge request failed"
  exit 0
fi
rm -f "${retry_file}"
log "requested squash auto-merge for PR #${pr} at ${head}"
