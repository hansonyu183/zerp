-- +goose Up

INSERT INTO app_roles (
    id, code, name, description, status, created_by, updated_by
) VALUES (
    '01JAPPSYST3MR0X30000000000', 'system', '系统角色',
    '系统内部自动化专用，不授予接口权限且不可人工维护',
    'ENABLED', '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO app_users (
    id, username, display_name, password_hash, status,
    password_changed_at, created_by, updated_by
) VALUES (
    '01JAPPSYST3MACTR0000000000', 'system', '系统用户',
    '!system-login-disabled!', 'DISABLED', now(),
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO app_user_roles (user_id, role_id, created_by)
VALUES (
    '01JAPPSYST3MACTR0000000000',
    '01JAPPSYST3MR0X30000000000',
    '01JAPPSYST3MACTR0000000000'
) ON CONFLICT DO NOTHING;

ALTER TABLE bob_versions DROP CONSTRAINT bob_versions_review_separation;
ALTER TABLE bob_versions ADD CONSTRAINT bob_versions_review_separation CHECK (
    submitted_by IS NULL OR reviewed_by IS NULL OR submitted_by <> reviewed_by
    OR (submitted_by = '01JAPPSYST3MACTR0000000000'
        AND reviewed_by = '01JAPPSYST3MACTR0000000000')
);

WITH seeded AS (
    SELECT DISTINCT object_id
    FROM bob_audit_events
    WHERE request_id LIKE 'seed-bob-%'
       OR request_id LIKE 'seed-preview-%'
)
UPDATE bob_objects object
SET created_by = '01JAPPSYST3MACTR0000000000',
    updated_by = '01JAPPSYST3MACTR0000000000'
FROM seeded
WHERE object.id = seeded.object_id;

WITH seeded AS (
    SELECT DISTINCT object_id
    FROM bob_audit_events
    WHERE request_id LIKE 'seed-bob-%'
       OR request_id LIKE 'seed-preview-%'
)
UPDATE bob_versions version
SET created_by = '01JAPPSYST3MACTR0000000000',
    updated_by = '01JAPPSYST3MACTR0000000000',
    submitted_by = CASE WHEN submitted_by IS NULL THEN NULL
        ELSE '01JAPPSYST3MACTR0000000000' END,
    reviewed_by = CASE WHEN reviewed_by IS NULL THEN NULL
        ELSE '01JAPPSYST3MACTR0000000000' END
FROM seeded
WHERE version.object_id = seeded.object_id;

UPDATE bob_audit_events
SET actor_id = '01JAPPSYST3MACTR0000000000'
WHERE request_id LIKE 'seed-bob-%'
   OR request_id LIKE 'seed-preview-%';

WITH seeded AS (
    SELECT DISTINCT object_id
    FROM aux_audit_events
    WHERE request_id LIKE 'seed-bob-%'
       OR request_id LIKE 'seed-preview-%'
)
UPDATE aux_objects object
SET created_by = '01JAPPSYST3MACTR0000000000',
    updated_by = '01JAPPSYST3MACTR0000000000'
FROM seeded
WHERE object.id = seeded.object_id;

WITH seeded AS (
    SELECT DISTINCT object_id
    FROM aux_audit_events
    WHERE request_id LIKE 'seed-bob-%'
       OR request_id LIKE 'seed-preview-%'
)
UPDATE aux_versions version
SET created_by = '01JAPPSYST3MACTR0000000000'
FROM seeded
WHERE version.object_id = seeded.object_id;

UPDATE aux_audit_events
SET actor_id = '01JAPPSYST3MACTR0000000000'
WHERE request_id LIKE 'seed-bob-%'
   OR request_id LIKE 'seed-preview-%';

WITH derived AS (
    SELECT id FROM vou_documents WHERE parent_document_id IS NOT NULL
    UNION
    SELECT DISTINCT document_id FROM vou_audit_events
    WHERE request_id LIKE 'seed-preview-%'
       OR request_id LIKE 'seed-production-demo-%'
)
UPDATE vou_documents document
SET created_by = '01JAPPSYST3MACTR0000000000',
    updated_by = '01JAPPSYST3MACTR0000000000',
    reviewed_by = CASE WHEN reviewed_by IS NULL THEN NULL
        ELSE '01JAPPSYST3MACTR0000000000' END,
    checked_by = CASE WHEN checked_by IS NULL THEN NULL
        ELSE '01JAPPSYST3MACTR0000000000' END,
    approved_by = CASE WHEN approved_by IS NULL THEN NULL
        ELSE '01JAPPSYST3MACTR0000000000' END,
    executed_by = CASE WHEN executed_by IS NULL THEN NULL
        ELSE '01JAPPSYST3MACTR0000000000' END
FROM derived
WHERE document.id = derived.id;

WITH derived AS (
    SELECT id FROM vou_documents WHERE parent_document_id IS NOT NULL
    UNION
    SELECT DISTINCT document_id FROM vou_audit_events
    WHERE request_id LIKE 'seed-preview-%'
       OR request_id LIKE 'seed-production-demo-%'
)
UPDATE vou_audit_events audit
SET actor_id = '01JAPPSYST3MACTR0000000000'
FROM derived
WHERE audit.document_id = derived.id;

WITH derived AS (
    SELECT id FROM vou_documents WHERE parent_document_id IS NOT NULL
    UNION
    SELECT DISTINCT document_id FROM vou_audit_events
    WHERE request_id LIKE 'seed-preview-%'
       OR request_id LIKE 'seed-production-demo-%'
)
UPDATE vou_document_attachments attachment
SET created_by = '01JAPPSYST3MACTR0000000000'
FROM derived
WHERE attachment.document_id = derived.id;

UPDATE wfl_process_instances
SET created_by = '01JAPPSYST3MACTR0000000000',
    updated_by = '01JAPPSYST3MACTR0000000000';

UPDATE wfl_audit_events
SET actor_id = '01JAPPSYST3MACTR0000000000';

UPDATE led_inventory_entries SET actor_id = '01JAPPSYST3MACTR0000000000';
UPDATE led_fund_entries SET actor_id = '01JAPPSYST3MACTR0000000000';
UPDATE led_party_entries SET actor_id = '01JAPPSYST3MACTR0000000000';
UPDATE led_container_entries SET actor_id = '01JAPPSYST3MACTR0000000000';
UPDATE led_audit_events SET actor_id = '01JAPPSYST3MACTR0000000000';
UPDATE led_generations
SET activated_by = '01JAPPSYST3MACTR0000000000'
WHERE request_id = 'zero-opening'
   OR request_id LIKE 'seed-preview-%'
   OR request_id LIKE 'seed-production-demo-%';
UPDATE led_control
SET updated_by = '01JAPPSYST3MACTR0000000000'
WHERE updated_by = '01JLEDSYSTEM00000000000000';

-- +goose Down

ALTER TABLE bob_versions DROP CONSTRAINT bob_versions_review_separation;

UPDATE bob_versions
SET reviewed_by = '01J00000000000000000000001'
WHERE submitted_by = '01JAPPSYST3MACTR0000000000'
  AND reviewed_by = '01JAPPSYST3MACTR0000000000';

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE bob_versions ADD CONSTRAINT bob_versions_review_separation CHECK (
    submitted_by IS NULL OR reviewed_by IS NULL OR submitted_by <> reviewed_by
);

DELETE FROM app_user_roles
WHERE user_id = '01JAPPSYST3MACTR0000000000'
   OR role_id = '01JAPPSYST3MR0X30000000000';
DELETE FROM app_roles WHERE id = '01JAPPSYST3MR0X30000000000';
DELETE FROM app_users WHERE id = '01JAPPSYST3MACTR0000000000';
