#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
root=$(mktemp -d "${TMPDIR:-/tmp}/zerp-preview-state.XXXXXX")
trap 'rm -rf "${root}"' EXIT HUP INT TERM
mkdir -p "${root}/bin" "${root}/attachments"
printf seed >"${root}/attachments/seed.txt"

accept_head=$(git -C "${repo_root}" rev-parse HEAD)
main_sha=$(git -C "${repo_root}" rev-parse origin/main)
merge_sha=1111111111111111111111111111111111111111
tree_sha=2222222222222222222222222222222222222222

cat >"${root}/bin/psql" <<'EOF'
#!/bin/sh
exit 1
EOF
cat >"${root}/bin/createdb" <<'EOF'
#!/bin/sh
[ "${PGPASSWORD:-}" = "${MOCK_POSTGRES_PASSWORD}" ]
printf '%s\n' "$*" >>"${MOCK_CREATEDB_LOG}"
[ "${MOCK_CREATEDB_FAIL:-0}" != 1 ]
EOF
cat >"${root}/bin/dropdb" <<'EOF'
#!/bin/sh
[ "${PGPASSWORD:-}" = "${MOCK_POSTGRES_PASSWORD}" ]
printf '%s\n' "$*" >>"${MOCK_DROPDB_LOG}"
EOF
cat >"${root}/bin/curl" <<'EOF'
#!/bin/sh
url=
for argument in "$@"; do url=$argument; done
case "$url" in
  */_zerp-release*) printf '%s' "${MOCK_ACCEPT_HEAD}" ;;
esac
EOF
cat >"${root}/bin/gh" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"${MOCK_GH_LOG}"
case "$*" in
  *"repos/example/zerp/pulls/1"*)
    printf '{"state":"open","draft":false,"base":{"ref":"main"},"head":{"sha":"%s"}}\n' "${MOCK_ACCEPT_HEAD}"
    ;;
  *"commits/${MOCK_ACCEPT_HEAD}/check-runs"*)
    if [ "${MOCK_DRAFT_ONLY:-0}" = 1 ]; then
      printf '{"check_runs":[{"name":"validation","status":"completed","conclusion":"success","started_at":"2026-08-08T00:00:00Z"}]}\n'
    else
      printf '{"check_runs":[{"name":"preview-required","status":"completed","conclusion":"success","started_at":"2026-08-08T00:00:00Z"}]}\n'
    fi
    ;;
  *"collaborators/alice/permission"*) printf 'write\n' ;;
  *"deployments?sha="*) ;;
  *"--method POST repos/example/zerp/deployments --input - --jq .id"*) printf '42\n' ;;
  *"--method POST repos/example/zerp/statuses/${MOCK_ACCEPT_HEAD}"*)
    if [ "${MOCK_DRIFT_AFTER_STATUS:-0}" = 1 ]; then
      printf '%s\n' 9999999999999999999999999999999999999999 >"${MOCK_RUNTIME_RELEASE_FILE}"
    fi
    printf '{}\n'
    ;;
  *"commits/${MOCK_MERGE_SHA}/pulls?per_page=20"*)
    printf '[{"number":%s,"base":{"ref":"main"},"merged_at":"2026-08-08T00:00:00Z","merge_commit_sha":"%s","head":{"sha":"%s"}}]\n' "${MOCK_MERGED_PR:-1}" "${MOCK_MERGE_SHA}" "${MOCK_MERGED_HEAD:-${MOCK_ACCEPT_HEAD}}"
    ;;
  *"git/commits/${MOCK_MERGE_SHA}"* | *"git/commits/${MOCK_ACCEPT_HEAD}"*)
    printf '%s\n' "${MOCK_TREE_SHA}"
    ;;
  *"commits/${MOCK_ACCEPT_HEAD}/statuses?per_page=100"*)
    printf '[{"context":"full-validation","state":"success","created_at":"2026-08-08T00:01:00Z"}]\n'
    ;;
  *"commits/${MOCK_ACCEPT_HEAD}/check-runs?per_page=100"*)
    printf '{"check_runs":[]}\n'
    ;;
  *) printf '{}\n' ;;
