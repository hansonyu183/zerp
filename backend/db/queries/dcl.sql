-- DCL keeps one stable subject and one typed full snapshot per central
-- Approval Version.  It deliberately stores no current/base/next pointer.

-- name: InsertDCLSubject :exec
INSERT INTO dcl_subjects(id, entity, code, created_by)
VALUES(sqlc.arg(id), sqlc.arg(entity), sqlc.narg(code), sqlc.arg(actor_id));

-- name: GetDCLSubject :one
SELECT id, entity, code, created_at, created_by
FROM dcl_subjects
WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);

-- name: LockDCLSubject :one
SELECT id, entity, code, created_at, created_by
FROM dcl_subjects
WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity)
FOR UPDATE;

-- name: NextDCLSubjectCode :one
INSERT INTO object_number_counters (domain, entity, last_value)
VALUES ('dcl', sqlc.arg(entity), 1)
ON CONFLICT (domain, entity)
DO UPDATE SET last_value = object_number_counters.last_value + 1
WHERE object_number_counters.last_value < CASE
  WHEN object_number_counters.domain='dcl' AND object_number_counters.entity='rpt-definition' THEN 999999
  ELSE 9999
END
RETURNING last_value;

-- name: DeleteDCLSubject :execrows
DELETE FROM dcl_subjects
WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);

-- Customer is the sole approval aggregate.  Its JSON snapshot owns identity,
-- default operating entity, and every account line; roots are only stable IDs.
-- name: InsertDCLCustomerVersionAggregate :exec
INSERT INTO dcl_customer_versions(approval_entry_id,kind,legal_identifier,data,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(kind),sqlc.narg(legal_identifier),sqlc.arg(data),sqlc.arg(enabled));

-- name: GetDCLCustomerVersionAggregate :one
SELECT approval_entry_id,kind,legal_identifier,data,enabled
FROM dcl_customer_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: UpdateDCLCustomerVersionAggregate :execrows
UPDATE dcl_customer_versions
SET kind=sqlc.arg(kind),legal_identifier=sqlc.narg(legal_identifier),data=sqlc.arg(data),enabled=sqlc.arg(enabled)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CopyDCLCustomerVersionAggregate :exec
INSERT INTO dcl_customer_versions(approval_entry_id,kind,legal_identifier,data,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.kind,source.legal_identifier,source.data,source.enabled
FROM dcl_customer_versions source
WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: DeleteDCLCustomerVersionAggregate :execrows
DELETE FROM dcl_customer_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: ListDCLCustomerAccountRoots :many
SELECT account_id,customer_id,code,ever_approved,first_approved_customer_entry_id
FROM dcl_customer_account_roots
WHERE customer_id=sqlc.arg(customer_id)
ORDER BY code,account_id;

-- name: LockDCLCustomerAccountRoot :one
SELECT account_id,customer_id,code,ever_approved,first_approved_customer_entry_id
FROM dcl_customer_account_roots
WHERE account_id=sqlc.arg(account_id)
FOR UPDATE;

-- name: InsertDCLCustomerAccountRoot :exec
INSERT INTO dcl_customer_account_roots(account_id,customer_id,code)
VALUES(sqlc.arg(account_id),sqlc.arg(customer_id),sqlc.arg(code));

-- name: DeleteDCLCustomerAccountRoot :execrows
DELETE FROM dcl_customer_account_roots
WHERE account_id=sqlc.arg(account_id) AND customer_id=sqlc.arg(customer_id) AND ever_approved=false;

-- name: MarkDCLCustomerAccountRootApproved :execrows
UPDATE dcl_customer_account_roots
SET ever_approved=true,first_approved_customer_entry_id=COALESCE(first_approved_customer_entry_id,sqlc.arg(customer_approval_entry_id))
WHERE account_id=sqlc.arg(account_id) AND customer_id=sqlc.arg(customer_id);

-- name: GetDCLCustomerAccountCodeMax :one
SELECT COALESCE(max(CAST(substring(code FROM '[0-9]+$') AS bigint)),0)::bigint AS code_max
FROM dcl_customer_account_roots
WHERE customer_id=sqlc.arg(customer_id);

-- name: DeleteDCLCustomerVersionAccounts :exec
DELETE FROM dcl_customer_version_accounts
WHERE customer_approval_entry_id=sqlc.arg(customer_approval_entry_id)
  AND NOT (account_id=ANY(sqlc.arg(account_ids)::text[]));

-- name: InsertDCLCustomerVersionAccount :exec
INSERT INTO dcl_customer_version_accounts(customer_approval_entry_id,account_id,data,enabled,is_default)
VALUES(sqlc.arg(customer_approval_entry_id),sqlc.arg(account_id),sqlc.arg(data),sqlc.arg(enabled),sqlc.arg(is_default))
ON CONFLICT(customer_approval_entry_id,account_id) DO UPDATE SET
  data=EXCLUDED.data,enabled=EXCLUDED.enabled,is_default=EXCLUDED.is_default;

-- name: CopyDCLCustomerVersionAccounts :exec
INSERT INTO dcl_customer_version_accounts(customer_approval_entry_id,account_id,data,enabled,is_default)
SELECT sqlc.arg(new_customer_approval_entry_id),source.account_id,source.data,source.enabled,source.is_default
FROM dcl_customer_version_accounts source
WHERE source.customer_approval_entry_id=sqlc.arg(source_customer_approval_entry_id);

-- name: ListDCLCustomerVersionAccounts :many
SELECT line.customer_approval_entry_id,line.account_id,root.customer_id,root.code,line.data,line.enabled,line.is_default,
       root.ever_approved,root.first_approved_customer_entry_id
FROM dcl_customer_version_accounts line
JOIN dcl_customer_account_roots root ON root.account_id=line.account_id
WHERE line.customer_approval_entry_id=sqlc.arg(customer_approval_entry_id)
ORDER BY root.code,root.account_id;

-- name: DeleteDCLCustomerVersionAccountCreditLimits :exec
DELETE FROM dcl_customer_version_account_credit_limits
WHERE customer_approval_entry_id=sqlc.arg(customer_approval_entry_id);

-- name: InsertDCLCustomerVersionAccountCreditLimit :exec
INSERT INTO dcl_customer_version_account_credit_limits(customer_approval_entry_id,account_id,currency,amount_cents)
VALUES(sqlc.arg(customer_approval_entry_id),sqlc.arg(account_id),sqlc.arg(currency),sqlc.arg(amount_cents));

-- name: CopyDCLCustomerVersionAccountCreditLimits :exec
INSERT INTO dcl_customer_version_account_credit_limits(customer_approval_entry_id,account_id,currency,amount_cents)
SELECT sqlc.arg(new_customer_approval_entry_id),source.account_id,source.currency,source.amount_cents
FROM dcl_customer_version_account_credit_limits source
WHERE source.customer_approval_entry_id=sqlc.arg(source_customer_approval_entry_id);

-- name: ListDCLCustomerVersionAccountCreditLimits :many
SELECT customer_approval_entry_id,account_id,currency,amount_cents
FROM dcl_customer_version_account_credit_limits
WHERE customer_approval_entry_id=sqlc.arg(customer_approval_entry_id)
ORDER BY account_id,currency;

-- name: LockDCLCustomerLegalIdentifierClaim :one
SELECT normalized_legal_identifier,approved_customer_id,approved_approval_entry_id,open_customer_id,open_approval_entry_id
FROM dcl_customer_legal_identifier_claims
WHERE normalized_legal_identifier=sqlc.arg(normalized_legal_identifier)
FOR UPDATE;

-- Serialize absent and existing claims alike before inspection/upsert.
-- name: LockDCLCustomerLegalIdentifierClaimKey :exec
SELECT pg_advisory_xact_lock(hashtext('customer:' || sqlc.arg(normalized_legal_identifier)::text));

-- name: UpsertDCLCustomerLegalIdentifierClaim :exec
INSERT INTO dcl_customer_legal_identifier_claims(normalized_legal_identifier,approved_customer_id,approved_approval_entry_id,open_customer_id,open_approval_entry_id)
VALUES(sqlc.arg(normalized_legal_identifier),sqlc.narg(approved_customer_id),sqlc.narg(approved_approval_entry_id),sqlc.narg(open_customer_id),sqlc.narg(open_approval_entry_id))
ON CONFLICT(normalized_legal_identifier) DO UPDATE SET
  approved_customer_id=EXCLUDED.approved_customer_id,
  approved_approval_entry_id=EXCLUDED.approved_approval_entry_id,
  open_customer_id=EXCLUDED.open_customer_id,
  open_approval_entry_id=EXCLUDED.open_approval_entry_id;

-- name: DeleteDCLCustomerLegalIdentifierClaimsForEntry :exec
UPDATE dcl_customer_legal_identifier_claims AS target SET
  approved_customer_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_customer_id END,
  approved_approval_entry_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_approval_entry_id END,
  open_customer_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_customer_id END,
  open_approval_entry_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_approval_entry_id END
WHERE target.approved_approval_entry_id=sqlc.arg(approval_entry_id) OR target.open_approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLCustomerAggregates :one
SELECT count(*)
FROM dcl_subjects subject
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved_entry ON true
JOIN dcl_customer_versions display ON display.approval_entry_id=COALESCE(open_entry.id,approved_entry.id)
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.data->>'displayName' ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_operating_entity_id)::text='' OR display.data->>'defaultOperatingEntityId'=sqlc.arg(default_operating_entity_id)::text)
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLCustomerAggregates :many
SELECT subject.id AS object_id,subject.entity,subject.code,
       COALESCE(approved_entry.id,'')::text AS latest_approved_entry_id,
       COALESCE(approved_entry.status,'')::text AS latest_approved_status,
       COALESCE(approved_entry.version_no,0)::integer AS latest_approved_version_no,
       COALESCE(open_entry.id,'')::text AS open_entry_id,
       COALESCE(open_entry.status,'')::text AS open_status,
       COALESCE(open_entry.version_no,0)::integer AS open_version_no,
       display.data,display.enabled,COALESCE(open_entry.updated_at,approved_entry.updated_at) AS updated_at
