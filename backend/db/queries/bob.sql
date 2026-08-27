-- BOB owns stable identities and typed approval payloads.  Version state is
-- exclusively stored in approval_entries; every resolver below selects the
-- latest APPROVED entry and never falls back to an open candidate.

-- name: NextObjectNumberCounter :one
INSERT INTO object_number_counters (domain, entity, last_value)
VALUES (sqlc.arg(domain), sqlc.arg(entity), 1)
ON CONFLICT (domain, entity)
DO UPDATE SET last_value = object_number_counters.last_value + 1
WHERE object_number_counters.last_value < 9999
RETURNING last_value;

-- name: FindBobSeedObjectID :one
SELECT subject_id
FROM approval_events
WHERE domain='bob' AND entity=sqlc.arg(entity)
  AND request_id='seed-bob-' || sqlc.arg(seed_code)::text || '-create'
  AND action='CREATED'
ORDER BY created_at,id
LIMIT 1;

-- name: InsertBobObject :exec
INSERT INTO bob_objects (id, entity, code, revision, created_by, updated_by)
VALUES (sqlc.arg(id), sqlc.arg(entity), sqlc.arg(code), 1, sqlc.arg(actor_id), sqlc.arg(actor_id));

-- name: GetBobObject :one
SELECT id, entity, code, revision, enabled, created_at, created_by, updated_at, updated_by
FROM bob_objects
WHERE id = sqlc.arg(object_id) AND entity = sqlc.arg(entity);

-- Warehouse declaration lifecycle belongs to DCL; BOB only exposes the
-- approved current projection and reference resolution surface.
-- name: UpsertBobWarehouseCurrent :exec
INSERT INTO bob_warehouses(object_id,source_approval_entry_id,category_id,category_approval_entry_id,name,address,contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,remark,enabled,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.narg(category_id),sqlc.narg(category_approval_entry_id),sqlc.arg(name),sqlc.narg(address),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(manager_employee_id),sqlc.narg(manager_employee_approval_entry_id),sqlc.narg(remark),sqlc.arg(enabled),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET source_approval_entry_id=excluded.source_approval_entry_id,category_id=excluded.category_id,category_approval_entry_id=excluded.category_approval_entry_id,name=excluded.name,address=excluded.address,contact_name=excluded.contact_name,contact_phone=excluded.contact_phone,manager_employee_id=excluded.manager_employee_id,manager_employee_approval_entry_id=excluded.manager_employee_approval_entry_id,remark=excluded.remark,enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;

-- name: DeleteBobWarehouseCurrent :execrows
DELETE FROM bob_warehouses WHERE object_id=sqlc.arg(object_id);

-- name: GetBobWarehouseCurrent :one
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,current.enabled,current.name,current.address,current.contact_name,current.contact_phone,current.manager_employee_id,current.manager_employee_approval_entry_id,current.remark,current.updated_at,entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at
FROM bob_objects object JOIN bob_warehouses current ON current.object_id=object.id
JOIN approval_entries entry ON entry.id=current.source_approval_entry_id AND entry.domain='dcl' AND entry.entity='warehouse' AND entry.subject_id=object.id AND entry.status='APPROVED'
WHERE object.id=sqlc.arg(object_id) AND object.entity='warehouse';

-- name: CountBobWarehouses :one
SELECT count(*) FROM bob_objects object JOIN bob_warehouses current ON current.object_id=object.id
WHERE object.entity='warehouse' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR current.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: ListBobWarehouses :many
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,current.enabled,current.updated_at,current.source_approval_entry_id AS approval_entry_id
FROM bob_objects object JOIN bob_warehouses current ON current.object_id=object.id
WHERE object.entity='warehouse' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR current.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN current.updated_at END ASC,
CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN current.updated_at END DESC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN current.name END ASC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN current.name END DESC,object.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobWarehouseCurrentReference :one
SELECT object.id AS object_id,object.entity,object.code,current.source_approval_entry_id AS approval_entry_id,current.name,current.address,current.contact_name,current.contact_phone,current.manager_employee_id,current.manager_employee_approval_entry_id,current.remark
FROM bob_objects object JOIN bob_warehouses current ON current.object_id=object.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='warehouse' AND current.enabled;

-- Operating Entity is the first DCL-owned BOB slice. bob_objects keeps only
-- its stable ID/code allocation; this table is the current approved BOB data.
-- name: UpsertBobOperatingEntityCurrent :exec
INSERT INTO bob_operating_entities(
  object_id, source_approval_entry_id, legal_name, short_name, tax_number,
  address, phone, remark, enabled, updated_by
)
VALUES(
  sqlc.arg(object_id), sqlc.arg(source_approval_entry_id), sqlc.arg(legal_name),
  sqlc.narg(short_name), sqlc.narg(tax_number), sqlc.narg(address), sqlc.narg(phone),
  sqlc.narg(remark), sqlc.arg(enabled), sqlc.arg(actor_id)
)
ON CONFLICT (object_id) DO UPDATE SET
  source_approval_entry_id=excluded.source_approval_entry_id,
  legal_name=excluded.legal_name,
  short_name=excluded.short_name,
  tax_number=excluded.tax_number,
  address=excluded.address,
  phone=excluded.phone,
  remark=excluded.remark,
  enabled=excluded.enabled,
  updated_at=now(),
  updated_by=excluded.updated_by;

-- name: DeleteBobOperatingEntityCurrent :execrows
DELETE FROM bob_operating_entities WHERE object_id=sqlc.arg(object_id);

-- name: GetBobOperatingEntityCurrent :one
SELECT object.id AS object_id, object.entity, object.code,
       object.revision AS object_revision, current.enabled,
       current.legal_name, current.short_name, current.tax_number,
       current.address, current.phone, current.remark,
       current.updated_at, entry.id AS approval_entry_id, entry.domain,
       entry.version_no, entry.status, entry.revision AS approval_revision,
       entry.created_by, entry.created_at, entry.updated_by, entry.updated_at AS approval_updated_at,
       entry.submitted_by, entry.submitted_at, entry.approved_by, entry.approved_at
FROM bob_objects object
JOIN bob_operating_entities current ON current.object_id=object.id
JOIN approval_entries entry ON entry.id=current.source_approval_entry_id
  AND entry.domain='dcl' AND entry.entity='operating-entity'
  AND entry.subject_id=object.id AND entry.status='APPROVED'
WHERE object.id=sqlc.arg(object_id) AND object.entity='operating-entity';

-- name: CountBobOperatingEntities :one
SELECT count(*)
FROM bob_objects object
JOIN bob_operating_entities current ON current.object_id=object.id
JOIN approval_entries approved ON approved.id=current.source_approval_entry_id
  AND approved.domain='dcl' AND approved.entity='operating-entity'
LEFT JOIN LATERAL (
  SELECT id,status FROM approval_entries
  WHERE domain='dcl' AND entity='operating-entity' AND subject_id=object.id
    AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) candidate ON true
WHERE object.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR current.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR approved.status=ANY(sqlc.arg(status_filter)::text[])
       OR candidate.status=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListBobOperatingEntities :many
SELECT object.id AS object_id, object.entity, object.code,
       object.revision AS object_revision, current.enabled, current.updated_at,
       approved.id AS approval_entry_id,
       COALESCE(candidate.id,'')::text AS open_approval_entry_id
FROM bob_objects object
JOIN bob_operating_entities current ON current.object_id=object.id
JOIN approval_entries approved ON approved.id=current.source_approval_entry_id
  AND approved.domain='dcl' AND approved.entity='operating-entity'
LEFT JOIN LATERAL (
  SELECT id,status,version_no FROM approval_entries
  WHERE domain='dcl' AND entity='operating-entity' AND subject_id=object.id
    AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) candidate ON true
WHERE object.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR current.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR approved.status=ANY(sqlc.arg(status_filter)::text[])
       OR candidate.status=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN current.updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN current.updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN current.legal_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN current.legal_name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
  object.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobOperatingEntityCurrentReference :one
SELECT object.id AS object_id, object.entity, object.code, current.enabled,
       current.source_approval_entry_id AS approval_entry_id,
       current.legal_name, current.short_name, current.tax_number,
       current.address, current.phone, current.remark
FROM bob_objects object
JOIN bob_operating_entities current ON current.object_id=object.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='operating-entity' AND current.enabled;

-- name: ListBobOperatingEntityReferenceCandidates :many
SELECT object.id AS object_id, current.source_approval_entry_id AS approval_entry_id,
       object.code, current.legal_name AS name
FROM bob_objects object
JOIN bob_operating_entities current ON current.object_id=object.id
WHERE object.entity='operating-entity' AND current.enabled
  AND (sqlc.arg(source_object_id)::text='' OR object.id<>sqlc.arg(source_object_id)::text)
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR current.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
ORDER BY object.code
LIMIT 200;

-- name: GetBobParty :one
SELECT * FROM bob_parties WHERE id=sqlc.arg(party_id);

-- name: ListBobCustomerAccountObjects :many
SELECT o.id,o.entity,o.code,o.revision,o.enabled,o.created_at,o.created_by,o.updated_at,o.updated_by
FROM bob_customer_accounts account
JOIN bob_objects o ON o.id=account.object_id AND o.entity='customer-account'
WHERE account.customer_relationship_id=sqlc.arg(customer_relationship_id)
ORDER BY o.code;

-- Customer management is account-centric: one stable customer-account row per
-- list item, with its open candidate and latest approved version projected
-- independently. The parent customer relationship only supplies the stable
-- operating-entity boundary.
-- name: CountBobCustomerAccounts :one
SELECT count(*)
FROM bob_customer_accounts account
JOIN bob_objects object ON object.id=account.object_id AND object.entity='customer-account'
JOIN bob_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id
LEFT JOIN LATERAL (
  SELECT entry.id,entry.status FROM approval_entries entry
  WHERE entry.domain='bob' AND entry.entity='customer-account' AND entry.subject_id=object.id AND entry.status='APPROVED'
  ORDER BY entry.version_no DESC LIMIT 1
) approved_entry ON true
LEFT JOIN LATERAL (
  SELECT entry.id,entry.status FROM approval_entries entry
  WHERE entry.domain='bob' AND entry.entity='customer-account' AND entry.subject_id=object.id AND entry.status IN ('DRAFT','PENDING')
  ORDER BY entry.version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN bob_customer_versions approved ON approved.approval_entry_id=approved_entry.id
LEFT JOIN bob_customer_versions candidate ON candidate.approval_entry_id=open_entry.id
WHERE (sqlc.arg(keyword)::text='' OR object.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR approved.name ILIKE '%' || sqlc.arg(keyword)::text || '%' OR candidate.name ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR object.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR approved_entry.status=ANY(sqlc.arg(status_filter)::text[]) OR open_entry.status=ANY(sqlc.arg(status_filter)::text[]))
  AND (sqlc.arg(customer_type)::text='' OR approved.customer_type=sqlc.arg(customer_type)::text OR candidate.customer_type=sqlc.arg(customer_type)::text)
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(sales_attribution_type)::text='' OR approved.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text OR candidate.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text)
  AND (sqlc.arg(sales_attribution_subject_id)::text='' OR approved.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text OR candidate.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text);

-- name: ListBobCustomerAccounts :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,object.enabled,object.updated_at,
       COALESCE(approved_entry.id,'')::text AS approval_entry_id,
       COALESCE(open_entry.id,'')::text AS open_approval_entry_id
FROM bob_customer_accounts account
JOIN bob_objects object ON object.id=account.object_id AND object.entity='customer-account'
JOIN bob_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id
LEFT JOIN LATERAL (
  SELECT entry.id,entry.status FROM approval_entries entry
  WHERE entry.domain='bob' AND entry.entity='customer-account' AND entry.subject_id=object.id AND entry.status='APPROVED'
  ORDER BY entry.version_no DESC LIMIT 1
) approved_entry ON true
LEFT JOIN LATERAL (
  SELECT entry.id,entry.status FROM approval_entries entry
  WHERE entry.domain='bob' AND entry.entity='customer-account' AND entry.subject_id=object.id AND entry.status IN ('DRAFT','PENDING')
  ORDER BY entry.version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN bob_customer_versions approved ON approved.approval_entry_id=approved_entry.id
LEFT JOIN bob_customer_versions candidate ON candidate.approval_entry_id=open_entry.id
WHERE (sqlc.arg(keyword)::text='' OR object.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR approved.name ILIKE '%' || sqlc.arg(keyword)::text || '%' OR candidate.name ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR object.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR approved_entry.status=ANY(sqlc.arg(status_filter)::text[]) OR open_entry.status=ANY(sqlc.arg(status_filter)::text[]))
  AND (sqlc.arg(customer_type)::text='' OR approved.customer_type=sqlc.arg(customer_type)::text OR candidate.customer_type=sqlc.arg(customer_type)::text)
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(sales_attribution_type)::text='' OR approved.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text OR candidate.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text)
  AND (sqlc.arg(sales_attribution_subject_id)::text='' OR approved.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text OR candidate.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text)
ORDER BY object.code ASC,object.id ASC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertBobEmploymentRelationship :exec
INSERT INTO bob_employment_relationships(object_id,party_id,operating_entity_id,created_by)
VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));

