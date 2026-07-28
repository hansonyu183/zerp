-- +goose Up

CREATE TABLE aux_objects (
    id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL CHECK (entity IN (
        'product-category', 'department', 'position', 'settlement-method',
        'dictionary-type', 'dictionary-item', 'measurement-unit', 'income-expense-type',
        'account-subject'
    )),
    code varchar(64) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$'),
    current_version_id varchar(26) NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    next_version_no integer NOT NULL DEFAULT 2 CHECK (next_version_no >= 2),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    UNIQUE (id, entity)
);
CREATE UNIQUE INDEX aux_objects_entity_code_uq ON aux_objects (entity, upper(code));
CREATE INDEX aux_objects_entity_updated_idx ON aux_objects (entity, updated_at DESC, id DESC);

CREATE TABLE aux_versions (
    id varchar(26) PRIMARY KEY,
    object_id varchar(26) NOT NULL,
    entity varchar(32) NOT NULL,
    version_no integer NOT NULL CHECK (version_no >= 1),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    UNIQUE (object_id, version_no),
    UNIQUE (id, object_id, entity),
    FOREIGN KEY (object_id, entity)
        REFERENCES aux_objects (id, entity)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX aux_versions_history_idx ON aux_versions (object_id, version_no DESC);

ALTER TABLE aux_objects
    ADD CONSTRAINT aux_objects_current_version_fk
    FOREIGN KEY (current_version_id, id, entity)
    REFERENCES aux_versions (id, object_id, entity)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE aux_audit_events (
    id varchar(26) PRIMARY KEY,
    object_id varchar(26) NOT NULL REFERENCES aux_objects(id) ON DELETE RESTRICT,
    version_id varchar(26) NOT NULL REFERENCES aux_versions(id) ON DELETE RESTRICT,
    entity varchar(32) NOT NULL,
    event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED', 'SAVED', 'ENABLED', 'DISABLED')),
    actor_id varchar(26) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (version_id, object_id, entity)
        REFERENCES aux_versions(id, object_id, entity) ON DELETE RESTRICT
);
CREATE INDEX aux_audit_events_history_idx
    ON aux_audit_events (object_id, occurred_at DESC, id DESC);

-- Keep existing object and version identifiers so BOB and historical VOU references remain stable.
INSERT INTO aux_objects (
    id, entity, code, current_version_id, enabled, next_version_no, revision,
    created_at, created_by, updated_at, updated_by
)
SELECT
    o.id,
    CASE o.entity WHEN 'category' THEN 'product-category' ELSE o.entity END,
    o.code, o.current_version_id, true, o.next_version_no, o.revision,
    o.created_at, o.created_by, o.updated_at, o.updated_by
FROM bob_objects o
WHERE o.entity IN ('category', 'department', 'position', 'settlement-method')
  AND (
      o.entity <> 'category'
      OR EXISTS (
          SELECT 1
          FROM bob_category_versions category_detail
          WHERE category_detail.version_id = o.current_version_id
            AND category_detail.target_entity = 'product'
      )
  );

INSERT INTO aux_versions (
    id, object_id, entity, version_no, data, created_at, created_by
)
SELECT
    v.id, v.object_id,
    CASE v.entity WHEN 'category' THEN 'product-category' ELSE v.entity END,
    v.version_no,
    CASE v.entity
        WHEN 'category' THEN jsonb_build_object(
            'name', ca.name,
            'parentId', COALESCE(ca.parent_id, ''),
            'description', COALESCE(ca.description, '')
        )
        WHEN 'department' THEN jsonb_build_object(
            'name', d.name,
            'parentId', COALESCE(d.parent_id, ''),
            'description', COALESCE(d.description, '')
        )
        WHEN 'position' THEN jsonb_build_object(
            'name', p.name,
            'description', COALESCE(p.description, '')
        )
        WHEN 'settlement-method' THEN jsonb_strip_nulls(jsonb_build_object(
            'name', sm.name,
            'ruleType', CASE sm.rule_type
                WHEN 'RELATIVE_DAYS' THEN 'DUE_DAYS'
                ELSE 'MONTH_END'
            END,
            'dueDays', CASE WHEN sm.rule_type = 'RELATIVE_DAYS' THEN sm.day_offset END,
            'cutoffDay', CASE
                WHEN sm.rule_type = 'FIXED_DAY' THEN sm.day_of_month
                WHEN sm.rule_type = 'MONTH_END' THEN 31
            END,
            'monthOffset', CASE WHEN sm.rule_type = 'RELATIVE_DAYS' THEN NULL ELSE sm.month_offset END,
            'defaultSalesSurcharge', '0.00',
            'description', COALESCE(sm.description, '')
        ))
    END,
    v.created_at, v.created_by
FROM bob_versions v
LEFT JOIN bob_category_versions ca ON ca.version_id = v.id
LEFT JOIN bob_department_versions d ON d.version_id = v.id
LEFT JOIN bob_position_versions p ON p.version_id = v.id
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id = v.id
WHERE v.entity IN ('category', 'department', 'position', 'settlement-method')
  AND EXISTS (SELECT 1 FROM aux_objects migrated WHERE migrated.id = v.object_id);

INSERT INTO aux_audit_events (
    id, object_id, version_id, entity, event_type, actor_id, occurred_at, request_id, summary
)
SELECT
    a.id, a.object_id, a.version_id,
    CASE a.entity WHEN 'category' THEN 'product-category' ELSE a.entity END,
    CASE
        WHEN a.event_type = 'CREATED' THEN 'CREATED'
        ELSE 'SAVED'
    END,
    a.actor_id, a.occurred_at, a.request_id,
    a.summary || jsonb_build_object('migratedFrom', a.event_type)
FROM bob_audit_events a
WHERE a.entity IN ('category', 'department', 'position', 'settlement-method')
  AND EXISTS (SELECT 1 FROM aux_objects migrated WHERE migrated.id = a.object_id);

WITH system_actor(id) AS (VALUES ('00000000000000000000000000')),
seed(entity, object_id, version_id, code, data) AS (
    VALUES
        ('dictionary-type', '01JAVX00000000000000000001', '01JAVX00000000000000000002',
         'CUSTOMER_TYPE', '{"name":"客户类型","description":"客户展示和筛选类型"}'::jsonb),
        ('dictionary-type', '01JAVX00000000000000000003', '01JAVX00000000000000000004',
         'VEHICLE_TYPE', '{"name":"车辆类型","description":"车辆展示和筛选类型"}'::jsonb),
        ('dictionary-item', '01JAVX00000000000000000005', '01JAVX00000000000000000006',
         'END_USER', '{"name":"终端客户","dictionaryTypeCode":"CUSTOMER_TYPE","sortOrder":10}'::jsonb),
        ('dictionary-item', '01JAVX00000000000000000007', '01JAVX00000000000000000008',
         'DEALER', '{"name":"经销商","dictionaryTypeCode":"CUSTOMER_TYPE","sortOrder":20}'::jsonb),
        ('dictionary-item', '01JAVX00000000000000000009', '01JAVX00000000000000000010',
         'BOX_TRUCK', '{"name":"厢式货车","dictionaryTypeCode":"VEHICLE_TYPE","sortOrder":10}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000011', '01JAVX00000000000000000012',
         'KG', '{"name":"千克","symbol":"kg","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000013', '01JAVX00000000000000000014',
         'PIECE', '{"name":"件","symbol":"件","quantityScale":0}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000015', '01JAVX00000000000000000016',
         'YEAR', '{"name":"年","symbol":"年","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000017', '01JAVX00000000000000000018',
         'OCCURRENCE', '{"name":"次","symbol":"次","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000025', '01JAVX00000000000000000026',
         'HOUR', '{"name":"小时","symbol":"h","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000027', '01JAVX00000000000000000028',
         'TON', '{"name":"吨","symbol":"t","quantityScale":6}'::jsonb)
)
INSERT INTO aux_objects (
    id, entity, code, current_version_id, enabled, next_version_no, revision, created_by, updated_by
)
SELECT object_id, entity, code, version_id, true, 2, 1, system_actor.id, system_actor.id
FROM seed CROSS JOIN system_actor;

WITH system_actor(id) AS (VALUES ('00000000000000000000000000')),
seed(entity, object_id, version_id, data) AS (
    VALUES
        ('dictionary-type', '01JAVX00000000000000000001', '01JAVX00000000000000000002',
         '{"name":"客户类型","description":"客户展示和筛选类型"}'::jsonb),
        ('dictionary-type', '01JAVX00000000000000000003', '01JAVX00000000000000000004',
         '{"name":"车辆类型","description":"车辆展示和筛选类型"}'::jsonb),
        ('dictionary-item', '01JAVX00000000000000000005', '01JAVX00000000000000000006',
         '{"name":"终端客户","dictionaryTypeCode":"CUSTOMER_TYPE","sortOrder":10}'::jsonb),
        ('dictionary-item', '01JAVX00000000000000000007', '01JAVX00000000000000000008',
         '{"name":"经销商","dictionaryTypeCode":"CUSTOMER_TYPE","sortOrder":20}'::jsonb),
        ('dictionary-item', '01JAVX00000000000000000009', '01JAVX00000000000000000010',
         '{"name":"厢式货车","dictionaryTypeCode":"VEHICLE_TYPE","sortOrder":10}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000011', '01JAVX00000000000000000012',
         '{"name":"千克","symbol":"kg","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000013', '01JAVX00000000000000000014',
         '{"name":"件","symbol":"件","quantityScale":0}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000015', '01JAVX00000000000000000016',
         '{"name":"年","symbol":"年","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000017', '01JAVX00000000000000000018',
         '{"name":"次","symbol":"次","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000025', '01JAVX00000000000000000026',
         '{"name":"小时","symbol":"h","quantityScale":6}'::jsonb),
        ('measurement-unit', '01JAVX00000000000000000027', '01JAVX00000000000000000028',
         '{"name":"吨","symbol":"t","quantityScale":6}'::jsonb)
)
INSERT INTO aux_versions (id, object_id, entity, version_no, data, created_by)
SELECT version_id, object_id, entity, 1, data, system_actor.id
FROM seed CROSS JOIN system_actor;

-- Preserve every legacy vehicle type as a managed dictionary item. The
-- business row stores the generated stable dictionary code.
WITH legacy AS (
    SELECT DISTINCT btrim(vehicle_type) AS legacy_name,
           'LEGACY_' || upper(substr(md5(btrim(vehicle_type)), 1, 12)) AS code,
           '01' || upper(substr(md5('vehicle-type-object:' || btrim(vehicle_type)), 1, 24)) AS object_id,
           '01' || upper(substr(md5('vehicle-type-version:' || btrim(vehicle_type)), 1, 24)) AS version_id
    FROM bob_vehicle_versions
    WHERE btrim(vehicle_type) <> '' AND btrim(vehicle_type) <> '厢式货车'
)
INSERT INTO aux_objects (
    id, entity, code, current_version_id, enabled, next_version_no, revision, created_by, updated_by
)
SELECT object_id, 'dictionary-item', code, version_id, true, 2, 1,
       '00000000000000000000000000', '00000000000000000000000000'
FROM legacy
ON CONFLICT DO NOTHING;

WITH legacy AS (
    SELECT DISTINCT btrim(vehicle_type) AS legacy_name,
           '01' || upper(substr(md5('vehicle-type-object:' || btrim(vehicle_type)), 1, 24)) AS object_id,
           '01' || upper(substr(md5('vehicle-type-version:' || btrim(vehicle_type)), 1, 24)) AS version_id
    FROM bob_vehicle_versions
    WHERE btrim(vehicle_type) <> '' AND btrim(vehicle_type) <> '厢式货车'
)
INSERT INTO aux_versions (id, object_id, entity, version_no, data, created_by)
SELECT version_id, object_id, 'dictionary-item', 1,
       jsonb_build_object(
           'name', legacy_name,
           'dictionaryTypeCode', 'VEHICLE_TYPE',
           'sortOrder', 100
       ),
       '00000000000000000000000000'
FROM legacy
ON CONFLICT (id) DO NOTHING;

UPDATE bob_vehicle_versions
SET vehicle_type = CASE
    WHEN btrim(vehicle_type) = '厢式货车' THEN 'BOX_TRUCK'
    ELSE 'LEGACY_' || upper(substr(md5(btrim(vehicle_type)), 1, 12))
END;

-- Remove BOB-owned auxiliary foreign keys. Cross-domain reference integrity is
-- enforced by the AUX resolver in the same transaction; keeping a database FK
-- to BOB would reject newly created AUX identities.
-- +goose StatementBegin
DO $$
DECLARE
    target record;
    constraint_name text;
BEGIN
    FOR target IN
        SELECT * FROM (VALUES
            ('bob_customer_versions', 'settlement_method_id'),
            ('bob_supplier_versions', 'settlement_method_id'),
            ('bob_employee_versions', 'department_id'),
            ('bob_employee_versions', 'position_id'),
            ('bob_product_versions', 'category_id')
        ) AS targets(table_name, column_name)
    LOOP
        SELECT constraint_item.conname INTO constraint_name
        FROM pg_constraint constraint_item
        WHERE constraint_item.conrelid = target.table_name::regclass
          AND constraint_item.contype = 'f'
          AND pg_get_constraintdef(constraint_item.oid)
              LIKE 'FOREIGN KEY (' || target.column_name || ', %'
        LIMIT 1;
        IF constraint_name IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %I DROP CONSTRAINT %I',
                target.table_name, constraint_name
            );
        END IF;
        constraint_name := NULL;
    END LOOP;
