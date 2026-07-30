#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

sh -n scripts/change-impact.sh scripts/pre-push.sh scripts/validation-check.sh
test "$(printf 'README.md\n' | scripts/change-impact.sh --paths)" = docs
test "$(printf 'README.md\nscripts/pre-push.sh\n' | scripts/change-impact.sh --paths)" = validation
test "$(printf 'README.md\nfrontend/src/main.ts\n' | scripts/change-impact.sh --paths)" = application

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
backend=0
containers=0
e2e=0
local_e2e=0
preview=0" \
  scripts/pre-push.sh .github/workflows/quality.yml

assert_checks \
  "impact=application
contracts=0
frontend=1
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
backend=0
containers=1
e2e=1
local_e2e=1
preview=0" \
  scripts/e2e.sh frontend/tests/e2e/signin.spec.ts

assert_checks \
  "impact=application
contracts=0
frontend=1
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
backend=1
containers=0
e2e=0
local_e2e=0
preview=0" \
  backend/internal/config/config_test.go

assert_checks \
  "impact=application
contracts=0
frontend=1
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
backend=1
containers=1
e2e=1
local_e2e=1
preview=1" \
  unknown.file

make release-check
make -C backend quality-actionlint
