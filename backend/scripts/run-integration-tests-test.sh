#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/zerp-integration-runner-test.XXXXXX")
cleanup() { rm -rf "${tmp}"; }
trap cleanup EXIT HUP INT TERM

fixture="${tmp}/backend"
mkdir -p "${fixture}/db/fixtures/cutovers" "${fixture}/db/cutovers" \
  "${fixture}/tools" "${tmp}/bin"
for package in a b c d; do
  mkdir -p "${fixture}/internal/${package}"
  printf '//go:build integration\n' >"${fixture}/internal/${package}/${package}_test.go"
done
printf '%s\n' '-- schema' >"${fixture}/db/schema.sql"
printf '%s\n' '-- historical pre-issue-289 fixture' >"${fixture}/db/fixtures/cutovers/historical-pre-issue-289.sql"
printf '%s\n' '-- pre-issue-305 fixture' >"${fixture}/db/fixtures/cutovers/pre-issue-305.sql"
for issue in 289-aux-snapshots 290-aux-direct-crud 291-dcl-acc-mapping 292-dcl-rpt-definition 293-dcl-wfl-process-definition 305-dcl-subject-core-masters 308-dcl-party-relationships 309-dcl-reference-and-rpt-ownership 310-read-contract 311-final-cutover; do
  printf '%s\n' "-- issue-${issue}" >"${fixture}/db/cutovers/issue-${issue}.sql"
done
git -C "${fixture}" init -b main >/dev/null
git -C "${fixture}" add .

if grep -Eq 'git show|d505c567' "${script_dir}/run-integration-tests.sh"; then
  echo 'integration runner still depends on a historical Git object' >&2
  exit 1
fi

cat >"${tmp}/bin/docker" <<'EOF'
#!/bin/sh
set -eu
input=$(cat)
case "${input}" in
  *issue-289-aux-snapshots*)
    count_file="${MOCK_DOCKER_STATE}.issue-289"
    count=0
    [ ! -f "${count_file}" ] || count=$(cat "${count_file}")
    count=$((count + 1))
    printf '%s\n' "${count}" >"${count_file}"
    [ "${count}" -ne 2 ] || exit 1
    ;;
  *issue-290-aux-direct-crud*)
    count_file="${MOCK_DOCKER_STATE}.issue-290"
    count=0
    [ ! -f "${count_file}" ] || count=$(cat "${count_file}")
    count=$((count + 1))
    printf '%s\n' "${count}" >"${count_file}"
    case "${count}" in 1|3) exit 1 ;; esac
    ;;
  *issue-305-dcl-subject-core-masters*)
    count_file="${MOCK_DOCKER_STATE}.issue-305"
    count=0
    [ ! -f "${count_file}" ] || count=$(cat "${count_file}")
    count=$((count + 1))
    printf '%s\n' "${count}" >"${count_file}"
    [ "${count}" -ne 1 ] || exit 1
    ;;
  *issue-311-final-cutover*)
    count_file="${MOCK_DOCKER_STATE}.issue-311"
    count=0
    [ ! -f "${count_file}" ] || count=$(cat "${count_file}")
    count=$((count + 1))
    printf '%s\n' "${count}" >"${count_file}"
    [ "${count}" -ne 1 ] || exit 1
    ;;
esac
EOF
chmod +x "${tmp}/bin/docker"

cat >"${tmp}/bin/go" <<'EOF'
#!/bin/sh
set -eu
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
  rm -f "${tmp}/docker-state.issue-289" "${tmp}/docker-state.issue-290" \
    "${tmp}/docker-state.issue-305" "${tmp}/docker-state.issue-311"
  (
    cd "${fixture}"
    PATH="${tmp}/bin:${PATH}" \
      POSTGRES_USER=tester POSTGRES_PASSWORD=secret POSTGRES_PORT=5432 \
      TEST_POSTGRES_DB=runner_test TEST_POSTGRES_PORT=55434 \
      TEST_INTEGRATION_JOBS=2 MOCK_INTEGRATION_RUNS="${tmp}/runs" \
      MOCK_DOCKER_STATE="${tmp}/docker-state" \
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
test "$(cat "${tmp}/docker-state.issue-311")" = 2
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
test "$(cat "${tmp}/docker-state.issue-311")" = 2
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
