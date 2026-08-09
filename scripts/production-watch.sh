#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=scripts/check-run-provenance.sh
. "${script_dir}/check-run-provenance.sh"

repo_slug=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
runtime_root=${ZERP_PRODUCTION_RUNTIME_ROOT:-/Users/hansonyu/code/zerp/backend/var/production}
repository_root="${runtime_root}/repository"
source_root="${runtime_root}/source"
lock_dir="${runtime_root}/agent.lock"
required_checks="full-validation"
cloudflare_project=zerp
cloudflare_production_branch=main
cloudflare_account_file="${HOME}/.secrets/cloudflare/account_id_bytesucceed"
cloudflare_token_file="${HOME}/.secrets/cloudflare/api_token_workers_access"
repo_owner=${repo_slug%%/*}
repo_name=${repo_slug#*/}
deployment_sha_file="${runtime_root}/deployment-sha"
deployment_id_file="${runtime_root}/deployment-id"
deployment_status_file="${runtime_root}/deployment-status"
deployment_request_file="${runtime_root}/deployment-request.json"
deployment_status_request_file="${runtime_root}/deployment-status-request.json"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

retry() {
  max_attempts=$1
  shift
  attempt=1
  delay=1

  while ! "$@"; do
    if [ "${attempt}" -ge "${max_attempts}" ]; then
      return 1
    fi
    log "Command failed; retrying in ${delay}s (${attempt}/${max_attempts}): $*"
    sleep "${delay}"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

write_state() {
  value=$1
  destination=$2
  printf '%s\n' "${value}" > "${destination}.new"
  mv "${destination}.new" "${destination}"
}

mkdir -p "${runtime_root}"
chmod 700 "${runtime_root}"

if ! mkdir "${lock_dir}" 2>/dev/null; then
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
    log "Production agent already running with pid ${lock_pid}"
    exit 0
  fi
  rm -rf "${lock_dir}"
  mkdir "${lock_dir}" 2>/dev/null || exit 0
fi
printf '%s\n' "$$" > "${lock_dir}/pid"
cleanup() {
  git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
  git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
  rm -f "${lock_dir}/pid"
  rmdir "${lock_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [ ! -d "${repository_root}/.git" ]; then
  git clone --filter=blob:none "https://github.com/${repo_slug}.git" "${repository_root}"
fi

git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
if ! retry 4 git -C "${repository_root}" fetch origin main --prune; then
  log "Could not refresh origin/main after retries"
  exit 0
fi
target_sha=$(git -C "${repository_root}" rev-parse origin/main)
current_sha=$(cat "${runtime_root}/current-sha" 2>/dev/null || true)
processed_sha=$(cat "${runtime_root}/processed-sha" 2>/dev/null || true)
failed_sha=$(cat "${runtime_root}/failed-sha" 2>/dev/null || true)

mark_processed() {
  printf '%s\n' "$1" > "${runtime_root}/processed-sha.new"
  mv "${runtime_root}/processed-sha.new" "${runtime_root}/processed-sha"
}

mark_failed() {
  printf '%s\n' "$1" > "${runtime_root}/failed-sha.new"
  mv "${runtime_root}/failed-sha.new" "${runtime_root}/failed-sha"
}

clear_failed() {
  rm -f "${runtime_root}/failed-sha" "${runtime_root}/failed-sha.new"
}

deployment_id=""
stored_deployment_sha=$(cat "${deployment_sha_file}" 2>/dev/null || true)
if [ "${stored_deployment_sha}" = "${target_sha}" ]; then
  deployment_id=$(cat "${deployment_id_file}" 2>/dev/null || true)
else
  rm -f "${deployment_sha_file}" "${deployment_id_file}" \
    "${deployment_status_file}" "${deployment_request_file}" \
    "${deployment_status_request_file}"
fi

ensure_deployment() {
  if [ -n "${deployment_id}" ]; then
    return 0
  fi

  if ! existing_deployments=$(retry 4 gh api \
    "repos/${repo_slug}/deployments?sha=${target_sha}&environment=production&per_page=10"); then
    log "Could not check existing production deployments for ${target_sha}"
    return 1
  fi
  deployment_id=$(
    printf '%s' "${existing_deployments}" |
      jq -r 'sort_by(.created_at) | if length == 0 then "" else last.id end'
  )
  if [ -n "${deployment_id}" ]; then
    write_state "${target_sha}" "${deployment_sha_file}"
    write_state "${deployment_id}" "${deployment_id_file}"
    log "Reusing production deployment ${deployment_id} for ${target_sha}"
    return 0
  fi

  jq -n --arg ref "${target_sha}" \
    '{ref:$ref,environment:"production",auto_merge:false,required_contexts:[]}' \
    > "${deployment_request_file}.new"
  mv "${deployment_request_file}.new" "${deployment_request_file}"

  if ! deployment_id=$(gh api --method POST \
    "repos/${repo_slug}/deployments" \
    --input "${deployment_request_file}" --jq '.id'); then
    deployment_id=""
    log "Could not create production deployment for ${target_sha}"
    return 1
  fi

  write_state "${target_sha}" "${deployment_sha_file}"
  write_state "${deployment_id}" "${deployment_id_file}"
  log "Created production deployment ${deployment_id} for ${target_sha}"
}

set_deployment_status() {
  state=$1
  description=$2
  status_key="${state}:${description}"
  previous_status=$(cat "${deployment_status_file}" 2>/dev/null || true)

  if [ "${status_key}" = "${previous_status}" ]; then
    return 0
  fi
  ensure_deployment || return 0

  jq -n --arg state "${state}" --arg description "${description}" \
    '{state:$state,description:$description,environment_url:"https://zerp.bytesucceed.com"}' \
    > "${deployment_status_request_file}.new"
  mv "${deployment_status_request_file}.new" "${deployment_status_request_file}"

  if retry 4 gh api --method POST \
    "repos/${repo_slug}/deployments/${deployment_id}/statuses" \
    --input "${deployment_status_request_file}" >/dev/null; then
    write_state "${status_key}" "${deployment_status_file}"
    log "Production deployment ${deployment_id}: ${status_key}"
  else
    log "Could not update production deployment ${deployment_id}: ${status_key}"
  fi
}

if [ "${target_sha}" = "${processed_sha}" ]; then
  exit 0
fi

if [ "${target_sha}" = "${failed_sha}" ]; then
  exit 0
fi

if [ "${target_sha}" = "${current_sha}" ]; then
  mark_processed "${target_sha}"
  clear_failed
  exit 0
fi

load_check_runs() {
  gh api --paginate --slurp \
    "repos/${repo_slug}/commits/${target_sha}/check-runs?per_page=100" |
    jq -ce '{check_runs: [.[].check_runs[]]}'
}

if ! check_runs=$(retry 4 load_check_runs); then
  log "Could not load checks for ${target_sha} after retries"
  exit 0
fi

check_json() {
  required_check=$1
  printf '%s' "${check_runs}" |
    jq -c --arg name "${required_check}" \
      '[.check_runs[] | select(.name == $name)] | sort_by(.started_at) |
       if length == 0 then null else last end'
}

check_ready() {
  required_check=$1
  required_run=$(check_json "${required_check}")
  required_state=$(printf '%s' "${required_run}" |
    jq -r 'if . == null then "missing" else (.status + ":" + (.conclusion // "")) end')
  if [ "${required_state}" != "completed:success" ]; then
    log "Waiting for ${required_check} on ${target_sha}: ${required_state}"
    return 1
  fi
  if ! verify_actions_check_run "${repo_slug}" "${required_run}" \
    "${required_check}" "${target_sha}" push '' gh; then
    log "Waiting for trusted ${required_check} provenance on ${target_sha}"
    return 1
  fi
}

for required_check in ${required_checks}; do
  check_ready "${required_check}" || exit 0
done

git -C "${repository_root}" worktree add --detach "${source_root}" "${target_sha}"

if [ -n "${current_sha}" ] &&
   git -C "${repository_root}" merge-base --is-ancestor "${current_sha}" "${target_sha}"; then
  changed_files=$(git -C "${repository_root}" diff --name-only "${current_sha}..${target_sha}")
  impact=$(printf '%s\n' "${changed_files}" | "${source_root}/scripts/change-impact.sh" --paths)
  if [ "${impact}" != "application" ]; then
    mark_processed "${target_sha}"
    clear_failed
    set_deployment_status success "No application changes (${impact})"
    log "Production no-op for ${impact} commit ${target_sha}"
    exit 0
  fi
fi

find_production_cloudflare_deployment() (
  printf '%s' "${check_runs}" |
    jq -c '[.check_runs[] | select(.name == "Cloudflare Pages")] |
      sort_by(.started_at) | reverse | .[]' |
    (
      while IFS= read -r cloudflare_run; do
        verify_cloudflare_pages_check_run \
          "${cloudflare_run}" "${target_sha}" "${cloudflare_project}" || continue
        candidate_id=$(printf '%s' "${cloudflare_run}" | jq -r '.external_id')
        candidate_deployment=$(retry 4 load_cloudflare_pages_deployment \
          "${cloudflare_account_file}" "${cloudflare_token_file}" \
          "${cloudflare_project}" "${candidate_id}") || continue
        if verify_cloudflare_pages_deployment "${candidate_deployment}" \
          "${candidate_id}" "${target_sha}" "${cloudflare_project}" \
          "${repo_owner}" "${repo_name}" "${cloudflare_production_branch}"; then
          printf '%s\n' "${candidate_id}"
          exit 0
        fi
      done
      exit 1
    )
)

if ! cloudflare_deployment_id=$(find_production_cloudflare_deployment); then
  set_deployment_status queued "Waiting for production Cloudflare Pages deployment"
  log "Waiting for trusted production Cloudflare Pages deployment on ${target_sha}"
  exit 0
fi
log "Trusted production Cloudflare Pages deployment ${cloudflare_deployment_id} for ${target_sha}"

set_deployment_status in_progress "Deploying ${target_sha}"

if ZERP_PRODUCTION_STATE_ROOT="${ZERP_PRODUCTION_STATE_ROOT:-/Users/hansonyu/code/zerp}" \
   ZERP_PRODUCTION_RUNTIME_ROOT="${runtime_root}" \
   "${source_root}/scripts/production-deploy.sh" "${target_sha}"; then
  mark_processed "${target_sha}"
  clear_failed
  set_deployment_status success "Deployed ${target_sha}"
else
  mark_failed "${target_sha}"
  set_deployment_status failure "Deployment failed for ${target_sha}"
  exit 1
fi
