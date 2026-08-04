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
grep -Fq "WHERE id <> '${system_user_id}'" scripts/preview.sh
grep -Fq "restore_after_failed_deploy \"\${native_was_ready}\" \"\${release_activated}\"" \
  scripts/preview.sh
grep -Fq "rm -f \"\${legacy_import_complete}\"" scripts/preview.sh
grep -Fq "mv \"\${attachment_root}\" \"\${backup_dir}/replaced-native-attachments\"" \
  scripts/preview.sh
if grep -Eq 'agent_runtime_root|processed-sha|failed-sha|automatic deployment' scripts/preview.sh; then
  echo "native preview still depends on the removed automatic deploy agent" >&2
  exit 1
fi
grep -Fq 'git fetch origin dev --prune' scripts/preview-deploy.sh
grep -Fq "test \"\${release_sha}\" = \"\${dev_sha}\"" scripts/preview-deploy.sh
grep -Fq "test \"\${parent_count}\" = 2" scripts/preview-deploy.sh

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
containers=0
e2e=0
local_e2e=0
preview=0" \
  .github/workflows/quality.yml

assert_checks \
  "impact=application
contracts=0
frontend=1
frontend_audit=0
backend=0
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
containers=0
e2e=1
local_e2e=0
preview=1" \
  backend/internal/httpserver/server.go

assert_checks \
  "impact=application
contracts=1
frontend=1
frontend_audit=0
backend=1
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
containers=1
e2e=0
local_e2e=0
preview=0" \
  scripts/production-watch.sh

assert_checks \
  "impact=application
contracts=0
frontend=0
frontend_audit=0
backend=0
containers=1
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
containers=1
e2e=1
local_e2e=1
preview=1" \
  pnpm-lock.yaml

make check-release
