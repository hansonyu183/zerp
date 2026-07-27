#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=production-lib.sh
. "${repo_root}/scripts/production-lib.sh"

release_sha=${1:-}
production_validate_release_ref "${release_sha}"
runtime_root=$(production_runtime_root)
release_root="${runtime_root}/releases/${release_sha}"
repository_root="${runtime_root}/repository"
source_root="${runtime_root}/rollback-source"

test -d "${release_root}" || {
  echo "Unknown production release: ${release_sha}" >&2
  exit 1
}
test "$(cat "${release_root}/status" 2>/dev/null)" = "success" || {
  echo "Release is not a successful rollback target: ${release_sha}" >&2
  exit 1
}

api_image=$(cat "${release_root}/api-image")
web_image=$(cat "${release_root}/web-image")

test -d "${repository_root}/.git" || {
  echo "Missing production repository: ${repository_root}" >&2
  exit 1
}

cleanup() {
  git -C "${repository_root}" worktree remove --force "${source_root}" >/dev/null 2>&1 || true
  git -C "${repository_root}" worktree prune >/dev/null 2>&1 || true
  rm -rf "${runtime_root}/rollback-frontend"
}
trap cleanup EXIT INT TERM
cleanup
git -C "${repository_root}" fetch origin main --prune
git -C "${repository_root}" worktree add --detach "${source_root}" "${release_sha}"

production_compose \
  "${source_root}" "${release_sha}" "${api_image}" "${web_image}" \
  up -d --no-build --wait db api web
production_wait_url "Production API local" "http://127.0.0.1:8080/readyz" 90
production_wait_url "Production API public" "https://zerp-api.bytesucceed.com/readyz" 90

production_load_cloudflare
restore_root="${runtime_root}/rollback-frontend"
mkdir -p "${restore_root}"
tar -xzf "${release_root}/frontend-dist.tar.gz" -C "${restore_root}"
wrangler pages deploy "${restore_root}/dist" \
  --project-name "${CLOUDFLARE_PAGES_PROJECT:-zerp}" \
  --branch main \
  --commit-hash "${release_sha}" \
  --commit-dirty=false

production_wait_content \
  "Production frontend" \
  "https://zerp.bytesucceed.com/_zerp-release" \
  "${release_sha}" 90
printf '%s\n' "${release_sha}" > "${runtime_root}/current-sha.new"
mv "${runtime_root}/current-sha.new" "${runtime_root}/current-sha"
echo "Production application rolled back to ${release_sha}; database was not changed"
