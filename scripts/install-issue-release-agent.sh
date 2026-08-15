#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "${common_git_dir}")
runtime_root=${ZERP_ISSUE_RELEASE_RUNTIME_ROOT:-${primary_root}/backend/var/issue-release}
credential_root=${ZERP_RELEASE_APP_CREDENTIAL_ROOT:-${HOME}/.secrets/zerp-release-controller}
label=com.hansonyu.zerp-issue-release
launch_agent="${HOME}/Library/LaunchAgents/${label}.plist"
controller="${runtime_root}/issue-release-watch.sh"
provenance="${runtime_root}/check-run-provenance.sh"
app_token="${runtime_root}/github-app-token.sh"

for credential in app-id private-key.pem bot-login; do
  [ -r "${credential_root}/${credential}" ] || {
    echo "Missing release-controller credential: ${credential_root}/${credential}" >&2
    exit 1
  }
done
[ -r "${primary_root}/backend/.env.preview.local" ] || {
  echo "Missing preview environment: ${primary_root}/backend/.env.preview.local" >&2
  exit 1
}

chmod 600 "${credential_root}/app-id" "${credential_root}/private-key.pem" \
  "${credential_root}/bot-login" "${primary_root}/backend/.env.preview.local"
mkdir -p "${runtime_root}" "${HOME}/Library/LaunchAgents"
chmod 700 "${runtime_root}"
cp "${repo_root}/scripts/issue-release-watch.sh" "${controller}.new"
cp "${repo_root}/scripts/check-run-provenance.sh" "${provenance}.new"
cp "${repo_root}/scripts/github-app-token.sh" "${app_token}.new"
chmod 700 "${controller}.new" "${provenance}.new" "${app_token}.new"
mv "${controller}.new" "${controller}"
mv "${provenance}.new" "${provenance}"
mv "${app_token}.new" "${app_token}"

cat >"${launch_agent}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${controller}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>ZERP_PRIMARY_ROOT</key>
    <string>${primary_root}</string>
    <key>ZERP_ISSUE_RELEASE_RUNTIME_ROOT</key>
    <string>${runtime_root}</string>
    <key>ZERP_RELEASE_APP_CREDENTIAL_ROOT</key>
    <string>${credential_root}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${runtime_root}/agent.log</string>
  <key>StandardErrorPath</key>
  <string>${runtime_root}/agent.log</string>
</dict>
</plist>
EOF

plutil -lint "${launch_agent}" >/dev/null
launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${launch_agent}"
launchctl kickstart "gui/$(id -u)/${label}"
echo "Issue release agent installed: ${label}"
