INSERT INTO app_system_parameters (
    parameter_key, name, description, value_type, configured_value,
    default_value, editable, constraints
) VALUES
(
    'e2e.display-mode', 'E2E 显示密度', '仅用于可销毁真实后端浏览器验收',
    'STRING', 'COMPACT', 'COMPACT', true,
    '{"required":true,"minLength":null,"maxLength":null,"minimum":null,"maximum":null,"allowedValues":["COMPACT","COMFORTABLE"]}'
);
