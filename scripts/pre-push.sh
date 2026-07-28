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

docs_only=true
for changed_file in ${changed_files}; do
  case "${changed_file}" in
    AGENTS.md | README.md | docs/* | *.md)
      ;;
    *)
      docs_only=false
      break
      ;;
  esac
done

git diff --check "${base_ref}...HEAD"

if [ "${docs_only}" = "true" ]; then
  printf '%s\n' "${changed_files}" |
    while IFS= read -r changed_file; do
      if [ -e "${changed_file}" ] || [ -L "${changed_file}" ]; then
        pnpm exec prettier --check "${changed_file}"
      fi
    done
  echo "Documentation-only pre-push gate passed"
  exit 0
fi

make generate-check
make check
make e2e

if [ -n "$(git status --porcelain)" ]; then
  echo "pre-push checks changed tracked or untracked files" >&2
  git status --short >&2
  exit 1
fi

echo "Full pre-push gate passed"