-- name: GetBobEmploymentRelationship :one
SELECT object_id,party_id,operating_entity_id
FROM bob_employment_relationships
WHERE object_id=sqlc.arg(object_id);

-- name: GetBobEmploymentRelationshipIdentity :one
SELECT relation.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,
       operating_payload.legal_name AS operating_entity_name
FROM bob_employment_relationships relation
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_payload ON operating_payload.object_id=operating.id
WHERE relation.object_id=sqlc.arg(object_id);

-- name: LockBobObject :one
SELECT id, entity, code, revision, enabled, created_at, created_by, updated_at, updated_by
FROM bob_objects
WHERE id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
FOR UPDATE;

-- name: SetBobObjectEnabled :execrows
UPDATE bob_objects
SET enabled = sqlc.arg(enabled), revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(object_id) AND entity = sqlc.arg(entity) AND revision = sqlc.arg(object_revision);

-- name: DeleteBobObject :execrows
DELETE FROM bob_objects
WHERE id = sqlc.arg(object_id) AND entity = sqlc.arg(entity) AND revision = sqlc.arg(object_revision);

-- name: TouchBobObject :one
UPDATE bob_objects
SET revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
RETURNING id, entity, code, revision, enabled, created_at, created_by, updated_at, updated_by;

-- name: GetBobLatestApprovedEntry :one
SELECT id, domain, entity, subject_id, version_no, status, revision, created_by, created_at, updated_by, updated_at,
       submitted_by, submitted_at, approved_by, approved_at
FROM approval_entries
WHERE domain = 'bob' AND entity = sqlc.arg(entity) AND subject_id = sqlc.arg(object_id) AND status = 'APPROVED'
ORDER BY version_no DESC
LIMIT 1;

-- name: GetBobOpenEntry :one
SELECT id, domain, entity, subject_id, version_no, status, revision, created_by, created_at, updated_by, updated_at,
       submitted_by, submitted_at, approved_by, approved_at
FROM approval_entries
WHERE domain = 'bob' AND entity = sqlc.arg(entity) AND subject_id = sqlc.arg(object_id)
  AND status IN ('DRAFT', 'PENDING')
ORDER BY version_no DESC
LIMIT 1;

-- name: GetBobLatestApprovedEntryByID :one
SELECT entry.id, entry.domain, entry.entity, entry.subject_id, entry.version_no, entry.status, entry.revision,
       entry.created_by, entry.created_at, entry.updated_by, entry.updated_at, entry.submitted_by, entry.submitted_at,
       entry.approved_by, entry.approved_at
FROM approval_entries entry
WHERE entry.id = sqlc.arg(approval_entry_id)
  AND entry.domain = 'bob'
  AND entry.status = 'APPROVED'
  AND entry.id = (
      SELECT latest.id FROM approval_entries latest
      WHERE latest.domain = entry.domain AND latest.entity = entry.entity AND latest.subject_id = entry.subject_id
        AND latest.status = 'APPROVED'
      ORDER BY latest.version_no DESC LIMIT 1
  );

-- name: CountBobApprovalEvents :one
SELECT count(*)
FROM approval_events
WHERE domain = 'bob' AND entity = sqlc.arg(entity) AND subject_id = sqlc.arg(object_id);

-- name: ListBobApprovalEvents :many
SELECT id, entry_id, domain, entity, subject_id, version_no, action, from_status, to_status,
       from_revision, to_revision, actor_id, reason, request_id, created_at
FROM approval_events
WHERE domain = 'bob' AND entity = sqlc.arg(entity) AND subject_id = sqlc.arg(object_id)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: ListBobObjects :many
SELECT o.id AS object_id, o.entity, o.code, o.revision AS object_revision, o.enabled, o.updated_at,
	   COALESCE(approved.id, '')::text AS approval_entry_id,
	   COALESCE(approved.version_no, 0)::integer AS version_no,
	   COALESCE(approved.revision, 0)::bigint AS approval_revision,
	   COALESCE(open_entry.id, '')::text AS open_approval_entry_id,
	   COALESCE(open_entry.version_no, 0)::integer AS open_version_no,
	   COALESCE(open_entry.status, '')::text AS open_status,
	   COALESCE(open_entry.revision, 0)::bigint AS open_revision
