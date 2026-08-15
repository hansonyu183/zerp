#!/bin/sh
set -eu

repo_root=${ZERP_FINGERPRINT_REPO_ROOT:-$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)}
cd "${repo_root}"
ref=${1:-HEAD}
git rev-parse --verify "${ref}^{commit}" >/dev/null

git ls-tree -r --full-tree "${ref}" -- \
  .nvmrc package.json pnpm-lock.yaml pnpm-workspace.yaml \
  compose.yaml compose.preview.yaml \
  frontend/Dockerfile frontend/nginx.conf frontend/package.json \
  frontend/src frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json \
  backend/Dockerfile backend/go.mod backend/go.sum \
  backend/cmd backend/internal backend/db/migrations backend/db/queries \
  contracts/openapi |
  shasum -a 256 | awk '{print $1}'