FROM dcl_subjects subject
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved_entry ON true
JOIN dcl_customer_versions display ON display.approval_entry_id=COALESCE(open_entry.id,approved_entry.id)
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.data->>'displayName' ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_operating_entity_id)::text='' OR display.data->>'defaultOperatingEntityId'=sqlc.arg(default_operating_entity_id)::text)
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY subject.code
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertDCLOperatingEntityVersion :exec
INSERT INTO dcl_operating_entity_versions(
  approval_entry_id, legal_name, short_name, tax_number, address, phone, remark, enabled
)
VALUES(
  sqlc.arg(approval_entry_id), sqlc.arg(legal_name), sqlc.narg(short_name),
  sqlc.narg(tax_number), sqlc.narg(address), sqlc.narg(phone), sqlc.narg(remark), sqlc.arg(enabled)
);

-- name: CopyDCLOperatingEntityVersion :execrows
INSERT INTO dcl_operating_entity_versions(
  approval_entry_id, legal_name, short_name, tax_number, address, phone, remark, enabled
)
SELECT sqlc.arg(new_approval_entry_id), legal_name, short_name, tax_number, address, phone, remark, enabled
FROM dcl_operating_entity_versions
WHERE dcl_operating_entity_versions.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLOperatingEntityVersion :execrows
UPDATE dcl_operating_entity_versions
SET legal_name=sqlc.arg(legal_name), short_name=sqlc.narg(short_name),
    tax_number=sqlc.narg(tax_number), address=sqlc.narg(address),
    phone=sqlc.narg(phone), remark=sqlc.narg(remark), enabled=sqlc.arg(enabled)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLOperatingEntityVersion :one
SELECT approval_entry_id, legal_name, short_name, tax_number, address, phone, remark, enabled
FROM dcl_operating_entity_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: DeleteDCLOperatingEntityVersion :execrows
DELETE FROM dcl_operating_entity_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLOperatingEntities :one
SELECT count(*)
FROM dcl_subjects subject
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status IN ('DRAFT','PENDING')
  ORDER BY entry.version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status='APPROVED'
  ORDER BY entry.version_no DESC LIMIT 1
) approved ON true
JOIN dcl_operating_entity_versions display
  ON display.approval_entry_id=COALESCE(candidate.id, approved.id)
WHERE subject.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLOperatingEntities :many
SELECT subject.id AS object_id, subject.code,
       display.enabled, COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
       COALESCE(approved.id,'')::text AS approved_entry_id,
       COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status IN ('DRAFT','PENDING')
  ORDER BY entry.version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status='APPROVED'
  ORDER BY entry.version_no DESC LIMIT 1
) approved ON true
JOIN dcl_operating_entity_versions display
  ON display.approval_entry_id=COALESCE(candidate.id, approved.id)
WHERE subject.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.legal_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.legal_name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
  subject.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLOperatingEntityApprovalEvents :one
SELECT count(*)
FROM approval_events
WHERE domain='dcl' AND entity='operating-entity' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLOperatingEntityApprovalEvents :many
SELECT id, entry_id, domain, entity, subject_id, version_no, action, from_status, to_status,
       from_revision, to_revision, actor_id, reason, request_id, created_at
