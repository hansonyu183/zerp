#!/bin/sh
set -eu

if [ -n "${ZERP_E2E_REPO_ROOT:-}" ]; then
  repo_root=$(CDPATH='' cd -- "${ZERP_E2E_REPO_ROOT}" && pwd -P)
else
  repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
fi
cd "${repo_root}"

e2e_env_file=${ZERP_E2E_ENV_FILE:-${repo_root}/backend/.env.e2e.local}
case "${e2e_env_file}" in
  /*) ;;
  *) echo 'ZERP_E2E_ENV_FILE must be an absolute path' >&2; exit 2 ;;
esac
if [ -z "${ZERP_E2E_ENV_FILE:-}" ] && [ ! -f "${e2e_env_file}" ]; then
  backend/scripts/init-e2e-env.sh
fi
[ -f "${e2e_env_file}" ] || {
  echo "E2E environment file is unavailable: ${e2e_env_file}" >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
. "${e2e_env_file}"
set +a

test "${APP_ENV:-}" = "test" || { echo "E2E APP_ENV must be test" >&2; exit 1; }
test "${POSTGRES_DB:-}" = "zerp_e2e" || { echo "E2E POSTGRES_DB must be zerp_e2e" >&2; exit 1; }
test "${POSTGRES_USER:-}" = "zerp_e2e" || { echo "E2E POSTGRES_USER must be zerp_e2e" >&2; exit 1; }
test "${POSTGRES_PORT:-}" = "55435" || { echo "E2E POSTGRES_PORT must be 55435" >&2; exit 1; }
test "${API_PORT:-}" = "18081" || { echo "E2E API_PORT must be 18081" >&2; exit 1; }
test "${WEB_PORT:-}" = "15174" || { echo "E2E WEB_PORT must be 15174" >&2; exit 1; }
test "${APP_SESSION_COOKIE_NAME:-}" = "zerp_e2e_session" || { echo "E2E cookie name must be zerp_e2e_session" >&2; exit 1; }
test "${FEEDBACK_GITHUB_ENABLED:-}" = "false" || { echo "E2E feedback publishing must be disabled" >&2; exit 1; }
expected_database_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable"
test "${DATABASE_URL:-}" = "${expected_database_url}" || {
  echo "E2E DATABASE_URL must target the validated disposable PostgreSQL instance" >&2
  exit 1
}

runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/zerp-e2e.XXXXXX")
api_pid=
web_pid=
compose() {
  docker compose --env-file "${e2e_env_file}" \
    -p zerp-fullstack-e2e -f backend/compose.e2e.yaml "$@"
}

cleanup() {
  cleanup_status=$1
  trap - EXIT HUP INT TERM
  set +e
  if [ -n "${web_pid}" ]; then kill "${web_pid}" 2>/dev/null || true; fi
  if [ -n "${api_pid}" ]; then kill "${api_pid}" 2>/dev/null || true; fi
  if [ -n "${web_pid}" ]; then wait "${web_pid}" 2>/dev/null || true; fi
  if [ -n "${api_pid}" ]; then wait "${api_pid}" 2>/dev/null || true; fi
  compose down --volumes --remove-orphans >/dev/null 2>&1
  compose_status=$?
  if [ "${cleanup_status}" -eq 0 ] && [ "${compose_status}" -ne 0 ]; then
    echo "failed to remove the disposable E2E database" >&2
    cleanup_status=${compose_status}
  fi
  case "${runtime_dir}" in
    "${TMPDIR:-/tmp}"/zerp-e2e.*)
      rm -rf "${runtime_dir}"
      runtime_status=$?
      if [ "${cleanup_status}" -eq 0 ] && [ "${runtime_status}" -ne 0 ]; then
        echo "failed to remove the E2E runtime directory" >&2
        cleanup_status=${runtime_status}
      fi
      ;;
    *)
      echo "refusing to remove unexpected E2E runtime directory: ${runtime_dir}" >&2
      if [ "${cleanup_status}" -eq 0 ]; then cleanup_status=1; fi
      ;;
  esac
  exit "${cleanup_status}"
}
trap 'cleanup $?' EXIT
trap 'cleanup 129' HUP
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

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
compose exec -T db psql -v ON_ERROR_STOP=1 \
  -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < backend/db/e2e-fixtures.sql

mkdir -p "${runtime_dir}/bin" "${runtime_dir}/attachments"
go -C backend build -trimpath -o "${runtime_dir}/bin/zerp-server" ./cmd/server
go -C backend build -trimpath -o "${runtime_dir}/bin/zerp-e2e-web" ./cmd/e2e-web
VITE_API_BASE_URL=/api/ pnpm --filter @zerp/frontend build

export HTTP_ADDRESS="127.0.0.1:${API_PORT}"
export ATTACHMENT_STORAGE_ROOT="${runtime_dir}/attachments"
"${runtime_dir}/bin/zerp-server" >"${runtime_dir}/api.log" 2>&1 &
api_pid=$!
wait_for_url "E2E API" "http://127.0.0.1:${API_PORT}/readyz"

"${runtime_dir}/bin/zerp-e2e-web" \
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

if [ "$#" -gt 0 ]; then
  pnpm --filter @zerp/frontend test:e2e "$@"
else
  pnpm --filter @zerp/frontend test:e2e
fi