FROM bob_objects o
LEFT JOIN LATERAL (
    SELECT id, version_no, status, revision
    FROM approval_entries
    WHERE domain = CASE WHEN o.entity='product' THEN 'dcl' ELSE 'bob' END AND entity = o.entity AND subject_id = o.id AND status = 'APPROVED'
    ORDER BY version_no DESC LIMIT 1
) approved ON true
LEFT JOIN LATERAL (
    SELECT id, version_no, status, revision
    FROM approval_entries
    WHERE domain = CASE WHEN o.entity='product' THEN 'dcl' ELSE 'bob' END AND entity = o.entity AND subject_id = o.id AND status IN ('DRAFT', 'PENDING')
    ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN bob_employee_versions approved_employee ON approved_employee.approval_entry_id=approved.id
LEFT JOIN bob_employee_versions open_employee ON open_employee.approval_entry_id=open_entry.id
LEFT JOIN dcl_product_versions approved_product ON approved_product.approval_entry_id=approved.id
LEFT JOIN dcl_product_versions open_product ON open_product.approval_entry_id=open_entry.id
LEFT JOIN dcl_vehicle_versions approved_vehicle ON approved_vehicle.approval_entry_id=approved.id
LEFT JOIN dcl_vehicle_versions open_vehicle ON open_vehicle.approval_entry_id=open_entry.id
LEFT JOIN dcl_fund_account_versions approved_fund ON approved_fund.approval_entry_id=approved.id
LEFT JOIN dcl_fund_account_versions open_fund ON open_fund.approval_entry_id=open_entry.id
LEFT JOIN bob_supplier_versions approved_supplier ON approved_supplier.approval_entry_id=approved.id
LEFT JOIN bob_supplier_versions open_supplier ON open_supplier.approval_entry_id=open_entry.id
LEFT JOIN bob_sales_partner_versions approved_sales ON approved_sales.approval_entry_id=approved.id
LEFT JOIN bob_sales_partner_versions open_sales ON open_sales.approval_entry_id=open_entry.id
LEFT JOIN bob_customer_relationships customer_relation ON customer_relation.object_id=o.id AND o.entity='customer'
LEFT JOIN bob_supplier_relationships supplier_relation ON supplier_relation.object_id=o.id AND o.entity='supplier'
LEFT JOIN bob_sales_relationships sales_relation ON sales_relation.object_id=o.id AND o.entity='sales-partner'
LEFT JOIN bob_service_relationships service_relation ON service_relation.object_id=o.id AND o.entity='other-unit'
LEFT JOIN bob_parties relationship_party ON relationship_party.id=COALESCE(customer_relation.party_id,supplier_relation.party_id,sales_relation.party_id,service_relation.party_id)
WHERE o.entity = sqlc.arg(entity)
  AND (sqlc.arg(keyword)::text = ''
       OR o.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR COALESCE(approved_employee.name, open_employee.name, approved_product.name, open_product.name,
                   approved_vehicle.name, open_vehicle.name,
                   approved_fund.name, open_fund.name,
                   approved_supplier.name, open_supplier.name, relationship_party.display_name, '')
          ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR EXISTS (
           SELECT 1
           FROM bob_customer_accounts account
           JOIN bob_objects account_object ON account_object.id=account.object_id AND account_object.entity='customer-account'
           LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) account_approved_entry ON true
           LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) account_open_entry ON true
           LEFT JOIN bob_customer_versions account_approved ON account_approved.approval_entry_id=account_approved_entry.id
           LEFT JOIN bob_customer_versions account_open ON account_open.approval_entry_id=account_open_entry.id
           WHERE account.customer_relationship_id=o.id
             AND (account_object.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                  OR COALESCE(account_approved.name,account_open.name,'') ILIKE '%' || sqlc.arg(keyword)::text || '%')
       ))
  AND (sqlc.arg(enabled_filter)::integer = -1 OR o.enabled = (sqlc.arg(enabled_filter)::integer = 1))
  AND (cardinality(sqlc.arg(status_filter)::text[]) = 0
       OR approved.status = ANY(sqlc.arg(status_filter)::text[])
       OR open_entry.status = ANY(sqlc.arg(status_filter)::text[]))
  AND (sqlc.arg(category_id)::text='' OR approved_product.category_id=sqlc.arg(category_id)::text OR open_product.category_id=sqlc.arg(category_id)::text)
  AND (sqlc.arg(department_id)::text='' OR approved_employee.department_id=sqlc.arg(department_id)::text OR open_employee.department_id=sqlc.arg(department_id)::text)
  AND (sqlc.arg(position_id)::text='' OR approved_employee.position_id=sqlc.arg(position_id)::text OR open_employee.position_id=sqlc.arg(position_id)::text)
  AND (sqlc.arg(currency)::text='' OR approved_fund.currency=sqlc.arg(currency)::text OR open_fund.currency=sqlc.arg(currency)::text)
  AND (sqlc.arg(product_type_id)::text='' OR approved_product.product_type_id=sqlc.arg(product_type_id)::text OR open_product.product_type_id=sqlc.arg(product_type_id)::text)
  AND (sqlc.arg(operating_entity_id)::text='' OR customer_relation.operating_entity_id=sqlc.arg(operating_entity_id)::text OR sales_relation.operating_entity_id=sqlc.arg(operating_entity_id)::text OR service_relation.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR approved_supplier.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text OR open_supplier.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text)
  AND (sqlc.arg(capability)::text='' OR sqlc.arg(capability)::text=ANY(approved_sales.capabilities) OR sqlc.arg(capability)::text=ANY(open_sales.capabilities))
  AND ((sqlc.arg(customer_type)::text='' AND sqlc.arg(sales_attribution_type)::text='' AND sqlc.arg(sales_attribution_subject_id)::text='') OR EXISTS (
      SELECT 1
      FROM bob_customer_accounts account
      LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) account_approved_entry ON true
      LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) account_open_entry ON true
      LEFT JOIN bob_customer_versions account_approved ON account_approved.approval_entry_id=account_approved_entry.id
      LEFT JOIN bob_customer_versions account_open ON account_open.approval_entry_id=account_open_entry.id
      WHERE account.customer_relationship_id=o.id
        AND (sqlc.arg(customer_type)::text='' OR account_approved.customer_type=sqlc.arg(customer_type)::text OR account_open.customer_type=sqlc.arg(customer_type)::text)
        AND (sqlc.arg(sales_attribution_type)::text='' OR account_approved.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text OR account_open.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text)
        AND (sqlc.arg(sales_attribution_subject_id)::text='' OR account_approved.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text OR account_open.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text)
  ))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN o.updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN o.updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN o.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN o.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(open_employee.name,approved_employee.name,open_product.name,approved_product.name,open_vehicle.name,approved_vehicle.name,open_fund.name,approved_fund.name,open_supplier.name,approved_supplier.name,relationship_party.display_name,'') END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(open_employee.name,approved_employee.name,open_product.name,approved_product.name,open_vehicle.name,approved_vehicle.name,open_fund.name,approved_fund.name,open_supplier.name,approved_supplier.name,relationship_party.display_name,'') END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(open_entry.status,approved.status,'') END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(open_entry.status,approved.status,'') END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(open_entry.version_no,approved.version_no,0) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(open_entry.version_no,approved.version_no,0) END DESC,
  o.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountBobObjects :one
