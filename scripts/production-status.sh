#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=production-lib.sh
# shellcheck disable=SC1091
. "${repo_root}/scripts/production-lib.sh"

runtime_root=$(production_runtime_root)
current_sha=$(cat "${runtime_root}/current-sha" 2>/dev/null || printf 'unmanaged')
failed_sha=$(cat "${runtime_root}/failed-sha" 2>/dev/null || true)

echo "Production release: ${current_sha}"
if [ -n "${failed_sha}" ]; then
  echo "Production deployment blocked for: ${failed_sha}" >&2
fi
docker inspect zerp-back-db-1 zerp-back-api-1 zerp-back-web-1 \
  --format '{{.Name}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} release={{index .Config.Labels "io.zerp.release"}}'
production_wait_url "Production API local" "http://127.0.0.1:8080/readyz" 15
production_wait_url "Production API public" "https://zerp-api.bytesucceed.com/readyz" 15
production_wait_url "Production frontend" "https://zerp.bytesucceed.com/" 15
if [ "${current_sha}" != "unmanaged" ]; then
  production_validate_release_ref "${current_sha}"
  production_wait_content \
    "Production frontend release" \
    "https://zerp.bytesucceed.com/_zerp-release" \
    "${current_sha}" 15
fi
echo "Production local and public health checks passed"
