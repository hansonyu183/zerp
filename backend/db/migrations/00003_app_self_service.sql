-- +goose Up
INSERT INTO app_permissions (id, path, domain, entity, action, description, status) VALUES
('01JAPP00000000000000000016', '/app/user/profile', 'app', 'user', 'profile', '查看当前用户资料', 'ENABLED'),
('01JAPP00000000000000000017', '/app/user/change-password', 'app', 'user', 'change-password', '修改当前用户密码', 'ENABLED');

-- Existing super administrators receive newly introduced APP capabilities.
INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin'
  AND p.path IN ('/app/user/profile', '/app/user/change-password')
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id IN (
  SELECT id FROM app_permissions
  WHERE path IN ('/app/user/profile', '/app/user/change-password')
);
DELETE FROM app_permissions
WHERE path IN ('/app/user/profile', '/app/user/change-password');
