#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

test -f backend/.env.local || {
  echo "backend/.env.local is missing; copy backend/.env.example first" >&2
  exit 1
}

set -a
. backend/.env.local
set +a

docker compose --env-file backend/.env.local \
  -f compose.yaml -f compose.dev.yaml up -d --wait db
make -C backend ENV_FILE=.env.local migrate-up

exec pnpm exec concurrently --kill-others-on-fail --names api,web \
  "go -C backend/tools tool air -c ../.air.toml" \
  "pnpm --filter @zerp/frontend dev --host 127.0.0.1 --port 5173 --strictPort"
