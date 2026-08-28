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
WHERE domain=CASE WHEN sqlc.arg(entity)::text IN ('operating-entity','warehouse','vehicle','fund-account','product','employee','other-unit','sales-partner') THEN 'dcl' ELSE 'bob' END
  AND entity=sqlc.arg(entity)
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
INSERT INTO bob_warehouses(object_id,source_approval_entry_id,category_id,name,address,contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,remark,enabled,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.narg(category_id),sqlc.arg(name),sqlc.narg(address),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(manager_employee_id),sqlc.narg(manager_employee_approval_entry_id),sqlc.narg(remark),sqlc.arg(enabled),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET source_approval_entry_id=excluded.source_approval_entry_id,category_id=excluded.category_id,name=excluded.name,address=excluded.address,contact_name=excluded.contact_name,contact_phone=excluded.contact_phone,manager_employee_id=excluded.manager_employee_id,manager_employee_approval_entry_id=excluded.manager_employee_approval_entry_id,remark=excluded.remark,enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;

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

-- Employee relationship identity remains in BOB; DCL approval applies this
-- minimal current projection after an employee declaration is approved.
-- name: UpsertBobEmployeeCurrent :exec
INSERT INTO bob_employees(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET
  source_approval_entry_id=EXCLUDED.source_approval_entry_id,
  enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;

-- name: DeleteBobEmployeeCurrent :execrows
DELETE FROM bob_employees WHERE object_id=sqlc.arg(object_id);

-- name: GetBobEmployeeCurrent :one
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,
       current.enabled,current.updated_at,relationship.party_id,
       party.kind AS party_kind,relationship.operating_entity_id,
       operating.code AS operating_entity_code,
       operating_current.legal_name AS operating_entity_name,party.display_name,
       snapshot.employee_category_id,snapshot.employee_category_code,snapshot.employee_category_name,snapshot.department_id,
       snapshot.department_code,snapshot.department_name,
       snapshot.position_id,snapshot.position_code,
       snapshot.position_name,snapshot.phone,snapshot.email,snapshot.hire_date,snapshot.remark,
       entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,
       entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,
       entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,
       entry.approved_by,entry.approved_at
FROM bob_objects object
JOIN bob_employees current ON current.object_id=object.id
JOIN bob_employment_relationships relationship ON relationship.object_id=object.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id
  AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
JOIN approval_entries entry ON entry.id=current.source_approval_entry_id
  AND entry.domain='dcl' AND entry.entity='employee' AND entry.subject_id=object.id
  AND entry.status='APPROVED'
JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='employee'
  AND relationship.merged_into_object_id IS NULL;

-- name: CountBobEmployees :one
SELECT count(*) FROM bob_objects object
JOIN bob_employees current ON current.object_id=object.id
JOIN bob_employment_relationships relationship ON relationship.object_id=object.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE object.entity='employee' AND relationship.merged_into_object_id IS NULL
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: ListBobEmployees :many
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,
       current.enabled,current.updated_at,current.source_approval_entry_id AS approval_entry_id,
       party.display_name
FROM bob_objects object
JOIN bob_employees current ON current.object_id=object.id
JOIN bob_employment_relationships relationship ON relationship.object_id=object.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE object.entity='employee' AND relationship.merged_into_object_id IS NULL
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR current.enabled=(sqlc.arg(enabled_filter)::integer=1))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN current.updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN current.updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN party.display_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN party.display_name END DESC,
  object.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetBobEmployeeCurrentReference :one
SELECT object.id AS object_id,object.entity,object.code,
       current.source_approval_entry_id AS approval_entry_id,party.display_name
FROM bob_objects object
JOIN bob_employees current ON current.object_id=object.id
JOIN bob_employment_relationships relationship ON relationship.object_id=object.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE object.id=sqlc.arg(object_id) AND object.entity='employee'
  AND relationship.merged_into_object_id IS NULL AND current.enabled;

-- Other Unit and Sales Partner identities stay in BOB, while DCL approval
-- selects the sole current snapshot visible to BOB readers.
-- name: UpsertBobOtherUnitCurrent :exec
INSERT INTO bob_other_units(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
-- name: DeleteBobOtherUnitCurrent :execrows
DELETE FROM bob_other_units WHERE object_id=sqlc.arg(object_id);
-- name: GetBobOtherUnitCurrent :one
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,current.enabled,current.updated_at,
       relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,
       operating.code AS operating_entity_code,operating_current.legal_name AS operating_entity_name,
       snapshot.contact_name,snapshot.contact_phone,snapshot.email,snapshot.address,snapshot.settlement_method_id,
       snapshot.settlement_method_code,snapshot.settlement_method_name,
       snapshot.settlement_term_code,snapshot.settlement_rule_type,snapshot.settlement_month_offset,snapshot.settlement_day_of_month,
       snapshot.settlement_day_offset,snapshot.remark,entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,
       entry.revision AS approval_revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,
       entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at
FROM bob_objects object JOIN bob_other_units current ON current.object_id=object.id
JOIN bob_service_relationships relationship ON relationship.object_id=object.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
JOIN approval_entries entry ON entry.id=current.source_approval_entry_id AND entry.domain='dcl' AND entry.entity='other-unit' AND entry.subject_id=object.id AND entry.status='APPROVED'
JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='other-unit';
-- name: GetBobOtherUnitCurrentReference :one
SELECT object.id AS object_id,object.entity,object.code,current.source_approval_entry_id AS approval_entry_id,party.display_name
FROM bob_objects object JOIN bob_other_units current ON current.object_id=object.id
JOIN bob_service_relationships relationship ON relationship.object_id=object.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE object.id=sqlc.arg(object_id) AND object.entity='other-unit' AND current.enabled;

-- name: UpsertBobSalesPartnerCurrent :exec
INSERT INTO bob_sales_partners(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
-- name: DeleteBobSalesPartnerCurrent :execrows
DELETE FROM bob_sales_partners WHERE object_id=sqlc.arg(object_id);
-- name: GetBobSalesPartnerCurrent :one
SELECT object.id AS object_id,object.entity,object.code,object.revision AS object_revision,current.enabled,current.updated_at,
       relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,
       operating.code AS operating_entity_code,operating_current.legal_name AS operating_entity_name,
       snapshot.capabilities,snapshot.contact_name,snapshot.contact_phone,snapshot.email,snapshot.address,snapshot.remark,
       entry.id AS approval_entry_id,entry.domain,entry.version_no,entry.status,entry.revision AS approval_revision,
       entry.created_by,entry.created_at,entry.updated_by,entry.updated_at AS approval_updated_at,entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at
FROM bob_objects object JOIN bob_sales_partners current ON current.object_id=object.id
JOIN bob_sales_relationships relationship ON relationship.object_id=object.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
JOIN approval_entries entry ON entry.id=current.source_approval_entry_id AND entry.domain='dcl' AND entry.entity='sales-partner' AND entry.subject_id=object.id AND entry.status='APPROVED'
JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='sales-partner';
-- name: GetBobSalesPartnerCurrentReference :one
SELECT object.id AS object_id,object.entity,object.code,current.source_approval_entry_id AS approval_entry_id,party.display_name
FROM bob_objects object JOIN bob_sales_partners current ON current.object_id=object.id
JOIN bob_sales_relationships relationship ON relationship.object_id=object.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE object.id=sqlc.arg(object_id) AND object.entity='sales-partner' AND current.enabled;

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
SELECT party.id,current.kind,current.legal_name,current.display_name,current.tax_number,current.phone,current.email,current.address,
       party.created_at,party.created_by,current.updated_at,current.updated_by,party.merged_into_party_id,party.merged_at
FROM bob_parties party JOIN bob_party_currents current ON current.party_id=party.id
WHERE party.id=sqlc.arg(party_id);

-- name: ListBobCustomerAccountObjects :many
SELECT o.id,o.entity,o.code,o.revision,o.enabled,o.created_at,o.created_by,o.updated_at,o.updated_by
FROM bob_customer_accounts account
JOIN bob_objects o ON o.id=account.object_id AND o.entity='customer-account'
WHERE account.customer_relationship_id=sqlc.arg(customer_relationship_id)
ORDER BY o.code;

-- name: InsertBobEmploymentRelationship :exec
INSERT INTO bob_employment_relationships(object_id,party_id,operating_entity_id,created_by)
VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));

-- name: GetBobEmploymentRelationship :one
SELECT object_id,party_id,operating_entity_id
FROM bob_employment_relationships
WHERE object_id=sqlc.arg(object_id);

-- name: GetBobEmploymentRelationshipIdentity :one
SELECT relation.party_id,current.kind AS party_kind,current.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,
       operating_payload.legal_name AS operating_entity_name
FROM bob_employment_relationships relation
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_party_currents current ON current.party_id=party.id
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

-- name: GetDCLSupplierOpenEntry :one
SELECT id, domain, entity, subject_id, version_no, status, revision, created_by, created_at, updated_by, updated_at,
       submitted_by, submitted_at, approved_by, approved_at
FROM approval_entries
WHERE domain = 'dcl' AND entity = 'supplier' AND subject_id = sqlc.arg(object_id)
  AND status IN ('DRAFT', 'PENDING')
ORDER BY version_no DESC
LIMIT 1;

-- name: QueryBobReferenceCandidates :many
SELECT o.id AS object_id, latest.id AS approval_entry_id, o.code,
       COALESCE(customer_account.name, supplier_party.display_name, product.name, employee_party.display_name,
                other_party.display_name, sales_party.display_name, '')::text AS name,
       COALESCE(product.behavior_profile, '')::text AS behavior_profile,
       COALESCE(product.default_input_unit_id, '')::text AS default_input_unit_id,
       COALESCE(product.pricing_unit_id, '')::text AS pricing_unit_id
FROM bob_objects o
JOIN LATERAL (
    SELECT id FROM approval_entries
    WHERE domain=CASE WHEN o.entity IN ('customer','customer-account','product','employee','other-unit','sales-partner','supplier') THEN 'dcl' ELSE 'bob' END AND entity=o.entity AND subject_id=o.id AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
) latest ON true
LEFT JOIN dcl_customer_account_versions customer_account ON customer_account.approval_entry_id=latest.id AND o.entity='customer-account'
LEFT JOIN bob_supplier_relationships supplier_relation ON supplier_relation.object_id=o.id AND o.entity='supplier'
LEFT JOIN bob_party_currents supplier_party ON supplier_party.party_id=supplier_relation.party_id
LEFT JOIN dcl_product_versions product ON product.approval_entry_id=latest.id
LEFT JOIN bob_employment_relationships employee_relation ON employee_relation.object_id=o.id AND o.entity='employee' AND employee_relation.merged_into_object_id IS NULL
LEFT JOIN bob_party_currents employee_party ON employee_party.party_id=employee_relation.party_id
LEFT JOIN bob_service_relationships other_relation ON other_relation.object_id=o.id AND o.entity='other-unit'
LEFT JOIN bob_party_currents other_party ON other_party.party_id=other_relation.party_id
LEFT JOIN bob_sales_relationships sales_relation ON sales_relation.object_id=o.id AND o.entity='sales-partner'
LEFT JOIN bob_party_currents sales_party ON sales_party.party_id=sales_relation.party_id
WHERE o.entity=sqlc.arg(entity) AND o.enabled
  AND (sqlc.arg(source_object_id)::text='' OR o.id<>sqlc.arg(source_object_id)::text)
  AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR COALESCE(customer_account.name,supplier_party.display_name,product.name,employee_party.display_name,
                   other_party.display_name,sales_party.display_name,'') ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(behavior_profile)::text='' OR product.behavior_profile=sqlc.arg(behavior_profile)::text)
