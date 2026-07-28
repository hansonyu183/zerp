#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

if [ -n "$(git status --porcelain)" ]; then
  echo "pre-push requires a clean worktree; commit or isolate all changes first" >&2
  exit 1
fi

base_ref=${PRE_PUSH_BASE_REF:-origin/main}
git rev-parse --verify "${base_ref}^{commit}" >/dev/null

changed_files=$(git diff --name-only "${base_ref}...HEAD")
if [ -z "${changed_files}" ]; then
  echo "No changes relative to ${base_ref}"
  exit 0
fi

impact=$(scripts/change-impact.sh "${base_ref}...HEAD")
git diff --check "${base_ref}...HEAD"

case "${impact}" in
  docs)
    printf '%s\n' "${changed_files}" |
      while IFS= read -r changed_file; do
        if [ -e "${changed_file}" ] || [ -L "${changed_file}" ]; then
          pnpm exec prettier --check "${changed_file}"
        fi
      done
    pnpm docs:check
    ;;
  validation)
    pnpm format:check
    pnpm docs:check
    scripts/validation-check.sh
    ;;
  application)
    make generate-check
    make check
    make e2e
    ;;
  *)
    echo "Unsupported change impact: ${impact}" >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "pre-push checks changed tracked or untracked files" >&2
  git status --short >&2
  exit 1
fi

echo "Pre-push gate passed: ${impact}"
