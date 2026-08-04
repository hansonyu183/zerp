-- +goose Up

ALTER TABLE bob_settlement_method_versions
    ADD COLUMN term_code varchar(32) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN default_sales_surcharge_cents bigint NOT NULL DEFAULT 0
        CHECK (default_sales_surcharge_cents >= 0);

ALTER TABLE vou_sale_order_details
    ADD COLUMN settlement_term_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE vou_purchase_order_details
    ADD COLUMN settlement_term_code varchar(32) NOT NULL DEFAULT '';

CREATE TABLE bob_migration_00046_counter (
    previous_last_value integer NOT NULL CHECK (previous_last_value BETWEEN 0 AND 9988)
);

INSERT INTO bob_migration_00046_counter(previous_last_value)
SELECT COALESCE((
    SELECT last_value FROM object_number_counters
    WHERE domain = 'bob' AND entity = 'settlement-method'
), 0);

INSERT INTO object_number_counters(domain, entity, last_value)
SELECT 'bob', 'settlement-method', previous_last_value + 11
FROM bob_migration_00046_counter
ON CONFLICT (domain, entity) DO UPDATE
SET last_value = EXCLUDED.last_value;

CREATE TABLE bob_migration_00046_fixed_methods (
    ordinal integer PRIMARY KEY CHECK (ordinal BETWEEN 1 AND 11),
    object_id varchar(26) NOT NULL UNIQUE,
    version_id varchar(26) NOT NULL UNIQUE,
    term_code varchar(32) NOT NULL UNIQUE,
    name varchar(200) NOT NULL,
    rule_type varchar(32) NOT NULL,
    month_offset integer NOT NULL DEFAULT 0,
    day_offset integer NOT NULL DEFAULT 0,
    default_sales_surcharge_cents bigint NOT NULL DEFAULT 0
);

INSERT INTO bob_migration_00046_fixed_methods(
    ordinal, object_id, version_id, term_code, name, rule_type,
    month_offset, day_offset, default_sales_surcharge_cents
) VALUES
    (1,  '01JSMT00000000000000000001', '01JSMT00000000000000000002', 'PREPAID',          '预付',      'RELATIVE_DAYS', 0,  0,  0),
    (2,  '01JSMT00000000000000000003', '01JSMT00000000000000000004', 'CASH_ON_DELIVERY','现结',      'RELATIVE_DAYS', 0,  0,  0),
    (3,  '01JSMT00000000000000000005', '01JSMT00000000000000000006', 'ARRIVAL_3',       '货到3天',   'RELATIVE_DAYS', 0,  3,  0),
    (4,  '01JSMT00000000000000000007', '01JSMT00000000000000000008', 'ARRIVAL_5',       '货到5天',   'RELATIVE_DAYS', 0,  5,  0),
    (5,  '01JSMT00000000000000000009', '01JSMT00000000000000000010', 'ARRIVAL_7',       '货到7天',   'RELATIVE_DAYS', 0,  7,  0),
    (6,  '01JSMT00000000000000000011', '01JSMT00000000000000000012', 'ARRIVAL_15',      '货到15天',  'RELATIVE_DAYS', 0, 15,  0),
    (7,  '01JSMT00000000000000000013', '01JSMT00000000000000000014', 'ARRIVAL_30',      '货到30天',  'RELATIVE_DAYS', 0, 30, 10),
    (8,  '01JSMT00000000000000000015', '01JSMT00000000000000000016', 'MONTHLY_CURRENT', '当月结',    'MONTH_END',     0,  0,  5),
    (9,  '01JSMT00000000000000000017', '01JSMT00000000000000000018', 'MONTHLY_30',      '月结30天',  'MONTH_END',     1,  0, 10),
    (10, '01JSMT00000000000000000019', '01JSMT00000000000000000020', 'MONTHLY_60',      '月结60天',  'MONTH_END',     2,  0, 20),
    (11, '01JSMT00000000000000000021', '01JSMT00000000000000000022', 'MONTHLY_90',      '月结90天',  'MONTH_END',     3,  0, 30);

INSERT INTO bob_objects(
    id, entity, code, current_version_id, effective_version_id, enabled,
    next_version_no, revision, created_by, updated_by
)
SELECT methods.object_id, 'settlement-method',
       'STM-' || lpad((counter.previous_last_value + methods.ordinal)::text, 4, '0'),
       methods.version_id, methods.version_id, true, 2, 1,
       '00000000000000000000000000', '00000000000000000000000000'
