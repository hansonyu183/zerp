#!/bin/sh
set -eu

case "${1:-}" in
  --paths)
    changed_files=$(cat)
    ;;
  '')
    echo "usage: scripts/change-impact.sh <git-diff-range> | --paths" >&2
    exit 2
    ;;
  *)
    changed_files=$(git diff --name-only "$1")
    ;;
esac

if [ -z "${changed_files}" ]; then
  echo none
  exit 0
fi

impact=docs
old_ifs=${IFS}
IFS='
'
for changed_file in ${changed_files}; do
  case "${changed_file}" in
    AGENTS.md | README.md | docs/* | *.md | LICENSE)
      ;;
    .github/* | .gitignore | .prettierignore | .prettierrc.json | .vscode/* | \
      scripts/change-impact.sh | scripts/check-docs.mjs | scripts/pre-push.sh | \
      scripts/validation-check.sh | scripts/verify-pr-base.sh | \
      scripts/verify-merged-pr.sh)
      impact=validation
      ;;
    *)
      impact=application
      break
      ;;
  esac
done
IFS=${old_ifs}

echo "${impact}"
