#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-local-preview-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM
control="${tmp}/control"
worktree="${tmp}/worktree"
events="${tmp}/events"
mkdir -p "${control}/scripts" "${worktree}"
git -C "${worktree}" init -q
git -C "${worktree}" config user.name test
git -C "${worktree}" config user.email test@example.invalid
printf 'test\n' >"${worktree}/README.md"
git -C "${worktree}" add README.md
git -C "${worktree}" commit -qm test
head=$(git -C "${worktree}" rev-parse HEAD)

cat >"${control}/scripts/preview-state.sh" <<'MOCK'
#!/bin/sh
set -eu
[ "${ZERP_PREVIEW_OFFLINE:-0}" = 1 ] || [ "$1" = fail ]
printf '%s:%s\n' "$1" "${PREVIEW_PR}" >>"${MOCK_EVENTS}"
MOCK
cat >"${control}/scripts/preview.sh" <<'MOCK'
#!/bin/sh
set -eu
printf '%s:%s\n' "$1" "${PREVIEW_PR:-}" >>"${MOCK_EVENTS}"
MOCK
cat >"${control}/scripts/preview-smoke.sh" <<'MOCK'
#!/bin/sh
set -eu
printf 'smoke:%s\n' "$1" >>"${MOCK_EVENTS}"
MOCK
chmod +x "${control}/scripts/"*.sh
export MOCK_EVENTS="${events}"

ZERP_PRIMARY_ROOT="${control}" ZERP_ISSUE_WORKTREE="${worktree}" \
  "${repo_root}/scripts/issue-local-preview.sh" inventory-query "${head}" >"${tmp}/preview.env"
ZERP_PRIMARY_ROOT="${control}" \
  "${repo_root}/scripts/issue-local-preview.sh" close inventory-query

claim_id=$(sed -n 's/^claim://p' "${events}")
close_id=$(sed -n 's/^close://p' "${events}")
[ -n "${claim_id}" ] && [ "${claim_id}" = "${close_id}" ] || {
  echo 'preview deployment and close used different slot IDs' >&2
  exit 1
}
grep -Fq 'url=https://zerp-preview.bytesucceed.com' "${tmp}/preview.env"
grep -Eq '^fingerprint=[0-9a-f]{64}$' "${tmp}/preview.env"

echo 'Local Issue preview tests passed'
