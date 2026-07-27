#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "${repo_root}"

project=zerp-fullstack-preview
env_file=backend/.env.preview.local
preview_url=https://zerp-preview.bytesucceed.com

usage() {
  echo "usage: $0 {up|down|reset|status|password}" >&2
  exit 2
}

compose() {
  docker compose --env-file "${env_file}" \
    -p "${project}" -f compose.yaml -f compose.preview.yaml "$@"
}

ensure_env() {
  if [ ! -f "${env_file}" ]; then
    backend/scripts/init-preview-env.sh
  fi
  chmod 600 "${env_file}"
}

guard() {
  ensure_env
  set -a
  # shellcheck disable=SC1091
  . "./${env_file}"
  set +a

  test "${APP_ENV:-}" = "development" || {
    echo "Preview APP_ENV must be development" >&2
    exit 1
  }
  test "${POSTGRES_DB:-}" = "zerp_preview" || {
    echo "Preview POSTGRES_DB must be zerp_preview" >&2
    exit 1
  }
  test "${POSTGRES_USER:-}" = "zerp_preview" || {
    echo "Preview POSTGRES_USER must be zerp_preview" >&2
    exit 1
  }
  test "${POSTGRES_PORT:-}" = "55436" || {
    echo "Preview POSTGRES_PORT must be 55436" >&2
    exit 1
  }
  test "${API_PORT:-}" = "18082" || {
    echo "Preview API_PORT must be 18082" >&2
    exit 1
  }
  test "${WEB_PORT:-}" = "15176" || {
    echo "Preview WEB_PORT must be 15176" >&2
    exit 1
  }
  test "${CORS_ALLOWED_ORIGINS:-}" = "${preview_url}" || {
    echo "Preview CORS must allow only ${preview_url}" >&2
    exit 1
  }
  test "${APP_SESSION_COOKIE_NAME:-}" = "zerp_preview_session" || {
    echo "Preview cookie name must be zerp_preview_session" >&2
    exit 1
  }
  test "${APP_SESSION_COOKIE_SECURE:-}" = "true" || {
    echo "Preview cookie must be Secure" >&2
    exit 1
  }
  test "${APP_SESSION_COOKIE_SAME_SITE:-}" = "lax" || {
    echo "Preview cookie SameSite must be lax" >&2
    exit 1
  }
  test "${FEEDBACK_GITHUB_ENABLED:-}" = "false" || {
    echo "Preview feedback publishing must be disabled" >&2
    exit 1
  }
  test -n "${POSTGRES_PASSWORD:-}" || {
    echo "Preview PostgreSQL password is missing" >&2
    exit 1
  }
  test -n "${APP_BOOTSTRAP_PASSWORD:-}" || {
    echo "Preview administrator password is missing" >&2
    exit 1
  }
}

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

up() {
  guard

  compose build api migrate web
  compose up -d --wait db
  compose run --rm migrate

  user_count=$(
    compose exec -T db sh -eu -c \
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM app_users"'
  )
  if [ "${user_count}" = "0" ]; then
    compose run --rm --no-deps \
      --entrypoint /usr/local/bin/zerp-bootstrap-admin api \
      -username "${APP_BOOTSTRAP_USERNAME}" \
      -display-name "${APP_BOOTSTRAP_DISPLAY_NAME}"
  else
    echo "Preview administrator already initialized"
  fi

  compose run --rm --no-deps --entrypoint /usr/local/bin/zerp-seed-bob api
  compose up -d --wait --no-build api web

  wait_for_url "Preview web" "http://127.0.0.1:${WEB_PORT}/healthz"
  wait_for_url "Preview API" "http://127.0.0.1:${API_PORT}/readyz"
  echo "Preview ready: ${preview_url}"
}

down() {
  guard
  compose down --remove-orphans
  echo "Preview stopped; preview volumes were preserved"
}

reset() {
  guard
  echo "Removing only ${project} containers and volumes"
  compose down --volumes --remove-orphans
  up
}

status() {
  guard
  compose ps
  wait_for_url "Preview web" "http://127.0.0.1:${WEB_PORT}/healthz" 1
  wait_for_url "Preview API" "http://127.0.0.1:${API_PORT}/readyz" 1
  wait_for_url "Public preview" "${preview_url}/healthz" 1
  echo "Preview local and public health checks passed: ${preview_url}"
}

password() {
  guard
  command -v pbcopy >/dev/null 2>&1 || {
    echo "pbcopy is required on macOS" >&2
    exit 1
  }
  printf '%s' "${APP_BOOTSTRAP_PASSWORD}" | pbcopy
  echo "Preview administrator password copied to the clipboard"
}

case "${1:-}" in
  up)
    [ "$#" -eq 1 ] || usage
    up
    ;;
  down)
    [ "$#" -eq 1 ] || usage
    down
    ;;
  reset)
    [ "$#" -eq 1 ] || usage
    reset
    ;;
  status)
    [ "$#" -eq 1 ] || usage
    status
    ;;
  password)
    [ "$#" -eq 1 ] || usage
    password
    ;;
  *)
    usage
    ;;
esac
