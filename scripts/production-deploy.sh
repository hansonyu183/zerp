#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/production-lib.sh
. "${repo_root}/scripts/production-lib.sh"
# shellcheck source=scripts/check-run-provenance.sh
. "${repo_root}/scripts/check-run-provenance.sh"

release_sha=${1:-}
production_validate_release_ref "${release_sha}"
test "$(git -C "${repo_root}" rev-parse HEAD)" = "${release_sha}" || {
  echo "Production source checkout does not match ${release_sha}" >&2
  exit 1
}

runtime_root=$(production_runtime_root)
env_file=$(production_env_file)
release_root="${runtime_root}/releases/${release_sha}"
api_image="zerp-production-api:${release_sha}"
web_image="zerp-production-web:${release_sha}"
dry_run=${PRODUCTION_DRY_RUN:-0}

refresh_controller() {
  controller="${runtime_root}/production-watch.sh"
  candidate="${controller}.new"
  provenance="${runtime_root}/check-run-provenance.sh"
  provenance_candidate="${provenance}.new"
  cloudflare_account_file="${HOME}/.secrets/cloudflare/account_id_bytesucceed"
  cloudflare_token_file="${HOME}/.secrets/cloudflare/api_token_workers_access"
  if ! cloudflare_project_json=$(load_cloudflare_pages_project \
    "${cloudflare_account_file}" "${cloudflare_token_file}" zerp) ||
     ! verify_cloudflare_pages_project "${cloudflare_project_json}" \
       zerp hansonyu183 zerp main; then
    echo "Warning: production deploy controller not updated because Cloudflare Pages credentials could not verify the expected project" >&2
    return 0
  fi
  if cp "${repo_root}/scripts/check-run-provenance.sh" "${provenance_candidate}" &&
     sh -n "${provenance_candidate}" &&
     chmod 700 "${provenance_candidate}" &&
     mv "${provenance_candidate}" "${provenance}" &&
     cp "${repo_root}/scripts/production-watch.sh" "${candidate}" &&
     sh -n "${candidate}" &&
     chmod 700 "${candidate}" &&
     mv "${candidate}" "${controller}"; then
    echo "Production deploy controller updated"
  else
    rm -f "${candidate}" "${provenance_candidate}"
    echo "Warning: production deploy controller update failed" >&2
  fi
}

test -f "${env_file}" || {
  echo "Missing production environment: ${env_file}" >&2
  exit 1
}
test "$(stat -f '%Lp' "${env_file}")" = "600" || {
  echo "Production environment must have mode 600: ${env_file}" >&2
  exit 1
}

mkdir -p "${release_root}"
chmod 700 "${runtime_root}" "${runtime_root}/releases" "${release_root}"

fallback_api_image=
fallback_web_image=
if docker inspect zerp-back-api-1 >/dev/null 2>&1; then
  fallback_api_image="zerp-production-api:rollback-${release_sha}"
  docker tag "$(docker inspect zerp-back-api-1 --format '{{.Image}}')" "${fallback_api_image}"
fi
if docker inspect zerp-back-web-1 >/dev/null 2>&1; then
  fallback_web_image="zerp-production-web:rollback-${release_sha}"
  docker tag "$(docker inspect zerp-back-web-1 --format '{{.Image}}')" "${fallback_web_image}"
fi

printf '%s\n' "${fallback_api_image}" > "${release_root}/fallback-api-image"
printf '%s\n' "${fallback_web_image}" > "${release_root}/fallback-web-image"

echo "Building production release ${release_sha}"
docker build \
  --label "io.zerp.release=${release_sha}" \
  --tag "${api_image}" \
  "${repo_root}/backend"
docker build \
  --label "io.zerp.release=${release_sha}" \
  --build-arg VITE_API_BASE_URL=https://zerp-api.bytesucceed.com/ \
  --file "${repo_root}/frontend/Dockerfile" \
  --tag "${web_image}" \
  "${repo_root}"

