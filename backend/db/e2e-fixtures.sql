INSERT INTO app_system_parameters (
    parameter_key, name, description, value_type, configured_value,
    default_value, safe_to_expose, editable, constraints, effect_mode, running_value,
    running_revision, restart_pending, created_by, updated_by
) VALUES
(
    'e2e.display-mode', 'E2E 显示密度', '仅用于可销毁真实后端浏览器验收',
    'STRING', 'COMPACT', 'COMPACT', true, true,
    '{"required":true,"minLength":null,"maxLength":null,"minimum":null,"maximum":null,"allowedValues":["COMPACT","COMFORTABLE"]}',
    'IMMEDIATE', 'COMPACT', 1, false,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
),
(
    'e2e.next-request-mode', 'E2E 下次请求参数', '仅用于可销毁真实后端生效模式验收',
    'STRING', 'COMPACT', 'COMPACT', true, true,
    '{"required":true,"minLength":null,"maxLength":null,"minimum":null,"maximum":null,"allowedValues":["COMPACT","COMFORTABLE"]}',
    'NEXT_REQUEST', 'COMPACT', 1, false,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
),
(
    'e2e.restart-mode', 'E2E 重启参数', '仅用于可销毁真实后端生效模式验收',
    'INTEGER', '1', '1', true, true,
    '{"required":true,"minLength":null,"maxLength":null,"minimum":"1","maximum":"2","allowedValues":[]}',
    'RESTART_REQUIRED', '1', 1, false,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
);
