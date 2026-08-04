#!/bin/sh
set -eu

repo_slug=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
state_root=${ZERP_PREVIEW_STATE_ROOT:-/Users/hansonyu/code/zerp}
runtime_root=${ZERP_PREVIEW_AGENT_RUNTIME_ROOT:-${state_root}/backend/var/preview-agent}
native_runtime=${ZERP_PREVIEW_RUNTIME_ROOT:-${state_root}/backend/var/preview-native}
repository_root="${runtime_root}/repository"
source_root="${runtime_root}/source"
controller="${runtime_root}/preview-watch.sh"
lock_dir="${runtime_root}/agent.lock"
required_checks="contracts frontend backend containers e2e full-validation"

mkdir -p "${runtime_root}"
chmod 700 "${runtime_root}"

if ! mkdir "${lock_dir}" 2>/dev/null; then
  lock_pid=$(cat "${lock_dir}/pid" 2>/dev/null || true)
  if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
    exit 0
  fi
  rm -f "${lock_dir}/pid"
  rmdir "${lock_dir}" >/dev/null 2>&1 || exit 0
  mkdir "${lock_dir}" 2>/dev/null || exit 0
fi
printf '%s\n' "$$" >"${lock_dir}/pid"

cleanup() {
  git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
  git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
  rm -f "${lock_dir}/pid"
  rmdir "${lock_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -d "${repository_root}/.git" ]; then
  git clone --filter=blob:none "https://github.com/${repo_slug}.git" "${repository_root}"
fi

git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
git -C "${repository_root}" fetch origin dev --prune
target_sha=$(git -C "${repository_root}" rev-parse origin/dev)
current_sha=$(cat "${native_runtime}/native-ready" 2>/dev/null || true)
processed_sha=$(cat "${runtime_root}/processed-sha" 2>/dev/null || true)
failed_sha=$(cat "${runtime_root}/failed-sha" 2>/dev/null || true)

mark_processed() {
  printf '%s\n' "$1" >"${runtime_root}/processed-sha.new"
  mv "${runtime_root}/processed-sha.new" "${runtime_root}/processed-sha"
}

mark_failed() {
  printf '%s\n' "$1" >"${runtime_root}/failed-sha.new"
  mv "${runtime_root}/failed-sha.new" "${runtime_root}/failed-sha"
}

clear_failed() {
  rm -f "${runtime_root}/failed-sha" "${runtime_root}/failed-sha.new"
}

refresh_controller() {
  candidate="${controller}.new"
  if cp "${source_root}/scripts/preview-watch.sh" "${candidate}" &&
    sh -n "${candidate}" && chmod 700 "${candidate}" &&
    mv "${candidate}" "${controller}"; then
    echo "Preview deploy controller updated"
  else
    rm -f "${candidate}"
    echo "Warning: preview deploy controller update failed" >&2
  fi
}

if [ "${target_sha}" = "${processed_sha}" ] || [ "${target_sha}" = "${failed_sha}" ]; then
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
  if [ "${check_state}" != completed:success ]; then
    echo "Waiting for ${required_check} on dev ${target_sha}: ${check_state}"
    return 1
  fi
}

for required_check in ${required_checks}; do
  check_ready "${required_check}" || exit 0
done

deployment_id=$(
  jq -n --arg ref "${target_sha}" \
    '{ref:$ref,environment:"preview",auto_merge:false,required_contexts:[]}' |
    gh api --method POST "repos/${repo_slug}/deployments" --input - --jq '.id' 2>/dev/null || true
)

set_deployment_status() {
  state=$1
  description=$2
  if [ -n "${deployment_id}" ]; then
    jq -n --arg state "${state}" --arg description "${description}" \
      '{state:$state,description:$description,environment_url:"https://zerp-preview.bytesucceed.com"}' |
      gh api --method POST \
        "repos/${repo_slug}/deployments/${deployment_id}/statuses" \
        --input - >/dev/null 2>&1 || true
  fi
}

git -C "${repository_root}" worktree add --detach "${source_root}" "${target_sha}"

case "${current_sha}" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*)
    if git -C "${repository_root}" cat-file -e "${current_sha}^{commit}" 2>/dev/null &&
      git -C "${repository_root}" merge-base --is-ancestor "${current_sha}" "${target_sha}"; then
      changed_files=$(git -C "${repository_root}" diff --name-only "${current_sha}..${target_sha}")
      impact=$(printf '%s\n' "${changed_files}" | "${source_root}/scripts/change-impact.sh" --paths)
      if [ "${impact}" != application ]; then
        mark_processed "${target_sha}"
        clear_failed
        refresh_controller
        set_deployment_status success "No preview application changes (${impact})"
        echo "Preview no-op for ${impact} dev commit ${target_sha}"
        exit 0
      fi
    fi
    ;;
esac

set_deployment_status in_progress "Deploying dev ${target_sha}"
if ZERP_PREVIEW_STATE_ROOT="${state_root}" \
  ZERP_PREVIEW_RUNTIME_ROOT="${native_runtime}" \
  "${source_root}/scripts/preview-deploy.sh" "${target_sha}"; then
  mark_processed "${target_sha}"
  clear_failed
  refresh_controller
  set_deployment_status success "Deployed dev ${target_sha}"
else
  mark_failed "${target_sha}"
  set_deployment_status failure "Preview deployment failed for dev ${target_sha}"
  exit 1
fi