END
$$;
-- +goose StatementEnd

WITH actions(action, description, ordinal) AS (
    VALUES
        ('query', '查询', 1), ('get', '查看', 2), ('create', '创建', 3),
        ('save', '保存', 4), ('enable', '启用', 5), ('disable', '停用', 6),
        ('delete', '删除', 7), ('versions', '查看版本', 8), ('audit-history', '查看变更记录', 9)
), entities(entity, description, ordinal) AS (
    VALUES
        ('product-category', '产品分类', 1), ('department', '部门', 2),
        ('position', '岗位', 3), ('settlement-method', '结算方式', 4),
        ('dictionary-type', '字典类型', 5), ('dictionary-item', '字典项', 6),
        ('measurement-unit', '计量单位', 7), ('income-expense-type', '收支类型', 8),
        ('account-subject', '会计科目', 9)
), numbered AS (
    SELECT e.entity, e.description AS entity_description, a.action,
           a.description AS action_description,
           e.ordinal * 20 + a.ordinal AS seq
    FROM entities e CROSS JOIN actions a
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JAUX' || lpad(seq::text, 20, '0'),
       '/aux/' || entity || '/' || action,
       'aux', entity, action, action_description || entity_description, 'ENABLED'
FROM numbered;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'aux'
ON CONFLICT DO NOTHING;

-- The public endpoints move to AUX. Old BOB data remains as immutable compatibility storage.
DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'bob'
      AND entity IN ('category', 'department', 'position', 'settlement-method')
);
DELETE FROM app_permissions
WHERE domain = 'bob'
  AND entity IN ('category', 'department', 'position', 'settlement-method');

