#!/usr/bin/env bash

# Build one schema-initialized template database, then give every integration
# package a private clone. Keeping orchestration here makes cleanup reliable
# even when a package, schema load, or signal terminates the full test gate.
set -euo pipefail

: "${ENV_FILE:=.env.local}"
: "${TEST_PROJECT:=zerp-api-test}"
: "${TEST_POSTGRES_PORT:=55434}"
: "${TEST_INTEGRATION_JOBS:=3}"
: "${TEST_INTEGRATION_PACKAGES_FILE:=}"
: "${TEST_INTEGRATION_RESULT_FILE:=}"

fail() {
	echo "$*" >&2
	exit 1
}

[[ "$TEST_PROJECT" == "zerp-api-test" ]] || fail "refusing unexpected test project: $TEST_PROJECT"
[[ "${TEST_POSTGRES_DB:-}" =~ ^[A-Za-z0-9_]+_test$ ]] || fail "TEST_POSTGRES_DB must contain only letters, numbers, underscores, and end with _test"
[[ -n "${POSTGRES_USER:-}" ]] || fail "POSTGRES_USER is required"
[[ -n "${POSTGRES_PASSWORD:-}" ]] || fail "POSTGRES_PASSWORD is required"
[[ "$TEST_POSTGRES_PORT" =~ ^[0-9]+$ ]] || fail "TEST_POSTGRES_PORT must be numeric"
[[ "$TEST_POSTGRES_PORT" != "${POSTGRES_PORT:-5432}" ]] || fail "TEST_POSTGRES_PORT must differ from POSTGRES_PORT"
[[ "$TEST_INTEGRATION_JOBS" =~ ^[1-3]$ ]] || fail "TEST_INTEGRATION_JOBS must be between 1 and 3"
if [[ -n "$TEST_INTEGRATION_PACKAGES_FILE" ]]; then
	[[ "$TEST_INTEGRATION_PACKAGES_FILE" == /* ]] || fail "TEST_INTEGRATION_PACKAGES_FILE must be absolute"
	[[ -r "$TEST_INTEGRATION_PACKAGES_FILE" ]] || fail "TEST_INTEGRATION_PACKAGES_FILE must be readable"
fi
if [[ -n "$TEST_INTEGRATION_RESULT_FILE" ]]; then
	[[ "$TEST_INTEGRATION_RESULT_FILE" == /* ]] || fail "TEST_INTEGRATION_RESULT_FILE must be absolute"
	mkdir -p "$(dirname "$TEST_INTEGRATION_RESULT_FILE")"
	rm -f "$TEST_INTEGRATION_RESULT_FILE" "${TEST_INTEGRATION_RESULT_FILE}.new"
fi

compose=(env "POSTGRES_PORT=$TEST_POSTGRES_PORT" docker compose -p "$TEST_PROJECT" --env-file "$ENV_FILE" -f ../compose.yaml -f ../compose.dev.yaml)
base_database="$TEST_POSTGRES_DB"
database_stem="${base_database%_test}"
run_id="$$"

database_name() {
	local suffix="$1"
	local prefix_length=$((63 - ${#suffix}))
	(( prefix_length > 0 )) || fail "generated database suffix is too long"
	printf '%s%s' "${database_stem:0:prefix_length}" "$suffix"
}

template_database="$(database_name "_integration_template_${run_id}")"
work_root="$(pwd)/var/test-integration/${run_id}"
case "$work_root" in
	"$(pwd)"/var/test-integration/*) ;;
	*) fail "refusing unsafe integration work directory: $work_root" ;;
esac

clone_databases=()
package_pids=()
package_labels=()
package_results="$work_root/package-results.jsonl"

database_url() {
	printf 'postgres://%s:%s@127.0.0.1:%s/%s?sslmode=disable' \
		"$POSTGRES_USER" "$POSTGRES_PASSWORD" "$TEST_POSTGRES_PORT" "$1"
}

drop_database() {
	local database="$1"
	# shellcheck disable=SC2016 # Variables expand inside the container shell.
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'dropdb -U "$POSTGRES_USER" --if-exists --force "$TARGET_DATABASE"' </dev/null
}

create_database() {
	local database="$1"
	# shellcheck disable=SC2016 # Variables expand inside the container shell.
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'createdb -U "$POSTGRES_USER" "$TARGET_DATABASE"' </dev/null
}

recreate_database() {
	drop_database "$1"
	create_database "$1"
}

clone_database() {
	local database="$1"
	# shellcheck disable=SC2016 # Variables expand inside the container shell.
	"${compose[@]}" exec -T \
		-e TARGET_DATABASE="$database" \
		-e TEMPLATE_DATABASE="$template_database" \
		db sh -eu -c 'createdb -U "$POSTGRES_USER" -T "$TEMPLATE_DATABASE" "$TARGET_DATABASE"' </dev/null
}

initialize_schema() {
	local database="$1"
	# shellcheck disable=SC2016 # Variables expand inside the container shell.
	"${compose[@]}" exec -T \
		-e TARGET_DATABASE="$database" \
		db sh -eu -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/schema.sql
}

initialize_pre_cutover_schema() {
	local database="$1"
	git show d505c567:backend/db/schema.sql |
		"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
			'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"'
}

seed_issue_289_snapshot_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
INSERT INTO approval_entries(
  id,domain,entity,subject_id,version_no,status,revision,
  created_by,created_at,updated_by,updated_at
) VALUES (
  '01Z289PRODUCTENTRY00000001','dcl','product','01Z289PRODUCT0000000000001',1,'DRAFT',1,
  '01JAPPSYST3MACTR0000000000',now(),'01JAPPSYST3MACTR0000000000',now()
);
INSERT INTO dcl_product_versions(approval_entry_id,name,enabled)
VALUES('01Z289PRODUCTENTRY00000001','issue-289 cutover fixture',true);
INSERT INTO dcl_product_unit_conversions(
  product_approval_entry_id,unit_object_id,unit_approval_entry_id,
  unit_code,unit_name,unit_symbol,factor_micros
) VALUES (
  '01Z289PRODUCTENTRY00000001','01JAVX00000000000000000011','01JAVX00000000000000000012',
  'UNT-0001','千克','kg',1000000
);
SQL
}

run_issue_289_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-289-aux-snapshots.sql
}

verify_issue_289_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN (SELECT unit_quantity_scale FROM dcl_product_unit_conversions WHERE product_approval_entry_id='"'"'01Z289PRODUCTENTRY00000001'"'"')=6 AND NOT EXISTS (SELECT 1 FROM dcl_product_unit_conversions WHERE unit_quantity_scale IS NULL) THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

run_issue_290_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-290-aux-direct-crud.sql
}

verify_issue_290_order_guard() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.aux_version_payloads'"'"') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'aux_objects'"'"' AND column_name='"'"'data'"'"') THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_290_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.aux_version_payloads'"'"') IS NULL AND NOT EXISTS (SELECT 1 FROM approval_entries WHERE domain='"'"'aux'"'"') AND NOT EXISTS (SELECT 1 FROM dcl_customer_account_versions WHERE length(customer_type)<>26 OR customer_type_code='"'"''"'"' OR customer_type_name='"'"''"'"') AND NOT EXISTS (SELECT 1 FROM aux_objects WHERE entity='"'"'dictionary-item'"'"' AND (length(data->>'"'"'dictionaryTypeId'"'"')<>26 OR COALESCE(data->>'"'"'dictionaryTypeCode'"'"','"'"''"'"')='"'"''"'"' OR COALESCE(data->>'"'"'dictionaryTypeName'"'"','"'"''"'"')='"'"''"'"')) THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

wait_for_packages() {
	local failed=0
	local index exit_code status
	for ((index = 0; index < ${#package_pids[@]}; index++)); do
		if wait "${package_pids[index]}"; then
			exit_code=0
			status=passed
		else
			exit_code=$?
			status=failed
			echo "integration package failed: ${package_labels[index]}" >&2
			failed=1
		fi
		jq -nc --arg package "${package_labels[index]}" --arg status "$status" \
			--argjson exitCode "$exit_code" \
			'{package:$package,status:$status,exitCode:$exitCode}' >>"$package_results"
	done
	package_pids=()
	package_labels=()
	return "$failed"
}

write_results() {
	[[ -n "$TEST_INTEGRATION_RESULT_FILE" ]] || return 0
	jq -s '{version:1,status:(if any(.[]; .status == "failed") then "failed" else "passed" end),packages:.}' \
		"$package_results" >"${TEST_INTEGRATION_RESULT_FILE}.new"
	mv "${TEST_INTEGRATION_RESULT_FILE}.new" "$TEST_INTEGRATION_RESULT_FILE"
}

# shellcheck disable=SC2317,SC2329 # Invoked by the EXIT and signal traps below.
cleanup() {
	local status="$?"
	local cleanup_status=0
	local pid database
	trap - EXIT HUP INT TERM

	if (( ${#package_pids[@]} > 0 )); then
		for pid in "${package_pids[@]}"; do
			kill "$pid" 2>/dev/null || true
		done
		for pid in "${package_pids[@]}"; do
			wait "$pid" 2>/dev/null || true
		done
	fi

	if (( ${#clone_databases[@]} > 0 )); then
		for database in "${clone_databases[@]}"; do
			drop_database "$database" || cleanup_status=1
		done
	fi
	for database in "$template_database" "$base_database"; do
		drop_database "$database" || cleanup_status=1
	done
	rm -rf -- "$work_root" || cleanup_status=1
	"${compose[@]}" down --volumes --remove-orphans || cleanup_status=1

	if (( status == 0 && cleanup_status != 0 )); then
		status="$cleanup_status"
	fi
	exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$work_root"
"${compose[@]}" up -d --wait db

cutover_database="$(database_name "_issues_289_290_cutover_${run_id}_test")"
clone_databases+=("$cutover_database")
recreate_database "$cutover_database"
initialize_pre_cutover_schema "$cutover_database"
seed_issue_289_snapshot_fixture "$cutover_database"
if run_issue_290_cutover "$cutover_database" >/dev/null 2>&1; then
	fail "issue-290 cutover accepted execution before issue-289"
fi
verify_issue_290_order_guard "$cutover_database"

recreate_database "$cutover_database"
initialize_pre_cutover_schema "$cutover_database"
seed_issue_289_snapshot_fixture "$cutover_database"
run_issue_289_cutover "$cutover_database"
verify_issue_289_cutover "$cutover_database"
run_issue_290_cutover "$cutover_database"
verify_issue_290_cutover "$cutover_database"

recreate_database "$cutover_database"
initialize_pre_cutover_schema "$cutover_database"
seed_issue_289_snapshot_fixture "$cutover_database"
"${compose[@]}" exec -T -e TARGET_DATABASE="$cutover_database" db sh -eu -c \
	'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
	 "UPDATE aux_version_payloads SET data=data-'"'"'quantityScale'"'"' WHERE approval_entry_id='"'"'01JAVX00000000000000000012'"'"'"' </dev/null
if run_issue_289_cutover "$cutover_database" >/dev/null 2>&1; then
	fail "issue-289 cutover accepted an incomplete measurement-unit snapshot"
fi

recreate_database "$cutover_database"
initialize_pre_cutover_schema "$cutover_database"
seed_issue_289_snapshot_fixture "$cutover_database"
run_issue_289_cutover "$cutover_database"
"${compose[@]}" exec -T -e TARGET_DATABASE="$cutover_database" db sh -eu -c \
	'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
	 "DELETE FROM aux_version_payloads WHERE approval_entry_id=(SELECT id FROM approval_entries WHERE domain='"'"'aux'"'"' AND status='"'"'APPROVED'"'"' LIMIT 1)"' </dev/null
if run_issue_290_cutover "$cutover_database" >/dev/null 2>&1; then
	fail "issue-290 cutover accepted an approved AUX entry without a payload"
fi

recreate_database "$base_database"
initialize_schema "$base_database"

recreate_database "$template_database"
initialize_schema "$template_database"

all_packages_file="$work_root/all-packages"
git ls-files --cached --others --exclude-standard -- '*_test.go' |
	while IFS= read -r file; do
		grep -q '^//go:build integration' "$file" && dirname "$file"
	done | LC_ALL=C sort -u > "$all_packages_file"
[[ -s "$all_packages_file" ]] || fail "no integration test packages found"

packages_file="$all_packages_file"
if [[ -n "$TEST_INTEGRATION_PACKAGES_FILE" ]]; then
	packages_file="$work_root/selected-packages"
	: >"$packages_file"
	while IFS= read -r package || [[ -n "$package" ]]; do
		[[ -n "$package" ]] || fail "integration package selection contains an empty line"
		[[ "$package" =~ ^[A-Za-z0-9._/-]+$ && "$package" != *..* && "$package" != /* ]] ||
			fail "invalid integration package selection: $package"
		grep -Fxq "$package" "$all_packages_file" || fail "unknown integration package selection: $package"
		grep -Fxq "$package" "$packages_file" && fail "duplicate integration package selection: $package"
		printf '%s\n' "$package" >>"$packages_file"
	done <"$TEST_INTEGRATION_PACKAGES_FILE"
	[[ -s "$packages_file" ]] || fail "integration package selection is empty"
fi

: >"$package_results"

index=0
failed=0
while IFS= read -r package; do
	index=$((index + 1))
	package_database="$(database_name "_integration_${index}_${run_id}_test")"
	attachment_root="$work_root/attachments/${index}-${package//\//_}"
	mkdir -p "$attachment_root"
	clone_database "$package_database"
	clone_databases+=("$package_database")

	echo "==> isolated integration package $package"
	TEST_POSTGRES_DB="$package_database" \
	TEST_DATABASE_URL="$(database_url "$package_database")" \
	ATTACHMENT_STORAGE_ROOT="$attachment_root" \
		go test -tags=integration "./$package" -count=1 -v </dev/null &
	package_pids+=("$!")
	package_labels+=("$package")

	if (( ${#package_pids[@]} == TEST_INTEGRATION_JOBS )); then
		if ! wait_for_packages; then
			failed=1
		fi
	fi
done < "$packages_file"

if ! wait_for_packages; then
	failed=1
fi
write_results

exit "$failed"
