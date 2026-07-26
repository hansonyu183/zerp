#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target="${repo_root}/.env.e2e.local"
rotate=false

if [ "${1:-}" = "--rotate" ]; then
  rotate=true
elif [ "$#" -ne 0 ]; then
  echo "usage: $0 [--rotate]" >&2
  exit 2
fi

if [ -e "${target}" ] && [ "${rotate}" != "true" ]; then
  echo ".env.e2e.local already exists; refusing to overwrite it" >&2
  exit 1
fi

postgres_password=$(openssl rand -hex 24)
bootstrap_password="E2e!$(openssl rand -hex 16)Aa1"
temporary=$(mktemp "${repo_root}/.env.e2e.local.tmp.XXXXXX")
trap 'rm -f "${temporary}"' EXIT HUP INT TERM

chmod 600 "${temporary}"
{
  printf '%s\n' \
    'APP_ENV=test' \
    'API_PORT=18080' \
    'POSTGRES_PORT=55433' \
    'POSTGRES_DB=zerp_e2e' \
    'POSTGRES_USER=zerp_e2e'
  printf 'POSTGRES_PASSWORD=%s\n' "${postgres_password}"
  printf 'DATABASE_URL=postgres://zerp_e2e:%s@127.0.0.1:55433/zerp_e2e?sslmode=disable\n' "${postgres_password}"
  printf '%s\n' \
    'CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173' \
    'APP_SESSION_COOKIE_NAME=zerp_e2e_session' \
    'APP_SESSION_COOKIE_SECURE=false' \
    'APP_SESSION_COOKIE_SAME_SITE=lax' \
    'APP_BOOTSTRAP_USERNAME=e2e-admin' \
    'APP_BOOTSTRAP_DISPLAY_NAME=E2E-Administrator'
  printf 'APP_BOOTSTRAP_PASSWORD=%s\n' "${bootstrap_password}"
  printf '%s\n' 'FEEDBACK_GITHUB_ENABLED=false'
} >"${temporary}"

mv "${temporary}" "${target}"
trap - EXIT HUP INT TERM
action="created"
if [ "${rotate}" = "true" ]; then
  action="rotated"
fi
echo "${action} ${target} with mode 600"
echo "administrator username: e2e-admin"