CREATE TABLE aux_migration_00024_category_refs (
    detail_table varchar(32) NOT NULL,
    version_id varchar(26) NOT NULL,
    category_id varchar(26) NOT NULL,
    PRIMARY KEY (detail_table, version_id)
);
INSERT INTO aux_migration_00024_category_refs
SELECT 'customer', version_id, category_id FROM bob_customer_versions WHERE category_id IS NOT NULL
UNION ALL SELECT 'supplier', version_id, category_id FROM bob_supplier_versions WHERE category_id IS NOT NULL
UNION ALL SELECT 'employee', version_id, category_id FROM bob_employee_versions WHERE category_id IS NOT NULL
UNION ALL SELECT 'service', version_id, category_id FROM bob_service_versions WHERE category_id IS NOT NULL
UNION ALL SELECT 'warehouse', version_id, category_id FROM bob_warehouse_versions WHERE category_id IS NOT NULL
UNION ALL SELECT 'vehicle', version_id, category_id FROM bob_vehicle_versions WHERE category_id IS NOT NULL
UNION ALL SELECT 'fund-account', version_id, category_id FROM bob_fund_account_versions WHERE category_id IS NOT NULL;

UPDATE bob_customer_versions SET category_id = NULL;
UPDATE bob_supplier_versions SET category_id = NULL;
UPDATE bob_employee_versions SET category_id = NULL;
UPDATE bob_service_versions SET category_id = NULL;
UPDATE bob_warehouse_versions SET category_id = NULL;
UPDATE bob_vehicle_versions SET category_id = NULL;
UPDATE bob_fund_account_versions SET category_id = NULL;

