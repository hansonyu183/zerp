#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
common_git_dir=$(git -C "${repo_root}" rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "${common_git_dir}")
source_root=${ZERP_PREVIEW_SOURCE_ROOT:-${repo_root}}
env_file=${ZERP_PREVIEW_ENV_FILE:-${primary_root}/backend/.env.preview.local}
runtime_root=${ZERP_PREVIEW_RUNTIME_ROOT:-${primary_root}/backend/var/preview-native}
releases_root="${runtime_root}/releases"
current_link="${runtime_root}/current"
previous_link="${runtime_root}/previous"
postgres_data="${runtime_root}/postgres-data"
attachment_root="${runtime_root}/attachments"
launch_agent_root="${runtime_root}/launch-agents"
backup_root="${runtime_root}/backups"
native_ready="${runtime_root}/native-ready"
skip_legacy_import="${runtime_root}/skip-legacy-import"
legacy_import_complete="${runtime_root}/legacy-import-complete"
preview_url=https://zerp-preview.bytesucceed.com
legacy_project=zerp-fullstack-preview
system_user_id=01JAPPSYST3MACTR0000000000
db_label=com.hansonyu.zerp-preview-db
api_label=com.hansonyu.zerp-preview-api
web_label=com.hansonyu.zerp-preview-web
reap_label=com.hansonyu.zerp-preview-reap
launch_domain="gui/$(id -u)"
build_temp=

usage() {
  echo "usage: $0 {up|build|activate|stop-app|restart-app|down|reset|rollback|status|password|reap|close|accept|promote|gc}" >&2
  exit 2
}

cleanup() {
  if [ -n "${build_temp}" ] && [ -d "${build_temp}" ]; then
    rm -rf "${build_temp}"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

legacy_compose() {
  docker compose --env-file "${env_file}" \
    -p "${legacy_project}" -f "${repo_root}/compose.yaml" \
    -f "${repo_root}/compose.preview.yaml" "$@"
}

ensure_env() {
  if [ ! -f "${env_file}" ]; then
    ZERP_PREVIEW_ENV_FILE="${env_file}" \
      "${repo_root}/backend/scripts/init-preview-env.sh"
  fi
  chmod 600 "${env_file}"
}

guard() {
  ensure_env
  set -a
  # shellcheck disable=SC1090
  . "${env_file}"
  set +a

  test "${APP_ENV:-}" = development || {
    echo "Preview APP_ENV must be development" >&2
    exit 1
  }
  test "${POSTGRES_DB:-}" = zerp_preview || {
    echo "Preview POSTGRES_DB must be zerp_preview" >&2
    exit 1
  }
  test "${POSTGRES_USER:-}" = zerp_preview || {
    echo "Preview POSTGRES_USER must be zerp_preview" >&2
    exit 1
  }
  test "${POSTGRES_PORT:-}" = 55436 || {
    echo "Preview POSTGRES_PORT must be 55436" >&2
    exit 1
  }
  test "${API_PORT:-}" = 18082 || {
    echo "Preview API_PORT must be 18082" >&2
    exit 1
  }
  test "${WEB_PORT:-}" = 15176 || {
    echo "Preview WEB_PORT must be 15176" >&2
    exit 1
  }
  test "${CORS_ALLOWED_ORIGINS:-}" = "${preview_url}" || {
    echo "Preview CORS must allow only ${preview_url}" >&2
    exit 1
  }
  test "${APP_SESSION_COOKIE_NAME:-}" = zerp_preview_session || {
    echo "Preview cookie name must be zerp_preview_session" >&2
    exit 1
  }
  test "${APP_SESSION_COOKIE_SECURE:-}" = true || {
    echo "Preview cookie must be Secure" >&2
    exit 1
  }
  test "${APP_SESSION_COOKIE_SAME_SITE:-}" = lax || {
    echo "Preview cookie SameSite must be lax" >&2
    exit 1
  }
  test "${FEEDBACK_GITHUB_ENABLED:-}" = false || {
    echo "Preview feedback publishing must be disabled" >&2
    exit 1
  }
  test -n "${POSTGRES_PASSWORD:-}" || {
    echo "Preview PostgreSQL password is missing" >&2
    exit 1
  }
  case "${POSTGRES_PASSWORD}" in
    *[!A-Za-z0-9._~-]*)
      echo "Preview PostgreSQL password must be URL-safe" >&2
      exit 1
      ;;
  esac
  test -n "${APP_BOOTSTRAP_PASSWORD:-}" || {
    echo "Preview administrator password is missing" >&2
    exit 1
  }
  command -v go >/dev/null
  command -v pnpm >/dev/null
  command -v pg_config >/dev/null
  command -v launchctl >/dev/null
  command -v plutil >/dev/null
  command -v curl >/dev/null

  pg_bindir=$(pg_config --bindir)
  test -x "${pg_bindir}/initdb"
  test -x "${pg_bindir}/postgres"
  test -x "${pg_bindir}/pg_isready"
  database_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable"
  export pg_bindir database_url

  mkdir -p "${runtime_root}" "${releases_root}" "${launch_agent_root}" \
    "${backup_root}" "${attachment_root}"
  state_current="${runtime_root}/state/current"
  "${repo_root}/scripts/preview-state.sh" init
  preview_db="${POSTGRES_DB}"
  preview_attachment_root="${attachment_root}"
  if [ -f "${state_current}" ]; then
    preview_db=$(sed -n 's/^db=//p' "${state_current}")
    preview_attachment_root=$(sed -n 's/^attachments=//p' "${state_current}")
  fi
  database_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${preview_db}?sslmode=disable"
  export preview_db preview_attachment_root database_url
  chmod 700 "${runtime_root}" "${releases_root}" "${launch_agent_root}" \
    "${backup_root}" "${attachment_root}"
}

