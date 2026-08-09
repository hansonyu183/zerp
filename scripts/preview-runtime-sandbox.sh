#!/bin/sh
set -eu

if [ "$#" -lt 6 ]; then
  echo "usage: preview-runtime-sandbox.sh <api|web> <primary-root> <runtime-root> <release-root> <attachment-root> <command...>" >&2
  exit 2
fi

role=$1
primary_root=$2
runtime_root=$3
release_root=$4
attachment_root=$5
shift 5

case "${role}" in api | web) ;; *) echo "invalid preview runtime role" >&2; exit 2 ;; esac
[ "$#" -gt 0 ] || exit 2
[ "$(uname -s)" = Darwin ] || {
  echo "Fixed preview runtime requires the macOS sandbox" >&2
  exit 1
}
command -v sandbox-exec >/dev/null 2>&1 || {
  echo "sandbox-exec is required for fixed preview runtime" >&2
  exit 1
}

for path in "${primary_root}" "${runtime_root}" "${release_root}" \
  "${attachment_root}" "${HOME:-}"; do
  case "${path}" in /*) ;; *) echo "Preview runtime paths must be absolute" >&2; exit 2 ;; esac
done

mkdir -p "${attachment_root}" "${runtime_root}/sandbox/${role}/home" \
  "${runtime_root}/sandbox/${role}/tmp"
primary_root=$(CDPATH='' cd -- "${primary_root}" && pwd -P)
runtime_root=$(CDPATH='' cd -- "${runtime_root}" && pwd -P)
release_root=$(CDPATH='' cd -- "${release_root}" && pwd -P)
attachment_root=$(CDPATH='' cd -- "${attachment_root}" && pwd -P)
user_home=$(CDPATH='' cd -- "${HOME}" && pwd -P)
sandbox_root="${runtime_root}/sandbox/${role}"
sandbox_home="${sandbox_root}/home"
sandbox_tmp="${sandbox_root}/tmp"
chmod 700 "${runtime_root}/sandbox" "${sandbox_root}" "${sandbox_home}" \
  "${sandbox_tmp}" "${attachment_root}"

case "${role}" in
  api)
    network_rules='(allow network* (local ip "localhost:18082"))
      (allow network-outbound (remote ip "localhost:55436"))'
    ;;
  web)
    network_rules='(allow network* (local ip "localhost:15176"))
      (allow network-outbound (remote ip "localhost:18082"))'
    ;;
esac

# Release binaries are PR-produced input. They can read only their immutable
# release and isolated attachments below the project tree, can write only the
# attachment/scratch roots, and can talk only to the exact local dependency for
# their role. The clean environment is assembled by the trusted runner.
profile="(version 1)
  (allow default)
  (deny file-read-data file-read-xattr
    (require-all
      (subpath (param \"USER_HOME\"))
      (require-not (subpath (param \"RELEASE_ROOT\")))
      (require-not (subpath (param \"ATTACHMENT_ROOT\")))
      (require-not (subpath (param \"SANDBOX_ROOT\")))))
  (deny file-read-data file-read-xattr
    (require-all
      (subpath (param \"PRIMARY_ROOT\"))
      (require-not (subpath (param \"RELEASE_ROOT\")))
      (require-not (subpath (param \"ATTACHMENT_ROOT\")))
      (require-not (subpath (param \"SANDBOX_ROOT\")))))
  (deny file-write*
    (require-all
      (require-not (subpath (param \"ATTACHMENT_ROOT\")))
      (require-not (subpath (param \"SANDBOX_ROOT\")))
      (require-not (literal \"/dev/null\"))))
  (deny network*)
  ${network_rules}
  (deny process-exec
    (require-all
      (subpath (param \"USER_HOME\"))
      (require-not (subpath (param \"RELEASE_ROOT\"))))
    (literal \"/usr/bin/security\")
    (literal \"/usr/bin/pbcopy\")
    (literal \"/usr/bin/pbpaste\")
    (literal \"/usr/bin/open\")
    (literal \"/usr/bin/osascript\")
    (literal \"/usr/bin/automator\")
    (literal \"/usr/bin/shortcuts\")
    (literal \"/usr/bin/ssh\")
    (literal \"/usr/bin/scp\")
    (literal \"/usr/bin/sftp\")
    (literal \"/usr/libexec/git-core/git-credential-osxkeychain\"))
  (deny appleevent-send)
  (deny mach-lookup
    (global-name \"com.apple.coreservices.launchservicesd\")
    (global-name \"com.apple.lsd\")
    (global-name \"com.apple.appleeventsd\")
    (global-name \"com.apple.AEServer\")
    (global-name \"com.apple.hiservices-xpcservice\")
    (global-name \"com.apple.coreservices.sharedfilelistd\")
    (global-name \"com.apple.SecurityServer\")
    (global-name \"com.apple.securityd\")
    (global-name \"com.apple.security.agent\")
    (global-name \"com.apple.securityd.system\")
    (global-name \"com.apple.securityd.xpc\")
    (global-name \"com.apple.pboard\")
    (global-name \"com.apple.pasteboard.1\")
    (global-name \"com.apple.coreservices.uasharedpasteboardmanager.xpc\")
    (global-name \"com.apple.coreservices.uasharedpasteboardaux.xpc\")
    (global-name \"com.apple.coreservices.uauseractivitypasteboardclient.xpc\")
    (global-name \"com.apple.coreservices.uasharedpasteboardcontroll.xpc\"))"

exec sandbox-exec \
  -D "USER_HOME=${user_home}" \
  -D "PRIMARY_ROOT=${primary_root}" \
  -D "RELEASE_ROOT=${release_root}" \
  -D "ATTACHMENT_ROOT=${attachment_root}" \
  -D "SANDBOX_ROOT=${sandbox_root}" \
  -p "${profile}" \
  /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    HOME="${sandbox_home}" TMPDIR="${sandbox_tmp}" "$@"
