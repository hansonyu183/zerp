-- BOB provides current effective read-only business data from DCL-owned stable
-- subjects and typed snapshots. Every resolver selects the latest APPROVED
-- entry and never selects an open candidate.

-- name: FindDCLSeedSubjectID :one
SELECT subject_id
FROM approval_events
WHERE domain = 'dcl'
  AND entity = sqlc.arg(entity)
  AND request_id = sqlc.arg(request_id)
  AND action = 'CREATED'
ORDER BY created_at, id
LIMIT 1;

-- name: HasApprovalEntryApprovedEvent :one
SELECT EXISTS (
  SELECT 1
  FROM approval_events
  WHERE entry_id=sqlc.arg(approval_entry_id)
    AND action='APPROVED'
);

-- name: GetBobWarehouseCurrent :one
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.enabled,snapshot.name,snapshot.address,snapshot.contact_name,snapshot.contact_phone,snapshot.manager_employee_id,snapshot.manager_employee_approval_entry_id,snapshot.remark,entry.updated_at,entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_warehouse_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='warehouse';

-- name: CountBobWarehouses :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_warehouse_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='warehouse' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: ListBobWarehouses :many
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.enabled,snapshot.name,snapshot.address,snapshot.contact_name,snapshot.contact_phone,snapshot.manager_employee_id,snapshot.manager_employee_approval_entry_id,snapshot.remark,entry.updated_at,entry.id AS approval_entry_id,entry.version_no
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_warehouse_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='warehouse' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN entry.updated_at END ASC,
CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN entry.updated_at END DESC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN snapshot.name END ASC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN snapshot.name END DESC,subject.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobWarehouseCurrentReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,snapshot.name,snapshot.address,snapshot.contact_name,snapshot.contact_phone,snapshot.manager_employee_id,snapshot.manager_employee_approval_entry_id,snapshot.remark
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_warehouse_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='warehouse' AND snapshot.enabled;

-- BOB derives the current operating-entity view from the highest approved DCL
-- entry and its typed snapshot.
-- name: GetBobOperatingEntityCurrent :one
SELECT subject.id AS object_id, subject.entity, subject.code,
	       snapshot.enabled,
       snapshot.legal_name, snapshot.short_name, snapshot.tax_number,
       snapshot.address, snapshot.phone, snapshot.remark,
       entry.updated_at, entry.id AS approval_entry_id, entry.domain,
       entry.version_no, entry.status, entry.revision AS approval_revision,
       entry.created_by, entry.created_at, entry.updated_by, entry.updated_at AS approval_updated_at,
       entry.submitted_by, entry.submitted_at, entry.approved_by, entry.approved_at
