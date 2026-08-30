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

-- name: ListBobCustomerAccountObjects :many
SELECT subject.id,subject.entity,subject.code,0::bigint AS revision,true AS enabled,
       subject.created_at,subject.created_by,subject.created_at AS updated_at,subject.created_by AS updated_by
FROM dcl_customer_accounts account
JOIN dcl_subjects subject ON subject.id=account.object_id AND subject.entity='customer-account'
WHERE account.customer_relationship_id=sqlc.arg(customer_relationship_id)
ORDER BY subject.code;

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
SELECT subject.id AS object_id,subject.entity,'customer-sales'::text AS role
FROM dcl_subjects subject
JOIN dcl_customer_accounts account ON account.object_id=subject.id
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer-account' AND snapshot.enabled
  AND snapshot.primary_sales_subject_id=sqlc.narg(source_object_id)
  AND snapshot.primary_sales_attribution_type='INTERNAL_EMPLOYEE';
-- name: ListCustomerSalesReferencesForSalesPartner :many
SELECT subject.id AS object_id,subject.entity,
       CASE snapshot.primary_sales_attribution_type
         WHEN 'EXTERNAL_PART_TIME' THEN 'customer-external-sales' ELSE 'customer-channel-sales' END::text AS role
FROM dcl_subjects subject
JOIN dcl_customer_accounts account ON account.object_id=subject.id
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer-account' AND snapshot.enabled
  AND snapshot.primary_sales_subject_id=sqlc.narg(source_object_id)
  AND snapshot.primary_sales_attribution_type IN ('EXTERNAL_PART_TIME','CHANNEL_PARTNER');
