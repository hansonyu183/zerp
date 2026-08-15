#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-local-install-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "${tmp}/bin" "${tmp}/home" "${tmp}/primary/backend/var"
git -C "${tmp}/primary" init -q
for skill in implement tdd code-review; do mkdir -p "${tmp}/skills/${skill}"; printf 'test\n' >"${tmp}/skills/${skill}/SKILL.md"; done

cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
[ "$*" = 'login status' ] || exit 2
printf 'Logged in using ChatGPT\n'
MOCK
cat >"${tmp}/bin/gh" <<'MOCK'
#!/bin/sh
[ "$*" = 'auth status' ]
MOCK
chmod +x "${tmp}/bin/codex" "${tmp}/bin/gh"

HOME="${tmp}/home" PATH="${tmp}/bin:${PATH}" \
  ZERP_PRIMARY_ROOT="${tmp}/primary" \
  ZERP_SKILL_ROOT="${tmp}/skills" \
  ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_TRACKER_ROOT="${tmp}/primary/.scratch" \
  ZERP_ISSUE_LOCAL_INSTALL_DRY_RUN=1 \
  "${repo_root}/scripts/install-issue-local-agent.sh" >"${tmp}/stdout"

plist="${tmp}/home/Library/LaunchAgents/com.hansonyu.zerp-issue-local.plist"
grep -Fq 'dry run passed' "${tmp}/stdout"
plutil -lint "${plist}" >/dev/null
grep -Fq '<key>WatchPaths</key>' "${plist}"
if grep -Fq '<key>StartInterval</key>' "${plist}"; then
  echo 'local Issue agent polls instead of watching the tracker' >&2
  exit 1
fi
for installed in issue-local.sh issue-local-preview.sh issue-local-production.sh \
  runtime-fingerprint.sh; do test -x "${tmp}/runtime/${installed}"; done
test -r "${tmp}/runtime/local-implementation-output.json"
test ! -x "${tmp}/runtime/local-implementation-output.json"
test -d "${tmp}/primary/.scratch"
HOME="${tmp}/home" PATH="${tmp}/bin:${PATH}" \
  ZERP_PRIMARY_ROOT="${tmp}/primary" ZERP_ISSUE_LOCAL_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_TRACKER_ROOT="${tmp}/primary/.scratch" \
  "${tmp}/runtime/issue-local.sh" status >/dev/null
if find "${tmp}" -type f \( -name auth.json -o -name '*.token' -o -name private-key.pem \) | grep -q .; then
  echo 'authentication material was copied by the installer' >&2
  exit 1
fi

echo 'Local Issue installer tests passed'
