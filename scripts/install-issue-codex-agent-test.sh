#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-issue-codex-install-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM
mkdir -p "${tmp}/bin" "${tmp}/home/.secrets/zerp-issue-implementer" \
  "${tmp}/home/.secrets/zerp-issue-reviewer"

cat >"${tmp}/bin/codex" <<'MOCK'
#!/bin/sh
[ "$*" = 'login status' ] || exit 2
printf 'Logged in using ChatGPT\n'
MOCK
chmod +x "${tmp}/bin/codex"
for root in "${tmp}/home/.secrets/zerp-issue-implementer" \
  "${tmp}/home/.secrets/zerp-issue-reviewer"; do
  printf '123\n' >"${root}/app-id"
  printf 'test-key\n' >"${root}/private-key.pem"
  printf 'test-app[bot]\n' >"${root}/bot-login"
done

HOME="${tmp}/home" PATH="${tmp}/bin:${PATH}" \
  ZERP_ISSUE_CODEX_RUNTIME_ROOT="${tmp}/runtime" \
  ZERP_ISSUE_CODEX_INSTALL_SKIP_APP_CHECK=1 \
  ZERP_ISSUE_CODEX_INSTALL_DRY_RUN=1 \
  "${repo_root}/scripts/install-issue-codex-agent.sh" >"${tmp}/stdout"

grep -Fq 'dry run passed' "${tmp}/stdout"
plutil -lint "${tmp}/home/Library/LaunchAgents/com.hansonyu.zerp-issue-codex.plist" >/dev/null
test -x "${tmp}/runtime/issue-codex-watch.sh"
test -x "${tmp}/runtime/issue-automation.sh"
test -x "${tmp}/runtime/github-app-token.sh"
if find "${tmp}" -type f \( -name auth.json -o -name '*.token' \) | grep -q .; then
  echo 'Codex authentication material was copied by the installer' >&2
  exit 1
fi
if grep -R -Fq 'test-key' "${tmp}/runtime" "${tmp}/home/Library/LaunchAgents"; then
  echo 'GitHub App private key leaked into installed controller files' >&2
  exit 1
fi

echo 'Issue Codex installer tests passed'
