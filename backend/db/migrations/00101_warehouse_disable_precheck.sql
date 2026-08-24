-- +goose Up
ALTER TABLE bob_audit_events
    DROP CONSTRAINT bob_audit_events_event_type_check,
    ADD CONSTRAINT bob_audit_events_event_type_check CHECK (event_type IN (
        'CREATED','EDIT_STARTED','SAVED','SUBMITTED','UNSUBMITTED','APPROVED','UNAPPROVED',
        'REJECTED','INVALIDATED','ENABLED','DISABLED','BULK_BOB_REFERENCE_TRANSFERRED',
        'WAREHOUSE_MANAGER_CLEARED'
    ));

INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
VALUES (
    '01JWHS00000000000000000001',
    '/bob/warehouse/disable-precheck',
    'bob',
    'warehouse',
    'disable-precheck',
    '预检仓库停用阻断',
    'ENABLED'
)
ON CONFLICT (path) DO NOTHING;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT role.id, permission.id, role.updated_by
FROM app_roles role
JOIN app_permissions permission ON permission.path='/bob/warehouse/disable-precheck'
WHERE role.code='superadmin'
ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id=(SELECT id FROM app_permissions WHERE path='/bob/warehouse/disable-precheck');
DELETE FROM app_permissions WHERE path='/bob/warehouse/disable-precheck';

ALTER TABLE bob_audit_events
    DROP CONSTRAINT bob_audit_events_event_type_check,
    ADD CONSTRAINT bob_audit_events_event_type_check CHECK (event_type IN (
        'CREATED','EDIT_STARTED','SAVED','SUBMITTED','UNSUBMITTED','APPROVED','UNAPPROVED',
        'REJECTED','INVALIDATED','ENABLED','DISABLED'
    ));