SELECT count(*)
FROM bob_objects o
LEFT JOIN LATERAL (
    SELECT id, status
    FROM approval_entries
    WHERE domain=CASE WHEN o.entity='product' THEN 'dcl' ELSE 'bob' END AND entity=o.entity AND subject_id=o.id AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
) approved ON true
LEFT JOIN LATERAL (
    SELECT id, status
    FROM approval_entries
    WHERE domain=CASE WHEN o.entity='product' THEN 'dcl' ELSE 'bob' END AND entity=o.entity AND subject_id=o.id AND status IN ('DRAFT','PENDING')
    ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN bob_employee_versions approved_employee ON approved_employee.approval_entry_id=approved.id
LEFT JOIN bob_employee_versions open_employee ON open_employee.approval_entry_id=open_entry.id
LEFT JOIN dcl_product_versions approved_product ON approved_product.approval_entry_id=approved.id
LEFT JOIN dcl_product_versions open_product ON open_product.approval_entry_id=open_entry.id
LEFT JOIN dcl_vehicle_versions approved_vehicle ON approved_vehicle.approval_entry_id=approved.id
LEFT JOIN dcl_vehicle_versions open_vehicle ON open_vehicle.approval_entry_id=open_entry.id
LEFT JOIN dcl_fund_account_versions approved_fund ON approved_fund.approval_entry_id=approved.id
LEFT JOIN dcl_fund_account_versions open_fund ON open_fund.approval_entry_id=open_entry.id
LEFT JOIN bob_supplier_versions approved_supplier ON approved_supplier.approval_entry_id=approved.id
LEFT JOIN bob_supplier_versions open_supplier ON open_supplier.approval_entry_id=open_entry.id
LEFT JOIN bob_sales_partner_versions approved_sales ON approved_sales.approval_entry_id=approved.id
LEFT JOIN bob_sales_partner_versions open_sales ON open_sales.approval_entry_id=open_entry.id
LEFT JOIN bob_customer_relationships customer_relation ON customer_relation.object_id=o.id AND o.entity='customer'
LEFT JOIN bob_supplier_relationships supplier_relation ON supplier_relation.object_id=o.id AND o.entity='supplier'
LEFT JOIN bob_sales_relationships sales_relation ON sales_relation.object_id=o.id AND o.entity='sales-partner'
LEFT JOIN bob_service_relationships service_relation ON service_relation.object_id=o.id AND o.entity='other-unit'
LEFT JOIN bob_parties relationship_party ON relationship_party.id=COALESCE(customer_relation.party_id,supplier_relation.party_id,sales_relation.party_id,service_relation.party_id)
WHERE o.entity = sqlc.arg(entity)
  AND (sqlc.arg(keyword)::text = ''
       OR o.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR COALESCE(approved_employee.name, open_employee.name, approved_product.name, open_product.name,
                   approved_vehicle.name, open_vehicle.name,
                   approved_fund.name, open_fund.name,
                   approved_supplier.name, open_supplier.name, relationship_party.display_name, '')
          ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR EXISTS (
           SELECT 1
           FROM bob_customer_accounts account
           JOIN bob_objects account_object ON account_object.id=account.object_id AND account_object.entity='customer-account'
           LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) account_approved_entry ON true
           LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) account_open_entry ON true
           LEFT JOIN bob_customer_versions account_approved ON account_approved.approval_entry_id=account_approved_entry.id
           LEFT JOIN bob_customer_versions account_open ON account_open.approval_entry_id=account_open_entry.id
           WHERE account.customer_relationship_id=o.id
             AND (account_object.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                  OR COALESCE(account_approved.name,account_open.name,'') ILIKE '%' || sqlc.arg(keyword)::text || '%')
       ))
  AND (sqlc.arg(enabled_filter)::integer = -1 OR o.enabled = (sqlc.arg(enabled_filter)::integer = 1))
  AND (cardinality(sqlc.arg(status_filter)::text[]) = 0
       OR approved.status = ANY(sqlc.arg(status_filter)::text[])
       OR open_entry.status = ANY(sqlc.arg(status_filter)::text[]))
  AND (sqlc.arg(category_id)::text='' OR approved_product.category_id=sqlc.arg(category_id)::text OR open_product.category_id=sqlc.arg(category_id)::text)
  AND (sqlc.arg(department_id)::text='' OR approved_employee.department_id=sqlc.arg(department_id)::text OR open_employee.department_id=sqlc.arg(department_id)::text)
  AND (sqlc.arg(position_id)::text='' OR approved_employee.position_id=sqlc.arg(position_id)::text OR open_employee.position_id=sqlc.arg(position_id)::text)
  AND (sqlc.arg(currency)::text='' OR approved_fund.currency=sqlc.arg(currency)::text OR open_fund.currency=sqlc.arg(currency)::text)
  AND (sqlc.arg(product_type_id)::text='' OR approved_product.product_type_id=sqlc.arg(product_type_id)::text OR open_product.product_type_id=sqlc.arg(product_type_id)::text)
  AND (sqlc.arg(operating_entity_id)::text='' OR customer_relation.operating_entity_id=sqlc.arg(operating_entity_id)::text OR sales_relation.operating_entity_id=sqlc.arg(operating_entity_id)::text OR service_relation.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR approved_supplier.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text OR open_supplier.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text)
  AND (sqlc.arg(capability)::text='' OR sqlc.arg(capability)::text=ANY(approved_sales.capabilities) OR sqlc.arg(capability)::text=ANY(open_sales.capabilities))
  AND ((sqlc.arg(customer_type)::text='' AND sqlc.arg(sales_attribution_type)::text='' AND sqlc.arg(sales_attribution_subject_id)::text='') OR EXISTS (
      SELECT 1
      FROM bob_customer_accounts account
      LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) account_approved_entry ON true
      LEFT JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=account.object_id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) account_open_entry ON true
      LEFT JOIN bob_customer_versions account_approved ON account_approved.approval_entry_id=account_approved_entry.id
      LEFT JOIN bob_customer_versions account_open ON account_open.approval_entry_id=account_open_entry.id
      WHERE account.customer_relationship_id=o.id
        AND (sqlc.arg(customer_type)::text='' OR account_approved.customer_type=sqlc.arg(customer_type)::text OR account_open.customer_type=sqlc.arg(customer_type)::text)
        AND (sqlc.arg(sales_attribution_type)::text='' OR account_approved.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text OR account_open.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)::text)
        AND (sqlc.arg(sales_attribution_subject_id)::text='' OR account_approved.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text OR account_open.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)::text)
  ));

-- name: ResolveBobLatestApprovedReference :one
SELECT o.id AS object_id, o.entity, o.code, o.enabled, entry.id AS approval_entry_id, entry.version_no
FROM bob_objects o
JOIN LATERAL (
    SELECT id, version_no FROM approval_entries
    WHERE domain = 'bob' AND entity = o.entity AND subject_id = o.id AND status = 'APPROVED'
    ORDER BY version_no DESC LIMIT 1
) entry ON true
WHERE o.id = sqlc.arg(object_id) AND o.entity = sqlc.arg(entity) AND o.enabled;

-- name: ValidateBobApprovedSnapshotReference :one
SELECT o.id AS object_id, o.entity, o.code, o.enabled, entry.id AS approval_entry_id, entry.version_no
FROM bob_objects o
JOIN approval_entries entry ON entry.id = sqlc.arg(approval_entry_id)
WHERE entry.domain = 'bob' AND entry.entity = o.entity AND entry.subject_id = o.id
  AND entry.status = 'APPROVED' AND o.id = sqlc.arg(object_id) AND o.entity = sqlc.arg(entity) AND o.enabled;

-- name: QueryBobReferenceCandidates :many
SELECT o.id AS object_id, latest.id AS approval_entry_id, o.code,
       COALESCE(customer.name, supplier.name, employee.name, product.name,
                other_party.display_name, sales_party.display_name, '')::text AS name,
       COALESCE(product.behavior_profile, '')::text AS behavior_profile,
       COALESCE(product.default_input_unit_id, '')::text AS default_input_unit_id,
       COALESCE(product.pricing_unit_id, '')::text AS pricing_unit_id
FROM bob_objects o
JOIN LATERAL (
    SELECT id FROM approval_entries
    WHERE domain=CASE WHEN o.entity='product' THEN 'dcl' ELSE 'bob' END AND entity=o.entity AND subject_id=o.id AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
) latest ON true
LEFT JOIN bob_customer_versions customer ON customer.approval_entry_id=latest.id
LEFT JOIN bob_supplier_versions supplier ON supplier.approval_entry_id=latest.id
LEFT JOIN bob_employee_versions employee ON employee.approval_entry_id=latest.id
LEFT JOIN dcl_product_versions product ON product.approval_entry_id=latest.id
LEFT JOIN bob_service_relationships other_relation ON other_relation.object_id=o.id AND o.entity='other-unit'
LEFT JOIN bob_parties other_party ON other_party.id=other_relation.party_id
LEFT JOIN bob_sales_relationships sales_relation ON sales_relation.object_id=o.id AND o.entity='sales-partner'
LEFT JOIN bob_parties sales_party ON sales_party.id=sales_relation.party_id
WHERE o.entity=sqlc.arg(entity) AND o.enabled
  AND (sqlc.arg(source_object_id)::text='' OR o.id<>sqlc.arg(source_object_id)::text)
  AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR COALESCE(customer.name,supplier.name,employee.name,product.name,
                   other_party.display_name,sales_party.display_name,'') ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(behavior_profile)::text='' OR product.behavior_profile=sqlc.arg(behavior_profile)::text)
ORDER BY o.code
LIMIT 200;