wait_for_url() {
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

wait_for_database() {
  attempts=30
  count=0
  until "${pg_bindir}/pg_isready" -q -h 127.0.0.1 -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}"; do
    count=$((count + 1))
    if [ "${count}" -ge "${attempts}" ]; then
      echo "Preview PostgreSQL did not become ready" >&2
      return 1
    fi
    sleep 1
  done
}

wait_for_release_marker() {
  label=$1
  base_url=$2
  expected=$3
  attempts=${4:-30}
  count=0
  while :; do
    actual=$(curl --silent --show-error --fail \
      "${base_url}/_zerp-release?preview-release=${expected}" 2>/dev/null || true)
    if [ "${actual}" = "${expected}" ]; then
      return 0
    fi
    count=$((count + 1))
    if [ "${count}" -ge "${attempts}" ]; then
      echo "${label} release marker is ${actual:-unavailable}; expected ${expected}" >&2
      return 1
    fi
    sleep 2
  done
}

warm_public_assets() {
  index_file=$(mktemp "${runtime_root}/preview-index.XXXXXX")
  cache_bust=${1:-$(date +%s)}
  if ! curl --silent --show-error --fail \
    --retry 15 --retry-all-errors --retry-delay 2 \
    --connect-timeout 10 --max-time 90 \
    --output "${index_file}" \
    "${preview_url}/signin?preview-release=${cache_bust}"; then
    rm -f "${index_file}"
    echo "Public preview entry could not be downloaded completely" >&2
    return 1
  fi

  assets=$(sed -n 's#.*\(/assets/[^"?]*\).*#\1#p' "${index_file}")
  rm -f "${index_file}"
  test -n "${assets}" || {
    echo "Public preview entry did not reference any built assets" >&2
    return 1
  }
  for asset in ${assets}; do
    echo "Warming public preview asset: ${asset}"
    curl --silent --show-error --fail --compressed \
      --retry 15 --retry-all-errors --retry-delay 2 \
      --connect-timeout 10 --max-time 90 \
      --output /dev/null "${preview_url}${asset}" || return 1
  done
}

release_identity() {
  if [ -n "${ZERP_RELEASE_SHA:-}" ]; then
    case "${ZERP_RELEASE_SHA}" in
      *[!0-9a-f]*)
        echo "ZERP_RELEASE_SHA must be a full lowercase commit SHA" >&2
        return 1
        ;;
    esac
    sha_length=$(printf '%s' "${ZERP_RELEASE_SHA}" | wc -c | tr -d ' ')
    test "${sha_length}" = 40 || {
      echo "ZERP_RELEASE_SHA must be a full lowercase commit SHA" >&2
      return 1
    }
    release_name=${ZERP_RELEASE_SHA}
    release_marker=${ZERP_RELEASE_SHA}
  else
    release_name="workspace-$(date -u +%Y%m%d%H%M%S)"
    release_marker=workspace
  fi
  release_dir="${releases_root}/${release_name}"
  export release_name release_marker release_dir
}