esac
EOF
chmod +x "${root}/bin/psql" "${root}/bin/createdb" "${root}/bin/dropdb" \
  "${root}/bin/curl" "${root}/bin/gh"

export PATH="${root}/bin:${PATH}"
export MOCK_CREATEDB_LOG="${root}/createdb.log"
export MOCK_GH_LOG="${root}/gh.log"
export MOCK_DROPDB_LOG="${root}/dropdb.log"
export MOCK_ACCEPT_HEAD="${accept_head}"
export MOCK_MERGE_SHA="${merge_sha}"
export MOCK_TREE_SHA="${tree_sha}"
export MOCK_RUNTIME_RELEASE_FILE="${root}/runtime/releases/${accept_head}/release-sha"
export MOCK_POSTGRES_PASSWORD=preview-test-password
export ZERP_PREVIEW_STATE_ROOT="${root}/state"
export ZERP_PREVIEW_RUNTIME_ROOT="${root}/runtime"
mkdir -p "${ZERP_PREVIEW_RUNTIME_ROOT}/controller-secrets"
printf '%s\n' "${MOCK_POSTGRES_PASSWORD}" >"${ZERP_PREVIEW_RUNTIME_ROOT}/controller-secrets/postgres-admin-password"
export ZERP_BASELINE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export POSTGRES_DB=zerp_preview
export POSTGRES_PASSWORD="${MOCK_POSTGRES_PASSWORD}"
export ZERP_PREVIEW_ATTACHMENT_ROOT="${root}/attachments"
export ZERP_PREVIEW_NOW=1000
export ZERP_PREVIEW_MAIN_SHA="${main_sha}"
export ZERP_GITHUB_REPOSITORY=example/zerp
export ZERP_GH_BIN=gh
state=${repo_root}/scripts/preview-state.sh

if MOCK_DRAFT_ONLY=1 PREVIEW_ACTOR=alice \
  "${repo_root}/scripts/verify-preview-pr.sh" 1 "${accept_head}" >/dev/null 2>&1; then
  echo 'Draft-only evidence was accepted for preview' >&2
  exit 1
fi