-- Typed blocker projections always join the latest APPROVED Approval entry.
-- Open drafts and historical payloads never block an unrelated lifecycle
-- action, while a newly approved payload becomes visible atomically.
-- name: ListCustomerSalesReferencesForEmployee :many
SELECT o.id AS object_id, o.entity, 'customer-sales'::text AS role
FROM bob_objects o
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=o.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN bob_customer_versions p ON p.approval_entry_id=e.id
WHERE p.primary_sales_subject_id=sqlc.narg(source_object_id) AND p.primary_sales_attribution_type='INTERNAL_EMPLOYEE';
-- name: ListSupplierPurchaserReferencesForEmployee :many
SELECT o.id AS object_id, o.entity, 'supplier-purchaser'::text AS role FROM bob_objects o
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='supplier' AND subject_id=o.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN bob_supplier_versions p ON p.approval_entry_id=e.id WHERE p.default_purchaser_employee_id=sqlc.narg(source_object_id);
-- name: ListWarehouseManagerReferencesForEmployee :many
SELECT o.id AS object_id,o.entity,'warehouse-manager'::text AS role FROM bob_objects o
JOIN bob_warehouses current ON current.object_id=o.id
WHERE o.entity='warehouse' AND current.manager_employee_id=sqlc.narg(source_object_id);
-- name: ListCustomerSalesReferencesForSalesPartner :many
SELECT o.id AS object_id,o.entity,CASE p.primary_sales_attribution_type WHEN 'EXTERNAL_PART_TIME' THEN 'customer-external-sales' ELSE 'customer-channel-sales' END::text AS role FROM bob_objects o
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=o.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN bob_customer_versions p ON p.approval_entry_id=e.id WHERE p.primary_sales_subject_id=sqlc.narg(source_object_id) AND p.primary_sales_attribution_type IN ('EXTERNAL_PART_TIME','CHANNEL_PARTNER');
-- name: ListCustomerOperatingReferences :many
SELECT o.id AS object_id,o.entity,'customer-operating'::text AS role FROM bob_objects o
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='customer-account' AND subject_id=o.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN bob_customer_versions p ON p.approval_entry_id=e.id WHERE p.operating_entity_id=sqlc.narg(source_object_id);
-- name: ListFundOperatingReferences :many
SELECT o.id AS object_id,o.entity,'fund-operating'::text AS role FROM bob_objects o
JOIN bob_fund_accounts p ON p.object_id=o.id WHERE p.operating_entity_id=sqlc.narg(source_object_id);
-- name: ListVehicleCarrierOperatingReferences :many
SELECT o.id AS object_id,o.entity,'vehicle-carrier-operating'::text AS role FROM bob_objects o
JOIN bob_vehicles current ON current.object_id=o.id WHERE current.carrier_operating_entity_id=sqlc.narg(source_object_id);
-- name: ListVehicleCarrierServiceReferences :many
SELECT o.id AS object_id,o.entity,'vehicle-carrier-service'::text AS role FROM bob_objects o
JOIN bob_vehicles current ON current.object_id=o.id WHERE current.carrier_service_relationship_object_id=sqlc.narg(source_object_id);

-- name: UpsertBobVehicleCurrent :exec
INSERT INTO bob_vehicles(object_id,source_approval_entry_id,name,plate_number,vehicle_type,vehicle_type_object_id,vehicle_type_approval_entry_id,vehicle_type_name,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,bulk_liquid_capable,enabled,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(name),sqlc.arg(plate_number),sqlc.arg(vehicle_type),sqlc.arg(vehicle_type_object_id),sqlc.arg(vehicle_type_approval_entry_id),sqlc.arg(vehicle_type_name),sqlc.narg(vin),sqlc.narg(engine_number),sqlc.narg(load_capacity_kg),sqlc.narg(remark),sqlc.arg(carrier_affiliation_type),sqlc.narg(carrier_operating_entity_id),sqlc.narg(carrier_operating_entity_approval_entry_id),sqlc.narg(carrier_service_relationship_object_id),sqlc.narg(carrier_service_relationship_approval_entry_id),sqlc.arg(bulk_liquid_capable),sqlc.arg(enabled),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET source_approval_entry_id=excluded.source_approval_entry_id,name=excluded.name,plate_number=excluded.plate_number,vehicle_type=excluded.vehicle_type,vehicle_type_object_id=excluded.vehicle_type_object_id,vehicle_type_approval_entry_id=excluded.vehicle_type_approval_entry_id,vehicle_type_name=excluded.vehicle_type_name,vin=excluded.vin,engine_number=excluded.engine_number,load_capacity_kg=excluded.load_capacity_kg,remark=excluded.remark,carrier_affiliation_type=excluded.carrier_affiliation_type,carrier_operating_entity_id=excluded.carrier_operating_entity_id,carrier_operating_entity_approval_entry_id=excluded.carrier_operating_entity_approval_entry_id,carrier_service_relationship_object_id=excluded.carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id=excluded.carrier_service_relationship_approval_entry_id,bulk_liquid_capable=excluded.bulk_liquid_capable,enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;
-- name: DeleteBobVehicleCurrent :execrows
DELETE FROM bob_vehicles WHERE object_id=sqlc.arg(object_id);
-- name: GetBobVehicleCurrent :one
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,current.*,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by AS approval_updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at FROM bob_vehicles current JOIN bob_objects object ON object.id=current.object_id JOIN approval_entries entry ON entry.id=current.source_approval_entry_id WHERE current.object_id=sqlc.arg(object_id);
-- name: ListBobVehicles :many
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,current.enabled AS current_enabled,current.updated_at FROM bob_vehicles current JOIN bob_objects object ON object.id=current.object_id WHERE (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR current.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR current.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN current.updated_at END ASC,
CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN current.updated_at END DESC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN current.name END ASC,
CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN current.name END DESC,object.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobVehicles :one
SELECT count(*) FROM bob_vehicles current JOIN bob_objects object ON object.id=current.object_id WHERE (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR current.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR current.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: UpsertBobFundAccountCurrent :exec
INSERT INTO bob_fund_accounts(object_id,source_approval_entry_id,name,currency,account_name,bank_name,bank_branch,account_number,remark,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(name),sqlc.arg(currency),sqlc.narg(account_name),sqlc.narg(bank_name),sqlc.narg(bank_branch),sqlc.narg(account_number),sqlc.narg(remark),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),sqlc.arg(enabled),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET source_approval_entry_id=excluded.source_approval_entry_id,name=excluded.name,currency=excluded.currency,account_name=excluded.account_name,bank_name=excluded.bank_name,bank_branch=excluded.bank_branch,account_number=excluded.account_number,remark=excluded.remark,operating_entity_id=excluded.operating_entity_id,operating_entity_approval_entry_id=excluded.operating_entity_approval_entry_id,operating_entity_code=excluded.operating_entity_code,operating_entity_name=excluded.operating_entity_name,enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;
-- name: DeleteBobFundAccountCurrent :execrows
DELETE FROM bob_fund_accounts WHERE object_id=sqlc.arg(object_id);
-- name: GetBobFundAccountCurrent :one
SELECT o.id object_id,o.entity,o.code,o.revision object_revision,c.*,e.domain,e.version_no,e.status,e.revision approval_revision,e.created_by,e.created_at,e.updated_by approval_updated_by,e.updated_at approval_updated_at,e.submitted_by,e.submitted_at,e.approved_by,e.approved_at FROM bob_fund_accounts c JOIN bob_objects o ON o.id=c.object_id JOIN approval_entries e ON e.id=c.source_approval_entry_id WHERE c.object_id=sqlc.arg(object_id);
-- name: ListBobFundAccounts :many
SELECT o.id object_id,o.entity,o.code,o.revision object_revision,c.enabled current_enabled,c.updated_at FROM bob_fund_accounts c JOIN bob_objects o ON o.id=c.object_id WHERE (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR c.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR c.enabled=(sqlc.arg(enabled_filter)::integer=1)) ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN c.updated_at END ASC, CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN c.updated_at END DESC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN o.code END ASC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN o.code END DESC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN c.name END ASC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN c.name END DESC,o.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobFundAccounts :one
SELECT count(*) FROM bob_fund_accounts c JOIN bob_objects o ON o.id=c.object_id WHERE (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR c.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR c.enabled=(sqlc.arg(enabled_filter)::integer=1));
-- name: GetBobFundAccountCurrentReference :one
SELECT o.id object_id,o.entity,o.code,c.source_approval_entry_id approval_entry_id,c.name,c.currency,c.account_name,c.bank_name,c.bank_branch,c.account_number,c.remark,c.operating_entity_id,c.operating_entity_approval_entry_id,c.operating_entity_code,c.operating_entity_name FROM bob_fund_accounts c JOIN bob_objects o ON o.id=c.object_id WHERE c.object_id=sqlc.arg(object_id) AND c.enabled;
-- name: GetBobVehicleCurrentReference :one
SELECT object.id AS object_id,object.entity,object.code,current.source_approval_entry_id AS approval_entry_id,current.name,current.plate_number,current.vehicle_type,current.vehicle_type_object_id,current.vehicle_type_approval_entry_id,current.vehicle_type_name,current.vin,current.engine_number,current.load_capacity_kg,current.remark,current.carrier_affiliation_type,current.carrier_operating_entity_id,current.carrier_operating_entity_approval_entry_id,current.carrier_service_relationship_object_id,current.carrier_service_relationship_approval_entry_id,current.bulk_liquid_capable FROM bob_vehicles current JOIN bob_objects object ON object.id=current.object_id WHERE current.object_id=sqlc.arg(object_id) AND current.enabled;
-- name: ListFormulaMaterialReferences :many
SELECT o.id AS object_id,o.entity,'formula-material'::text AS role FROM bob_objects o
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=o.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN dcl_product_formula_lines p ON p.product_approval_entry_id=e.id WHERE p.material_object_id=sqlc.arg(source_object_id);

-- name: InsertBobCustomerRelationshipPayload :exec
INSERT INTO bob_customer_relationship_versions (approval_entry_id) VALUES (sqlc.arg(approval_entry_id));
-- name: DeleteBobCustomerRelationshipPayload :execrows
DELETE FROM bob_customer_relationship_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- name: InsertBobCustomerPayload :exec
INSERT INTO bob_customer_versions (approval_entry_id, name) VALUES (sqlc.arg(approval_entry_id), sqlc.arg(name));
-- name: DeleteBobCustomerPayload :execrows
DELETE FROM bob_customer_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- name: InsertBobSupplierPayload :exec
INSERT INTO bob_supplier_versions (approval_entry_id, name) VALUES (sqlc.arg(approval_entry_id), sqlc.arg(name));
-- name: DeleteBobSupplierPayload :execrows
DELETE FROM bob_supplier_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- name: InsertBobOtherUnitPayload :exec
INSERT INTO bob_service_relationship_versions (approval_entry_id) VALUES (sqlc.arg(approval_entry_id));
-- name: DeleteBobOtherUnitPayload :execrows
DELETE FROM bob_service_relationship_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- name: InsertBobEmployeePayload :exec
INSERT INTO bob_employee_versions (approval_entry_id, name) VALUES (sqlc.arg(approval_entry_id), sqlc.arg(name));
-- name: DeleteBobEmployeePayload :execrows
DELETE FROM bob_employee_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- name: InsertBobSalesPartnerPayload :exec
INSERT INTO bob_sales_partner_versions (approval_entry_id) VALUES (sqlc.arg(approval_entry_id));
-- name: DeleteBobSalesPartnerPayload :execrows
DELETE FROM bob_sales_partner_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- name: InsertBobProductPayload :exec
INSERT INTO dcl_product_versions (approval_entry_id, name) VALUES (sqlc.arg(approval_entry_id), sqlc.arg(name));
-- name: DeleteBobProductPayload :execrows
DELETE FROM dcl_product_versions WHERE approval_entry_id = sqlc.arg(approval_entry_id);

-- Typed payload reads deliberately require the supplied entry to remain the
-- latest approved version of its Approval subject. Candidate editing is
-- mediated by the coordinator and uses the write queries below.
-- name: GetBobCustomerRelationshipPayload :one
SELECT payload.* FROM bob_customer_relationship_versions payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id
WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id) AND entry.domain='bob' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);
-- name: GetBobCustomerPayload :one
SELECT payload.* FROM bob_customer_versions payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id
WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id) AND entry.domain='bob' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);
-- name: GetBobSupplierPayload :one
SELECT payload.* FROM bob_supplier_versions payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id
WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id) AND entry.domain='bob' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);
-- name: GetBobOtherUnitPayload :one
SELECT payload.* FROM bob_service_relationship_versions payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id
WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id) AND entry.domain='bob' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);
-- name: GetBobEmployeePayload :one
SELECT payload.* FROM bob_employee_versions payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id
WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id) AND entry.domain='bob' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);
-- name: GetBobSalesPartnerPayload :one
SELECT payload.* FROM bob_sales_partner_versions payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id
WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id) AND entry.domain='bob' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);
-- name: GetBobProductPayload :one
SELECT payload.* FROM dcl_product_versions payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id
WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id) AND entry.domain='bob' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);
-- Payload readers receive an exact Approval entry selected by the service.
-- Reference resolution separately proves latest-APPROVED before loading it.
-- name: GetBobOpenCustomerRelationshipPayload :one
SELECT payload.* FROM bob_customer_relationship_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetBobOpenCustomerPayload :one
SELECT payload.* FROM bob_customer_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetBobOpenSupplierPayload :one
SELECT payload.* FROM bob_supplier_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetBobOpenOtherUnitPayload :one
SELECT payload.* FROM bob_service_relationship_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetBobOpenEmployeePayload :one
SELECT payload.* FROM bob_employee_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetBobOpenSalesPartnerPayload :one
SELECT payload.* FROM bob_sales_partner_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetBobOpenProductPayload :one
SELECT payload.* FROM dcl_product_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: ListBobProductPayloadsForVersions :many
SELECT payload.* FROM dcl_product_versions payload
WHERE payload.approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY payload.approval_entry_id;
-- name: ListBobProductApprovalEntriesForVersions :many
SELECT entry.* FROM approval_entries entry
WHERE entry.domain='dcl' AND entry.entity='product'
  AND entry.id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY entry.id;