ORDER BY o.code
LIMIT 200;

-- Typed blocker projections always join the latest APPROVED Approval entry.
-- Open drafts and historical payloads never block an unrelated lifecycle
-- action, while a newly approved payload becomes visible atomically.
-- name: ListCustomerSalesReferencesForEmployee :many
SELECT o.id AS object_id, o.entity, 'customer-sales'::text AS role
FROM bob_customer_account_currents current
JOIN bob_objects o ON o.id=current.object_id AND o.entity='customer-account'
JOIN dcl_customer_account_versions p ON p.approval_entry_id=current.source_approval_entry_id
WHERE p.primary_sales_subject_id=sqlc.narg(source_object_id) AND p.primary_sales_attribution_type='INTERNAL_EMPLOYEE';
-- name: ListSupplierPurchaserReferencesForEmployee :many
SELECT o.id AS object_id, o.entity, 'supplier-purchaser'::text AS role FROM bob_objects o
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=o.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN dcl_supplier_versions p ON p.approval_entry_id=e.id WHERE p.default_purchaser_employee_id=sqlc.narg(source_object_id);
-- name: ListWarehouseManagerReferencesForEmployee :many
SELECT o.id AS object_id,o.entity,'warehouse-manager'::text AS role FROM bob_objects o
JOIN bob_warehouses current ON current.object_id=o.id
WHERE o.entity='warehouse' AND current.manager_employee_id=sqlc.narg(source_object_id);
-- name: ListCustomerSalesReferencesForSalesPartner :many
SELECT o.id AS object_id,o.entity,CASE p.primary_sales_attribution_type WHEN 'EXTERNAL_PART_TIME' THEN 'customer-external-sales' ELSE 'customer-channel-sales' END::text AS role
FROM bob_customer_account_currents current
JOIN bob_objects o ON o.id=current.object_id AND o.entity='customer-account'
JOIN dcl_customer_account_versions p ON p.approval_entry_id=current.source_approval_entry_id
WHERE p.primary_sales_subject_id=sqlc.narg(source_object_id) AND p.primary_sales_attribution_type IN ('EXTERNAL_PART_TIME','CHANNEL_PARTNER');
-- name: ListCustomerOperatingReferences :many
SELECT o.id AS object_id,o.entity,'customer-operating'::text AS role
FROM bob_customers current
JOIN bob_objects o ON o.id=current.object_id AND o.entity='customer'
JOIN bob_customer_relationships relationship ON relationship.object_id=current.object_id
WHERE relationship.operating_entity_id=sqlc.narg(source_object_id);
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
INSERT INTO bob_vehicles(object_id,source_approval_entry_id,name,plate_number,vehicle_type,vehicle_type_object_id,vehicle_type_name,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,bulk_liquid_capable,enabled,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(name),sqlc.arg(plate_number),sqlc.arg(vehicle_type),sqlc.arg(vehicle_type_object_id),sqlc.arg(vehicle_type_name),sqlc.narg(vin),sqlc.narg(engine_number),sqlc.narg(load_capacity_kg),sqlc.narg(remark),sqlc.arg(carrier_affiliation_type),sqlc.narg(carrier_operating_entity_id),sqlc.narg(carrier_operating_entity_approval_entry_id),sqlc.narg(carrier_service_relationship_object_id),sqlc.narg(carrier_service_relationship_approval_entry_id),sqlc.arg(bulk_liquid_capable),sqlc.arg(enabled),sqlc.arg(actor_id))
ON CONFLICT(object_id) DO UPDATE SET source_approval_entry_id=excluded.source_approval_entry_id,name=excluded.name,plate_number=excluded.plate_number,vehicle_type=excluded.vehicle_type,vehicle_type_object_id=excluded.vehicle_type_object_id,vin=excluded.vin,engine_number=excluded.engine_number,load_capacity_kg=excluded.load_capacity_kg,remark=excluded.remark,carrier_affiliation_type=excluded.carrier_affiliation_type,carrier_operating_entity_id=excluded.carrier_operating_entity_id,carrier_operating_entity_approval_entry_id=excluded.carrier_operating_entity_approval_entry_id,carrier_service_relationship_object_id=excluded.carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id=excluded.carrier_service_relationship_approval_entry_id,bulk_liquid_capable=excluded.bulk_liquid_capable,enabled=excluded.enabled,updated_at=now(),updated_by=excluded.updated_by;
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
SELECT object.id AS object_id,object.entity,object.code,current.source_approval_entry_id AS approval_entry_id,current.name,current.plate_number,current.vehicle_type,current.vehicle_type_object_id,current.vehicle_type_name,current.vin,current.engine_number,current.load_capacity_kg,current.remark,current.carrier_affiliation_type,current.carrier_operating_entity_id,current.carrier_operating_entity_approval_entry_id,current.carrier_service_relationship_object_id,current.carrier_service_relationship_approval_entry_id,current.bulk_liquid_capable FROM bob_vehicles current JOIN bob_objects object ON object.id=current.object_id WHERE current.object_id=sqlc.arg(object_id) AND current.enabled;
-- name: ListFormulaMaterialReferences :many
SELECT o.id AS object_id,o.entity,'formula-material'::text AS role FROM bob_objects o
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=o.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
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