FROM approval_events
WHERE domain='dcl' AND entity='operating-entity' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Supplier is a typed DCL snapshot; Party and relationship roots are not read.
-- name: InsertDCLSupplierVersion :exec
INSERT INTO dcl_supplier_versions(approval_entry_id,kind,legal_name,display_name,short_name,legal_identifier,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,default_purchaser_employee_id,default_purchaser_employee_approval_entry_id,default_purchaser_employee_code,default_purchaser_employee_name,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(kind),sqlc.arg(legal_name),sqlc.arg(display_name),sqlc.narg(short_name),sqlc.narg(legal_identifier),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(remark),sqlc.narg(settlement_method_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.arg(settlement_month_offset),sqlc.arg(settlement_day_of_month),sqlc.arg(settlement_day_offset),sqlc.arg(default_operating_entity_id),sqlc.arg(default_operating_entity_approval_entry_id),sqlc.arg(default_operating_entity_code),sqlc.arg(default_operating_entity_name),sqlc.narg(default_purchaser_employee_id),sqlc.narg(default_purchaser_employee_approval_entry_id),sqlc.narg(default_purchaser_employee_code),sqlc.narg(default_purchaser_employee_name),sqlc.arg(enabled));

-- name: CopyDCLSupplierVersion :execrows
INSERT INTO dcl_supplier_versions(approval_entry_id,kind,legal_name,display_name,short_name,legal_identifier,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,default_purchaser_employee_id,default_purchaser_employee_approval_entry_id,default_purchaser_employee_code,default_purchaser_employee_name,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.kind,source.legal_name,source.display_name,source.short_name,source.legal_identifier,source.contact_name,source.contact_phone,source.email,source.address,source.remark,source.settlement_method_id,source.settlement_method_code,source.settlement_method_name,source.settlement_term_code,source.settlement_rule_type,source.settlement_month_offset,source.settlement_day_of_month,source.settlement_day_offset,source.default_operating_entity_id,source.default_operating_entity_approval_entry_id,source.default_operating_entity_code,source.default_operating_entity_name,source.default_purchaser_employee_id,source.default_purchaser_employee_approval_entry_id,source.default_purchaser_employee_code,source.default_purchaser_employee_name,source.enabled FROM dcl_supplier_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLSupplierVersion :execrows
UPDATE dcl_supplier_versions SET kind=sqlc.arg(kind),legal_name=sqlc.arg(legal_name),display_name=sqlc.arg(display_name),short_name=sqlc.narg(short_name),legal_identifier=sqlc.narg(legal_identifier),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),remark=sqlc.narg(remark),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_day_of_month=sqlc.arg(settlement_day_of_month),settlement_day_offset=sqlc.arg(settlement_day_offset),default_operating_entity_id=sqlc.arg(default_operating_entity_id),default_operating_entity_approval_entry_id=sqlc.arg(default_operating_entity_approval_entry_id),default_operating_entity_code=sqlc.arg(default_operating_entity_code),default_operating_entity_name=sqlc.arg(default_operating_entity_name),default_purchaser_employee_id=sqlc.narg(default_purchaser_employee_id),default_purchaser_employee_approval_entry_id=sqlc.narg(default_purchaser_employee_approval_entry_id),default_purchaser_employee_code=sqlc.narg(default_purchaser_employee_code),default_purchaser_employee_name=sqlc.narg(default_purchaser_employee_name),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLSupplierVersion :one
SELECT * FROM dcl_supplier_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: DeleteDCLSupplierVersion :execrows
DELETE FROM dcl_supplier_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLSuppliers :one
SELECT count(*) FROM dcl_subjects subject
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_supplier_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='supplier' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_supplier_version_operating_entities operating WHERE operating.approval_entry_id=display.approval_entry_id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLSuppliers :many
SELECT subject.id AS object_id,dcl_require_subject_code(subject.code) AS code,display.kind,display.legal_name,display.display_name,display.legal_identifier,display.default_operating_entity_id,display.default_operating_entity_approval_entry_id,display.default_operating_entity_code,display.default_operating_entity_name,display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,COALESCE(approved.id,'')::text AS latest_approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_supplier_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='supplier' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_supplier_version_operating_entities operating WHERE operating.approval_entry_id=display.approval_entry_id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.display_name END ASC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.display_name END DESC,subject.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLSupplierApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='supplier' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLSupplierApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='supplier' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Compatibility query names now read the single Customer aggregate.
-- name: CountDCLCustomerApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='customer' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLCustomerApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events WHERE domain='dcl' AND entity='customer' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Employee identity and current operating-entity snapshot are stored directly.
-- name: InsertDCLEmployeeVersion :exec
INSERT INTO dcl_employee_versions(
  approval_entry_id,kind,legal_name,display_name,legal_identifier,employee_category_id,employee_category_code,employee_category_name,department_id,department_code,department_name,position_id,position_code,
  position_name,phone,email,hire_date,current_operating_entity_id,current_operating_entity_approval_entry_id,current_operating_entity_code,current_operating_entity_name,remark,enabled
) VALUES(
  sqlc.arg(approval_entry_id),sqlc.arg(kind),sqlc.arg(legal_name),sqlc.arg(display_name),sqlc.narg(legal_identifier),sqlc.narg(employee_category_id),
  sqlc.narg(employee_category_code),
  sqlc.narg(employee_category_name),sqlc.narg(department_id),
  sqlc.narg(department_code),
  sqlc.narg(department_name),sqlc.narg(position_id),
  sqlc.narg(position_code),
  sqlc.narg(position_name),sqlc.narg(phone),sqlc.narg(email),sqlc.narg(hire_date),
  sqlc.arg(current_operating_entity_id),sqlc.arg(current_operating_entity_approval_entry_id),sqlc.arg(current_operating_entity_code),sqlc.arg(current_operating_entity_name),sqlc.narg(remark),sqlc.arg(enabled)
);

-- name: CopyDCLEmployeeVersion :execrows
INSERT INTO dcl_employee_versions(
  approval_entry_id,kind,legal_name,display_name,legal_identifier,employee_category_id,employee_category_code,employee_category_name,department_id,department_code,department_name,position_id,position_code,
  position_name,phone,email,hire_date,current_operating_entity_id,current_operating_entity_approval_entry_id,current_operating_entity_code,current_operating_entity_name,remark,enabled
)
SELECT sqlc.arg(new_approval_entry_id),source.kind,source.legal_name,source.display_name,source.legal_identifier,source.employee_category_id,
  source.employee_category_code,source.employee_category_name,
  source.department_id,source.department_code,source.department_name,
  source.position_id,source.position_code,source.position_name,source.phone,source.email,
  source.hire_date,source.current_operating_entity_id,source.current_operating_entity_approval_entry_id,source.current_operating_entity_code,source.current_operating_entity_name,source.remark,source.enabled
FROM dcl_employee_versions source
WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLEmployeeVersion :execrows
UPDATE dcl_employee_versions SET
  kind=sqlc.arg(kind),legal_name=sqlc.arg(legal_name),display_name=sqlc.arg(display_name),legal_identifier=sqlc.narg(legal_identifier),
  employee_category_id=sqlc.narg(employee_category_id),
  employee_category_code=sqlc.narg(employee_category_code),employee_category_name=sqlc.narg(employee_category_name),
  department_id=sqlc.narg(department_id),
  department_code=sqlc.narg(department_code),department_name=sqlc.narg(department_name),
  position_id=sqlc.narg(position_id),
  position_code=sqlc.narg(position_code),position_name=sqlc.narg(position_name),
  phone=sqlc.narg(phone),email=sqlc.narg(email),hire_date=sqlc.narg(hire_date),current_operating_entity_id=sqlc.arg(current_operating_entity_id),current_operating_entity_approval_entry_id=sqlc.arg(current_operating_entity_approval_entry_id),current_operating_entity_code=sqlc.arg(current_operating_entity_code),current_operating_entity_name=sqlc.arg(current_operating_entity_name),
  remark=sqlc.narg(remark),enabled=sqlc.arg(enabled)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLEmployeeVersion :one
SELECT * FROM dcl_employee_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: DeleteDCLEmployeeVersion :execrows
DELETE FROM dcl_employee_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: InsertDCLOtherUnitVersion :exec
INSERT INTO dcl_other_unit_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,remark,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(kind),sqlc.arg(legal_name),sqlc.arg(display_name),sqlc.narg(legal_identifier),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(settlement_method_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.arg(settlement_month_offset),sqlc.arg(settlement_day_of_month),sqlc.arg(settlement_day_offset),sqlc.arg(default_operating_entity_id),sqlc.arg(default_operating_entity_approval_entry_id),sqlc.arg(default_operating_entity_code),sqlc.arg(default_operating_entity_name),sqlc.narg(remark),sqlc.arg(enabled));
-- name: CopyDCLOtherUnitVersion :execrows
INSERT INTO dcl_other_unit_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,remark,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.kind,source.legal_name,source.display_name,source.legal_identifier,source.contact_name,source.contact_phone,source.email,source.address,source.settlement_method_id,source.settlement_method_code,source.settlement_method_name,source.settlement_term_code,source.settlement_rule_type,source.settlement_month_offset,source.settlement_day_of_month,source.settlement_day_offset,source.default_operating_entity_id,source.default_operating_entity_approval_entry_id,source.default_operating_entity_code,source.default_operating_entity_name,source.remark,source.enabled FROM dcl_other_unit_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLOtherUnitVersion :execrows
UPDATE dcl_other_unit_versions SET kind=sqlc.arg(kind),legal_name=sqlc.arg(legal_name),display_name=sqlc.arg(display_name),legal_identifier=sqlc.narg(legal_identifier),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_day_of_month=sqlc.arg(settlement_day_of_month),settlement_day_offset=sqlc.arg(settlement_day_offset),default_operating_entity_id=sqlc.arg(default_operating_entity_id),default_operating_entity_approval_entry_id=sqlc.arg(default_operating_entity_approval_entry_id),default_operating_entity_code=sqlc.arg(default_operating_entity_code),default_operating_entity_name=sqlc.arg(default_operating_entity_name),remark=sqlc.narg(remark),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLOtherUnitVersion :one
SELECT * FROM dcl_other_unit_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLOtherUnitVersion :execrows
DELETE FROM dcl_other_unit_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: InsertDCLSalesPartnerVersion :exec
INSERT INTO dcl_sales_partner_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,capabilities,contact_name,contact_phone,email,address,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,remark,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(kind),sqlc.arg(legal_name),sqlc.arg(display_name),sqlc.narg(legal_identifier),sqlc.arg(capabilities),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.arg(default_operating_entity_id),sqlc.arg(default_operating_entity_approval_entry_id),sqlc.arg(default_operating_entity_code),sqlc.arg(default_operating_entity_name),sqlc.narg(remark),sqlc.arg(enabled));
-- name: CopyDCLSalesPartnerVersion :execrows
INSERT INTO dcl_sales_partner_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,capabilities,contact_name,contact_phone,email,address,default_operating_entity_id,default_operating_entity_approval_entry_id,default_operating_entity_code,default_operating_entity_name,remark,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.kind,source.legal_name,source.display_name,source.legal_identifier,source.capabilities,source.contact_name,source.contact_phone,source.email,source.address,source.default_operating_entity_id,source.default_operating_entity_approval_entry_id,source.default_operating_entity_code,source.default_operating_entity_name,source.remark,source.enabled FROM dcl_sales_partner_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLSalesPartnerVersion :execrows
UPDATE dcl_sales_partner_versions SET kind=sqlc.arg(kind),legal_name=sqlc.arg(legal_name),display_name=sqlc.arg(display_name),legal_identifier=sqlc.narg(legal_identifier),capabilities=sqlc.arg(capabilities),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),default_operating_entity_id=sqlc.arg(default_operating_entity_id),default_operating_entity_approval_entry_id=sqlc.arg(default_operating_entity_approval_entry_id),default_operating_entity_code=sqlc.arg(default_operating_entity_code),default_operating_entity_name=sqlc.arg(default_operating_entity_name),remark=sqlc.narg(remark),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLSalesPartnerVersion :one
SELECT * FROM dcl_sales_partner_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLSalesPartnerVersion :execrows
DELETE FROM dcl_sales_partner_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLTypedArchives :one
WITH selected AS (
 SELECT subject.id FROM dcl_subjects subject
 LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
 LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
 LEFT JOIN dcl_other_unit_versions other_snapshot ON subject.entity='other-unit' AND other_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
 LEFT JOIN dcl_sales_partner_versions sales_snapshot ON subject.entity='sales-partner' AND sales_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
 WHERE subject.entity=sqlc.arg(entity) AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(other_snapshot.display_name,sales_snapshot.display_name) ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR COALESCE(other_snapshot.enabled,sales_snapshot.enabled)=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
 AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_other_unit_version_operating_entities operating WHERE subject.entity='other-unit' AND operating.approval_entry_id=other_snapshot.approval_entry_id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)) OR EXISTS (SELECT 1 FROM dcl_sales_partner_version_operating_entities operating WHERE subject.entity='sales-partner' AND operating.approval_entry_id=sales_snapshot.approval_entry_id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)))
) SELECT count(*) FROM selected;

-- name: ListDCLTypedArchives :many
SELECT subject.id AS object_id,dcl_require_subject_code(subject.code) AS code,COALESCE(other_snapshot.kind,sales_snapshot.kind) AS kind,COALESCE(other_snapshot.legal_name,sales_snapshot.legal_name) AS legal_name,COALESCE(other_snapshot.display_name,sales_snapshot.display_name) AS display_name,COALESCE(other_snapshot.legal_identifier,sales_snapshot.legal_identifier) AS legal_identifier,
 COALESCE(other_snapshot.default_operating_entity_id,sales_snapshot.default_operating_entity_id) AS default_operating_entity_id,COALESCE(other_snapshot.default_operating_entity_approval_entry_id,sales_snapshot.default_operating_entity_approval_entry_id) AS default_operating_entity_approval_entry_id,COALESCE(other_snapshot.default_operating_entity_code,sales_snapshot.default_operating_entity_code) AS default_operating_entity_code,COALESCE(other_snapshot.default_operating_entity_name,sales_snapshot.default_operating_entity_name) AS default_operating_entity_name,
 COALESCE(other_snapshot.enabled,sales_snapshot.enabled) AS enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
 COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
LEFT JOIN dcl_other_unit_versions other_snapshot ON subject.entity='other-unit' AND other_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
LEFT JOIN dcl_sales_partner_versions sales_snapshot ON subject.entity='sales-partner' AND sales_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity=sqlc.arg(entity) AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(other_snapshot.display_name,sales_snapshot.display_name) ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR COALESCE(other_snapshot.enabled,sales_snapshot.enabled)=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
 AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_other_unit_version_operating_entities operating WHERE subject.entity='other-unit' AND operating.approval_entry_id=other_snapshot.approval_entry_id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)) OR EXISTS (SELECT 1 FROM dcl_sales_partner_version_operating_entities operating WHERE subject.entity='sales-partner' AND operating.approval_entry_id=sales_snapshot.approval_entry_id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)))