build_release() {
  build_cache="${runtime_root}/build-cache/${release_name}"
  validate_regular_tree() {
    artifact_root=$1
    invalid_artifact=$(find -P "${artifact_root}" ! -type f ! -type d -print -quit)
    test -z "${invalid_artifact}" || {
      echo "Preview release contains a symlink or special file: ${invalid_artifact}" >&2
      return 1
    }
  }
  remove_build_cache() {
    [ ! -e "${build_cache}" ] || {
      chmod -R u+w "${build_cache}"
      rm -rf "${build_cache}"
    }
  }
  if [ -x "${release_dir}/bin/zerp-server" ] && \
    [ -x "${release_dir}/bin/zerp-preview-web" ] && \
    [ -x "${release_dir}/bin/zerp-seed-preview" ] && \
    [ -x "${release_dir}/bin/goose" ] && \
    [ -f "${release_dir}/release-sha" ] && \
    [ -d "${release_dir}/migrations" ] && \
    [ -f "${release_dir}/web/index.html" ]; then
    validate_regular_tree "${release_dir}"
    remove_build_cache
    echo "Reusing native preview release ${release_name}"
    return
  fi

  if [ -e "${release_dir}" ]; then
    incomplete_release="${backup_root}/incomplete-${release_name}-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "${release_dir}" "${incomplete_release}"
    echo "Moved incomplete preview release to ${incomplete_release}" >&2
  fi

  build_temp=$(mktemp -d "${runtime_root}/release.${release_name}.XXXXXX")
  mkdir -p "${build_temp}/bin" "${build_temp}/web" "${build_temp}/migrations"
  sandbox_build() {
    "${repo_root}/scripts/preview-build-sandbox.sh" \
      "${primary_root}" "${source_root}" "${build_temp}" "${build_cache}" \
      "${env_file}" "$@"
  }
  sandbox_build_in() {
    # shellcheck disable=SC2016 # expanded by the inner trusted shell
    sandbox_build /bin/sh -c \
      'cd "$1" && shift && exec "$@"' preview-build "$@"
  }
  echo "Building native preview release ${release_name}"
  sandbox_build_in "${source_root}/backend" \
    go build -buildvcs=false -trimpath \
    -o "${build_temp}/bin/zerp-server" ./cmd/server
  sandbox_build_in "${source_root}/backend" \
    go build -buildvcs=false -trimpath \
    -o "${build_temp}/bin/zerp-preview-web" ./cmd/preview-web
  sandbox_build_in "${source_root}/backend" \
    go build -buildvcs=false -trimpath \
    -o "${build_temp}/bin/zerp-seed-preview" ./cmd/seed-preview
  sandbox_build_in "${source_root}/backend/tools" \
    go build -buildvcs=false -trimpath \
    -o "${build_temp}/bin/goose" github.com/pressly/goose/v3/cmd/goose

  sandbox_build_in "${source_root}" pnpm install --frozen-lockfile \
    --store-dir "${build_cache}/pnpm-store"
  if [ "${release_marker}" = workspace ]; then
    sandbox_build_in "${source_root}" /usr/bin/env VITE_API_BASE_URL=/api/ \
      pnpm --filter @zerp/frontend build
  else
    sandbox_build_in "${source_root}" /usr/bin/env VITE_API_BASE_URL=/api/ \
      GITHUB_SHA="${release_marker}" pnpm \
      --filter @zerp/frontend build
  fi

  for artifact_root in "${source_root}/frontend/dist" \
    "${source_root}/backend/db/migrations" "${build_temp}"; do
    validate_regular_tree "${artifact_root}"
  done
  cp -R "${source_root}/frontend/dist/." "${build_temp}/web/"
  cp -R "${source_root}/backend/db/migrations/." "${build_temp}/migrations/"
  printf '%s\n' "${release_marker}" >"${build_temp}/release-sha"
  printf '%s\n' "${release_marker}" >"${build_temp}/web/_zerp-release"
  validate_regular_tree "${build_temp}"
  chmod -R a+rX "${build_temp}"
  mv "${build_temp}" "${release_dir}"
  build_temp=
  remove_build_cache
}

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

write_script_agent() {
  label=$1
  script=$2
  log_file=$3
  plist="${launch_agent_root}/${label}.plist"
  cat >"${plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml_escape "${label}")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$(xml_escape "${script}")</string>
    <string>$(xml_escape "${runtime_root}")</string>
    <string>$(xml_escape "${env_file}")</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>WorkingDirectory</key><string>$(xml_escape "${runtime_root}")</string>
  <key>StandardOutPath</key><string>$(xml_escape "${log_file}")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "${log_file}")</string>
</dict>
</plist>
EOF
  chmod 600 "${plist}"
  plutil -lint "${plist}" >/dev/null
}

