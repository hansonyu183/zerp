#!/bin/sh
set -eu

migration_dir=${1:-db/migrations}
failed=0

for migration in "${migration_dir}"/[0-9]*_*.sql; do
  final_up_statement=$(awk '
    /^--[[:space:]]*\+goose[[:space:]]+Down/ { exit }
    /^[[:space:]]*--/ { next }
    /^[[:space:]]*$/ { next }
    { statement=$0 }
    END { gsub(/^[[:space:]]+|[[:space:]]+$/, "", statement); print statement }
  ' "${migration}")
  if [ "${final_up_statement}" != 'SELECT rpt_validate_current_reports();' ]; then
    echo "${migration}: schema migration must end with RPT validation inside its transaction" >&2
    failed=1
  fi
done

exit "${failed}"
