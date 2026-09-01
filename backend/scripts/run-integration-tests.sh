#!/usr/bin/env bash

# Build one schema-initialized template database, then give every integration
# package a private clone. Keeping orchestration here makes cleanup reliable
# even when a package, schema load, or signal terminates the full test gate.
# Variables inside single-quoted docker exec commands expand in the container.
# shellcheck disable=SC2016
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

initialize_historical_pre_issue_289_schema() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/fixtures/cutovers/historical-pre-issue-289.sql
}

verify_historical_pre_issue_289_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.aux_version_payloads'"'"') IS NOT NULL
		 AND EXISTS (SELECT 1 FROM aux_version_payloads WHERE approval_entry_id='"'"'01JAVX00000000000000000012'"'"' AND data->>'"'"'quantityScale'"'"'='"'"'6'"'"')
		 AND EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01JAVX00000000000000000012'"'"' AND domain='"'"'aux'"'"')
		 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

initialize_pre_issue_305_schema() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/fixtures/cutovers/pre-issue-305.sql
}

verify_pre_issue_305_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.bob_objects'"'"') IS NOT NULL
		 AND to_regclass('"'"'public.dcl_subjects'"'"') IS NOT NULL
		 AND to_regclass('"'"'public.dcl_wfl_process_definition_versions'"'"') IS NOT NULL
		 AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z30500000000000000000001'"'"' AND entity='"'"'operating-entity'"'"')
		 AND EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01Z30500000000000000000002'"'"' AND status='"'"'APPROVED'"'"' AND revision=3)
			 AND EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01Z30500000000000000000006'"'"' AND status='"'"'PENDING'"'"' AND revision=2)
			 AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z30500000000000000000001'"'"' AND created_at='"'"'2026-08-29 03:05:00+00'"'"' AND created_by='"'"'00000000000000000000000000'"'"')
			 AND EXISTS (SELECT 1 FROM bob_objects WHERE id='"'"'01Z30500000000000000000001'"'"' AND code='"'"'ENT-0305'"'"' AND revision=7)
			 AND EXISTS (SELECT 1 FROM bob_operating_entities WHERE object_id='"'"'01Z30500000000000000000001'"'"' AND source_approval_entry_id='"'"'01Z30500000000000000000002'"'"')
			 AND EXISTS (SELECT 1 FROM object_number_counters WHERE domain='"'"'bob'"'"' AND entity='"'"'operating-entity'"'"' AND last_value=305)
			 AND (SELECT count(*) FROM bob_objects WHERE id IN ('"'"'01Z31100000000000000000011'"'"','"'"'01Z31100000000000000000012'"'"','"'"'01Z31100000000000000000013'"'"','"'"'01Z31100000000000000000014'"'"','"'"'01Z31100000000000000000015'"'"','"'"'01Z31100000000000000000016'"'"','"'"'01Z31100000000000000000017'"'"'))=7
			 AND EXISTS (SELECT 1 FROM bob_customer_relationships WHERE object_id='"'"'01Z31100000000000000000012'"'"' AND merged_into_object_id='"'"'01Z31100000000000000000011'"'"')
			 AND EXISTS (SELECT 1 FROM bob_party_relationship_merge_events WHERE id='"'"'01Z31100000000000000000033'"'"' AND action='"'"'MERGED'"'"')
			 AND (SELECT count(*) FROM approval_entries WHERE id BETWEEN '"'"'01Z31100000000000000000021'"'"' AND '"'"'01Z31100000000000000000029'"'"' AND domain='"'"'dcl'"'"' AND status='"'"'APPROVED'"'"' AND revision=3)=9
			 AND (SELECT count(*) FROM approval_events WHERE entry_id BETWEEN '"'"'01Z31100000000000000000021'"'"' AND '"'"'01Z31100000000000000000029'"'"' AND action='"'"'APPROVED'"'"')=9
			 AND (SELECT count(*) FROM object_number_counters WHERE domain='"'"'bob'"'"' AND entity IN ('"'"'customer'"'"','"'"'employee'"'"','"'"'supplier'"'"','"'"'other-unit'"'"','"'"'sales-partner'"'"','"'"'customer-account'"'"'))=6
			 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

run_issue_305_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-305-dcl-subject-core-masters.sql
}

run_issue_308_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-308-dcl-party-relationships.sql
}

run_issue_309_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-309-dcl-reference-and-rpt-ownership.sql
}

run_issue_310_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-310-read-contract.sql
}

run_issue_311_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-311-final-cutover.sql
}

run_issue_315_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-315-vou-source-facts.sql
}

run_issue_316_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-316-wfl-identity-and-dcl-code.sql
}

run_issue_318_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-318-rpt-counter-and-terminology.sql
}

seed_issue_318_rpt_counter_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
UPDATE dcl_rpt_definition_code_counters
SET next_value=317
WHERE counter_key='default';
INSERT INTO dcl_subjects(id,entity,code,created_by)
VALUES(
  '01Z31800000000000000000001','rpt-definition','rpt-000318',
  '01JAPPSYST3MACTR0000000000'
);
SQL
}

verify_issue_318_failure_is_atomic() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.dcl_rpt_definition_code_counters'"'"') IS NOT NULL
		  AND NOT EXISTS (SELECT 1 FROM object_number_counters WHERE domain='"'"'dcl'"'"' AND entity='"'"'rpt-definition'"'"')
		  AND position('"'"'9999'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'object_number_counters'"'"'::regclass AND conname='"'"'object_number_counters_last_value_check'"'"')))>0
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_318_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "WITH next_number AS (
		    INSERT INTO object_number_counters(domain,entity,last_value)
		    VALUES ('"'"'dcl'"'"','"'"'rpt-definition'"'"',1)
		    ON CONFLICT(domain,entity) DO UPDATE
		    SET last_value=object_number_counters.last_value+1
		    RETURNING last_value
		  )
		  SELECT CASE WHEN to_regclass('"'"'public.dcl_rpt_definition_code_counters'"'"') IS NULL
		   AND (SELECT last_value FROM next_number)=319
		   AND position('"'"'999999'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'object_number_counters'"'"'::regclass AND conname='"'"'object_number_counters_last_value_check'"'"')))>0
		   THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

