#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
default_state_root=$(dirname "${common_git_dir}")
state_root=${ZERP_PRODUCTION_STATE_ROOT:-${default_state_root}}
runtime_root=${ZERP_PRODUCTION_RUNTIME_ROOT:-${state_root}/backend/var/production}
env_file=${ZERP_PRODUCTION_ENV_FILE:-${state_root}/backend/.env.production.local}
label=com.hansonyu.zerp-production-deploy
launch_agent="${HOME}/Library/LaunchAgents/${label}.plist"
controller="${runtime_root}/production-watch.sh"

test -f "${env_file}" || {
  echo "Missing production environment: ${env_file}" >&2
  exit 1
}
test -r "${HOME}/.secrets/cloudflare/account_id_bytesucceed" || {
  echo "Missing Cloudflare account ID" >&2
  exit 1
}
test -r "${HOME}/.secrets/cloudflare/api_token_pages_deploy" || {
  echo "Missing Cloudflare Pages deployment token" >&2
  exit 1
}

chmod 600 "${env_file}" \
  "${HOME}/.secrets/cloudflare/account_id_bytesucceed" \
  "${HOME}/.secrets/cloudflare/api_token_pages_deploy"
mkdir -p "${runtime_root}" "${HOME}/Library/LaunchAgents"
chmod 700 "${runtime_root}"
cp "${repo_root}/scripts/production-watch.sh" "${controller}"
chmod 700 "${controller}"

cat > "${launch_agent}" <<EOF
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
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>ZERP_PRODUCTION_STATE_ROOT</key>
    <string>${state_root}</string>
    <key>ZERP_PRODUCTION_RUNTIME_ROOT</key>
    <string>${runtime_root}</string>
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

echo "Production deploy agent installed: ${label}"