-- name: GetBobOpenVehiclePayload :one
SELECT payload.* FROM dcl_vehicle_versions payload WHERE payload.approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyBobCustomerRelationshipPayload :exec
INSERT INTO bob_customer_relationship_versions(approval_entry_id) SELECT sqlc.arg(new_approval_entry_id) FROM bob_customer_relationship_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: CopyBobCustomerPayload :exec
INSERT INTO bob_customer_versions(approval_entry_id,entity,name,customer_type,short_name,category_id,category_approval_entry_id,category_entity,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_approval_entry_id,settlement_method_entity,salesperson_employee_id,salesperson_employee_approval_entry_id,salesperson_employee_entity,monthly_closing_day,rebate_unit_price_cents,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,operating_entity_tax_number,operating_entity_address,operating_entity_phone,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_due_days,settlement_month_offset,settlement_cutoff_day,settlement_sales_surcharge_cents,payment_method_id,payment_method_approval_entry_id,payment_method_code,payment_method_name,payment_sales_surcharge_cents,default_transport_method_code,default_transport_method_name,transport_surcharge_cents,pricing_policy,primary_sales_attribution_type,primary_sales_subject_id,primary_sales_subject_approval_entry_id,primary_sales_subject_code,primary_sales_subject_name,internal_reminder,default_sales_order_remark)
SELECT sqlc.arg(new_approval_entry_id),entity,name,customer_type,short_name,category_id,category_approval_entry_id,category_entity,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_approval_entry_id,settlement_method_entity,salesperson_employee_id,salesperson_employee_approval_entry_id,salesperson_employee_entity,monthly_closing_day,rebate_unit_price_cents,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,operating_entity_tax_number,operating_entity_address,operating_entity_phone,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_due_days,settlement_month_offset,settlement_cutoff_day,settlement_sales_surcharge_cents,payment_method_id,payment_method_approval_entry_id,payment_method_code,payment_method_name,payment_sales_surcharge_cents,default_transport_method_code,default_transport_method_name,transport_surcharge_cents,pricing_policy,primary_sales_attribution_type,primary_sales_subject_id,primary_sales_subject_approval_entry_id,primary_sales_subject_code,primary_sales_subject_name,internal_reminder,default_sales_order_remark FROM bob_customer_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: CopyBobSupplierPayload :exec
INSERT INTO bob_supplier_versions(approval_entry_id,entity,name,short_name,category_id,category_approval_entry_id,category_entity,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_approval_entry_id,settlement_method_entity,default_purchaser_employee_id,default_purchaser_employee_approval_entry_id,default_purchaser_employee_entity,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset)
SELECT sqlc.arg(new_approval_entry_id),entity,name,short_name,category_id,category_approval_entry_id,category_entity,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_approval_entry_id,settlement_method_entity,default_purchaser_employee_id,default_purchaser_employee_approval_entry_id,default_purchaser_employee_entity,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset FROM bob_supplier_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: CopyBobOtherUnitPayload :exec
INSERT INTO bob_service_relationship_versions(approval_entry_id,entity,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,remark)
SELECT sqlc.arg(new_approval_entry_id),entity,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,remark FROM bob_service_relationship_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: CopyBobEmployeePayload :exec
INSERT INTO bob_employee_versions(approval_entry_id,entity,name,category_id,category_approval_entry_id,category_entity,department_id,department_approval_entry_id,department_entity,position_id,position_approval_entry_id,position_entity,phone,email,hire_date,remark)
SELECT sqlc.arg(new_approval_entry_id),entity,name,category_id,category_approval_entry_id,category_entity,department_id,department_approval_entry_id,department_entity,position_id,position_approval_entry_id,position_entity,phone,email,hire_date,remark FROM bob_employee_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: CopyBobSalesPartnerPayload :exec
INSERT INTO bob_sales_partner_versions(approval_entry_id,entity,capabilities,contact_name,contact_phone,email,address,remark)
SELECT sqlc.arg(new_approval_entry_id),entity,capabilities,contact_name,contact_phone,email,address,remark FROM bob_sales_partner_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: CopyBobProductPayload :exec
INSERT INTO dcl_product_versions(approval_entry_id,entity,name,category_id,category_approval_entry_id,category_code,category_name,category_entity,specification,model,barcode,remark,pricing_unit_id,pricing_unit_approval_entry_id,returnable,default_packaging_spec_micros,product_type_id,product_type_approval_entry_id,product_type_code,product_type_name,behavior_profile,default_input_unit_id,default_input_unit_approval_entry_id,enabled)
SELECT sqlc.arg(new_approval_entry_id),entity,name,category_id,category_approval_entry_id,category_code,category_name,category_entity,specification,model,barcode,remark,pricing_unit_id,pricing_unit_approval_entry_id,returnable,default_packaging_spec_micros,product_type_id,product_type_approval_entry_id,product_type_code,product_type_name,behavior_profile,default_input_unit_id,default_input_unit_approval_entry_id,enabled FROM dcl_product_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- Direct party rows remain BOB-owned identity relationships, independent of
-- approval payload state.
-- name: GetBobCustomerRelationship :one
SELECT * FROM bob_customer_relationships WHERE object_id=sqlc.arg(object_id);
-- name: ListBobPartyIdentifiers :many
SELECT identifier_type,value FROM bob_party_identifiers WHERE party_id=sqlc.arg(party_id) ORDER BY identifier_type,value;
-- name: LockBobCustomerRelationship :one
SELECT * FROM bob_customer_relationships WHERE object_id=sqlc.arg(object_id) FOR UPDATE;
-- name: InsertBobCustomerRelationship :exec
INSERT INTO bob_customer_relationships(object_id,party_id,operating_entity_id,created_by) VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));
-- name: GetBobSupplierRelationship :one
SELECT * FROM bob_supplier_relationships WHERE object_id=sqlc.arg(object_id);
-- name: LockBobSupplierRelationship :one
SELECT * FROM bob_supplier_relationships WHERE object_id=sqlc.arg(object_id) FOR UPDATE;
-- name: InsertBobSupplierRelationship :exec
INSERT INTO bob_supplier_relationships(object_id,party_id,operating_entity_id,created_by) VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));
-- name: GetBobOtherUnitRelationship :one
SELECT * FROM bob_service_relationships WHERE object_id=sqlc.arg(object_id);
-- name: LockBobOtherUnitRelationship :one
SELECT * FROM bob_service_relationships WHERE object_id=sqlc.arg(object_id) FOR UPDATE;
-- name: InsertBobOtherUnitRelationship :exec
INSERT INTO bob_service_relationships(object_id,party_id,operating_entity_id,created_by) VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));
-- name: GetBobEmployeeRelationship :one
SELECT * FROM bob_employment_relationships WHERE object_id=sqlc.arg(object_id);
-- name: LockBobEmployeeRelationship :one
SELECT * FROM bob_employment_relationships WHERE object_id=sqlc.arg(object_id) FOR UPDATE;
-- name: InsertBobEmployeeRelationship :exec
INSERT INTO bob_employment_relationships(object_id,party_id,operating_entity_id,created_by) VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));
-- name: GetBobSalesPartnerRelationship :one
SELECT * FROM bob_sales_relationships WHERE object_id=sqlc.arg(object_id);
-- name: LockBobSalesPartnerRelationship :one
SELECT * FROM bob_sales_relationships WHERE object_id=sqlc.arg(object_id) FOR UPDATE;
-- name: InsertBobSalesPartnerRelationship :exec
INSERT INTO bob_sales_relationships(object_id,party_id,operating_entity_id,created_by) VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));
-- name: InsertBobCustomerAccountRelationship :exec
INSERT INTO bob_customer_accounts(object_id,customer_relationship_id,created_by) VALUES(sqlc.arg(object_id),sqlc.arg(customer_relationship_id),sqlc.arg(actor_id));
-- name: GetBobCustomerAccountRelationship :one
SELECT * FROM bob_customer_accounts WHERE object_id=sqlc.arg(object_id);
-- name: LockBobCustomerAccountRelationship :one
SELECT * FROM bob_customer_accounts WHERE object_id=sqlc.arg(object_id) FOR UPDATE;