seed_issue_316_wfl_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
INSERT INTO wfl_process_definitions(id,code,enabled,created_at,created_by,updated_at,updated_by)
VALUES(
  '01Z31600000000000000000001','issue-316-workflow',true,
  '2026-08-29 04:01:02+00','01JAPPSYST3MACTR0000000000',
  '2026-08-29 05:02:03+00','01JAPPSYST3MACTR0000000000'
);
INSERT INTO dcl_subjects(id,entity,created_at,created_by)
VALUES('01Z31600000000000000000001','wfl-process-definition','2026-08-29 03:00:00+00','00000000000000000000000000');
INSERT INTO approval_entries(
  id,domain,entity,subject_id,version_no,status,revision,
  created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
) VALUES(
  '01Z31600000000000000000002','dcl','wfl-process-definition','01Z31600000000000000000001',4,'APPROVED',9,
  '01JAPPSYST3MACTR0000000000','2026-08-29 04:01:02+00','01JAPPSYST3MACTR0000000000','2026-08-29 05:02:03+00',
  '01JAPPSYST3MACTR0000000000','2026-08-29 04:30:00+00','01JAPPSYST3MACTR0000000001','2026-08-29 05:00:00+00'
);
INSERT INTO dcl_wfl_process_definition_versions(
  approval_entry_id,definition_id,script,compiled,last_trial_approval_revision,
  created_at,created_by,updated_at,updated_by
) VALUES(
  '01Z31600000000000000000002','01Z31600000000000000000001',
  'root = node(key="root", name="Issue 316", entity="sale-order")',
  '{"name":"Issue 316 workflow","rootKey":"root","nodes":[{"key":"root","name":"Issue 316","entity":"sale-order"}],"edges":[]}'::jsonb,8,
  '2026-08-29 04:01:02+00','01JAPPSYST3MACTR0000000000','2026-08-29 05:02:03+00','01JAPPSYST3MACTR0000000000'
);
INSERT INTO wfl_definition_instances(
  id,definition_id,definition_approval_entry_id,definition_code,definition_name,
  root_document_no,root_entity,revision,created_at,created_by,updated_at,updated_by
) VALUES(
  '01Z31600000000000000000003','01Z31600000000000000000001','01Z31600000000000000000002',
  'issue-316-workflow','Issue 316 workflow','SO-316','sale-order',5,
  '2026-08-29 05:03:00+00','01JAPPSYST3MACTR0000000000','2026-08-29 05:04:00+00','01JAPPSYST3MACTR0000000000'
);
INSERT INTO wfl_node_instances(
  id,process_id,node_key,node_name,document_no,document_entity,trigger_event,created_at
) VALUES(
  '01Z31600000000000000000004','01Z31600000000000000000003','root','Issue 316','SO-316','sale-order','EXECUTED','2026-08-29 05:03:00+00'
);
INSERT INTO wfl_create_child_requests(
  definition_id,request_key,process_id,parent_node_instance_id,target_node_key,created_at
) VALUES(
  '01Z31600000000000000000001','issue-316-child-request','01Z31600000000000000000003',
  '01Z31600000000000000000004','child','2026-08-29 05:04:00+00'
);
INSERT INTO wfl_runtime_audit_events(
  id,process_id,definition_id,definition_approval_entry_id,event_type,
  actor_id,request_id,summary,occurred_at
) VALUES(
  '01Z31600000000000000000005','01Z31600000000000000000003','01Z31600000000000000000001',
  '01Z31600000000000000000002','PROCESS_STARTED','01JAPPSYST3MACTR0000000000',
  'issue-316-audit','{"preserved":true}'::jsonb,'2026-08-29 05:05:00+00'
);
SQL
}

verify_issue_316_failure_is_atomic() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.wfl_process_definitions'"'"') IS NOT NULL
		  AND to_regclass('"'"'public.wfl_definition_runtime_states'"'"') IS NULL
		  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"'"'dcl_subjects'"'"'::regclass AND conname='"'"'dcl_subjects_code_check'"'"')
		  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z31600000000000000000099'"'"' AND entity='"'"'product'"'"' AND code='"'"'WHS-9999'"'"')
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_316_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.wfl_process_definitions'"'"') IS NULL
		  AND to_regclass('"'"'public.wfl_definition_runtime_states'"'"') IS NOT NULL
		  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z31600000000000000000001'"'"' AND entity='"'"'wfl-process-definition'"'"' AND code='"'"'issue-316-workflow'"'"' AND created_at='"'"'2026-08-29 04:01:02+00'"'"' AND created_by='"'"'01JAPPSYST3MACTR0000000000'"'"')
		  AND EXISTS (SELECT 1 FROM wfl_definition_runtime_states WHERE subject_id='"'"'01Z31600000000000000000001'"'"' AND enabled AND updated_at='"'"'2026-08-29 05:02:03+00'"'"' AND updated_by='"'"'01JAPPSYST3MACTR0000000000'"'"')
		  AND EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01Z31600000000000000000002'"'"' AND subject_id='"'"'01Z31600000000000000000001'"'"' AND status='"'"'APPROVED'"'"' AND revision=9)
		  AND EXISTS (SELECT 1 FROM dcl_wfl_process_definition_versions WHERE approval_entry_id='"'"'01Z31600000000000000000002'"'"' AND definition_id='"'"'01Z31600000000000000000001'"'"')
		  AND EXISTS (SELECT 1 FROM wfl_definition_instances WHERE id='"'"'01Z31600000000000000000003'"'"' AND definition_id='"'"'01Z31600000000000000000001'"'"' AND definition_approval_entry_id='"'"'01Z31600000000000000000002'"'"')
		  AND EXISTS (SELECT 1 FROM wfl_create_child_requests WHERE definition_id='"'"'01Z31600000000000000000001'"'"' AND request_key='"'"'issue-316-child-request'"'"' AND process_id='"'"'01Z31600000000000000000003'"'"')
		  AND EXISTS (SELECT 1 FROM wfl_runtime_audit_events WHERE id='"'"'01Z31600000000000000000005'"'"' AND definition_id='"'"'01Z31600000000000000000001'"'"' AND definition_approval_entry_id='"'"'01Z31600000000000000000002'"'"')
		  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z30500000000000000000001'"'"' AND code='"'"'OPE-0305'"'"')
		  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z31100000000000000000015'"'"' AND code='"'"'OTU-0311'"'"')
		  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z31100000000000000000016'"'"' AND code='"'"'SLP-0311'"'"')
		  AND NOT EXISTS (SELECT 1 FROM dcl_subjects WHERE code IS NULL AND entity NOT IN ('"'"'party'"'"','"'"'acc-mapping'"'"'))
		  AND NOT EXISTS (SELECT 1 FROM dcl_subjects WHERE code IS NOT NULL AND entity IN ('"'"'party'"'"','"'"'acc-mapping'"'"'))
		  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"'"'dcl_subjects'"'"'::regclass AND conname='"'"'dcl_subjects_code_ck'"'"')
		  AND position('"'"'wfl_definition_runtime_states'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'dcl_wfl_process_definition_versions'"'"'::regclass AND conname='"'"'dcl_wfl_process_definition_versions_definition_id_fkey'"'"')))>0
		  AND position('"'"'wfl_definition_runtime_states'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'wfl_definition_instances'"'"'::regclass AND conname='"'"'wfl_definition_instances_definition_id_fkey'"'"')))>0
		  AND position('"'"'wfl_definition_runtime_states'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'wfl_create_child_requests'"'"'::regclass AND conname='"'"'wfl_create_child_requests_definition_id_fkey'"'"')))>0
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_315_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='"'"'vou_sale_order_details'"'"'::regclass AND tgname='"'"'vou_sale_order_non_draft_immutable'"'"' AND NOT tgisinternal)
		  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='"'"'vou_purchase_order_details'"'"'::regclass AND tgname='"'"'vou_purchase_order_non_draft_immutable'"'"' AND NOT tgisinternal)
		  AND position('"'"'CASH_ON_DELIVERY'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'vou_sale_order_details'"'"'::regclass AND conname='"'"'vou_sale_order_settlement_ck'"'"'))) > 0
		  AND position('"'"'FIXED_DAY'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'vou_sale_order_details'"'"'::regclass AND conname='"'"'vou_sale_order_settlement_ck'"'"'))) = 0
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

