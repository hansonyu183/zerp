-- +goose Up
ALTER TABLE bob_objects
    ADD COLUMN enabled boolean NOT NULL DEFAULT true;

UPDATE bob_versions
SET status = 'DRAFT',
    submitted_at = NULL,
    submitted_by = NULL,
    reviewed_at = NULL,
    reviewed_by = NULL,
    review_comment = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE status = 'REJECTED';

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DROP INDEX bob_versions_candidate_uq;
CREATE UNIQUE INDEX bob_versions_candidate_uq
    ON bob_versions (object_id) WHERE status IN ('DRAFT', 'PENDING');

ALTER TABLE bob_versions
    DROP CONSTRAINT bob_versions_status_check,
    DROP CONSTRAINT bob_versions_status_audit_ck,
    ADD CONSTRAINT bob_versions_status_check
        CHECK (status IN ('DRAFT', 'PENDING', 'EFFECTIVE', 'INVALID')),
    ADD CONSTRAINT bob_versions_status_audit_ck CHECK (
        (status = 'DRAFT' AND submitted_at IS NULL AND submitted_by IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status = 'PENDING' AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status IN ('EFFECTIVE', 'INVALID') AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    );

ALTER TABLE bob_audit_events
    DROP CONSTRAINT bob_audit_events_event_type_check,
    ADD CONSTRAINT bob_audit_events_event_type_check CHECK (
        event_type IN (
            'CREATED', 'EDIT_STARTED', 'SAVED', 'SUBMITTED', 'UNSUBMITTED',
            'APPROVED', 'UNAPPROVED', 'REJECTED', 'INVALIDATED',
            'ENABLED', 'DISABLED'
        )
    );

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'bob' AND action = 'edit'
);
DELETE FROM app_permissions WHERE domain = 'bob' AND action = 'edit';

WITH entities(entity, first_seq) AS (
    VALUES
        ('customer', 133),
        ('supplier', 137),
        ('employee', 141),
        ('product', 145),
        ('service', 149),
        ('warehouse', 153),
        ('vehicle', 157),
        ('fund-account', 161)
),
actions(action, offset_no) AS (
    VALUES
        ('unsubmit', 0),
        ('unapprove', 1),
        ('enable', 2),
        ('disable', 3)
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT
    '01JBOB' || lpad((entities.first_seq + actions.offset_no)::text, 20, '0'),
    '/bob/' || entity || '/' || action,
    'bob',
    entity,
    action,
    action || ' ' || entity,
    'ENABLED'
FROM entities CROSS JOIN actions;

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id
    FROM app_permissions
    WHERE domain = 'bob' AND action IN ('unsubmit', 'unapprove', 'enable', 'disable')
);
DELETE FROM app_permissions
WHERE domain = 'bob' AND action IN ('unsubmit', 'unapprove', 'enable', 'disable');

WITH entities(entity, edit_seq) AS (
    VALUES
        ('customer', 4),
        ('supplier', 14),
        ('employee', 24),
        ('product', 34),
        ('service', 44),
        ('warehouse', 64),
        ('vehicle', 74),
        ('fund-account', 54)
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT
    '01JBOB' || lpad(entities.edit_seq::text, 20, '0'),
    '/bob/' || entity || '/edit',
    'bob',
    entity,
    'edit',
    'edit ' || entity,
    'ENABLED'
FROM entities;

ALTER TABLE bob_versions
    DROP CONSTRAINT bob_versions_status_check,
    DROP CONSTRAINT bob_versions_status_audit_ck,
    ADD CONSTRAINT bob_versions_status_check
        CHECK (status IN ('DRAFT', 'PENDING', 'REJECTED', 'EFFECTIVE', 'INVALID')),
    ADD CONSTRAINT bob_versions_status_audit_ck CHECK (
        (status = 'DRAFT' AND submitted_at IS NULL AND submitted_by IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status = 'PENDING' AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status IN ('REJECTED', 'EFFECTIVE', 'INVALID') AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    );

DROP INDEX bob_versions_candidate_uq;
CREATE UNIQUE INDEX bob_versions_candidate_uq
    ON bob_versions (object_id) WHERE status IN ('DRAFT', 'PENDING', 'REJECTED');

ALTER TABLE bob_objects DROP COLUMN enabled;
