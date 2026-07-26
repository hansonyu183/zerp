-- +goose Up
DELETE FROM app_role_permissions rp
USING app_roles r
WHERE rp.role_id = r.id AND r.code = 'superadmin';

-- +goose Down
INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.status = 'ENABLED'
ON CONFLICT DO NOTHING;
