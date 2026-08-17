#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
primary_root=${ZERP_PRIMARY_ROOT:-$(dirname "${common_git_dir}")}
runtime_root=${ZERP_ISSUE_LOCAL_RUNTIME_ROOT:-${primary_root}/backend/var/issue-delivery}
tracker_root=${ZERP_ISSUE_TRACKER_ROOT:-${primary_root}/.scratch}
skill_root=${ZERP_SKILL_ROOT:-${CODEX_HOME:-${HOME}/.codex}/skills}
label=com.hansonyu.zerp-issue-local
notification_label=com.hansonyu.zerp-issue-local-notifications
launch_agent="${HOME}/Library/LaunchAgents/${label}.plist"
notification_launch_agent="${HOME}/Library/LaunchAgents/${notification_label}.plist"
controller="${runtime_root}/issue-local.sh"
notification_controller="${runtime_root}/issue-local-notify.sh"
preview="${runtime_root}/issue-local-preview.sh"
production="${runtime_root}/issue-local-production.sh"
fingerprint="${runtime_root}/runtime-fingerprint.sh"
schema="${runtime_root}/local-implementation-output.json"
message_recipient_file="${runtime_root}/message-recipient"

valid_message_recipient() {
  [ -n "${1:-}" ] || return 1
  case "$1" in *'
'*) return 1 ;; esac
  ! printf '%s' "$1" | LC_ALL=C grep -q '[[:cntrl:]]'
}

[ "$(codex login status 2>&1 || true)" = 'Logged in using ChatGPT' ] || {
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

mkdir -p "${runtime_root}" "${runtime_root}/notifications/pending" \
  "${runtime_root}/notifications/delivered" "${runtime_root}/notifications/superseded" \
  "${tracker_root}" "${HOME}/Library/LaunchAgents"
chmod 700 "${runtime_root}" "${tracker_root}"
chmod 700 "${runtime_root}/notifications" "${runtime_root}/notifications/pending" \
  "${runtime_root}/notifications/delivered" "${runtime_root}/notifications/superseded"
if [ "${ZERP_ISSUE_MESSAGE_RECIPIENT+x}" = x ]; then
  message_recipient=${ZERP_ISSUE_MESSAGE_RECIPIENT}
elif [ -r "${message_recipient_file}" ]; then
  message_recipient=$(cat "${message_recipient_file}")
else
  echo 'ZERP_ISSUE_MESSAGE_RECIPIENT is required for the first local Issue agent installation' >&2
  exit 1
fi
valid_message_recipient "${message_recipient}" || {
  echo 'ZERP_ISSUE_MESSAGE_RECIPIENT must be non-empty and contain no control characters' >&2
  exit 1
}
printf '%s\n' "${message_recipient}" >"${message_recipient_file}.new"
chmod 600 "${message_recipient_file}.new"
mv "${message_recipient_file}.new" "${message_recipient_file}"
for mapping in \
  "scripts/issue-local.sh:${controller}" \
  "scripts/issue-local-notify.sh:${notification_controller}" \
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
    <key>ZERP_ISSUE_NOTIFICATION_COMMAND</key><string>${notification_controller}</string>
  </dict>
  <key>StandardOutPath</key><string>${runtime_root}/agent.log</string>
  <key>StandardErrorPath</key><string>${runtime_root}/agent.log</string>
</dict>
</plist>
EOF
chmod 600 "${launch_agent}"
plutil -lint "${launch_agent}" >/dev/null

cat >"${notification_launch_agent}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${notification_label}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>${notification_controller}</string><string>drain</string></array>
  <key>RunAtLoad</key><true/>
  <key>WatchPaths</key><array><string>${runtime_root}/notifications/pending</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${HOME}</string>
    <key>PATH</key><string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>ZERP_ISSUE_LOCAL_RUNTIME_ROOT</key><string>${runtime_root}</string>
  </dict>
  <key>StandardOutPath</key><string>${runtime_root}/notification-agent.log</string>
  <key>StandardErrorPath</key><string>${runtime_root}/notification-agent.log</string>
</dict>
</plist>
EOF
chmod 600 "${notification_launch_agent}"
plutil -lint "${notification_launch_agent}" >/dev/null

if [ "${ZERP_ISSUE_LOCAL_INSTALL_DRY_RUN:-0}" = 1 ]; then
  echo "Local Issue agent dry run passed: ${label}"
  exit 0
fi
for installed_label in "${label}" "${notification_label}"; do
  launchctl bootout "gui/$(id -u)/${installed_label}" >/dev/null 2>&1 || true
done
launchctl bootstrap "gui/$(id -u)" "${notification_launch_agent}"
launchctl bootstrap "gui/$(id -u)" "${launch_agent}"
launchctl kickstart "gui/$(id -u)/${notification_label}"
launchctl kickstart "gui/$(id -u)/${label}"
echo "Local Issue agents installed: ${label}, ${notification_label}"