write_reaper_agent() {
  reap_runner="${runtime_root}/run-reap.sh"
  cat >"${reap_runner}" <<EOF
#!/bin/sh
set -eu
ZERP_PREVIEW_RUNTIME_ROOT="${runtime_root}" ZERP_PREVIEW_STATE_ROOT="${runtime_root}/state" \
  "${repo_root}/scripts/preview.sh" reap
EOF
  chmod 700 "${reap_runner}"
  plist="${launch_agent_root}/${reap_label}.plist"
  cat >"${plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${reap_label}</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>${reap_runner}</string></array>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>3600</integer><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>${runtime_root}/reap.log</string><key>StandardErrorPath</key><string>${runtime_root}/reap.log</string>
</dict></plist>
EOF
  chmod 600 "${plist}"
  plutil -lint "${plist}" >/dev/null
}

write_database_agent() {
  plist="${launch_agent_root}/${db_label}.plist"
  cat >"${plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${db_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "${pg_bindir}/postgres")</string>
    <string>-D</string><string>$(xml_escape "${postgres_data}")</string>
    <string>-h</string><string>127.0.0.1</string>
    <string>-p</string><string>${POSTGRES_PORT}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LANG</key><string>C</string>
    <key>LC_ALL</key><string>C</string>
  </dict>
  <key>WorkingDirectory</key><string>$(xml_escape "${runtime_root}")</string>
  <key>StandardOutPath</key><string>$(xml_escape "${runtime_root}/postgres.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "${runtime_root}/postgres.log")</string>
</dict>
</plist>
EOF
  chmod 600 "${plist}"
  plutil -lint "${plist}" >/dev/null
}

write_runtime_files() {
  api_runner="${runtime_root}/run-api.sh"
  web_runner="${runtime_root}/run-web.sh"
  runtime_sandbox="${runtime_root}/preview-runtime-sandbox.sh"
  cp "${repo_root}/scripts/preview-runtime-sandbox.sh" "${runtime_sandbox}"
  chmod 700 "${runtime_sandbox}"
  cat >"${api_runner}" <<'EOF'
#!/bin/sh
set -eu
runtime_root=$1
env_file=$2
primary_root=$(dirname "$(dirname "$(dirname "${runtime_root}")")")
set -a
# shellcheck disable=SC1090
. "${env_file}"
set +a
release_root=$(CDPATH='' cd -- "${runtime_root}/current" && pwd -P)
export HTTP_ADDRESS="127.0.0.1:${API_PORT}"
current_file="${runtime_root}/state/current"
preview_db=$(sed -n 's/^db=//p' "$current_file")
preview_attachments=$(sed -n 's/^attachments=//p' "$current_file")
sandbox_database_url="postgres://${POSTGRES_USER}@/${preview_db}?host=/tmp&port=${POSTGRES_PORT}&sslmode=disable"
exec "${runtime_root}/preview-runtime-sandbox.sh" api \
  "${primary_root}" "${runtime_root}" \
  "${release_root}" "${preview_attachments}" \
  /usr/bin/env APP_ENV="${APP_ENV}" HTTP_ADDRESS="127.0.0.1:${API_PORT}" \
  DATABASE_URL="${sandbox_database_url}" CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS}" \
  APP_SESSION_COOKIE_NAME="${APP_SESSION_COOKIE_NAME}" \
  APP_SESSION_COOKIE_SECURE="${APP_SESSION_COOKIE_SECURE}" \
  APP_SESSION_COOKIE_SAME_SITE="${APP_SESSION_COOKIE_SAME_SITE}" \
  FEEDBACK_GITHUB_ENABLED=false ATTACHMENT_STORAGE_ROOT="${preview_attachments}" \
  "${release_root}/bin/zerp-server"
EOF
  cat >"${web_runner}" <<'EOF'
#!/bin/sh
set -eu
runtime_root=$1
env_file=$2
primary_root=$(dirname "$(dirname "$(dirname "${runtime_root}")")")
set -a
# shellcheck disable=SC1090
. "${env_file}"
set +a
release_root=$(CDPATH='' cd -- "${runtime_root}/current" && pwd -P)
exec "${runtime_root}/preview-runtime-sandbox.sh" web \
  "${primary_root}" "${runtime_root}" \
  "${release_root}" "${runtime_root}/sandbox/web/attachments" \
  "${release_root}/bin/zerp-preview-web" \
  -listen "127.0.0.1:${WEB_PORT}" \
  -root "${release_root}/web" \
  -api "http://127.0.0.1:${API_PORT}"
EOF
  chmod 700 "${api_runner}" "${web_runner}"
  write_script_agent "${api_label}" "${api_runner}" "${runtime_root}/api.log"
  write_script_agent "${web_label}" "${web_runner}" "${runtime_root}/web.log"
  write_reaper_agent
  write_database_agent
}