if [ "$(uname -s)" = Darwin ]; then
  sandbox=${repo_root}/scripts/preview-build-sandbox.sh
  sandbox_primary=${root}/sandbox-primary
  sandbox_source=${sandbox_primary}/source
  sandbox_output=${root}/sandbox-output
  sandbox_cache=${root}/sandbox-cache
  sandbox_secret=${sandbox_primary}/preview.env
  mkdir -p "${sandbox_source}" "${sandbox_output}" "${sandbox_cache}"
  printf '%s\n' secret >"${sandbox_secret}"
  printf '%s\n' public >"${sandbox_source}/public"
  ln -s ../preview.env "${sandbox_source}/secret-link"
  "${sandbox}" "${sandbox_primary}" "${sandbox_source}" \
    "${sandbox_output}" "${sandbox_cache}" "${sandbox_secret}" \
    node --version >/dev/null
  "${sandbox}" "${sandbox_primary}" "${sandbox_source}" \
    "${sandbox_output}" "${sandbox_cache}" "${sandbox_secret}" \
    /bin/cat "${sandbox_source}/public" >/dev/null
  if "${sandbox}" "${sandbox_primary}" "${sandbox_source}" \
    "${sandbox_output}" "${sandbox_cache}" "${sandbox_secret}" \
    /bin/cat "${sandbox_source}/secret-link" >/dev/null 2>&1; then
    echo 'preview sandbox followed a secret symlink' >&2
    exit 1
  fi
  if "${sandbox}" "${sandbox_primary}" "${sandbox_source}" \
    "${sandbox_output}" "${sandbox_cache}" "${sandbox_secret}" \
    /usr/bin/touch "${root}/sandbox-outside" >/dev/null 2>&1; then
    echo 'preview sandbox wrote outside build directories' >&2
    exit 1
  fi
  if "${sandbox}" "${sandbox_primary}" "${sandbox_source}" \
    "${sandbox_output}" "${sandbox_cache}" "${sandbox_secret}" \
    /usr/bin/security list-keychains >/dev/null 2>&1; then
    echo 'preview sandbox reached the system keychain' >&2
    exit 1
  fi
  if "${sandbox}" "${sandbox_primary}" "${sandbox_source}" \
    "${sandbox_output}" "${sandbox_cache}" "${sandbox_secret}" \
    /usr/bin/pbpaste >/dev/null 2>&1; then
    echo 'preview sandbox reached the system pasteboard' >&2
    exit 1
  fi

  runtime_sandbox=${repo_root}/scripts/preview-runtime-sandbox.sh
  runtime_primary=${root}/runtime-primary
  runtime_root=${runtime_primary}/runtime
  runtime_release=${runtime_root}/release
  runtime_attachments=${runtime_root}/attachments
  mkdir -p "${runtime_release}" "${runtime_attachments}"
  printf '%s\n' public >"${runtime_release}/public"
  printf '%s\n' secret >"${runtime_primary}/secret"
  PREVIEW_RUNTIME_TEST_SECRET=not-in-clean-environment \
    "${runtime_sandbox}" web "${runtime_primary}" "${runtime_root}" \
      "${runtime_release}" "${runtime_attachments}" /bin/cat \
      "${runtime_release}/public" >/dev/null
  if PREVIEW_RUNTIME_TEST_SECRET=not-in-clean-environment \
    "${runtime_sandbox}" web "${runtime_primary}" "${runtime_root}" \
      "${runtime_release}" "${runtime_attachments}" /usr/bin/env | \
      grep -q PREVIEW_RUNTIME_TEST_SECRET; then
    echo 'preview runtime inherited the controller environment' >&2
    exit 1
  fi
  if "${runtime_sandbox}" web "${runtime_primary}" "${runtime_root}" \
    "${runtime_release}" "${runtime_attachments}" /bin/cat \
    "${runtime_primary}/secret" >/dev/null 2>&1; then
    echo 'preview runtime read a controller file' >&2
    exit 1
  fi
  if "${runtime_sandbox}" web "${runtime_primary}" "${runtime_root}" \
    "${runtime_release}" "${runtime_attachments}" /usr/bin/touch \
    "${runtime_primary}/outside" >/dev/null 2>&1; then
    echo 'preview runtime wrote outside its isolated roots' >&2
    exit 1
  fi
  if "${runtime_sandbox}" web "${runtime_primary}" "${runtime_root}" \
    "${runtime_release}" "${runtime_attachments}" \
    /usr/bin/pbpaste >/dev/null 2>&1; then
    echo 'preview runtime reached the system pasteboard' >&2
    exit 1
  fi
fi

mkdir -p "${root}/runtime/releases/${accept_head}/web"
printf '%s\n' "${accept_head}" >"${root}/runtime/releases/${accept_head}/release-sha"
printf '%s\n' "${accept_head}" >"${root}/runtime/releases/${accept_head}/web/_zerp-release"
ln -s "${root}/runtime/releases/${accept_head}" "${root}/runtime/current"

"${state}" init
before=$(cat "${root}/state/current")
if PREVIEW_PR=1 PREVIEW_REF=bad PREVIEW_VERIFIED=1 "${state}" claim >/dev/null 2>&1; then
  exit 1
fi
test "$(cat "${root}/state/current")" = "${before}"

# A failed clone is transactional: it cannot strand the slot or mutate state.
if MOCK_CREATEDB_FAIL=1 PREVIEW_PR=9 \
  PREVIEW_REF=9999999999999999999999999999999999999999 \
  PREVIEW_VERIFIED=1 "${state}" claim >/dev/null 2>&1; then
  exit 1