FROM dcl_subjects subject
JOIN LATERAL (
  SELECT * FROM approval_entries
  WHERE domain='dcl' AND entity='operating-entity' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_operating_entity_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='operating-entity';

-- name: CountBobOperatingEntities :one
SELECT count(*) FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_operating_entity_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: ListBobOperatingEntities :many
SELECT subject.id AS object_id, subject.entity, subject.code,
	       snapshot.enabled, snapshot.legal_name, snapshot.short_name, snapshot.tax_number,
	       snapshot.address, snapshot.phone, snapshot.remark, entry.updated_at,
	       entry.id AS approval_entry_id, entry.version_no
FROM dcl_subjects subject
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_operating_entity_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN entry.updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN entry.updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN snapshot.legal_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN snapshot.legal_name END DESC,
  subject.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobOperatingEntityCurrentReference :one
SELECT subject.id AS object_id, subject.entity, subject.code, snapshot.enabled,
       entry.id AS approval_entry_id, entry.version_no, snapshot.legal_name, snapshot.short_name, snapshot.tax_number,
       snapshot.address, snapshot.phone, snapshot.remark
FROM dcl_subjects subject
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_operating_entity_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='operating-entity' AND snapshot.enabled;

-- name: ListBobOperatingEntityReferenceCandidates :many
SELECT subject.id AS object_id, entry.id AS approval_entry_id, subject.code, snapshot.legal_name AS name
FROM dcl_subjects subject
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_operating_entity_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='operating-entity' AND snapshot.enabled
  AND (sqlc.arg(source_object_id)::text='' OR subject.id<>sqlc.arg(source_object_id)::text)
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
ORDER BY subject.code
LIMIT 200;

-- name: GetDCLSupplierOpenEntry :one
SELECT id, domain, entity, subject_id, version_no, status, revision, created_by, created_at, updated_by, updated_at,
       submitted_by, submitted_at, approved_by, approved_at
FROM approval_entries
WHERE domain = 'dcl' AND entity = 'supplier' AND subject_id = sqlc.arg(object_id)
  AND status IN ('DRAFT', 'PENDING')
ORDER BY version_no DESC
LIMIT 1;

-- name: ListSupplierPurchaserReferencesForEmployee :many
SELECT subject.id AS object_id, subject.entity, 'supplier-purchaser'::text AS role FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN dcl_supplier_versions p ON p.approval_entry_id=e.id WHERE p.default_purchaser_employee_id=sqlc.narg(source_object_id);
-- Typed lifecycle blockers read only the latest approved DCL snapshots. Open
-- candidates and historical snapshots must never create a blocker.
-- name: ListCustomerSalesReferencesForEmployee :many
SELECT root.customer_id AS object_id,'customer'::text AS entity,'customer-sales'::text AS role
FROM dcl_customer_subunit_roots root
JOIN LATERAL (
  SELECT id FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=root.customer_id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_version_subunits line ON line.customer_approval_entry_id=entry.id AND line.subunit_id=root.subunit_id
WHERE line.enabled AND line.data->'primarySalesAttribution'->>'subjectObjectId'=sqlc.narg(source_object_id)::text
  AND line.data->'primarySalesAttribution'->>'type'='INTERNAL_EMPLOYEE';
-- name: ListCustomerSalesReferencesForSalesPartner :many
SELECT root.customer_id AS object_id,'customer'::text AS entity,
       CASE line.data->'primarySalesAttribution'->>'type'
         WHEN 'EXTERNAL_PART_TIME' THEN 'customer-external-sales' ELSE 'customer-channel-sales' END::text AS role
FROM dcl_customer_subunit_roots root
JOIN LATERAL (
  SELECT id FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=root.customer_id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_version_subunits line ON line.customer_approval_entry_id=entry.id AND line.subunit_id=root.subunit_id
WHERE line.enabled AND line.data->'primarySalesAttribution'->>'subjectObjectId'=sqlc.narg(source_object_id)::text
  AND line.data->'primarySalesAttribution'->>'type' IN ('EXTERNAL_PART_TIME','CHANNEL_PARTNER');
-- name: ListCustomerOperatingReferences :many
SELECT subject.id AS object_id,subject.entity,'customer-operating'::text AS role
FROM dcl_subjects subject
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer' AND snapshot.enabled
  AND snapshot.data->'defaultOperatingEntity'->>'sourceObjectId'=sqlc.narg(source_object_id)::text;
-- name: ListWarehouseManagerReferencesForEmployee :many
SELECT subject.id AS object_id,subject.entity,'warehouse-manager'::text AS role FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_warehouse_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='warehouse' AND snapshot.manager_employee_id=sqlc.narg(source_object_id);
-- name: ListFundOperatingReferences :many
SELECT subject.id AS object_id,subject.entity,'fund-operating'::text AS role
FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_fund_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE snapshot.operating_entity_id=sqlc.narg(source_object_id);
-- name: ListVehicleCarrierOperatingReferences :many
SELECT subject.id AS object_id,subject.entity,'vehicle-carrier-operating'::text AS role
FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE snapshot.carrier_operating_entity_id=sqlc.narg(source_object_id);
-- name: ListVehicleCarrierServiceReferences :many
SELECT subject.id AS object_id,subject.entity,'vehicle-carrier-other-unit'::text AS role
FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE snapshot.carrier_other_unit_object_id=sqlc.narg(source_object_id);
-- name: GetBobVehicleCurrent :one
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.approval_entry_id AS source_approval_entry_id,snapshot.name,snapshot.plate_number,snapshot.vehicle_type,snapshot.vehicle_type_object_id,snapshot.vehicle_type_name,snapshot.vin,snapshot.engine_number,snapshot.load_capacity_kg,snapshot.remark,snapshot.carrier_affiliation_type,snapshot.carrier_operating_entity_id,snapshot.carrier_operating_entity_approval_entry_id,snapshot.carrier_other_unit_object_id,snapshot.carrier_other_unit_approval_entry_id,snapshot.bulk_liquid_capable,snapshot.enabled,entry.updated_at,entry.updated_by,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by AS approval_updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='vehicle';
-- name: ListBobVehicles :many
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.enabled AS current_enabled,entry.updated_at FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN entry.updated_at END ASC,
CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN entry.updated_at END DESC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN snapshot.name END ASC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN snapshot.name END DESC,subject.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobVehicles :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: GetBobFundAccountCurrent :one
SELECT subject.id object_id,subject.entity,subject.code,snapshot.approval_entry_id source_approval_entry_id,snapshot.name,snapshot.currency,snapshot.account_name,snapshot.bank_name,snapshot.bank_branch,snapshot.account_number,snapshot.remark,snapshot.operating_entity_id,snapshot.operating_entity_approval_entry_id,snapshot.operating_entity_code,snapshot.operating_entity_name,snapshot.enabled,entry.updated_at,entry.updated_by,entry.domain,entry.version_no,entry.status,entry.revision approval_revision,entry.created_by,entry.created_at,entry.updated_by approval_updated_by,entry.updated_at approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_fund_account_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='fund-account';
-- name: ListBobFundAccounts :many
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.enabled,entry.id AS source_approval_entry_id,entry.version_no,snapshot.name,snapshot.currency,snapshot.account_name,snapshot.bank_name,snapshot.bank_branch,snapshot.remark,snapshot.operating_entity_id,snapshot.operating_entity_approval_entry_id,snapshot.operating_entity_code,snapshot.operating_entity_name,entry.updated_at
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_fund_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='fund-account' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN entry.updated_at END ASC, CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN entry.updated_at END DESC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN snapshot.name END ASC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN snapshot.name END DESC,subject.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobFundAccounts :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_fund_account_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1));
-- name: GetBobFundAccountCurrentReference :one
SELECT subject.id object_id,subject.entity,subject.code,snapshot.approval_entry_id approval_entry_id,entry.version_no,snapshot.name,snapshot.currency,snapshot.account_name,snapshot.bank_name,snapshot.bank_branch,snapshot.account_number,snapshot.remark,snapshot.operating_entity_id,snapshot.operating_entity_approval_entry_id,snapshot.operating_entity_code,snapshot.operating_entity_name FROM dcl_subjects subject JOIN LATERAL (SELECT id,version_no FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_fund_account_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='fund-account' AND snapshot.enabled;
-- name: GetBobVehicleCurrentReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.approval_entry_id AS approval_entry_id,entry.version_no,snapshot.name,snapshot.plate_number,snapshot.vehicle_type,snapshot.vehicle_type_object_id,snapshot.vehicle_type_name,snapshot.vin,snapshot.engine_number,snapshot.load_capacity_kg,snapshot.remark,snapshot.carrier_affiliation_type,snapshot.carrier_operating_entity_id,snapshot.carrier_operating_entity_approval_entry_id,snapshot.carrier_other_unit_object_id,snapshot.carrier_other_unit_approval_entry_id,snapshot.bulk_liquid_capable FROM dcl_subjects subject JOIN LATERAL (SELECT id,version_no FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='vehicle' AND snapshot.enabled;
-- name: ListFormulaMaterialReferences :many
SELECT subject.id AS object_id,subject.entity,'formula-material'::text AS role FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN dcl_product_formula_lines p ON p.product_approval_entry_id=e.id WHERE p.material_object_id=sqlc.arg(source_object_id);

-- Customer owns one full aggregate snapshot per approval entry.
-- name: InsertDCLCustomerVersion :exec
INSERT INTO dcl_customer_versions(approval_entry_id,data,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(data),sqlc.arg(enabled));
-- name: GetDCLCustomerVersion :one
SELECT * FROM dcl_customer_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: UpdateDCLCustomerVersion :execrows
UPDATE dcl_customer_versions SET data=sqlc.arg(data),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyDCLCustomerVersion :execrows
INSERT INTO dcl_customer_versions(approval_entry_id,data,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.data,source.enabled
FROM dcl_customer_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: DeleteDCLCustomerVersion :execrows
DELETE FROM dcl_customer_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: ListDCLCustomerAttachments :many
SELECT relation.subunit_id,relation.file_id,file.original_name,file.content_type,file.declared_size,file.sha256_hex,file.status,file.stored_at,relation.category_object_id,relation.category_code,relation.category_name,relation.created_at,relation.created_by FROM dcl_customer_attachments relation JOIN dcl_customer_files file ON file.id=relation.file_id WHERE relation.approval_entry_id=sqlc.arg(approval_entry_id) ORDER BY relation.subunit_id NULLS FIRST,relation.created_at,relation.file_id;
-- name: CopyDCLCustomerAttachments :exec
INSERT INTO dcl_customer_attachments(approval_entry_id,subunit_id,file_id,category_object_id,category_code,category_name,created_at,created_by) SELECT sqlc.arg(new_approval_entry_id),source.subunit_id,source.file_id,source.category_object_id,source.category_code,source.category_name,source.created_at,source.created_by FROM dcl_customer_attachments source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: LockDCLCustomerAttachmentOwner :one
SELECT * FROM approval_entries WHERE id=sqlc.arg(approval_entry_id) AND domain='dcl' AND entity='customer' FOR UPDATE;
-- name: CountDCLCustomerAttachments :one
SELECT count(*) FROM dcl_customer_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: InsertDCLCustomerAttachment :exec
INSERT INTO dcl_customer_attachments(approval_entry_id,subunit_id,file_id,category_object_id,category_code,category_name,created_by) VALUES(sqlc.arg(approval_entry_id),sqlc.narg(subunit_id),sqlc.arg(file_id),sqlc.arg(category_object_id),sqlc.arg(category_code),sqlc.arg(category_name),sqlc.arg(actor_id));
-- name: DeleteDCLCustomerAttachment :execrows
DELETE FROM dcl_customer_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND file_id=sqlc.arg(file_id);
-- name: GetReadyDCLCustomerAttachment :one
SELECT file.id,file.storage_key,file.original_name,file.content_type,file.declared_size FROM dcl_customer_attachments relation JOIN dcl_customer_files file ON file.id=relation.file_id WHERE relation.approval_entry_id=sqlc.arg(approval_entry_id) AND file.id=sqlc.arg(file_id) AND file.status='READY';
-- name: LockPendingDCLCustomerUpload :one
SELECT file.id,file.storage_key,file.original_name,file.content_type,file.declared_size,file.sha256_hex,file.upload_expires_at,entry.status AS owner_status FROM dcl_customer_files file JOIN dcl_customer_attachments relation ON relation.file_id=file.id JOIN approval_entries entry ON entry.id=relation.approval_entry_id WHERE file.upload_token_hash=sqlc.arg(token_hash) AND file.status='PENDING' AND file.upload_expires_at>now() FOR UPDATE OF file;
-- name: ListAllDCLCustomerStorageKeys :many
SELECT storage_key FROM dcl_customer_files ORDER BY storage_key;
-- name: ResolveCustomerDocumentCategory :one
SELECT object.id AS object_id,object.code,CAST(object.data->>'name' AS text) AS name
FROM aux_objects object
WHERE object.id=sqlc.arg(object_id) AND object.entity='dictionary-item' AND object.enabled=true AND object.data->>'dictionaryTypeCode'='DCT-0003';
-- name: InsertCustomerFile :exec
INSERT INTO dcl_customer_files(id,storage_key,original_name,content_type,declared_size,sha256_hex,upload_token_hash,upload_expires_at,created_by)
VALUES(sqlc.arg(id),sqlc.arg(storage_key),sqlc.arg(original_name),sqlc.arg(content_type),sqlc.arg(declared_size),sqlc.arg(sha256_hex),sqlc.arg(upload_token_hash),sqlc.arg(upload_expires_at),sqlc.arg(actor_id));
-- name: MarkCustomerFileReady :execrows
UPDATE dcl_customer_files SET status='READY',stored_at=now() WHERE id=sqlc.arg(file_id) AND status='PENDING';
-- name: InsertCustomerDownloadToken :exec
INSERT INTO dcl_customer_download_tokens(token_hash,file_id,expires_at,created_by) VALUES(sqlc.arg(token_hash),sqlc.arg(file_id),sqlc.arg(expires_at),sqlc.arg(actor_id));
-- name: ConsumeCustomerDownloadToken :one
UPDATE dcl_customer_download_tokens token SET used_at=now()
FROM dcl_customer_files file
WHERE token.token_hash=sqlc.arg(token_hash) AND token.used_at IS NULL AND token.expires_at>now() AND file.id=token.file_id AND file.status='READY'
RETURNING file.storage_key,file.original_name,file.content_type,file.declared_size;

-- name: InsertDCLProductSnapshot :exec
INSERT INTO dcl_product_versions (approval_entry_id, name) VALUES (sqlc.arg(approval_entry_id), sqlc.arg(name));
-- name: DeleteDCLProductSnapshot :execrows
DELETE FROM dcl_product_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- name: GetDCLProductSnapshot :one
SELECT payload.* FROM dcl_product_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: ListDCLProductSnapshotsByEntryIDs :many
SELECT payload.* FROM dcl_product_versions payload
WHERE payload.approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY payload.approval_entry_id;
-- name: ListDCLProductApprovalEntriesByEntryIDs :many
SELECT entry.* FROM approval_entries entry
WHERE entry.domain='dcl' AND entry.entity='product'
  AND entry.id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY entry.id;
-- name: GetBobOpenVehiclePayload :one
SELECT payload.* FROM dcl_vehicle_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyDCLProductSnapshot :exec
INSERT INTO dcl_product_versions(approval_entry_id,entity,name,category_id,category_code,category_name,category_entity,specification,model,barcode,remark,pricing_unit_id,returnable,default_packaging_spec_micros,product_type_id,product_type_code,product_type_name,behavior_profile,default_input_unit_id,enabled)
SELECT sqlc.arg(new_approval_entry_id),entity,name,category_id,category_code,category_name,category_entity,specification,model,barcode,remark,pricing_unit_id,returnable,default_packaging_spec_micros,product_type_id,product_type_code,product_type_name,behavior_profile,default_input_unit_id,enabled FROM dcl_product_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- BOB validates business rules through DCL-owned typed archive identities.
-- DCL is their only writer.
-- name: GetDCLProductFormula :one
SELECT * FROM dcl_product_formulas WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id);
-- name: DeleteDCLProductFormula :exec
DELETE FROM dcl_product_formulas WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id);
-- name: InsertDCLProductFormula :exec
INSERT INTO dcl_product_formulas(product_approval_entry_id,output_base_quantity_micros,output_entered_quantity_micros,output_unit_object_id,output_unit_code,output_unit_name,output_unit_symbol,output_unit_quantity_scale)
VALUES(sqlc.arg(product_approval_entry_id),sqlc.arg(output_base_quantity_micros),sqlc.arg(output_entered_quantity_micros),sqlc.arg(output_unit_object_id),sqlc.arg(output_unit_code),sqlc.arg(output_unit_name),sqlc.arg(output_unit_symbol),sqlc.arg(output_unit_quantity_scale));
-- name: ListDCLProductFormulaLines :many
SELECT line.*,material_object.code AS material_code,material.name AS material_name,
       material.behavior_profile AS material_behavior_profile
FROM dcl_product_formula_lines line
JOIN approval_entries material_entry ON material_entry.id=line.material_approval_entry_id
  AND material_entry.domain='dcl' AND material_entry.entity='product'
  AND material_entry.subject_id=line.material_object_id
JOIN dcl_subjects material_object ON material_object.id=line.material_object_id
  AND material_object.entity='product'
JOIN dcl_product_versions material ON material.approval_entry_id=material_entry.id
WHERE line.product_approval_entry_id=sqlc.arg(product_approval_entry_id)
ORDER BY line.line_no;
-- name: InsertDCLProductFormulaLine :exec
INSERT INTO dcl_product_formula_lines(product_approval_entry_id,line_no,material_object_id,material_approval_entry_id,base_quantity_micros,entered_quantity_micros,entered_unit_object_id,entered_unit_code,entered_unit_name,entered_unit_symbol,entered_unit_quantity_scale,resolution_status,requires_confirmation)
VALUES(sqlc.arg(product_approval_entry_id),sqlc.arg(line_no),sqlc.arg(material_object_id),sqlc.arg(material_approval_entry_id),sqlc.arg(base_quantity_micros),sqlc.arg(entered_quantity_micros),sqlc.arg(entered_unit_object_id),sqlc.arg(entered_unit_code),sqlc.arg(entered_unit_name),sqlc.arg(entered_unit_symbol),sqlc.arg(entered_unit_quantity_scale),sqlc.arg(resolution_status),sqlc.arg(requires_confirmation));
-- name: ListDCLProductUnitConversions :many
SELECT * FROM dcl_product_unit_conversions WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id) ORDER BY unit_object_id;
-- name: ListDCLProductUnitConversionsByEntryIDs :many
SELECT * FROM dcl_product_unit_conversions
WHERE product_approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY product_approval_entry_id,unit_object_id;
-- name: ListDCLProductFormulasByEntryIDs :many
SELECT * FROM dcl_product_formulas
WHERE product_approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY product_approval_entry_id;
-- name: ListDCLProductFormulaLinesByEntryIDs :many
SELECT line.*,material_object.code AS material_code,material.name AS material_name,
       material.behavior_profile AS material_behavior_profile
FROM dcl_product_formula_lines line
JOIN approval_entries material_entry ON material_entry.id=line.material_approval_entry_id
  AND material_entry.domain='dcl' AND material_entry.entity='product'
  AND material_entry.subject_id=line.material_object_id
JOIN dcl_subjects material_object ON material_object.id=line.material_object_id
  AND material_object.entity='product'
JOIN dcl_product_versions material ON material.approval_entry_id=material_entry.id
WHERE line.product_approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY line.product_approval_entry_id,line.line_no;
-- name: DeleteDCLProductUnitConversions :exec
DELETE FROM dcl_product_unit_conversions WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id);
-- name: InsertDCLProductUnitConversion :exec
INSERT INTO dcl_product_unit_conversions(product_approval_entry_id,unit_object_id,unit_code,unit_name,unit_symbol,unit_quantity_scale,factor_micros)
VALUES(sqlc.arg(product_approval_entry_id),sqlc.arg(unit_object_id),sqlc.arg(unit_code),sqlc.arg(unit_name),sqlc.arg(unit_symbol),sqlc.arg(unit_quantity_scale),sqlc.arg(factor_micros));

