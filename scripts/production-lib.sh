#!/bin/sh

production_repo_root() {
  CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd
}

production_primary_root() {
  if [ -n "${ZERP_PRODUCTION_STATE_ROOT:-}" ]; then
    printf '%s\n' "${ZERP_PRODUCTION_STATE_ROOT}"
    return
  fi

  common_git_dir=$(git -C "$(production_repo_root)" rev-parse --path-format=absolute --git-common-dir)
  dirname "${common_git_dir}"
}

production_runtime_root() {
  printf '%s\n' "${ZERP_PRODUCTION_RUNTIME_ROOT:-$(production_primary_root)/backend/var/production}"
}

production_env_file() {
  printf '%s\n' "${ZERP_PRODUCTION_ENV_FILE:-$(production_primary_root)/backend/.env.production.local}"
}

production_compose() {
  source_root=$1
  release_sha=$2
  api_image=$3
  web_image=$4
  shift 4

  env_file=$(production_env_file)
  ZERP_RELEASE_SHA="${release_sha}" \
  ZERP_API_IMAGE="${api_image}" \
  ZERP_WEB_IMAGE="${web_image}" \
    docker compose --env-file "${env_file}" \
      -p zerp-back \
      -f "${source_root}/compose.yaml" \
      -f "${source_root}/compose.production.yaml" "$@"
}

production_wait_url() {
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

production_wait_content() {
  label=$1
  url=$2
  expected=$3
  attempts=${4:-60}
  count=0

  until actual=$(curl --silent --show-error --fail "${url}") &&
    [ "${actual}" = "${expected}" ]; do
    count=$((count + 1))
    if [ "${count}" -ge "${attempts}" ]; then
      echo "${label} did not publish the expected release: ${url}" >&2
      return 1
    fi
    sleep 1
  done
}

production_load_cloudflare() {
  account_file=${CLOUDFLARE_ACCOUNT_FILE:-${HOME}/.secrets/cloudflare/account_id_bytesucceed}
  token_file=${CLOUDFLARE_PAGES_TOKEN_FILE:-${HOME}/.secrets/cloudflare/api_token_pages_deploy}

  test -r "${account_file}" || {
    echo "Missing Cloudflare account file: ${account_file}" >&2
    return 1
  }
  test -r "${token_file}" || {
    echo "Missing Cloudflare Pages token file: ${token_file}" >&2
    return 1
  }

  IFS= read -r CLOUDFLARE_ACCOUNT_ID < "${account_file}"
  IFS= read -r CLOUDFLARE_API_TOKEN < "${token_file}"
  export CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN
}

production_validate_release_ref() {
  release_ref=${1:-}
  test "${#release_ref}" -eq 40 || {
    echo "Release reference must be a full 40-character commit SHA" >&2
    return 1
  }
  case "${release_ref}" in
    *[!0-9a-f]*)
      echo "Release reference must be a lowercase hexadecimal commit SHA" >&2
      return 1
      ;;
  esac
}
