-- +goose Up

CREATE TABLE app_system_parameters (
    parameter_key varchar(128) PRIMARY KEY,
    name varchar(128) NOT NULL,
    description text,
    value_type varchar(16) NOT NULL,
    current_value text NOT NULL,
    default_value text NOT NULL,
    editable boolean NOT NULL DEFAULT true,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) REFERENCES app_users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) REFERENCES app_users(id) ON DELETE RESTRICT,
    CONSTRAINT app_system_parameters_key_format CHECK (
        parameter_key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
    ),
    CONSTRAINT app_system_parameters_value_type CHECK (
        value_type IN ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN')
    )
);

INSERT INTO app_system_parameters (
    parameter_key, name, description, value_type, current_value,
    default_value, editable, created_by, updated_by
) VALUES (
    'app.menu.mode', '当前菜单方式',
    '系统默认菜单或业务归类模板；只允许菜单服务修改',
    'STRING', 'DEFAULT', 'DEFAULT', false,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
);

INSERT INTO app_permissions (id, path, domain, entity, action, description, status) VALUES
('01JAPPSYSPARAM000000000001', '/app/system-parameter/query', 'app', 'system-parameter', 'query', '查询系统参数', 'ENABLED'),
('01JAPPSYSPARAM000000000002', '/app/system-parameter/get', 'app', 'system-parameter', 'get', '查看系统参数', 'ENABLED'),
('01JAPPSYSPARAM000000000003', '/app/system-parameter/save', 'app', 'system-parameter', 'save', '修改系统参数', 'ENABLED'),
('01JAPPSYSPARAM000000000004', '/app/system-parameter/reset', 'app', 'system-parameter', 'reset', '恢复系统参数默认值', 'ENABLED');

-- +goose Down

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'app' AND entity = 'system-parameter'
);
DELETE FROM app_permissions WHERE domain = 'app' AND entity = 'system-parameter';
DROP TABLE app_system_parameters;
