-- Compatibility read DTOs for BOB callers.  These are not projections: every
-- row is derived directly from a typed DCL root and its latest APPROVED entry.

-- name: CountDCLApprovedPartiesForBOB :one
SELECT count(*)
FROM dcl_parties party
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='party' AND subject_id=party.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
JOIN dcl_party_versions snapshot ON snapshot.approval_entry_id=source.id
WHERE party.merged_into_party_id IS NULL
  AND (sqlc.arg(party_kind)::text='' OR snapshot.kind=sqlc.arg(party_kind)::text)
  AND (sqlc.arg(keyword)::text='' OR snapshot.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%');

-- name: ListDCLApprovedPartiesForBOB :many
SELECT party.id,source.id AS source_approval_entry_id,COALESCE(source.version_no,0)::integer AS source_version_no,
       snapshot.kind,snapshot.legal_name,snapshot.display_name,snapshot.tax_number,
       snapshot.phone,snapshot.email,snapshot.address,source.updated_at
FROM dcl_parties party
JOIN LATERAL (SELECT id,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='party' AND subject_id=party.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
JOIN dcl_party_versions snapshot ON snapshot.approval_entry_id=source.id
WHERE party.merged_into_party_id IS NULL
  AND (sqlc.arg(party_kind)::text='' OR snapshot.kind=sqlc.arg(party_kind)::text)
  AND (sqlc.arg(keyword)::text='' OR snapshot.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
ORDER BY snapshot.display_name,party.id
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetDCLApprovedPartyForBOB :one
SELECT party.id,source.id AS source_approval_entry_id,COALESCE(source.version_no,0)::integer AS source_version_no,
       snapshot.kind,snapshot.legal_name,snapshot.display_name,snapshot.tax_number,
       snapshot.phone,snapshot.email,snapshot.address,source.updated_at
FROM dcl_parties party
JOIN LATERAL (SELECT id,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='party' AND subject_id=party.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
JOIN dcl_party_versions snapshot ON snapshot.approval_entry_id=source.id
WHERE party.id=sqlc.arg(party_id) AND party.merged_into_party_id IS NULL;

-- name: ListDCLApprovedPartyIdentifiersForBOB :many
SELECT identifier.identifier_type,identifier.value
FROM dcl_parties party
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='party' AND subject_id=party.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
JOIN dcl_party_version_identifiers identifier ON identifier.approval_entry_id=source.id
WHERE party.id=sqlc.arg(party_id) AND party.merged_into_party_id IS NULL
ORDER BY identifier.identifier_type,identifier.value;

-- name: ListDCLApprovedPartyRelationshipCardsForBOB :many
WITH relationships AS (
  SELECT relation.object_id,'customer'::text AS entity,source.id AS source_approval_entry_id,relation.operating_entity_id,snapshot.enabled
  FROM dcl_customer_relationships relation
  JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=relation.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
  JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=source.id
  WHERE relation.party_id=sqlc.arg(party_id) AND relation.merged_into_object_id IS NULL
  UNION ALL SELECT relation.object_id,'supplier',source.id,relation.operating_entity_id,snapshot.enabled FROM dcl_supplier_relationships relation
  JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=relation.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
  JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=source.id WHERE relation.party_id=sqlc.arg(party_id) AND relation.merged_into_object_id IS NULL
  UNION ALL SELECT relation.object_id,'employee',source.id,relation.operating_entity_id,snapshot.enabled FROM dcl_employment_relationships relation
  JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=relation.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
  JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=source.id WHERE relation.party_id=sqlc.arg(party_id) AND relation.merged_into_object_id IS NULL
  UNION ALL SELECT relation.object_id,'other-unit',source.id,relation.operating_entity_id,snapshot.enabled FROM dcl_service_relationships relation
  JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=relation.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
  JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=source.id WHERE relation.party_id=sqlc.arg(party_id) AND relation.merged_into_object_id IS NULL
  UNION ALL SELECT relation.object_id,'sales-partner',source.id,relation.operating_entity_id,snapshot.enabled FROM dcl_sales_relationships relation
  JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=relation.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) source ON true
  JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=source.id WHERE relation.party_id=sqlc.arg(party_id) AND relation.merged_into_object_id IS NULL
)
SELECT relationship.object_id,relationship.entity,COALESCE(subject.code,'')::text AS code,
       relationship.source_approval_entry_id,COALESCE(source.version_no,0)::integer AS source_version_no,
       relationship.operating_entity_id,COALESCE(operating.code,'')::text AS operating_entity_code,
       COALESCE(operating_snapshot.legal_name,'')::text AS operating_entity_name,
       relationship.enabled
FROM relationships relationship
JOIN dcl_subjects subject ON subject.id=relationship.object_id AND subject.entity=relationship.entity
JOIN dcl_subjects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=operating.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) operating_entry ON true
JOIN dcl_operating_entity_versions operating_snapshot ON operating_snapshot.approval_entry_id=operating_entry.id
JOIN approval_entries source ON source.id=relationship.source_approval_entry_id AND source.domain='dcl' AND source.entity=relationship.entity AND source.status='APPROVED'
ORDER BY subject.code;

-- name: GetDCLCustomerRelationshipPartyIDForBOB :one
SELECT party_id FROM dcl_customer_relationships
WHERE object_id=sqlc.arg(object_id) AND merged_into_object_id IS NULL;

-- name: GetDCLSupplierRelationshipPartyIDForBOB :one
SELECT party_id FROM dcl_supplier_relationships
WHERE object_id=sqlc.arg(object_id) AND merged_into_object_id IS NULL;

-- name: GetBobCustomerCurrentReference :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),entry.id AS approval_entry_id,entry.version_no
FROM dcl_subjects subject
JOIN dcl_customer_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='customer' AND snapshot.enabled;

-- name: GetBobCustomerAccountCurrentReference :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),entry.id AS approval_entry_id,entry.version_no,
       snapshot.name,snapshot.settlement_method_id,snapshot.payment_method_id,snapshot.operating_entity_id,snapshot.operating_entity_approval_entry_id,
       snapshot.primary_sales_attribution_type,snapshot.primary_sales_subject_id,snapshot.primary_sales_subject_approval_entry_id
