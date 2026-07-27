#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=production-lib.sh
. "${repo_root}/scripts/production-lib.sh"

runtime_root=$(production_runtime_root)
current_sha=$(cat "${runtime_root}/current-sha" 2>/dev/null || printf 'unmanaged')

echo "Production release: ${current_sha}"
docker inspect zerp-back-db-1 zerp-back-api-1 zerp-back-web-1 \
  --format '{{.Name}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} release={{index .Config.Labels "io.zerp.release"}}'
production_wait_url "Production API local" "http://127.0.0.1:8080/readyz" 1
production_wait_url "Production API public" "https://zerp-api.bytesucceed.com/readyz" 1
production_wait_url "Production frontend" "https://zerp.bytesucceed.com/" 1
echo "Production local and public health checks passed"