job_loaded() {
  launchctl print "${launch_domain}/$1" >/dev/null 2>&1
}

start_job() {
  label=$1
  plist="${launch_agent_root}/${label}.plist"
  if ! job_loaded "${label}"; then
    launchctl bootstrap "${launch_domain}" "${plist}"
  fi
}

restart_job() {
  label=$1
  if job_loaded "${label}"; then
    launchctl kickstart -k "${launch_domain}/${label}"
  else
    start_job "${label}"
  fi
}

stop_job() {
  label=$1
  if job_loaded "${label}"; then
    launchctl bootout "${launch_domain}/${label}"
  fi
}

initialize_database_cluster() {
  if [ -f "${postgres_data}/PG_VERSION" ]; then
    return
  fi
  password_file=$(mktemp "${runtime_root}/postgres-password.XXXXXX")
  chmod 600 "${password_file}"
  printf '%s' "${POSTGRES_PASSWORD}" >"${password_file}"
  if ! "${pg_bindir}/initdb" -D "${postgres_data}" \
    --username="${POSTGRES_USER}" --pwfile="${password_file}" \
    --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C; then
    rm -f "${password_file}"
    return 1
  fi
  rm -f "${password_file}"
}

ensure_database_exists() {
  exists=$(PGPASSWORD="${POSTGRES_PASSWORD}" "${pg_bindir}/psql" \
    -h 127.0.0.1 -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'") || return 1
  if [ "${exists}" != 1 ]; then
    PGPASSWORD="${POSTGRES_PASSWORD}" "${pg_bindir}/createdb" \
      -h 127.0.0.1 -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
      "${POSTGRES_DB}"
  fi
}

legacy_container_exists() {
  docker inspect "${legacy_project}-db-1" >/dev/null 2>&1
}

legacy_container_running() {
  test "$(docker inspect "${legacy_project}-db-1" \
    --format '{{.State.Running}}' 2>/dev/null || true)" = true
}

stop_legacy_preview() {
  if legacy_container_running; then
    legacy_compose stop web api db
  fi
}

import_legacy_preview() {
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup_dir="${backup_root}/compose-${timestamp}"
  mkdir -p "${backup_dir}/attachments"
  chmod 700 "${backup_dir}" "${backup_dir}/attachments"
  echo "Backing up the existing Compose preview before native cutover"

  stop_job "${db_label}" || return 1
  legacy_compose up -d --wait db || return 1
  docker exec -i "${legacy_project}-db-1" \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc \
    >"${backup_dir}/database.dump" || return 1
  if docker inspect "${legacy_project}-api-1" >/dev/null 2>&1; then
    docker cp "${legacy_project}-api-1:/var/lib/zerp/attachments/." \
      "${backup_dir}/attachments/"
  fi
  legacy_compose stop web api db || return 1

  if [ -e "${postgres_data}" ]; then
    mv "${postgres_data}" "${backup_dir}/incomplete-postgres-data"
  fi
  initialize_database_cluster || return 1
  start_job "${db_label}" || return 1
  wait_for_database || return 1
  ensure_database_exists || return 1
  PGPASSWORD="${POSTGRES_PASSWORD}" "${pg_bindir}/pg_restore" \
    -h 127.0.0.1 -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" --no-owner --no-privileges \
    "${backup_dir}/database.dump" || return 1
  if [ -e "${attachment_root}" ]; then
    mv "${attachment_root}" "${backup_dir}/replaced-native-attachments"
  fi
  mkdir -p "${attachment_root}"
  chmod 700 "${attachment_root}"
  cp -R "${backup_dir}/attachments/." "${attachment_root}/" || return 1
  : >"${legacy_import_complete}"
  chmod 600 "${legacy_import_complete}"
  echo "Compose preview backup retained at ${backup_dir}"
}

prepare_database() {
  if [ ! -f "${skip_legacy_import}" ] && \
    [ ! -f "${legacy_import_complete}" ] && legacy_container_exists; then
    import_legacy_preview || return 1
    return 0
  fi

  if [ -f "${postgres_data}/PG_VERSION" ]; then
    stop_legacy_preview || return 1
    start_job "${db_label}" || return 1
    wait_for_database || return 1
    ensure_database_exists || return 1
    return
  fi

  initialize_database_cluster || return 1
  start_job "${db_label}" || return 1
  wait_for_database || return 1
  ensure_database_exists
}

run_release_setup() {
  release=$1
  sandbox_database_url="postgres://${POSTGRES_USER}@/${preview_db}?host=/tmp&port=${POSTGRES_PORT}&sslmode=disable"
  sandbox_setup() {
    "${runtime_root}/preview-runtime-sandbox.sh" api \
      "${primary_root}" "${runtime_root}" "${release}" \
      "${preview_attachment_root:-${attachment_root}}" "$@"
  }
  sandbox_setup /usr/bin/env DATABASE_URL="${sandbox_database_url}" \
    "${release}/bin/goose" \
    -dir "${release}/migrations" postgres "${sandbox_database_url}" up || return 1
  user_count=$(PGPASSWORD="${POSTGRES_PASSWORD}" "${pg_bindir}/psql" \
    -h 127.0.0.1 -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d "${preview_db:-${POSTGRES_DB}}" -Atqc \
    "SELECT count(*) FROM app_users WHERE id <> '${system_user_id}'") || return 1
  if [ "${user_count}" = 0 ]; then
    controller_sha=$(git -C "${repo_root}" rev-parse HEAD)
    controller_bin="${runtime_root}/controller-bin/${controller_sha}/zerp-bootstrap-admin"
    if [ ! -x "${controller_bin}" ]; then
      mkdir -p "$(dirname "${controller_bin}")"
      chmod 700 "${runtime_root}/controller-bin" "$(dirname "${controller_bin}")"
      (cd "${repo_root}/backend" && go build -buildvcs=false -trimpath \
        -o "${controller_bin}" ./cmd/bootstrap-admin) || return 1
      chmod 700 "${controller_bin}"
    fi
    APP_BOOTSTRAP_PASSWORD="${APP_BOOTSTRAP_PASSWORD}" \
      DATABASE_URL="${database_url}" "${controller_bin}" \
      -username "${APP_BOOTSTRAP_USERNAME}" \
      -display-name "${APP_BOOTSTRAP_DISPLAY_NAME}" || return 1
  else
    echo "Preview administrator already initialized"
  fi
  sandbox_setup /usr/bin/env DATABASE_URL="${sandbox_database_url}" \
    APP_ENV=development \
    ATTACHMENT_STORAGE_ROOT="${preview_attachment_root:-${attachment_root}}" \
    "${release}/bin/zerp-seed-preview"
}

atomic_symlink() (
  target=$1
  link=$2
  temporary_link="${link}.new.$$"
  rm -f "${temporary_link}"
  ln -s "${target}" "${temporary_link}"
  mv -h -f "${temporary_link}" "${link}"
)

activate_release() {
  target=$1
  old_target=$(readlink "${current_link}" 2>/dev/null || true)
  if [ -n "${old_target}" ] && [ "${old_target}" != "${target}" ]; then
    atomic_symlink "${old_target}" "${previous_link}"
  fi
  atomic_symlink "${target}" "${current_link}"
}

sync_release_to_state() {
  allow_exact_tree_relabel=${1:-0}
  desired_sha=$(sed -n 's/^sha=//p' "${runtime_root}/state/current")
  case "${desired_sha}" in
    *[!0-9a-f]* | '')
      echo "Preview state has an invalid release SHA: ${desired_sha:-missing}" >&2
      return 1
      ;;
  esac
  test "$(printf '%s' "${desired_sha}" | wc -c | tr -d ' ')" = 40 || {
    echo "Preview state release SHA must be full length" >&2
    return 1
  }

  desired_release="${releases_root}/${desired_sha}"
  if [ ! -d "${desired_release}" ]; then
    [ "${allow_exact_tree_relabel}" = 1 ] || {
      echo "Trusted preview release ${desired_sha} is not available for restoration" >&2
      return 1
    }
    current_release=$(CDPATH='' cd -- "${current_link}" && pwd -P)
    promoted_temp=$(mktemp -d "${runtime_root}/promoted.${desired_sha}.XXXXXX")
    if ! cp -Rp "${current_release}/." "${promoted_temp}/"; then
      rm -rf "${promoted_temp}"
      return 1
    fi
    printf '%s\n' "${desired_sha}" >"${promoted_temp}/release-sha"
    printf '%s\n' "${desired_sha}" >"${promoted_temp}/web/_zerp-release"
    chmod -R a+rX "${promoted_temp}"
    if ! mv "${promoted_temp}" "${desired_release}"; then
      rm -rf "${promoted_temp}"
      return 1
    fi
    echo "Reused exact-tree preview artifacts for merge ${desired_sha}"
  fi
  test "$(cat "${desired_release}/release-sha")" = "${desired_sha}" || {
    echo "Preview release marker does not match state ${desired_sha}" >&2
    return 1
  }
  activate_release "${desired_release}"
}