-- Product sub-payloads are keyed by the product Approval entry. Copying only
-- accepts a source row the service has already resolved as latest approved.
-- name: GetBobProductFormula :one
SELECT * FROM dcl_product_formulas WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id);
-- name: DeleteBobProductFormula :exec
DELETE FROM dcl_product_formulas WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id);
-- name: InsertBobProductFormula :exec
INSERT INTO dcl_product_formulas(product_approval_entry_id,output_base_quantity_micros,output_entered_quantity_micros,output_unit_object_id,output_unit_approval_entry_id,output_unit_code,output_unit_name,output_unit_symbol)
VALUES(sqlc.arg(product_approval_entry_id),sqlc.arg(output_base_quantity_micros),sqlc.arg(output_entered_quantity_micros),sqlc.arg(output_unit_object_id),sqlc.arg(output_unit_approval_entry_id),sqlc.arg(output_unit_code),sqlc.arg(output_unit_name),sqlc.arg(output_unit_symbol));
-- name: ListBobProductFormulaLines :many
SELECT line.*,material_object.code AS material_code,material.name AS material_name,
       material.behavior_profile AS material_behavior_profile
FROM dcl_product_formula_lines line
JOIN approval_entries material_entry ON material_entry.id=line.material_approval_entry_id
  AND material_entry.domain='dcl' AND material_entry.entity='product'
  AND material_entry.subject_id=line.material_object_id
JOIN bob_objects material_object ON material_object.id=line.material_object_id
  AND material_object.entity='product'
JOIN dcl_product_versions material ON material.approval_entry_id=material_entry.id
WHERE line.product_approval_entry_id=sqlc.arg(product_approval_entry_id)
ORDER BY line.line_no;
-- name: DeleteBobProductFormulaLines :exec
DELETE FROM dcl_product_formula_lines WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id);
-- name: InsertBobProductFormulaLine :exec
INSERT INTO dcl_product_formula_lines(product_approval_entry_id,line_no,material_object_id,material_approval_entry_id,base_quantity_micros,entered_quantity_micros,entered_unit_object_id,entered_unit_approval_entry_id,entered_unit_code,entered_unit_name,entered_unit_symbol,resolution_status,requires_confirmation)
VALUES(sqlc.arg(product_approval_entry_id),sqlc.arg(line_no),sqlc.arg(material_object_id),sqlc.arg(material_approval_entry_id),sqlc.arg(base_quantity_micros),sqlc.arg(entered_quantity_micros),sqlc.arg(entered_unit_object_id),sqlc.arg(entered_unit_approval_entry_id),sqlc.arg(entered_unit_code),sqlc.arg(entered_unit_name),sqlc.arg(entered_unit_symbol),sqlc.arg(resolution_status),sqlc.arg(requires_confirmation));
-- name: ListBobProductUnitConversions :many
SELECT * FROM dcl_product_unit_conversions WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id) ORDER BY unit_object_id;
-- name: ListBobProductUnitConversionsForVersions :many
SELECT * FROM dcl_product_unit_conversions
WHERE product_approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY product_approval_entry_id,unit_object_id;
-- name: ListBobProductFormulasForVersions :many
SELECT * FROM dcl_product_formulas
WHERE product_approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY product_approval_entry_id;
-- name: ListBobProductFormulaLinesForVersions :many
SELECT line.*,material_object.code AS material_code,material.name AS material_name,
       material.behavior_profile AS material_behavior_profile
FROM dcl_product_formula_lines line
JOIN approval_entries material_entry ON material_entry.id=line.material_approval_entry_id
  AND material_entry.domain='dcl' AND material_entry.entity='product'
  AND material_entry.subject_id=line.material_object_id
JOIN bob_objects material_object ON material_object.id=line.material_object_id
  AND material_object.entity='product'
JOIN dcl_product_versions material ON material.approval_entry_id=material_entry.id
WHERE line.product_approval_entry_id=ANY(sqlc.arg(product_approval_entry_ids)::text[])
ORDER BY line.product_approval_entry_id,line.line_no;
-- name: DeleteBobProductUnitConversions :exec
DELETE FROM dcl_product_unit_conversions WHERE product_approval_entry_id=sqlc.arg(product_approval_entry_id);
-- name: InsertBobProductUnitConversion :exec
INSERT INTO dcl_product_unit_conversions(product_approval_entry_id,unit_object_id,unit_approval_entry_id,unit_code,unit_name,unit_symbol,factor_micros)
VALUES(sqlc.arg(product_approval_entry_id),sqlc.arg(unit_object_id),sqlc.arg(unit_approval_entry_id),sqlc.arg(unit_code),sqlc.arg(unit_name),sqlc.arg(unit_symbol),sqlc.arg(factor_micros));

-- name: ListWarehouseDisableInventory :many
SELECT entry.product_id, object.code AS product_code, product.name AS product_name,
       sum(entry.quantity_delta_micros)::bigint AS quantity_micros
FROM acc_inventory_entries entry
JOIN acc_books book ON book.id=entry.book_id AND book.control_book
JOIN bob_objects object ON object.id=entry.product_id AND object.entity='product'
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