fi
test ! -e "${root}/state/lock"
test ! -e "${root}/state/active"
test "$(cat "${root}/state/current")" = "${before}"
if PREVIEW_PR=1 PREVIEW_REF=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "${state}" claim >/dev/null 2>&1; then
  exit 1
fi
test "$(cat "${root}/state/current")" = "${before}"

PREVIEW_PR=1 PREVIEW_REF=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  PREVIEW_VERIFIED=1 "${state}" claim
test "$(cat "${root}/state/active")" = 1
test "$(cat "${root}/state/lock/owner")" = 1
if PREVIEW_PR=2 PREVIEW_REF=cccccccccccccccccccccccccccccccccccccccc \
  PREVIEW_VERIFIED=1 "${state}" claim >/dev/null 2>&1; then
  exit 1
fi
PREVIEW_PR=1 PREVIEW_REF=dddddddddddddddddddddddddddddddddddddddd \
  PREVIEW_VERIFIED=1 "${state}" claim
test "$(grep '^generation=' "${root}/state/prs/1.state")" = generation=2

ZERP_PREVIEW_NOW=87401 PREVIEW_PR=1 "${state}" reap
test ! -e "${root}/state/active"
test "$(grep '^kind=' "${root}/state/current")" = kind=baseline

ZERP_PREVIEW_NOW=90000 PREVIEW_PR=1 \
  PREVIEW_REF=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  PREVIEW_VERIFIED=1 "${state}" claim
PREVIEW_PR=1 "${state}" close
test ! -e "${root}/state/active"

ZERP_PREVIEW_NOW=90001 PREVIEW_PR=1 PREVIEW_REF="${accept_head}" \
  PREVIEW_VERIFIED=1 "${state}" claim
printf '%s\n' 9999999999999999999999999999999999999999 \
  >"${root}/runtime/releases/${accept_head}/release-sha"
if PREVIEW_PR=1 PREVIEW_ACTOR=alice "${state}" accept >/dev/null 2>&1; then
  echo 'Drifted preview runtime was accepted' >&2
  exit 1
fi
printf '%s\n' "${accept_head}" >"${root}/runtime/releases/${accept_head}/release-sha"
if MOCK_DRIFT_AFTER_STATUS=1 PREVIEW_PR=1 PREVIEW_ACTOR=alice \
  "${state}" accept >/dev/null 2>&1; then
  echo 'Preview drift after acceptance publication was accepted' >&2
  exit 1
fi
test "$(grep '^status=' "${root}/state/prs/1.state")" = status=active
printf '%s\n' "${accept_head}" >"${root}/runtime/releases/${accept_head}/release-sha"
PREVIEW_PR=1 PREVIEW_ACTOR=alice "${state}" accept
grep -Fq "repos/example/zerp/deployments" "${MOCK_GH_LOG}"
grep -Fq "repos/example/zerp/statuses/${accept_head}" "${MOCK_GH_LOG}"
if MOCK_MERGED_PR=2 PREVIEW_PR=1 PREVIEW_MERGE_SHA="${merge_sha}" \
  "${state}" promote >/dev/null 2>&1; then
  echo 'Promotion accepted a merge from another PR' >&2
  exit 1
fi
if MOCK_MERGED_HEAD=3333333333333333333333333333333333333333 \
  PREVIEW_PR=1 PREVIEW_MERGE_SHA="${merge_sha}" \
  "${state}" promote >/dev/null 2>&1; then
  echo 'Promotion accepted a merge from another head' >&2
  exit 1
fi
test "$(grep '^status=' "${root}/state/prs/1.state")" = status=accepted
PREVIEW_PR=1 PREVIEW_MERGE_SHA="${merge_sha}" "${state}" promote
test "$(grep '^sha=' "${root}/state/current")" = "sha=${merge_sha}"

