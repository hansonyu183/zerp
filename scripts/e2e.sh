#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

if [ ! -f backend/.env.e2e.local ]; then
  backend/scripts/init-e2e-env.sh
fi

set -a
# shellcheck disable=SC1091
. backend/.env.e2e.local
set +a

test "${APP_ENV:-}" = "test" || { echo "E2E APP_ENV must be test" >&2; exit 1; }
test "${POSTGRES_DB:-}" = "zerp_e2e" || { echo "E2E POSTGRES_DB must be zerp_e2e" >&2; exit 1; }
test "${POSTGRES_PORT:-}" = "55435" || { echo "E2E POSTGRES_PORT must be 55435" >&2; exit 1; }
test "${API_PORT:-}" = "18081" || { echo "E2E API_PORT must be 18081" >&2; exit 1; }
test "${WEB_PORT:-}" = "15174" || { echo "E2E WEB_PORT must be 15174" >&2; exit 1; }
test "${APP_SESSION_COOKIE_NAME:-}" = "zerp_e2e_session" || { echo "E2E cookie name must be zerp_e2e_session" >&2; exit 1; }
test "${FEEDBACK_GITHUB_ENABLED:-}" = "false" || { echo "E2E feedback publishing must be disabled" >&2; exit 1; }

runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/zerp-e2e.XXXXXX")
api_pid=
web_pid=
compose() {
  docker compose --env-file backend/.env.e2e.local \
    -p zerp-fullstack-e2e -f backend/compose.e2e.yaml "$@"
}

cleanup() {
  cleanup_status=$?
  trap - EXIT HUP INT TERM
  if [ -n "${web_pid}" ]; then kill "${web_pid}" 2>/dev/null || true; fi
  if [ -n "${api_pid}" ]; then kill "${api_pid}" 2>/dev/null || true; fi
  if [ -n "${web_pid}" ]; then wait "${web_pid}" 2>/dev/null || true; fi
  if [ -n "${api_pid}" ]; then wait "${api_pid}" 2>/dev/null || true; fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [ "${cleanup_status}" -ne 0 ]; then
    test ! -f "${runtime_dir}/api.log" || tail -n 200 "${runtime_dir}/api.log" >&2
    test ! -f "${runtime_dir}/web.log" || tail -n 100 "${runtime_dir}/web.log" >&2
  fi
  case "${runtime_dir}" in
    "${TMPDIR:-/tmp}"/zerp-e2e.*) rm -rf "${runtime_dir}" ;;
    *) echo "refusing to remove unexpected E2E runtime directory: ${runtime_dir}" >&2 ;;
  esac
  exit "${cleanup_status}"
}
trap cleanup EXIT HUP INT TERM

wait_for_url() {
  label=$1
  url=$2
  attempts=${3:-60}
  count=0
  until curl --silent --show-error --fail --output /dev/null "${url}"; do
    count=$((count + 1))
    if [ "${count}" -ge "${attempts}" ]; then
      echo "${label} did not become healthy: ${url}" >&2
      return 1
    fi
    sleep 1
  done
}

compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up -d --wait db

go -C backend/tools tool goose -dir ../db/migrations postgres "${DATABASE_URL}" up
go -C backend run ./cmd/bootstrap-admin \
  -username "${APP_BOOTSTRAP_USERNAME}" \
  -display-name "${APP_BOOTSTRAP_DISPLAY_NAME}"
go -C backend run ./cmd/seed-bob

mkdir -p "${runtime_dir}/bin" "${runtime_dir}/attachments"
go -C backend build -trimpath -o "${runtime_dir}/bin/zerp-server" ./cmd/server
go -C backend build -trimpath -o "${runtime_dir}/bin/zerp-preview-web" ./cmd/preview-web
VITE_API_BASE_URL=/api/ pnpm --filter @zerp/frontend build

export HTTP_ADDRESS="127.0.0.1:${API_PORT}"
export ATTACHMENT_STORAGE_ROOT="${runtime_dir}/attachments"
"${runtime_dir}/bin/zerp-server" >"${runtime_dir}/api.log" 2>&1 &
api_pid=$!
wait_for_url "E2E API" "http://127.0.0.1:${API_PORT}/readyz"

"${runtime_dir}/bin/zerp-preview-web" \
  -listen "127.0.0.1:${WEB_PORT}" \
  -root "${repo_root}/frontend/dist" \
  -api "http://127.0.0.1:${API_PORT}" >"${runtime_dir}/web.log" 2>&1 &
web_pid=$!
wait_for_url "E2E web" "http://127.0.0.1:${WEB_PORT}/healthz"

export E2E_API_BASE_URL="http://127.0.0.1:${API_PORT}/"
export E2E_APP_BASE_URL="http://127.0.0.1:${WEB_PORT}"
export E2E_USERNAME="${APP_BOOTSTRAP_USERNAME}"
export E2E_PASSWORD="${APP_BOOTSTRAP_PASSWORD}"
export E2E_RUN_ID="${runtime_dir##*/}"
export E2E_DISPOSABLE_RUN_ID="${E2E_RUN_ID}"

pnpm --filter @zerp/frontend test:e2e
