#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

sh -n scripts/change-impact.sh scripts/validation-check.sh
test "$(printf 'README.md\n' | scripts/change-impact.sh --paths)" = docs
test "$(printf 'README.md\nscripts/pre-push.sh\n' | scripts/change-impact.sh --paths)" = validation
test "$(printf 'README.md\nfrontend/src/main.ts\n' | scripts/change-impact.sh --paths)" = application

make release-check
make -C backend quality-actionlint