FROM bob_migration_00046_fixed_methods methods
CROSS JOIN bob_migration_00046_counter counter;

INSERT INTO bob_versions(
    id, object_id, entity, version_no, status, revision,
    created_by, updated_by, submitted_at, submitted_by, reviewed_at, reviewed_by,
    review_comment
)
SELECT version_id, object_id, 'settlement-method', 1, 'EFFECTIVE', 1,
       '00000000000000000000000000', '00000000000000000000000000',
       now(), '00000000000000000000000000', now(), '00000000000000000000000001',
       '系统固定结算方式初始版本'
FROM bob_migration_00046_fixed_methods;

INSERT INTO bob_settlement_method_versions(
    version_id, name, term_code, rule_type, month_offset, day_of_month,
    day_offset, default_sales_surcharge_cents, description
)
SELECT version_id, name, term_code, rule_type, month_offset, NULL,
       day_offset, default_sales_surcharge_cents, '系统固定结算方式'
FROM bob_migration_00046_fixed_methods;

INSERT INTO bob_audit_events(
    id, object_id, version_id, entity, event_type, from_status, to_status,
    actor_id, request_id, summary
)
SELECT '01JSMTA' || lpad(ordinal::text, 19, '0'), object_id, version_id,
       'settlement-method', 'APPROVED', 'PENDING', 'EFFECTIVE',
       '00000000000000000000000001', 'migration-00046',
       jsonb_build_object('termCode', term_code, 'systemDefined', true)
FROM bob_migration_00046_fixed_methods;

CREATE TABLE bob_migration_00046_aux_map (
    aux_object_id varchar(26) PRIMARY KEY,
    target_object_id varchar(26) NOT NULL
);

WITH classified AS (
    SELECT o.id AS aux_object_id,
           CASE
             WHEN v.data->>'name' LIKE '%预付%' THEN 'PREPAID'
             WHEN v.data->>'ruleType' = 'DUE_DAYS'
                  AND COALESCE((v.data->>'dueDays')::integer, 0) = 0
               THEN 'CASH_ON_DELIVERY'
             WHEN v.data->>'ruleType' = 'DUE_DAYS' THEN (
                 SELECT candidate.term_code
                 FROM (VALUES
                     ('ARRIVAL_3',3), ('ARRIVAL_5',5), ('ARRIVAL_7',7),
                     ('ARRIVAL_15',15), ('ARRIVAL_30',30)
                 ) AS candidate(term_code, due_days)
                 ORDER BY abs(candidate.due_days - COALESCE((v.data->>'dueDays')::integer, 0)),
                          candidate.due_days DESC
                 LIMIT 1
             )
             WHEN COALESCE(legacy.month_offset, 0) <= 0 THEN 'MONTHLY_CURRENT'
             WHEN legacy.month_offset = 1 THEN 'MONTHLY_30'
             WHEN legacy.month_offset = 2 THEN 'MONTHLY_60'
             ELSE 'MONTHLY_90'
           END AS term_code
    FROM aux_objects o
    JOIN aux_versions v ON v.id = o.current_version_id
    LEFT JOIN aux_migration_00045_settlement_terms legacy ON legacy.version_id = v.id
    WHERE o.entity = 'settlement-method'
)
INSERT INTO bob_migration_00046_aux_map(aux_object_id, target_object_id)
SELECT classified.aux_object_id, methods.object_id
FROM classified
JOIN bob_migration_00046_fixed_methods methods USING (term_code);

WITH classified AS (
    SELECT o.id AS legacy_object_id,
           CASE
             WHEN detail.name LIKE '%预付%' THEN 'PREPAID'
             WHEN detail.rule_type IN ('DUE_DAYS','RELATIVE_DAYS')
                  AND detail.day_offset = 0
               THEN 'CASH_ON_DELIVERY'
             WHEN detail.rule_type IN ('DUE_DAYS','RELATIVE_DAYS') THEN (
                 SELECT candidate.term_code
                 FROM (VALUES
                     ('ARRIVAL_3',3), ('ARRIVAL_5',5), ('ARRIVAL_7',7),
                     ('ARRIVAL_15',15), ('ARRIVAL_30',30)
                 ) AS candidate(term_code, due_days)
                 ORDER BY abs(candidate.due_days - detail.day_offset),
                          candidate.due_days DESC
                 LIMIT 1
             )
             WHEN detail.month_offset <= 0 THEN 'MONTHLY_CURRENT'
             WHEN detail.month_offset = 1 THEN 'MONTHLY_30'
             WHEN detail.month_offset = 2 THEN 'MONTHLY_60'
             ELSE 'MONTHLY_90'
           END AS term_code
    FROM bob_objects o
    JOIN bob_settlement_method_versions detail ON detail.version_id = o.current_version_id
    WHERE o.entity = 'settlement-method'
      AND detail.term_code = 'LEGACY'
)
INSERT INTO bob_migration_00046_aux_map(aux_object_id, target_object_id)
SELECT classified.legacy_object_id, methods.object_id
FROM classified
JOIN bob_migration_00046_fixed_methods methods USING (term_code);

