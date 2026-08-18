INSERT INTO app_system_parameters (
    parameter_key, name, description, value_type, configured_value,
    default_value, editable, constraints, effect_mode, running_value,
    running_revision, restart_pending, created_by, updated_by
) VALUES (
    'e2e.display-mode', 'E2E 显示密度', '仅用于可销毁真实后端浏览器验收',
    'STRING', 'COMPACT', 'COMPACT', true,
    '{"required":true,"minLength":null,"maxLength":null,"minimum":null,"maximum":null,"allowedValues":["COMPACT","COMFORTABLE"]}',
    'IMMEDIATE', 'COMPACT', 1, false,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
);
