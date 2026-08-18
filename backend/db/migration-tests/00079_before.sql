INSERT INTO app_system_parameters (
    parameter_key, name, value_type, current_value, default_value, editable,
    created_by, updated_by
) VALUES
(
    'test.string-setting', '字符串参数', 'STRING', 'configured', 'default', true,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
),
(
    'test.read-only-setting', '只读参数', 'BOOLEAN', 'true', 'false', false,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
);