CREATE TABLE bob_migration_00046_party_refs (
    detail_table varchar(32) NOT NULL,
    version_id varchar(26) NOT NULL,
    old_settlement_method_id varchar(26) NOT NULL,
    PRIMARY KEY(detail_table, version_id)
);

INSERT INTO bob_migration_00046_party_refs
SELECT 'bob_customer_versions', detail.version_id, detail.settlement_method_id
FROM bob_customer_versions detail
JOIN bob_migration_00046_aux_map mapping
  ON mapping.aux_object_id = detail.settlement_method_id
WHERE detail.version_id IN (
    SELECT current_version_id FROM bob_objects WHERE entity IN ('customer','other-party')
    UNION SELECT effective_version_id FROM bob_objects
          WHERE entity IN ('customer','other-party') AND effective_version_id IS NOT NULL
);

INSERT INTO bob_migration_00046_party_refs
SELECT 'bob_supplier_versions', detail.version_id, detail.settlement_method_id
FROM bob_supplier_versions detail
JOIN bob_migration_00046_aux_map mapping
  ON mapping.aux_object_id = detail.settlement_method_id
WHERE detail.version_id IN (
    SELECT current_version_id FROM bob_objects WHERE entity = 'supplier'
    UNION SELECT effective_version_id FROM bob_objects
          WHERE entity = 'supplier' AND effective_version_id IS NOT NULL
);

UPDATE bob_customer_versions detail
SET settlement_method_id = mapping.target_object_id
FROM bob_migration_00046_aux_map mapping
WHERE detail.settlement_method_id = mapping.aux_object_id
  AND EXISTS (
      SELECT 1 FROM bob_migration_00046_party_refs backup
      WHERE backup.detail_table = 'bob_customer_versions'
        AND backup.version_id = detail.version_id
  );

UPDATE bob_supplier_versions detail
SET settlement_method_id = mapping.target_object_id
FROM bob_migration_00046_aux_map mapping
WHERE detail.settlement_method_id = mapping.aux_object_id
  AND EXISTS (
      SELECT 1 FROM bob_migration_00046_party_refs backup
      WHERE backup.detail_table = 'bob_supplier_versions'
        AND backup.version_id = detail.version_id
  );

CREATE TABLE vou_settlement_reservations (
    order_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE RESTRICT,
    order_entity varchar(32) NOT NULL CHECK (order_entity IN ('sale-order','purchase-order')),
    term_code varchar(32) NOT NULL CHECK (term_code IN ('PREPAID','CASH_ON_DELIVERY')),
    counterparty_entity varchar(16) NOT NULL CHECK (counterparty_entity IN ('customer','supplier')),
    counterparty_object_id varchar(26) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    original_amount_cents bigint NOT NULL CHECK (original_amount_cents >= 0),
    reserved_amount_cents bigint NOT NULL CHECK (reserved_amount_cents >= 0),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vou_settlement_reservations_prepaid_idx
    ON vou_settlement_reservations(counterparty_entity, counterparty_object_id, currency)
    WHERE active AND term_code = 'PREPAID';
CREATE UNIQUE INDEX vou_settlement_reservations_cod_uq
    ON vou_settlement_reservations(counterparty_entity, counterparty_object_id, currency)
    WHERE active AND term_code = 'CASH_ON_DELIVERY';

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'aux' AND entity = 'settlement-method'
);
DELETE FROM app_permissions WHERE domain = 'aux' AND entity = 'settlement-method';

