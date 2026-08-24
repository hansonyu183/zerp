#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-integration-runner-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM

fixture="${tmp}/backend"
mkdir -p "${fixture}/db/migrations" \
  "${fixture}/tools" "${tmp}/bin"
for package in a b c d; do
  mkdir -p "${fixture}/internal/${package}"
  printf '//go:build integration\n' >"${fixture}/internal/${package}/${package}_test.go"
done
printf '%s\n' '-- migration' >"${fixture}/db/migrations/000001_baseline.sql"
git -C "${fixture}" init -b main >/dev/null
git -C "${fixture}" add .

cat >"${tmp}/bin/docker" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "${tmp}/bin/docker"

cat >"${tmp}/bin/go" <<'EOF'
#!/bin/sh
set -eu
if [ "${1:-}" = tool ] && [ "${2:-}" = goose ]; then
  exit 0
fi
[ "${1:-}" = test ] || exit 2
shift
package=
for argument in "$@"; do
  case "${argument}" in ./*) package=${argument#./} ;; esac
done
[ -n "${package}" ] || exit 2
printf '%s\n' "${package}" >>"${MOCK_INTEGRATION_RUNS}"
[ "${package}" != "${MOCK_INTEGRATION_FAIL_PACKAGE:-}" ] || exit 7
EOF
chmod +x "${tmp}/bin/go"

run_runner() {
  (
    cd "${fixture}"
    PATH="${tmp}/bin:${PATH}" \
      POSTGRES_USER=tester POSTGRES_PASSWORD=secret POSTGRES_PORT=5432 \
      TEST_POSTGRES_DB=runner_test TEST_POSTGRES_PORT=55434 \
      TEST_INTEGRATION_JOBS=2 MOCK_INTEGRATION_RUNS="${tmp}/runs" \
      MOCK_INTEGRATION_FAIL_PACKAGE="${MOCK_INTEGRATION_FAIL_PACKAGE:-}" \
      TEST_INTEGRATION_PACKAGES_FILE="${TEST_INTEGRATION_PACKAGES_FILE:-}" \
      TEST_INTEGRATION_RESULT_FILE="${tmp}/result.json" \
      "${script_dir}/run-integration-tests.sh"
  )
}

: >"${tmp}/runs"
export MOCK_INTEGRATION_FAIL_PACKAGE=internal/a
if run_runner; then
  echo 'integration runner accepted a failed package' >&2
  exit 1
fi
test "$(LC_ALL=C sort -u "${tmp}/runs" | wc -l | tr -d ' ')" = 4
jq -e '
  .version == 1 and .status == "failed" and (.packages | length == 4) and
  ([.packages[] | select(.package == "internal/a" and .status == "failed" and .exitCode == 7)] | length == 1) and
  ([.packages[] | select(.status == "passed")] | length == 3)
' "${tmp}/result.json" >/dev/null

printf 'internal/c\ninternal/d\n' >"${tmp}/selection"
: >"${tmp}/runs"
unset MOCK_INTEGRATION_FAIL_PACKAGE
TEST_INTEGRATION_PACKAGES_FILE="${tmp}/selection" run_runner
printf 'internal/c\ninternal/d\n' >"${tmp}/expected-runs"
LC_ALL=C sort "${tmp}/runs" >"${tmp}/actual-runs"
cmp -s "${tmp}/expected-runs" "${tmp}/actual-runs"
jq -e '.status == "passed" and (.packages | length == 2)' "${tmp}/result.json" >/dev/null

printf 'internal/unknown\n' >"${tmp}/selection"
if TEST_INTEGRATION_PACKAGES_FILE="${tmp}/selection" run_runner >/dev/null 2>&1; then
  echo 'integration runner accepted an unknown package' >&2
  exit 1
fi

echo 'integration runner tests passed'