seed_issue_315_other_unit_fixture() {
	local database="$1" entry_id="$2" day_offset="$3"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" -e ENTRY_ID="$entry_id" -e DAY_OFFSET="$day_offset" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -v ENTRY_ID="$ENTRY_ID" -v DAY_OFFSET="$DAY_OFFSET" -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
ALTER TABLE dcl_other_unit_versions DROP CONSTRAINT dcl_other_unit_settlement_ck;
ALTER TABLE dcl_other_unit_versions ADD CONSTRAINT dcl_other_unit_settlement_ck CHECK (
  (settlement_method_id IS NULL)=(settlement_method_code IS NULL)
  AND (settlement_method_id IS NULL)=(settlement_method_name IS NULL)
  AND (settlement_method_id IS NULL)=(settlement_term_code IS NULL)
  AND (settlement_method_id IS NULL)=(settlement_rule_type IS NULL)
  AND (settlement_method_id IS NOT NULL OR (settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0))
);
INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES
(:'ENTRY_ID','other-unit','OTU-031' || right(:'ENTRY_ID',1),'00000000000000000000000000'),
('01Z31500000000000000000090','operating-entity','OPE-0315','00000000000000000000000000')
ON CONFLICT DO NOTHING;
INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
VALUES ('01Z31500000000000000000091','dcl','operating-entity','01Z31500000000000000000090',1,'APPROVED',1,'00000000000000000000000000',now(),'00000000000000000000000000',now(),'00000000000000000000000000',now(),'00000000000000000000000001',now())
ON CONFLICT DO NOTHING;
INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
VALUES (:'ENTRY_ID','dcl','other-unit',:'ENTRY_ID',1,'APPROVED',1,'00000000000000000000000000',now(),'00000000000000000000000000',now(),'00000000000000000000000000',now(),'00000000000000000000000001',now());
INSERT INTO dcl_other_unit_versions(
  approval_entry_id,kind,legal_name,display_name,
  settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,
  settlement_month_offset,settlement_day_of_month,settlement_day_offset,
  default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,
  enabled
)
VALUES (
  :'ENTRY_ID','ORGANIZATION','issue-315 其他单位','issue-315 其他单位',
  '01JSMT00000000000000000005','STM-0003','货到3天','','RELATIVE_DAYS',0,0,:'DAY_OFFSET',
  '01Z31500000000000000000090','01Z31500000000000000000091','OPE-0315','issue-315 经营主体',
  true
);
SQL
}