ORDER BY COALESCE(candidate.updated_at,approved.updated_at) DESC,subject.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLTypedArchiveApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity=sqlc.arg(entity) AND subject_id=sqlc.arg(object_id);
-- name: ListDCLTypedArchiveApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events WHERE domain='dcl' AND entity=sqlc.arg(entity) AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetLatestApprovedDCLEmployeeVersionExcluding :one
SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,
       updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
FROM approval_entries
WHERE domain='dcl' AND entity='employee' AND subject_id=sqlc.arg(object_id)
  AND status='APPROVED' AND id<>sqlc.arg(excluded_approval_entry_id)
ORDER BY version_no DESC
LIMIT 1;

-- name: CountDCLEmployees :one
SELECT count(*)
FROM dcl_subjects subject
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status='APPROVED' ORDER BY version_no DESC LIMIT 1
) approved ON true
JOIN dcl_employee_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='employee'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(operating_entity_id)::text='' OR display.current_operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(employee_category_id)::text='' OR display.employee_category_id=sqlc.arg(employee_category_id)::text)
  AND (sqlc.arg(department_id)::text='' OR display.department_id=sqlc.arg(department_id)::text)
  AND (sqlc.arg(position_id)::text='' OR display.position_id=sqlc.arg(position_id)::text)
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLEmployees :many
SELECT subject.id AS object_id,dcl_require_subject_code(subject.code) AS code,
       display.kind,display.legal_name,display.display_name,display.legal_identifier,
       display.current_operating_entity_id,display.current_operating_entity_approval_entry_id,display.current_operating_entity_code,display.current_operating_entity_name,display.enabled,
       COALESCE(approved.id,'')::text AS latest_approved_entry_id,
       COALESCE(candidate.id,'')::text AS open_entry_id,
       COALESCE(candidate.status,approved.status)::text AS display_status,
       COALESCE(candidate.version_no,approved.version_no) AS display_version_no,
       COALESCE(candidate.updated_at,approved.updated_at) AS updated_at
FROM dcl_subjects subject
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status='APPROVED' ORDER BY version_no DESC LIMIT 1
) approved ON true
JOIN dcl_employee_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='employee'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(operating_entity_id)::text='' OR display.current_operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(employee_category_id)::text='' OR display.employee_category_id=sqlc.arg(employee_category_id)::text)
  AND (sqlc.arg(department_id)::text='' OR display.department_id=sqlc.arg(department_id)::text)
  AND (sqlc.arg(position_id)::text='' OR display.position_id=sqlc.arg(position_id)::text)
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.display_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.display_name END DESC,
  subject.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLEmployeeApprovalEvents :one
SELECT count(*) FROM approval_events
WHERE domain='dcl' AND entity='employee' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLEmployeeApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,
       from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events
WHERE domain='dcl' AND entity='employee' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Warehouse is a DCL-owned declaration exposed by BOB as current effective
-- read-only business data.
-- name: InsertDCLWarehouseVersion :exec
INSERT INTO dcl_warehouse_versions(
  approval_entry_id,name,address,contact_name,contact_phone,manager_employee_id,
  manager_employee_approval_entry_id,remark,enabled
) VALUES(
  sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.narg(address),sqlc.narg(contact_name),
  sqlc.narg(contact_phone),sqlc.narg(manager_employee_id),
  sqlc.narg(manager_employee_approval_entry_id),sqlc.narg(remark),sqlc.arg(enabled)
);

-- name: CopyDCLWarehouseVersion :execrows
INSERT INTO dcl_warehouse_versions(
  approval_entry_id,category_id,category_entity,name,address,
  contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,
  manager_employee_entity,remark,enabled
)
SELECT sqlc.arg(new_approval_entry_id),category_id,category_entity,
  name,address,contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,
  manager_employee_entity,remark,enabled
FROM dcl_warehouse_versions WHERE dcl_warehouse_versions.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLWarehouseVersion :execrows
UPDATE dcl_warehouse_versions SET
  name=sqlc.arg(name),address=sqlc.narg(address),contact_name=sqlc.narg(contact_name),
  contact_phone=sqlc.narg(contact_phone),manager_employee_id=sqlc.narg(manager_employee_id),
  manager_employee_approval_entry_id=sqlc.narg(manager_employee_approval_entry_id),
  remark=sqlc.narg(remark),enabled=sqlc.arg(enabled)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLWarehouseVersion :one
SELECT * FROM dcl_warehouse_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetLatestApprovedDCLWarehouseVersionExcluding :one
SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,
       updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
FROM approval_entries
WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id)
  AND status='APPROVED' AND id<>sqlc.arg(excluded_approval_entry_id)
ORDER BY version_no DESC
LIMIT 1;

-- name: DeleteDCLWarehouseVersion :execrows
DELETE FROM dcl_warehouse_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLWarehouses :one
SELECT count(*) FROM dcl_subjects subject
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
 ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED'
 ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_warehouse_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='warehouse'
 AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLWarehouses :many
SELECT subject.id AS object_id,subject.code,display.enabled,
 COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
 COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
 ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED'
 ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_warehouse_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='warehouse'
 AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.name END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.name END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
 subject.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLWarehouseApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLWarehouseApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertDCLVehicleVersion :exec
INSERT INTO dcl_vehicle_versions(approval_entry_id,name,plate_number,vehicle_type,vehicle_type_object_id,vehicle_type_name,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_other_unit_object_id,carrier_other_unit_approval_entry_id,bulk_liquid_capable,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.arg(plate_number),sqlc.arg(vehicle_type),sqlc.arg(vehicle_type_object_id),sqlc.arg(vehicle_type_name),sqlc.narg(vin),sqlc.narg(engine_number),sqlc.narg(load_capacity_kg),sqlc.narg(remark),sqlc.arg(carrier_affiliation_type),sqlc.narg(carrier_operating_entity_id),sqlc.narg(carrier_operating_entity_approval_entry_id),sqlc.narg(carrier_other_unit_object_id),sqlc.narg(carrier_other_unit_approval_entry_id),sqlc.arg(bulk_liquid_capable),sqlc.arg(enabled));
-- name: CopyDCLVehicleVersion :execrows
INSERT INTO dcl_vehicle_versions(approval_entry_id,entity,name,plate_number,vehicle_type,vehicle_type_object_id,vehicle_type_name,vehicle_type_entity,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_operating_entity,carrier_other_unit_object_id,carrier_other_unit_approval_entry_id,carrier_other_unit_entity,bulk_liquid_capable,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.name,source.plate_number,source.vehicle_type,source.vehicle_type_object_id,source.vehicle_type_name,source.vehicle_type_entity,source.vin,source.engine_number,source.load_capacity_kg,source.remark,source.carrier_affiliation_type,source.carrier_operating_entity_id,source.carrier_operating_entity_approval_entry_id,source.carrier_operating_entity,source.carrier_other_unit_object_id,source.carrier_other_unit_approval_entry_id,source.carrier_other_unit_entity,source.bulk_liquid_capable,source.enabled FROM dcl_vehicle_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLVehicleVersion :execrows
UPDATE dcl_vehicle_versions SET name=sqlc.arg(name),plate_number=sqlc.arg(plate_number),vehicle_type=sqlc.arg(vehicle_type),vehicle_type_object_id=sqlc.arg(vehicle_type_object_id),vehicle_type_name=sqlc.arg(vehicle_type_name),vin=sqlc.narg(vin),engine_number=sqlc.narg(engine_number),load_capacity_kg=sqlc.narg(load_capacity_kg),remark=sqlc.narg(remark),carrier_affiliation_type=sqlc.arg(carrier_affiliation_type),carrier_operating_entity_id=sqlc.narg(carrier_operating_entity_id),carrier_operating_entity_approval_entry_id=sqlc.narg(carrier_operating_entity_approval_entry_id),carrier_other_unit_object_id=sqlc.narg(carrier_other_unit_object_id),carrier_other_unit_approval_entry_id=sqlc.narg(carrier_other_unit_approval_entry_id),bulk_liquid_capable=sqlc.arg(bulk_liquid_capable),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLVehicleVersion :one
SELECT * FROM dcl_vehicle_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: LockDCLVehicleIdentifierClaims :exec
SELECT pg_advisory_xact_lock(74155002);

-- name: FindDCLVehicleIdentifierConflict :one
WITH selected_entries AS (
  SELECT id,status FROM approval_entries
  WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING')
  UNION ALL
  (SELECT id,status FROM approval_entries
   WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status='APPROVED'
   ORDER BY version_no DESC LIMIT 1)
), selected_versions AS (
  SELECT version.* FROM selected_entries entry
  JOIN dcl_vehicle_versions version ON version.approval_entry_id=entry.id
), desired AS (
  SELECT 'PLATE'::text AS identifier_kind,upper(btrim(plate_number)) AS normalized_value FROM selected_versions
  UNION ALL
  SELECT 'VIN'::text AS identifier_kind,upper(btrim(vin)) AS normalized_value FROM selected_versions WHERE vin IS NOT NULL
)
SELECT desired.identifier_kind,desired.normalized_value
FROM desired JOIN dcl_vehicle_identifier_claims claim
  ON claim.identifier_kind=desired.identifier_kind AND claim.normalized_value=desired.normalized_value
WHERE claim.object_id<>sqlc.arg(object_id)
ORDER BY desired.identifier_kind LIMIT 1;

-- name: DeleteDCLVehicleIdentifierClaims :exec
DELETE FROM dcl_vehicle_identifier_claims WHERE object_id=sqlc.arg(object_id);

-- name: RebuildDCLVehicleIdentifierClaims :exec
WITH selected_entries AS (
  SELECT id,status FROM approval_entries
  WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING')
  UNION ALL
  (SELECT id,status FROM approval_entries
   WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status='APPROVED'
   ORDER BY version_no DESC LIMIT 1)
), selected_versions AS (
  SELECT version.*,entry.id AS selected_entry_id,entry.status AS selected_status
  FROM selected_entries entry
  JOIN dcl_vehicle_versions version ON version.approval_entry_id=entry.id
), identifiers AS (
  SELECT 'PLATE'::text AS identifier_kind,upper(btrim(plate_number)) AS normalized_value,selected_entry_id,selected_status FROM selected_versions
  UNION ALL
  SELECT 'VIN'::text AS identifier_kind,upper(btrim(vin)) AS normalized_value,selected_entry_id,selected_status FROM selected_versions WHERE vin IS NOT NULL
), desired AS (
  SELECT identifier_kind,normalized_value,
    max(selected_entry_id) FILTER (WHERE selected_status='APPROVED') AS approved_entry_id,
    max(selected_entry_id) FILTER (WHERE selected_status IN ('DRAFT','PENDING')) AS open_entry_id
  FROM identifiers GROUP BY identifier_kind,normalized_value
)
INSERT INTO dcl_vehicle_identifier_claims(identifier_kind,normalized_value,object_id,approved_entry_id,open_entry_id)
SELECT identifier_kind,normalized_value,sqlc.arg(object_id),approved_entry_id,open_entry_id FROM desired;
-- name: DeleteDCLVehicleVersion :execrows
DELETE FROM dcl_vehicle_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetLatestApprovedDCLVehicleVersionExcluding :one
SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' AND id<>sqlc.arg(excluded_approval_entry_id) ORDER BY version_no DESC LIMIT 1;
-- name: CountDCLVehicles :one
SELECT count(*) FROM dcl_subjects subject LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_vehicle_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='vehicle' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));
-- name: ListDCLVehicles :many
SELECT subject.id AS object_id,subject.code,display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id FROM dcl_subjects subject LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_vehicle_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='vehicle' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.name END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.name END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
 subject.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountDCLVehicleApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLVehicleApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertDCLFundAccountVersion :exec
