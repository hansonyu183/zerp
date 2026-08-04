#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
state_root=${ZERP_PREVIEW_STATE_ROOT:-$(dirname "${common_git_dir}")}
runtime_root=${ZERP_PREVIEW_AGENT_RUNTIME_ROOT:-${state_root}/backend/var/preview-agent}
failed_file="${runtime_root}/failed-sha"
label=com.hansonyu.zerp-preview-deploy

if [ ! -f "${failed_file}" ]; then
  echo "No blocked preview release to retry"
  exit 0
fi

failed_sha=$(cat "${failed_file}")
rm -f "${failed_file}" "${runtime_root}/failed-sha.new"
launchctl kickstart -k "gui/$(id -u)/${label}"
echo "Preview retry requested for ${failed_sha}"