pnpm --dir "${repo_root}" install --frozen-lockfile
pnpm --dir "${repo_root}" build:web
printf '%s\n' "${release_sha}" > "${repo_root}/frontend/dist/_zerp-release"
tar -czf "${release_root}/frontend-dist.tar.gz" -C "${repo_root}/frontend" dist

printf '%s\n' "${api_image}" > "${release_root}/api-image"
printf '%s\n' "${web_image}" > "${release_root}/web-image"

if ! docker inspect zerp-back-db-1 >/dev/null 2>&1; then
  echo "Starting fresh production database"
  production_compose \
    "${repo_root}" "${release_sha}" "${api_image}" "${web_image}" \
    up -d --no-build --wait db
elif [ "$(docker inspect zerp-back-db-1 --format '{{.State.Running}}')" != "true" ]; then
  docker start zerp-back-db-1 >/dev/null
fi
production_wait_database "Production database" zerp-back-db-1 60

echo "Backing up production data"
docker exec zerp-back-db-1 sh -eu -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "${release_root}/database-before.dump"
if docker inspect zerp-back-api-1 >/dev/null 2>&1; then
  docker exec zerp-back-api-1 sh -eu -c \
    'tar -czf - -C /var/lib/zerp attachments' \
    > "${release_root}/attachments-before.tar.gz"
else
  tar -czf "${release_root}/attachments-before.tar.gz" --files-from /dev/null
fi

if [ "${dry_run}" = "1" ]; then
  production_compose "${repo_root}" "${release_sha}" "${api_image}" "${web_image}" config --quiet
  printf '%s\n' dry-run > "${release_root}/status"
  echo "Production dry run passed for ${release_sha}"
  exit 0
fi

if ! production_wait_content \
  "Cloudflare Pages production" \
  "https://zerp.bytesucceed.com/_zerp-release" \
  "${release_sha}" 90; then
  printf '%s\n' failed > "${release_root}/status"
  exit 1
fi

rollback_backend() {
  if [ -n "${fallback_api_image}" ] && [ -n "${fallback_web_image}" ]; then
    echo "Rolling application containers back to their pre-deploy images" >&2
    production_compose \
      "${repo_root}" "rollback-${release_sha}" \
      "${fallback_api_image}" "${fallback_web_image}" \
      up -d --no-build --wait db api web || true
  fi
}

rollback_release() {
  rollback_backend
}
trap rollback_release HUP INT TERM

echo "Running production migrations"
if ! production_compose \
  "${repo_root}" "${release_sha}" "${api_image}" "${web_image}" \
  run --rm --no-deps migrate; then
  printf '%s\n' failed > "${release_root}/status"
  exit 1
fi

echo "Rolling out production containers"
if ! production_compose \
  "${repo_root}" "${release_sha}" "${api_image}" "${web_image}" \
  up -d --no-build --wait db api web; then
  rollback_backend
  printf '%s\n' failed > "${release_root}/status"
  exit 1
fi

if ! production_wait_url "Production API local" "http://127.0.0.1:8080/readyz" 90 ||
   ! production_wait_url "Production API public" "https://zerp-api.bytesucceed.com/readyz" 90; then
  rollback_backend
  printf '%s\n' failed > "${release_root}/status"
  exit 1
fi

if ! production_wait_content \
  "Production frontend" \
  "https://zerp.bytesucceed.com/_zerp-release" \
  "${release_sha}" 90; then
  rollback_release
  printf '%s\n' failed > "${release_root}/status"
  exit 1
fi

printf '%s\n' "${release_sha}" > "${runtime_root}/current-sha.new"
mv "${runtime_root}/current-sha.new" "${runtime_root}/current-sha"
printf '%s\n' success > "${release_root}/status"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "${release_root}/deployed-at"
refresh_controller
trap - HUP INT TERM

release_number=0
for old_release in $(ls -1dt "${runtime_root}"/releases/* 2>/dev/null || true); do
  test "$(cat "${old_release}/status" 2>/dev/null || true)" = success || continue
  release_number=$((release_number + 1))
  if [ "${release_number}" -gt 7 ]; then
    rm -rf "${old_release}"
  fi
done

echo "Production deployed commit: ${release_sha}"