-- name: ListWarehouseDisableInventory :many
SELECT entry.product_id, object.code AS product_code, product.name AS product_name,
       sum(entry.quantity_delta_micros)::bigint AS quantity_micros
FROM acc_inventory_entries entry
JOIN acc_books book ON book.id=entry.book_id AND book.control_book
JOIN dcl_subjects object ON object.id=entry.product_id AND object.entity='product'
JOIN LATERAL (
  SELECT approval_entry.id
  FROM approval_entries approval_entry
  WHERE approval_entry.domain='dcl' AND approval_entry.entity='product'
    AND approval_entry.subject_id=object.id AND approval_entry.status='APPROVED'
  ORDER BY approval_entry.version_no DESC
  LIMIT 1
) latest ON true
JOIN dcl_product_versions product ON product.approval_entry_id=latest.id
WHERE entry.warehouse_id=sqlc.arg(warehouse_object_id)
GROUP BY entry.product_id,object.code,product.name
HAVING sum(entry.quantity_delta_micros)<>0
ORDER BY object.code,entry.product_id;

-- name: LockWarehouseDisableInventory :exec
SELECT id FROM acc_inventory_entries WHERE warehouse_id=sqlc.arg(warehouse_object_id) FOR UPDATE;

-- name: ListWarehouseDisableInProgressDocuments :many
SELECT DISTINCT document.id AS document_id,document.entity,document.document_no,approval.status
FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
WHERE approval.status IN ('DRAFT','PENDING') AND (
  EXISTS(SELECT 1 FROM vou_sale_order_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_purchase_order_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_sale_outbound_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_purchase_inbound_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_sale_signoff_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_sale_return_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_purchase_return_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_production_details x WHERE x.document_id=document.id AND (x.material_warehouse_object_id=sqlc.arg(warehouse_object_id) OR x.finished_warehouse_object_id=sqlc.arg(warehouse_object_id))) OR
  EXISTS(SELECT 1 FROM vou_inventory_count_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id))
)
ORDER BY document.entity,document.document_no,document.id;