-- name: ListBobCustomerCreditLimits :many
SELECT * FROM bob_customer_credit_limits WHERE approval_entry_id=sqlc.arg(approval_entry_id) ORDER BY currency;
-- name: DeleteBobCustomerCreditLimits :exec
DELETE FROM bob_customer_credit_limits WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: InsertBobCustomerCreditLimit :exec
INSERT INTO bob_customer_credit_limits(approval_entry_id,currency,amount_cents) VALUES(sqlc.arg(approval_entry_id),sqlc.arg(currency),sqlc.arg(amount_cents));
-- name: ListBobCustomerVersionAttachments :many
SELECT * FROM bob_customer_version_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id) ORDER BY created_at,file_id;
-- name: DeleteBobCustomerVersionAttachments :exec
DELETE FROM bob_customer_version_attachments WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyBobCustomerCreditLimits :exec
INSERT INTO bob_customer_credit_limits(approval_entry_id,currency,amount_cents) SELECT sqlc.arg(new_approval_entry_id),currency,amount_cents FROM bob_customer_credit_limits source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: CopyBobCustomerVersionAttachments :exec
INSERT INTO bob_customer_version_attachments(approval_entry_id,file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_at,created_by)
SELECT sqlc.arg(new_approval_entry_id),file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_at,created_by FROM bob_customer_version_attachments source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateBobCustomerPayload :execrows
UPDATE bob_customer_versions SET name=sqlc.arg(name),customer_type=sqlc.arg(customer_type),short_name=sqlc.narg(short_name),tax_number=sqlc.narg(tax_number),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),remark=sqlc.narg(remark),operating_entity_id=sqlc.narg(operating_entity_id),operating_entity_approval_entry_id=sqlc.narg(operating_entity_approval_entry_id),operating_entity_code=sqlc.narg(operating_entity_code),operating_entity_name=sqlc.narg(operating_entity_name),operating_entity_tax_number=sqlc.narg(operating_entity_tax_number),operating_entity_address=sqlc.narg(operating_entity_address),operating_entity_phone=sqlc.narg(operating_entity_phone),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_approval_entry_id=sqlc.narg(settlement_method_approval_entry_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_due_days=sqlc.arg(settlement_due_days),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_cutoff_day=sqlc.arg(settlement_cutoff_day),settlement_sales_surcharge_cents=sqlc.arg(settlement_sales_surcharge_cents),payment_method_id=sqlc.narg(payment_method_id),payment_method_approval_entry_id=sqlc.narg(payment_method_approval_entry_id),payment_method_code=sqlc.narg(payment_method_code),payment_method_name=sqlc.narg(payment_method_name),payment_sales_surcharge_cents=sqlc.arg(payment_sales_surcharge_cents),default_transport_method_code=sqlc.narg(default_transport_method_code),default_transport_method_name=sqlc.narg(default_transport_method_name),transport_surcharge_cents=sqlc.arg(transport_surcharge_cents),pricing_policy=sqlc.arg(pricing_policy),primary_sales_attribution_type=sqlc.narg(primary_sales_attribution_type),primary_sales_subject_id=sqlc.narg(primary_sales_subject_id),primary_sales_subject_approval_entry_id=sqlc.narg(primary_sales_subject_approval_entry_id),primary_sales_subject_code=sqlc.narg(primary_sales_subject_code),primary_sales_subject_name=sqlc.narg(primary_sales_subject_name),internal_reminder=sqlc.narg(internal_reminder),default_sales_order_remark=sqlc.narg(default_sales_order_remark) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: UpdateBobSupplierPayload :execrows
UPDATE bob_supplier_versions SET name=sqlc.arg(name),short_name=sqlc.narg(short_name),tax_number=sqlc.narg(tax_number),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),remark=sqlc.narg(remark),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_approval_entry_id=sqlc.narg(settlement_method_approval_entry_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_day_of_month=sqlc.arg(settlement_day_of_month),settlement_day_offset=sqlc.arg(settlement_day_offset),default_purchaser_employee_id=sqlc.narg(default_purchaser_employee_id),default_purchaser_employee_approval_entry_id=sqlc.narg(default_purchaser_employee_approval_entry_id) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: UpdateBobOtherUnitPayload :execrows
UPDATE bob_service_relationship_versions SET contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_approval_entry_id=sqlc.narg(settlement_method_approval_entry_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_day_of_month=sqlc.arg(settlement_day_of_month),settlement_day_offset=sqlc.arg(settlement_day_offset),remark=sqlc.narg(remark) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: UpdateBobEmployeePayload :execrows
UPDATE bob_employee_versions SET name=sqlc.arg(name),category_id=sqlc.narg(category_id),category_approval_entry_id=sqlc.narg(category_approval_entry_id),department_id=sqlc.narg(department_id),department_approval_entry_id=sqlc.narg(department_approval_entry_id),position_id=sqlc.narg(position_id),position_approval_entry_id=sqlc.narg(position_approval_entry_id),phone=sqlc.narg(phone),email=sqlc.narg(email),hire_date=sqlc.narg(hire_date),remark=sqlc.narg(remark) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: UpdateBobSalesPartnerPayload :execrows
UPDATE bob_sales_partner_versions SET capabilities=sqlc.arg(capabilities),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),remark=sqlc.narg(remark) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: UpdateBobProductPayload :execrows
UPDATE dcl_product_versions SET name=sqlc.arg(name),category_id=sqlc.narg(category_id),category_approval_entry_id=sqlc.narg(category_approval_entry_id),category_code=sqlc.narg(category_code),category_name=sqlc.narg(category_name),specification=sqlc.narg(specification),model=sqlc.narg(model),barcode=sqlc.narg(barcode),remark=sqlc.narg(remark),pricing_unit_id=sqlc.narg(pricing_unit_id),pricing_unit_approval_entry_id=sqlc.narg(pricing_unit_approval_entry_id),returnable=sqlc.arg(returnable),default_packaging_spec_micros=sqlc.narg(default_packaging_spec_micros),product_type_id=sqlc.narg(product_type_id),product_type_approval_entry_id=sqlc.narg(product_type_approval_entry_id),product_type_code=sqlc.narg(product_type_code),product_type_name=sqlc.narg(product_type_name),behavior_profile=sqlc.narg(behavior_profile),default_input_unit_id=sqlc.narg(default_input_unit_id),default_input_unit_approval_entry_id=sqlc.narg(default_input_unit_approval_entry_id),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: UpsertBobProductCurrent :exec
INSERT INTO bob_products(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT (object_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
-- name: DeleteBobProductCurrent :execrows
DELETE FROM bob_products WHERE object_id=sqlc.arg(object_id);
-- name: GetBobProductCurrentReference :one
SELECT o.id AS object_id,o.entity,o.code,p.source_approval_entry_id AS approval_entry_id
FROM bob_products p JOIN bob_objects o ON o.id=p.object_id AND o.entity='product'
JOIN approval_entries e ON e.id=p.source_approval_entry_id AND e.domain='dcl' AND e.entity='product' AND e.status='APPROVED'
WHERE p.object_id=sqlc.arg(object_id) AND p.enabled;
-- name: GetBobProductCurrent :one
SELECT o.id AS object_id,o.entity,o.code,p.source_approval_entry_id AS approval_entry_id
FROM bob_products p JOIN bob_objects o ON o.id=p.object_id AND o.entity='product'
JOIN approval_entries e ON e.id=p.source_approval_entry_id AND e.domain='dcl' AND e.entity='product' AND e.status='APPROVED'
WHERE p.object_id=sqlc.arg(object_id);
-- name: ListBobProductsCurrent :many
SELECT o.id AS object_id,o.entity,o.code,o.revision AS object_revision,p.enabled,p.updated_at,p.source_approval_entry_id AS approval_entry_id
FROM bob_products p JOIN bob_objects o ON o.id=p.object_id AND o.entity='product'
JOIN dcl_product_versions v ON v.approval_entry_id=p.source_approval_entry_id
WHERE (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR v.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR p.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(category_id)::text='' OR v.category_id=sqlc.arg(category_id)::text)
  AND (sqlc.arg(product_type_id)::text='' OR v.product_type_id=sqlc.arg(product_type_id)::text)
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN p.updated_at END ASC,CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN p.updated_at END DESC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN o.code END ASC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN o.code END DESC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN v.name END ASC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN v.name END DESC,o.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobProductsCurrent :one
SELECT count(*) FROM bob_products p JOIN bob_objects o ON o.id=p.object_id AND o.entity='product' JOIN dcl_product_versions v ON v.approval_entry_id=p.source_approval_entry_id
WHERE (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR v.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR p.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(category_id)::text='' OR v.category_id=sqlc.arg(category_id)::text) AND (sqlc.arg(product_type_id)::text='' OR v.product_type_id=sqlc.arg(product_type_id)::text);
-- name: QueryBobProductReferenceCandidates :many
SELECT o.id AS object_id,p.source_approval_entry_id AS approval_entry_id,o.code,v.name,COALESCE(v.behavior_profile,'')::text AS behavior_profile,COALESCE(v.default_input_unit_id,'')::text AS default_input_unit_id,COALESCE(v.pricing_unit_id,'')::text AS pricing_unit_id
FROM bob_products p JOIN bob_objects o ON o.id=p.object_id AND o.entity='product' JOIN dcl_product_versions v ON v.approval_entry_id=p.source_approval_entry_id
WHERE p.enabled AND (sqlc.arg(source_object_id)::text='' OR o.id<>sqlc.arg(source_object_id)::text) AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR v.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(behavior_profile)::text='' OR v.behavior_profile=sqlc.arg(behavior_profile)::text) ORDER BY o.code LIMIT 200;
