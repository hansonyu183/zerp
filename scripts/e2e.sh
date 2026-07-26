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

test "${APP_ENV:-}" = "test" || {
  echo "E2E APP_ENV must be test" >&2
  exit 1
}
test "${POSTGRES_DB:-}" = "zerp_e2e" || {
  echo "E2E POSTGRES_DB must be zerp_e2e" >&2
  exit 1
}
test "${POSTGRES_PORT:-}" = "55435" || {
  echo "E2E POSTGRES_PORT must be 55435" >&2
  exit 1
}
test "${API_PORT:-}" = "18081" || {
  echo "E2E API_PORT must be 18081" >&2
  exit 1
}
test "${WEB_PORT:-}" = "15174" || {
  echo "E2E WEB_PORT must be 15174" >&2
  exit 1
}
test "${APP_SESSION_COOKIE_NAME:-}" = "zerp_e2e_session" || {
  echo "E2E cookie name must be zerp_e2e_session" >&2
  exit 1
}
test "${FEEDBACK_GITHUB_ENABLED:-}" = "false" || {
  echo "E2E feedback publishing must be disabled" >&2
  exit 1
}

export E2E_API_BASE_URL="http://127.0.0.1:${API_PORT:-18081}/"
export E2E_APP_BASE_URL="http://127.0.0.1:${WEB_PORT:-15174}"
export E2E_USERNAME="${APP_BOOTSTRAP_USERNAME}"
export E2E_PASSWORD="${APP_BOOTSTRAP_PASSWORD}"
export E2E_WFL_BOOTSTRAP=true
export E2E_LED_READONLY=1

cleanup() {
  docker compose --env-file backend/.env.e2e.local \
    -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml down --volumes --remove-orphans
}
trap cleanup EXIT HUP INT TERM

cleanup

docker compose --env-file backend/.env.e2e.local \
  -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml up --build -d --wait

pnpm --filter @zerp/frontend test:e2e