INSERT INTO dcl_fund_account_versions(approval_entry_id,name,currency,account_name,bank_name,bank_branch,account_number,remark,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.arg(currency),sqlc.narg(account_name),sqlc.narg(bank_name),sqlc.narg(bank_branch),sqlc.narg(account_number),sqlc.narg(remark),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),sqlc.arg(enabled));
-- name: CopyDCLFundAccountVersion :execrows
INSERT INTO dcl_fund_account_versions(approval_entry_id,entity,name,currency,account_name,bank_name,bank_branch,account_number,remark,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.name,source.currency,source.account_name,source.bank_name,source.bank_branch,source.account_number,source.remark,source.operating_entity_id,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name,source.enabled FROM dcl_fund_account_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLFundAccountVersion :execrows
UPDATE dcl_fund_account_versions SET name=sqlc.arg(name),currency=sqlc.arg(currency),account_name=sqlc.narg(account_name),bank_name=sqlc.narg(bank_name),bank_branch=sqlc.narg(bank_branch),account_number=sqlc.narg(account_number),remark=sqlc.narg(remark),operating_entity_id=sqlc.arg(operating_entity_id),operating_entity_approval_entry_id=sqlc.arg(operating_entity_approval_entry_id),operating_entity_code=sqlc.arg(operating_entity_code),operating_entity_name=sqlc.arg(operating_entity_name),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLFundAccountVersion :one
SELECT * FROM dcl_fund_account_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLFundAccountVersion :execrows
DELETE FROM dcl_fund_account_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: LockDCLFundAccountIdentifierClaims :exec
SELECT pg_advisory_xact_lock(74155003);
-- name: FindDCLFundAccountIdentifierConflict :one
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(replace(replace(btrim(account_number),' ',''),'-','')) value FROM dcl_fund_account_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE account_number IS NOT NULL AND upper(replace(replace(btrim(account_number),' ',''),'-',''))<>'') SELECT desired.value AS normalized_account_number FROM desired JOIN dcl_fund_account_identifier_claims c ON c.normalized_account_number=desired.value WHERE c.object_id<>sqlc.arg(object_id) LIMIT 1;
-- name: DeleteDCLFundAccountIdentifierClaims :exec
DELETE FROM dcl_fund_account_identifier_claims WHERE object_id=sqlc.arg(object_id);
-- name: RebuildDCLFundAccountIdentifierClaims :exec
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(replace(replace(btrim(v.account_number),' ',''),'-','')) value,e.id,e.status FROM dcl_fund_account_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE v.account_number IS NOT NULL AND upper(replace(replace(btrim(v.account_number),' ',''),'-',''))<>'') INSERT INTO dcl_fund_account_identifier_claims(normalized_account_number,object_id,approved_entry_id,open_entry_id) SELECT value,sqlc.arg(object_id),max(id) FILTER (WHERE status='APPROVED'),max(id) FILTER (WHERE status IN ('DRAFT','PENDING')) FROM desired GROUP BY value;
-- name: CountDCLFundAccounts :one
SELECT count(*) FROM dcl_subjects s LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_fund_account_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='fund-account' AND (sqlc.arg(keyword)::text='' OR s.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[]));
-- name: ListDCLFundAccounts :many
SELECT s.id object_id,s.code,d.enabled,COALESCE(c.updated_at,a.updated_at) updated_at,COALESCE(a.id,'')::text approved_entry_id,COALESCE(c.id,'')::text open_entry_id FROM dcl_subjects s LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_fund_account_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='fund-account' AND (sqlc.arg(keyword)::text='' OR s.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[])) ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.updated_at,a.updated_at) END ASC, CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.updated_at,a.updated_at) END DESC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN s.code END ASC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN s.code END DESC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN d.name END ASC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN d.name END DESC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.status,a.status) END ASC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.status,a.status) END DESC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.version_no,a.version_no) END ASC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.version_no,a.version_no) END DESC, s.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountDCLFundAccountApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLFundAccountApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLProducts :one
SELECT count(*) FROM dcl_subjects s LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_product_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='product' AND (sqlc.arg(keyword)::text='' OR s.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[])) AND (sqlc.arg(product_type_id)::text='' OR d.product_type_id=sqlc.arg(product_type_id)::text) AND (sqlc.arg(category_id)::text='' OR d.category_id=sqlc.arg(category_id)::text);
-- name: ListDCLProducts :many
SELECT s.id object_id,s.code,d.enabled,COALESCE(c.updated_at,a.updated_at) updated_at,COALESCE(a.id,'')::text approved_entry_id,COALESCE(c.id,'')::text open_entry_id FROM dcl_subjects s LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_product_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='product' AND (sqlc.arg(keyword)::text='' OR s.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[])) AND (sqlc.arg(product_type_id)::text='' OR d.product_type_id=sqlc.arg(product_type_id)::text) AND (sqlc.arg(category_id)::text='' OR d.category_id=sqlc.arg(category_id)::text) ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.updated_at,a.updated_at) END ASC, CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.updated_at,a.updated_at) END DESC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN s.code END ASC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN s.code END DESC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN d.name END ASC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN d.name END DESC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.status,a.status) END ASC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.status,a.status) END DESC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.version_no,a.version_no) END ASC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.version_no,a.version_no) END DESC, s.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: LockDCLProductBarcodeClaims :exec
SELECT pg_advisory_xact_lock(74155004);
-- name: FindDCLProductBarcodeConflict :one
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(btrim(barcode)) value FROM dcl_product_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE barcode IS NOT NULL AND upper(btrim(barcode))<>'') SELECT desired.value AS normalized_barcode FROM desired JOIN dcl_product_barcode_claims c ON c.normalized_barcode=desired.value WHERE c.object_id<>sqlc.arg(object_id) LIMIT 1;
-- name: DeleteDCLProductBarcodeClaims :exec
DELETE FROM dcl_product_barcode_claims WHERE object_id=sqlc.arg(object_id);
-- name: RebuildDCLProductBarcodeClaims :exec
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(btrim(v.barcode)) value,e.id,e.status FROM dcl_product_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE v.barcode IS NOT NULL AND upper(btrim(v.barcode))<>'') INSERT INTO dcl_product_barcode_claims(normalized_barcode,object_id,approved_entry_id,open_entry_id) SELECT value,sqlc.arg(object_id),max(id) FILTER (WHERE status='APPROVED'),max(id) FILTER (WHERE status IN ('DRAFT','PENDING')) FROM desired GROUP BY value;
-- name: CountDCLProductApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLProductApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- ACC mapping declarations are DCL-owned. The stable subject (bookId, vouEntity)
-- lives in acc_mappings; typed full snapshots live here.