FROM dcl_subjects subject
JOIN dcl_customer_accounts account ON account.object_id=subject.id
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='customer-account' AND snapshot.enabled;

-- name: CountBobCustomerCurrents :one
SELECT count(*)
FROM dcl_subjects subject
JOIN dcl_customer_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(operating_entity_id)='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(party_id)='' OR relationship.party_id=sqlc.arg(party_id));

-- name: ListBobCustomerCurrents :many
SELECT subject.id AS object_id,COALESCE(subject.code,''),relationship.party_id,party.kind AS party_kind,party.display_name,
       relationship.operating_entity_id,snapshot.operating_entity_approval_entry_id,snapshot.operating_entity_code,snapshot.operating_entity_name,
       snapshot.enabled,entry.id AS source_approval_entry_id,COALESCE(entry.version_no,0)::integer AS source_version_no,entry.updated_at
FROM dcl_subjects subject
JOIN dcl_customer_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.kind,payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(operating_entity_id)='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(party_id)='' OR relationship.party_id=sqlc.arg(party_id))
ORDER BY COALESCE(subject.code,'') ASC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobCustomerCurrent :one
SELECT subject.id AS object_id,COALESCE(subject.code,''),relationship.party_id,party.kind AS party_kind,party.display_name,
       relationship.operating_entity_id,snapshot.operating_entity_approval_entry_id,snapshot.operating_entity_code,snapshot.operating_entity_name,
       snapshot.enabled,entry.id AS source_approval_entry_id,COALESCE(entry.version_no,0)::integer AS source_version_no,entry.updated_at
FROM dcl_subjects subject
JOIN dcl_customer_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.kind,payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='customer';

