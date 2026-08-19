-- +goose Up

ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_entity_check;
ALTER TABLE aux_objects ADD CONSTRAINT aux_objects_entity_check CHECK (entity IN (
    'product-category','department','position','settlement-method','payment-method',
    'dictionary-type','dictionary-item','measurement-unit','income-expense-type','asset-category'
));

-- Settlement methods are a closed, system-seeded AUX catalogue.  The IDs are
-- deliberately stable so the target customer model can store their source ID.
WITH methods(ordinal, object_id, version_id, code, name, term_code, rule_type, month_offset, day_of_month, day_offset, surcharge) AS (
    VALUES
        (1,  '01JSMT00000000000000000001', '01JSMT00000000000000000002', 'STM-0001', '预付',      'PREPAID',          'RELATIVE_DAYS', 0, 0, 0,  '0.00'),
        (2,  '01JSMT00000000000000000003', '01JSMT00000000000000000004', 'STM-0002', '现结',      'CASH_ON_DELIVERY', 'RELATIVE_DAYS', 0, 0, 0,  '0.00'),
        (3,  '01JSMT00000000000000000005', '01JSMT00000000000000000006', 'STM-0003', '货到3天',   'ARRIVAL_3',        'RELATIVE_DAYS', 0, 0, 3,  '0.00'),
        (4,  '01JSMT00000000000000000007', '01JSMT00000000000000000008', 'STM-0004', '货到5天',   'ARRIVAL_5',        'RELATIVE_DAYS', 0, 0, 5,  '0.00'),
        (5,  '01JSMT00000000000000000009', '01JSMT00000000000000000010', 'STM-0005', '货到7天',   'ARRIVAL_7',        'RELATIVE_DAYS', 0, 0, 7,  '0.00'),
        (6,  '01JSMT00000000000000000011', '01JSMT00000000000000000012', 'STM-0006', '货到15天',  'ARRIVAL_15',       'RELATIVE_DAYS', 0, 0, 15, '0.00'),
        (7,  '01JSMT00000000000000000013', '01JSMT00000000000000000014', 'STM-0007', '货到30天',  'ARRIVAL_30',       'RELATIVE_DAYS', 0, 0, 30, '0.10'),
        (8,  '01JSMT00000000000000000015', '01JSMT00000000000000000016', 'STM-0008', '当月结',    'MONTHLY_CURRENT',  'MONTH_END',     0, 0, 0,  '0.05'),
        (9,  '01JSMT00000000000000000017', '01JSMT00000000000000000018', 'STM-0009', '月结30天',  'MONTHLY_30',       'MONTH_END',     1, 0, 0,  '0.10'),
        (10, '01JSMT00000000000000000019', '01JSMT00000000000000000020', 'STM-0010', '月结60天',  'MONTHLY_60',       'MONTH_END',     2, 0, 0,  '0.20'),
        (11, '01JSMT00000000000000000021', '01JSMT00000000000000000022', 'STM-0011', '月结90天',  'MONTHLY_90',       'MONTH_END',     3, 0, 0,  '0.30')
), inserted_objects AS (
    INSERT INTO aux_objects(id, entity, code, current_version_id, enabled, next_version_no, revision, created_by, updated_by)
    SELECT object_id, 'settlement-method', code, version_id, true, 2, 1,
           '00000000000000000000000000', '00000000000000000000000000'
    FROM methods
    ON CONFLICT (id) DO NOTHING
    RETURNING id
)
INSERT INTO aux_versions(id, object_id, entity, version_no, data, created_by)
SELECT version_id, object_id, 'settlement-method', 1,
       jsonb_build_object(
           'name', name, 'termCode', term_code, 'ruleType', rule_type,
           'monthOffset', month_offset, 'dayOfMonth', day_of_month, 'dayOffset', day_offset,
           'defaultSalesSurcharge', surcharge, 'description', '系统固定结算方式'
       ),
       '00000000000000000000000000'
FROM methods
ON CONFLICT (id) DO NOTHING;

-- The preceding insert uses the preallocated version id.  Keep the number
-- counter aligned even though settlement-method creation is prohibited.
INSERT INTO object_number_counters(domain, entity, last_value)
VALUES ('aux', 'settlement-method', 11)
ON CONFLICT (domain, entity) DO UPDATE SET last_value=GREATEST(object_number_counters.last_value, EXCLUDED.last_value);

WITH methods(ordinal, object_id, version_id, term_code) AS (
    VALUES
        (1, '01JSMT00000000000000000001', '01JSMT00000000000000000002', 'PREPAID'),
        (2, '01JSMT00000000000000000003', '01JSMT00000000000000000004', 'CASH_ON_DELIVERY'),
        (3, '01JSMT00000000000000000005', '01JSMT00000000000000000006', 'ARRIVAL_3'),
        (4, '01JSMT00000000000000000007', '01JSMT00000000000000000008', 'ARRIVAL_5'),
        (5, '01JSMT00000000000000000009', '01JSMT00000000000000000010', 'ARRIVAL_7'),
        (6, '01JSMT00000000000000000011', '01JSMT00000000000000000012', 'ARRIVAL_15'),
        (7, '01JSMT00000000000000000013', '01JSMT00000000000000000014', 'ARRIVAL_30'),
        (8, '01JSMT00000000000000000015', '01JSMT00000000000000000016', 'MONTHLY_CURRENT'),
        (9, '01JSMT00000000000000000017', '01JSMT00000000000000000018', 'MONTHLY_30'),
        (10, '01JSMT00000000000000000019', '01JSMT00000000000000000020', 'MONTHLY_60'),
        (11, '01JSMT00000000000000000021', '01JSMT00000000000000000022', 'MONTHLY_90')
)
INSERT INTO aux_audit_events(id, object_id, version_id, entity, event_type, actor_id, request_id, summary)
SELECT '01JSMTA' || lpad(ordinal::text, 19, '0'), object_id, version_id,
       'settlement-method', 'CREATED', '00000000000000000000000000', 'migration-00082',
       jsonb_build_object('termCode', term_code, 'systemDefined', true)
FROM methods
ON CONFLICT (id) DO NOTHING;

WITH actions(action, description, ordinal) AS (
    VALUES
        ('query', '查询', 1), ('get', '查看', 2), ('create', '创建', 3),
        ('save', '保存', 4), ('enable', '启用', 5), ('disable', '停用', 6),
        ('delete', '删除', 7), ('versions', '查看版本', 8), ('audit-history', '查看变更记录', 9)
), entities(entity, description, ordinal) AS (
    VALUES ('settlement-method', '结算方式', 1), ('payment-method', '收款方式', 2)
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT '01JAUX' || lpad((900 + entity.ordinal * 10 + action.ordinal)::text, 20, '0'),
       '/aux/' || entity.entity || '/' || action.action,
       'aux', entity.entity, action.action, action.description || entity.description, 'ENABLED'
FROM entities AS entity CROSS JOIN actions AS action
ON CONFLICT (path) DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT role.id, permission.id, role.updated_by
FROM app_roles AS role
CROSS JOIN app_permissions AS permission
WHERE role.code='superadmin'
  AND permission.domain='aux'
  AND permission.entity IN ('settlement-method', 'payment-method')
ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00082 is irreversible; AUX settlement/payment ownership is a direct cutover';
END
$$;
-- +goose StatementEnd