-- name: InsertDCLAccMappingSubject :exec
INSERT INTO acc_mappings(id, book_id, vou_entity, created_by, updated_by)
VALUES(sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(vou_entity), sqlc.arg(actor_id), sqlc.arg(actor_id));

-- name: GetDCLAccMappingSubject :one
SELECT id, book_id, vou_entity
FROM acc_mappings
WHERE book_id=sqlc.arg(book_id) AND vou_entity=sqlc.arg(vou_entity);

-- name: DeleteDCLAccMappingSubjectIfEmpty :execrows
DELETE FROM acc_mappings mapping
WHERE mapping.id=sqlc.arg(mapping_id)
  AND NOT EXISTS(SELECT 1 FROM dcl_acc_mapping_versions payload WHERE payload.mapping_id=mapping.id);

-- name: InsertDCLAccMappingVersion :exec
INSERT INTO dcl_acc_mapping_versions(approval_entry_id, mapping_id, default_result, definition)
VALUES(sqlc.arg(approval_entry_id), sqlc.arg(mapping_id), sqlc.arg(default_result), sqlc.arg(definition));

-- name: CopyDCLAccMappingVersion :execrows
INSERT INTO dcl_acc_mapping_versions(approval_entry_id, mapping_id, default_result, definition)
SELECT sqlc.arg(new_approval_entry_id), source.mapping_id, source.default_result, source.definition
FROM dcl_acc_mapping_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLAccMappingVersion :execrows
UPDATE dcl_acc_mapping_versions SET
  default_result = sqlc.arg(default_result), definition = sqlc.arg(definition)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLAccMappingVersion :one
SELECT approval_entry_id, mapping_id, default_result, definition
FROM dcl_acc_mapping_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: DeleteDCLAccMappingVersion :execrows
DELETE FROM dcl_acc_mapping_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: DCLAccMappingVersionReferenced :one
SELECT EXISTS(
  SELECT 1 FROM acc_vouchers voucher
  WHERE voucher.mapping_approval_entry_id=sqlc.arg(approval_entry_id)
);

-- name: CountDCLAccMappings :one
WITH selected AS (
  SELECT mapping.id
  FROM acc_mappings mapping
  LEFT JOIN LATERAL (
    SELECT id,status FROM approval_entries
    WHERE domain='dcl' AND entity='acc-mapping' AND subject_id=mapping.id
      AND status IN ('DRAFT','PENDING')
    ORDER BY version_no DESC LIMIT 1
  ) open_entry ON true
  LEFT JOIN LATERAL (
    SELECT id,status FROM approval_entries
    WHERE domain='dcl' AND entity='acc-mapping' AND subject_id=mapping.id
      AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
  ) approved_entry ON true
  WHERE mapping.book_id=sqlc.arg(book_id)
    AND (sqlc.arg(vou_entity)::text='' OR mapping.vou_entity=sqlc.arg(vou_entity)::text)
    AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]))
)
SELECT count(*) FROM selected;

-- name: ListDCLAccMappings :many
SELECT mapping.id AS mapping_id, mapping.book_id, mapping.vou_entity,
       COALESCE(approved_entry.id,'')::text AS approved_entry_id,
       COALESCE(open_entry.id,'')::text AS open_entry_id,
       COALESCE(open_entry.updated_at,approved_entry.updated_at) AS updated_at
FROM acc_mappings mapping
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='acc-mapping' AND subject_id=mapping.id
    AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='acc-mapping' AND subject_id=mapping.id
    AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved_entry ON true
WHERE mapping.book_id=sqlc.arg(book_id)
  AND (sqlc.arg(vou_entity)::text='' OR mapping.vou_entity=sqlc.arg(vou_entity)::text)
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(open_entry.updated_at,approved_entry.updated_at) END ASC,
         CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(open_entry.updated_at,approved_entry.updated_at) END DESC,
         CASE WHEN sqlc.arg(sort_field)::text='vouEntity' AND sqlc.arg(sort_order)::text='asc' THEN mapping.vou_entity END ASC,
         CASE WHEN sqlc.arg(sort_field)::text='vouEntity' AND sqlc.arg(sort_order)::text='desc' THEN mapping.vou_entity END DESC,
         CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(open_entry.status,approved_entry.status) END ASC,
         CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(open_entry.status,approved_entry.status) END DESC,
         CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(open_entry.version_no,approved_entry.version_no) END ASC,
         CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(open_entry.version_no,approved_entry.version_no) END DESC,
         mapping.id DESC
OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: CountDCLAccMappingApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='acc-mapping'
  AND subject_id=sqlc.arg(subject_id);

-- name: ListDCLAccMappingApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='acc-mapping'
  AND subject_id=sqlc.arg(subject_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- ── RPT Definition (DCL-owned) ──────────────────────────────────

-- name: DclRptGetLatestApprovedPayload :one
SELECT v.approval_entry_id, e.subject_id AS definition_id, v.name, v.description, v.enabled, validity.validity, v.sql_text, v.parameters, v.columns
FROM approval_entries e
JOIN dcl_rpt_definition_versions v ON v.approval_entry_id=e.id
JOIN rpt_definition_validities validity ON validity.approval_entry_id=e.id
WHERE e.domain='dcl' AND e.entity='rpt-definition' AND e.subject_id=sqlc.arg(definition_id) AND e.status='APPROVED' ORDER BY e.version_no DESC LIMIT 1;
-- name: DclRptGetVersionPayload :one
SELECT v.approval_entry_id, e.subject_id AS definition_id, v.name, v.description, v.enabled, validity.validity, v.sql_text, v.parameters, v.columns
FROM dcl_rpt_definition_versions v
JOIN approval_entries e ON e.id=v.approval_entry_id
JOIN rpt_definition_validities validity ON validity.approval_entry_id=v.approval_entry_id
WHERE v.approval_entry_id=sqlc.arg(approval_entry_id) AND e.subject_id=sqlc.arg(definition_id);

-- name: DclRptInsertVersionPayload :exec
INSERT INTO dcl_rpt_definition_versions(approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by)
VALUES(sqlc.arg(approval_entry_id), sqlc.arg(enabled), sqlc.arg(name), sqlc.arg(description), sqlc.arg(sql_text), sqlc.arg(parameters), sqlc.arg(columns), sqlc.arg(actor_id), sqlc.arg(actor_id));
-- name: DclRptCopyVersionPayload :exec
INSERT INTO dcl_rpt_definition_versions(approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by)
SELECT sqlc.arg(new_approval_entry_id), source.enabled, source.name, source.description, source.sql_text,
       source.parameters, source.columns, sqlc.arg(actor_id), sqlc.arg(actor_id)
FROM dcl_rpt_definition_versions source
WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id)
  AND EXISTS (
    SELECT 1
    FROM approval_entries source_entry
    WHERE source_entry.id=source.approval_entry_id AND source_entry.subject_id=sqlc.arg(target_definition_id)
  );
-- name: DclRptUpdateDraftPayload :exec
UPDATE dcl_rpt_definition_versions
SET name=coalesce(sqlc.narg(name), name),
    description=coalesce(sqlc.narg(description), description),
    enabled=sqlc.arg(enabled),
    sql_text=sqlc.arg(sql_text), parameters=sqlc.arg(parameters), columns=sqlc.arg(columns), updated_at=now(), updated_by=sqlc.arg(actor_id)
WHERE approval_entry_id=sqlc.arg(approval_entry_id)
  AND EXISTS (
    SELECT 1
    FROM approval_entries source_entry
    WHERE source_entry.id=sqlc.arg(approval_entry_id) AND source_entry.subject_id=sqlc.arg(definition_id)
  );
-- name: DclRptDeleteVersionPayload :execrows
DELETE FROM dcl_rpt_definition_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id)
  AND EXISTS (
    SELECT 1
    FROM approval_entries source_entry
    WHERE source_entry.id=sqlc.arg(approval_entry_id) AND source_entry.subject_id=sqlc.arg(definition_id)
  );
-- name: DclRptSetDraftEnabled :execrows
UPDATE dcl_rpt_definition_versions
SET enabled=sqlc.arg(enabled), updated_at=now(), updated_by=sqlc.arg(actor_id)
WHERE approval_entry_id=sqlc.arg(approval_entry_id)
  AND EXISTS (
    SELECT 1
    FROM approval_entries source_entry
    WHERE source_entry.id=dcl_rpt_definition_versions.approval_entry_id AND source_entry.subject_id=sqlc.arg(definition_id)
  );

-- name: GetDclRptDefinitionByCode :one
SELECT id, dcl_require_subject_code(code) AS code
FROM dcl_subjects
WHERE entity='rpt-definition' AND code=sqlc.arg(code)::text;

-- name: CountDclRptDefinitions :one
WITH selected AS (
  SELECT d.id
  FROM dcl_subjects d
  LEFT JOIN LATERAL (
    SELECT id,status FROM approval_entries
    WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id
      AND status IN ('DRAFT','PENDING')
    ORDER BY version_no DESC LIMIT 1
  ) open_entry ON true
  LEFT JOIN LATERAL (
    SELECT id,status FROM approval_entries
    WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id
      AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
  ) approved_entry ON true
  LEFT JOIN dcl_rpt_definition_versions open_v ON open_v.approval_entry_id=open_entry.id
  LEFT JOIN dcl_rpt_definition_versions approved_v ON approved_v.approval_entry_id=approved_entry.id
  WHERE d.entity='rpt-definition'
    AND (sqlc.arg(include_disabled)::boolean OR coalesce(open_v.enabled, approved_v.enabled, false))
    AND (sqlc.arg(keyword)::text='' OR d.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(open_v.name, approved_v.name,'') ILIKE '%'||sqlc.arg(keyword)::text||'%')
    AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]))
)
SELECT count(*) FROM selected;