verify_issue_315_exact_arrival_mapping() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN EXISTS (SELECT 1 FROM dcl_other_unit_versions WHERE settlement_method_code='"'"'STM-0003'"'"' AND settlement_term_code='"'"'ARRIVAL_3'"'"' AND settlement_rule_type='"'"'RELATIVE_DAYS'"'"' AND settlement_day_offset=3)
		  AND position('"'"'ARRIVAL_3'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'dcl_other_unit_versions'"'"'::regclass AND conname='"'"'dcl_other_unit_settlement_ck'"'"'))) > 0
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_315_ambiguous_failure_is_atomic() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN EXISTS (SELECT 1 FROM dcl_other_unit_versions WHERE settlement_method_code='"'"'STM-0003'"'"' AND settlement_term_code='"'"''"'"' AND settlement_rule_type='"'"'RELATIVE_DAYS'"'"' AND settlement_day_offset=0)
		  AND position('"'"'ARRIVAL_3'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'dcl_other_unit_versions'"'"'::regclass AND conname='"'"'dcl_other_unit_settlement_ck'"'"'))) = 0
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_311_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.bob_objects'"'"') IS NULL
			 AND NOT EXISTS (SELECT 1 FROM object_number_counters WHERE domain='"'"'bob'"'"')
			 AND NOT EXISTS (SELECT 1 FROM approval_entries WHERE domain='"'"'bob'"'"' AND version_no IS NOT NULL)
			 AND (SELECT count(*) FROM dcl_subjects WHERE id IN ('"'"'01Z31100000000000000000001'"'"','"'"'01Z31100000000000000000002'"'"','"'"'01Z31100000000000000000011'"'"','"'"'01Z31100000000000000000012'"'"','"'"'01Z31100000000000000000013'"'"','"'"'01Z31100000000000000000014'"'"','"'"'01Z31100000000000000000015'"'"','"'"'01Z31100000000000000000016'"'"','"'"'01Z31100000000000000000017'"'"'))=9
			 AND EXISTS (SELECT 1 FROM dcl_customer_relationships WHERE object_id='"'"'01Z31100000000000000000012'"'"' AND merged_into_object_id='"'"'01Z31100000000000000000011'"'"')
			 AND EXISTS (SELECT 1 FROM dcl_party_merge_events WHERE id='"'"'01Z31100000000000000000032'"'"' AND preflight_id='"'"'01Z31100000000000000000031'"'"')
			 AND EXISTS (SELECT 1 FROM dcl_party_relationship_merge_events WHERE id='"'"'01Z31100000000000000000033'"'"' AND source_object_id='"'"'01Z31100000000000000000012'"'"' AND target_object_id='"'"'01Z31100000000000000000011'"'"')
			 AND EXISTS (SELECT 1 FROM dcl_party_identifier_claims WHERE normalized_value='"'"'TAX-311-TARGET'"'"' AND approved_party_id='"'"'01Z31100000000000000000001'"'"' AND approved_approval_entry_id='"'"'01Z31100000000000000000021'"'"')
			 AND (SELECT count(*) FROM approval_entries WHERE id BETWEEN '"'"'01Z31100000000000000000021'"'"' AND '"'"'01Z31100000000000000000029'"'"' AND domain='"'"'dcl'"'"' AND version_no=1 AND revision=3)=9
			 AND EXISTS (SELECT 1 FROM approval_events WHERE id='"'"'01Z31100000000000000000041'"'"' AND entry_id='"'"'01Z31100000000000000000021'"'"' AND action='"'"'APPROVED'"'"' AND to_revision=3)
			 AND EXISTS (SELECT 1 FROM dcl_customer_account_versions WHERE approval_entry_id='"'"'01Z31100000000000000000029'"'"' AND name='"'"'Issue 311 Customer Account'"'"')
			 AND (SELECT count(*) FROM object_number_counters WHERE domain='"'"'dcl'"'"' AND entity IN ('"'"'customer'"'"','"'"'employee'"'"','"'"'supplier'"'"','"'"'other-unit'"'"','"'"'sales-partner'"'"','"'"'customer-account'"'"'))=6
			 AND NOT EXISTS (SELECT entity,upper(code) FROM dcl_subjects WHERE code IS NOT NULL GROUP BY entity,upper(code) HAVING count(*)>1)
		  AND position('"'"'bob'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'object_number_counters'"'"'::regclass AND conname='"'"'object_number_counters_domain_check'"'"')))=0
		 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_310_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN NOT EXISTS (
		    SELECT 1 FROM information_schema.columns
		    WHERE table_schema='"'"'public'"'"' AND table_name='"'"'wfl_process_definitions'"'"' AND column_name='"'"'revision'"'"'
		  ) THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_309_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.bob_objects'"'"') IS NULL
		  AND to_regclass('"'"'public.rpt_definitions'"'"') IS NULL
		  AND to_regclass('"'"'public.rpt_definition_validities'"'"') IS NOT NULL
		  AND NOT EXISTS (SELECT 1 FROM dcl_subjects WHERE entity='"'"'rpt-definition'"'"' AND code IS NULL)
		  AND NOT EXISTS (SELECT entity,upper(code) FROM dcl_subjects WHERE code IS NOT NULL GROUP BY entity,upper(code) HAVING count(*)>1)
		  AND (SELECT count(*) FROM dcl_rpt_definition_versions)=(SELECT count(*) FROM rpt_definition_validities)
		  AND NOT EXISTS (SELECT 1 FROM dcl_rpt_definition_versions snapshot LEFT JOIN rpt_definition_validities validity ON validity.approval_entry_id=snapshot.approval_entry_id WHERE validity.approval_entry_id IS NULL)
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_308_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.bob_parties'"'"') IS NULL
		  AND to_regclass('"'"'public.bob_party_currents'"'"') IS NULL
		  AND to_regclass('"'"'public.bob_customer_relationships'"'"') IS NULL
		  AND to_regclass('"'"'public.bob_customer_account_currents'"'"') IS NULL
		  AND to_regclass('"'"'public.dcl_parties'"'"') IS NOT NULL
		  AND to_regclass('"'"'public.dcl_customer_relationships'"'"') IS NOT NULL
		  AND to_regclass('"'"'public.dcl_customer_accounts'"'"') IS NOT NULL
			  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z31100000000000000000011'"'"' AND entity='"'"'customer'"'"' AND code='"'"'CUS-0311'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z31100000000000000000017'"'"' AND entity='"'"'customer-account'"'"' AND code='"'"'ACC-0311'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_parties WHERE id='"'"'01Z31100000000000000000002'"'"' AND merged_into_party_id='"'"'01Z31100000000000000000001'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_customer_relationships WHERE object_id='"'"'01Z31100000000000000000012'"'"' AND merged_into_object_id='"'"'01Z31100000000000000000011'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_customer_accounts WHERE object_id='"'"'01Z31100000000000000000017'"'"' AND customer_relationship_id='"'"'01Z31100000000000000000011'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_party_identifier_claims WHERE normalized_value='"'"'TAX-311-TARGET'"'"' AND approved_party_id='"'"'01Z31100000000000000000001'"'"' AND approved_approval_entry_id='"'"'01Z31100000000000000000021'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_party_merge_events WHERE id='"'"'01Z31100000000000000000032'"'"' AND preflight_id='"'"'01Z31100000000000000000031'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_party_relationship_merge_events WHERE id='"'"'01Z31100000000000000000033'"'"' AND source_object_id='"'"'01Z31100000000000000000012'"'"' AND target_object_id='"'"'01Z31100000000000000000011'"'"')
			  AND (SELECT count(*) FROM approval_entries WHERE id BETWEEN '"'"'01Z31100000000000000000021'"'"' AND '"'"'01Z31100000000000000000029'"'"' AND version_no=1 AND revision=3)=9
			  AND EXISTS (SELECT 1 FROM approval_events WHERE id='"'"'01Z31100000000000000000041'"'"' AND entry_id='"'"'01Z31100000000000000000021'"'"' AND action='"'"'APPROVED'"'"' AND to_revision=3)
			  AND EXISTS (SELECT 1 FROM dcl_party_versions WHERE approval_entry_id='"'"'01Z31100000000000000000021'"'"' AND party_id='"'"'01Z31100000000000000000001'"'"')
			  AND EXISTS (SELECT 1 FROM dcl_customer_account_versions WHERE approval_entry_id='"'"'01Z31100000000000000000029'"'"' AND name='"'"'Issue 311 Customer Account'"'"')
			  AND (SELECT count(*) FROM object_number_counters WHERE domain='"'"'dcl'"'"' AND entity IN ('"'"'customer'"'"','"'"'employee'"'"','"'"'supplier'"'"','"'"'other-unit'"'"','"'"'sales-partner'"'"','"'"'customer-account'"'"'))=6
			  AND to_regprocedure('"'"'public.bob_reject_merged_party_relationship()'"'"') IS NULL
			  AND to_regprocedure('"'"'public.dcl_reject_merged_party_relationship()'"'"') IS NOT NULL
			  AND to_regclass('"'"'public.dcl_party_merge_preflights_open_idx'"'"') IS NOT NULL
			  AND to_regclass('"'"'public.dcl_party_relationship_merge_events_source_idx'"'"') IS NOT NULL
			  AND EXISTS (SELECT 1 FROM pg_constraint
			    WHERE conrelid='"'"'public.dcl_party_merge_events'"'"'::regclass
			      AND conname='"'"'dcl_party_merge_events_preflight_id_key'"'"' AND contype='"'"'u'"'"')
			  AND (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
		    '"'"'dcl_customer_relationship_merged_party_ck'"'"',
		    '"'"'dcl_employment_relationship_merged_party_ck'"'"',
		    '"'"'dcl_supplier_relationship_merged_party_ck'"'"',
		    '"'"'dcl_service_relationship_merged_party_ck'"'"',
		    '"'"'dcl_sales_relationship_merged_party_ck'"'"'))=5
		  AND NOT EXISTS (SELECT entity,upper(code) FROM dcl_subjects WHERE code IS NOT NULL GROUP BY entity,upper(code) HAVING count(*)>1)
		  THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

verify_issue_305_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.bob_operating_entities'"'"') IS NULL
		  AND to_regclass('"'"'public.bob_warehouses'"'"') IS NULL
		  AND to_regclass('"'"'public.bob_vehicles'"'"') IS NULL
		  AND to_regclass('"'"'public.bob_fund_accounts'"'"') IS NULL
		  AND to_regclass('"'"'public.bob_products'"'"') IS NULL
		  AND NOT EXISTS (SELECT 1 FROM bob_objects WHERE entity IN ('"'"'operating-entity'"'"','"'"'warehouse'"'"','"'"'vehicle'"'"','"'"'fund-account'"'"','"'"'product'"'"'))
		  AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z30500000000000000000001'"'"' AND entity='"'"'operating-entity'"'"' AND code='"'"'ENT-0305'"'"' AND created_at='"'"'2026-08-29 03:00:00+00'"'"' AND created_by='"'"'01JAPPSYST3MACTR0000000000'"'"')
		  AND EXISTS (SELECT 1 FROM object_number_counters WHERE domain='"'"'dcl'"'"' AND entity='"'"'operating-entity'"'"' AND last_value>=305)
		 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
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