-- name: LockWarehouseDisableDocuments :exec
SELECT document.id FROM vou_documents document WHERE (
  EXISTS(SELECT 1 FROM vou_sale_order_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_purchase_order_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_sale_outbound_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_purchase_inbound_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_sale_signoff_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_sale_return_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_purchase_return_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id)) OR
  EXISTS(SELECT 1 FROM vou_production_details x WHERE x.document_id=document.id AND (x.material_warehouse_object_id=sqlc.arg(warehouse_object_id) OR x.finished_warehouse_object_id=sqlc.arg(warehouse_object_id))) OR
  EXISTS(SELECT 1 FROM vou_inventory_count_details x WHERE x.document_id=document.id AND x.warehouse_object_id=sqlc.arg(warehouse_object_id))
) FOR UPDATE;

-- name: ListWarehouseDisableExecutableSources :many
SELECT document.id AS document_id,document.entity,document.document_no
FROM vou_documents document
JOIN vou_sale_order_details detail ON detail.document_id=document.id
JOIN approval_entries approval ON approval.id=document.approval_entry_id
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
WHERE approval.status='APPROVED' AND detail.warehouse_object_id=sqlc.arg(warehouse_object_id)
  AND EXISTS (
    SELECT 1 FROM vou_product_lines order_line
    WHERE order_line.document_id=document.id
      AND order_line.base_quantity_micros >
        COALESCE((SELECT sum(signoff_line.signed_base_quantity_micros) FROM vou_sale_signoff_lines signoff_line JOIN vou_documents signoff_document ON signoff_document.id=signoff_line.document_id JOIN approval_entries signoff_approval ON signoff_approval.id=signoff_document.approval_entry_id AND signoff_approval.domain='vou' AND signoff_approval.entity=signoff_document.entity AND signoff_approval.subject_id=signoff_document.id AND signoff_approval.status='APPROVED' WHERE signoff_line.source_order_line_id=order_line.id),0)
        + COALESCE((SELECT sum(outbound_line.base_quantity_micros) FROM vou_sale_outbound_lines outbound_line JOIN vou_documents outbound_document ON outbound_document.id=outbound_line.document_id JOIN approval_entries outbound_approval ON outbound_approval.id=outbound_document.approval_entry_id AND outbound_approval.domain='vou' AND outbound_approval.entity=outbound_document.entity AND outbound_approval.subject_id=outbound_document.id AND outbound_approval.status='APPROVED' WHERE outbound_line.source_order_line_id=order_line.id AND NOT EXISTS (SELECT 1 FROM vou_sale_signoff_lines signoff_line JOIN vou_documents signoff_document ON signoff_document.id=signoff_line.document_id JOIN approval_entries signoff_approval ON signoff_approval.id=signoff_document.approval_entry_id AND signoff_approval.domain='vou' AND signoff_approval.entity=signoff_document.entity AND signoff_approval.subject_id=signoff_document.id AND signoff_approval.status='APPROVED' WHERE signoff_line.source_outbound_line_id=outbound_line.id)),0)
  )
