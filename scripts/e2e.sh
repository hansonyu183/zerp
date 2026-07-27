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

fingerprint() {
  git ls-files --cached --others --exclude-standard -- "$@" |
    LC_ALL=C sort |
    while IFS= read -r file_name; do
      test -f "${file_name}" || continue
      printf '%s ' "${file_name}"
      git hash-object "${file_name}"
    done |
    git hash-object --stdin
}

backend_source=$(fingerprint backend)
web_source=$(fingerprint .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml frontend)
export ZERP_API_IMAGE="${ZERP_API_IMAGE:-zerp-e2e-api:cache}"
export ZERP_WEB_IMAGE="${ZERP_WEB_IMAGE:-zerp-e2e-web:cache}"

case "${E2E_SKIP_IMAGE_BUILD:-0}" in
  0 | 1) ;;
  *)
    echo "E2E_SKIP_IMAGE_BUILD must be 0 or 1" >&2
    exit 1
    ;;
esac
case "${E2E_FORCE_REBUILD:-0}" in
  0 | 1) ;;
  *)
    echo "E2E_FORCE_REBUILD must be 0 or 1" >&2
    exit 1
    ;;
esac
case "${E2E_PLAYWRIGHT_PROJECT:-}" in
  '' | chromium | mobile-chromium) ;;
  *)
    echo "E2E_PLAYWRIGHT_PROJECT must be chromium or mobile-chromium" >&2
    exit 1
    ;;
esac

cleanup() {
  docker compose --env-file backend/.env.e2e.local \
    -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml down --volumes --remove-orphans
}
trap cleanup EXIT HUP INT TERM

cleanup

image_source() {
  docker image inspect "$1" \
    --format '{{index .Config.Labels "io.zerp.e2e.source"}}' 2>/dev/null ||
    true
}

build_image() {
  image=$1
  source_fingerprint=$2
  shift 2

  current_source=$(image_source "${image}")
  if [ "${E2E_FORCE_REBUILD:-0}" = "0" ] &&
    [ "${current_source}" = "${source_fingerprint}" ]; then
    echo "Reusing E2E image ${image}"
    return
  fi

  docker build \
    --label "io.zerp.e2e.source=${source_fingerprint}" \
    --tag "${image}" \
    "$@"
}

if [ "${E2E_SKIP_IMAGE_BUILD:-0}" = "1" ]; then
  docker image inspect "${ZERP_API_IMAGE}" >/dev/null
  docker image inspect "${ZERP_WEB_IMAGE}" >/dev/null
  echo "Using prebuilt E2E images"
else
  build_image "${ZERP_API_IMAGE}" "${backend_source}" backend
  build_image "${ZERP_WEB_IMAGE}" "${web_source}" \
    --file frontend/Dockerfile .
fi

docker compose --env-file backend/.env.e2e.local \
  -p zerp-fullstack-e2e -f compose.yaml -f compose.e2e.yaml up --no-build -d --wait

if [ -n "${E2E_PLAYWRIGHT_PROJECT:-}" ]; then
  pnpm --filter @zerp/frontend exec playwright test --project="${E2E_PLAYWRIGHT_PROJECT}"
else
  pnpm --filter @zerp/frontend test:e2e
fi