seed_issue_291_mapping_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
INSERT INTO app_users(id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by) VALUES
  ('01Z29100000000000000000001','issue-291-creator','Issue 291 Creator','hash','ENABLED',now(),'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
  ('01Z29100000000000000000002','issue-291-reviewer','Issue 291 Reviewer','hash','ENABLED',now(),'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');
INSERT INTO acc_books(id,code,name,start_month,base_currency,control_book,created_by,updated_by)
VALUES('01Z29100000000000000000003','ACC-0291','Issue 291 book','2026-08-01','CNY',true,'01Z29100000000000000000001','01Z29100000000000000000001');
INSERT INTO acc_mappings(id,book_id,vou_entity,created_by,updated_by)
VALUES('01Z29100000000000000000004','01Z29100000000000000000003','sale-order','01Z29100000000000000000001','01Z29100000000000000000001');
INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
VALUES('01Z29100000000000000000005','acc','mapping','01Z29100000000000000000004',1,'APPROVED',3,'01Z29100000000000000000001',now(),'01Z29100000000000000000002',now(),'01Z29100000000000000000001',now(),'01Z29100000000000000000002',now());
INSERT INTO acc_mapping_versions(approval_entry_id,mapping_id,default_result,definition,created_by,updated_by)
VALUES('01Z29100000000000000000005','01Z29100000000000000000004','UN_POST','{"rules":[],"templates":[]}'::jsonb,'01Z29100000000000000000001','01Z29100000000000000000002');
INSERT INTO approval_events(id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,request_id,created_at)
VALUES('01Z29100000000000000000006','01Z29100000000000000000005','acc','mapping','01Z29100000000000000000004',1,'APPROVED','PENDING','APPROVED',2,3,'01Z29100000000000000000002','issue-291-cutover',now());
INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,created_by,mapping_approval_entry_id,source_entity,source_revision,source_document_no)
VALUES('01Z29100000000000000000007','01Z29100000000000000000003','VOU','01Z29100000000000000000009','2026-08-28','01Z29100000000000000000001','01Z29100000000000000000005','sale-order',1,'SO-291');
INSERT INTO app_roles(id,code,name,status,created_by,updated_by)
VALUES('01Z29100000000000000000008','ROL-0291','Issue 291 role','ENABLED','01Z29100000000000000000001','01Z29100000000000000000001');
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
VALUES
  ('01Z29100000000000000000008','01JACC00000000000000000110','01Z29100000000000000000001'),
  ('01Z29100000000000000000008','01JACC00000000000000000111','01Z29100000000000000000001'),
  ('01Z29100000000000000000008','01JACC00000000000000000211','01Z29100000000000000000001'),
  ('01Z29100000000000000000008','01JACC00000000000000000212','01Z29100000000000000000001'),
  ('01Z29100000000000000000008','01JACC00000000000000000217','01Z29100000000000000000001');
SQL
}

run_issue_291_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-291-dcl-acc-mapping.sql
}

verify_issue_291_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.acc_mapping_versions'"'"') IS NULL
		 AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z29100000000000000000004'"'"' AND entity='"'"'acc-mapping'"'"')
		 AND EXISTS (SELECT 1 FROM dcl_acc_mapping_versions WHERE approval_entry_id='"'"'01Z29100000000000000000005'"'"' AND mapping_id='"'"'01Z29100000000000000000004'"'"' AND default_result='"'"'UN_POST'"'"' AND definition='"'"'{\"rules\":[],\"templates\":[]}'"'"'::jsonb)
		 AND EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01Z29100000000000000000005'"'"' AND domain='"'"'dcl'"'"' AND entity='"'"'acc-mapping'"'"' AND version_no=1 AND revision=3)
		 AND EXISTS (SELECT 1 FROM approval_events WHERE id='"'"'01Z29100000000000000000006'"'"' AND entry_id='"'"'01Z29100000000000000000005'"'"' AND domain='"'"'dcl'"'"' AND entity='"'"'acc-mapping'"'"')
		 AND EXISTS (SELECT 1 FROM acc_vouchers WHERE id='"'"'01Z29100000000000000000007'"'"' AND mapping_approval_entry_id='"'"'01Z29100000000000000000005'"'"')
		 AND NOT EXISTS (SELECT 1 FROM app_permissions WHERE id='"'"'01JACC00000000000000000212'"'"')
		 AND (SELECT count(*) FROM app_role_permissions WHERE role_id='"'"'01Z29100000000000000000008'"'"' AND permission_id IN ('"'"'01JACC00000000000000000217'"'"','"'"'01JACC00000000000000000218'"'"','"'"'01JACC00000000000000000219'"'"','"'"'01JACC00000000000000000220'"'"'))=4
		 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

seed_issue_292_report_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
INSERT INTO app_roles(id,code,name,status,created_by,updated_by)
VALUES('01Z29200000000000000000001','ROL-0292','Issue 292 role','ENABLED','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
VALUES
  ('01Z29200000000000000000001','01KRPT00000000000000000001','01JAPPSYST3MACTR0000000000'),
  ('01Z29200000000000000000001','01KRPT00000000000000000002','01JAPPSYST3MACTR0000000000'),
  ('01Z29200000000000000000001','01KRPT00000000000000000010','01JAPPSYST3MACTR0000000000'),
  ('01Z29200000000000000000001','01KRPT00000000000000000011','01JAPPSYST3MACTR0000000000');
INSERT INTO rpt_definitions(id,code,created_by,updated_by)
VALUES('01Z29200000000000000000002','issue-292-report','01Z29100000000000000000001','01Z29100000000000000000001');
INSERT INTO approval_entries(
  id,domain,entity,subject_id,version_no,status,revision,
  created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
) VALUES(
  '01Z29200000000000000000003','rpt','definition','01Z29200000000000000000002',1,'APPROVED',3,
  '01Z29100000000000000000001',now(),'01Z29100000000000000000002',now(),
  '01Z29100000000000000000001',now(),'01Z29100000000000000000002',now()
);
INSERT INTO rpt_versions(
  approval_entry_id,definition_id,name,description,validity,sql_text,parameters,columns,created_by,updated_by
) VALUES(
  '01Z29200000000000000000003','01Z29200000000000000000002','Issue 292 report','cutover fixture','VALID',
  'SELECT 1 AS value','[]'::jsonb,'[{"alias":"value","name":"值","order":1,"type":"INTEGER","width":120,"visible":true}]'::jsonb,
  '01Z29100000000000000000001','01Z29100000000000000000002'
);
INSERT INTO approval_events(
  id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,
  from_revision,to_revision,actor_id,request_id,created_at
) VALUES(
  '01Z29200000000000000000004','01Z29200000000000000000003','rpt','definition',
  '01Z29200000000000000000002',1,'APPROVED','PENDING','APPROVED',2,3,
  '01Z29100000000000000000002','issue-292-cutover',now()
);
INSERT INTO rpt_runtime_audit_events(
  id,definition_id,report_code,approval_entry_id,event_type,actor_id,request_id,summary
) VALUES(
  '01Z29200000000000000000005','01Z29200000000000000000002','issue-292-report',
  '01Z29200000000000000000003','EXECUTED','01Z29100000000000000000001','issue-292-runtime','{}'::jsonb
);
SQL
}

