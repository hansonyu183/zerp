#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
state_root=$(dirname "${common_git_dir}")
runtime_root="${state_root}/backend/var/preview-agent"
label=com.hansonyu.zerp-preview-deploy
launch_agent="${HOME}/Library/LaunchAgents/${label}.plist"

case "${runtime_root}" in
  "${state_root}/backend/var/preview-agent")
    ;;
  *)
    echo "Unsafe preview agent runtime path: ${runtime_root}" >&2
    exit 1
    ;;
esac

launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
rm -f "${launch_agent}"
if [ -d "${runtime_root}" ]; then
  rm -rf "${runtime_root}"
fi

echo "Legacy preview deploy agent removed: ${label}"
