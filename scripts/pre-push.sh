#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

plan_only=0
case "${1:-}" in
  '')
    ;;
  --plan)
    plan_only=1
    ;;
  *)
    echo "usage: scripts/pre-push.sh [--plan]" >&2
    exit 2
    ;;
esac

git fetch origin main --prune
if [ "${plan_only}" = 1 ]; then
  exec "${repo_root}/scripts/change-gate.sh" --plan origin/main
fi
exec "${repo_root}/scripts/change-gate.sh" origin/main
