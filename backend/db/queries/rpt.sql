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

-- name: RptListBillOriginCounterpartyReferences :many
WITH counterparties AS (
  SELECT DISTINCT ON (origin_counterparty_entity, origin_counterparty_object_id, origin_counterparty_approval_entry_id)
    origin_counterparty_entity AS entity,
    origin_counterparty_object_id AS object_id,
    origin_counterparty_approval_entry_id AS approval_entry_id,
    origin_counterparty_code AS code,
    origin_counterparty_name AS name
  FROM acc_bills
  WHERE origin_counterparty_entity IS NOT NULL
    AND origin_counterparty_object_id IS NOT NULL
    AND origin_counterparty_approval_entry_id IS NOT NULL
    AND origin_counterparty_code IS NOT NULL
    AND origin_counterparty_name IS NOT NULL
  ORDER BY origin_counterparty_entity, origin_counterparty_object_id, origin_counterparty_approval_entry_id, id
)
SELECT entity, object_id, approval_entry_id, code, name, count(*) OVER() AS total
FROM counterparties
WHERE sqlc.arg(selected_id)::text = '' OR object_id = sqlc.arg(selected_id)
  OR code ILIKE '%' || sqlc.arg(keyword) || '%' OR name ILIKE '%' || sqlc.arg(keyword) || '%'
ORDER BY (object_id = sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text <> '') DESC, code, object_id, approval_entry_id
OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListCustomerSubunitReferences :many
WITH current_references AS (
  SELECT root.subunit_id AS id, line.data->>'code' AS code, line.data->>'name' AS name,
    customer_root.code AS customer_code,
    coalesce(nullif(customer.data->>'displayName',''), customer.data->>'legalName') AS customer_name
  FROM dcl_customer_subunit_roots root
  JOIN LATERAL (
    SELECT id
    FROM approval_entries
    WHERE domain='dcl' AND entity='customer' AND subject_id=root.customer_id AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
  ) entry ON true
  JOIN dcl_subjects customer_root ON customer_root.id=root.customer_id AND customer_root.entity='customer'
  JOIN dcl_customer_versions customer ON customer.approval_entry_id=entry.id AND customer.enabled
  JOIN dcl_customer_version_subunits line ON line.customer_approval_entry_id=entry.id AND line.subunit_id=root.subunit_id
  WHERE line.enabled
)
SELECT reference.id, reference.code::text AS code, reference.name::text AS name,
  reference.customer_code, reference.customer_name::text AS customer_name, count(*) OVER() AS total
FROM current_references reference
WHERE (sqlc.arg(selected_id)::text<>'' AND reference.id=sqlc.arg(selected_id))
   OR reference.code ILIKE '%'||sqlc.arg(keyword)||'%'
   OR reference.name ILIKE '%'||sqlc.arg(keyword)||'%'
   OR reference.customer_code ILIKE '%'||sqlc.arg(keyword)||'%'
   OR reference.customer_name ILIKE '%'||sqlc.arg(keyword)||'%'