UNION ALL
SELECT document.id,document.entity,document.document_no FROM vou_documents document JOIN vou_purchase_order_details detail ON detail.document_id=document.id JOIN approval_entries approval ON approval.id=document.approval_entry_id AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id WHERE approval.status='APPROVED' AND detail.warehouse_object_id=sqlc.arg(warehouse_object_id) AND detail.fulfillment_status='OPEN'
UNION ALL
SELECT document.id,document.entity,document.document_no FROM vou_documents document JOIN vou_sale_signoff_details detail ON detail.document_id=document.id JOIN vou_sale_signoff_lines line ON line.document_id=document.id JOIN approval_entries approval ON approval.id=document.approval_entry_id AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id WHERE approval.status='APPROVED' AND detail.warehouse_object_id=sqlc.arg(warehouse_object_id) GROUP BY document.id,document.entity,document.document_no HAVING EXISTS(SELECT 1 FROM vou_sale_signoff_lines source_line WHERE source_line.document_id=document.id AND source_line.signed_base_quantity_micros > COALESCE((SELECT sum(return_line.base_quantity_micros) FROM vou_sale_return_lines return_line JOIN vou_sale_return_details return_detail ON return_detail.document_id=return_line.document_id WHERE return_detail.return_kind='AFTER_SALE' AND return_line.source_signoff_line_id=source_line.id),0))
UNION ALL
SELECT document.id,document.entity,document.document_no FROM vou_documents document JOIN vou_purchase_inbound_details detail ON detail.document_id=document.id JOIN vou_purchase_inbound_lines line ON line.document_id=document.id JOIN approval_entries approval ON approval.id=document.approval_entry_id AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id WHERE approval.status='APPROVED' AND detail.warehouse_object_id=sqlc.arg(warehouse_object_id) GROUP BY document.id,document.entity,document.document_no HAVING EXISTS(SELECT 1 FROM vou_purchase_inbound_lines source_line WHERE source_line.document_id=document.id AND source_line.base_quantity_micros > COALESCE((SELECT sum(return_line.base_quantity_micros) FROM vou_purchase_return_lines return_line WHERE return_line.source_inbound_line_id=source_line.id),0))
ORDER BY entity,document_no,document_id;

