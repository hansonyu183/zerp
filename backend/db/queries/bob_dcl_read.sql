-- Typed read queries for BOB callers. Every row is derived directly from a
-- typed DCL subject and its latest APPROVED entry.

-- name: GetBobCustomerCurrentReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,snapshot.data
FROM dcl_subjects subject
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='customer' AND snapshot.enabled;

-- name: GetBobCustomerHistoricalReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,snapshot.data
FROM dcl_subjects subject
JOIN approval_entries entry ON entry.id=sqlc.arg(approval_entry_id) AND entry.domain='dcl' AND entry.entity='customer'
  AND entry.subject_id=subject.id AND entry.status='APPROVED'
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='customer';

-- Customer subunits are child roots of Customer, not DCL subjects.  These
-- queries deliberately retain the customer-subunit wire entity only for
-- internal VOU/ACC reference resolution.
-- name: GetBobEmbeddedCustomerSubunitCurrentReference :one
SELECT root.subunit_id AS object_id,root.customer_id,root.code,entry.id AS approval_entry_id,entry.version_no,line.data,customer.data AS customer_data
FROM dcl_customer_subunit_roots root
JOIN LATERAL (
  SELECT id,version_no FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=root.customer_id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_version_subunits line ON line.customer_approval_entry_id=entry.id AND line.subunit_id=root.subunit_id
JOIN dcl_customer_versions customer ON customer.approval_entry_id=entry.id
WHERE root.subunit_id=sqlc.arg(object_id) AND customer.enabled AND line.enabled;

-- name: GetBobEmbeddedCustomerSubunitHistoricalReference :one
SELECT root.subunit_id AS object_id,root.customer_id,root.code,entry.id AS approval_entry_id,entry.version_no,line.data,customer.data AS customer_data
FROM dcl_customer_subunit_roots root
JOIN approval_entries entry ON entry.id=sqlc.arg(approval_entry_id) AND entry.domain='dcl' AND entry.entity='customer'
  AND entry.subject_id=root.customer_id AND entry.status='APPROVED'
JOIN dcl_customer_version_subunits line ON line.customer_approval_entry_id=entry.id AND line.subunit_id=root.subunit_id
JOIN dcl_customer_versions customer ON customer.approval_entry_id=entry.id
WHERE root.subunit_id=sqlc.arg(object_id);

-- name: ListBobEmbeddedCustomerSubunitReferenceCandidates :many
SELECT root.subunit_id AS object_id,root.customer_id,entry.id AS approval_entry_id,root.code,COALESCE(line.data->>'name',root.code) AS name
FROM dcl_customer_subunit_roots root
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=root.customer_id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_customer_version_subunits line ON line.customer_approval_entry_id=entry.id AND line.subunit_id=root.subunit_id
JOIN dcl_customer_versions customer ON customer.approval_entry_id=entry.id
WHERE customer.enabled
  AND line.enabled
  AND (sqlc.arg(keyword)::text='' OR root.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(line.data->>'name','') ILIKE '%'||sqlc.arg(keyword)::text||'%')
ORDER BY root.code;

-- name: CountBobCustomerCurrents :one
SELECT count(*)
FROM dcl_subjects subject
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)='' OR subject.code ILIKE '%'||sqlc.arg(keyword)||'%' OR snapshot.data->>'displayName' ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(operating_entity_id)='' OR snapshot.data->'defaultOperatingEntity'->>'sourceObjectId'=sqlc.arg(operating_entity_id));

-- name: ListBobCustomerCurrents :many
SELECT subject.id AS object_id,subject.code,COALESCE(snapshot.data->>'displayName','')::text AS display_name,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'sourceObjectId','')::text AS operating_entity_id,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'approvalEntryId','')::text AS operating_entity_approval_entry_id,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'code','')::text AS operating_entity_code,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'name','')::text AS operating_entity_name,
       snapshot.enabled,entry.id AS source_approval_entry_id,COALESCE(entry.version_no,0)::integer AS source_version_no,entry.updated_at
FROM dcl_subjects subject
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)='' OR subject.code ILIKE '%'||sqlc.arg(keyword)||'%' OR snapshot.data->>'displayName' ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(operating_entity_id)='' OR snapshot.data->'defaultOperatingEntity'->>'sourceObjectId'=sqlc.arg(operating_entity_id))
ORDER BY subject.code ASC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobCustomerCurrent :one
SELECT subject.id AS object_id,subject.code,COALESCE(snapshot.data->>'displayName','')::text AS display_name,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'sourceObjectId','')::text AS operating_entity_id,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'approvalEntryId','')::text AS operating_entity_approval_entry_id,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'code','')::text AS operating_entity_code,
       COALESCE(snapshot.data->'defaultOperatingEntity'->>'name','')::text AS operating_entity_name,
       snapshot.enabled,entry.id AS source_approval_entry_id,COALESCE(entry.version_no,0)::integer AS source_version_no,entry.updated_at,snapshot.data
FROM dcl_subjects subject
JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='customer';

