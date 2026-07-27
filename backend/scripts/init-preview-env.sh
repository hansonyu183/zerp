#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
target=${ZERP_PREVIEW_ENV_FILE:-${repo_root}/.env.preview.local}
target_dir=$(dirname "${target}")

if [ "$#" -ne 0 ]; then
  echo "usage: $0" >&2
  exit 2
fi

if [ -e "${target}" ]; then
  echo ".env.preview.local already exists; refusing to overwrite it" >&2
  exit 1
fi

umask 077
postgres_password=$(openssl rand -hex 24)
bootstrap_password="Preview!$(openssl rand -hex 16)Aa1"
temporary=$(mktemp "${target_dir}/.env.preview.local.tmp.XXXXXX")
trap 'rm -f "${temporary}"' EXIT HUP INT TERM

{
  printf '%s\n' \
    'APP_ENV=development' \
    'API_PORT=18082' \
    'WEB_PORT=15176' \
    'POSTGRES_PORT=55436' \
    'POSTGRES_DB=zerp_preview' \
    'POSTGRES_USER=zerp_preview'
  printf 'POSTGRES_PASSWORD=%s\n' "${postgres_password}"
  printf '%s\n' \
    'CORS_ALLOWED_ORIGINS=https://zerp-preview.bytesucceed.com' \
    'APP_SESSION_COOKIE_NAME=zerp_preview_session' \
    'APP_SESSION_COOKIE_SECURE=true' \
    'APP_SESSION_COOKIE_SAME_SITE=lax' \
    'APP_BOOTSTRAP_USERNAME=preview-admin' \
    'APP_BOOTSTRAP_DISPLAY_NAME=Preview-Administrator'
  printf 'APP_BOOTSTRAP_PASSWORD=%s\n' "${bootstrap_password}"
  printf '%s\n' 'FEEDBACK_GITHUB_ENABLED=false'
} >"${temporary}"

chmod 600 "${temporary}"
mv "${temporary}" "${target}"
trap - EXIT HUP INT TERM

echo "created ${target} with mode 600"
echo "administrator username: preview-admin"