-- name: UpdateDCLProductSnapshot :execrows
UPDATE dcl_product_versions SET name=sqlc.arg(name),category_id=sqlc.narg(category_id),category_code=sqlc.narg(category_code),category_name=sqlc.narg(category_name),specification=sqlc.narg(specification),model=sqlc.narg(model),barcode=sqlc.narg(barcode),remark=sqlc.narg(remark),pricing_unit_id=sqlc.narg(pricing_unit_id),default_packaging_spec_micros=sqlc.narg(default_packaging_spec_micros),product_type_id=sqlc.narg(product_type_id),product_type_code=sqlc.narg(product_type_code),product_type_name=sqlc.narg(product_type_name),behavior_profile=sqlc.narg(behavior_profile),default_input_unit_id=sqlc.narg(default_input_unit_id),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetBobProductCurrentReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_product_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='product' AND snapshot.enabled;
-- name: GetBobProductCurrent :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='product';
-- name: ListBobProductsCurrent :many
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.enabled,entry.updated_at,entry.id AS approval_entry_id
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_product_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(category_id)::text='' OR snapshot.category_id=sqlc.arg(category_id)::text)
  AND (sqlc.arg(product_type_id)::text='' OR snapshot.product_type_id=sqlc.arg(product_type_id)::text)
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN entry.updated_at END ASC,CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN entry.updated_at END DESC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN subject.code END ASC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN subject.code END DESC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN snapshot.name END ASC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN snapshot.name END DESC,subject.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobProductsCurrent :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_product_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(category_id)::text='' OR snapshot.category_id=sqlc.arg(category_id)::text) AND (sqlc.arg(product_type_id)::text='' OR snapshot.product_type_id=sqlc.arg(product_type_id)::text);
-- name: QueryBobProductReferenceCandidates :many
SELECT subject.id AS object_id,entry.id AS approval_entry_id,subject.code,snapshot.name,COALESCE(snapshot.behavior_profile,'')::text AS behavior_profile,COALESCE(snapshot.default_input_unit_id,'')::text AS default_input_unit_id,COALESCE(snapshot.pricing_unit_id,'')::text AS pricing_unit_id
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_product_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE snapshot.enabled AND (sqlc.arg(source_object_id)::text='' OR subject.id<>sqlc.arg(source_object_id)::text) AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(behavior_profile)::text='' OR snapshot.behavior_profile=sqlc.arg(behavior_profile)::text) ORDER BY subject.code LIMIT 200;
