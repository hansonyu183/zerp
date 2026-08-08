#!/bin/sh
set -eu

if [ "$#" -lt 6 ]; then
  echo "usage: preview-build-sandbox.sh <primary-root> <source-root> <output-root> <cache-root> <secret-file> <command...>" >&2
  exit 2
fi

primary_root=$1
source_root=$2
output_root=$3
cache_root=$4
secret_file=$5
shift 5

[ "$#" -gt 0 ] || exit 2
[ "$(uname -s)" = Darwin ] || {
  echo "Fixed preview builds require the macOS sandbox" >&2
  exit 1
}
command -v sandbox-exec >/dev/null 2>&1 || {
  echo "sandbox-exec is required for fixed preview builds" >&2
  exit 1
}

for sandbox_path in "${primary_root}" "${source_root}" "${output_root}" \
  "${cache_root}" "${secret_file}" "${HOME:-}"; do
  case "${sandbox_path}" in
    /*) ;;
    *) echo "Preview sandbox paths must be absolute" >&2; exit 2 ;;
  esac
done

mkdir -p "${cache_root}"
primary_root=$(CDPATH='' cd -- "${primary_root}" && pwd -P)
source_root=$(CDPATH='' cd -- "${source_root}" && pwd -P)
output_root=$(CDPATH='' cd -- "${output_root}" && pwd -P)
cache_root=$(CDPATH='' cd -- "${cache_root}" && pwd -P)
secret_file=$(CDPATH='' cd -- "$(dirname -- "${secret_file}")" && \
  printf '%s/%s\n' "$(pwd -P)" "$(basename -- "${secret_file}")")
user_home=$(CDPATH='' cd -- "${HOME}" && pwd -P)
source_ancestor_1=$(dirname -- "${source_root}")
source_ancestor_2=$(dirname -- "${source_ancestor_1}")
source_ancestor_3=$(dirname -- "${source_ancestor_2}")
source_ancestor_4=$(dirname -- "${source_ancestor_3}")
source_ancestor_5=$(dirname -- "${source_ancestor_4}")
source_ancestor_6=$(dirname -- "${source_ancestor_5}")
source_ancestor_7=$(dirname -- "${source_ancestor_6}")
source_ancestor_8=$(dirname -- "${source_ancestor_7}")
source_ancestor_9=$(dirname -- "${source_ancestor_8}")
source_ancestor_10=$(dirname -- "${source_ancestor_9}")

sandbox_home="${cache_root}/home"
sandbox_tmp="${cache_root}/tmp"
go_cache="${cache_root}/go-build"
go_path="${cache_root}/go"
xdg_cache="${cache_root}/xdg"
npm_cache="${cache_root}/npm"
corepack_home="${cache_root}/corepack"
mkdir -p "${sandbox_home}" "${sandbox_tmp}" "${go_cache}" "${go_path}" \
  "${xdg_cache}" "${npm_cache}" "${corepack_home}"
chmod 700 "${cache_root}" "${sandbox_home}" "${sandbox_tmp}" \
  "${go_cache}" "${go_path}" "${xdg_cache}" "${npm_cache}" \
  "${corepack_home}"

# The source checkout may contain arbitrary PR-controlled lifecycle scripts.
# It can mutate only its disposable worktree, its output directory and a
# dedicated cache. The user's home, the trusted checkout and the preview
# environment remain unreadable even through symlinks.
profile='(version 1)
  (allow default)
  (deny file-read-data file-read-xattr
    (require-all
      (subpath (param "USER_HOME"))
      (require-not (subpath (param "SOURCE_ROOT")))
      (require-not (subpath (param "OUTPUT_ROOT")))
      (require-not (subpath (param "CACHE_ROOT")))))
  (deny file-read-data file-read-xattr
    (require-all
      (subpath (param "PRIMARY_ROOT"))
      (require-not (subpath (param "SOURCE_ROOT")))
      (require-not (subpath (param "OUTPUT_ROOT")))
      (require-not (subpath (param "CACHE_ROOT")))))
  (deny file-read-data file-read-xattr
    (literal (param "SECRET_FILE")))
  (allow file-read*
    (literal (param "SOURCE_ROOT"))
    (literal (param "SOURCE_ANCESTOR_1"))
    (literal (param "SOURCE_ANCESTOR_2"))
    (literal (param "SOURCE_ANCESTOR_3"))
    (literal (param "SOURCE_ANCESTOR_4"))
    (literal (param "SOURCE_ANCESTOR_5"))
    (literal (param "SOURCE_ANCESTOR_6"))
    (literal (param "SOURCE_ANCESTOR_7"))
    (literal (param "SOURCE_ANCESTOR_8"))
    (literal (param "SOURCE_ANCESTOR_9"))
    (literal (param "SOURCE_ANCESTOR_10")))
  (deny file-write*
    (require-all
      (require-not (subpath (param "SOURCE_ROOT")))
      (require-not (subpath (param "OUTPUT_ROOT")))
      (require-not (subpath (param "CACHE_ROOT")))
      (require-not (literal "/dev/null"))))
  (deny process-exec
    (require-all
      (subpath (param "USER_HOME"))
      (require-not (subpath (param "SOURCE_ROOT")))
      (require-not (subpath (param "OUTPUT_ROOT")))
      (require-not (subpath (param "CACHE_ROOT"))))
    (literal "/usr/bin/security")
    (literal "/usr/bin/ssh")
    (literal "/usr/bin/scp")
    (literal "/usr/bin/sftp")
    (literal "/usr/libexec/git-core/git-credential-osxkeychain"))
  (deny mach-lookup
    (global-name "com.apple.SecurityServer")
    (global-name "com.apple.securityd")
    (global-name "com.apple.security.agent")
    (global-name "com.apple.securityd.system")
    (global-name "com.apple.securityd.xpc"))'

safe_path=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
cd /
exec sandbox-exec \
  -D "USER_HOME=${user_home}" \
  -D "PRIMARY_ROOT=${primary_root}" \
  -D "SOURCE_ROOT=${source_root}" \
  -D "OUTPUT_ROOT=${output_root}" \
  -D "CACHE_ROOT=${cache_root}" \
  -D "SECRET_FILE=${secret_file}" \
  -D "SOURCE_ANCESTOR_1=${source_ancestor_1}" \
  -D "SOURCE_ANCESTOR_2=${source_ancestor_2}" \
  -D "SOURCE_ANCESTOR_3=${source_ancestor_3}" \
  -D "SOURCE_ANCESTOR_4=${source_ancestor_4}" \
  -D "SOURCE_ANCESTOR_5=${source_ancestor_5}" \
  -D "SOURCE_ANCESTOR_6=${source_ancestor_6}" \
  -D "SOURCE_ANCESTOR_7=${source_ancestor_7}" \
  -D "SOURCE_ANCESTOR_8=${source_ancestor_8}" \
  -D "SOURCE_ANCESTOR_9=${source_ancestor_9}" \
  -D "SOURCE_ANCESTOR_10=${source_ancestor_10}" \
  -p "${profile}" \
  /usr/bin/env -i \
    PATH="${safe_path}" \
    HOME="${sandbox_home}" \
    TMPDIR="${sandbox_tmp}" \
    GOCACHE="${go_cache}" \
    GOPATH="${go_path}" \
    GOMODCACHE="${go_path}/pkg/mod" \
    XDG_CACHE_HOME="${xdg_cache}" \
    npm_config_cache="${npm_cache}" \
    COREPACK_HOME="${corepack_home}" \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    CI=true \
    "$@"