# GC must retain the baseline referenced by an active PR even when it is older
# than all of the ordinary retained baselines.
ZERP_PREVIEW_NOW=90002 PREVIEW_PR=4 \
  PREVIEW_REF=4444444444444444444444444444444444444444 \
  PREVIEW_VERIFIED=1 "${state}" claim
# A later generation of the same active PR must retain its original baseline.
ZERP_PREVIEW_NOW=90003 PREVIEW_PR=4 \
  PREVIEW_REF=4444444444444444444444444444444444444445 \
  PREVIEW_VERIFIED=1 "${state}" claim
test "$(grep '^baseline=' "${root}/state/prs/4.state")" = "baseline=${merge_sha}"
touch -t 202608080100 "${root}/state/baselines/${merge_sha}.state"
for suffix in 5 6 7 8; do
  sha="${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}"
  sed -e "s/^id=.*/id=${sha}/" -e "s/^sha=.*/sha=${sha}/" \
    "${root}/state/baselines/${merge_sha}.state" >"${root}/state/baselines/${sha}.state"
  touch -t "20260808010${suffix}" "${root}/state/baselines/${sha}.state"
done
ZERP_PREVIEW_NOW=90004 "${state}" gc
test -e "${root}/state/baselines/${merge_sha}.state"
PREVIEW_PR=4 ZERP_PREVIEW_NOW=90005 "${state}" close
test "$(grep '^sha=' "${root}/state/current")" = "sha=${merge_sha}"

# Failed deployment restores the baseline and leaves a seven-day record.
ZERP_PREVIEW_NOW=100000 PREVIEW_PR=2 PREVIEW_FAILURE_REASON=health "${state}" fail
test "$(grep '^kind=' "${root}/state/current")" = kind=baseline
test -n "$(find "${root}/state/failures" -type f -name '*.state' -print -quit)"

# Closed PR resources are retained for seven days, then removed together.
ZERP_PREVIEW_NOW=110000 PREVIEW_PR=3 \
  PREVIEW_REF=3333333333333333333333333333333333333333 \
  PREVIEW_VERIFIED=1 "${state}" claim
closed_attachments=$(sed -n 's/^attachments=//p' "${root}/state/prs/3.state")
PREVIEW_PR=3 ZERP_PREVIEW_NOW=110001 "${state}" close
test -d "${closed_attachments}"
ZERP_PREVIEW_NOW=714802 "${state}" gc
test ! -e "${root}/state/prs/3.state"
test ! -e "${closed_attachments}"
grep -Fq 'zerp_preview_pr_3' "${MOCK_DROPDB_LOG}"

# The deploy wrapper verifies before and after the secret-free build.
test "$(grep -c 'scripts/verify-preview-pr.sh' "${repo_root}/scripts/preview-deploy.sh")" = 2
grep -Fq 'scripts/preview-build-sandbox.sh' "${repo_root}/scripts/preview.sh"
grep -Fq '(subpath (param "PRIMARY_ROOT"))' \
  "${repo_root}/scripts/preview-build-sandbox.sh"
grep -Fq '(subpath (param "USER_HOME"))' \
  "${repo_root}/scripts/preview-build-sandbox.sh"
grep -Fq '(literal (param "SECRET_FILE"))' \
  "${repo_root}/scripts/preview-build-sandbox.sh"
