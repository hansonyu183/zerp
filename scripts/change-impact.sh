#!/bin/sh
set -eu

output=impact
paths_from_stdin=0
diff_range=

for argument in "$@"; do
  case "${argument}" in
    --checks)
      output=checks
      ;;
    --paths)
      paths_from_stdin=1
      ;;
    -*)
      echo "usage: scripts/change-impact.sh [--checks] <git-diff-range> | [--checks] --paths" >&2
      exit 2
      ;;
    *)
      if [ -n "${diff_range}" ]; then
        echo "usage: scripts/change-impact.sh [--checks] <git-diff-range> | [--checks] --paths" >&2
        exit 2
      fi
      diff_range=${argument}
      ;;
  esac
done

if [ "${paths_from_stdin}" = "1" ]; then
  if [ -n "${diff_range}" ]; then
    echo "--paths cannot be combined with a git diff range" >&2
    exit 2
  fi
  changed_files=$(cat)
elif [ -n "${diff_range}" ]; then
  changed_files=$(git diff --name-only "${diff_range}")
else
  echo "usage: scripts/change-impact.sh [--checks] <git-diff-range> | [--checks] --paths" >&2
  exit 2
fi

impact=docs
contracts=0
frontend=0
backend=0
containers=0
e2e=0
local_e2e=0
preview=0

mark_application() {
  impact=application
}

mark_full() {
  mark_application
  contracts=1
  frontend=1
  backend=1
  containers=1
  e2e=1
  local_e2e=1
  preview=1
}

if [ -n "${changed_files}" ]; then
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
        if [ "${impact}" = "docs" ]; then
          impact=validation
        fi
        ;;

      contracts/* | backend/oapi-codegen.yaml | backend/internal/api/generated/* | \
        frontend/src/api/generated/*)
        mark_full
        contracts=1
        ;;

      backend/db/queries/* | backend/sqlc.yaml | backend/internal/database/sqlc/*)
        mark_application
        contracts=1
        backend=1
        e2e=1
        preview=1
        ;;

      backend/db/migrations/*)
        mark_application
        backend=1
        containers=1
        e2e=1
        local_e2e=1
        preview=1
        ;;

      package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .nvmrc | \
        frontend/package.json | tools/typescript-native/*)
        mark_application
        frontend=1
        containers=1
        e2e=1
        local_e2e=1
        preview=1
        ;;

      backend/go.mod | backend/go.sum | backend/tools/go.mod | backend/tools/go.sum)
        mark_application
        backend=1
        containers=1
        e2e=1
        local_e2e=1
        preview=1
        ;;

      compose.yaml | compose.dev.yaml | .dockerignore | frontend/Dockerfile | backend/Dockerfile)
        mark_application
        containers=1
        e2e=1
        local_e2e=1
        preview=1
        ;;

      compose.e2e.yaml | backend/.env.e2e.example | scripts/e2e.sh | \
        frontend/playwright.config.ts | frontend/tests/e2e/*)
        mark_application
        containers=1
        e2e=1
        local_e2e=1
        ;;

      compose.preview.yaml | backend/.env.preview.example | \
        backend/scripts/init-preview-env.sh | scripts/preview.sh | scripts/preview-deploy.sh)
        mark_application
        containers=1
        preview=1
        ;;

      compose.production.yaml | backend/.env.production.example | \
        scripts/install-production-agent.sh | scripts/production-lib.sh | \
        scripts/production-deploy.sh | scripts/production-watch.sh | \
        scripts/production-status.sh | scripts/production-retry.sh | \
        scripts/production-rollback.sh)
        mark_application
        containers=1
        ;;

      frontend/src/*.test.ts | frontend/src/*.spec.ts | frontend/src/*/*.test.ts | \
        frontend/src/*/*.spec.ts | frontend/src/*/*/*.test.ts | \
        frontend/src/*/*/*.spec.ts | frontend/src/*/*/*/*.test.ts | \
        frontend/src/*/*/*/*.spec.ts | frontend/tests/unit/*)
        mark_application
        frontend=1
        ;;

      backend/*_test.go | backend/*/*_test.go | backend/*/*/*_test.go | \
        backend/*/*/*/*_test.go | backend/*/*/*/*/*_test.go)
        mark_application
        backend=1
        ;;

      frontend/src/*)
        mark_application
        frontend=1
        e2e=1
        preview=1
        ;;

      frontend/vite.config.ts | frontend/nginx.conf | frontend/tsconfig*.json)
        mark_application
        frontend=1
        containers=1
        e2e=1
        local_e2e=1
        preview=1
        ;;

      frontend/*)
        mark_application
        frontend=1
        ;;

      backend/internal/* | backend/cmd/* | backend/db/* | backend/scripts/*)
        mark_application
        backend=1
        e2e=1
        preview=1
        ;;

      backend/*)
        mark_full
        ;;

      *)
        mark_full
        ;;
    esac
  done
  IFS=${old_ifs}
fi

if [ "${frontend}" = "1" ] && [ "${backend}" = "1" ] && [ "${e2e}" = "1" ]; then
  local_e2e=1
fi

if [ "${output}" = "checks" ]; then
  printf '%s\n' \
    "impact=${impact}" \
    "contracts=${contracts}" \
    "frontend=${frontend}" \
    "backend=${backend}" \
    "containers=${containers}" \
    "e2e=${e2e}" \
    "local_e2e=${local_e2e}" \
    "preview=${preview}"
else
  if [ -z "${changed_files}" ]; then
    echo none
  else
    echo "${impact}"
  fi
fi
