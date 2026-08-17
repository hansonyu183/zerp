#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-local-install-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM

file_mode() {
  case "$(uname -s)" in
    Darwin) stat -f '%Lp' "$1" ;;
    *) stat -c '%a' "$1" ;;
  esac
}

mkdir -p "${tmp}/bin" "${tmp}/home" "${tmp}/primary/backend/var"
git -C "${tmp}/primary" init -q
for skill in implement tdd code-review; do mkdir -p "${tmp}/skills/${skill}"; printf 'test\n' >"${tmp}/skills/${skill}/SKILL.md"; done

cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
[ "$*" = 'login status' ] || exit 2
printf 'Logged in using ChatGPT\n' >&2
MOCK
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
[ "$*" = 'auth status' ]
MOCK
cat >"${tmp}/bin/plutil" <<'MOCK'
#!/bin/sh
[ "$1" = -lint ] && [ -r "$2" ]
python3 -c 'import plistlib, sys; plistlib.load(open(sys.argv[1], "rb"))' "$2"
MOCK
chmod +x "${tmp}/bin/codex" "${tmp}/bin/gh" "${tmp}/bin/plutil"
PATH="${tmp}/bin:${PATH}"
export PATH

message_recipient="test@example.invalid"
HOME="${tmp}/home" \
  ZERP_PRIMARY_ROOT="${tmp}/primary" \
  ZERP_SKILL_ROOT="${tmp}/skills" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_TRACKER_ROOT="${tmp}/primary/.scratch" \
  ZERP_ISSUE_MESSAGE_RECIPIENT="${message_recipient}" \
  ZERP_ISSUE_LOCAL_INSTALL_DRY_RUN=1 \
  "${repo_root}/scripts/install-issue-local-agent.sh" >"${tmp}/stdout"

plist="${tmp}/home/Library/LaunchAgents/com.hansonyu.zerp-issue-local.plist"
notification_plist="${tmp}/home/Library/LaunchAgents/com.hansonyu.zerp-issue-local-notifications.plist"
grep -Fq 'dry run passed' "${tmp}/stdout"
plutil -lint "${plist}" >/dev/null
plutil -lint "${notification_plist}" >/dev/null
grep -Fq '<key>WatchPaths</key>' "${plist}"
if grep -Fq '<key>StartInterval</key>' "${plist}"; then
  echo 'local Issue agent polls instead of watching the tracker' >&2
  exit 1
fi
grep -Fq '<key>WatchPaths</key>' "${notification_plist}"
grep -Fq '<key>StartInterval</key><integer>60</integer>' "${notification_plist}"
grep -Fq "${tmp}/runtime/notifications/pending" "${notification_plist}"
for installed in issue-local.sh issue-local-preview.sh issue-local-production.sh \
  issue-local-notify.sh runtime-fingerprint.sh; do test -x "${tmp}/runtime/${installed}"; done
test -r "${tmp}/runtime/local-implementation-output.json"
test ! -x "${tmp}/runtime/local-implementation-output.json"
test -d "${tmp}/primary/.scratch"
test -d "${tmp}/runtime/notifications/pending"
test "$(file_mode "${tmp}/runtime/notifications/pending")" = 700
test "$(cat "${tmp}/runtime/message-recipient")" = "${message_recipient}"
test "$(file_mode "${tmp}/runtime/message-recipient")" = 600
if grep -Fq 'ZERP_ISSUE_MESSAGE_RECIPIENT' "${plist}"; then
  echo 'message recipient was duplicated into the LaunchAgent plist' >&2
  exit 1
fi
grep -Fq '<key>ZERP_ISSUE_NOTIFICATION_COMMAND</key>' "${plist}"
grep -Fq "${tmp}/runtime/issue-local-notify.sh" "${plist}"
if grep -Fq 'ZERP_ISSUE_MESSAGE_RECIPIENT' "${notification_plist}"; then
  echo 'message recipient was duplicated into the notification LaunchAgent plist' >&2
  exit 1
fi
HOME="${tmp}/home" \
  ZERP_PRIMARY_ROOT="${tmp}/primary" ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_TRACKER_ROOT="${tmp}/primary/.scratch" \
  "${tmp}/runtime/issue-local.sh" status >/dev/null
HOME="${tmp}/home" \
  ZERP_PRIMARY_ROOT="${tmp}/primary" \
  ZERP_SKILL_ROOT="${tmp}/skills" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_TRACKER_ROOT="${tmp}/primary/.scratch" \
  ZERP_ISSUE_LOCAL_INSTALL_DRY_RUN=1 \
  "${repo_root}/scripts/install-issue-local-agent.sh" >/dev/null
test "$(cat "${tmp}/runtime/message-recipient")" = "${message_recipient}"
if HOME="${tmp}/home" \
  ZERP_PRIMARY_ROOT="${tmp}/primary" \
  ZERP_SKILL_ROOT="${tmp}/skills" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${tmp}/invalid-runtime" \
  ZERP_ISSUE_TRACKER_ROOT="${tmp}/primary/.scratch" \
  ZERP_ISSUE_MESSAGE_RECIPIENT="$(printf 'bad\nrecipient')" \
  ZERP_ISSUE_LOCAL_INSTALL_DRY_RUN=1 \
  "${repo_root}/scripts/install-issue-local-agent.sh" >"${tmp}/invalid-stdout" 2>"${tmp}/invalid-stderr"; then
  echo 'installer accepted an invalid iMessage recipient' >&2
  exit 1
fi
grep -Fq 'must be non-empty and contain no control characters' "${tmp}/invalid-stderr"
if HOME="${tmp}/home" \
  ZERP_PRIMARY_ROOT="${tmp}/primary" \
  ZERP_SKILL_ROOT="${tmp}/skills" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${tmp}/empty-runtime" \
  ZERP_ISSUE_TRACKER_ROOT="${tmp}/primary/.scratch" \
  ZERP_ISSUE_MESSAGE_RECIPIENT='' \
  ZERP_ISSUE_LOCAL_INSTALL_DRY_RUN=1 \
  "${repo_root}/scripts/install-issue-local-agent.sh" >/dev/null 2>"${tmp}/empty-stderr"; then
  echo 'installer accepted an empty iMessage recipient' >&2
  exit 1
fi
grep -Fq 'must be non-empty and contain no control characters' "${tmp}/empty-stderr"
if find "${tmp}" -type f \( -name auth.json -o -name '*.token' -o -name private-key.pem \) | grep -q .; then
  echo 'authentication material was copied by the installer' >&2
  exit 1
fi

echo 'Local Issue installer tests passed'