-- name: CountBobCustomerAccountCurrents :one
SELECT count(*)
FROM dcl_subjects subject
JOIN dcl_customer_accounts account ON account.object_id=subject.id
JOIN dcl_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer-account'
  AND (sqlc.arg(keyword)='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(customer_relationship_id)='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id))
  AND (sqlc.arg(operating_entity_id)='' OR snapshot.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(customer_type)='' OR snapshot.customer_type=sqlc.arg(customer_type))
  AND (sqlc.arg(sales_attribution_type)='' OR snapshot.primary_sales_attribution_type=sqlc.arg(sales_attribution_type))
  AND (sqlc.arg(sales_attribution_subject_id)='' OR snapshot.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id));

-- name: ListBobCustomerAccountCurrents :many
SELECT subject.id AS object_id,COALESCE(subject.code,''),account.customer_relationship_id,COALESCE(relationship_subject.code,'') AS customer_relationship_code,
       snapshot.name,snapshot.customer_type,snapshot.operating_entity_code,snapshot.enabled,entry.id AS source_approval_entry_id,COALESCE(entry.version_no,0)::integer AS source_version_no,entry.updated_at
FROM dcl_subjects subject
JOIN dcl_customer_accounts account ON account.object_id=subject.id
JOIN dcl_subjects relationship_subject ON relationship_subject.id=account.customer_relationship_id AND relationship_subject.entity='customer'
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer-account'
  AND (sqlc.arg(keyword)='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)||'%' OR snapshot.name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(customer_relationship_id)='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id))
  AND (sqlc.arg(operating_entity_id)='' OR snapshot.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(customer_type)='' OR snapshot.customer_type=sqlc.arg(customer_type))
  AND (sqlc.arg(sales_attribution_type)='' OR snapshot.primary_sales_attribution_type=sqlc.arg(sales_attribution_type))
  AND (sqlc.arg(sales_attribution_subject_id)='' OR snapshot.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id))
ORDER BY COALESCE(subject.code,'') ASC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobCustomerAccountCurrent :one
SELECT subject.id AS object_id,COALESCE(subject.code,''),account.customer_relationship_id,COALESCE(relationship_subject.code,'') AS customer_relationship_code,
       snapshot.enabled,entry.id AS source_approval_entry_id,COALESCE(entry.version_no,0)::integer AS source_version_no,entry.updated_at
FROM dcl_subjects subject
JOIN dcl_customer_accounts account ON account.object_id=subject.id
JOIN dcl_subjects relationship_subject ON relationship_subject.id=account.customer_relationship_id AND relationship_subject.entity='customer'
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_account_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='customer-account';

-- name: GetBobSupplierCurrentReference :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),entry.id AS approval_entry_id,entry.version_no
FROM dcl_subjects subject
JOIN dcl_supplier_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='supplier' AND snapshot.enabled;

-- name: GetBobSupplierCurrent :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),snapshot.enabled,entry.updated_at,
       entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at,
       relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,
       snapshot.short_name,snapshot.tax_number,snapshot.contact_name,snapshot.contact_phone,snapshot.email,snapshot.address,snapshot.remark,
       snapshot.settlement_method_id,snapshot.settlement_method_code,snapshot.settlement_method_name,snapshot.settlement_term_code,snapshot.settlement_rule_type,snapshot.settlement_month_offset,snapshot.settlement_day_of_month,snapshot.settlement_day_offset,
       snapshot.default_purchaser_employee_id,snapshot.default_purchaser_employee_approval_entry_id,snapshot.default_purchaser_employee_code,snapshot.default_purchaser_employee_name
FROM dcl_subjects subject
JOIN dcl_supplier_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.kind,payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='supplier';

-- name: ListBobSuppliersCurrent :many
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),snapshot.enabled,entry.updated_at,entry.id AS approval_entry_id,
       relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,snapshot.default_purchaser_employee_code,snapshot.default_purchaser_employee_name
