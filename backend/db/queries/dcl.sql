-- DCL keeps one stable subject and one typed full snapshot per central
-- Approval Version.  It deliberately stores no current/base/next pointer.

-- name: InsertDCLSubject :exec
INSERT INTO dcl_subjects(id, entity, created_by)
VALUES(sqlc.arg(id), sqlc.arg(entity), sqlc.arg(actor_id));

-- name: GetDCLSubject :one
SELECT id, entity, created_at, created_by
FROM dcl_subjects
WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);

-- name: DeleteDCLSubject :execrows
DELETE FROM dcl_subjects
WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);

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
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
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
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLOperatingEntities :many
SELECT object.id AS object_id, object.code, object.revision AS object_revision,
       display.enabled, COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
       COALESCE(approved.id,'')::text AS approved_entry_id,
       COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
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
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.legal_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.legal_name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
  object.id DESC
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

-- Warehouse is a DCL-owned declaration with a BOB current projection. Category
-- columns are retained only to preserve pre-cutover snapshots and are never
-- supplied by the Warehouse declaration API.
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
  approval_entry_id,category_id,category_approval_entry_id,category_entity,name,address,
  contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,
  manager_employee_entity,remark,enabled
)
SELECT sqlc.arg(new_approval_entry_id),category_id,category_approval_entry_id,category_entity,
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
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
 ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED'
 ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_warehouse_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='warehouse'
 AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLWarehouses :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,display.enabled,
 COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
 COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
 ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED'
 ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_warehouse_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='warehouse'
 AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.name END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.name END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
 object.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLWarehouseApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLWarehouseApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertDCLVehicleVersion :exec
INSERT INTO dcl_vehicle_versions(approval_entry_id,name,plate_number,vehicle_type,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,bulk_liquid_capable,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.arg(plate_number),sqlc.arg(vehicle_type),sqlc.narg(vin),sqlc.narg(engine_number),sqlc.narg(load_capacity_kg),sqlc.narg(remark),sqlc.arg(carrier_affiliation_type),sqlc.narg(carrier_operating_entity_id),sqlc.narg(carrier_operating_entity_approval_entry_id),sqlc.narg(carrier_service_relationship_object_id),sqlc.narg(carrier_service_relationship_approval_entry_id),sqlc.arg(bulk_liquid_capable),sqlc.arg(enabled));
-- name: CopyDCLVehicleVersion :execrows
INSERT INTO dcl_vehicle_versions(approval_entry_id,entity,name,plate_number,vehicle_type,category_id,category_approval_entry_id,category_entity,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_operating_entity,carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,carrier_service_relationship_entity,bulk_liquid_capable,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.name,source.plate_number,source.vehicle_type,source.category_id,source.category_approval_entry_id,source.category_entity,source.vin,source.engine_number,source.load_capacity_kg,source.remark,source.carrier_affiliation_type,source.carrier_operating_entity_id,source.carrier_operating_entity_approval_entry_id,source.carrier_operating_entity,source.carrier_service_relationship_object_id,source.carrier_service_relationship_approval_entry_id,source.carrier_service_relationship_entity,source.bulk_liquid_capable,source.enabled FROM dcl_vehicle_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLVehicleVersion :execrows
UPDATE dcl_vehicle_versions SET name=sqlc.arg(name),plate_number=sqlc.arg(plate_number),vehicle_type=sqlc.arg(vehicle_type),vin=sqlc.narg(vin),engine_number=sqlc.narg(engine_number),load_capacity_kg=sqlc.narg(load_capacity_kg),remark=sqlc.narg(remark),carrier_affiliation_type=sqlc.arg(carrier_affiliation_type),carrier_operating_entity_id=sqlc.narg(carrier_operating_entity_id),carrier_operating_entity_approval_entry_id=sqlc.narg(carrier_operating_entity_approval_entry_id),carrier_service_relationship_object_id=sqlc.narg(carrier_service_relationship_object_id),carrier_service_relationship_approval_entry_id=sqlc.narg(carrier_service_relationship_approval_entry_id),bulk_liquid_capable=sqlc.arg(bulk_liquid_capable),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLVehicleVersion :one
SELECT * FROM dcl_vehicle_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLVehicleVersion :execrows
DELETE FROM dcl_vehicle_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetLatestApprovedDCLVehicleVersionExcluding :one
SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' AND id<>sqlc.arg(excluded_approval_entry_id) ORDER BY version_no DESC LIMIT 1;
-- name: CountDCLVehicles :one
SELECT count(*) FROM dcl_subjects subject JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_vehicle_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='vehicle' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));
-- name: ListDCLVehicles :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id FROM dcl_subjects subject JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_vehicle_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='vehicle' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.name END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.name END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
 object.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountDCLVehicleApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLVehicleApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
