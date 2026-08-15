#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "${common_git_dir}")
runtime_root=${ZERP_ISSUE_CODEX_RUNTIME_ROOT:-${primary_root}/backend/var/issue-codex}
implementer_root=${ZERP_IMPLEMENTER_APP_CREDENTIAL_ROOT:-${HOME}/.secrets/zerp-issue-implementer}
reviewer_root=${ZERP_REVIEWER_APP_CREDENTIAL_ROOT:-${HOME}/.secrets/zerp-issue-reviewer}
repo=${ZERP_GITHUB_REPOSITORY:-hansonyu183/zerp}
repo_owner=${repo%%/*}
repo_name=${repo#*/}
label=com.hansonyu.zerp-issue-codex
launch_agent="${HOME}/Library/LaunchAgents/${label}.plist"
controller="${runtime_root}/issue-codex-watch.sh"
automation_helper="${runtime_root}/issue-automation.sh"
app_token="${runtime_root}/github-app-token.sh"

[ "$(codex login status 2>/dev/null || true)" = 'Logged in using ChatGPT' ] || {
  echo 'Codex must be logged in with ChatGPT before installing the Issue agent' >&2
  exit 1
}
for root in "${implementer_root}" "${reviewer_root}"; do
  for credential in app-id private-key.pem bot-login; do
    [ -r "${root}/${credential}" ] || {
      echo "Missing GitHub App credential: ${root}/${credential}" >&2
      exit 1
    }
  done
  chmod 600 "${root}/app-id" "${root}/private-key.pem" "${root}/bot-login"
done

if [ "${ZERP_ISSUE_CODEX_INSTALL_SKIP_APP_CHECK:-0}" != 1 ]; then
  for root in "${implementer_root}" "${reviewer_root}"; do
    app_id=$(sed -n '1p' "${root}/app-id")
    token=$("${repo_root}/scripts/github-app-token.sh" "${app_id}" "${root}/private-key.pem" "${repo_owner}" "${repo_name}")
    repositories=$(GH_TOKEN="${token}" gh api installation/repositories)
    printf '%s' "${repositories}" | jq -e --arg repo "${repo}" \
      '.total_count == 1 and ([.repositories[].full_name] == [$repo])' >/dev/null || {
        echo "GitHub App must be installed only on ${repo}: ${root}" >&2
        exit 1
      }
  done
fi

mkdir -p "${runtime_root}" "${HOME}/Library/LaunchAgents"
chmod 700 "${runtime_root}"
cp "${repo_root}/scripts/issue-codex-watch.sh" "${controller}.new"
cp "${repo_root}/scripts/issue-automation.sh" "${automation_helper}.new"
cp "${repo_root}/scripts/github-app-token.sh" "${app_token}.new"
chmod 700 "${controller}.new" "${automation_helper}.new" "${app_token}.new"
mv "${controller}.new" "${controller}"
mv "${automation_helper}.new" "${automation_helper}"
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
    <key>ZERP_ISSUE_CODEX_RUNTIME_ROOT</key>
    <string>${runtime_root}</string>
    <key>ZERP_ISSUE_AUTOMATION_HELPER</key>
    <string>${automation_helper}</string>
    <key>ZERP_IMPLEMENTER_APP_CREDENTIAL_ROOT</key>
    <string>${implementer_root}</string>
    <key>ZERP_REVIEWER_APP_CREDENTIAL_ROOT</key>
    <string>${reviewer_root}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${runtime_root}/agent.log</string>
  <key>StandardErrorPath</key>
  <string>${runtime_root}/agent.log</string>
</dict>
</plist>
EOF

plutil -lint "${launch_agent}" >/dev/null
if [ "${ZERP_ISSUE_CODEX_INSTALL_DRY_RUN:-0}" = 1 ]; then
  echo "Issue Codex agent dry run passed: ${label}"
  exit 0
fi
launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${launch_agent}"
launchctl kickstart "gui/$(id -u)/${label}"
echo "Issue Codex agent installed: ${label}"
