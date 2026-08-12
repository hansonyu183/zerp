#!/bin/sh
set -eu

migration_dir=${1:-db/migrations}
gate_version=73
failed=0

for migration in "${migration_dir}"/[0-9]*_*.sql; do
  name=${migration##*/}
  version=${name%%_*}
  version=$(printf '%s' "${version}" | sed 's/^0*//')
  [ -n "${version}" ] || version=0
  [ "${version}" -ge "${gate_version}" ] || continue
  if ! grep -Eq '^[[:space:]]*SELECT[[:space:]]+rpt_validate_current_reports\(\);[[:space:]]*$' "${migration}"; then
    echo "${migration}: schema migration must end with RPT validation inside its transaction" >&2
    failed=1
  fi
done

exit "${failed}"
