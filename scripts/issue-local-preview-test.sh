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
printf '%s:%s\n' "$1" "${PREVIEW_PR}" >>"${MOCK_EVENTS}"
printf 'state-%s stdout\n' "$1"
printf 'state-%s stderr\n' "$1" >&2
case "$1" in
  claim)
    if [ "${MOCK_CLAIM_SLEEP:-0}" = 1 ]; then sleep 2; fi
    if [ "${MOCK_CLAIM_FAIL:-0}" = 1 ]; then exit 1; fi
    printf '%s\n' "${PREVIEW_PR}" >"${MOCK_ACTIVE}"
    ;;
  status)
    printf 'current=test\nactive=%s\nlock=%s\n' \
      "$(cat "${MOCK_ACTIVE}" 2>/dev/null || true)" \
      "$(cat "${MOCK_ACTIVE}" 2>/dev/null || true)"
    ;;
  fail) ;;
  *) [ "${ZERP_PREVIEW_OFFLINE:-0}" = 1 ] ;;
esac
MOCK
cat >"${control}/scripts/preview.sh" <<'MOCK'
#!/bin/sh
set -eu
printf '%s:%s\n' "$1" "${PREVIEW_PR:-}" >>"${MOCK_EVENTS}"
printf 'preview-%s stdout\n' "$1"
printf 'preview-%s stderr\n' "$1" >&2
if [ "$1" = prepare-db ] && [ "${MOCK_PREVIEW_PREPARE_FAIL:-0}" = 1 ]; then
  exit 1
fi
if [ "$1" = activate ] && [ "${MOCK_ACTIVATE_FAIL:-0}" = 1 ]; then
  exit 1
fi
MOCK
cat >"${control}/scripts/preview-smoke.sh" <<'MOCK'
#!/bin/sh
set -eu
printf 'smoke:%s\n' "$1" >>"${MOCK_EVENTS}"
MOCK
chmod +x "${control}/scripts/"*.sh
export MOCK_EVENTS="${events}"
export MOCK_ACTIVE="${tmp}/active"

ZERP_PRIMARY_ROOT="${control}" ZERP_ISSUE_WORKTREE="${worktree}" \
  "${repo_root}/scripts/issue-local-preview.sh" inventory-query "${head}" \
  >"${tmp}/preview.env" 2>"${tmp}/preview.log"
prepare_line=$(grep -n '^prepare-db:' "${events}" | sed -n '1s/:.*//p')
build_line=$(grep -n '^build:' "${events}" | sed -n '1s/:.*//p')
stop_line=$(grep -n '^stop-app:' "${events}" | sed -n '1s/:.*//p')
claim_line=$(grep -n '^claim:' "${events}" | sed -n '1s/:.*//p')
activate_line=$(grep -n '^activate:' "${events}" | sed -n '1s/:.*//p')
test -n "${prepare_line}" && test -n "${build_line}" && test -n "${stop_line}" && \
  test -n "${claim_line}" && test -n "${activate_line}"
test "${prepare_line}" -lt "${build_line}"
test "${build_line}" -lt "${stop_line}"
test "${stop_line}" -lt "${claim_line}"
test "${claim_line}" -lt "${activate_line}"
ZERP_PRIMARY_ROOT="${control}" \
  "${repo_root}/scripts/issue-local-preview.sh" close inventory-query
close_count=$(grep -c '^close:' "${events}")
: >"${MOCK_ACTIVE}"
ZERP_PRIMARY_ROOT="${control}" \
  "${repo_root}/scripts/issue-local-preview.sh" close inventory-query
test "$(grep -c '^close:' "${events}")" = "${close_count}"

claim_count=$(grep -c '^claim:' "${events}")
if MOCK_PREVIEW_PREPARE_FAIL=1 ZERP_PRIMARY_ROOT="${control}" \
  ZERP_ISSUE_WORKTREE="${worktree}" \
  "${repo_root}/scripts/issue-local-preview.sh" database-down "${head}" >/dev/null 2>&1; then
  echo 'preview claimed state after database preparation failed' >&2
  exit 1
fi
test "$(grep -c '^claim:' "${events}")" = "${claim_count}"

claim_id=$(sed -n 's/^claim://p' "${events}")
close_id=$(sed -n 's/^close://p' "${events}")
if [ -z "${claim_id}" ] || [ "${claim_id}" != "${close_id}" ]; then
  echo 'preview deployment and close used different slot IDs' >&2
  exit 1
fi
grep -Fq 'url=https://zerp-preview.bytesucceed.com' "${tmp}/preview.env"
grep -Eq '^fingerprint=[0-9a-f]{64}$' "${tmp}/preview.env"
test "$(wc -l <"${tmp}/preview.env" | tr -d ' ')" = 2
grep -Fq 'preview-build stdout' "${tmp}/preview.log"
grep -Fq 'preview-build stderr' "${tmp}/preview.log"
grep -Fq 'state-claim stdout' "${tmp}/preview.log"

restart_count=$(grep -c '^restart-app:' "${events}" || true)
if MOCK_CLAIM_FAIL=1 ZERP_PRIMARY_ROOT="${control}" \
  ZERP_ISSUE_WORKTREE="${worktree}" \
  "${repo_root}/scripts/issue-local-preview.sh" claim-failure "${head}" \
  >"${tmp}/claim-failure.env" 2>"${tmp}/claim-failure.log"; then
  echo 'preview accepted a failed claim' >&2
  exit 1
fi
test "$(grep -c '^restart-app:' "${events}")" -gt "${restart_count}"
grep -Fq 'state-claim stderr' "${tmp}/claim-failure.log"
grep -Fq 'preview-restart-app stdout' "${tmp}/claim-failure.log"

close_count=$(grep -c '^close:' "${events}" || true)
if MOCK_ACTIVATE_FAIL=1 ZERP_PRIMARY_ROOT="${control}" \
  ZERP_ISSUE_WORKTREE="${worktree}" \
  "${repo_root}/scripts/issue-local-preview.sh" activation-failure "${head}" \
  >"${tmp}/activation-failure.env" 2>"${tmp}/activation-failure.log"; then
  echo 'preview accepted a failed activation' >&2
  exit 1
fi
test "$(grep -c '^close:' "${events}")" -gt "${close_count}"
grep -q '^fail:' "${events}"
grep -Fq 'preview-close stdout' "${tmp}/activation-failure.log"
grep -Fq 'state-fail stderr' "${tmp}/activation-failure.log"

prior_claim_count=$(grep -c '^claim:' "${events}")
prior_close_count=$(grep -c '^close:' "${events}")
MOCK_CLAIM_SLEEP=1 ZERP_PRIMARY_ROOT="${control}" \
  ZERP_ISSUE_WORKTREE="${worktree}" \
  "${repo_root}/scripts/issue-local-preview.sh" interrupted "${head}" \
  >"${tmp}/interrupted.env" 2>"${tmp}/interrupted.log" &
interrupted_pid=$!
attempts=40
until [ "$(grep -c '^claim:' "${events}")" -gt "${prior_claim_count}" ] ||
  [ "${attempts}" -eq 0 ]; do
  sleep 0.05
  attempts=$((attempts - 1))
done
kill -TERM "${interrupted_pid}"
if wait "${interrupted_pid}"; then
  echo 'interrupted preview exited successfully' >&2
  exit 1
fi
test "$(grep -c '^close:' "${events}")" -gt "${prior_close_count}"
grep -Fq 'preview-close stderr' "${tmp}/interrupted.log"

echo 'Local Issue preview tests passed'
