-- +goose Up
ALTER TABLE app_users
    ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;

-- Existing identities predate the forced-password flow and stay usable.
UPDATE app_users SET password_change_required = false;
ALTER TABLE app_users ALTER COLUMN password_change_required SET DEFAULT true;

-- Existing users have already been provisioned; only newly created or reset
-- credentials enter the restricted password-change session.
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
VALUES ('01JAPP00000000000000000018', '/app/user/reset-password', 'app', 'user', 'reset-password', '重置用户密码', 'ENABLED')
ON CONFLICT (path) DO UPDATE
SET description = EXCLUDED.description,
    status = EXCLUDED.status;

-- Signout and password changes are inherent to an authenticated subject and
-- must not be assigned through role permissions.
DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE path IN ('/app/user/signout', '/app/user/change-password')
);
DELETE FROM app_permissions
WHERE path IN ('/app/user/signout', '/app/user/change-password');

-- +goose Down
INSERT INTO app_permissions (id, path, domain, entity, action, description, status) VALUES
('01JAPP00000000000000000001', '/app/user/signout', 'app', 'user', 'signout', '退出登录', 'ENABLED'),
('01JAPP00000000000000000017', '/app/user/change-password', 'app', 'user', 'change-password', '修改当前用户密码', 'ENABLED')
ON CONFLICT (path) DO NOTHING;

DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE path = '/app/user/reset-password');
DELETE FROM app_permissions WHERE path = '/app/user/reset-password';
ALTER TABLE app_users DROP COLUMN password_change_required;