ORDER BY (reference.id=sqlc.arg(selected_id) AND sqlc.arg(selected_id)::text<>'') DESC, reference.code, reference.id
OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListBOBReferences :many
WITH current_references AS (
  SELECT subject.id, subject.code AS code, subject.code AS name
  FROM dcl_subjects subject
  JOIN LATERAL (SELECT 1 FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
  WHERE subject.entity=sqlc.arg(entity) AND subject.entity IN ('operating-entity','warehouse','vehicle','fund-account','product','customer','supplier','other-unit','employee','sales-partner')
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

-- RPT owns runtime validity, permission registration, and audit only. DCL owns
-- the stable subject and approved typed payload.
-- name: RptLatestApprovedUseState :one
SELECT d.id AS definition_id, d.code, coalesce(v.name,'') AS name, coalesce(v.enabled,false) AS enabled, coalesce(e.id,'') AS approval_entry_id, coalesce(e.status,'') AS status, rv.validity
FROM dcl_subjects d
LEFT JOIN LATERAL (SELECT id, status FROM approval_entries WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
LEFT JOIN dcl_rpt_definition_versions v ON v.approval_entry_id=e.id
LEFT JOIN rpt_definition_validities rv ON rv.approval_entry_id=e.id
WHERE d.id=sqlc.arg(definition_id) AND d.entity='rpt-definition';

-- name: RptUpsertDefinitionValidity :exec
INSERT INTO rpt_definition_validities(approval_entry_id, validity, invalidated_at, invalid_reason, created_by, updated_by)
VALUES(sqlc.arg(approval_entry_id), 'VALID', NULL, NULL, sqlc.arg(actor_id), sqlc.arg(actor_id))
ON CONFLICT (approval_entry_id) DO UPDATE
SET validity='VALID', invalidated_at=NULL, invalid_reason=NULL, updated_at=now(), updated_by=excluded.updated_by;
-- name: RptUpsertUsePermission :exec
INSERT INTO app_permissions(id, path, domain, entity, action, description, status, created_by, updated_by) VALUES(sqlc.arg(id), sqlc.arg(path), 'rpt', sqlc.arg(code), sqlc.arg(action), sqlc.arg(description), 'ENABLED', sqlc.arg(actor_id), sqlc.arg(actor_id)) ON CONFLICT(path) DO UPDATE SET status='ENABLED', description=excluded.description, revision=app_permissions.revision+1, updated_at=now(), updated_by=excluded.updated_by;
-- name: RptDisableUsePermissions :exec
UPDATE app_permissions SET status='DISABLED', revision=revision+1, updated_at=now(), updated_by=sqlc.arg(actor_id) WHERE domain='rpt' AND entity=sqlc.arg(code) AND action IN ('query','export') AND status='ENABLED';

-- name: RptGetActiveDefinition :one
SELECT d.id AS definition_id, d.code, v.name, v.description, v.enabled, e.id AS approval_entry_id, e.version_no, e.status, e.revision AS approval_revision, e.created_by AS approval_created_by, e.created_at AS approval_created_at, e.updated_by AS approval_updated_by, e.updated_at AS approval_updated_at, e.submitted_by AS approval_submitted_by, e.submitted_at AS approval_submitted_at, e.approved_by AS approval_approved_by, e.approved_at AS approval_approved_at, rv.validity, v.sql_text, v.parameters, v.columns
FROM dcl_subjects d
JOIN LATERAL (SELECT id, version_no, status, revision, created_by, created_at, updated_by, updated_at, submitted_by, submitted_at, approved_by, approved_at FROM approval_entries WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN dcl_rpt_definition_versions v ON v.approval_entry_id=e.id
JOIN rpt_definition_validities rv ON rv.approval_entry_id=e.id AND rv.validity='VALID'
WHERE d.code=sqlc.arg(code)::text AND d.entity='rpt-definition' AND v.enabled;
-- name: RptQueryDirectory :many
SELECT d.code, v.name, v.description, v.parameters, v.columns, count(*) OVER() AS total
FROM dcl_subjects d
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true
JOIN dcl_rpt_definition_versions v ON v.approval_entry_id=e.id
JOIN rpt_definition_validities rv ON rv.approval_entry_id=e.id AND rv.validity='VALID'
WHERE d.entity='rpt-definition' AND v.enabled AND d.code=ANY(sqlc.arg(allowed_codes)::text[]) ORDER BY d.code OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RptListPublishedDefinitions :many
SELECT d.id AS definition_id, d.code, e.id AS approval_entry_id, v.sql_text, v.parameters, v.columns
FROM dcl_subjects d
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity='rpt-definition' AND subject_id=d.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) e ON true
JOIN dcl_rpt_definition_versions v ON v.approval_entry_id=e.id
JOIN rpt_definition_validities rv ON rv.approval_entry_id=e.id AND rv.validity='VALID'
WHERE d.entity='rpt-definition' AND v.enabled
ORDER BY d.code, d.id;
-- name: RptInvalidateVersion :exec
UPDATE rpt_definition_validities validity
SET validity='INVALID', invalidated_at=now(), invalid_reason='STRUCTURE_CHANGED', updated_at=now(), updated_by=sqlc.arg(actor_id)
FROM approval_entries entry
JOIN dcl_rpt_definition_versions payload ON payload.approval_entry_id=entry.id
JOIN dcl_subjects subject ON subject.id=entry.subject_id AND subject.entity='rpt-definition'
WHERE validity.approval_entry_id=entry.id
  AND entry.id=sqlc.arg(approval_entry_id)
  AND entry.domain='dcl' AND entry.entity='rpt-definition' AND entry.status='APPROVED'
  AND validity.validity='VALID';
-- name: RptInsertRuntimeAuditEvent :exec
INSERT INTO rpt_runtime_audit_events(id, definition_id, report_code, approval_entry_id, event_type, actor_id, request_id, summary) VALUES(sqlc.arg(id), sqlc.narg(definition_id), sqlc.arg(report_code), sqlc.narg(approval_entry_id), sqlc.arg(event_type), sqlc.arg(actor_id), sqlc.arg(request_id), sqlc.arg(summary));
