#!/usr/bin/env bash

# Build one fully migrated template database, then give every integration
# package a private clone. Keeping orchestration here makes cleanup reliable
# even when a package, migration, or signal terminates the full test gate.
set -euo pipefail

: "${ENV_FILE:=.env.local}"
: "${TEST_PROJECT:=zerp-api-test}"
: "${TEST_POSTGRES_PORT:=55434}"
: "${TEST_INTEGRATION_JOBS:=3}"

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

compose=(env "POSTGRES_PORT=$TEST_POSTGRES_PORT" docker compose -p "$TEST_PROJECT" --env-file "$ENV_FILE")
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

goose() {
	(
		cd tools
		go tool goose -dir ../db/migrations postgres "$1" "${@:2}"
	)
}

wait_for_packages() {
	local failed=0
	local index
	for ((index = 0; index < ${#package_pids[@]}; index++)); do
		if ! wait "${package_pids[index]}"; then
			echo "integration package failed: ${package_labels[index]}" >&2
			failed=1
		fi
	done
	package_pids=()
	package_labels=()
	return "$failed"
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

# The latest upgrade fixture verifies the historical-to-current path exactly
# once per invocation. The template itself deliberately uses a clean full
# migration, so every package starts from the same current schema.
latest_file="$(find db/migrations -maxdepth 1 -type f -name '[0-9]*_*.sql' | LC_ALL=C sort | tail -n 1)"
[[ -n "$latest_file" ]] || fail "no migrations found"
latest_prefix="${latest_file##*/}"
latest_prefix="${latest_prefix%%_*}"
latest_version="$(printf '%s' "$latest_prefix" | sed 's/^0*//')"
previous_version="$((latest_version - 1))"
before_fixture="db/migration-tests/${latest_prefix}_before.sql"
after_fixture="db/migration-tests/${latest_prefix}_after.sql"
[[ -f "$before_fixture" ]] || fail "missing migration upgrade fixture: $before_fixture"
[[ -f "$after_fixture" ]] || fail "missing migration upgrade fixture: $after_fixture"

recreate_database "$base_database"
base_url="$(database_url "$base_database")"
goose "$base_url" up-to "$previous_version"
"${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$base_database" < "$before_fixture"
goose "$base_url" up
"${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$base_database" < "$after_fixture"

recreate_database "$template_database"
template_url="$(database_url "$template_database")"
goose "$template_url" up

packages_file="$work_root/packages"
git ls-files --cached --others --exclude-standard -- '*_test.go' |
	while IFS= read -r file; do
		grep -q '^//go:build integration' "$file" && dirname "$file"
	done | LC_ALL=C sort -u > "$packages_file"
[[ -s "$packages_file" ]] || fail "no integration test packages found"

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
			break
		fi
	fi
done < "$packages_file"

if (( failed == 0 )) && ! wait_for_packages; then
	failed=1
fi

exit "$failed"