-- +goose Down

CREATE TABLE IF NOT EXISTS aux_migration_00024_category_refs (
    detail_table varchar(32) NOT NULL,
    version_id varchar(26) NOT NULL,
    category_id varchar(26) NOT NULL,
    PRIMARY KEY (detail_table, version_id)
);

UPDATE bob_vehicle_versions vehicle
SET vehicle_type = dictionary_version.data->>'name'
FROM aux_objects dictionary_object
JOIN aux_versions dictionary_version ON dictionary_version.id=dictionary_object.current_version_id
WHERE dictionary_object.entity='dictionary-item'
  AND dictionary_object.code=vehicle.vehicle_type
  AND dictionary_version.data->>'dictionaryTypeCode'='VEHICLE_TYPE';

UPDATE bob_customer_versions detail SET category_id=backup.category_id
FROM aux_migration_00024_category_refs backup
WHERE backup.detail_table='customer' AND backup.version_id=detail.version_id;
UPDATE bob_supplier_versions detail SET category_id=backup.category_id
FROM aux_migration_00024_category_refs backup
WHERE backup.detail_table='supplier' AND backup.version_id=detail.version_id;
UPDATE bob_employee_versions detail SET category_id=backup.category_id
FROM aux_migration_00024_category_refs backup
WHERE backup.detail_table='employee' AND backup.version_id=detail.version_id;
UPDATE bob_service_versions detail SET category_id=backup.category_id
FROM aux_migration_00024_category_refs backup
WHERE backup.detail_table='service' AND backup.version_id=detail.version_id;
UPDATE bob_warehouse_versions detail SET category_id=backup.category_id
FROM aux_migration_00024_category_refs backup
WHERE backup.detail_table='warehouse' AND backup.version_id=detail.version_id;
UPDATE bob_vehicle_versions detail SET category_id=backup.category_id
FROM aux_migration_00024_category_refs backup
WHERE backup.detail_table='vehicle' AND backup.version_id=detail.version_id;
UPDATE bob_fund_account_versions detail SET category_id=backup.category_id
FROM aux_migration_00024_category_refs backup
WHERE backup.detail_table='fund-account' AND backup.version_id=detail.version_id;
DROP TABLE aux_migration_00024_category_refs;