-- name: ListDclRptDefinitions :many
SELECT d.id AS definition_id, dcl_require_subject_code(d.code) AS code, coalesce(open_v.enabled, approved_v.enabled, false) AS enabled,
       COALESCE(approved_entry.id,'')::text AS approved_entry_id,
       COALESCE(open_entry.id,'')::text AS open_entry_id,
       COALESCE(open_entry.updated_at,approved_entry.updated_at) AS updated_at
FROM dcl_subjects d
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id
    AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id
    AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved_entry ON true
LEFT JOIN dcl_rpt_definition_versions open_v ON open_v.approval_entry_id=open_entry.id
LEFT JOIN dcl_rpt_definition_versions approved_v ON approved_v.approval_entry_id=approved_entry.id
WHERE d.entity='rpt-definition'
  AND (sqlc.arg(include_disabled)::boolean OR coalesce(open_v.enabled, approved_v.enabled, false))
  AND (sqlc.arg(keyword)::text='' OR d.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(open_v.name, approved_v.name,'') ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY d.code ASC
OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: CountDclRptDefinitionApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='rpt-definition'
  AND subject_id=sqlc.arg(subject_id);

-- name: ListDclRptDefinitionApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='rpt-definition'
  AND subject_id=sqlc.arg(subject_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- ── WFL Process Definition (DCL-owned) ──────────────────────────────────

-- name: InsertDclWflProcessDefinition :exec
INSERT INTO wfl_definition_runtime_states(subject_id, enabled, updated_by)
VALUES(sqlc.arg(definition_id), false, sqlc.arg(actor_id));

-- name: DeleteDclWflProcessDefinition :execrows
DELETE FROM wfl_definition_runtime_states
WHERE subject_id=sqlc.arg(definition_id);

-- name: DclWflGetLatestApprovedPayload :one
SELECT v.approval_entry_id, v.definition_id, v.script, v.diagnostic, v.compiled FROM approval_entries e JOIN dcl_wfl_process_definition_versions v ON v.approval_entry_id=e.id
WHERE e.domain='dcl' AND e.entity='wfl-process-definition' AND e.subject_id=sqlc.arg(definition_id) AND e.status='APPROVED' ORDER BY e.version_no DESC LIMIT 1;

-- name: DclWflGetVersionPayload :one
SELECT approval_entry_id, definition_id, script, diagnostic, compiled, last_trial_approval_revision
FROM dcl_wfl_process_definition_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND definition_id=sqlc.arg(definition_id);

-- name: DclWflInsertVersionPayload :exec
INSERT INTO dcl_wfl_process_definition_versions(approval_entry_id, definition_id, script, diagnostic, compiled, last_trial_approval_revision, created_by, updated_by) VALUES(sqlc.arg(approval_entry_id), sqlc.arg(definition_id), sqlc.arg(script), sqlc.narg(diagnostic), sqlc.arg(compiled), NULL, sqlc.arg(actor_id), sqlc.arg(actor_id));

-- name: DclWflCopyVersionPayload :exec
INSERT INTO dcl_wfl_process_definition_versions(approval_entry_id, definition_id, script, diagnostic, compiled, last_trial_approval_revision, created_by, updated_by)
SELECT sqlc.arg(new_approval_entry_id), source.definition_id, source.script, source.diagnostic, source.compiled, NULL, sqlc.arg(actor_id), sqlc.arg(actor_id)
FROM dcl_wfl_process_definition_versions source
WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id)
  AND source.definition_id=sqlc.arg(target_definition_id);

-- name: DclWflUpdateDraftPayload :exec
UPDATE dcl_wfl_process_definition_versions SET script=sqlc.arg(script), diagnostic=sqlc.narg(diagnostic), compiled=sqlc.arg(compiled), last_trial_approval_revision=NULL, updated_at=now(), updated_by=sqlc.arg(actor_id) WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND definition_id=sqlc.arg(definition_id);

-- name: DclWflDeleteVersionPayload :execrows
DELETE FROM dcl_wfl_process_definition_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND definition_id=sqlc.arg(definition_id);

-- name: DclWflSetDefinitionEnabled :one
WITH updated AS (
  UPDATE wfl_definition_runtime_states
  SET enabled=sqlc.arg(enabled), updated_at=now(), updated_by=sqlc.arg(actor_id)
  WHERE subject_id=sqlc.arg(definition_id)
  RETURNING subject_id,enabled
)
SELECT subject.id,subject.code,updated.enabled
FROM updated
JOIN dcl_subjects subject ON subject.id=updated.subject_id AND subject.entity='wfl-process-definition';

-- name: DclWflRecordTrial :execrows
UPDATE dcl_wfl_process_definition_versions SET last_trial_approval_revision=sqlc.arg(approval_revision), updated_at=now()
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDclWflProcessDefinitionByCode :one
SELECT subject.id, subject.code, runtime.enabled
FROM dcl_subjects subject
JOIN wfl_definition_runtime_states runtime ON runtime.subject_id=subject.id
WHERE subject.entity='wfl-process-definition' AND subject.code=sqlc.arg(code)::text;

-- name: CountDclWflProcessDefinitions :one
WITH selected AS (
  SELECT subject.id
  FROM dcl_subjects subject
  JOIN wfl_definition_runtime_states runtime ON runtime.subject_id=subject.id
  LEFT JOIN LATERAL (
    SELECT id,status FROM approval_entries
    WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=subject.id
      AND status IN ('DRAFT','PENDING')
    ORDER BY version_no DESC LIMIT 1
  ) open_entry ON true
  LEFT JOIN LATERAL (
    SELECT id,status FROM approval_entries
    WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=subject.id
      AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
  ) approved_entry ON true
  LEFT JOIN LATERAL (
    SELECT compiled->>'name' AS name FROM dcl_wfl_process_definition_versions
    WHERE approval_entry_id=approved_entry.id
  ) approved_version ON true
  WHERE subject.entity='wfl-process-definition'
    AND (sqlc.arg(enabled_filter)::integer=-1 OR runtime.enabled=(sqlc.arg(enabled_filter)::integer=1))
    AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)||'%' OR approved_version.name ILIKE '%'||sqlc.arg(keyword)||'%')
    AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]))
)
SELECT count(*) FROM selected;

-- name: ListDclWflProcessDefinitions :many
SELECT subject.id AS definition_id, subject.code, runtime.enabled,
       COALESCE(approved_entry.id,'')::text AS approved_entry_id,
       COALESCE(open_entry.id,'')::text AS open_entry_id,
       COALESCE(open_entry.updated_at,approved_entry.updated_at) AS updated_at
FROM dcl_subjects subject
JOIN wfl_definition_runtime_states runtime ON runtime.subject_id=subject.id
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=subject.id
    AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=subject.id
    AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved_entry ON true