rollback_release_links() {
  current_target=$(readlink "${current_link}" 2>/dev/null || true)
  previous_target=$(readlink "${previous_link}" 2>/dev/null || true)
  if [ -z "${previous_target}" ] || [ ! -d "${previous_target}" ]; then
    return 1
  fi
  atomic_symlink "${previous_target}" "${current_link}"
  if [ -n "${current_target}" ]; then
    atomic_symlink "${current_target}" "${previous_link}"
  fi
}

restore_after_failed_deploy() {
  native_was_ready=$1
  release_was_activated=$2
  echo "Native preview deployment failed; restoring the previous runtime" >&2
  stop_job "${web_label}" || true
  stop_job "${api_label}" || true
  if [ "${native_was_ready}" = 1 ]; then
    if [ "${release_was_activated}" = 1 ]; then
      rollback_release_links || true
    fi
    restart_job "${api_label}" || true
    restart_job "${web_label}" || true
  else
    stop_job "${db_label}" || true
    if legacy_container_exists; then
      rm -f "${legacy_import_complete}"
      legacy_compose up -d --wait --no-build db api web || true
    fi
  fi
}

deploy_release() {
  prepare_database &&
    stop_job "${web_label}" &&
    stop_job "${api_label}" &&
    run_release_setup "${release_dir}" &&
    activate_release "${release_dir}" &&
    release_activated=1 &&
    restart_job "${api_label}" &&
    restart_job "${web_label}" &&
    start_job "${reap_label}" &&
    wait_for_url "Preview web" "http://127.0.0.1:${WEB_PORT}/healthz" &&
    wait_for_url "Preview API" "http://127.0.0.1:${API_PORT}/readyz" &&
    wait_for_release_marker \
      "Preview local" "http://127.0.0.1:${WEB_PORT}" "${release_marker}" 15 &&
    warm_public_assets "${release_marker}" &&
    wait_for_release_marker "Preview public" "${preview_url}" "${release_marker}" 30
}

