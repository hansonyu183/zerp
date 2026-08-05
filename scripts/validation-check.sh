#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

test "$(printf 'README.md\n' | scripts/change-impact.sh --paths)" = docs
test "$(printf 'README.md\nscripts/pre-push.sh\n' | scripts/change-impact.sh --paths)" = validation
test "$(printf 'README.md\nfrontend/src/main.ts\n' | scripts/change-impact.sh --paths)" = application

GITHUB_BASE_REF=dev scripts/verify-pr-base.sh >/dev/null
GITHUB_BASE_REF=main ZERP_PR_HEAD_REF=dev scripts/verify-pr-base.sh >/dev/null
if GITHUB_BASE_REF=main ZERP_PR_HEAD_REF=feature scripts/verify-pr-base.sh >/dev/null 2>&1; then
  echo "feature branches must not target main" >&2
  exit 1
fi

standard_runtime=$(sed -n '/^FROM alpine:3\.23$/,$p' backend/Dockerfile)
ci_runtime=$(sed -n '/^FROM alpine:3\.23$/,$p' backend/Dockerfile.ci)
test "${standard_runtime}" = "${ci_runtime}" || {
  echo "backend/Dockerfile.ci runtime stage drifted from backend/Dockerfile" >&2
  exit 1
}
standard_binaries=$(sed -n 's#.*-o \(/out/[^ ]*\).*#\1#p' backend/Dockerfile | sort)
ci_binaries=$(sed -n 's#.*-o \(/out/[^ ]*\).*#\1#p' backend/Dockerfile.ci | sort)
test "${standard_binaries}" = "${ci_binaries}" || {
  echo "backend/Dockerfile.ci binaries drifted from backend/Dockerfile" >&2
  exit 1
}
if grep -q -- '--mount=type=cache' backend/Dockerfile.ci; then
  echo "backend/Dockerfile.ci cache mounts are not exportable by the GHA layer cache" >&2
  exit 1
fi
grep -q '^RUN go mod download' backend/Dockerfile.ci
test "$(grep -c '^RUN CGO_ENABLED=0 GOOS=linux go build' backend/Dockerfile.ci)" = 1

system_user_id=$(sed -n 's/^[[:space:]]*UserID[[:space:]]*=[[:space:]]*"\([^"]*\)"/\1/p' \
  backend/internal/platform/systemidentity/identity.go)
test -n "${system_user_id}"
grep -Fq "system_user_id=${system_user_id}" scripts/preview.sh
grep -Fq "WHERE id <> '\${system_user_id}'" scripts/preview.sh
grep -Fq "restore_after_failed_deploy \"\${native_was_ready}\" \"\${release_activated}\"" \
  scripts/preview.sh
grep -Fq "rm -f \"\${legacy_import_complete}\"" scripts/preview.sh
grep -Fq "mv \"\${attachment_root}\" \"\${backup_dir}/replaced-native-attachments\"" \
  scripts/preview.sh
if grep -Eq 'agent_runtime_root|processed-sha|failed-sha|automatic deployment' scripts/preview.sh; then
  echo "native preview still depends on the removed automatic deploy agent" >&2
  exit 1
fi
test "$(grep -c 'VITE_API_BASE_URL=/api/' scripts/preview.sh)" = 2 || {
  echo "native preview frontend builds must use the same-origin /api/ proxy" >&2
  exit 1
}
grep -Fq 'git fetch origin dev --prune' scripts/preview-deploy.sh
grep -Fq "test \"\${release_sha}\" = \"\${dev_sha}\"" scripts/preview-deploy.sh
grep -Fq 'scripts/verify-merged-pr.sh' scripts/preview-deploy.sh
if grep -Fq 'parent_count' scripts/preview-deploy.sh; then
  echo "preview deploy must accept squash dev commits" >&2
  exit 1
fi

test_merged_pr_evidence() {
  scenario=$1
  expected=$2
  test_root=$(mktemp -d "${TMPDIR:-/tmp}/zerp-merged-pr-test.XXXXXX")
  trap 'rm -rf "${test_root}"' EXIT HUP INT TERM
  mkdir -p "${test_root}/bin"
  cp scripts/verify-merged-pr.sh "${test_root}/verify-merged-pr.sh"
  cat >"${test_root}/bin/gh" <<'EOF'
#!/bin/sh
case "$*" in
  *'/pulls?per_page=20'*)
    if [ "${MOCK_SCENARIO}" = no-pr ]; then
      printf '[]\n'
    else
      printf '[{"number":94,"base":{"ref":"dev"},"merged_at":"2026-08-05T00:00:00Z","merge_commit_sha":"%s","head":{"sha":"%s","ref":"feature"}}]\n' "${MOCK_MERGE_SHA}" "${MOCK_HEAD_SHA}"
    fi
    ;;
  *"/git/commits/${MOCK_MERGE_SHA}"*)
    printf '%s\n' "${MOCK_TREE_SHA}"
    ;;
  *"/git/commits/${MOCK_HEAD_SHA}"*)
    printf '%s\n' "${MOCK_TREE_SHA}"
    ;;
  *'/check-runs?per_page=100'*)
    case "${MOCK_SCENARIO}" in
      missing-check)
        checks='contracts frontend backend containers e2e'
        ;;
      failed-check)
        checks='contracts frontend backend containers e2e full-validation-failed'
        ;;
      *)
        checks='contracts frontend backend containers e2e full-validation'
        ;;
    esac
    printf '{"check_runs":['
    separator=
    for check in ${checks}; do
      conclusion=success
      name=${check}
      if [ "${check}" = full-validation-failed ]; then
        name=full-validation
        conclusion=failure
      fi
      printf '%s{"name":"%s","status":"completed","conclusion":"%s","started_at":"2026-08-05T00:00:00Z"}' "${separator}" "${name}" "${conclusion}"
      separator=,
    done
    printf ']}\n'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 2
    ;;
