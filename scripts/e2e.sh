#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

if [ ! -f backend/.env.e2e.local ]; then
  backend/scripts/init-e2e-env.sh
fi

set -a
. backend/.env.e2e.local
set +a

export E2E_API_BASE_URL="http://127.0.0.1:${API_PORT:-18080}/"
export E2E_APP_BASE_URL="http://127.0.0.1:${E2E_WEB_PORT:-15173}"
export E2E_USERNAME="${APP_BOOTSTRAP_USERNAME}"
export E2E_PASSWORD="${APP_BOOTSTRAP_PASSWORD}"
export E2E_WFL_BOOTSTRAP=true
export E2E_LED_READONLY=1

cleanup() {
  docker compose --env-file backend/.env.e2e.local \
    -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml down --volumes --remove-orphans
}
trap cleanup EXIT HUP INT TERM

docker compose --env-file backend/.env.e2e.local \
  -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml up --build -d --wait

pnpm --filter @zerp/frontend test:e2e