build_only() {
  guard
  release_identity
  build_release
  echo "Native preview release built: ${release_marker}"
}

activate_only() {
  guard
  release_identity
  test -x "${release_dir}/bin/zerp-server" || {
    echo "Preview release ${release_marker} has not been built" >&2
    return 1
  }
  write_runtime_files
  native_was_ready=0
  release_activated=0
  [ -f "${native_ready}" ] && native_was_ready=1

  if ! deploy_release; then
    restore_after_failed_deploy "${native_was_ready}" "${release_activated}"
    return 1
  fi

  printf '%s\n' "${release_marker}" >"${native_ready}"
  chmod 600 "${native_ready}"
  rm -f "${skip_legacy_import}"
  echo "Native preview ready: ${preview_url} (${release_marker})"
}

up() {
  build_only
  activate_only
}

stop_apps() {
  guard
  stop_job "${web_label}"
  stop_job "${api_label}"
}

restart_apps() {
  guard
  write_runtime_files
  restart_job "${api_label}"
  restart_job "${web_label}"
  wait_for_url "Preview web" "http://127.0.0.1:${WEB_PORT}/healthz"
  wait_for_url "Preview API" "http://127.0.0.1:${API_PORT}/readyz"
}

reap_state() {
  guard
  before=$(cat "${runtime_root}/state/current")
  before_pr=$(sed -n 's/^id=//p' "${runtime_root}/state/current")
  before_kind=$(sed -n 's/^kind=//p' "${runtime_root}/state/current")
  "${repo_root}/scripts/preview-state.sh" reap
  after=$(cat "${runtime_root}/state/current")
  if [ "${before}" != "${after}" ]; then
    allow_relabel=0
    if [ "${before_kind}" = pr ] && \
      [ "$(sed -n 's/^status=//p' "${runtime_root}/state/prs/${before_pr}.state" 2>/dev/null)" = promoted ]; then
      allow_relabel=1
    fi
    stop_apps
    sync_release_to_state "${allow_relabel}"
    restart_apps
  fi
}

close_state() {
  stop_apps
  if "${repo_root}/scripts/preview-state.sh" close; then
    sync_release_to_state 0
    restart_apps
  else
    restart_apps || true
    return 1
  fi
}