-- #287 Customer Account is a distinct DCL Approval subject. BOB owns only
-- the immutable account-to-customer binding and the approved-current row.
-- name: InsertDCLCustomerAccountVersion :exec
INSERT INTO dcl_customer_account_versions(approval_entry_id,name,customer_type,customer_type_code,customer_type_name,short_name,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_due_days,settlement_month_offset,settlement_cutoff_day,settlement_sales_surcharge_cents,payment_method_id,payment_method_code,payment_method_name,payment_sales_surcharge_cents,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,operating_entity_tax_number,operating_entity_address,operating_entity_phone,default_transport_method_code,default_transport_method_name,transport_surcharge_cents,pricing_policy,primary_sales_attribution_type,primary_sales_subject_id,primary_sales_subject_approval_entry_id,primary_sales_subject_code,primary_sales_subject_name,internal_reminder,default_sales_order_remark,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.arg(customer_type),sqlc.arg(customer_type_code),sqlc.arg(customer_type_name),sqlc.narg(short_name),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(settlement_method_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.arg(settlement_due_days),sqlc.arg(settlement_month_offset),sqlc.arg(settlement_cutoff_day),sqlc.arg(settlement_sales_surcharge_cents),sqlc.narg(payment_method_id),sqlc.narg(payment_method_code),sqlc.narg(payment_method_name),sqlc.arg(payment_sales_surcharge_cents),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),sqlc.narg(operating_entity_tax_number),sqlc.narg(operating_entity_address),sqlc.narg(operating_entity_phone),sqlc.narg(default_transport_method_code),sqlc.narg(default_transport_method_name),sqlc.arg(transport_surcharge_cents),sqlc.arg(pricing_policy),sqlc.narg(primary_sales_attribution_type),sqlc.narg(primary_sales_subject_id),sqlc.narg(primary_sales_subject_approval_entry_id),sqlc.narg(primary_sales_subject_code),sqlc.narg(primary_sales_subject_name),sqlc.narg(internal_reminder),sqlc.narg(default_sales_order_remark),sqlc.arg(enabled));