-- name: GetBobSupplierCurrentTyped :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.*
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='supplier';
-- name: GetBobSupplierCurrentTypedReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,snapshot.display_name
FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(object_id) AND subject.entity='supplier' AND snapshot.enabled AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_supplier_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)));
-- name: ListBobSupplierCurrentsTyped :many
SELECT subject.id AS object_id,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.* FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='supplier' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_supplier_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))) ORDER BY subject.code LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobSupplierCurrentsTyped :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='supplier' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_supplier_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)));

-- name: GetBobEmployeeCurrentTyped :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.* FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='employee';
-- name: GetBobEmployeeCurrentTypedReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,snapshot.display_name FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='employee' AND snapshot.enabled;
-- name: ListBobEmployeeCurrentsTyped :many
SELECT subject.id AS object_id,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.* FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='employee' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) ORDER BY subject.code LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobEmployeeCurrentsTyped :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='employee' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: GetBobOtherUnitCurrentTyped :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.* FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='other-unit';
-- name: GetBobOtherUnitCurrentTypedReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,snapshot.display_name FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='other-unit' AND snapshot.enabled AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_other_unit_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)));
-- name: ListBobOtherUnitCurrentsTyped :many
SELECT subject.id AS object_id,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.* FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='other-unit' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_other_unit_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))) ORDER BY subject.code LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobOtherUnitCurrentsTyped :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='other-unit' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_other_unit_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)));

-- name: GetBobSalesPartnerCurrentTyped :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.* FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='sales-partner';
-- name: GetBobSalesPartnerCurrentTypedReference :one
SELECT subject.id AS object_id,subject.entity,subject.code,entry.id AS approval_entry_id,entry.version_no,snapshot.display_name FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.id=sqlc.arg(object_id) AND subject.entity='sales-partner' AND snapshot.enabled AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_sales_partner_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)));
-- name: ListBobSalesPartnerCurrentsTyped :many
SELECT subject.id AS object_id,subject.code,entry.id AS approval_entry_id,entry.version_no,entry.updated_at,snapshot.* FROM dcl_subjects subject JOIN LATERAL (SELECT * FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='sales-partner' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_sales_partner_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))) ORDER BY subject.code LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobSalesPartnerCurrentsTyped :one
SELECT count(*) FROM dcl_subjects subject JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id WHERE subject.entity='sales-partner' AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR snapshot.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR snapshot.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR EXISTS (SELECT 1 FROM dcl_sales_partner_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id)));

-- name: QueryBobTypedReferenceCandidates :many
SELECT subject.id AS object_id,entry.id AS approval_entry_id,subject.code,
       COALESCE(supplier.display_name,employee.display_name,other_unit.display_name,sales_partner.display_name,product.name,'')::text AS name,
       COALESCE(product.behavior_profile,'')::text AS behavior_profile,
       COALESCE(product.default_input_unit_id,'')::text AS default_input_unit_id,
       COALESCE(product.pricing_unit_id,'')::text AS pricing_unit_id
FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
LEFT JOIN dcl_product_versions product ON product.approval_entry_id=entry.id AND subject.entity='product' AND product.enabled
LEFT JOIN dcl_supplier_versions supplier ON supplier.approval_entry_id=entry.id AND subject.entity='supplier' AND supplier.enabled
LEFT JOIN dcl_employee_versions employee ON employee.approval_entry_id=entry.id AND subject.entity='employee' AND employee.enabled
LEFT JOIN dcl_other_unit_versions other_unit ON other_unit.approval_entry_id=entry.id AND subject.entity='other-unit' AND other_unit.enabled
LEFT JOIN dcl_sales_partner_versions sales_partner ON sales_partner.approval_entry_id=entry.id AND subject.entity='sales-partner' AND sales_partner.enabled
WHERE subject.entity=sqlc.arg(entity) AND (sqlc.arg(source_object_id)::text='' OR subject.id<>sqlc.arg(source_object_id))
	AND ((subject.entity='product' AND product.approval_entry_id IS NOT NULL)
	  OR (subject.entity='supplier' AND supplier.approval_entry_id IS NOT NULL)
	  OR (subject.entity='employee' AND employee.approval_entry_id IS NOT NULL)
	  OR (subject.entity='other-unit' AND other_unit.approval_entry_id IS NOT NULL)
	  OR (subject.entity='sales-partner' AND sales_partner.approval_entry_id IS NOT NULL))
  AND (sqlc.arg(keyword)::text='' OR subject.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(supplier.display_name,employee.display_name,other_unit.display_name,sales_partner.display_name,product.name,'') ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(behavior_profile)::text='' OR product.behavior_profile=sqlc.arg(behavior_profile)::text)
  AND (sqlc.arg(operating_entity_id)::text='' OR subject.entity='employee' OR (subject.entity='supplier' AND EXISTS (SELECT 1 FROM dcl_supplier_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))) OR (subject.entity='other-unit' AND EXISTS (SELECT 1 FROM dcl_other_unit_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))) OR (subject.entity='sales-partner' AND EXISTS (SELECT 1 FROM dcl_sales_partner_version_operating_entities operating WHERE operating.approval_entry_id=entry.id AND operating.operating_entity_id=sqlc.arg(operating_entity_id))))
ORDER BY subject.code LIMIT 200;