LEFT JOIN LATERAL (
  SELECT compiled->>'name' AS name FROM dcl_wfl_process_definition_versions
  WHERE approval_entry_id=approved_entry.id
) approved_version ON true
WHERE subject.entity='wfl-process-definition'
  AND (sqlc.arg(enabled_filter)::integer=-1 OR runtime.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)||'%' OR approved_version.name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(open_entry.status,approved_entry.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY subject.code ASC
OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: CountDclWflProcessDefinitionApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='wfl-process-definition'
  AND subject_id=sqlc.arg(subject_id);

-- name: ListDclWflProcessDefinitionApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='wfl-process-definition'
  AND subject_id=sqlc.arg(subject_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: DclWflListPersistedInstanceIDs :many
SELECT id FROM wfl_definition_instances
WHERE definition_approval_entry_id=sqlc.arg(approval_entry_id)
ORDER BY id LIMIT 20;
-- name: LockDCLEmployeeLegalIdentifierClaimKey :exec
SELECT pg_advisory_xact_lock(hashtext('employee:' || sqlc.arg(normalized_legal_identifier)::text));
-- name: LockDCLEmployeeLegalIdentifierClaim :one
SELECT * FROM dcl_employee_legal_identifier_claims WHERE normalized_legal_identifier=sqlc.arg(normalized_legal_identifier) FOR UPDATE;
-- name: UpsertDCLEmployeeLegalIdentifierClaim :exec
INSERT INTO dcl_employee_legal_identifier_claims(normalized_legal_identifier,approved_employee_id,approved_approval_entry_id,open_employee_id,open_approval_entry_id) VALUES(sqlc.arg(normalized_legal_identifier),sqlc.narg(approved_employee_id),sqlc.narg(approved_approval_entry_id),sqlc.narg(open_employee_id),sqlc.narg(open_approval_entry_id)) ON CONFLICT(normalized_legal_identifier) DO UPDATE SET approved_employee_id=EXCLUDED.approved_employee_id,approved_approval_entry_id=EXCLUDED.approved_approval_entry_id,open_employee_id=EXCLUDED.open_employee_id,open_approval_entry_id=EXCLUDED.open_approval_entry_id;
-- name: DeleteDCLEmployeeLegalIdentifierClaimsForEntry :exec
UPDATE dcl_employee_legal_identifier_claims AS target SET approved_employee_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_employee_id END, approved_approval_entry_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_approval_entry_id END, open_employee_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_employee_id END, open_approval_entry_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_approval_entry_id END WHERE target.approved_approval_entry_id=sqlc.arg(approval_entry_id) OR target.open_approval_entry_id=sqlc.arg(approval_entry_id);
-- name: LockDCLSupplierLegalIdentifierClaimKey :exec
SELECT pg_advisory_xact_lock(hashtext('supplier:' || sqlc.arg(normalized_legal_identifier)::text));
-- name: LockDCLSupplierLegalIdentifierClaim :one
SELECT * FROM dcl_supplier_legal_identifier_claims WHERE normalized_legal_identifier=sqlc.arg(normalized_legal_identifier) FOR UPDATE;
-- name: UpsertDCLSupplierLegalIdentifierClaim :exec
INSERT INTO dcl_supplier_legal_identifier_claims(normalized_legal_identifier,approved_supplier_id,approved_approval_entry_id,open_supplier_id,open_approval_entry_id) VALUES(sqlc.arg(normalized_legal_identifier),sqlc.narg(approved_supplier_id),sqlc.narg(approved_approval_entry_id),sqlc.narg(open_supplier_id),sqlc.narg(open_approval_entry_id)) ON CONFLICT(normalized_legal_identifier) DO UPDATE SET approved_supplier_id=EXCLUDED.approved_supplier_id,approved_approval_entry_id=EXCLUDED.approved_approval_entry_id,open_supplier_id=EXCLUDED.open_supplier_id,open_approval_entry_id=EXCLUDED.open_approval_entry_id;
-- name: DeleteDCLSupplierLegalIdentifierClaimsForEntry :exec
UPDATE dcl_supplier_legal_identifier_claims AS target SET approved_supplier_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_supplier_id END, approved_approval_entry_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_approval_entry_id END, open_supplier_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_supplier_id END, open_approval_entry_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_approval_entry_id END WHERE target.approved_approval_entry_id=sqlc.arg(approval_entry_id) OR target.open_approval_entry_id=sqlc.arg(approval_entry_id);
-- name: LockDCLOtherUnitLegalIdentifierClaimKey :exec
SELECT pg_advisory_xact_lock(hashtext('other-unit:' || sqlc.arg(normalized_legal_identifier)::text));
-- name: LockDCLOtherUnitLegalIdentifierClaim :one
SELECT * FROM dcl_other_unit_legal_identifier_claims WHERE normalized_legal_identifier=sqlc.arg(normalized_legal_identifier) FOR UPDATE;
-- name: UpsertDCLOtherUnitLegalIdentifierClaim :exec
INSERT INTO dcl_other_unit_legal_identifier_claims(normalized_legal_identifier,approved_other_unit_id,approved_approval_entry_id,open_other_unit_id,open_approval_entry_id) VALUES(sqlc.arg(normalized_legal_identifier),sqlc.narg(approved_other_unit_id),sqlc.narg(approved_approval_entry_id),sqlc.narg(open_other_unit_id),sqlc.narg(open_approval_entry_id)) ON CONFLICT(normalized_legal_identifier) DO UPDATE SET approved_other_unit_id=EXCLUDED.approved_other_unit_id,approved_approval_entry_id=EXCLUDED.approved_approval_entry_id,open_other_unit_id=EXCLUDED.open_other_unit_id,open_approval_entry_id=EXCLUDED.open_approval_entry_id;
-- name: DeleteDCLOtherUnitLegalIdentifierClaimsForEntry :exec
UPDATE dcl_other_unit_legal_identifier_claims AS target SET approved_other_unit_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_other_unit_id END, approved_approval_entry_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_approval_entry_id END, open_other_unit_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_other_unit_id END, open_approval_entry_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_approval_entry_id END WHERE target.approved_approval_entry_id=sqlc.arg(approval_entry_id) OR target.open_approval_entry_id=sqlc.arg(approval_entry_id);
-- name: LockDCLSalesPartnerLegalIdentifierClaimKey :exec
SELECT pg_advisory_xact_lock(hashtext('sales-partner:' || sqlc.arg(normalized_legal_identifier)::text));
-- name: LockDCLSalesPartnerLegalIdentifierClaim :one
SELECT * FROM dcl_sales_partner_legal_identifier_claims WHERE normalized_legal_identifier=sqlc.arg(normalized_legal_identifier) FOR UPDATE;
-- name: UpsertDCLSalesPartnerLegalIdentifierClaim :exec
INSERT INTO dcl_sales_partner_legal_identifier_claims(normalized_legal_identifier,approved_sales_partner_id,approved_approval_entry_id,open_sales_partner_id,open_approval_entry_id) VALUES(sqlc.arg(normalized_legal_identifier),sqlc.narg(approved_sales_partner_id),sqlc.narg(approved_approval_entry_id),sqlc.narg(open_sales_partner_id),sqlc.narg(open_approval_entry_id)) ON CONFLICT(normalized_legal_identifier) DO UPDATE SET approved_sales_partner_id=EXCLUDED.approved_sales_partner_id,approved_approval_entry_id=EXCLUDED.approved_approval_entry_id,open_sales_partner_id=EXCLUDED.open_sales_partner_id,open_approval_entry_id=EXCLUDED.open_approval_entry_id;
-- name: DeleteDCLSalesPartnerLegalIdentifierClaimsForEntry :exec
UPDATE dcl_sales_partner_legal_identifier_claims AS target SET approved_sales_partner_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_sales_partner_id END, approved_approval_entry_id=CASE WHEN target.approved_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.approved_approval_entry_id END, open_sales_partner_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_sales_partner_id END, open_approval_entry_id=CASE WHEN target.open_approval_entry_id=sqlc.arg(approval_entry_id) THEN NULL ELSE target.open_approval_entry_id END WHERE target.approved_approval_entry_id=sqlc.arg(approval_entry_id) OR target.open_approval_entry_id=sqlc.arg(approval_entry_id);

-- The operating set is copied with its parent candidate and replaced by the
-- caller in the same transaction as the typed snapshot save.
-- name: DeleteDCLSupplierVersionOperatingEntities :exec
DELETE FROM dcl_supplier_version_operating_entities WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: InsertDCLSupplierVersionOperatingEntity :exec
INSERT INTO dcl_supplier_version_operating_entities(approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name) VALUES(sqlc.arg(approval_entry_id),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name));
-- name: CopyDCLSupplierVersionOperatingEntities :exec
INSERT INTO dcl_supplier_version_operating_entities(approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name) SELECT sqlc.arg(new_approval_entry_id),source.operating_entity_id,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name FROM dcl_supplier_version_operating_entities source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: ListDCLSupplierVersionOperatingEntities :many
SELECT operating.approval_entry_id,operating.operating_entity_id,operating.operating_entity_approval_entry_id,operating.operating_entity_code,operating.operating_entity_name FROM dcl_supplier_version_operating_entities operating WHERE operating.approval_entry_id=sqlc.arg(version_approval_entry_id) ORDER BY operating.operating_entity_code,operating.operating_entity_id;
-- name: DeleteDCLOtherUnitVersionOperatingEntities :exec
DELETE FROM dcl_other_unit_version_operating_entities WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: InsertDCLOtherUnitVersionOperatingEntity :exec
INSERT INTO dcl_other_unit_version_operating_entities(approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name) VALUES(sqlc.arg(approval_entry_id),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name));
-- name: CopyDCLOtherUnitVersionOperatingEntities :exec
INSERT INTO dcl_other_unit_version_operating_entities(approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name) SELECT sqlc.arg(new_approval_entry_id),source.operating_entity_id,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name FROM dcl_other_unit_version_operating_entities source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: ListDCLOtherUnitVersionOperatingEntities :many
SELECT operating.approval_entry_id,operating.operating_entity_id,operating.operating_entity_approval_entry_id,operating.operating_entity_code,operating.operating_entity_name FROM dcl_other_unit_version_operating_entities operating WHERE operating.approval_entry_id=sqlc.arg(version_approval_entry_id) ORDER BY operating.operating_entity_code,operating.operating_entity_id;
-- name: DeleteDCLSalesPartnerVersionOperatingEntities :exec
DELETE FROM dcl_sales_partner_version_operating_entities WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: InsertDCLSalesPartnerVersionOperatingEntity :exec
INSERT INTO dcl_sales_partner_version_operating_entities(approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name) VALUES(sqlc.arg(approval_entry_id),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name));
-- name: CopyDCLSalesPartnerVersionOperatingEntities :exec
INSERT INTO dcl_sales_partner_version_operating_entities(approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name) SELECT sqlc.arg(new_approval_entry_id),source.operating_entity_id,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name FROM dcl_sales_partner_version_operating_entities source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: ListDCLSalesPartnerVersionOperatingEntities :many
SELECT operating.approval_entry_id,operating.operating_entity_id,operating.operating_entity_approval_entry_id,operating.operating_entity_code,operating.operating_entity_name FROM dcl_sales_partner_version_operating_entities operating WHERE operating.approval_entry_id=sqlc.arg(version_approval_entry_id) ORDER BY operating.operating_entity_code,operating.operating_entity_id;