esac
EOF
  chmod +x "${test_root}/bin/gh"

  merge_sha=1111111111111111111111111111111111111111
  head_sha=2222222222222222222222222222222222222222
  tree_sha=3333333333333333333333333333333333333333
  if PATH="${test_root}/bin:${PATH}" \
    MOCK_SCENARIO="${scenario}" \
    MOCK_MERGE_SHA="${merge_sha}" \
    MOCK_HEAD_SHA="${head_sha}" \
    MOCK_TREE_SHA="${tree_sha}" \
    GITHUB_REPOSITORY=hansonyu183/zerp \
    GITHUB_SHA="${merge_sha}" \
    ZERP_MERGED_BASE_REF=dev \
    "${test_root}/verify-merged-pr.sh" >/dev/null 2>&1; then
    actual=success
  else
    actual=failure
  fi
  test "${actual}" = "${expected}" || {
    echo "merged PR evidence scenario ${scenario}: expected ${expected}, got ${actual}" >&2
    exit 1
  }
  rm -rf "${test_root}"
  trap - EXIT HUP INT TERM
}

test_merged_pr_evidence squash success
test_merged_pr_evidence no-pr failure
test_merged_pr_evidence missing-check failure
test_merged_pr_evidence failed-check failure

grep -Fq 'origin/main)' scripts/pre-push.sh
grep -Fq "diff_range=\"\${base_ref}..HEAD\"" scripts/pre-push.sh
test "$(git diff --name-only origin/main..HEAD)" = \
  "$(git diff --name-only origin/main HEAD)" || {
  echo "origin/main release checks must compare the two endpoint trees" >&2
  exit 1
}

assert_checks() {
  expected=$1
  shift
  actual=$(printf '%s\n' "$@" | scripts/change-impact.sh --checks --paths)
  test "${actual}" = "${expected}" || {
    echo "unexpected check matrix for: $*" >&2
    printf 'expected:\n%s\nactual:\n%s\n' "${expected}" "${actual}" >&2
    exit 1
  }
}

assert_checks \
  "impact=docs
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=0" \
  README.md docs/operations/development-release.md

assert_checks \
  "impact=validation
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=0" \
  scripts/pre-push.sh

assert_checks \
  "impact=validation
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=0" \
  .github/workflows/quality.yml

assert_checks \
  "impact=validation
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=0" \
  Makefile backend/Makefile

assert_checks \
  "impact=application
contracts=0
frontend=1
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=1
local_e2e=0
preview=1" \
  frontend/src/main.ts

assert_checks \
  "impact=application
contracts=0
frontend=0
frontend_audit=0
backend=1
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=1" \
  backend/internal/httpserver/server.go

assert_checks \
  "impact=application
contracts=1
frontend=1
frontend_audit=0
backend=1
backend_full=1
containers=1
e2e=1
local_e2e=1
preview=1" \
  contracts/openapi/openapi.yaml

assert_checks \
  "impact=application
contracts=0
frontend=0
frontend_audit=0
backend=1
backend_full=1
containers=1
e2e=1
local_e2e=1
preview=1" \
  backend/db/migrations/00001_initial.sql

assert_checks \
  "impact=application
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=1
e2e=1
local_e2e=1
preview=0" \
  scripts/e2e.sh

assert_checks \
  "impact=validation
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=1
e2e=0
local_e2e=0
preview=0" \
  backend/Dockerfile.ci

assert_checks \
  "impact=validation
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=1
e2e=0
local_e2e=0
preview=0" \
  scripts/production-watch.sh

assert_checks \
  "impact=validation
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=1" \
  scripts/preview-deploy.sh

assert_checks \
  "impact=validation
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=1" \
  scripts/uninstall-preview-agent.sh

assert_checks \
  "impact=application
contracts=0
frontend=0
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=1
local_e2e=1
preview=0" \
  frontend/tests/e2e/signin.spec.ts

assert_checks \
  "impact=application
contracts=0
frontend=1
frontend_audit=0
backend=0
backend_full=0
containers=0
e2e=0
local_e2e=0
preview=0" \
  frontend/src/components/example.spec.ts

assert_checks \
  "impact=application
contracts=0
frontend=0
frontend_audit=0
backend=1
backend_full=1
containers=0
e2e=0
local_e2e=0
preview=0" \
  backend/internal/config/config_test.go \
  backend/db/migration-tests/00040_before.sql

assert_checks \
  "impact=application
contracts=0
frontend=1
frontend_audit=0
backend=1
backend_full=1
containers=0
e2e=1
local_e2e=1
preview=1" \
  frontend/src/main.ts backend/internal/httpserver/server.go

assert_checks \
  "impact=application
contracts=1
frontend=1
frontend_audit=0
backend=1
backend_full=1
containers=1
e2e=1
local_e2e=1
preview=1" \
  unknown.file

assert_checks \
  "impact=application
contracts=0
frontend=1
frontend_audit=1
backend=0
backend_full=0
containers=1
e2e=1
local_e2e=1
preview=1" \
  pnpm-lock.yaml

make check-release
