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