run_issue_292_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-292-dcl-rpt-definition.sql
}

verify_issue_292_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.rpt_versions'"'"') IS NULL
		 AND (SELECT count(*) FROM dcl_subjects WHERE entity='"'"'rpt-definition'"'"')=(SELECT count(*) FROM rpt_definitions)
		 AND (SELECT count(*) FROM dcl_rpt_definition_versions)=(SELECT count(*) FROM approval_entries WHERE domain='"'"'dcl'"'"' AND entity='"'"'rpt-definition'"'"')
		 AND NOT EXISTS (SELECT 1 FROM approval_entries WHERE domain='"'"'rpt'"'"' AND entity='"'"'definition'"'"')
		 AND NOT EXISTS (SELECT 1 FROM approval_events WHERE domain='"'"'rpt'"'"' AND entity='"'"'definition'"'"')
		 AND EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01Z29200000000000000000003'"'"' AND domain='"'"'dcl'"'"' AND entity='"'"'rpt-definition'"'"' AND subject_id='"'"'01Z29200000000000000000002'"'"')
		 AND EXISTS (SELECT 1 FROM approval_events WHERE id='"'"'01Z29200000000000000000004'"'"' AND entry_id='"'"'01Z29200000000000000000003'"'"' AND domain='"'"'dcl'"'"' AND entity='"'"'rpt-definition'"'"')
		 AND EXISTS (SELECT 1 FROM rpt_runtime_audit_events WHERE id='"'"'01Z29200000000000000000005'"'"' AND definition_id='"'"'01Z29200000000000000000002'"'"' AND approval_entry_id='"'"'01Z29200000000000000000003'"'"')
		 AND NOT EXISTS (SELECT 1 FROM app_permissions WHERE path LIKE '"'"'/rpt/definition/%'"'"')
		 AND NOT EXISTS (SELECT 1 FROM app_permissions WHERE id='"'"'01KRPT00000000000000000010'"'"')
		 AND (SELECT count(*) FROM app_role_permissions WHERE role_id='"'"'01Z29200000000000000000001'"'"' AND permission_id IN ('"'"'01KRPT00000000000000000001'"'"','"'"'01KRPT00000000000000000002'"'"','"'"'01KRPT00000000000000000011'"'"','"'"'01KRPT00000000000000000017'"'"'))=4
		 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
}

seed_issue_293_workflow_fixture() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
INSERT INTO app_roles(id,code,name,status,created_by,updated_by)
VALUES('01Z29300000000000000000005','ROL-0293','Issue 293 role','ENABLED','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
VALUES
  ('01Z29300000000000000000005','WG766d7129dcc7b17ec75871ae','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','WG97a91cf1d6594be99cbcc468','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','WGaeb45c648bc71c8a7cd97aec','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','WGd6e65556b0f2761f2666649d','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','WG45cc51ab6fa077508670df15','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','WG855f746f2476c3c06c7132e9','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','WG8cce66a1abfe87c2efebdd54','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','WG6ba149ae2772987659e7e433','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','01KWFL00000000000000000001','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','01KWFL00000000000000000002','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','01KWFL00000000000000000005','01JAPPSYST3MACTR0000000000'),
  ('01Z29300000000000000000005','01KWFL00000000000000000008','01JAPPSYST3MACTR0000000000');
INSERT INTO wfl_process_definitions(id,code,enabled,revision,created_at,created_by,updated_at,updated_by)
VALUES(
  '01Z29300000000000000000001','issue-293-workflow',true,7,
  '2026-08-29 01:02:03+00','01JAPPSYST3MACTR0000000000','2026-08-29 02:03:04+00','01JAPPSYST3MACTR0000000000'
);
INSERT INTO approval_entries(
  id,domain,entity,subject_id,version_no,status,revision,
  created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
) VALUES(
  '01Z29300000000000000000002','wfl','process-definition','01Z29300000000000000000001',4,'APPROVED',9,
  '01Z29300000000000000000006','2026-08-29 01:02:03+00','01Z29300000000000000000007','2026-08-29 02:03:04+00',
  '01Z29300000000000000000006','2026-08-29 01:30:00+00','01Z29300000000000000000007','2026-08-29 02:00:00+00'
);
INSERT INTO wfl_definition_versions(
  approval_entry_id,definition_id,script,diagnostic,compiled,last_trial_approval_revision,
  created_at,created_by,updated_at,updated_by
) VALUES(
  '01Z29300000000000000000002','01Z29300000000000000000001',
  'root = node(key="root", name="Issue 293", entity="sale-order")\nworkflow(code="issue-293-workflow", name="Issue 293 workflow", root=root, edges=[])',
  NULL,'{"name":"Issue 293 workflow","rootKey":"root","nodes":[{"key":"root","name":"Issue 293","entity":"sale-order"}],"edges":[]}'::jsonb,8,
  '2026-08-29 01:02:03+00','01JAPPSYST3MACTR0000000000','2026-08-29 02:03:04+00','01JAPPSYST3MACTR0000000000'
);
INSERT INTO approval_events(
  id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,
  from_revision,to_revision,actor_id,request_id,created_at
) VALUES(
  '01Z29300000000000000000003','01Z29300000000000000000002','wfl','process-definition',
  '01Z29300000000000000000001',4,'APPROVED','PENDING','APPROVED',8,9,
  '01Z29300000000000000000007','issue-293-cutover','2026-08-29 02:00:00+00'
);
INSERT INTO wfl_definition_instances(
  id,definition_id,definition_approval_entry_id,definition_code,definition_name,
  root_document_no,root_entity,revision,created_at,created_by,updated_at,updated_by
) VALUES(
  '01Z29300000000000000000004','01Z29300000000000000000001','01Z29300000000000000000002',
  'issue-293-workflow','Issue 293 workflow','SO-293','sale-order',5,
  '2026-08-29 02:05:00+00','01JAPPSYST3MACTR0000000000','2026-08-29 02:06:00+00','01JAPPSYST3MACTR0000000000'
);
SQL
}

run_issue_293_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' \
		<db/cutovers/issue-293-dcl-wfl-process-definition.sql
}

