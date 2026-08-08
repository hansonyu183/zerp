#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

test "$(printf 'README.md\n' | scripts/change-impact.sh --paths)" = docs
test "$(printf 'README.md\nscripts/pre-push.sh\n' | scripts/change-impact.sh --paths)" = validation
test "$(printf 'README.md\nfrontend/src/main.ts\n' | scripts/change-impact.sh --paths)" = application

# Bootstrap the stable release-readiness check while existing component checks
# remain required until preview acceptance joins the same end-to-end tree.
grep -Fq 'types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]' \
  .github/workflows/quality.yml
grep -Fq 'name: validation' .github/workflows/quality.yml
grep -Fq "'preview-required' || 'full-validation'" .github/workflows/quality.yml
full_validation_block=$(sed -n '/^  full_validation:/,/^$/p' .github/workflows/quality.yml)
printf '%s\n' "${full_validation_block}" |
  grep -Fq "github.event_name != 'push' &&" || {
  echo "main push must preserve the full-validation check name" >&2
  exit 1
}
if printf '%s\n' "${full_validation_block}" |
  grep -Fq "github.event_name == 'pull_request' &&"; then
  echo "full-validation must never bypass preview acceptance by event type" >&2
  exit 1
fi
grep -Fq "PREVIEW_REQUIRED: \${{ needs.merge_evidence.outputs.preview }}" \
  .github/workflows/quality.yml
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
contracts=1
frontend=1
frontend_audit=0
backend=1
containers=1
e2e=1
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
