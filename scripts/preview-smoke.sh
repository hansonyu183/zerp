#!/bin/sh
set -eu

repo_root=${ZERP_PREVIEW_SMOKE_REPO_ROOT:-$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)}
primary_root=${ZERP_PRIMARY_ROOT:-/Users/hansonyu/code/zerp}
env_file=${ZERP_PREVIEW_ENV_FILE:-${primary_root}/backend/.env.preview.local}
sha=${1:-${PREVIEW_REF:-}}

case "${sha}" in *[!0-9a-f]*) echo "preview SHA is invalid" >&2; exit 2 ;; esac
[ "${#sha}" -eq 40 ] || { echo "preview SHA must be full length" >&2; exit 2; }
[ -r "${env_file}" ] || { echo "preview environment is missing" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "${env_file}"
set +a

curl --silent --show-error --fail --output /dev/null "https://zerp-api.bytesucceed.com/readyz"
marker=$(curl --silent --show-error --fail "https://zerp-preview.bytesucceed.com/_zerp-release?preview-release=${sha}")
[ "${marker}" = "${sha}" ] || { echo "preview release marker is ${marker:-missing}; expected ${sha}" >&2; exit 1; }

ZERP_PREVIEW_URL=https://zerp-preview.bytesucceed.com \
ZERP_PREVIEW_USERNAME="${APP_BOOTSTRAP_USERNAME}" \
ZERP_PREVIEW_PASSWORD="${APP_BOOTSTRAP_PASSWORD}" \
ZERP_PREVIEW_SHA="${sha}" \
  pnpm --dir "${repo_root}/frontend" exec node scripts/preview-smoke.mjs

echo "Exact-SHA preview browser smoke passed for ${sha}"