-- name: GetDCLCustomerAccountVersion :one
SELECT * FROM dcl_customer_account_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: CopyDCLCustomerAccountVersion :execrows
INSERT INTO dcl_customer_account_versions(approval_entry_id,entity,name,customer_type,customer_type_code,customer_type_name,short_name,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_due_days,settlement_month_offset,settlement_cutoff_day,settlement_sales_surcharge_cents,payment_method_id,payment_method_code,payment_method_name,payment_sales_surcharge_cents,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,operating_entity_tax_number,operating_entity_address,operating_entity_phone,default_transport_method_code,default_transport_method_name,transport_surcharge_cents,pricing_policy,primary_sales_attribution_type,primary_sales_subject_id,primary_sales_subject_approval_entry_id,primary_sales_subject_code,primary_sales_subject_name,internal_reminder,default_sales_order_remark,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.name,source.customer_type,source.customer_type_code,source.customer_type_name,source.short_name,source.tax_number,source.contact_name,source.contact_phone,source.email,source.address,source.remark,source.settlement_method_id,source.settlement_method_code,source.settlement_method_name,source.settlement_term_code,source.settlement_rule_type,source.settlement_due_days,source.settlement_month_offset,source.settlement_cutoff_day,source.settlement_sales_surcharge_cents,source.payment_method_id,source.payment_method_code,source.payment_method_name,source.payment_sales_surcharge_cents,source.operating_entity_id,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name,source.operating_entity_tax_number,source.operating_entity_address,source.operating_entity_phone,source.default_transport_method_code,source.default_transport_method_name,source.transport_surcharge_cents,source.pricing_policy,source.primary_sales_attribution_type,source.primary_sales_subject_id,source.primary_sales_subject_approval_entry_id,source.primary_sales_subject_code,source.primary_sales_subject_name,source.internal_reminder,source.default_sales_order_remark,source.enabled FROM dcl_customer_account_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLCustomerAccountVersion :execrows
UPDATE dcl_customer_account_versions SET name=sqlc.arg(name),customer_type=sqlc.arg(customer_type),customer_type_code=sqlc.arg(customer_type_code),customer_type_name=sqlc.arg(customer_type_name),short_name=sqlc.narg(short_name),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_due_days=sqlc.arg(settlement_due_days),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_cutoff_day=sqlc.arg(settlement_cutoff_day),settlement_sales_surcharge_cents=sqlc.arg(settlement_sales_surcharge_cents),payment_method_id=sqlc.narg(payment_method_id),payment_method_name=sqlc.narg(payment_method_name),payment_sales_surcharge_cents=sqlc.arg(payment_sales_surcharge_cents),operating_entity_id=sqlc.arg(operating_entity_id),operating_entity_approval_entry_id=sqlc.arg(operating_entity_approval_entry_id),operating_entity_code=sqlc.arg(operating_entity_code),operating_entity_name=sqlc.arg(operating_entity_name),operating_entity_tax_number=sqlc.narg(operating_entity_tax_number),operating_entity_address=sqlc.narg(operating_entity_address),operating_entity_phone=sqlc.narg(operating_entity_phone),default_transport_method_code=sqlc.narg(default_transport_method_code),default_transport_method_name=sqlc.narg(default_transport_method_name),transport_surcharge_cents=sqlc.arg(transport_surcharge_cents),pricing_policy=sqlc.arg(pricing_policy),primary_sales_attribution_type=sqlc.narg(primary_sales_attribution_type),primary_sales_subject_id=sqlc.narg(primary_sales_subject_id),primary_sales_subject_approval_entry_id=sqlc.narg(primary_sales_subject_approval_entry_id),primary_sales_subject_code=sqlc.narg(primary_sales_subject_code),primary_sales_subject_name=sqlc.narg(primary_sales_subject_name),internal_reminder=sqlc.narg(internal_reminder),default_sales_order_remark=sqlc.narg(default_sales_order_remark),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
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
SELECT account.customer_relationship_id FROM bob_customer_accounts account JOIN bob_objects object ON object.id=account.object_id AND object.entity='customer-account' WHERE account.object_id=sqlc.arg(object_id);
-- name: CountDCLCustomerAccounts :one
SELECT count(*) FROM dcl_subjects subject JOIN bob_customer_accounts account ON account.object_id=subject.id JOIN bob_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id LEFT JOIN LATERAL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_customer_account_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) JOIN bob_objects object ON object.id=subject.id AND object.entity='customer-account' WHERE subject.entity='customer-account' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(customer_relationship_id)::text='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id)) AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)) AND (sqlc.arg(customer_type)::text='' OR display.customer_type=sqlc.arg(customer_type)) AND (sqlc.arg(sales_attribution_type)::text='' OR display.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)) AND (sqlc.arg(sales_attribution_subject_id)::text='' OR display.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));
-- name: ListDCLCustomerAccounts :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,account.customer_relationship_id,display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,COALESCE(approved.id,'')::text AS latest_approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id FROM dcl_subjects subject JOIN bob_customer_accounts account ON account.object_id=subject.id JOIN bob_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id JOIN bob_objects object ON object.id=subject.id AND object.entity='customer-account' LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_customer_account_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='customer-account' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(customer_relationship_id)::text='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id)) AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)) AND (sqlc.arg(customer_type)::text='' OR display.customer_type=sqlc.arg(customer_type)) AND (sqlc.arg(sales_attribution_type)::text='' OR display.primary_sales_attribution_type=sqlc.arg(sales_attribution_type)) AND (sqlc.arg(sales_attribution_subject_id)::text='' OR display.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[])) ORDER BY object.code LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
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