ALTER TABLE bob_customer_versions
    ADD CONSTRAINT bob_customer_settlement_method_bob_fk
    FOREIGN KEY (settlement_method_id, settlement_method_entity)
    REFERENCES bob_objects(id, entity)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE bob_supplier_versions
    ADD CONSTRAINT bob_supplier_settlement_method_bob_fk
    FOREIGN KEY (settlement_method_id, settlement_method_entity)
    REFERENCES bob_objects(id, entity)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE bob_employee_versions
    ADD CONSTRAINT bob_employee_department_bob_fk
        FOREIGN KEY (department_id, department_entity)
        REFERENCES bob_objects(id, entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT bob_employee_position_bob_fk
        FOREIGN KEY (position_id, position_entity)
        REFERENCES bob_objects(id, entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE bob_product_versions
    ADD CONSTRAINT bob_product_category_bob_fk
    FOREIGN KEY (category_id, category_entity)
    REFERENCES bob_objects(id, entity)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain = 'aux');
DELETE FROM app_permissions WHERE domain = 'aux';

WITH actions(action, action_offset) AS (
    VALUES ('approve',0),('audit-history',1),('create',2),('delete',3),
           ('edit',4),('get',5),('query',6),('reject',7),('save',8),
           ('submit',9),('versions',10)
), entities(entity, base) AS (
    VALUES ('category',89),('department',100),('position',111),('settlement-method',122)
)
INSERT INTO app_permissions (id,path,domain,entity,action,description,status)
SELECT '01JBOB'||lpad((base+action_offset)::text,20,'0'),
       '/bob/'||entity||'/'||action,'bob',entity,action,action||' '||entity,'ENABLED'
FROM entities CROSS JOIN actions;

DROP TABLE aux_audit_events;
ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_current_version_fk;
DROP TABLE aux_versions;
DROP TABLE aux_objects;
