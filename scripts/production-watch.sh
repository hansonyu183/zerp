#!/bin/sh
set -eu

repo_slug=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
runtime_root=${ZERP_PRODUCTION_RUNTIME_ROOT:-/Users/hansonyu/code/zerp/backend/var/production}
repository_root="${runtime_root}/repository"
source_root="${runtime_root}/source"
lock_dir="${runtime_root}/agent.lock"
required_checks="contracts frontend backend containers e2e"

mkdir -p "${runtime_root}"
chmod 700 "${runtime_root}"

if ! mkdir "${lock_dir}" 2>/dev/null; then
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
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
git -C "${repository_root}" fetch origin main --prune
target_sha=$(git -C "${repository_root}" rev-parse origin/main)
current_sha=$(cat "${runtime_root}/current-sha" 2>/dev/null || true)

if [ "${target_sha}" = "${current_sha}" ]; then
  exit 0
fi

check_runs=$(gh api "repos/${repo_slug}/commits/${target_sha}/check-runs?per_page=100")
check_ready() {
  required_check=$1
  check_state=$(
    printf '%s' "${check_runs}" |
      jq -r --arg name "${required_check}" \
        '[.check_runs[] | select(.name == $name)] | sort_by(.started_at) |
         if length == 0 then "missing" else
           (last | (.status + ":" + (.conclusion // "")))
         end'
  )
  if [ "${check_state}" != "completed:success" ]; then
    echo "Waiting for ${required_check} on ${target_sha}: ${check_state}"
    return 1
  fi
}

for required_check in ${required_checks}; do
  check_ready "${required_check}" || exit 0
done
check_ready "Cloudflare Pages" || exit 0

deployment_id=$(
  jq -n --arg ref "${target_sha}" \
    '{ref:$ref,environment:"production",auto_merge:false,required_contexts:[]}' |
    gh api --method POST "repos/${repo_slug}/deployments" --input - --jq '.id' 2>/dev/null ||
    true
)

set_deployment_status() {
  state=$1
  description=$2
  if [ -n "${deployment_id}" ]; then
    jq -n --arg state "${state}" --arg description "${description}" \
      '{state:$state,description:$description,environment_url:"https://zerp.bytesucceed.com"}' |
      gh api --method POST \
        "repos/${repo_slug}/deployments/${deployment_id}/statuses" \
        --input - >/dev/null 2>&1 || true
  fi
}

if [ -n "${current_sha}" ] &&
   git -C "${repository_root}" merge-base --is-ancestor "${current_sha}" "${target_sha}"; then
  changed_files=$(git -C "${repository_root}" diff --name-only "${current_sha}..${target_sha}")
  application_change=false
  for changed_file in ${changed_files}; do
    case "${changed_file}" in
      AGENTS.md | README.md | docs/* | *.md | .github/*)
        ;;
      *)
        application_change=true
        break
        ;;
    esac
  done

  if [ "${application_change}" = "false" ]; then
    printf '%s\n' "${target_sha}" > "${runtime_root}/current-sha.new"
    mv "${runtime_root}/current-sha.new" "${runtime_root}/current-sha"
    set_deployment_status success "No application changes"
    echo "Production no-op for documentation-only commit ${target_sha}"
    exit 0
  fi
fi

set_deployment_status in_progress "Deploying ${target_sha}"
git -C "${repository_root}" worktree add --detach "${source_root}" "${target_sha}"

if ZERP_PRODUCTION_STATE_ROOT="${ZERP_PRODUCTION_STATE_ROOT:-/Users/hansonyu/code/zerp}" \
   ZERP_PRODUCTION_RUNTIME_ROOT="${runtime_root}" \
   "${source_root}/scripts/production-deploy.sh" "${target_sha}"; then
  set_deployment_status success "Deployed ${target_sha}"
else
  set_deployment_status failure "Deployment failed for ${target_sha}"
  exit 1
fi