-- DCL Product snapshots are keyed by their DCL Approval entry. BOB only reads
-- these rows through an explicit current projection; DCL owns every mutation.
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
JOIN bob_objects material_object ON material_object.id=line.material_object_id
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
JOIN bob_objects material_object ON material_object.id=line.material_object_id
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

-- name: UpdateDCLProductSnapshot :execrows
UPDATE dcl_product_versions SET name=sqlc.arg(name),category_id=sqlc.narg(category_id),category_code=sqlc.narg(category_code),category_name=sqlc.narg(category_name),specification=sqlc.narg(specification),model=sqlc.narg(model),barcode=sqlc.narg(barcode),remark=sqlc.narg(remark),pricing_unit_id=sqlc.narg(pricing_unit_id),default_packaging_spec_micros=sqlc.narg(default_packaging_spec_micros),product_type_id=sqlc.narg(product_type_id),product_type_code=sqlc.narg(product_type_code),product_type_name=sqlc.narg(product_type_name),behavior_profile=sqlc.narg(behavior_profile),default_input_unit_id=sqlc.narg(default_input_unit_id),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: UpsertBobProductCurrent :exec
INSERT INTO bob_products(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT (object_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;

-- name: UpsertBobSupplierCurrent :exec
INSERT INTO bob_suppliers(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT (object_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
-- name: DeleteBobSupplierCurrent :execrows
DELETE FROM bob_suppliers WHERE object_id=sqlc.arg(object_id);

-- #287 projections are BOB-owned read models only.  DCL Customer and
-- Customer Account versions are the sole mutable declaration payloads.
-- name: UpsertBobCustomerCurrent :exec
INSERT INTO bob_customers(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT (object_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
-- name: DeleteBobCustomerCurrent :execrows
DELETE FROM bob_customers WHERE object_id=sqlc.arg(object_id);
-- name: UpsertBobCustomerAccountCurrent :exec
INSERT INTO bob_customer_account_currents(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
VALUES(sqlc.arg(object_id),sqlc.arg(source_approval_entry_id),sqlc.arg(enabled),now(),sqlc.arg(actor_id))
ON CONFLICT (object_id) DO UPDATE SET source_approval_entry_id=EXCLUDED.source_approval_entry_id,enabled=EXCLUDED.enabled,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
-- name: DeleteBobCustomerAccountCurrent :execrows
DELETE FROM bob_customer_account_currents WHERE object_id=sqlc.arg(object_id);
-- name: GetBobCustomerCurrentReference :one
SELECT o.id AS object_id,o.entity,o.code,c.source_approval_entry_id AS approval_entry_id
FROM bob_customers c
JOIN bob_objects o ON o.id=c.object_id AND o.entity='customer'
JOIN approval_entries e ON e.id=c.source_approval_entry_id AND e.domain='dcl' AND e.entity='customer' AND e.status='APPROVED'
WHERE c.object_id=sqlc.arg(object_id) AND c.enabled;
-- name: GetBobCustomerAccountCurrentReference :one
SELECT o.id AS object_id,o.entity,o.code,c.source_approval_entry_id AS approval_entry_id,
       payload.name,payload.settlement_method_id,payload.payment_method_id,payload.operating_entity_id,payload.operating_entity_approval_entry_id,
       payload.primary_sales_attribution_type,payload.primary_sales_subject_id,payload.primary_sales_subject_approval_entry_id
FROM bob_customer_account_currents c
JOIN bob_objects o ON o.id=c.object_id AND o.entity='customer-account'
JOIN approval_entries e ON e.id=c.source_approval_entry_id AND e.domain='dcl' AND e.entity='customer-account' AND e.status='APPROVED'
JOIN dcl_customer_account_versions payload ON payload.approval_entry_id=e.id
WHERE c.object_id=sqlc.arg(object_id) AND c.enabled;

-- #287 BOB Customer reads are current projections only. They intentionally do
-- not join DCL open candidates.
-- name: CountBobCustomerCurrents :one
SELECT count(*)
FROM bob_customers current
JOIN bob_objects object ON object.id=current.object_id AND object.entity='customer'
JOIN bob_customer_relationships relationship ON relationship.object_id=object.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN dcl_customer_versions payload ON payload.approval_entry_id=current.source_approval_entry_id
WHERE (sqlc.arg(keyword)='' OR object.code ILIKE '%'||sqlc.arg(keyword)||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR current.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(operating_entity_id)='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(party_id)='' OR relationship.party_id=sqlc.arg(party_id));
-- name: ListBobCustomerCurrents :many
SELECT object.id AS object_id,object.code,relationship.party_id,party.kind AS party_kind,party.display_name,
       relationship.operating_entity_id,payload.operating_entity_approval_entry_id,payload.operating_entity_code,payload.operating_entity_name,
       current.enabled,current.source_approval_entry_id,current.updated_at
FROM bob_customers current
JOIN bob_objects object ON object.id=current.object_id AND object.entity='customer'
JOIN bob_customer_relationships relationship ON relationship.object_id=object.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN dcl_customer_versions payload ON payload.approval_entry_id=current.source_approval_entry_id
WHERE (sqlc.arg(keyword)='' OR object.code ILIKE '%'||sqlc.arg(keyword)||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR current.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(operating_entity_id)='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(party_id)='' OR relationship.party_id=sqlc.arg(party_id))
ORDER BY object.code ASC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: GetBobCustomerCurrent :one
SELECT object.id AS object_id,object.code,relationship.party_id,party.kind AS party_kind,party.display_name,
       relationship.operating_entity_id,payload.operating_entity_approval_entry_id,payload.operating_entity_code,payload.operating_entity_name,
       current.enabled,current.source_approval_entry_id,current.updated_at
FROM bob_customers current
JOIN bob_objects object ON object.id=current.object_id AND object.entity='customer'
JOIN bob_customer_relationships relationship ON relationship.object_id=object.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN dcl_customer_versions payload ON payload.approval_entry_id=current.source_approval_entry_id
WHERE current.object_id=sqlc.arg(object_id);

-- name: CountBobCustomerAccountCurrents :one
SELECT count(*)
FROM bob_customer_account_currents current
JOIN bob_objects object ON object.id=current.object_id AND object.entity='customer-account'
JOIN bob_customer_accounts account ON account.object_id=object.id
JOIN bob_objects relationship_object ON relationship_object.id=account.customer_relationship_id AND relationship_object.entity='customer'
JOIN dcl_customer_account_versions payload ON payload.approval_entry_id=current.source_approval_entry_id
WHERE (sqlc.arg(keyword)='' OR object.code ILIKE '%'||sqlc.arg(keyword)||'%' OR payload.name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR current.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(customer_relationship_id)='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id))
  AND (sqlc.arg(operating_entity_id)='' OR payload.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(customer_type)='' OR payload.customer_type=sqlc.arg(customer_type))
  AND (sqlc.arg(sales_attribution_type)='' OR payload.primary_sales_attribution_type=sqlc.arg(sales_attribution_type))
  AND (sqlc.arg(sales_attribution_subject_id)='' OR payload.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id));
-- name: ListBobCustomerAccountCurrents :many
SELECT object.id AS object_id,object.code,account.customer_relationship_id,relationship_object.code AS customer_relationship_code,
       payload.name,payload.customer_type,payload.operating_entity_code,current.enabled,current.source_approval_entry_id,current.updated_at
FROM bob_customer_account_currents current
JOIN bob_objects object ON object.id=current.object_id AND object.entity='customer-account'
JOIN bob_customer_accounts account ON account.object_id=object.id
JOIN bob_objects relationship_object ON relationship_object.id=account.customer_relationship_id AND relationship_object.entity='customer'
JOIN dcl_customer_account_versions payload ON payload.approval_entry_id=current.source_approval_entry_id
WHERE (sqlc.arg(keyword)='' OR object.code ILIKE '%'||sqlc.arg(keyword)||'%' OR payload.name ILIKE '%'||sqlc.arg(keyword)||'%')
  AND (sqlc.arg(enabled_filter)::int=-1 OR current.enabled=(sqlc.arg(enabled_filter)::int=1))
  AND (sqlc.arg(customer_relationship_id)='' OR account.customer_relationship_id=sqlc.arg(customer_relationship_id))
  AND (sqlc.arg(operating_entity_id)='' OR payload.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(customer_type)='' OR payload.customer_type=sqlc.arg(customer_type))
  AND (sqlc.arg(sales_attribution_type)='' OR payload.primary_sales_attribution_type=sqlc.arg(sales_attribution_type))
  AND (sqlc.arg(sales_attribution_subject_id)='' OR payload.primary_sales_subject_id=sqlc.arg(sales_attribution_subject_id))
ORDER BY object.code ASC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: GetBobCustomerAccountCurrent :one
SELECT object.id AS object_id,object.code,account.customer_relationship_id,relationship_object.code AS customer_relationship_code,
       current.enabled,current.source_approval_entry_id,current.updated_at
FROM bob_customer_account_currents current
JOIN bob_objects object ON object.id=current.object_id AND object.entity='customer-account'
JOIN bob_customer_accounts account ON account.object_id=object.id
JOIN bob_objects relationship_object ON relationship_object.id=account.customer_relationship_id AND relationship_object.entity='customer'
WHERE current.object_id=sqlc.arg(object_id);
-- name: GetBobSupplierCurrentReference :one
SELECT o.id AS object_id,o.entity,o.code,p.source_approval_entry_id AS approval_entry_id
FROM bob_suppliers p JOIN bob_objects o ON o.id=p.object_id AND o.entity='supplier'
JOIN approval_entries e ON e.id=p.source_approval_entry_id AND e.domain='dcl' AND e.entity='supplier' AND e.status='APPROVED'
WHERE p.object_id=sqlc.arg(object_id) AND p.enabled;
-- name: GetBobSupplierCurrent :one
SELECT o.id AS object_id,o.entity,o.code,o.revision AS object_revision,p.enabled,p.updated_at,
       e.id AS approval_entry_id,e.domain,e.version_no,e.status,e.revision AS approval_revision,e.created_by,e.created_at,e.updated_by,e.updated_at AS approval_updated_at,e.submitted_by,e.submitted_at,e.approved_by,e.approved_at,
       relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,
       payload.short_name,payload.tax_number,payload.contact_name,payload.contact_phone,payload.email,payload.address,payload.remark,
       payload.settlement_method_id,payload.settlement_method_code,payload.settlement_method_name,payload.settlement_term_code,payload.settlement_rule_type,payload.settlement_month_offset,payload.settlement_day_of_month,payload.settlement_day_offset,
       payload.default_purchaser_employee_id,payload.default_purchaser_employee_approval_entry_id,payload.default_purchaser_employee_code,payload.default_purchaser_employee_name
FROM bob_suppliers p
JOIN bob_objects o ON o.id=p.object_id AND o.entity='supplier'
JOIN approval_entries e ON e.id=p.source_approval_entry_id AND e.domain='dcl' AND e.entity='supplier' AND e.subject_id=o.id AND e.status='APPROVED'
JOIN dcl_supplier_versions payload ON payload.approval_entry_id=e.id
JOIN bob_supplier_relationships relationship ON relationship.object_id=o.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE p.object_id=sqlc.arg(object_id);
-- name: ListBobSuppliersCurrent :many
SELECT o.id AS object_id,o.entity,o.code,o.revision AS object_revision,p.enabled,p.updated_at,p.source_approval_entry_id AS approval_entry_id,
       relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,
       payload.default_purchaser_employee_code,payload.default_purchaser_employee_name
FROM bob_suppliers p
JOIN bob_objects o ON o.id=p.object_id AND o.entity='supplier'
JOIN dcl_supplier_versions payload ON payload.approval_entry_id=p.source_approval_entry_id
JOIN bob_supplier_relationships relationship ON relationship.object_id=o.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR p.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR payload.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text)
ORDER BY o.code ASC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountBobSuppliersCurrent :one
SELECT count(*)
FROM bob_suppliers p
JOIN bob_objects o ON o.id=p.object_id AND o.entity='supplier'
JOIN dcl_supplier_versions payload ON payload.approval_entry_id=p.source_approval_entry_id
JOIN bob_supplier_relationships relationship ON relationship.object_id=o.id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR p.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR payload.default_purchaser_employee_id=sqlc.arg(default_purchaser_employee_id)::text);
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