verify_issue_293_cutover() {
	local database="$1"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN to_regclass('"'"'public.wfl_definition_versions'"'"') IS NULL
		 AND EXISTS (SELECT 1 FROM wfl_process_definitions WHERE id='"'"'01Z29300000000000000000001'"'"' AND code='"'"'issue-293-workflow'"'"' AND enabled AND revision=7)
		 AND EXISTS (SELECT 1 FROM dcl_subjects WHERE id='"'"'01Z29300000000000000000001'"'"' AND entity='"'"'wfl-process-definition'"'"')
		 AND EXISTS (SELECT 1 FROM dcl_wfl_process_definition_versions WHERE approval_entry_id='"'"'01Z29300000000000000000002'"'"' AND definition_id='"'"'01Z29300000000000000000001'"'"' AND last_trial_approval_revision=8 AND compiled->>'"'"'name'"'"'='"'"'Issue 293 workflow'"'"')
		 AND EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01Z29300000000000000000002'"'"' AND domain='"'"'dcl'"'"' AND entity='"'"'wfl-process-definition'"'"' AND subject_id='"'"'01Z29300000000000000000001'"'"' AND version_no=4 AND status='"'"'APPROVED'"'"' AND revision=9)
		 AND EXISTS (SELECT 1 FROM approval_events WHERE id='"'"'01Z29300000000000000000003'"'"' AND entry_id='"'"'01Z29300000000000000000002'"'"' AND domain='"'"'dcl'"'"' AND entity='"'"'wfl-process-definition'"'"' AND request_id='"'"'issue-293-cutover'"'"')
		 AND EXISTS (SELECT 1 FROM wfl_definition_instances WHERE id='"'"'01Z29300000000000000000004'"'"' AND definition_id='"'"'01Z29300000000000000000001'"'"' AND definition_approval_entry_id='"'"'01Z29300000000000000000002'"'"' AND revision=5)
		 AND NOT EXISTS (SELECT 1 FROM approval_entries WHERE domain='"'"'wfl'"'"' AND entity='"'"'process-definition'"'"')
		 AND NOT EXISTS (SELECT 1 FROM approval_events WHERE domain='"'"'wfl'"'"' AND entity='"'"'process-definition'"'"')
		 AND NOT EXISTS (SELECT 1 FROM app_permissions WHERE id='"'"'WG8cce66a1abfe87c2efebdd54'"'"')
		 AND (SELECT count(*) FROM app_role_permissions WHERE role_id='"'"'01Z29300000000000000000005'"'"')=14
		 AND (SELECT count(*) FROM app_role_permissions role_permission JOIN app_permissions permission ON permission.id=role_permission.permission_id WHERE role_permission.role_id='"'"'01Z29300000000000000000005'"'"' AND permission.domain='"'"'wfl'"'"')=3
		 AND (SELECT count(*) FROM app_role_permissions role_permission JOIN app_permissions permission ON permission.id=role_permission.permission_id WHERE role_permission.role_id='"'"'01Z29300000000000000000005'"'"' AND permission.domain='"'"'dcl'"'"' AND permission.entity='"'"'wfl-process-definition'"'"')=11
		 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
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

run_cutover_compatibility_tests() {
	local cutover_database pre_issue_305_database issue_315_database

	cutover_database="$(database_name "_issues_289_293_cutover_${run_id}_test")"
	clone_databases+=("$cutover_database")
	recreate_database "$cutover_database"
	initialize_historical_pre_issue_289_schema "$cutover_database"
	verify_historical_pre_issue_289_fixture "$cutover_database"
	seed_issue_289_snapshot_fixture "$cutover_database"
	if run_issue_290_cutover "$cutover_database" >/dev/null 2>&1; then
		fail "issue-290 cutover accepted execution before issue-289"
	fi
	verify_issue_290_order_guard "$cutover_database"

	recreate_database "$cutover_database"
	initialize_historical_pre_issue_289_schema "$cutover_database"
	verify_historical_pre_issue_289_fixture "$cutover_database"
	seed_issue_289_snapshot_fixture "$cutover_database"
	run_issue_289_cutover "$cutover_database"
	verify_issue_289_cutover "$cutover_database"
	run_issue_290_cutover "$cutover_database"
	verify_issue_290_cutover "$cutover_database"
	seed_issue_291_mapping_fixture "$cutover_database"
	run_issue_291_cutover "$cutover_database"
	verify_issue_291_cutover "$cutover_database"
	seed_issue_292_report_fixture "$cutover_database"
	run_issue_292_cutover "$cutover_database"
	verify_issue_292_cutover "$cutover_database"
	seed_issue_293_workflow_fixture "$cutover_database"
	run_issue_293_cutover "$cutover_database"
	verify_issue_293_cutover "$cutover_database"

	recreate_database "$cutover_database"
	initialize_historical_pre_issue_289_schema "$cutover_database"
	seed_issue_289_snapshot_fixture "$cutover_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$cutover_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
			 "UPDATE aux_version_payloads SET data=data-'"'"'quantityScale'"'"' WHERE approval_entry_id='"'"'01JAVX00000000000000000012'"'"'"' </dev/null
	if run_issue_289_cutover "$cutover_database" >/dev/null 2>&1; then
		fail "issue-289 cutover accepted an incomplete measurement-unit snapshot"
	fi

	recreate_database "$cutover_database"
	initialize_historical_pre_issue_289_schema "$cutover_database"
	seed_issue_289_snapshot_fixture "$cutover_database"
	run_issue_289_cutover "$cutover_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$cutover_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
			 "DELETE FROM aux_version_payloads WHERE approval_entry_id=(SELECT id FROM approval_entries WHERE domain='"'"'aux'"'"' AND status='"'"'APPROVED'"'"' LIMIT 1)"' </dev/null
	if run_issue_290_cutover "$cutover_database" >/dev/null 2>&1; then
		fail "issue-290 cutover accepted an approved AUX entry without a payload"
	fi

	pre_issue_305_database="$(database_name "_pre_issue_305_${run_id}_test")"
	clone_databases+=("$pre_issue_305_database")
	echo "==> pre-issue-305 cutover input fixture"
	recreate_database "$pre_issue_305_database"
	initialize_pre_issue_305_schema "$pre_issue_305_database"
	verify_pre_issue_305_fixture "$pre_issue_305_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
			 "INSERT INTO bob_objects(id,entity,code,created_by,updated_by) VALUES ('"'"'01Z30500000000000000000009'"'"','"'"'warehouse'"'"','"'"'WHS-0306'"'"','"'"'01JAPPSYST3MACTR0000000000'"'"','"'"'01JAPPSYST3MACTR0000000000'"'"')"' </dev/null
	if run_issue_305_cutover "$pre_issue_305_database" >/dev/null 2>&1; then
		fail "issue-305 cutover accepted a BOB core identity without a matching DCL subject"
	fi
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
			 "SELECT CASE WHEN to_regclass('"'"'public.bob_operating_entities'"'"') IS NOT NULL
			 AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'dcl_subjects'"'"' AND column_name='"'"'code'"'"')
			 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
	recreate_database "$pre_issue_305_database"
	initialize_pre_issue_305_schema "$pre_issue_305_database"
	verify_pre_issue_305_fixture "$pre_issue_305_database"
	run_issue_305_cutover "$pre_issue_305_database"
	verify_issue_305_cutover "$pre_issue_305_database"
	run_issue_308_cutover "$pre_issue_305_database"
	verify_issue_308_cutover "$pre_issue_305_database"
	run_issue_309_cutover "$pre_issue_305_database"
	verify_issue_309_cutover "$pre_issue_305_database"
	run_issue_310_cutover "$pre_issue_305_database"
	verify_issue_310_cutover "$pre_issue_305_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE"' <<'SQL'
INSERT INTO approval_entries(
  id,domain,entity,subject_id,version_no,status,revision,
  created_by,created_at,updated_by,updated_at
) VALUES (
  '01Z31100000000000000000091','bob','legacy-party','legacy-bob-311',1,'DRAFT',1,
  '01JAPPSYST3MACTR0000000000','2026-08-29 03:30:00+00','01JAPPSYST3MACTR0000000000','2026-08-29 03:30:00+00'
);
INSERT INTO approval_events(
  id,entry_id,domain,entity,subject_id,version_no,action,
  from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
) VALUES (
  '01Z31100000000000000000092','01Z31100000000000000000091','bob','legacy-party','legacy-bob-311',1,'CREATED',
  NULL,'DRAFT',NULL,1,'01JAPPSYST3MACTR0000000000',NULL,'issue-311-versioned-bob-guard','2026-08-29 03:30:00+00'
);
SQL
	if run_issue_311_cutover "$pre_issue_305_database" >/dev/null 2>&1; then
		fail "issue-311 cutover accepted versioned BOB Approval history"
	fi
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -Atc \
		 "SELECT CASE WHEN EXISTS (SELECT 1 FROM approval_entries WHERE id='"'"'01Z31100000000000000000091'"'"' AND domain='"'"'bob'"'"' AND version_no=1)
		 AND EXISTS (SELECT 1 FROM approval_events WHERE id='"'"'01Z31100000000000000000092'"'"' AND entry_id='"'"'01Z31100000000000000000091'"'"' AND domain='"'"'bob'"'"' AND version_no=1)
		 AND EXISTS (SELECT 1 FROM object_number_counters WHERE domain='"'"'bob'"'"' AND entity='"'"'customer'"'"' AND last_value=312)
		 AND position('"'"'bob'"'"' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='"'"'object_number_counters'"'"'::regclass AND conname='"'"'object_number_counters_domain_check'"'"')))>0
		 THEN '"'"'ok'"'"' ELSE '"'"'failed'"'"' END" | grep -Fx ok'
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
		 "DELETE FROM approval_events WHERE id='"'"'01Z31100000000000000000092'"'"'; DELETE FROM approval_entries WHERE id='"'"'01Z31100000000000000000091'"'"'"' </dev/null
	run_issue_311_cutover "$pre_issue_305_database"
	verify_issue_311_cutover "$pre_issue_305_database"
	run_issue_315_cutover "$pre_issue_305_database"
	verify_issue_315_cutover "$pre_issue_305_database"
	seed_issue_316_wfl_fixture "$pre_issue_305_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
		 "UPDATE dcl_subjects SET code=CASE id
		    WHEN '"'"'01Z30500000000000000000001'"'"' THEN '"'"'OPE-0305'"'"'
		    WHEN '"'"'01Z31100000000000000000015'"'"' THEN '"'"'OTU-0311'"'"'
		    WHEN '"'"'01Z31100000000000000000016'"'"' THEN '"'"'SLP-0311'"'"'
		  END
		  WHERE id IN ('"'"'01Z30500000000000000000001'"'"','"'"'01Z31100000000000000000015'"'"','"'"'01Z31100000000000000000016'"'"');
		  INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES ('"'"'01Z31600000000000000000099'"'"','"'"'product'"'"','"'"'WHS-9999'"'"','"'"'01JAPPSYST3MACTR0000000000'"'"')"' </dev/null
	if run_issue_316_cutover "$pre_issue_305_database" >/dev/null 2>&1; then
		fail "issue-316 cutover accepted a coded DCL subject with the wrong prefix"
	fi
	verify_issue_316_failure_is_atomic "$pre_issue_305_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
		 "DELETE FROM dcl_subjects WHERE id='"'"'01Z31600000000000000000099'"'"'"' </dev/null
	run_issue_316_cutover "$pre_issue_305_database"
	verify_issue_316_cutover "$pre_issue_305_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
		 "DELETE FROM dcl_rpt_definition_code_counters WHERE counter_key='"'"'default'"'"'"' </dev/null
	if run_issue_318_cutover "$pre_issue_305_database" >/dev/null 2>&1; then
		fail "issue-318 cutover accepted a missing dedicated RPT counter row"
	fi
	verify_issue_318_failure_is_atomic "$pre_issue_305_database"
	"${compose[@]}" exec -T -e TARGET_DATABASE="$pre_issue_305_database" db sh -eu -c \
		'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DATABASE" -c \
		 "INSERT INTO dcl_rpt_definition_code_counters(counter_key,next_value) VALUES ('"'"'default'"'"',0)"' </dev/null
	seed_issue_318_rpt_counter_fixture "$pre_issue_305_database"
	run_issue_318_cutover "$pre_issue_305_database"
	verify_issue_318_cutover "$pre_issue_305_database"

	issue_315_database="$(database_name "_issue_315_${run_id}_test")"
	clone_databases+=("$issue_315_database")
	recreate_database "$issue_315_database"
	initialize_schema "$issue_315_database"
	seed_issue_315_other_unit_fixture "$issue_315_database" "01Z31500000000000000000001" 3
	run_issue_315_cutover "$issue_315_database"
	verify_issue_315_exact_arrival_mapping "$issue_315_database"

	recreate_database "$issue_315_database"
	initialize_schema "$issue_315_database"
	seed_issue_315_other_unit_fixture "$issue_315_database" "01Z31500000000000000000002" 0
	if run_issue_315_cutover "$issue_315_database" >/dev/null 2>&1; then
		fail "issue-315 cutover accepted ambiguous zero-day settlement"
	fi
	verify_issue_315_ambiguous_failure_is_atomic "$issue_315_database"
}

initialize_current_schema_databases() {
	recreate_database "$base_database"
	initialize_schema "$base_database"

	recreate_database "$template_database"
	initialize_schema "$template_database"
}

run_current_integration_packages() {
	local all_packages_file packages_file package package_database attachment_root
	local index=0
	local failed=0

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
	return "$failed"
}

mkdir -p "$work_root"
"${compose[@]}" up -d --wait db

echo "==> cutover compatibility tests"
run_cutover_compatibility_tests

echo "==> current schema initialization"
initialize_current_schema_databases

echo "==> current integration packages"
integration_status=0
if ! run_current_integration_packages; then
	integration_status=1
fi
exit "$integration_status"