FROM dcl_subjects subject
JOIN dcl_supplier_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.kind,payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.entity='supplier'
  AND (sqlc.arg(keyword)::text='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR snapshot.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text)
ORDER BY COALESCE(subject.code,'') ASC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountBobSuppliersCurrent :one
SELECT count(*) FROM dcl_subjects subject
JOIN dcl_supplier_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.entity='supplier'
  AND (sqlc.arg(keyword)::text='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR snapshot.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text);

-- name: GetBobEmployeeCurrent :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),snapshot.enabled,entry.updated_at,relationship.party_id,
       party.kind AS party_kind,relationship.operating_entity_id,operating.code AS operating_entity_code,operating_snapshot.legal_name AS operating_entity_name,party.display_name,
       snapshot.employee_category_id,snapshot.employee_category_code,snapshot.employee_category_name,snapshot.department_id,snapshot.department_code,snapshot.department_name,snapshot.position_id,snapshot.position_code,snapshot.position_name,snapshot.phone,snapshot.email,snapshot.hire_date,snapshot.remark,
       entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at
FROM dcl_subjects subject
JOIN dcl_employment_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.kind,payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
JOIN dcl_subjects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=operating.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) operating_entry ON true
JOIN dcl_operating_entity_versions operating_snapshot ON operating_snapshot.approval_entry_id=operating_entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='employee';

-- name: CountBobEmployees :one
SELECT count(*) FROM dcl_subjects subject
JOIN dcl_employment_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.entity='employee' AND (sqlc.arg(keyword)::text='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: ListBobEmployees :many
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),snapshot.enabled,entry.updated_at,entry.id AS approval_entry_id,party.display_name
FROM dcl_subjects subject
JOIN dcl_employment_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.entity='employee' AND (sqlc.arg(keyword)::text='' OR COALESCE(subject.code,'') ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN entry.updated_at END ASC,CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN entry.updated_at END DESC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(subject.code,'') END ASC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(subject.code,'') END DESC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN party.display_name END ASC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN party.display_name END DESC,subject.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobEmployeeCurrentReference :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),entry.id AS approval_entry_id,entry.version_no,party.display_name
FROM dcl_subjects subject JOIN dcl_employment_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='employee' AND snapshot.enabled;

-- name: GetBobOtherUnitCurrent :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),snapshot.enabled,entry.updated_at,relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,operating.code AS operating_entity_code,operating_snapshot.legal_name AS operating_entity_name,snapshot.contact_name,snapshot.contact_phone,snapshot.email,snapshot.address,snapshot.settlement_method_id,snapshot.settlement_method_code,snapshot.settlement_method_name,snapshot.settlement_term_code,snapshot.settlement_rule_type,snapshot.settlement_month_offset,snapshot.settlement_day_of_month,snapshot.settlement_day_offset,snapshot.remark,entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at
FROM dcl_subjects subject JOIN dcl_service_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id
JOIN LATERAL (SELECT payload.kind,payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
JOIN dcl_subjects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity' JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=operating.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) operating_entry ON true JOIN dcl_operating_entity_versions operating_snapshot ON operating_snapshot.approval_entry_id=operating_entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='other-unit';

-- name: GetBobOtherUnitCurrentReference :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),entry.id AS approval_entry_id,entry.version_no,party.display_name
FROM dcl_subjects subject JOIN dcl_service_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='other-unit' AND snapshot.enabled;

-- name: GetBobSalesPartnerCurrent :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),snapshot.enabled,entry.updated_at,relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,operating.code AS operating_entity_code,operating_snapshot.legal_name AS operating_entity_name,snapshot.capabilities,snapshot.contact_name,snapshot.contact_phone,snapshot.email,snapshot.address,snapshot.remark,entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at
FROM dcl_subjects subject JOIN dcl_sales_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id JOIN LATERAL (SELECT payload.kind,payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true JOIN dcl_subjects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity' JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=operating.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) operating_entry ON true JOIN dcl_operating_entity_versions operating_snapshot ON operating_snapshot.approval_entry_id=operating_entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='sales-partner';

-- name: GetBobSalesPartnerCurrentReference :one
SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,''),entry.id AS approval_entry_id,entry.version_no,party.display_name
FROM dcl_subjects subject JOIN dcl_sales_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='sales-partner' AND snapshot.enabled;