promote_state() {
  guard
  stop_apps
  if "${repo_root}/scripts/preview-state.sh" promote; then
    sync_release_to_state 1
    restart_apps
  else
    restart_apps || true
    return 1
  fi
}

down() {
  guard
  stop_job "${web_label}"
  stop_job "${api_label}"
  stop_job "${reap_label}"
  stop_job "${db_label}"
  echo "Native preview stopped; database, attachments and releases were preserved"
}

reset() {
  guard
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup_dir="${backup_root}/reset-${timestamp}"
  mkdir -p "${backup_dir}"
  chmod 700 "${backup_dir}"
  stop_job "${web_label}"
  stop_job "${api_label}"
  stop_job "${reap_label}"
  stop_job "${db_label}"
  if [ -e "${postgres_data}" ]; then
    mv "${postgres_data}" "${backup_dir}/postgres-data"
  fi
  if [ -e "${attachment_root}" ]; then
    mv "${attachment_root}" "${backup_dir}/attachments"
  fi
  if [ -e "${runtime_root}/state" ]; then
    mv "${runtime_root}/state" "${backup_dir}/state"
  fi
  mkdir -p "${attachment_root}"
  chmod 700 "${attachment_root}"
  rm -f "${native_ready}"
  rm -f "${legacy_import_complete}"
  : >"${skip_legacy_import}"
  chmod 600 "${skip_legacy_import}"
  echo "Previous native preview data retained at ${backup_dir}"
  up
}

rollback() {
  guard
  write_runtime_files
  stop_job "${web_label}"
  stop_job "${api_label}"
  rollback_release_links || {
    echo "No previous native preview release is available" >&2
    return 1
  }
  restart_job "${api_label}"
  restart_job "${web_label}"
  wait_for_url "Preview web" "http://127.0.0.1:${WEB_PORT}/healthz"
  wait_for_url "Preview API" "http://127.0.0.1:${API_PORT}/readyz"
  release_marker=$(cat "${current_link}/release-sha")
  warm_public_assets "${release_marker}"
  printf '%s\n' "${release_marker}" >"${native_ready}"
  echo "Native preview rolled back to ${release_marker}"
}

status() {
  guard
  for label in "${db_label}" "${api_label}" "${web_label}"; do
    job_loaded "${label}" || {
      echo "Preview launchd job is not loaded: ${label}" >&2
      return 1
    }
  done
  wait_for_database
  wait_for_url "Preview web" "http://127.0.0.1:${WEB_PORT}/healthz" 1
  wait_for_url "Preview API" "http://127.0.0.1:${API_PORT}/readyz" 1
  wait_for_url "Public preview" "${preview_url}/healthz" 15
  release_marker=$(cat "${current_link}/release-sha")
  wait_for_release_marker \
    "Preview local" "http://127.0.0.1:${WEB_PORT}" "${release_marker}" 1
  wait_for_release_marker "Preview public" "${preview_url}" "${release_marker}" 15
  "${repo_root}/scripts/preview-state.sh" status
  echo "Native preview local and public health checks passed: ${preview_url} (${release_marker})"
}

password() {
  guard
  command -v pbcopy >/dev/null 2>&1 || {
    echo "pbcopy is required on macOS" >&2
    exit 1
  }
  printf '%s' "${APP_BOOTSTRAP_PASSWORD}" | pbcopy
  echo "Preview administrator password copied to the clipboard"
}

case "${1:-}" in
  up)
    [ "$#" -eq 1 ] || usage
    up
    ;;
  build)
    [ "$#" -eq 1 ] || usage
    build_only
    ;;
  activate)
    [ "$#" -eq 1 ] || usage
    activate_only
    ;;
  stop-app)
    [ "$#" -eq 1 ] || usage
    stop_apps
    ;;
  restart-app)
    [ "$#" -eq 1 ] || usage
    restart_apps
    ;;
  down)
    [ "$#" -eq 1 ] || usage
    down
    ;;
  reset)
    [ "$#" -eq 1 ] || usage
    reset
    ;;
  rollback)
    [ "$#" -eq 1 ] || usage
    rollback
    ;;
  status)
    [ "$#" -eq 1 ] || usage
    status
    ;;
  password)
    [ "$#" -eq 1 ] || usage
    password
    ;;
  reap)
    [ "$#" -eq 1 ] || usage
    reap_state
    ;;
  close)
    [ "$#" -eq 1 ] || usage
    close_state
    ;;
  promote)
    [ "$#" -eq 1 ] || usage
    promote_state
    ;;
  accept|gc)
    "${repo_root}/scripts/preview-state.sh" "$1"
    ;;
  *)
    usage
    ;;
esac
