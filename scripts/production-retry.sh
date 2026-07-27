#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=production-lib.sh
# shellcheck disable=SC1091
. "${repo_root}/scripts/production-lib.sh"

runtime_root=$(production_runtime_root)
failed_file="${runtime_root}/failed-sha"
label=com.hansonyu.zerp-production-deploy

if [ ! -f "${failed_file}" ]; then
  echo "No blocked production release to retry"
  exit 0
fi

failed_sha=$(cat "${failed_file}")
rm -f "${failed_file}" "${runtime_root}/failed-sha.new"
launchctl kickstart -k "gui/$(id -u)/${label}"
echo "Production retry requested for ${failed_sha}"