-- name: ListCustomerOperatingReferences :many
SELECT subject.id AS object_id,subject.entity,'customer-operating'::text AS role
FROM dcl_subjects subject
JOIN dcl_customer_relationships relationship ON relationship.object_id=subject.id
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer' AND snapshot.enabled AND relationship.merged_into_object_id IS NULL
  AND relationship.operating_entity_id=sqlc.narg(source_object_id);
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
SELECT subject.id AS object_id,subject.entity,'vehicle-carrier-service'::text AS role
FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE snapshot.carrier_service_relationship_object_id=sqlc.narg(source_object_id);
-- name: GetBobVehicleCurrent :one
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.approval_entry_id AS source_approval_entry_id,snapshot.name,snapshot.plate_number,snapshot.vehicle_type,snapshot.vehicle_type_object_id,snapshot.vehicle_type_name,snapshot.vin,snapshot.engine_number,snapshot.load_capacity_kg,snapshot.remark,snapshot.carrier_affiliation_type,snapshot.carrier_operating_entity_id,snapshot.carrier_operating_entity_approval_entry_id,snapshot.carrier_service_relationship_object_id,snapshot.carrier_service_relationship_approval_entry_id,snapshot.bulk_liquid_capable,snapshot.enabled,entry.updated_at,entry.updated_by,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by AS approval_updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='vehicle';
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
SELECT subject.id AS object_id,subject.entity,subject.code,snapshot.approval_entry_id AS approval_entry_id,entry.version_no,snapshot.name,snapshot.plate_number,snapshot.vehicle_type,snapshot.vehicle_type_object_id,snapshot.vehicle_type_name,snapshot.vin,snapshot.engine_number,snapshot.load_capacity_kg,snapshot.remark,snapshot.carrier_affiliation_type,snapshot.carrier_operating_entity_id,snapshot.carrier_operating_entity_approval_entry_id,snapshot.carrier_service_relationship_object_id,snapshot.carrier_service_relationship_approval_entry_id,snapshot.bulk_liquid_capable FROM dcl_subjects subject JOIN LATERAL (SELECT id,version_no FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='vehicle' AND snapshot.enabled;
-- name: ListFormulaMaterialReferences :many
SELECT subject.id AS object_id,subject.entity,'formula-material'::text AS role FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN dcl_product_formula_lines p ON p.product_approval_entry_id=e.id WHERE p.material_object_id=sqlc.arg(source_object_id);

-- #287 DCL Customer relationship declaration payload.
-- name: InsertDCLCustomerVersion :exec
INSERT INTO dcl_customer_versions(approval_entry_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),sqlc.arg(enabled));
-- name: GetDCLCustomerVersion :one
SELECT * FROM dcl_customer_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: UpdateDCLCustomerVersion :execrows
UPDATE dcl_customer_versions SET enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyDCLCustomerVersion :execrows
INSERT INTO dcl_customer_versions(approval_entry_id,entity,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name,source.enabled
FROM dcl_customer_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: DeleteDCLCustomerVersion :execrows
DELETE FROM dcl_customer_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- #287 Customer Account is a distinct DCL Approval subject. DCL owns
-- the immutable account-to-customer binding; BOB reads latest APPROVED data.
-- name: InsertDCLCustomerAccountVersion :exec
INSERT INTO dcl_customer_account_versions(approval_entry_id,name,customer_type,customer_type_code,customer_type_name,short_name,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_due_days,settlement_month_offset,settlement_cutoff_day,settlement_sales_surcharge_cents,payment_method_id,payment_method_code,payment_method_name,payment_sales_surcharge_cents,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,operating_entity_tax_number,operating_entity_address,operating_entity_phone,default_transport_method_code,default_transport_method_name,transport_surcharge_cents,pricing_policy,primary_sales_attribution_type,primary_sales_subject_id,primary_sales_subject_approval_entry_id,primary_sales_subject_code,primary_sales_subject_name,internal_reminder,default_sales_order_remark,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.arg(customer_type),sqlc.arg(customer_type_code),sqlc.arg(customer_type_name),sqlc.narg(short_name),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(settlement_method_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.arg(settlement_due_days),sqlc.arg(settlement_month_offset),sqlc.arg(settlement_cutoff_day),sqlc.arg(settlement_sales_surcharge_cents),sqlc.narg(payment_method_id),sqlc.narg(payment_method_code),sqlc.narg(payment_method_name),sqlc.arg(payment_sales_surcharge_cents),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),sqlc.narg(operating_entity_tax_number),sqlc.narg(operating_entity_address),sqlc.narg(operating_entity_phone),sqlc.narg(default_transport_method_code),sqlc.narg(default_transport_method_name),sqlc.arg(transport_surcharge_cents),sqlc.arg(pricing_policy),sqlc.narg(primary_sales_attribution_type),sqlc.narg(primary_sales_subject_id),sqlc.narg(primary_sales_subject_approval_entry_id),sqlc.narg(primary_sales_subject_code),sqlc.narg(primary_sales_subject_name),sqlc.narg(internal_reminder),sqlc.narg(default_sales_order_remark),sqlc.arg(enabled));

-- name: GetDCLCustomerAccountVersion :one
SELECT * FROM dcl_customer_account_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyDCLCustomerAccountVersion :execrows
INSERT INTO dcl_customer_account_versions(approval_entry_id,entity,name,customer_type,customer_type_code,customer_type_name,short_name,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_due_days,settlement_month_offset,settlement_cutoff_day,settlement_sales_surcharge_cents,payment_method_id,payment_method_code,payment_method_name,payment_sales_surcharge_cents,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,operating_entity_tax_number,operating_entity_address,operating_entity_phone,default_transport_method_code,default_transport_method_name,transport_surcharge_cents,pricing_policy,primary_sales_attribution_type,primary_sales_subject_id,primary_sales_subject_approval_entry_id,primary_sales_subject_code,primary_sales_subject_name,internal_reminder,default_sales_order_remark,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.name,source.customer_type,source.customer_type_code,source.customer_type_name,source.short_name,source.tax_number,source.contact_name,source.contact_phone,source.email,source.address,source.remark,source.settlement_method_id,source.settlement_method_code,source.settlement_method_name,source.settlement_term_code,source.settlement_rule_type,source.settlement_due_days,source.settlement_month_offset,source.settlement_cutoff_day,source.settlement_sales_surcharge_cents,source.payment_method_id,source.payment_method_code,source.payment_method_name,source.payment_sales_surcharge_cents,source.operating_entity_id,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name,source.operating_entity_tax_number,source.operating_entity_address,source.operating_entity_phone,source.default_transport_method_code,source.default_transport_method_name,source.transport_surcharge_cents,source.pricing_policy,source.primary_sales_attribution_type,source.primary_sales_subject_id,source.primary_sales_subject_approval_entry_id,source.primary_sales_subject_code,source.primary_sales_subject_name,source.internal_reminder,source.default_sales_order_remark,source.enabled FROM dcl_customer_account_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLCustomerAccountVersion :execrows
UPDATE dcl_customer_account_versions SET name=sqlc.arg(name),customer_type=sqlc.arg(customer_type),customer_type_code=sqlc.arg(customer_type_code),customer_type_name=sqlc.arg(customer_type_name),short_name=sqlc.narg(short_name),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_due_days=sqlc.arg(settlement_due_days),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_cutoff_day=sqlc.arg(settlement_cutoff_day),settlement_sales_surcharge_cents=sqlc.arg(settlement_sales_surcharge_cents),payment_method_id=sqlc.narg(payment_method_id),payment_method_code=sqlc.narg(payment_method_code),payment_method_name=sqlc.narg(payment_method_name),payment_sales_surcharge_cents=sqlc.arg(payment_sales_surcharge_cents),operating_entity_id=sqlc.arg(operating_entity_id),operating_entity_approval_entry_id=sqlc.arg(operating_entity_approval_entry_id),operating_entity_code=sqlc.arg(operating_entity_code),operating_entity_name=sqlc.arg(operating_entity_name),operating_entity_tax_number=sqlc.narg(operating_entity_tax_number),operating_entity_address=sqlc.narg(operating_entity_address),operating_entity_phone=sqlc.narg(operating_entity_phone),default_transport_method_code=sqlc.narg(default_transport_method_code),default_transport_method_name=sqlc.narg(default_transport_method_name),transport_surcharge_cents=sqlc.arg(transport_surcharge_cents),pricing_policy=sqlc.arg(pricing_policy),primary_sales_attribution_type=sqlc.narg(primary_sales_attribution_type),primary_sales_subject_id=sqlc.narg(primary_sales_subject_id),primary_sales_subject_approval_entry_id=sqlc.narg(primary_sales_subject_approval_entry_id),primary_sales_subject_code=sqlc.narg(primary_sales_subject_code),primary_sales_subject_name=sqlc.narg(primary_sales_subject_name),internal_reminder=sqlc.narg(internal_reminder),default_sales_order_remark=sqlc.narg(default_sales_order_remark),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLCustomerAccountVersion :execrows
DELETE FROM dcl_customer_account_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: ListDCLCustomerAccountCreditLimits :many
SELECT * FROM dcl_customer_account_credit_limits WHERE approval_entry_id=sqlc.arg(approval_entry_id) ORDER BY currency;
-- name: InsertDCLCustomerAccountCreditLimit :exec
INSERT INTO dcl_customer_account_credit_limits(approval_entry_id,currency,amount_cents) VALUES(sqlc.arg(approval_entry_id),sqlc.arg(currency),sqlc.arg(amount_cents));
-- name: DeleteDCLCustomerAccountCreditLimits :exec
DELETE FROM dcl_customer_account_credit_limits WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyDCLCustomerAccountCreditLimits :exec
INSERT INTO dcl_customer_account_credit_limits(approval_entry_id,currency,amount_cents) SELECT sqlc.arg(new_approval_entry_id),source.currency,source.amount_cents FROM dcl_customer_account_credit_limits source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: GetDCLCustomerAccountIdentity :one
SELECT account.customer_relationship_id FROM dcl_customer_accounts account JOIN dcl_subjects subject ON subject.id=account.object_id AND subject.entity='customer-account' WHERE account.object_id=sqlc.arg(object_id);
-- name: CountDCLCustomerAccounts :one
SELECT count(*) FROM dcl_subjects subject JOIN dcl_customer_accounts account ON account.object_id=subject.id JOIN dcl_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id LEFT JOIN LATERAL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_customer_account_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)  WHERE subject.entity='customer-account' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(customer_relationship_id)::text='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id)) AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)) AND (sqlc.arg(customer_type)::text='' OR display.customer_type=sqlc.arg(customer_type)) AND (sqlc.arg(sales_attribution_type)::text='' OR display.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)) AND (sqlc.arg(sales_attribution_subject_id)::text='' OR display.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));
-- name: ListDCLCustomerAccounts :many
SELECT subject.id AS object_id,subject.code,account.customer_relationship_id,display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,COALESCE(approved.id,'')::text AS latest_approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id FROM dcl_subjects subject JOIN dcl_customer_accounts account ON account.object_id=subject.id JOIN dcl_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id  LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_customer_account_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='customer-account' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(customer_relationship_id)::text='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id)) AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)) AND (sqlc.arg(customer_type)::text='' OR display.customer_type=sqlc.arg(customer_type)) AND (sqlc.arg(sales_attribution_type)::text='' OR display.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)) AND (sqlc.arg(sales_attribution_subject_id)::text='' OR display.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[])) ORDER BY subject.code LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountDCLCustomerAccountApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='customer-account' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLCustomerAccountApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='customer-account' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: ListDCLCustomerAttachments :many
SELECT relation.file_id,file.original_name,file.content_type,file.declared_size,file.sha256_hex,file.status,file.stored_at,relation.category_object_id,relation.category_code,relation.category_name,relation.created_at,relation.created_by FROM dcl_customer_attachments relation JOIN dcl_customer_files file ON file.id=relation.file_id WHERE relation.approval_entry_id=sqlc.arg(approval_entry_id) ORDER BY relation.created_at,relation.file_id;
-- name: ListDCLCustomerAccountAttachments :many
SELECT relation.file_id,file.original_name,file.content_type,file.declared_size,file.sha256_hex,file.status,file.stored_at,relation.category_object_id,relation.category_code,relation.category_name,relation.created_at,relation.created_by FROM dcl_customer_account_attachments relation JOIN dcl_customer_files file ON file.id=relation.file_id WHERE relation.approval_entry_id=sqlc.arg(approval_entry_id) ORDER BY relation.created_at,relation.file_id;
-- name: CopyDCLCustomerAccountAttachments :exec
INSERT INTO dcl_customer_account_attachments(approval_entry_id,file_id,category_object_id,category_code,category_name,created_at,created_by) SELECT sqlc.arg(new_approval_entry_id),source.file_id,source.category_object_id,source.category_code,source.category_name,source.created_at,source.created_by FROM dcl_customer_account_attachments source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: LockDCLCustomerAttachmentOwner :one
SELECT * FROM approval_entries WHERE id=sqlc.arg(approval_entry_id) AND domain='dcl' AND entity='customer' FOR UPDATE;
-- name: LockDCLCustomerAccountAttachmentOwner :one
SELECT * FROM approval_entries WHERE id=sqlc.arg(approval_entry_id) AND domain='dcl' AND entity='customer-account' FOR UPDATE;
-- name: CountDCLCustomerAttachments :one
SELECT count(*) FROM dcl_customer_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CountDCLCustomerAccountAttachments :one
SELECT count(*) FROM dcl_customer_account_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: InsertDCLCustomerAttachment :exec
INSERT INTO dcl_customer_attachments(approval_entry_id,file_id,category_object_id,category_code,category_name,created_by) VALUES(sqlc.arg(approval_entry_id),sqlc.arg(file_id),sqlc.arg(category_object_id),sqlc.arg(category_code),sqlc.arg(category_name),sqlc.arg(actor_id));
-- name: InsertDCLCustomerAccountAttachment :exec
INSERT INTO dcl_customer_account_attachments(approval_entry_id,file_id,category_object_id,category_code,category_name,created_by) VALUES(sqlc.arg(approval_entry_id),sqlc.arg(file_id),sqlc.arg(category_object_id),sqlc.arg(category_code),sqlc.arg(category_name),sqlc.arg(actor_id));
-- name: DeleteDCLCustomerAttachment :execrows
DELETE FROM dcl_customer_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND file_id=sqlc.arg(file_id);
-- name: DeleteDCLCustomerAccountAttachment :execrows
DELETE FROM dcl_customer_account_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND file_id=sqlc.arg(file_id);
-- name: GetReadyDCLCustomerAttachment :one
SELECT file.id,file.storage_key,file.original_name,file.content_type,file.declared_size FROM dcl_customer_attachments relation JOIN dcl_customer_files file ON file.id=relation.file_id WHERE relation.approval_entry_id=sqlc.arg(approval_entry_id) AND file.id=sqlc.arg(file_id) AND file.status='READY';
-- name: GetReadyDCLCustomerAccountAttachment :one
SELECT file.id,file.storage_key,file.original_name,file.content_type,file.declared_size FROM dcl_customer_account_attachments relation JOIN dcl_customer_files file ON file.id=relation.file_id WHERE relation.approval_entry_id=sqlc.arg(approval_entry_id) AND file.id=sqlc.arg(file_id) AND file.status='READY';
-- name: LockPendingDCLCustomerUpload :one
SELECT file.id,file.storage_key,file.original_name,file.content_type,file.declared_size,file.sha256_hex,file.upload_expires_at,entry.status AS owner_status FROM dcl_customer_files file JOIN (SELECT approval_entry_id,file_id FROM dcl_customer_attachments UNION ALL SELECT approval_entry_id,file_id FROM dcl_customer_account_attachments) relation ON relation.file_id=file.id JOIN approval_entries entry ON entry.id=relation.approval_entry_id WHERE file.upload_token_hash=sqlc.arg(token_hash) AND file.status='PENDING' AND file.upload_expires_at>now() FOR UPDATE OF file;
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
-- BOB validates business rules through DCL-owned typed relationship identities.
-- DCL is their only writer.
-- name: GetBobCustomerRelationship :one
SELECT * FROM dcl_customer_relationships WHERE object_id=sqlc.arg(object_id);
-- name: GetBobSupplierRelationship :one
SELECT * FROM dcl_supplier_relationships WHERE object_id=sqlc.arg(object_id);
-- name: GetBobOtherUnitRelationship :one
SELECT * FROM dcl_service_relationships WHERE object_id=sqlc.arg(object_id);
-- name: GetBobEmployeeRelationship :one
SELECT * FROM dcl_employment_relationships WHERE object_id=sqlc.arg(object_id);
-- name: GetBobSalesPartnerRelationship :one
SELECT * FROM dcl_sales_relationships WHERE object_id=sqlc.arg(object_id);
-- name: GetBobCustomerAccountRelationship :one
SELECT * FROM dcl_customer_accounts WHERE object_id=sqlc.arg(object_id);

-- DCL Product snapshots are keyed by their DCL Approval entry; DCL owns every
-- mutation and BOB reads the selected approved snapshot.
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
