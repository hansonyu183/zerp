-- name: RptListBookReferences :many
SELECT id, code, name, count(*) OVER() AS total FROM acc_books
WHERE (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR code ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListSubjectReferences :many
SELECT id, code, name, count(*) OVER() AS total FROM acc_subjects
WHERE enabled AND (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR code ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, code, id OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListAssetReferences :many
SELECT id, asset_no AS code, name, count(*) OVER() AS total FROM acc_assets
WHERE (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR asset_no ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, asset_no OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListBillReferences :many
SELECT id, bill_no AS code, bill_no AS name, count(*) OVER() AS total FROM acc_bills
WHERE (sqlc.arg(selected_id)::text = '' OR id = sqlc.arg(selected_id) OR bill_no ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, bill_no OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListBOBReferences :many
WITH current_references AS (
  SELECT object.id, object.code, object.code AS name
  FROM bob_objects object
  WHERE object.entity=sqlc.arg(entity)
    AND CASE object.entity
      WHEN 'customer-account' THEN EXISTS (SELECT 1 FROM bob_customer_account_currents current WHERE current.object_id=object.id)
      WHEN 'supplier' THEN EXISTS (SELECT 1 FROM bob_suppliers current WHERE current.object_id=object.id)
      WHEN 'other-unit' THEN EXISTS (SELECT 1 FROM bob_other_units current WHERE current.object_id=object.id)
      WHEN 'employee' THEN EXISTS (SELECT 1 FROM bob_employees current WHERE current.object_id=object.id)
      WHEN 'sales-partner' THEN EXISTS (SELECT 1 FROM bob_sales_partners current WHERE current.object_id=object.id)
      WHEN 'product' THEN EXISTS (SELECT 1 FROM bob_products current WHERE current.object_id=object.id)
      WHEN 'warehouse' THEN EXISTS (SELECT 1 FROM bob_warehouses current WHERE current.object_id=object.id)
      WHEN 'fund-account' THEN EXISTS (SELECT 1 FROM bob_fund_accounts current WHERE current.object_id=object.id)
      ELSE false
    END
  UNION ALL
  SELECT object.id, object.code, object.data->>'name' AS name
  FROM aux_objects object
  WHERE sqlc.arg(entity)::text='department' AND object.entity='department'
    AND (object.enabled OR object.id=sqlc.arg(selected_id))
)
SELECT reference.id, reference.code, reference.name, count(*) OVER() AS total
FROM current_references reference
WHERE sqlc.arg(selected_id)::text='' OR reference.id=sqlc.arg(selected_id)
   OR reference.code ILIKE '%'||sqlc.arg(keyword)||'%' OR reference.name ILIKE '%'||sqlc.arg(keyword)||'%'
ORDER BY (reference.id=sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text<>'') DESC, reference.code
OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- RPT owns only stable definition identity and version payload. Approval owns lifecycle.
-- name: RptQueryDefinitions :many
SELECT d.id AS definition_id, d.code, v.name, v.description, d.enabled, d.revision AS object_revision,
 e.id AS approval_entry_id, e.version_no, e.status, e.revision AS approval_revision, e.created_by AS approval_created_by, e.created_at AS approval_created_at, e.updated_by AS approval_updated_by, e.updated_at AS approval_updated_at, e.submitted_by AS approval_submitted_by, e.submitted_at AS approval_submitted_at, e.approved_by AS approval_approved_by, e.approved_at AS approval_approved_at,
 v.validity, v.sql_text, v.parameters, v.columns, count(*) OVER() AS total
FROM rpt_definitions d
JOIN LATERAL (SELECT candidate.* FROM approval_entries candidate WHERE candidate.domain='rpt' AND candidate.entity='definition' AND candidate.subject_id=d.id AND candidate.status IN ('DRAFT','PENDING','APPROVED') ORDER BY CASE WHEN candidate.status IN ('DRAFT','PENDING') THEN 0 ELSE 1 END, candidate.version_no DESC LIMIT 1) e ON true
JOIN rpt_versions v ON v.approval_entry_id=e.id
WHERE (sqlc.arg(include_disabled)::boolean OR d.enabled) AND (sqlc.arg(keyword)::text='' OR d.code ILIKE '%' || sqlc.arg(keyword) || '%' OR v.name ILIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY d.code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptGetDefinitionByEntry :one
SELECT d.id AS definition_id, d.code, v.name, v.description, d.enabled, d.revision AS object_revision,
 e.id AS approval_entry_id, e.version_no, e.status, e.revision AS approval_revision, e.created_by AS approval_created_by, e.created_at AS approval_created_at, e.updated_by AS approval_updated_by, e.updated_at AS approval_updated_at, e.submitted_by AS approval_submitted_by, e.submitted_at AS approval_submitted_at, e.approved_by AS approval_approved_by, e.approved_at AS approval_approved_at,
 v.validity, v.sql_text, v.parameters, v.columns
FROM rpt_definitions d JOIN approval_entries e ON e.domain='rpt' AND e.entity='definition' AND e.subject_id=d.id JOIN rpt_versions v ON v.approval_entry_id=e.id AND v.definition_id=d.id
WHERE d.code=sqlc.arg(code) AND e.id=sqlc.arg(approval_entry_id);

-- name: RptGetDefinitionObject :one
SELECT id, code, enabled, revision FROM rpt_definitions WHERE code=sqlc.arg(code);
-- name: RptLockDefinitionObject :one
SELECT id, code, enabled, revision FROM rpt_definitions WHERE code=sqlc.arg(code) FOR UPDATE;
-- name: RptGetLatestApprovedPayload :one
SELECT v.approval_entry_id, v.definition_id, v.name, v.description, v.validity, v.sql_text, v.parameters, v.columns FROM approval_entries e JOIN rpt_versions v ON v.approval_entry_id=e.id
WHERE e.domain='rpt' AND e.entity='definition' AND e.subject_id=sqlc.arg(definition_id) AND e.status='APPROVED' ORDER BY e.version_no DESC LIMIT 1;
-- name: RptGetVersionPayload :one
SELECT approval_entry_id, definition_id, name, description, validity, sql_text, parameters, columns FROM rpt_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND definition_id=sqlc.arg(definition_id);

-- name: RptInsertDefinition :exec
INSERT INTO rpt_definitions(id, code, created_by, updated_by) VALUES(sqlc.arg(id), sqlc.arg(code), sqlc.arg(actor_id), sqlc.arg(actor_id));
-- name: RptInsertVersionPayload :exec
INSERT INTO rpt_versions(approval_entry_id, definition_id, name, description, validity, sql_text, parameters, columns, created_by, updated_by) VALUES(sqlc.arg(approval_entry_id), sqlc.arg(definition_id), sqlc.arg(name), sqlc.arg(description), 'VALID', sqlc.arg(sql_text), sqlc.arg(parameters), sqlc.arg(columns), sqlc.arg(actor_id), sqlc.arg(actor_id));
-- name: RptCopyVersionPayload :exec
INSERT INTO rpt_versions(approval_entry_id, definition_id, name, description, validity, sql_text, parameters, columns, created_by, updated_by)
SELECT sqlc.arg(new_approval_entry_id), source.definition_id, source.name, source.description, source.validity, source.sql_text,
       source.parameters, source.columns, sqlc.arg(actor_id), sqlc.arg(actor_id)
FROM rpt_versions source
WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id)
  AND source.definition_id=sqlc.arg(target_definition_id);
-- name: RptUpdateDraftPayload :exec
UPDATE rpt_versions SET name=coalesce(sqlc.narg(name), name), description=coalesce(sqlc.narg(description), description), sql_text=sqlc.arg(sql_text), parameters=sqlc.arg(parameters), columns=sqlc.arg(columns), validity='VALID', invalidated_at=NULL, invalid_reason=NULL, updated_at=now(), updated_by=sqlc.arg(actor_id) WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND definition_id=sqlc.arg(definition_id);
-- name: RptDeleteVersionPayload :exec
DELETE FROM rpt_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND definition_id=sqlc.arg(definition_id);
-- name: RptDeleteDefinition :execrows
DELETE FROM rpt_definitions WHERE id=sqlc.arg(definition_id) AND revision=sqlc.arg(revision);
-- name: RptSetDefinitionEnabled :one
UPDATE rpt_definitions SET enabled=sqlc.arg(enabled), revision=revision+1, updated_at=now(), updated_by=sqlc.arg(actor_id) WHERE id=sqlc.arg(definition_id) AND revision=sqlc.arg(revision) RETURNING id, code, enabled, revision;

-- The persisted query/export permissions are enabled iff the stable definition
-- is enabled and its latest APPROVED payload is VALID. They do not own Approval state.
-- name: RptLatestApprovedUseState :one
SELECT d.id AS definition_id, d.code, coalesce(v.name,'') AS name, d.enabled, coalesce(e.id,'') AS approval_entry_id, coalesce(e.status,'') AS status, v.validity
FROM rpt_definitions d LEFT JOIN LATERAL (SELECT id, status FROM approval_entries WHERE domain='rpt' AND entity='definition' AND subject_id=d.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
LEFT JOIN rpt_versions v ON v.approval_entry_id=e.id AND v.definition_id=d.id WHERE d.id=sqlc.arg(definition_id);
-- name: RptUpsertUsePermission :exec
INSERT INTO app_permissions(id, path, domain, entity, action, description, status, created_by, updated_by) VALUES(sqlc.arg(id), sqlc.arg(path), 'rpt', sqlc.arg(code), sqlc.arg(action), sqlc.arg(description), 'ENABLED', sqlc.arg(actor_id), sqlc.arg(actor_id)) ON CONFLICT(path) DO UPDATE SET status='ENABLED', description=excluded.description, revision=app_permissions.revision+1, updated_at=now(), updated_by=excluded.updated_by;
-- name: RptDisableUsePermissions :exec
UPDATE app_permissions SET status='DISABLED', revision=revision+1, updated_at=now(), updated_by=sqlc.arg(actor_id) WHERE domain='rpt' AND entity=sqlc.arg(code) AND action IN ('query','export') AND status='ENABLED';

-- name: RptGetActiveDefinition :one
SELECT d.id AS definition_id, d.code, v.name, v.description, d.enabled, e.id AS approval_entry_id, e.version_no, e.status, e.revision AS approval_revision, e.created_by AS approval_created_by, e.created_at AS approval_created_at, e.updated_by AS approval_updated_by, e.updated_at AS approval_updated_at, e.submitted_by AS approval_submitted_by, e.submitted_at AS approval_submitted_at, e.approved_by AS approval_approved_by, e.approved_at AS approval_approved_at, v.validity, v.sql_text, v.parameters, v.columns
FROM rpt_definitions d JOIN LATERAL (SELECT id, version_no, status, revision, created_by, created_at, updated_by, updated_at, submitted_by, submitted_at, approved_by, approved_at FROM approval_entries WHERE domain='rpt' AND entity='definition' AND subject_id=d.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true JOIN rpt_versions v ON v.approval_entry_id=e.id AND v.definition_id=d.id
WHERE d.code=sqlc.arg(code) AND d.enabled AND v.validity='VALID';
-- name: RptQueryDirectory :many
SELECT d.code, v.name, v.description, v.parameters, v.columns, count(*) OVER() AS total FROM rpt_definitions d JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='rpt' AND entity='definition' AND subject_id=d.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true JOIN rpt_versions v ON v.approval_entry_id=e.id AND v.definition_id=d.id
WHERE d.enabled AND v.validity='VALID' AND d.code=ANY(sqlc.arg(allowed_codes)::text[]) ORDER BY d.code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);
-- name: RptInvalidateVersion :exec
UPDATE rpt_versions SET validity='INVALID', invalidated_at=now(), invalid_reason='STRUCTURE_CHANGED', updated_at=now(), updated_by=sqlc.arg(actor_id) WHERE approval_entry_id=sqlc.arg(approval_entry_id) AND validity='VALID';
-- name: RptInsertRuntimeAuditEvent :exec
INSERT INTO rpt_runtime_audit_events(id, definition_id, report_code, approval_entry_id, event_type, actor_id, request_id, summary) VALUES(sqlc.arg(id), sqlc.narg(definition_id), sqlc.arg(report_code), sqlc.narg(approval_entry_id), sqlc.arg(event_type), sqlc.arg(actor_id), sqlc.arg(request_id), sqlc.arg(summary));