grep -Fq '(deny file-write*' "${repo_root}/scripts/preview-build-sandbox.sh"
grep -Fq '/usr/bin/env -i' "${repo_root}/scripts/preview-build-sandbox.sh"
grep -Fq '/usr/bin/pbpaste' "${repo_root}/scripts/preview-build-sandbox.sh"
grep -Fq '(deny network*)' "${repo_root}/scripts/preview-runtime-sandbox.sh"
grep -Fq 'localhost:55436' "${repo_root}/scripts/preview-runtime-sandbox.sh"
grep -Fq 'localhost:18082' "${repo_root}/scripts/preview-runtime-sandbox.sh"
grep -Fq '/usr/bin/env -i' "${repo_root}/scripts/preview-runtime-sandbox.sh"
grep -Fq '/usr/bin/pbpaste' "${repo_root}/scripts/preview-runtime-sandbox.sh"
grep -Fq 'db_admin_user=zerp_preview_admin' "${repo_root}/scripts/preview.sh"
grep -Fq 'db_migration_user=zerp_preview_migrator' "${repo_root}/scripts/preview.sh"
grep -Fq 'restrict_preview_database_connections' "${repo_root}/scripts/preview.sh"
grep -Fq 'park_database_ownership' "${repo_root}/scripts/preview.sh"
grep -Fq "r.rolname ~ '^zerp_preview(_pr_[0-9]+)?_owner$'" "${repo_root}/scripts/preview.sh"
grep -Fq 'local all %s reject' "${repo_root}/scripts/preview.sh"
grep -Fq 'host all %s 127.0.0.1/32 reject' "${repo_root}/scripts/preview.sh"
# shellcheck disable=SC2016 # intentional literal source assertion
grep -Fq 'REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC' "${repo_root}/scripts/preview.sh"
# shellcheck disable=SC2016 # intentional literal source assertions
grep -Fq 'ALTER ROLE ${POSTGRES_USER} LOGIN NOSUPERUSER' "${repo_root}/scripts/preview.sh"
grep -Fq -- '--auth-local=scram-sha-256' "${repo_root}/scripts/preview.sh"
grep -Fq 'db_user=zerp_preview_admin' "${state}"
# shellcheck disable=SC2016 # intentional literal source assertion
grep -Fq 'find -P "${artifact_root}" ! -type f ! -type d' "${repo_root}/scripts/preview.sh"
grep -Fq 'sandbox_setup /usr/bin/env' "${repo_root}/scripts/preview.sh"
# shellcheck disable=SC2016 # intentional literal source assertion
grep -Fq 'verify_active_release "$head"' "${repo_root}/scripts/preview-state.sh"
# shellcheck disable=SC2016 # intentional literal source assertions
grep -Fq 'build-cache/${release_name}' "${repo_root}/scripts/preview.sh"
# shellcheck disable=SC2016
grep -Fq 'chmod -R u+w "${build_cache}"' "${repo_root}/scripts/preview.sh"
# shellcheck disable=SC2016 # these are intentional literal source assertions
if grep -q '"${build_root}/scripts/preview.sh"' "${repo_root}/scripts/preview-deploy.sh"; then
  echo 'preview deploy executes an untrusted PR controller' >&2
  exit 1
fi
# shellcheck disable=SC2016
grep -Fq '"${repo_root}/scripts/preview.sh" "$@"' "${repo_root}/scripts/preview-deploy.sh"
# shellcheck disable=SC2016
grep -Fq 'controller_sha=$(git rev-parse HEAD)' "${repo_root}/scripts/preview-deploy.sh"
# shellcheck disable=SC2016
grep -Fq 'trusted_sha=$(git rev-parse FETCH_HEAD)' "${repo_root}/scripts/preview-deploy.sh"
grep -Fq 'if ! git diff --quiet || ! git diff --cached --quiet; then' "${repo_root}/scripts/preview-deploy.sh"
grep -Fq 'Missing cached release for non-current baseline' "${repo_root}/scripts/preview-deploy.sh"
# shellcheck disable=SC2016
if grep -q '"${source_root}/compose' "${repo_root}/scripts/preview.sh"; then
  echo 'preview runtime executes untrusted PR compose configuration' >&2
  exit 1
fi
grep -Fq 'sync_release_to_state 1' "${repo_root}/scripts/preview.sh"
grep -Fq 'sync_release_to_state 0' "${repo_root}/scripts/preview.sh"
printf '%s\n' 'preview state tests passed'