WITH actions(action, description, ordinal) AS (
    VALUES
      ('query','查询',1), ('get','查看',2), ('save','保存草稿',3),
      ('submit','提交审核',4), ('unsubmit','撤回提交',5),
      ('approve','审核通过',6), ('unapprove','撤销审核',7),
      ('reject','审核驳回',8), ('enable','启用',9), ('disable','停用',10),
      ('versions','查看版本',11), ('audit-history','查看审核记录',12)
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT '01JSMTP' || lpad(ordinal::text, 19, '0'),
       '/bob/settlement-method/' || action, 'bob', 'settlement-method', action,
       description || '结算方式', 'ENABLED'
FROM actions;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT role.id, permission.id, role.updated_by
FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code = 'superadmin'
  AND permission.domain = 'bob' AND permission.entity = 'settlement-method'
ON CONFLICT DO NOTHING;

ALTER VIEW bob_version_views RENAME TO bob_version_views_00046_base;
CREATE VIEW bob_version_views AS
SELECT base.*,
       COALESCE(settlement.term_code, '') AS settlement_term_code,
       COALESCE(settlement.default_sales_surcharge_cents, 0) AS settlement_default_sales_surcharge_cents
FROM bob_version_views_00046_base base
LEFT JOIN bob_settlement_method_versions settlement
  ON settlement.version_id = base.version_id;

-- +goose Down

DROP VIEW bob_version_views;
ALTER VIEW bob_version_views_00046_base RENAME TO bob_version_views;

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'bob' AND entity = 'settlement-method'
);
DELETE FROM app_permissions WHERE domain = 'bob' AND entity = 'settlement-method';

WITH actions(action, description, ordinal) AS (
    VALUES
      ('query','查询',1), ('get','查看',2), ('create','创建',3),
      ('save','保存',4), ('enable','启用',5), ('disable','停用',6),
      ('delete','删除',7), ('versions','查看版本',8),
      ('audit-history','查看变更记录',9)
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT '01JAUX' || lpad((80 + ordinal)::text, 20, '0'),
       '/aux/settlement-method/' || action, 'aux', 'settlement-method', action,
       description || '结算方式', 'ENABLED'
FROM actions;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT role.id, permission.id, role.updated_by
FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code = 'superadmin'
  AND permission.domain = 'aux' AND permission.entity = 'settlement-method'
ON CONFLICT DO NOTHING;

DROP TABLE vou_settlement_reservations;

UPDATE bob_customer_versions detail
SET settlement_method_id = backup.old_settlement_method_id
FROM bob_migration_00046_party_refs backup
WHERE backup.detail_table = 'bob_customer_versions'
  AND backup.version_id = detail.version_id;

UPDATE bob_supplier_versions detail
SET settlement_method_id = backup.old_settlement_method_id
FROM bob_migration_00046_party_refs backup
WHERE backup.detail_table = 'bob_supplier_versions'
  AND backup.version_id = detail.version_id;

DELETE FROM bob_audit_events
WHERE object_id IN (SELECT object_id FROM bob_migration_00046_fixed_methods);
DELETE FROM bob_settlement_method_versions detail
USING bob_versions version, bob_migration_00046_fixed_methods methods
WHERE detail.version_id = version.id
  AND version.object_id = methods.object_id;
DELETE FROM bob_versions version
USING bob_migration_00046_fixed_methods methods
WHERE version.object_id = methods.object_id;
DELETE FROM bob_objects
WHERE id IN (SELECT object_id FROM bob_migration_00046_fixed_methods);

DELETE FROM object_number_counters
WHERE domain = 'bob' AND entity = 'settlement-method'
  AND (SELECT previous_last_value FROM bob_migration_00046_counter) = 0;
UPDATE object_number_counters
SET last_value = (SELECT previous_last_value FROM bob_migration_00046_counter)
WHERE domain = 'bob' AND entity = 'settlement-method'
  AND (SELECT previous_last_value FROM bob_migration_00046_counter) > 0;

SET CONSTRAINTS ALL IMMEDIATE;

DROP TABLE bob_migration_00046_party_refs;
DROP TABLE bob_migration_00046_aux_map;
DROP TABLE bob_migration_00046_fixed_methods;
DROP TABLE bob_migration_00046_counter;

ALTER TABLE vou_purchase_order_details DROP COLUMN settlement_term_code;
ALTER TABLE vou_sale_order_details DROP COLUMN settlement_term_code;
ALTER TABLE bob_settlement_method_versions
    DROP COLUMN default_sales_surcharge_cents,
    DROP COLUMN term_code;
