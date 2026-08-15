#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
primary_root=${ZERP_PRIMARY_ROOT:-$(dirname "${common_git_dir}")}
runtime_root=${ZERP_ISSUE_LOCAL_RUNTIME_ROOT:-${primary_root}/backend/var/issue-delivery}
tracker_root=${ZERP_ISSUE_TRACKER_ROOT:-${primary_root}/.scratch}
skill_root=${ZERP_SKILL_ROOT:-${CODEX_HOME:-${HOME}/.codex}/skills}
label=com.hansonyu.zerp-issue-local
launch_agent="${HOME}/Library/LaunchAgents/${label}.plist"
controller="${runtime_root}/issue-local.sh"
preview="${runtime_root}/issue-local-preview.sh"
production="${runtime_root}/issue-local-production.sh"
fingerprint="${runtime_root}/runtime-fingerprint.sh"
schema="${runtime_root}/local-implementation-output.json"

[ "$(codex login status 2>/dev/null || true)" = 'Logged in using ChatGPT' ] || {
  echo 'Codex must be logged in with ChatGPT before installing the local Issue agent' >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  echo 'GitHub CLI must be authenticated before installing the local Issue agent' >&2
  exit 1
}
for skill in implement tdd code-review; do
  [ -r "${skill_root}/${skill}/SKILL.md" ] || {
    echo "Required Codex skill is missing: ${skill}" >&2
    exit 1
  }
done

mkdir -p "${runtime_root}" "${tracker_root}" "${HOME}/Library/LaunchAgents"
chmod 700 "${runtime_root}" "${tracker_root}"
for mapping in \
  "scripts/issue-local.sh:${controller}" \
  "scripts/issue-local-preview.sh:${preview}" \
  "scripts/issue-local-production.sh:${production}" \
  "scripts/runtime-fingerprint.sh:${fingerprint}"; do
  source=${mapping%%:*}
  destination=${mapping#*:}
  cp "${repo_root}/${source}" "${destination}.new"
  chmod 700 "${destination}.new"
  mv "${destination}.new" "${destination}"
done
cp "${repo_root}/.github/automation/schemas/local-implementation-output.json" "${schema}.new"
chmod 600 "${schema}.new"
mv "${schema}.new" "${schema}"

cat >"${launch_agent}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>${controller}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>WatchPaths</key><array><string>${tracker_root}</string></array>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${HOME}</string>
    <key>PATH</key><string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>ZERP_PRIMARY_ROOT</key><string>${primary_root}</string>
    <key>ZERP_ISSUE_TRACKER_ROOT</key><string>${tracker_root}</string>
    <key>ZERP_ISSUE_LOCAL_RUNTIME_ROOT</key><string>${runtime_root}</string>
    <key>ZERP_ISSUE_RESULT_SCHEMA</key><string>${schema}</string>
    <key>ZERP_ISSUE_PREVIEW_COMMAND</key><string>${preview}</string>
    <key>ZERP_ISSUE_PREVIEW_CLOSE_COMMAND</key><string>${preview}</string>
    <key>ZERP_ISSUE_PRODUCTION_COMMAND</key><string>${production}</string>
  </dict>
  <key>StandardOutPath</key><string>${runtime_root}/agent.log</string>
  <key>StandardErrorPath</key><string>${runtime_root}/agent.log</string>
</dict>
</plist>
EOF
chmod 600 "${launch_agent}"
plutil -lint "${launch_agent}" >/dev/null

if [ "${ZERP_ISSUE_LOCAL_INSTALL_DRY_RUN:-0}" = 1 ]; then
  echo "Local Issue agent dry run passed: ${label}"
  exit 0
fi
launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${launch_agent}"
launchctl kickstart "gui/$(id -u)/${label}"
echo "Local Issue agent installed: ${label}"