-- name: GetBobParty :one
SELECT party.id,snapshot.kind,snapshot.legal_name,snapshot.display_name,snapshot.tax_number,snapshot.phone,snapshot.email,snapshot.address,
       subject.created_at,subject.created_by,entry.updated_at,entry.updated_by,party.merged_into_party_id,party.merged_at
FROM dcl_parties party JOIN dcl_subjects subject ON subject.id=party.id AND subject.entity='party'
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='party' AND subject_id=party.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_party_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE party.id=sqlc.arg(party_id) AND party.merged_into_party_id IS NULL;

-- name: QueryBobReferenceCandidates :many
SELECT subject.id AS object_id,entry.id AS approval_entry_id,COALESCE(subject.code,'') AS code,
       COALESCE(account_snapshot.name,party_snapshot.display_name,product.name,'')::text AS name,
       COALESCE(product.behavior_profile,'')::text AS behavior_profile,
       COALESCE(product.default_input_unit_id,'')::text AS default_input_unit_id,
       COALESCE(product.pricing_unit_id,'')::text AS pricing_unit_id
FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
LEFT JOIN dcl_customer_account_versions account_snapshot ON account_snapshot.approval_entry_id=entry.id AND subject.entity='customer-account'
LEFT JOIN dcl_product_versions product ON product.approval_entry_id=entry.id AND subject.entity='product'
LEFT JOIN dcl_party_relationship_endpoints relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
LEFT JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party_snapshot ON true
WHERE subject.entity=sqlc.arg(entity)
  AND (sqlc.arg(source_object_id)::text='' OR subject.id<>sqlc.arg(source_object_id)::text)
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(account_snapshot.name,party_snapshot.display_name,product.name,'') ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(behavior_profile)::text='' OR product.behavior_profile=sqlc.arg(behavior_profile)::text)
ORDER BY subject.code LIMIT 200;

-- name: CountBobRelationshipCurrents :one
WITH selected AS (
  SELECT subject.id,subject.entity,COALESCE(subject.code,'') AS code,snapshot.enabled,entry.updated_at,party.display_name
  FROM dcl_subjects subject JOIN dcl_service_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
  JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id
  JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
  WHERE subject.entity='other-unit' AND sqlc.arg(entity)::text='other-unit'
  UNION ALL
  SELECT subject.id,subject.entity,COALESCE(subject.code,'') AS code,snapshot.enabled,entry.updated_at,party.display_name
  FROM dcl_subjects subject JOIN dcl_sales_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
  JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id
  JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true
  WHERE subject.entity='sales-partner' AND sqlc.arg(entity)::text='sales-partner'
) SELECT count(*) FROM selected WHERE (sqlc.arg(keyword)::text='' OR code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: ListBobRelationshipCurrents :many
WITH selected AS (
  SELECT subject.id AS object_id,subject.entity,COALESCE(subject.code,'') AS code,snapshot.enabled,entry.updated_at,entry.id AS approval_entry_id,party.display_name
  FROM dcl_subjects subject JOIN dcl_service_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true WHERE subject.entity='other-unit' AND sqlc.arg(entity)::text='other-unit'
  UNION ALL
  SELECT subject.id,subject.entity,COALESCE(subject.code,''),snapshot.enabled,entry.updated_at,entry.id,party.display_name
  FROM dcl_subjects subject JOIN dcl_sales_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true WHERE subject.entity='sales-partner' AND sqlc.arg(entity)::text='sales-partner'
) SELECT object_id,entity,code,enabled,updated_at,approval_entry_id FROM selected
WHERE (sqlc.arg(keyword)::text='' OR code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN updated_at END ASC,CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN updated_at END DESC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN code END ASC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN code END DESC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display_name END ASC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display_name END DESC,object_id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
