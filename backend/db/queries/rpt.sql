-- name: RptListBookReferences :many
SELECT id, code, name, count(*) OVER() AS total
FROM acc_books
WHERE (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR code ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListSubjectReferences :many
SELECT id, code, name, count(*) OVER() AS total
FROM acc_subjects
WHERE enabled AND (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR code ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, code, id OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListAssetReferences :many
SELECT id, asset_no AS code, name, count(*) OVER() AS total
FROM acc_assets
WHERE (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR asset_no ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, asset_no OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListBillReferences :many
SELECT id, bill_no AS code, bill_no AS name, count(*) OVER() AS total
FROM acc_bills
WHERE (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR bill_no ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, bill_no OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListBOBReferences :many
SELECT object_id AS id, code, name, count(*) OVER() AS total
FROM bob_version_views
WHERE entity = sqlc.arg(entity) AND version_id = effective_version_id
  AND (sqlc.arg(selected_id)::text = '' OR object_id = sqlc.arg(selected_id) OR code ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (object_id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptQueryDefinitions :many
SELECT d.id, d.code, d.name, d.description, d.enabled, d.ever_approved,
  coalesce(d.current_version_id, '') AS current_version_id, d.revision,
  coalesce(v.id, '') AS version_id, coalesce(v.version_no, 0)::integer AS version_no,
  coalesce(v.status, '') AS status, coalesce(v.validity, '') AS validity,
  coalesce(v.revision, 0)::bigint AS version_revision, coalesce(v.sql_text, '') AS sql_text,
  coalesce(v.parameters, '[]'::jsonb) AS parameters, coalesce(v.columns, '[]'::jsonb) AS columns,
  count(*) OVER() AS total
FROM rpt_definitions d
LEFT JOIN rpt_versions v ON v.id = d.current_version_id
WHERE (sqlc.arg(include_disabled)::boolean OR d.enabled)
  AND (sqlc.arg(keyword)::text = '' OR d.code ILIKE '%' || sqlc.arg(keyword) || '%' OR d.name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY d.code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptQueryDirectory :many
SELECT d.code, d.name, d.description, v.parameters, v.columns, count(*) OVER() AS total
FROM rpt_definitions d
JOIN rpt_versions v ON v.id = d.current_version_id
WHERE d.enabled AND v.validity = 'VALID' AND d.code = ANY(sqlc.arg(allowed_codes)::text[])
ORDER BY d.code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptGetDefinition :one
SELECT d.id, d.code, d.name, d.description, d.enabled, d.ever_approved,
  coalesce(d.current_version_id, '') AS current_version_id, d.revision,
  v.id AS version_id, v.version_no, v.status, v.validity, v.revision AS version_revision,
  v.sql_text, v.parameters, v.columns
FROM rpt_definitions d
JOIN rpt_versions v ON v.definition_id = d.id
WHERE d.code = sqlc.arg(code)
  AND (v.id = sqlc.arg(version_id) OR (sqlc.arg(version_id)::text = '' AND v.id = d.current_version_id));

-- name: RptGetActiveDefinition :one
SELECT d.id, d.code, d.name, d.description, d.enabled, d.ever_approved,
  d.current_version_id, d.revision, v.id AS version_id, v.version_no, v.status,
  v.validity, v.revision AS version_revision, v.sql_text, v.parameters, v.columns
FROM rpt_definitions d
JOIN rpt_versions v ON v.id = d.current_version_id
WHERE d.code = $1 AND d.enabled AND v.validity = 'VALID';

-- name: RptInsertDefinition :exec
INSERT INTO rpt_definitions(id, code, name, description, created_by, updated_by)
VALUES(sqlc.arg(id), sqlc.arg(code), sqlc.arg(name), sqlc.arg(description), sqlc.arg(actor_id), sqlc.arg(actor_id));

-- name: RptInsertVersion :exec
INSERT INTO rpt_versions(id, definition_id, version_no, status, validity, sql_text, parameters, columns, created_by, updated_by)
VALUES(sqlc.arg(id), sqlc.arg(definition_id), sqlc.arg(version_no), 'DRAFT', 'VALID', sqlc.arg(sql_text), sqlc.arg(parameters), sqlc.arg(columns), sqlc.arg(actor_id), sqlc.arg(actor_id));

-- name: RptAllocateVersionNumber :one
UPDATE rpt_definitions
SET next_version_no = next_version_no + 1, revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE code = sqlc.arg(code)
RETURNING id, next_version_no - 1 AS version_no;

-- name: RptInsertAuditEvent :exec
INSERT INTO rpt_audit_events(id, definition_id, report_code, version_id, event_type, actor_id, request_id, summary)
VALUES(sqlc.arg(id), sqlc.narg(definition_id), sqlc.arg(report_code), sqlc.narg(version_id), sqlc.arg(event_type), sqlc.arg(actor_id), sqlc.arg(request_id), sqlc.arg(summary));

-- name: RptSaveDraft :one
UPDATE rpt_versions v
SET sql_text = sqlc.arg(sql_text), parameters = sqlc.arg(parameters), columns = sqlc.arg(columns),
  revision = v.revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
FROM rpt_definitions d
WHERE v.id = sqlc.arg(version_id) AND v.definition_id = d.id AND d.code = sqlc.arg(code)
  AND v.status = 'DRAFT' AND v.revision = sqlc.arg(revision)
RETURNING d.id AS definition_id, v.revision;

-- name: RptUpdateDefinitionText :exec
UPDATE rpt_definitions
SET name = coalesce(sqlc.narg(name), name), description = coalesce(sqlc.narg(description), description),
  revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id);

-- name: RptUpsertUsePermission :exec
INSERT INTO app_permissions(id, path, domain, entity, action, description, status, created_by, updated_by)
VALUES(sqlc.arg(id), sqlc.arg(path), 'rpt', sqlc.arg(code), sqlc.arg(action), sqlc.arg(description), 'ENABLED', sqlc.arg(actor_id), sqlc.arg(actor_id))
ON CONFLICT(path) DO UPDATE SET status = 'ENABLED', description = excluded.description,
  revision = app_permissions.revision + 1, updated_at = now(), updated_by = excluded.updated_by;

-- name: RptDisableUsePermissions :exec
UPDATE app_permissions
SET status = 'DISABLED', revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE domain = 'rpt' AND entity = sqlc.arg(code) AND action IN ('query', 'export') AND status = 'ENABLED';

-- name: RptLockDraftForApproval :one
SELECT d.id, d.name, d.enabled, v.sql_text, v.parameters, v.columns
FROM rpt_definitions d
JOIN rpt_versions v ON v.definition_id = d.id
WHERE d.code = sqlc.arg(code) AND v.id = sqlc.arg(version_id) AND v.status = 'DRAFT' AND v.revision = sqlc.arg(revision)
FOR UPDATE OF d, v;

-- name: RptApproveVersion :exec
UPDATE rpt_versions
SET status = 'APPROVED', validity = 'VALID', revision = revision + 1, approved_at = now(), approved_by = sqlc.arg(actor_id), updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(version_id);

-- name: RptActivateVersion :exec
UPDATE rpt_definitions
SET current_version_id = sqlc.arg(version_id), ever_approved = true, revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id);

-- name: RptLockCurrentApprovedVersion :one
SELECT d.id
FROM rpt_definitions d
JOIN rpt_versions v ON v.definition_id = d.id
WHERE d.code = sqlc.arg(code) AND d.current_version_id = v.id AND v.id = sqlc.arg(version_id)
  AND v.status = 'APPROVED' AND v.revision = sqlc.arg(revision)
FOR UPDATE OF d, v;

-- name: RptClearCurrentVersion :exec
UPDATE rpt_definitions
SET current_version_id = NULL, revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND current_version_id = sqlc.arg(version_id);

-- name: RptSetDefinitionEnabled :one
UPDATE rpt_definitions d
SET enabled = sqlc.arg(enabled), revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE code = sqlc.arg(code) AND d.revision = sqlc.arg(revision)
RETURNING id, name,
  EXISTS(SELECT 1 FROM rpt_versions v WHERE v.id = d.current_version_id AND v.validity = 'VALID') AS current_valid,
  d.revision;

-- name: RptLockDeletableDefinition :one
SELECT id FROM rpt_definitions
WHERE code = sqlc.arg(code) AND revision = sqlc.arg(revision) AND ever_approved = false
FOR UPDATE;

-- name: RptDeleteDefinition :exec
DELETE FROM rpt_definitions WHERE id = $1;

-- name: RptLockDefinitionCurrentVersion :one
SELECT current_version_id = sqlc.arg(version_id) AS is_current
FROM rpt_definitions WHERE id = sqlc.arg(id) FOR UPDATE;

-- name: RptInvalidateVersion :exec
UPDATE rpt_versions
SET validity = 'INVALID', invalidated_at = now(), invalid_reason = 'STRUCTURE_CHANGED', revision = revision + 1
WHERE id = $1 AND validity = 'VALID';
