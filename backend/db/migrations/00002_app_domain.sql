-- +goose Up
CREATE TABLE app_users (
    id varchar(26) PRIMARY KEY,
    username varchar(64) NOT NULL,
    display_name varchar(128) NOT NULL,
    password_hash text NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
    failed_signin_count integer NOT NULL DEFAULT 0 CHECK (failed_signin_count >= 0),
    locked_until timestamptz,
    password_changed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE UNIQUE INDEX app_users_username_uq ON app_users (lower(username));

CREATE TABLE app_roles (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL UNIQUE,
    name varchar(128) NOT NULL,
    description text,
    status varchar(16) NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE TABLE app_permissions (
    id varchar(26) PRIMARY KEY,
    path varchar(255) NOT NULL UNIQUE,
    domain varchar(64) NOT NULL,
    entity varchar(64) NOT NULL,
    action varchar(64) NOT NULL,
    description text,
    status varchar(16) NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    CONSTRAINT app_permissions_path_matches_parts CHECK (path = '/' || domain || '/' || entity || '/' || action),
    CONSTRAINT app_permissions_domain_format CHECK (domain ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT app_permissions_entity_format CHECK (entity ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT app_permissions_action_format CHECK (action ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE app_user_roles (
    user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role_id varchar(26) NOT NULL REFERENCES app_roles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE app_role_permissions (
    role_id varchar(26) NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
    permission_id varchar(26) NOT NULL REFERENCES app_permissions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE app_sessions (
    id varchar(26) PRIMARY KEY,
    user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    csrf_token_hash bytea NOT NULL CHECK (octet_length(csrf_token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL,
    idle_expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_reason varchar(64),
    CONSTRAINT app_sessions_expiry_order CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX app_sessions_user_active_idx ON app_sessions (user_id, absolute_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE app_audit_events (
    id varchar(26) PRIMARY KEY,
    event_type varchar(64) NOT NULL,
    actor_user_id varchar(26) REFERENCES app_users(id) ON DELETE SET NULL,
    target_type varchar(64),
    target_id varchar(26),
    result varchar(16) NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
    request_id varchar(128),
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26)
);
CREATE INDEX app_audit_events_created_at_idx ON app_audit_events (created_at DESC);

INSERT INTO app_permissions (id, path, domain, entity, action, description, status) VALUES
('01JAPP00000000000000000001', '/app/user/signout', 'app', 'user', 'signout', '退出登录', 'ENABLED'),
('01JAPP00000000000000000002', '/app/user/query', 'app', 'user', 'query', '查询用户', 'ENABLED'),
('01JAPP00000000000000000003', '/app/user/get', 'app', 'user', 'get', '查看用户', 'ENABLED'),
('01JAPP00000000000000000004', '/app/user/create', 'app', 'user', 'create', '创建用户', 'ENABLED'),
('01JAPP00000000000000000005', '/app/user/save', 'app', 'user', 'save', '修改用户', 'ENABLED'),
('01JAPP00000000000000000006', '/app/user/enable', 'app', 'user', 'enable', '启用用户', 'ENABLED'),
('01JAPP00000000000000000007', '/app/user/disable', 'app', 'user', 'disable', '停用用户', 'ENABLED'),
('01JAPP00000000000000000008', '/app/role/query', 'app', 'role', 'query', '查询角色', 'ENABLED'),
('01JAPP00000000000000000009', '/app/role/get', 'app', 'role', 'get', '查看角色', 'ENABLED'),
('01JAPP00000000000000000010', '/app/role/create', 'app', 'role', 'create', '创建角色', 'ENABLED'),
('01JAPP00000000000000000011', '/app/role/save', 'app', 'role', 'save', '修改角色', 'ENABLED'),
('01JAPP00000000000000000012', '/app/role/enable', 'app', 'role', 'enable', '启用角色', 'ENABLED'),
('01JAPP00000000000000000013', '/app/role/disable', 'app', 'role', 'disable', '停用角色', 'ENABLED'),
('01JAPP00000000000000000014', '/app/permission/query', 'app', 'permission', 'query', '查询权限目录', 'ENABLED'),
('01JAPP00000000000000000015', '/app/permission/get', 'app', 'permission', 'get', '查看权限', 'ENABLED');

-- +goose Down
DROP TABLE app_audit_events;
DROP TABLE app_sessions;
DROP TABLE app_role_permissions;
DROP TABLE app_user_roles;
DROP TABLE app_permissions;
DROP TABLE app_roles;
DROP TABLE app_users;
